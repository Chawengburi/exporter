import type { ShowingInfo } from './interactions.ts';
import type { FoodStorySheet } from './xlsx.ts';

export class VerifyError extends Error {
  override readonly name = 'VerifyError';
}

/**
 * เทียบจำนวนแถวในไฟล์ที่ดาวน์โหลดจริงกับตัวเลขที่หน้าเว็บบอก (`Showing X to Y of Z entries`)
 * ตามสเปกต้นทาง §8.2 — มิสแมตช์ = ข้อมูลถูกตัด สาเหตุที่พบบ่อยที่สุดตามสเปกคือลืมเปลี่ยน
 * `Show N rows` ก่อนกด export (ค่าเริ่มต้น 25 แถว)
 */
export function verifyRowCount(sheet: FoodStorySheet, showing: ShowingInfo): void {
  if (sheet.rows.length !== showing.total) {
    throw new VerifyError(
      `จำนวนแถวในไฟล์ (${sheet.rows.length}) ไม่ตรงกับที่หน้าเว็บบอก (${showing.total})\n` +
        `  ไฟล์อาจถูกตัด — สาเหตุที่พบบ่อยสุด: ลืมเปลี่ยน "Show N rows" ก่อน export`,
    );
  }
}
