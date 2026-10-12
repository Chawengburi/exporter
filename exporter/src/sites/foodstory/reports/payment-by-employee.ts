import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "การชำระเงินตามพนักงาน" — #29 ในสเปกต้นทาง, toolbar B, `/th/payment_by_employee`
 *
 * 🔴 ยืนยันจริง 2026-09-27: รายงานที่ทำให้เจอบั๊ก race condition ใหม่ใน `waitForReady()` —
 * overlay "Processing…" หายก่อนที่ข้อความ "Showing ..." จะอัปเดตเป็นค่าใหม่จริง (ค้างค่าเก่าไว้
 * สั้น ๆ แต่ตรงกับ pattern พอดี) ทำให้ `selectShowNRows` ดูเหมือนสำเร็จแต่จำนวนแถวจริงยังเป็นค่า
 * เก่า (25 แทนที่จะเป็น 230) แก้แล้วด้วยการ debounce ใน `waitForReady()` (ต้องอ่านค่าเดิมซ้ำกัน
 * 2 ครั้งก่อนเชื่อว่านิ่งจริง — ดู comment ใน interactions.ts) แก้เป็นการทั่วไป ไม่ใช่เฉพาะรายงานนี้
 *
 * โครงไฟล์เหมือน `salebysumdate` (แถว 0 = ชื่อ, แถว 1 = header, แถวสรุป "Total")
 */
export const paymentByEmployee: Report = {
  id: 'payment_by_employee',
  label: 'การชำระเงินตามพนักงาน',
  path: '/th/payment_by_employee',
  // toolbar B → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-27 (unzip ตรง ๆ, หลังแก้บั๊ก debounce) — ต่างจากนี้แปลว่ารายงาน
  // เปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: ['ชื่อ-นามสกุล', 'ชื่อเมนู', 'ราคา', 'จำนวน', 'ยอดรวม ยอดก่อนลด - ส่วนลดสินค้า', 'สาขา'],
  headerRowIndex: 1,
};
