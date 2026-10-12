import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDMY, type DateRange } from '../src/core/order.ts';
import { fetchWithRowCapSplit, RowCapError } from '../src/core/rowcap.ts';

const R = (a: string, b: string): DateRange => ({ from: parseDMY(a), to: parseDMY(b) });

/** จำลองข้อมูล: N แถวต่อวัน กระจายเท่า ๆ กันตลอดช่วง ให้ fetchOne คืนเฉพาะแถวที่ "โดนตัด" เมื่อชนเพดาน */
function makeFetcher(rowsPerDay: number, cap: number) {
  let calls = 0;
  const fetchOne = async (range: DateRange) => {
    calls += 1;
    const days = Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000) + 1;
    const total = days * rowsPerDay;
    const rows = Array.from({ length: Math.min(total, cap) }, (_, i) => `${range.from.toISOString()}-${i}`);
    return { total, rows };
  };
  return { fetchOne, callCount: () => calls };
}

test('ไม่ชนเพดาน — คืนแถวจาก fetchOne ครั้งเดียวตรง ๆ', async () => {
  const { fetchOne, callCount } = makeFetcher(10, 5000); // 10 แถว/วัน x 30 วัน = 300 < 5000
  const rows = await fetchWithRowCapSplit(R('01/01/2025', '30/01/2025'), 5000, fetchOne);
  assert.equal(rows.length, 300);
  assert.equal(callCount(), 1);
});

test('🔴 ชนเพดานพอดี (total === cap) ถือว่าชนเสมอ — ต้องผ่าเพิ่มแม้ข้อมูลจะครบพอดี', async () => {
  const { fetchOne, callCount } = makeFetcher(100, 5000); // 100 แถว/วัน x 50 วัน = 5000 พอดี
  const rows = await fetchWithRowCapSplit(R('01/01/2025', '19/02/2025'), 5000, fetchOne);
  // ต้องได้ครบ 5000 แถว (ผ่านการผ่าครึ่งแล้วรวมกลับ) ไม่ใช่แค่ 5000 แถวแรกที่ถูกตัดจาก fetchOne เดียว
  assert.equal(rows.length, 5000);
  assert.ok(callCount() > 1, 'ต้องเรียก fetchOne มากกว่า 1 ครั้งเพราะชนเพดานพอดี');
});

test('🔴 ชนเพดานจริง (total > cap) ผ่าครึ่งซ้ำจนครบ ไม่ขาดไม่ซ้ำ', async () => {
  const { fetchOne } = makeFetcher(200, 5000); // 200 แถว/วัน x 30 วัน = 6000 > 5000
  const rows = await fetchWithRowCapSplit(R('01/01/2025', '30/01/2025'), 5000, fetchOne);
  assert.equal(rows.length, 6000);
  // ไม่ซ้ำ: ทุกแถวต้อง unique (สร้างจาก range.from + index จึงไม่ชนกันข้ามก้อน)
  assert.equal(new Set(rows).size, 6000);
});

test('🔴 ผ่าจนเหลือวันเดียวแล้วยังชนเพดาน — ล้มดัง ๆ ไม่เงียบ', async () => {
  const { fetchOne } = makeFetcher(10_000, 5000); // วันเดียวก็เกินเพดานแล้ว
  await assert.rejects(
    () => fetchWithRowCapSplit(R('01/01/2025', '01/01/2025'), 5000, fetchOne),
    (err: unknown) => err instanceof RowCapError && /ผ่าต่อไม่ได้/.test((err as Error).message),
  );
});

test('ช่วงวันเดียวที่ไม่ชนเพดานทำงานปกติ (ไม่ผ่าเลย)', async () => {
  const { fetchOne, callCount } = makeFetcher(50, 5000);
  const rows = await fetchWithRowCapSplit(R('15/06/2025', '15/06/2025'), 5000, fetchOne);
  assert.equal(rows.length, 50);
  assert.equal(callCount(), 1);
});
