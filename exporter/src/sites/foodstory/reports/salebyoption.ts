import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "ยอดขายตามตัวเลือก" — #18 ในสเปกต้นทาง, toolbar A, `/th/salebyoption`
 * โครงไฟล์เหมือน `salebysumdate` (แถว 0 = ชื่อ, แถว 1 = header, แถวสรุป "Total")
 */
export const salebyoption: Report = {
  id: 'salebyoption',
  label: 'ยอดขายตามตัวเลือก',
  path: '/th/salebyoption',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-25/26 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'ชื่อสินค้า', 'ชื่อกลุ่มตัวเลือก', 'ชื่อตัวเลือก', 'จำนวนการขาย', 'ราคาขาย', 'ต้นทุนเฉลี่ย',
    'ราคาขายรวม', 'ราคาต้นทุนรวม', 'กำไร ยอดรวม - ต้นทุน - ส่วนลด', 'สาขา',
  ],
  headerRowIndex: 1,
};
