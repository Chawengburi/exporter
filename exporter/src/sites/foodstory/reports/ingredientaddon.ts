import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "ส่วนผสมตัวเลือก" — #24 ในสเปกต้นทาง, toolbar A, `/th/ingredientaddon`
 * ไม่มี concept เทียบเท่า `dailyOnly` — ดูเหตุผลเต็มใน `costbyproduct.ts`
 * โครงไฟล์เหมือน `salebysumdate` (แถว 0 = ชื่อ, แถว 1 = header, แถวสรุป "Total")
 */
export const ingredientaddon: Report = {
  id: 'ingredientaddon',
  label: 'ส่วนผสมตัวเลือก',
  path: '/th/ingredientaddon',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-26 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'หมวดหมู่', 'ชื่อสินค้า', 'รหัส', 'ราคา', 'กลุ่มตัวเลือก', 'แอดออน', 'ชื่อสินค้าคงคลัง',
    'รหัสสินค้าคงคลัง', 'ป้ายสินค้าคงคลัง', 'ราคาต่อหน่วย', 'หน่วยหลัก', 'ปริมาณที่ใช้',
    'ปริมาณที่ใช้ตอนตัดสต็อค', 'หน่วยตัดสต็อค', 'ต้นทุนส่วนผสม', 'ค่าแปลงหน่วย', 'สาขา',
  ],
  headerRowIndex: 1,
};
