import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "ยอดขายตามรอบการขาย" — #5 ในสเปกต้นทาง, toolbar B, `/th/salebydate`
 *
 * โครงไฟล์เหมือน `salebysumdate` เป๊ะ (แถว 0 = ชื่อ, แถว 1 = header, แถวสรุปท้าย "Total" อังกฤษ)
 * ไม่มีแถวลอย ๆ แบบ `outputtax`/`fulltaxinvoice` — ยืนยันจริง 2026-09-25/26
 */
export const salebydate: Report = {
  id: 'salebydate',
  label: 'ยอดขายตามรอบการขาย',
  path: '/th/salebydate',
  // toolbar B → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-25/26 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'วันที่', 'รหัสถาดเก็บเงิน', 'ยอดก่อนลด', 'ส่วนลดสินค้า', 'ส่วนลดบิล',
    'ยอดรวม ยอดก่อนลด - ส่วนลดสินค้า', 'ค่าบริการ', 'ยอดก่อนภาษี ยอดรวม + ค่าบริการ', 'ภาษี',
    'ยอดขายสินค้าไม่มีภาษี',
    'มูลค่า Voucher มูลค่า Voucher มีโอกาสที่จะมากกว่ายอดรวมทั้งบิล ส่วนลดที่ใช้ได้สูงสุดจึงเป็นยอดรวมของบิล',
    'ส่วนลด Voucher', 'ยอดปัดเศษ', 'ค่าจัดส่ง',
    'รวมสุทธิ (ยอดก่อนภาษี + ภาษี +  ยอดปัดเศษ) -  ยอดขายสินค้าไม่มีภาษี', 'ทิป', 'คืนเงิน',
    'LINE MAN ยอดปรับยอด', 'จำนวนบิล', 'สาขา',
  ],
  headerRowIndex: 1,
};
