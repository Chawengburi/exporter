import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "รายละเอียดการจ่ายเข้า/ออก" — #48 ในสเปกต้นทาง, toolbar A, `/th/drawer_paid`
 *
 * 🔴 ไม่มีตัวกรองวันที่จริง (`.carlendar-force` มี class `hide`) — ยืนยันจริง 2026-09-26 เหมือน
 * ทุกใบในกลุ่มที่เหลือของ ticket 10 — ไม่มี concept เทียบเท่า `dailyOnly` — เหตุผลเต็มดู
 * `costbyproduct.ts` (ticket 06)
 *
 * โครงไฟล์เหมือน `salebysumdate` (แถว 0 = ชื่อ, แถว 1 = header, แถวสรุป "Total")
 */
export const drawerPaid: Report = {
  id: 'drawer_paid',
  label: 'รายละเอียดการจ่ายเข้า/ออก',
  path: '/th/drawer_paid',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-26 (unzip ตรง ๆ) — 26 แถวข้อมูล ตรงกับ "Showing 1 to 26 of 26
  // entries" เป๊ะ — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: ['เวลา', 'รหัสถาดเก็บเงิน', 'รายละเอียด', 'หมวดหมู่', 'ประเภท', 'จำนวน', 'สาขา'],
  headerRowIndex: 1,
};
