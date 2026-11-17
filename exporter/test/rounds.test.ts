import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_ROUNDS, ROUND_HOURS, gateRound, parseRefreshId, parseRoundId, parseRounds, roundId } from '../src/core/run-planner.ts';

/**
 * exporter-hoteltime-4h-rounds ticket 02: ตารางรอบดึง 6 รอบ + สวิตช์ HOTELTIME_ROUNDS + id ต่อรอบ (seam 1 — ตัวผังรอบ)
 */

const thai = (hhmm: string, day = '2026-11-18') => new Date(`${day}T${hhmm}:00+07:00`);

test('ตารางรอบ = 04, 08, 12, 16, 20, 23 · ค่าเริ่ม = 08,12,16,20,23 (04 ยังไม่เปิดจนกว่าจะดูผลจริง)', () => {
  assert.deepEqual([...ROUND_HOURS], ['04', '08', '12', '16', '20', '23']);
  assert.deepEqual([...DEFAULT_ROUNDS], ['08', '12', '16', '20', '23']);
});

test('HOTELTIME_ROUNDS: ไม่ตั้ง/ว่าง = ค่าเริ่ม (ลืมตั้งต้องไม่ทำให้ระบบเงียบ) · off/none = ปิดทั้งหมดอย่างชัดเจน', () => {
  assert.deepEqual(parseRounds(undefined), { rounds: DEFAULT_ROUNDS });
  assert.deepEqual(parseRounds('   '), { rounds: DEFAULT_ROUNDS });
  assert.deepEqual(parseRounds('off'), { rounds: [] });
  assert.deepEqual(parseRounds('NONE'), { rounds: [] });
});

test('HOTELTIME_ROUNDS: รายการชั่วโมง — เว้นวรรค/ซ้ำ/เลขหลักเดียวได้ ผลเรียงตามเวลา', () => {
  assert.deepEqual(parseRounds('04, 12'), { rounds: ['04', '12'] });
  assert.deepEqual(parseRounds('23,08,08'), { rounds: ['08', '23'] });
  assert.deepEqual(parseRounds('8,12'), { rounds: ['08', '12'] });
});

test('HOTELTIME_ROUNDS ผิดรูปแบบ = error (พิมพ์ผิดต้องไม่ปิดรอบเงียบ ๆ) · ชั่วโมงที่ไม่ใช่รอบ = error', () => {
  for (const bad of ['08,xx', '24', '09', '06,23', '08;12', '4h']) {
    const r = parseRounds(bad);
    assert.ok('error' in r, `${bad} ต้องเป็น error`);
  }
  assert.match((parseRounds('09') as { error: string }).error, /HOTELTIME_ROUNDS/);
});

test('รอบที่ไม่อยู่ในรายการ → ไม่มีแผน (ไม่ login) แม้อยู่ในหน้าต่าง', () => {
  assert.deepEqual(gateRound({ now: thai('08:05'), round: '08', enabled: ['12'] }), { run: false, reason: 'disabled' });
  assert.deepEqual(gateRound({ now: thai('04:05'), round: '04', enabled: DEFAULT_ROUNDS }), { run: false, reason: 'disabled' });
});

test('รอบนอกหน้าต่าง → ไม่มีแผน · รอบที่เปิดและอยู่ในหน้าต่าง → รัน', () => {
  assert.deepEqual(gateRound({ now: thai('08:00'), round: '08', enabled: DEFAULT_ROUNDS }), { run: true, reason: null });
  assert.deepEqual(gateRound({ now: thai('08:35'), round: '08', enabled: DEFAULT_ROUNDS }), { run: true, reason: null }); // retry +30 นาที
  assert.deepEqual(gateRound({ now: thai('07:59'), round: '08', enabled: DEFAULT_ROUNDS }), { run: false, reason: 'outside_window' });
  assert.deepEqual(gateRound({ now: thai('10:00'), round: '08', enabled: DEFAULT_ROUNDS }), { run: false, reason: 'outside_window' });
  assert.deepEqual(gateRound({ now: thai('14:00'), round: '12', enabled: DEFAULT_ROUNDS }), { run: false, reason: 'outside_window' });
});

test('รอบ 23:00 รันได้เฉพาะ 23:00–23:59 — ไม่ข้ามเที่ยงคืนลงโฟลเดอร์วันถัดไป', () => {
  assert.equal(gateRound({ now: thai('23:00'), round: '23', enabled: DEFAULT_ROUNDS }).run, true);
  assert.equal(gateRound({ now: thai('23:59'), round: '23', enabled: DEFAULT_ROUNDS }).run, true);
  assert.equal(gateRound({ now: thai('00:05', '2026-11-19'), round: '23', enabled: DEFAULT_ROUNDS }).run, false);
  assert.equal(gateRound({ now: thai('22:59'), round: '23', enabled: DEFAULT_ROUNDS }).run, false);
});

test('หน้าต่างของรอบไม่ทับกัน — เวลาหนึ่งเข้าได้อย่างมากหนึ่งรอบ', () => {
  for (let h = 0; h < 24; h++) for (const m of ['00', '30', '59']) {
    const now = thai(`${String(h).padStart(2, '0')}:${m}`);
    const hits = ROUND_HOURS.filter((r) => gateRound({ now, round: r, enabled: ROUND_HOURS }).run);
    assert.ok(hits.length <= 1, `${h}:${m} → ${hits.join(',')}`);
  }
});

test('id ต่อรอบไม่ชนกันและไม่ชน id เดิม · id เดิมยังอ่านออก', () => {
  const ids = ROUND_HOURS.map((h) => roundId('arrivals', h));
  assert.equal(new Set(ids).size, ROUND_HOURS.length);
  assert.equal(roundId('arrivals', '12'), 'arrivals@round-12');
  assert.deepEqual(parseRoundId('arrivals@round-12'), { base: 'arrivals', round: '12' });
  assert.equal(parseRoundId('arrivals@refresh-23'), null);
  assert.equal(parseRoundId('arrivals'), null);
  // id เดิม: parseRefreshId อ่านได้เหมือนเดิม และไม่เห็น id รอบใหม่เป็น refresh
  assert.deepEqual(parseRefreshId('arrivals@refresh'), { base: 'arrivals', slot: null });
  assert.deepEqual(parseRefreshId('arrivals@refresh-06'), { base: 'arrivals', slot: '06' });
  assert.deepEqual(parseRefreshId('arrivals@refresh-23'), { base: 'arrivals', slot: '23' });
  assert.equal(parseRefreshId('arrivals@round-12'), null);
  assert.equal(parseRefreshId('trial-balance@period-close'), null);
});

test('HOTELTIME_SNAPSHOT_SLOTS เดิมไม่เปิดรอบใหม่: parseRounds ไม่อ่านตัวแปรนั้น — รอบเปิดจาก HOTELTIME_ROUNDS เท่านั้น', () => {
  const saved = process.env.HOTELTIME_SNAPSHOT_SLOTS;
  process.env.HOTELTIME_SNAPSHOT_SLOTS = '06,23';
  try {
    assert.deepEqual(parseRounds(undefined), { rounds: DEFAULT_ROUNDS });
    assert.deepEqual(parseRounds('off'), { rounds: [] });
  } finally {
    if (saved === undefined) delete process.env.HOTELTIME_SNAPSHOT_SLOTS; else process.env.HOTELTIME_SNAPSHOT_SLOTS = saved;
  }
});
