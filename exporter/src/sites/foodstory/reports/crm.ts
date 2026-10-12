import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "ยอดใช้จ่ายลูกค้าตามเบอร์โทรศัพท์" — #45 ในสเปกต้นทาง, toolbar A, `/th/crm`
 *
 * 🔴 ไม่มีตัวกรองวันที่จริง (`.carlendar-force` มี class `hide`) — ยืนยันจริง 2026-09-26 เหมือน
 * ทุกใบในกลุ่มที่เหลือของ ticket 10 (crm, drawer, drawer_paid, promotion, promotion/use, voucher,
 * employee, working, table) ไม่มีข้อยกเว้นเลยสักใบ — ไม่มี concept เทียบเท่า `dailyOnly` — เหตุผล
 * เต็มดู `costbyproduct.ts` (ticket 06)
 *
 * โครงไฟล์เหมือน `salebysumdate` (แถว 0 = ชื่อ, แถว 1 = header, แถวสรุป "Total")
 */
export const crm: Report = {
  id: 'crm',
  label: 'ยอดใช้จ่ายลูกค้าตามเบอร์โทรศัพท์',
  path: '/th/crm',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-26 (unzip ตรง ๆ) — 21 แถวข้อมูล ตรงกับ "Showing 1 to 21 of 21
  // entries" เป๊ะ — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'เบอร์โทรศัพท์', 'ชื่อลูกค้า', 'ที่อยู่', 'รหัสไปรษณีย์', 'จำนวนเงิน', 'ประเภทการสั่ง',
    'ช่องทางการขาย', 'สาขา',
  ],
  headerRowIndex: 1,
};
