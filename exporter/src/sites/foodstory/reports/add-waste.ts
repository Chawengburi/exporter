import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "การตัดของเสียหาย" — #40 ในสเปกต้นทาง, toolbar A, `/th/inventory/add_waste`
 *
 * 🔴 ไม่มีตัวกรองวันที่จริง (`.carlendar-force` มี class `hide`) — เหมือนทั้งกลุ่มของ ticket นี้
 * ไม่มี concept เทียบเท่า `dailyOnly` — เหตุผลเต็มดู `costbyproduct.ts` (ticket 06)
 *
 * ยืนยันจริง 2026-09-27: ว่างเปล่า (0 แถวข้อมูล) ในบัญชีทดสอบนี้ — ไม่มีการตัดของเสียหายบันทึกไว้
 * ดาวน์โหลดได้ header-only file จริง ไม่ error โครงไฟล์เหมือน `salebysumdate`
 */
export const addWaste: Report = {
  id: 'add_waste',
  label: 'การตัดของเสียหาย',
  path: '/th/inventory/add_waste',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-27 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'วันที่', 'เวลา', 'รหัสวัตถุดิบ', 'ชื่อ', 'หน่วย', 'จำนวนก่อนเสียหาย', 'จำนวนเสียหาย',
    'มูลค่าความเสียหาย', 'สาขา', 'หมายเหตุ',
  ],
  headerRowIndex: 1,
};
