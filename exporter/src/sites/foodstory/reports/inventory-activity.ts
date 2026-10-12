import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "การทำรายการ" — #34 ในสเปกต้นทาง, toolbar A, `/th/inventory/activity`
 *
 * 🔴 ไม่มีตัวกรองวันที่จริง (`.carlendar-force` มี class `hide`) — เหมือนทั้งกลุ่มของ ticket นี้
 * แม้ชื่อจะฟังดูเป็นรายการปฏิบัติการ (transactional) ก็ตาม ไม่มี concept เทียบเท่า `dailyOnly`
 * เหตุผลเต็มดู `costbyproduct.ts` (ticket 06)
 *
 * โครงไฟล์เหมือน `salebysumdate` (แถว 0 = ชื่อ, แถว 1 = header, แถวสรุป "Total")
 */
export const inventoryActivity: Report = {
  id: 'activity',
  label: 'การทำรายการ',
  path: '/th/inventory/activity',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-27 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: ['วันที่', 'เวลา', 'เหตุการณ์', 'ผู้ลงบันทึก', 'หมายเหตุ', 'สาขา'],
  headerRowIndex: 1,
};
