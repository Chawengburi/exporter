import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "จำนวนสินค้าในคลัง" — #30 ในสเปกต้นทาง, toolbar A, `/th/inventory/current_stock`
 * สเปกต้นทางระบุว่าเป็น "Snapshot, ~445 rows" — ยืนยันจริง 2026-09-27 (435 แถว)
 *
 * 🔴 **ไม่มีตัวกรองวันที่จริง แม้จะดูเหมือนมีจากภายนอก** — ยืนยันจริงว่า container ของ
 * date-range widget (`.carlendar-force`) มี class `hide` ติดอยู่จริงบนหน้านี้ (ซ่อนไว้โดยเจตนา)
 * ทำให้ `setDateRangeByTyping` หา trigger ที่ "ใช้งานได้จริง" ไม่เจอ (เจอแต่ `<input>` ที่ซ่อนอยู่
 * ผ่าน fallback scan แล้วคลิกไม่ได้เพราะไม่ visible — พังแบบมีความหมาย ไม่ใช่ primitive บกพร่อง)
 * ไม่มี concept เทียบเท่า `dailyOnly` เหมือนกัน — เหตุผลเต็มดู `costbyproduct.ts` (ticket 06)
 *
 * โครงไฟล์เหมือน `salebysumdate` (แถว 0 = ชื่อ, แถว 1 = header, แถวสรุป "Total")
 */
export const currentStock: Report = {
  id: 'current_stock',
  label: 'จำนวนสินค้าในคลัง',
  path: '/th/inventory/current_stock',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-27 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'ชื่อ', 'รหัสวัตถุดิบ', 'ป้ายกำกับ', 'จำนวนของในสต็อก', 'จำนวนสูงสุดของสต็อก', 'ส่วนต่าง',
    'หน่วย', 'ราคาต่อหน่วย', 'มูลค่าสินค้าในสต๊อก', 'สาขา',
  ],
  headerRowIndex: 1,
};
