import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "ยอดขายตามกลุ่ม" — #17 ในสเปกต้นทาง, toolbar B, `/th/salebygroup`
 *
 * มี tab strip (สเปกต้นทาง §6.4: ทั้งหมด · คิดรายได้ · ไม่คิดรายได้) — ยืนยันจริง 2026-09-25/26
 * ว่า default tab คือ "ทั้งหมด" จริง — ใช้ default ตรง ๆ ไม่วนทุก tab
 *
 * โครงไฟล์เหมือน `salebysumdate` (แถว 0 = ชื่อ, แถว 1 = header, แถวสรุป "Total")
 */
export const salebygroup: Report = {
  id: 'salebygroup',
  label: 'ยอดขายตามกลุ่ม',
  path: '/th/salebygroup',
  // toolbar B → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-25/26 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  // 🔴 เหมือน expectedColumns ของ salebycategory.ts เป๊ะ ยกเว้นตัดคอลัมน์แรก "หมวดสินค้า" ออก —
  // ยืนยันจากไฟล์จริงแล้วว่าไม่ใช่ copy-paste พลาด (รายงานนี้ไม่มีมิติหมวดสินค้าให้จริง ๆ)
  expectedColumns: [
    'กลุ่ม', 'ต้นทุนเฉลี่ย', 'ราคาขายเฉลี่ย', 'จำนวนการขาย', 'ยอดก่อนลด', 'ส่วนลดสินค้า',
    'ยอดรวม ยอดก่อนลด - ส่วนลดสินค้า', 'ต้นทุน ต้นทุนเฉลี่ย x จำนวนการขาย',
    'กำไร ยอดรวม - ต้นทุน - ส่วนลด', 'กำไรเฉลี่ย กำไร / จำนวนการขาย', 'สาขา',
  ],
  headerRowIndex: 1,
};
