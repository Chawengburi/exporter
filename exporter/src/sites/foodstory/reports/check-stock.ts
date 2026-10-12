import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "ตรวจสอบสินค้า" — #33 ในสเปกต้นทาง, toolbar A, `/th/inventory/check_stock`
 *
 * 🔴 ไม่มีตัวกรองวันที่จริงเหมือนกับทั้งกลุ่ม #30/#33-37/#40 ของ ticket นี้ — ยืนยันจริงว่า
 * `.carlendar-force` มี class `hide` บนหน้านี้ (แม้จะมีคอลัมน์ "วันที่ตรวจนับ" ในข้อมูลเอง ก็เป็น
 * แค่ข้อมูล ไม่ใช่ตัวกรอง) ไม่มี concept เทียบเท่า `dailyOnly` — เหตุผลเต็มดู `costbyproduct.ts`
 * (ticket 06)
 *
 * โครงไฟล์เหมือน `salebysumdate` (แถว 0 = ชื่อ, แถว 1 = header, แถวสรุป "Total")
 */
export const checkStock: Report = {
  id: 'check_stock',
  label: 'ตรวจสอบสินค้า',
  path: '/th/inventory/check_stock',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-27 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'วันที่ตรวจนับ', 'เวลาตรวจนับ', 'ชื่อ', 'รหัสวัตถุดิบ', 'ป้ายกำกับ', 'หน่วย', 'ราคาต่อหน่วย',
    'คงเหลือ', 'จำนวนที่ตรวจนับ', 'ค่าคาดเคลื่อน', 'ส่วนต่าง', 'ผู้ตรวจนับ', 'สาขา',
  ],
  headerRowIndex: 1,
};
