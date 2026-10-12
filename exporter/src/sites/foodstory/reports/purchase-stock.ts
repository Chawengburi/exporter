import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "การจัดซื้อเข้าคลัง" — #36 ในสเปกต้นทาง, toolbar A, `/th/inventory/purchase_stock`
 *
 * 🔴 ไม่มีตัวกรองวันที่จริง (`.carlendar-force` มี class `hide`) — เหมือนทั้งกลุ่มของ ticket นี้
 * ไม่มี concept เทียบเท่า `dailyOnly` — เหตุผลเต็มดู `costbyproduct.ts` (ticket 06)
 *
 * โครงไฟล์เหมือน `salebysumdate` (แถว 0 = ชื่อ, แถว 1 = header, แถวสรุป "Total") — ยกเว้นมีคอลัมน์
 * ท้าย "search_text" เพิ่มมา (ยืนยันจริง เป็นคอลัมน์ช่วยค้นหาภายในของเว็บ ไม่ใช่ข้อมูลธุรกิจ แต่
 * ยังคงอยู่ในไฟล์จริงที่ดาวน์โหลดได้ จึงต้องอยู่ใน expectedColumns ด้วย)
 */
export const purchaseStock: Report = {
  id: 'purchase_stock',
  label: 'การจัดซื้อเข้าคลัง',
  path: '/th/inventory/purchase_stock',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-27 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: ['วันที่', 'สถานะ', 'ผู้จัดจำหน่าย', 'PR', 'PO', 'GR', 'สาขา', 'search_text'],
  headerRowIndex: 1,
};
