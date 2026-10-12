import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "การสั่งตามพนักงาน" — #28 ในสเปกต้นทาง, toolbar A, `/th/order_by_employee`
 * โครงไฟล์เหมือน `salebysumdate` (แถว 0 = ชื่อ, แถว 1 = header, แถวสรุป "Total")
 */
export const orderByEmployee: Report = {
  id: 'order_by_employee',
  label: 'การสั่งตามพนักงาน',
  path: '/th/order_by_employee',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-27 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'ชื่อ-นามสกุล', 'หมวดหมู่', 'ชื่อเมนู', 'ราคา', 'จำนวน',
    'ยอดรวม ยอดก่อนลด - ส่วนลดสินค้า', 'สาขา',
  ],
  headerRowIndex: 1,
};
