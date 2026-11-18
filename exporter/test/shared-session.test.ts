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

test('login ล้มแบบ fatal ติดกัน 2 ครั้ง (รหัสผิด) → ล็อกทั้งรอบ: งานที่เหลือล้มทันทีโดยไม่ login ซ้ำ (กันบัญชีถูกล็อก) · ครั้งแรกให้โอกาสอีกหนึ่งครั้ง (login ช้าชั่วคราว)', async () => {
  const { provider, log } = fakeProvider({ openFails: () => new Fatal('wrong password') });
  const a = await run(provider, async () => 'x'); // open #1 ล้ม
  const b = await run(provider, async () => 'x'); // open #2 ล้ม → ล็อก
  const c = await run(provider, async () => 'x'); // ไม่เปิดอีก
  const d = await run(provider, async () => 'x');
  assert.deepEqual([a.ok, b.ok, c.ok, d.ok], [false, false, false, false]);
  assert.equal(log.opened, 2);
  assert.ok(d.ok === false && (d.error as Error).message === 'wrong password');
});

test('login ล้มแบบ fatal ครั้งเดียวแล้วสำเร็จ (ช้าชั่วคราว) → นับใหม่ ไม่ล็อก · สำเร็จแล้วล้มกลางรอบสองครั้งติดกันก็ล็อก', async () => {
  const slow = fakeProvider({ openFails: (n) => (n === 1 ? new Fatal('slow login') : undefined) });
  assert.equal((await run(slow.provider, async () => 'x')).ok, false);
  assert.equal((await run(slow.provider, async () => 'x')).ok, true);
  assert.equal(slow.log.opened, 2);
  const mid = fakeProvider({ openFails: (n) => (n >= 2 ? new Fatal('login page') : undefined) });
  assert.equal((await run(mid.provider, async () => 'warm')).ok, true); // #1 สำเร็จ
  await run(mid.provider, async () => { throw new Lost('lost'); }); // renew → #2 ล้ม
  await run(mid.provider, async () => 'x'); // #3 ล้ม → ล็อก
  const before = mid.log.opened;
  assert.equal((await run(mid.provider, async () => 'x')).ok, false);
  assert.equal(mid.log.opened, before);
});

test('login ล้มชั่วคราว (ไม่ใช่ fatal) → ลองซ้ำตามนโยบายแล้วเปิดสำเร็จ', async () => {
  const { provider, log } = fakeProvider({ openFails: (n) => (n === 1 ? new Slow('net') : undefined) });
  assert.equal((await run(provider, async () => 'x')).ok, true);
  assert.equal(log.opened, 2);
});

test('งานที่ล้มชั่วคราวจนหมดโอกาสทิ้ง session ที่อาจค้าง → renew ก่อนงานถัดไป (ไม่ให้งานถัดไปเสียหนึ่งครั้ง + รอ 30 วินาที)', async () => {
  const { provider, log } = fakeProvider();
  const bad = await run(provider, async () => { throw new Slow('stuck in modal'); });
  assert.equal(bad.ok, false);
  const openedAfterBad = log.opened;
  const seen: number[] = [];
  await run(provider, async (s) => { seen.push(s.id); });
  assert.equal(log.opened, openedAfterBad); // renew เกิดตอนจบงานที่ล้มแล้ว ไม่ใช่ตอนเริ่มงานถัดไป
  assert.equal(seen[0], openedAfterBad); // งานถัดไปได้ session ใหม่ที่เพิ่งเปิด
  assert.ok(seen[0]! > 1);
});

test('หลัง session หลุดแล้ว renew ลองซ้ำแล้วล้มชั่วคราว → session ใหม่นั้นก็ถูกถือว่าอาจค้างและถูก renew เมื่อจบงาน', async () => {
  const { provider, log } = fakeProvider();
  const r = await run(provider, async (s) => { if (s.id === 1) throw new Lost('lost'); throw new Slow('timeout on new session'); });
  assert.equal(r.ok, false);
  const opened = log.opened;
  const seen: number[] = [];
  await run(provider, async (s) => { seen.push(s.id); });
  assert.equal(log.opened, opened);
  assert.equal(seen[0], opened);
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
