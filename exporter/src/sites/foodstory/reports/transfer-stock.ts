import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "การโอนวัตถุดิบ" — #38 ในสเปกต้นทาง, toolbar A, `/th/inventory/transfer_stock`
 *
 * 🔴 ไม่มีตัวกรองวันที่จริง (`.carlendar-force` มี class `hide`) — เหมือนกลุ่ม inventory ทั้งหมด
 * ที่เช็คมาแล้ว (ticket 08) ไม่มี concept เทียบเท่า `dailyOnly` — เหตุผลเต็มดู `costbyproduct.ts`
 * (ticket 06)
 *
 * ยืนยันจริง 2026-09-26: ว่างเปล่า (0 แถวข้อมูล) ในบัญชีทดสอบนี้ — ตรงกับสเปกต้นทาง §6.5 ที่ระบุ
 * ว่า transfers เป็นหนึ่งใน 14 รายงานที่ export ว่างเปล่าในรอบมือจริงเดือน ส.ค. 2026 เช่นกัน
 * ดาวน์โหลดได้ header-only file จริง ไม่ error โครงไฟล์เหมือน `salebysumdate` ยกเว้นมีคอลัมน์ท้าย
 * "search_text" เพิ่มมา (คอลัมน์ช่วยค้นหาภายในของเว็บ ไม่ใช่ข้อมูลธุรกิจ แบบเดียวกับ
 * `purchase_stock` ticket 08)
 */
export const transferStock: Report = {
  id: 'transfer_stock',
  label: 'การโอนวัตถุดิบ',
  path: '/th/inventory/transfer_stock',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-26 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: ['สถานะ', 'TR', 'TO', 'GR', 'สาขาต้นทาง', 'สาขาปลายทาง', 'search_text'],
  headerRowIndex: 1,
};
