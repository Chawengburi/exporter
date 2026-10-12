import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "ผู้จัดจำหน่าย" — #35 ในสเปกต้นทาง, toolbar A, `/th/inventory/supplier`
 *
 * 🔴 ไม่มีตัวกรองวันที่จริง (`.carlendar-force` มี class `hide`) — เหมือนทั้งกลุ่มของ ticket นี้
 * ไม่มี concept เทียบเท่า `dailyOnly` — เหตุผลเต็มดู `costbyproduct.ts` (ticket 06)
 *
 * ยืนยันจริง 2026-09-27: ว่างเปล่า (0 แถวข้อมูล) ในบัญชีทดสอบนี้ — ยังไม่มีข้อมูลผู้จัดจำหน่าย
 * ตั้งค่าไว้ ดาวน์โหลดได้ header-only file จริง ไม่ error โครงไฟล์เหมือน `salebysumdate`
 */
export const inventorySupplier: Report = {
  id: 'supplier',
  label: 'ผู้จัดจำหน่าย',
  path: '/th/inventory/supplier',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-27 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: ['ผู้จัดจำหน่าย', 'ชื่อ', 'หน่วย', 'ค่าใช้จ่ายต่อหน่วย', 'จำนวน', 'ค่าใช้จ่ายสุทธิ', 'สาขา'],
  headerRowIndex: 1,
};
