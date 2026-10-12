import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "ยอดขายรวมตามวัน" — #6 ในสเปกต้นทาง, toolbar B, `/th/salebysumdate`
 *
 * รายงานนำร่องของ ticket 02 — พิสูจน์ว่า primitives ของ interactions.ts ใช้งานได้จริงทั้งชุด
 * ไม่ใช่แค่ประกอบท่อไว้เฉย ๆ โครงสร้างไฟล์และ header ยืนยันจริงจากการดาวน์โหลด 2026-09-23
 * (ดู test/foodstory-xlsx.test.ts — unzip ตรง ๆ ยืนยัน 17 คอลัมน์ ไม่ใช่ 3 คอลัมน์แบบที่เดาไว้
 * ตอนแรกจากการอ่านผ่าน readSheet() เดิมที่ยังมีบั๊ก — ดู ticket 02 §Comments)
 */
export const salebysumdate: Report = {
  id: 'salebysumdate',
  label: 'ยอดขายรวมตามวัน',
  path: '/th/salebysumdate',
  // toolbar B → ปุ่มข้อความ "Excel" (ต่างจาก toolbar C/D ที่เป็น "Export Excel")
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-23 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'วันที่', 'ยอดก่อนลด', 'ส่วนลดสินค้า', 'ส่วนลดบิล', 'ยอดรวม ยอดก่อนลด - ส่วนลดสินค้า',
    'ค่าบริการ', 'ยอดก่อนภาษี ยอดรวม + ค่าบริการ', 'ภาษี',
    'มูลค่า Voucher มูลค่า Voucher มีโอกาสที่จะมากกว่ายอดรวมทั้งบิล ส่วนลดที่ใช้ได้สูงสุดจึงเป็นยอดรวมของบิล',
    'ส่วนลด Voucher', 'ยอดปัดเศษ', 'ค่าจัดส่ง',
    'รวมสุทธิ (ยอดก่อนภาษี + ภาษี +  ยอดปัดเศษ) -  ยอดขายสินค้าไม่มีภาษี', 'ทิป', 'คืนเงิน',
    'จำนวนบิล', 'สาขา',
  ],
  headerRowIndex: 1,
};
