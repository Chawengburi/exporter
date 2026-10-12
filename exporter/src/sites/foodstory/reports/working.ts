import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "ชั่วโมงการทำงาน" — #53 ในสเปกต้นทาง, toolbar A, `/th/working`
 *
 * 🔴 ไม่มีตัวกรองวันที่จริง (`.carlendar-force` มี class `hide`) — ยืนยันจริง 2026-09-26 เหมือน
 * ทุกใบในกลุ่มที่เหลือของ ticket 10 — ไม่มี concept เทียบเท่า `dailyOnly` — เหตุผลเต็มดู
 * `costbyproduct.ts` (ticket 06) แม้ข้อมูลจะมีคอลัมน์ "วันที่"/"เวลาเข้างาน" ก็เป็นแค่ข้อมูล
 * ไม่ใช่ตัวกรอง
 *
 * ยืนยันจริง 2026-09-26: ว่างเปล่า (0 แถวข้อมูล) ในบัญชีทดสอบนี้ — ตรงกับสเปกต้นทาง §6.5
 * ("staff hours" อยู่ในลิสต์ 14 รายงานที่ว่างเปล่าในรอบมือจริง)
 */
export const working: Report = {
  id: 'working',
  label: 'ชั่วโมงการทำงาน',
  path: '/th/working',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-26 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: ['วันที่', 'ชื่อพนักงาน', 'เวลาเข้างาน', 'เวลาออกงาน', 'ชั่วโมงการทำงาน', 'สาขา'],
  headerRowIndex: 1,
};
