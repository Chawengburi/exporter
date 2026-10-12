import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "ยอดขายตามสินค้า" — #12 ในสเปกต้นทาง, toolbar B, `/th/salebyproduct`
 *
 * มี tab strip (สเปกต้นทาง §6.4: ทั้งหมด · คิดรายได้ · ไม่คิดรายได้) — ยืนยันจริง 2026-09-25/26
 * ว่า default tab คือ "ทั้งหมด" จริง — ใช้ default ตรง ๆ ไม่วนทุก tab (ตามที่ตกลงไว้ ticket 04)
 *
 * โครงไฟล์เหมือน `salebysumdate` (แถว 0 = ชื่อ, แถว 1 = header, แถวสรุป "Total")
 */
export const salebyproduct: Report = {
  id: 'salebyproduct',
  label: 'ยอดขายตามสินค้า',
  path: '/th/salebyproduct',
  // toolbar B → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-25/26 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'รหัสสินค้า', 'ชื่อสินค้า', 'กลุ่ม', 'หมวดสินค้า', 'ต้นทุนเฉลี่ย', 'ราคาขายเฉลี่ย',
    'จำนวนการขาย', 'ยอดก่อนลด', 'ต้นทุน ต้นทุนเฉลี่ย x จำนวนการขาย', 'ส่วนลดสินค้า', 'ราคาสุทธิ',
    'กำไร ยอดรวม - ต้นทุน - ส่วนลด', 'กำไรเฉลี่ย กำไร / จำนวนการขาย', 'สาขา',
  ],
  headerRowIndex: 1,
};
