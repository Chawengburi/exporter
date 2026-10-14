import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { discordMessages, postDiscord } from '../src/core/discord.ts';
import type { PlannedReport } from '../src/core/run-planner.ts';
import type { RunRecord } from '../src/core/run-record.ts';
import { buildStatus, type Folder, type StatusSetup, type StoreSnapshot } from '../src/core/status.ts';

// ใบ 08: ข้อความ Discord เป็นฟังก์ชันล้วนจากผลของ `exporter status` (seam S2 ขยาย) — สรุปวันละข้อความ + แจ้งเตือนเมื่อมีเรื่องต้องดู ·
// เรื่องเดียวกันไม่ส่งซ้ำ (กุญแจของแต่ละเรื่อง) · ตัวส่งทดสอบกับเซิร์ฟเวอร์ HTTP ปลอม · URL ของ webhook ไม่หลุดในข้อความผิดพลาด

const thai = (iso: string) => new Date(`${iso}+07:00`);
const HT: readonly PlannedReport[] = [
  { id: 'postings', family: 'per-day' }, { id: 'invoices', family: 'per-day' }, { id: 'cancelled', family: 'per-day' },
  { id: 'arrivals', family: 'picture', period: 'none' }, { id: 'trial-balance', family: 'picture', period: 'month' },
];
const FS: readonly PlannedReport[] = [
  { id: 'salebybill', family: 'per-day' }, { id: 'pay', family: 'per-day' }, { id: 'current_stock', family: 'picture', period: 'none' },
];
const SETUP: StatusSetup = { catalog: { hoteltime: HT, foodstory: FS }, goLive: '2026-10-12', webhook: true };

type Result = 'data' | 'empty' | readonly ['failed', string];
const outcome = (id: string, r: Result, day: string): RunRecord['reports'][string] =>
  r === 'data' || r === 'empty'
    ? { report: id, status: 'ok', rows: r === 'data' ? 5 : 0, range: { from: day, to: day }, actualRange: null, files: [], attempts: 1, finishedAt: `${day}T06:00:00.000Z` }
    : { report: id, status: 'failed', error: r[1], attempts: 3, finishedAt: `${day}T06:00:00.000Z` };
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
/** โฟลเดอร์ของวัน D: รายงานตามวันดึงเที่ยงของ D+1 · ภาพถ่ายเที่ยงของ D */
function folder(day: string, perDay?: Record<string, Result>, pictures?: Record<string, Result>): Folder {
  const reports: Record<string, RunRecord['reports'][string]> = {};
  const runs: RunRecord['runs'][number][] = [];
  if (pictures) {
    for (const [id, r] of Object.entries(pictures)) reports[id] = outcome(id, r, day);
    runs.push({ startedAt: `${day}T05:00:00.000Z`, finishedAt: `${day}T05:30:00.000Z`, reports: Object.keys(pictures) });
  }
  if (perDay) {
    for (const [id, r] of Object.entries(perDay)) reports[id] = outcome(id, r, day);
    runs.push({ startedAt: `${nextDay(day)}T05:00:00.000Z`, finishedAt: `${nextDay(day)}T05:30:00.000Z`, reports: Object.keys(perDay) });
  }
  return { day, record: { site: 'hoteltime', kind: 'daily', dataThrough: day, runs, reports, skipped: [] } };
}
const healthy = (): StoreSnapshot => ({
  hoteltime: [
    folder('2026-10-12', { postings: 'data', invoices: 'data', cancelled: 'empty' }, { arrivals: 'data', 'trial-balance': 'data' }),
    folder('2026-10-13', { postings: 'data', invoices: 'data', cancelled: 'empty' }, { arrivals: 'data', 'trial-balance': 'data' }),
    folder('2026-10-14', undefined, { arrivals: 'data', 'trial-balance': 'data' }),
  ],
  foodstoryDaily: [
    folder('2026-10-12', { salebybill: 'data', pay: 'data' }, { current_stock: 'data' }),
    folder('2026-10-13', { salebybill: 'data', pay: 'empty' }, { current_stock: 'data' }),
    folder('2026-10-14', undefined, { current_stock: 'data' }),
  ],
  foodstoryMonthly: [{ period: '2026-09', pulledOn: '2026-10-02', passed: 49, total: 49, failed: [] }],
});
const NONE = new Set<string>();
const keysOf = (ms: ReturnType<typeof discordMessages>) => ms.flatMap((m) => m.keys);

