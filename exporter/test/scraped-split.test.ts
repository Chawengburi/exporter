import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ScrapeError } from '../src/core/scraped-table.ts';
import { fetchSplitTable } from '../src/core/scraped-split.ts';

/**
 * นโยบายแบ่งช่วงเวลาเมื่อหน้าชนเพดานแถว (ticket 04 ของ exporter-audit-trail · seam S2) — ทดสอบกับ "หน้าเว็บปลอม" ที่ทำตัวเหมือนของจริง:
 * ช่วงครึ่งเปิด [start, end) เป็นนาทีของวัน · เรียงใหม่ไปเก่า · ถึงเพดานแล้วตัดแถวที่**เก่าที่สุด**ทิ้ง · ข้อมูลเป็นของปลอมทั้งหมด
 */

const HEADER = ['', '', 'Date', 'Operation', 'Object', 'Object connected with operation', 'Description', 'Data', 'User'];
const pad = (n: number) => String(n).padStart(2, '0');
/** เหตุการณ์ปลอมที่นาทีของวัน m (วินาทีกำกับตามลำดับ กันแถวชนกัน) */
const ev = (m: number, sec = 0, tag = ''): string[] => ['', '', `13/11/2026 ${pad(Math.floor(m / 60))}:${pad(m % 60)}:${pad(sec)}`, 'Op', `Reservation: ${tag}`, '', '', '', 'U'];

function fakePage(events: readonly string[][], cap: number) {
  const calls: [number, number][] = [];
  const fetchWindow = async (start: number, end: number) => {
    calls.push([start, end]);
    const inWin = events.filter((e) => { const m = Number(e[2]!.slice(11, 13)) * 60 + Number(e[2]!.slice(14, 16)); return m >= start && m < end; });
    const newestFirst = [...inWin].sort((a, b) => (a[2]! < b[2]! ? 1 : -1));
    return [HEADER, ...newestFirst.slice(0, cap)]; // ตัดเก่าสุดทิ้งเมื่อเกินเพดาน
  };
  return { fetchWindow, calls };
}
const OPTS = { expectedHeader: HEADER, dateColumn: 'Date' };
const many = (from: number, to: number, perMinute: number, tag = '') =>
  Array.from({ length: to - from }, (_, i) => Array.from({ length: perMinute }, (_, s) => ev(from + i, s, `${tag}${from + i}-${s}`))).flat();

test('ไม่ชนเพดาน: ดึงทั้งวันครั้งเดียว ได้ตารางตามหน้าเว็บ', async () => {
  const events = [ev(10, 1), ev(500, 2), ev(1439, 3)];
  const p = fakePage(events, 500);
  const t = await fetchSplitTable({ ...OPTS, rowCap: 500, fetchWindow: p.fetchWindow });
  assert.deepEqual(p.calls, [[0, 1440]]);
  assert.equal(t.length, 4);
  assert.deepEqual(t.slice(1).map((r) => r[2]), ['13/11/2026 23:59:03', '13/11/2026 08:20:02', '13/11/2026 00:10:01']);
});

test('ชนระดับวัน: แบ่งที่ 12:00 (ท่อนแรกจบที่ 720 ไม่ใช่ 719) แล้วรวม — แถวรวมเท่าทุกเหตุการณ์ เรียงใหม่ไปเก่าเหมือนไม่แบ่ง ไม่ซ้ำ ไม่ตก', async () => {
  const events = [...many(0, 600, 1, 'a'), ...many(720, 1320, 1, 'b')]; // 1200 แถว > 500 · มีแถวที่ 11:59 และ 12:00 ติดรอยต่อ
  const p = fakePage(events, 500);
  const t = await fetchSplitTable({ ...OPTS, rowCap: 500, fetchWindow: p.fetchWindow });
  assert.deepEqual(p.calls[1], [0, 720]);
  assert.equal(t.length - 1, 1200);
  const times = t.slice(1).map((r) => r[2]!);
  assert.deepEqual(times, [...times].sort().reverse()); // ใหม่ไปเก่า
  assert.equal(new Set(t.slice(1).map((r) => r[4])).size, 1200); // ไม่ซ้ำ
});

test('ชนซ้อนหลายชั้น: ครึ่งวันแรกชนอีก → แบ่งต่อ · ช่วงที่ไม่ชนไม่ถูกดึงซ้ำ', async () => {
  const events = [...many(0, 100, 6, 'x'), ...many(800, 810, 1, 'y')]; // 600 แถวในชั่วโมงแรก ๆ ของวัน
  const p = fakePage(events, 500);
  const t = await fetchSplitTable({ ...OPTS, rowCap: 500, fetchWindow: p.fetchWindow });
  assert.equal(t.length - 1, 610);
  assert.deepEqual(p.calls[0], [0, 1440]);
  assert.deepEqual(p.calls[1], [0, 720]);
  assert.deepEqual(p.calls[2], [0, 360]);
  const seen = p.calls.map((c) => c.join('-'));
  assert.equal(new Set(seen).size, seen.length); // ไม่ดึงช่วงเดิมซ้ำ
});

test('🔴 ช่วงเล็กสุด 1 ชั่วโมงยังชนเพดาน = ล้มดัง ๆ บอกช่วงเวลาและจำนวนแถว ไม่มีเนื้อแถว', async () => {
  const p = fakePage(many(120, 180, 9, 'secret-'), 500); // 540 แถวในชั่วโมงเดียว (02:00–03:00)... ทั้งสองชั่วโมง
  await assert.rejects(fetchSplitTable({ ...OPTS, rowCap: 500, fetchWindow: p.fetchWindow }), (e: Error) => {
    assert.ok(e instanceof ScrapeError);
    assert.match(e.message, /02:00/);
    assert.match(e.message, /03:00/);
    assert.match(e.message, /500/);
    assert.doesNotMatch(e.message, /secret-|Reservation/);
    return true;
  });
});

test('ทั้งวัน 0 แถวคืนตารางที่มีแต่หัว (ให้ด่าน 0 แถว = ล้ม ทำงานต่อที่ปลายทาง) · ช่วงย่อยที่ว่างไม่ทำให้ล้ม', async () => {
  const empty = await fetchSplitTable({ ...OPTS, rowCap: 500, fetchWindow: fakePage([], 500).fetchWindow });
  assert.deepEqual(empty, [HEADER]);
  const t = await fetchSplitTable({ ...OPTS, rowCap: 500, fetchWindow: fakePage(many(800, 1000, 3), 500).fetchWindow }); // ครึ่งวันแรกว่าง
  assert.equal(t.length - 1, 600);
});

test('🔴 หน้าเว็บคืนแถวนอกช่วงที่ขอ (ฟิลเตอร์ไม่ทำงาน/รอยต่อรั่ว) = ล้ม ไม่ปล่อยให้ซ้ำเงียบ ๆ', async () => {
  const leaky = async (start: number, end: number) => (start === 0 && end === 1440 ? [HEADER, ...many(0, 600, 1)] : [HEADER, ev(end, 0, 'leak')]);
  await assert.rejects(fetchSplitTable({ ...OPTS, rowCap: 500, fetchWindow: leaky }), /นอกช่วง/);
});

test('หัวตารางผิดในช่วงใดช่วงหนึ่ง = ล้ม', async () => {
  const bad = async (start: number) => (start === 0 && bad.n++ === 0 ? [HEADER, ...many(0, 600, 1)] : [['x'], ev(1)]);
  bad.n = 0;
  await assert.rejects(fetchSplitTable({ ...OPTS, rowCap: 500, fetchWindow: bad }), /หัวตาราง/);
});
