import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "ยอดขายตามสินค้ารายชั่วโมง" — #13 ในสเปกต้นทาง, toolbar A, `/th/salebyproducthourly`
 *
 * คอลัมน์ 00:00-23:00 คือยอดขายแยกตามชั่วโมงของวัน (24 คอลัมน์) ไม่ใช่ timestamp — เป็นชื่อ
 * คอลัมน์ literal ตามที่เว็บส่งมาจริง
 *
 * โครงไฟล์เหมือน `salebysumdate` (แถว 0 = ชื่อ, แถว 1 = header, แถวสรุป "Total")
 */
export const salebyproducthourly: Report = {
  id: 'salebyproducthourly',
  label: 'ยอดขายตามสินค้ารายชั่วโมง',
  path: '/th/salebyproducthourly',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-25/26 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'รหัสสินค้า', 'ชื่อสินค้า', 'กลุ่ม', 'หมวดสินค้า', 'ต้นทุน ต้นทุนเฉลี่ย x จำนวนการขาย',
    'กำไรเฉลี่ย กำไร / จำนวนการขาย', 'จำนวนการขาย', 'ยอดก่อนลด', 'ส่วนลดสินค้า',
    'กำไร ยอดรวม - ต้นทุน - ส่วนลด',
    '00:00', '01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00', '08:00', '09:00',
    '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00',
    '20:00', '21:00', '22:00', '23:00',
    'สาขา',
  ],
  headerRowIndex: 1,
};