test('🔴 สรุปรายวัน: แต่ละ Site มีข้อมูลกี่รายงาน ว่างตัวไหน ภาพของวันนี้ครบไหม — ภาษาไทยสั้น · ปกติ = ไม่มีแจ้งเตือน', () => {
  const r = buildStatus(healthy(), thai('2026-10-14T18:30'), SETUP);
  const ms = discordMessages(r, { summary: true, alreadySent: NONE });
  assert.equal(ms.length, 1);
  const [summary] = ms;
  assert.deepEqual(summary!.keys, ['summary@2026-10-14']);
  assert.match(summary!.content, /2026-10-13/); // วันของข้อมูลที่สรุป
  assert.match(summary!.content, /HotelTime[^\n]*มีข้อมูล 2\/3[^\n]*ว่าง 1 \(cancelled\)[^\n]*ภาพวันนี้ ครบ 2\/2/);
  assert.match(summary!.content, /FoodStory[^\n]*มีข้อมูล 1\/2[^\n]*ว่าง 1 \(pay\)[^\n]*ภาพวันนี้ ครบ 1\/1/);
  assert.match(summary!.content, /ปกติ/);
  assert.ok(summary!.content.length < 2000);
});

test('🔴 แจ้งเตือนเมื่อรายงานยังล้มหลังรอบเก็บตกสุดท้าย — บอก Site วันของข้อมูล ชื่อรายงาน สาเหตุ · ก่อน 18:30 (ยังรอรอบเก็บตก) ไม่แจ้ง', () => {
  const s = healthy();
  const failing = { ...s, hoteltime: [s.hoteltime[0]!, folder('2026-10-13', { postings: ['failed', 'Timeout 60000ms exceeded'], invoices: 'data', cancelled: 'empty' }, { arrivals: 'data', 'trial-balance': 'data' }), s.hoteltime[2]!] };
  assert.deepEqual(discordMessages(buildStatus(failing, thai('2026-10-14T16:00'), SETUP), { summary: false, alreadySent: NONE }), []);
  const ms = discordMessages(buildStatus(failing, thai('2026-10-14T18:30'), SETUP), { summary: false, alreadySent: NONE });
  assert.equal(ms.length, 1);
  assert.match(ms[0]!.content, /HotelTime[^\n]*2026-10-13[^\n]*postings[^\n]*Timeout/);
  assert.deepEqual(ms[0]!.keys, ['failed@hoteltime@2026-10-13@postings@2026-10-14']);
});

test('🔴 แจ้งเตือนเมื่อรายงานภาพของวันนี้ถ่ายไม่ได้ทุกรอบ · วันขาดเกินเพดาน · FoodStory ไม่ได้กดมา 2 วันขึ้นไป', () => {
  const s = healthy();
  const store: StoreSnapshot = {
    ...s,
    hoteltime: [s.hoteltime[0]!, s.hoteltime[1]!, folder('2026-10-14', undefined, { arrivals: 'data', 'trial-balance': ['failed', 'x'] })],
    foodstoryDaily: [s.foodstoryDaily[0]!], // กดล่าสุดวันที่ 13 (ได้ข้อมูลวันที่ 12) → วันที่ 14 = ไม่ได้กดมา 1 วัน ยังไม่เตือน
  };
  const r = buildStatus(store, thai('2026-10-14T18:30'), { ...SETUP, goLive: '2026-10-01' });
  const keys = keysOf(discordMessages(r, { summary: false, alreadySent: NONE }));
  assert.ok(keys.includes('picture@hoteltime@2026-10-14@trial-balance@2026-10-14'), keys.join());
  assert.ok(keys.includes('backlog@hoteltime@2026-10-14'), keys.join());
  assert.ok(!keys.some((k) => k.startsWith('not-pressed')), keys.join());
  const later = buildStatus(store, thai('2026-10-15T18:30'), { ...SETUP, goLive: '2026-10-01' });
  const content = discordMessages(later, { summary: false, alreadySent: NONE }).map((m) => m.content).join('\n');
  assert.match(content, /FoodStory ไม่ได้กดมา 2 วัน/);
});

