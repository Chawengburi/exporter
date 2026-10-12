import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "ยอดเคลม LINE MAN" — #20 ในสเปกต้นทาง, toolbar A, `/th/sale/claim`
 *
 * สเปกต้นทางเตือนไว้ว่างเปล่าถ้า LINE MAN ไม่ได้เปิดใช้งาน — ยืนยันจริง 2026-09-25/26: ว่างจริง
 * (`Showing 0 to 0 of 0`) ดาวน์โหลดได้ header-only file จริง ไม่ error โครงไฟล์เหมือน
 * `salebysumdate` (แถว 0 = ชื่อ, แถว 1 = header, แถวสรุป "Total") ต่างแค่ค่าในแถวสรุปมีสัญลักษณ์
 * "฿" นำหน้า (เช่น "฿0.00") ซึ่งไม่กระทบ parsing เพราะอ่านเป็น string ดิบอยู่แล้ว
 */
export const saleClaim: Report = {
  id: 'sale-claim',
  label: 'ยอดเคลม LINE MAN',
  path: '/th/sale/claim',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-25/26 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'วันที่สร้างออเดอร์', 'หมายเลขใบเสร็จ / ID', 'ยอดรวมสุทธิ (ก่อนปรับยอด)', 'วันที่ปรับยอด',
    'ยอดรวมสุทธิ (หลังปรับยอด)', 'สถานะ/หมายเหตุ', 'รหัสถาดเก็บเงิน', 'สาขา',
  ],
  headerRowIndex: 1,
};
