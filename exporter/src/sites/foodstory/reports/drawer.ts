import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "สรุปข้อมูลรอบการขาย (ถาดเก็บเงิน)" — #47 ในสเปกต้นทาง, toolbar A, `/th/drawer`
 *
 * 🔴 ไม่มีตัวกรองวันที่จริง (`.carlendar-force` มี class `hide`) — ยืนยันจริง 2026-09-26 เหมือน
 * ทุกใบในกลุ่มที่เหลือของ ticket 10 — ไม่มี concept เทียบเท่า `dailyOnly` — เหตุผลเต็มดู
 * `costbyproduct.ts` (ticket 06)
 *
 * โครงไฟล์เหมือน `salebysumdate` (แถว 0 = ชื่อ, แถว 1 = header, แถวสรุป "Total")
 */
export const drawer: Report = {
  id: 'drawer',
  label: 'สรุปข้อมูลรอบการขาย (ถาดเก็บเงิน)',
  path: '/th/drawer',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-26 (unzip ตรง ๆ) — 30 แถวข้อมูล ตรงกับ "Showing 1 to 30 of 30
  // entries" เป๊ะ — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'เวลาเริ่ม', 'ผู้เปิด', 'เวลาจบ', 'ผู้ปิด', 'รหัสถาดเก็บเงิน', 'จำนวนเงินเริ่มต้น', 'เงินสด',
    'การคืนเงิน', 'จ่ายเข้า/จ่ายออก', 'จำนวนประมาณในถาดเก็บเงิน', 'จำนวนในถาดเก็บเงิน', 'ส่วนต่าง',
    'สาขา',
  ],
  headerRowIndex: 1,
};