test('🔴 เรื่องเดียวกันไม่ส่งซ้ำ: กุญแจที่ส่งแล้วไม่อยู่ในข้อความใหม่ · สรุปวันละครั้ง · เรื่องใหม่ยังส่ง', () => {
  const s = healthy();
  const failing = { ...s, hoteltime: [s.hoteltime[0]!, folder('2026-10-13', { postings: ['failed', 'x'], invoices: ['failed', 'y'], cancelled: 'empty' }, { arrivals: 'data', 'trial-balance': 'data' }), s.hoteltime[2]!] };
  const r = buildStatus(failing, thai('2026-10-14T18:30'), SETUP);
  const first = discordMessages(r, { summary: true, alreadySent: NONE });
  assert.deepEqual(keysOf(first).sort(), ['failed@hoteltime@2026-10-13@invoices@2026-10-14', 'failed@hoteltime@2026-10-13@postings@2026-10-14', 'summary@2026-10-14']);
  const again = discordMessages(r, { summary: true, alreadySent: new Set(keysOf(first)) });
  assert.deepEqual(again, []);
  const partly = discordMessages(r, { summary: true, alreadySent: new Set(['summary@2026-10-14', 'failed@hoteltime@2026-10-13@postings@2026-10-14']) });
  assert.deepEqual(keysOf(partly), ['failed@hoteltime@2026-10-13@invoices@2026-10-14']);
  assert.doesNotMatch(partly[0]!.content, /postings/);
});

test('ข้อความยาวเกิน Discord (2000 ตัวอักษร) แบ่งเป็นหลายข้อความ — ไม่มีเรื่องไหนหาย', () => {
  const many: PlannedReport[] = Array.from({ length: 120 }, (_, i) => ({ id: `report-with-a-long-name-${i}`, family: 'per-day' }));
  const results = Object.fromEntries(many.map((r) => [r.id, ['failed', 'Timeout 60000ms exceeded while waiting for the table'] as const]));
  const store: StoreSnapshot = { hoteltime: [folder('2026-10-13', results)], foodstoryDaily: [], foodstoryMonthly: [] };
  const r = buildStatus(store, thai('2026-10-14T18:30'), { ...SETUP, catalog: { hoteltime: many, foodstory: FS } });
  const ms = discordMessages(r, { summary: false, alreadySent: NONE });
  assert.ok(ms.length > 1);
  for (const m of ms) assert.ok(m.content.length <= 2000, String(m.content.length));
  assert.equal(keysOf(ms).filter((k) => k.startsWith('failed@')).length, 120);
});

// ── ตัวส่ง ──

