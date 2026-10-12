import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "รายงานโต๊ะ" — #54 ในสเปกต้นทาง, toolbar A, `/th/table`
 *
 * 🔴 ไม่มีตัวกรองวันที่จริง (`.carlendar-force` มี class `hide`) — ยืนยันจริง 2026-09-26 เหมือน
 * ทุกใบในกลุ่มที่เหลือของ ticket 10 — ไม่มี concept เทียบเท่า `dailyOnly` — เหตุผลเต็มดู
 * `costbyproduct.ts` (ticket 06)
 *
 * โครงไฟล์เหมือน `salebysumdate` (แถว 0 = ชื่อ, แถว 1 = header, แถวสรุป "Total")
 */
export const table: Report = {
  id: 'table',
  label: 'รายงานโต๊ะ',
  path: '/th/table',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-26 (unzip ตรง ๆ) — 764 แถวข้อมูล ตรงกับ "Showing 1 to 764 of 764
  // entries" เป๊ะ — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'วัน', 'โต๊ะ', 'จำนวนการเปิดโต๊ะ', 'จำนวนลูกค้าเฉลี่ย', 'เวลาเฉลี่ย', 'จำนวนเมนูเฉลี่ย',
    'อัตราการจองสำเร็จ', 'ชื่อสาขา',
  ],
  headerRowIndex: 1,
};
