import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "การทำงานของพนักงาน" — #52 ในสเปกต้นทาง, toolbar A, `/th/employee`
 *
 * 🔴 ไม่มีตัวกรองวันที่จริง (`.carlendar-force` มี class `hide`) — ยืนยันจริง 2026-09-26 เหมือน
 * ทุกใบในกลุ่มที่เหลือของ ticket 10 — ไม่มี concept เทียบเท่า `dailyOnly` — เหตุผลเต็มดู
 * `costbyproduct.ts` (ticket 06) — รายงานนี้ดูเป็น master data สิทธิ์การใช้งานของพนักงาน
 * ไม่ใช่ log เหตุการณ์ตามวัน (ต่างจาก `working.ts` ที่ฟังดู transactional กว่าแต่ก็ไม่มีตัวกรอง
 * วันที่เหมือนกัน)
 *
 * โครงไฟล์เหมือน `salebysumdate` (แถว 0 = ชื่อ, แถว 1 = header, แถวสรุป "Total")
 */
export const employee: Report = {
  id: 'employee',
  label: 'การทำงานของพนักงาน',
  path: '/th/employee',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-26 (unzip ตรง ๆ) — 2 แถวข้อมูล ตรงกับ "Showing 1 to 2 of 2 entries"
  // เป๊ะ — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'ชื่อ-นามสกุล', 'แก้ไขโปรโมชั่น', 'แก้ไขรูปแบบโต๊ะ', 'แก้ไขเทมเพลตเมนู', 'เปิดบิล', 'ส่งรายการ',
    'จ่ายเงิน', 'เปิดบิลอีกครั้ง', 'ยกเลิกรายการ', 'เปิดลิ้นชักด้วยตนเอง', 'รวม', 'สาขา',
  ],
  headerRowIndex: 1,
};
