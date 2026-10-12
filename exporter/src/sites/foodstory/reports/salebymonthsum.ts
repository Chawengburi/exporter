import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_PERIOD_FILTER, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "ยอดขายรวมตามเดือน" — #7 ในสเปกต้นทาง, toolbar B, `/th/salebymonthsum`
 *
 * ไม่มีตัวกรองวันที่เลย — ใช้ปี selector แทน (สเปกต้นทาง §5.1) ตารางมี 1 แถวต่อเดือนอยู่แล้ว
 * export ครั้งเดียวครอบทั้งปีได้ ผู้เรียก (runner) ต้องเรียก
 * `interactions.ts::setPeriodFilter(page, allowedControls, id, { year })` เองก่อนดึงข้อมูล —
 * ไม่ใช่ method ของ Report object นี้ (เหมือน `setDateRangeByTyping` ที่ไม่ใช่ method ของ Report
 * เช่นกัน แต่ต่างตรงที่ตัวนี้ต้องผ่าน gate เพราะเป็นการกระทำระดับรายงาน ไม่ใช่ session)
 *
 * ยืนยันจริง 2026-09-26: `setPeriodFilter({year: 2026})` คืนข้อมูล 3 เดือนจริง (กรกฎาคม/
 * สิงหาคม/กันยายน) ตัวเลขเดือนสิงหาคมตรงกับที่สเปกต้นทาง §8 ข้อ 4 อ้างไว้เป๊ะ (฿1,332,985)
 */
export const salebymonthsum: Report = {
  id: 'salebymonthsum',
  label: 'ยอดขายรวมตามเดือน',
  path: '/th/salebymonthsum',
  // toolbar B → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [
    CONTROL_DISMISS_INTERSTITIAL,
    CONTROL_PERIOD_FILTER,
    CONTROL_SHOW_N_ROWS,
    CONTROL_EXCEL_BUTTON,
  ],
  // ยืนยันจากไฟล์จริง 2026-09-26 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'เดือน', 'ยอดก่อนลด', 'ส่วนลดสินค้า', 'ส่วนลดบิล', 'ยอดรวม ยอดก่อนลด - ส่วนลดสินค้า',
    'ค่าบริการ', 'ยอดขายสินค้าไม่มีภาษี', 'ยอดก่อนภาษี ยอดรวม + ค่าบริการ', 'ภาษี',
    'มูลค่า Voucher มูลค่า Voucher มีโอกาสที่จะมากกว่ายอดรวมทั้งบิล ส่วนลดที่ใช้ได้สูงสุดจึงเป็นยอดรวมของบิล',
    'ส่วนลด Voucher', 'ยอดปัดเศษ', 'ค่าจัดส่ง',
    'รวมสุทธิ (ยอดก่อนภาษี + ภาษี +  ยอดปัดเศษ) -  ยอดขายสินค้าไม่มีภาษี', 'ทิป', 'คืนเงิน',
    'จำนวนบิล', 'สาขา',
  ],
  headerRowIndex: 1,
};
