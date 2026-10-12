import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "การสั่งกลุ่มตัวเลือก" — #26 ในสเปกต้นทาง, toolbar A, `/th/option`
 * โครงไฟล์เหมือน `salebysumdate` (แถว 0 = ชื่อ, แถว 1 = header, แถวสรุป "Total")
 */
export const option: Report = {
  id: 'option',
  label: 'การสั่งกลุ่มตัวเลือก',
  path: '/th/option',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-27 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: ['กลุ่ม', 'หมวดสินค้า', 'ชื่อสินค้า', 'ชื่อตัวเลือก', 'จำนวนการขาย', 'สาขา'],
  headerRowIndex: 1,
};
