import { splitRange, type DateRange } from './order.ts';

/**
 * ดึงข้อมูลของรายงานที่อาจชนเพดานจำนวนแถว โดยผ่าครึ่งช่วงวันที่ซ้ำจนกว่าแต่ละก้อนจะไม่ชนเพดาน
 * แล้วรวมผลกลับเป็นก้อนเดียว — สรุปมาจาก pattern ที่ HotelTime ใช้กับ ROW_CAP=2000 (ดู
 * `core/order.ts::splitRange`, `sites/hoteltime/export.ts`) ทำให้เป็น generic เพราะกลไก "ชน
 * เพดาน → ผ่าครึ่ง → ดึงใหม่ทั้งสองฝั่ง → รวม" เหมือนกันไม่ว่าจะเพดานเท่าไหร่หรือดึงข้อมูลด้วยวิธีไหน
 * ผู้เรียกส่ง `fetchOne` มาเอง (ผูกกับ Playwright/primitives ของ site นั้น ๆ) ไฟล์นี้ไม่รู้จัก
 * browser เลย
 *
 * 🔴 total === cap พอดีถือว่า "ชนเพดาน" เสมอ (แบบเดียวกับ HotelTime) — แยกไม่ออกจาก "มีข้อมูล
 * พอดี cap แถวจริง ๆ ไม่ได้ชนอะไรเลย" จากภายนอก จึงเลือกทางปลอดภัยไว้ก่อน (ผ่าเพิ่มอีกรอบ
 * เสียเวลานิดหน่อย ดีกว่าเสี่ยงข้อมูลขาดแบบไม่รู้ตัว)
 */
export class RowCapError extends Error {
  override readonly name = 'RowCapError';
}

export type FetchOneResult<T> = {
  readonly total: number;
  readonly rows: readonly T[];
};

export async function fetchWithRowCapSplit<T>(
  range: DateRange,
  cap: number,
  fetchOne: (range: DateRange) => Promise<FetchOneResult<T>>,
): Promise<readonly T[]> {
  const { total, rows } = await fetchOne(range);

  if (total < cap) {
    return rows;
  }

  const split = splitRange(range);
  if (!split) {
    throw new RowCapError(
      `ช่วงเหลือวันเดียวแล้วยังมีข้อมูล ${total} แถว (เพดาน ${cap}) — ผ่าต่อไม่ได้ ต้องแก้ด้วยมือ`,
    );
  }
  const [first, second] = split;
  const firstRows = await fetchWithRowCapSplit(first, cap, fetchOne);
  const secondRows = await fetchWithRowCapSplit(second, cap, fetchOne);
  return [...firstRows, ...secondRows];
}
