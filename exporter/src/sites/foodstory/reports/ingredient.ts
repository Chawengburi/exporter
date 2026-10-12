import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "ส่วนผสม" — #23 ในสเปกต้นทาง, toolbar A, `/th/ingredient`
 *
 * ไม่มี concept เทียบเท่า `dailyOnly` — ดูเหตุผลเต็มใน `costbyproduct.ts`
 *
 * 🔴 รายงานที่ใหญ่ที่สุดที่เจอมาในทุก ticket — 1,097 แถวข้อมูลจริง (2026-09-26) และเป็นตัวที่ทำให้
 * เจอบั๊กจริงใน `interactions.ts::parseShowingText()`: ตัวเลขที่มากกว่า 999 ถูก DataTables คั่น
 * หลักพันด้วย comma ("Showing 1 to 25 of 1,097 entries") ซึ่ง regex เดิม (`\d+` ตรง ๆ) จับไม่ได้
 * เลย ทำให้ `waitForReady` timeout ทุกครั้งสำหรับรายงานที่มีแถวเกินพัน แก้แล้ว (ดู
 * `test/foodstory-interactions.test.ts`) — รายงานอื่นทั้งหมดที่ทำมาก่อนหน้านี้ไม่เคยมีแถวถึงพัน
 * เลยไม่เคยเจอบั๊กนี้มาก่อน
 */
export const ingredient: Report = {
  id: 'ingredient',
  label: 'ส่วนผสม',
  path: '/th/ingredient',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-26 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'หมวดหมู่', 'ชื่อสินค้า', 'รหัส', 'ราคา', 'ชื่อส่วนผสม', 'ชื่อสินค้าคงคลัง', 'รหัสสินค้าคงคลัง',
    'ป้ายสินค้าคงคลัง', 'ราคาต่อหน่วย', 'หน่วยหลัก', 'ปริมาณที่ใช้', 'ปริมาณที่ใช้ตอนตัดสต็อค',
    'หน่วยตัดสต็อค', 'ต้นทุนส่วนผสม', 'ค่าแปลงหน่วย', 'สาขา',
  ],
  headerRowIndex: 1,
};
