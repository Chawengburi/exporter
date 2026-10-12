import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "ยอดขายตามการชำระเงิน" — #11 ในสเปกต้นทาง, toolbar A, `/th/pay`
 * โครงไฟล์เหมือน `salebysumdate` (แถว 0 = ชื่อ, แถว 1 = header, แถวสรุป "Total")
 */
export const pay: Report = {
  id: 'pay',
  label: 'ยอดขายตามการชำระเงิน',
  path: '/th/pay',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-25/26 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'ประเภทการชำระเงิน', 'วิธีบันทึกรายการชำระ', 'รหัสชำระเงินแบบกำหนดเอง', 'ยอดก่อนลด',
    'ส่วนลด ส่วนลดสินค้า + ส่วนลดบิล', 'ยอดรวม ยอดก่อนลด - ส่วนลดสินค้า', 'ค่าบริการ',
    'ยอดก่อนภาษี ยอดรวม + ค่าบริการ', 'ภาษี', 'ยอดขายสินค้าไม่มีภาษี',
    'มูลค่า Voucher มูลค่า Voucher มีโอกาสที่จะมากกว่ายอดรวมทั้งบิล ส่วนลดที่ใช้ได้สูงสุดจึงเป็นยอดรวมของบิล',
    'ส่วนลด Voucher', 'ยอดปัดเศษ',
    'รวมสุทธิ (ยอดก่อนภาษี + ภาษี +  ยอดปัดเศษ) -  ยอดขายสินค้าไม่มีภาษี', 'ทิป', 'คืนเงิน', 'สาขา',
  ],
  headerRowIndex: 1,
};
