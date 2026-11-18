import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeStrayPages, createSharedSession, runInSharedSession } from '../src/core/shared-session.ts';

/**
 * exporter-hoteltime-4h-rounds ticket 12: session เดียวต่อรอบดึง — seam = "ผู้ให้ session" (get / renew / close) สลับเป็นของปลอมได้ ไม่ใช้เบราว์เซอร์จริง
 */

class Lost extends Error {}
class Fatal extends Error {}
class Slow extends Error {}

type Fake = { readonly id: number; closed: boolean };
function fakeProvider(opts: { openFails?: (n: number) => Error | undefined } = {}) {
  const log = { opened: 0, closed: 0 };
  const provider = createSharedSession<Fake>({
    open: async () => {
      const n = ++log.opened;
      const err = opts.openFails?.(n);
      if (err !== undefined) throw err;
      return { id: n, closed: false };
    },
    close: async (s) => {
      s.closed = true;
      log.closed++;
    },
    isFatal: (e) => e instanceof Fatal,
  });
  return { provider, log };
}
const policy = { maxRetries: 2, baseDelayMs: 0 };
const run = <T>(provider: ReturnType<typeof fakeProvider>['provider'], task: (s: Fake) => Promise<T>) =>
  runInSharedSession(provider, task, { isSessionLost: (e) => e instanceof Lost, isRetryable: (e) => e instanceof Slow, policy, sleep: async () => undefined });

test('หลายงานในรอบเดียว: เปิด session + login เพียง 1 ครั้ง · ทุกงานใช้ session เดียวกัน', async () => {
  const { provider, log } = fakeProvider();
  const used: number[] = [];
  for (let i = 0; i < 5; i++) assert.equal((await run(provider, async (s) => (used.push(s.id), i))).ok, true);
  assert.deepEqual(used, [1, 1, 1, 1, 1]);
  assert.equal(log.opened, 1);
  await provider.close();
  assert.equal(log.closed, 1);
  await provider.close(); // ปิดซ้ำปลอดภัย
  assert.equal(log.closed, 1);
});

test('งานหนึ่งล้ม (ความผิดพลาดทั่วไป) → งานที่เหลือยังทำต่อใน session เดิม ไม่ login ใหม่', async () => {
  const { provider, log } = fakeProvider();
  const results = [];
  for (const i of [1, 2, 3]) results.push(await run(provider, async () => { if (i === 2) throw new Error('boom'); return i; }));
  assert.deepEqual(results.map((r) => r.ok), [true, false, true]);
  assert.equal(log.opened, 1);
  assert.equal(results[1]!.attempts, 1);
});

test('session หลุด → login ใหม่ 1 ครั้ง แล้วลองงานนั้นซ้ำ 1 ครั้ง · งานถัดไปใช้ session ใหม่', async () => {
  const { provider, log } = fakeProvider();
  const seen: number[] = [];
  await run(provider, async () => 'warm');
  const r = await run(provider, async (s) => { seen.push(s.id); if (s.id === 1) throw new Lost('login page'); return 'ok'; });
  assert.equal(r.ok, true);
  assert.deepEqual(seen, [1, 2]);
  assert.equal(log.opened, 2);
  assert.equal(log.closed, 1); // ตัวเก่าปิดแล้ว
  const next: number[] = [];
  await run(provider, async (s) => { next.push(s.id); });
  assert.deepEqual(next, [2]);
});

test('session หลุดซ้ำหลัง login ใหม่ → บันทึกล้ม ไม่วนไม่รู้จบ (login ใหม่ได้ 1 ครั้งต่องาน)', async () => {
  const { provider, log } = fakeProvider();
  let calls = 0;
  const r = await run(provider, async () => { calls++; throw new Lost('still login page'); });
  assert.equal(r.ok, false);
  assert.equal(calls, 2);
  assert.equal(log.opened, 2);
});

test('ความผิดพลาดชั่วคราว (ไม่ใช่ session หลุด): login ใหม่ก่อนลองซ้ำทุกครั้ง (หน้าเดิมอาจค้างใน modal/postback) · ความผิดพลาดอื่นไม่ login ใหม่', async () => {
  const { provider, log } = fakeProvider();
  const seen: number[] = [];
  let calls = 0;
  const r = await run(provider, async (s) => { seen.push(s.id); if (++calls < 3) throw new Slow('timeout'); return 'done'; });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 3);
  assert.deepEqual(seen, [1, 2, 3]); // แต่ละครั้งที่ลองซ้ำเป็น session ใหม่
  assert.equal(log.opened, 3);
  const before = log.opened;
  await run(provider, async () => { throw new Error('boom'); }); // ไม่ชั่วคราว: ไม่ renew
  assert.equal(log.opened, before);
});

test('login ล้มแบบถาวร (รหัสผิด) → งานนั้นล้ม · งานที่เหลือล้มทันทีโดยไม่ login ซ้ำ (กันบัญชีถูกล็อก)', async () => {
  const { provider, log } = fakeProvider({ openFails: () => new Fatal('wrong password') });
  const a = await run(provider, async () => 'x');
  const b = await run(provider, async () => 'x');
  const c = await run(provider, async () => 'x');
  assert.deepEqual([a.ok, b.ok, c.ok], [false, false, false]);
  assert.equal(log.opened, 1);
  assert.ok(b.ok === false && (b.error as Error).message === 'wrong password');
});

test('fatal ล็อกเฉพาะตอนยังไม่เคยเปิดสำเร็จ — login ใหม่กลางรอบล้มด้วย error แบบ fatal ไม่ล็อกทั้งรอบ (อาจเป็นหน้าช้า ไม่ใช่รหัสผิด)', async () => {
  const { provider, log } = fakeProvider({ openFails: (n) => (n === 2 ? new Fatal('unexpected login page') : undefined) });
  assert.equal((await run(provider, async () => 'warm')).ok, true); // เปิดสำเร็จครั้งที่ 1
  const lost = await run(provider, async () => { throw new Lost('login page'); }); // renew → open ครั้งที่ 2 ล้ม (Fatal)
  assert.equal(lost.ok, false);
  const next = await run(provider, async (s) => s.id); // ไม่ล็อก: งานถัดไปเปิดใหม่ได้ (open ครั้งที่ 3)
  assert.equal(next.ok, true);
  assert.equal(log.opened, 3);
});

test('login ล้มชั่วคราว (ไม่ใช่ fatal) → งานถัดไปลองเปิดใหม่ได้', async () => {
  const { provider, log } = fakeProvider({ openFails: (n) => (n === 1 ? new Slow('net') : undefined) });
  assert.equal((await run(provider, async () => 'x')).ok, true); // ลองซ้ำตามนโยบาย → เปิดสำเร็จครั้งที่ 2
  assert.equal(log.opened, 2);
});

test('closeStrayPages: ปิดหน้าต่างอื่นที่ค้าง เหลือหน้าหลัก (กันดาวน์โหลด/popup ค้างรั่วไปงานถัดไป)', async () => {
  const mk = () => ({ closed: false, close: async function (this: { closed: boolean }) { this.closed = true; } });
  const main = mk(), popup = mk(), other = mk();
  await closeStrayPages(() => [main, popup, other], main);
  assert.deepEqual([main.closed, popup.closed, other.closed], [false, true, true]);
});

test('closeStrayPages: เบราว์เซอร์ตายจน pages() โยน error → กลืนไว้ ไม่บังคลุม error เดิมของงาน', async () => {
  await assert.doesNotReject(closeStrayPages(() => { throw new Error('browser has been closed'); }, {}));
});