async function fakeDiscord(handler: (req: IncomingMessage, body: string, res: ServerResponse) => void) {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => handler(req, body, res));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/api/webhooks/123/super-secret-token-abc`, close: () => new Promise((r) => server.close(r)) };
}

test('🔴 ตัวส่ง: POST JSON ไปที่ webhook ไม่ mention ใคร · สำเร็จ = คืนปกติ', async () => {
  let got: { method?: string; body?: unknown } = {};
  const fake = await fakeDiscord((req, body, res) => {
    got = { method: req.method, body: JSON.parse(body) };
    res.writeHead(204).end();
  });
  try {
    await postDiscord(fake.url, 'ทดสอบ');
    assert.equal(got.method, 'POST');
    assert.deepEqual(got.body, { content: 'ทดสอบ', allowed_mentions: { parse: [] } });
  } finally {
    await fake.close();
  }
});

test('🔴 ตัวส่ง: Discord ตอบผิดพลาด / rate limit / ต่อไม่ได้ = โยน error ที่ไม่มี URL หรือ token ของ webhook', async () => {
  const fake = await fakeDiscord((_req, _body, res) => {
    res.writeHead(429, { 'content-type': 'application/json' }).end(JSON.stringify({ message: 'You are being rate limited.', retry_after: 2.5 }));
  });
  try {
    await assert.rejects(postDiscord(fake.url, 'x', { retries: 0 }), (err: Error) => {
      assert.match(err.message, /429/);
      assert.doesNotMatch(err.message, /super-secret-token-abc|api\/webhooks/);
      return true;
    });
  } finally {
    await fake.close();
  }
  await assert.rejects(postDiscord('http://127.0.0.1:1/api/webhooks/123/super-secret-token-abc', 'x'), (err: Error) => {
    assert.doesNotMatch(`${err.message}\n${err.stack}`, /super-secret-token-abc/);
    return true;
  });
});

// ── จาก code review ใบ 08 ──

test('🔴 เรื่องที่ยังไม่หาย เตือนซ้ำวันละครั้ง (spec: ไม่ซ้ำ "ในวันเดียวกัน") — พรุ่งนี้ยังล้มอยู่ = เตือนอีก', () => {
  const s = healthy();
  const failing = { ...s, hoteltime: [s.hoteltime[0]!, folder('2026-10-13', { postings: ['failed', 'x'], invoices: 'data', cancelled: 'empty' }, { arrivals: 'data', 'trial-balance': 'data' }), s.hoteltime[2]!] };
  const today = keysOf(discordMessages(buildStatus(failing, thai('2026-10-14T18:30'), SETUP), { summary: false, alreadySent: NONE }));
  const tomorrow = discordMessages(buildStatus(failing, thai('2026-10-15T18:30'), SETUP), { summary: false, alreadySent: new Set(today) });
  assert.ok(keysOf(tomorrow).includes('failed@hoteltime@2026-10-13@postings@2026-10-15'), keysOf(tomorrow).join());
});

test('🔴 รายงานภาพของวันนี้ของ FoodStory ล้มหนึ่งครั้ง (พนักงานกดใหม่ได้) ยังไม่เตือนก่อน 18:30 — "ถ่ายไม่ได้ทุกรอบ"', () => {
  const s = healthy();
  const store = { ...s, foodstoryDaily: [s.foodstoryDaily[0]!, s.foodstoryDaily[1]!, folder('2026-10-14', undefined, { current_stock: ['failed', 'x'] })] };
  assert.deepEqual(keysOf(discordMessages(buildStatus(store, thai('2026-10-14T11:00'), SETUP), { summary: false, alreadySent: NONE })), []);
  assert.ok(keysOf(discordMessages(buildStatus(store, thai('2026-10-14T18:30'), SETUP), { summary: false, alreadySent: NONE }))
    .includes('picture@foodstory@2026-10-14@current_stock@2026-10-14'));
});

test('🔴 FoodStory "ยังไม่เคยกดเลย" เตือนเฉพาะเมื่อตั้งวันเริ่มใช้งานแล้ว (เหมือนวันขาดเกินเพดาน)', () => {
  const store = { ...healthy(), foodstoryDaily: [] };
  const noGoLive = discordMessages(buildStatus(store, thai('2026-10-14T18:30'), { ...SETUP, goLive: null }), { summary: false, alreadySent: NONE });
  assert.ok(!keysOf(noGoLive).some((k) => k.startsWith('not-pressed')), keysOf(noGoLive).join());
  const withGoLive = discordMessages(buildStatus(store, thai('2026-10-14T18:30'), SETUP), { summary: false, alreadySent: NONE });
  assert.ok(keysOf(withGoLive).some((k) => k.startsWith('not-pressed')));
});

test('🔴 ตัวส่ง: rate limit / 5xx ลองซ้ำเองตาม retry_after (สูงสุด 2 ครั้ง) — ครั้งที่สองผ่าน = สำเร็จ', async () => {
  let calls = 0;
  const fake = await fakeDiscord((_req, _body, res) => {
    calls++;
    if (calls === 1) res.writeHead(429, { 'content-type': 'application/json' }).end(JSON.stringify({ retry_after: 0.05 }));
    else res.writeHead(204).end();
  });
  try {
    await postDiscord(fake.url, 'x');
    assert.equal(calls, 2);
  } finally {
    await fake.close();
  }
});

test('🔴 token ของ webhook ถูก redact แม้ URL มี query (?wait=true / ?thread_id=)', async () => {
  const fake = await fakeDiscord((_req, _body, res) => res.writeHead(400).end('bad token super-secret-token-abc'));
  try {
    await assert.rejects(postDiscord(`${fake.url}?thread_id=42`, 'x', { retries: 0 }), (err: Error) => {
      assert.doesNotMatch(err.message, /super-secret-token-abc/);
      return true;
    });
  } finally {
    await fake.close();
  }
});
