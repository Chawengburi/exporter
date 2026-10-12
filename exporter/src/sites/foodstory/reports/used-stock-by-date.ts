import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "การเติมสินค้าเข้าคลัง" — #32 ในสเปกต้นทาง, toolbar A, `/th/inventory/used_stock_by_date`
 *
 * 🔴 ไม่มีตัวกรองวันที่จริง (`.carlendar-force` มี class `hide`) — เหมือนกลุ่ม inventory ทั้งหมด
 * ที่เช็คมาแล้ว (ticket 08) ไม่มี concept เทียบเท่า `dailyOnly` — เหตุผลเต็มดู `costbyproduct.ts`
 * (ticket 06) ชื่อ path มีคำว่า "by_date" แต่ไม่ได้แปลว่ามีตัวกรองวันที่ — เป็นแค่ชื่อ path เดิม
 * ของเว็บ (ข้อมูลในตารางเองมีคอลัมน์ "วันที่"/"วันที่ออก PO" แต่นั่นเป็นข้อมูล ไม่ใช่ตัวกรอง)
 *
 * โครงไฟล์เหมือน `salebysumdate` (แถว 0 = ชื่อ, แถว 1 = header, แถวสรุป "Total")
 */
export const usedStockByDate: Report = {
  id: 'used_stock_by_date',
  label: 'การเติมสินค้าเข้าคลัง',
  path: '/th/inventory/used_stock_by_date',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-26 (unzip ตรง ๆ) — 123 แถวข้อมูล ตรงกับ "Showing 1 to 123 of 123
  // entries" เป๊ะ — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'วันที่', 'ชื่อ', 'รหัสวัตถุดิบ', 'INVOICE', 'ป้ายกำกับ', 'GR', 'ประเภทการเติมวัตถุดิบ', 'หน่วย',
    'เติมสินค้า', 'ค่าใช้จ่ายต่อหน่วย', 'ค่าใช้จ่ายสุทธิ', 'PO', 'วันที่ออก PO', 'สาขา',
  ],
  headerRowIndex: 1,
};
