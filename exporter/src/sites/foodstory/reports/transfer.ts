import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "รายงานจัดสินค้าส่ง" — #41 ในสเปกต้นทาง, toolbar A, `/th/inventory/transfer`
 *
 * 🔴 ไม่มีตัวกรองวันที่จริง (`.carlendar-force` มี class `hide`) — เหมือนกลุ่ม inventory ทั้งหมด
 * ที่เช็คมาแล้ว (ticket 08) ไม่มี concept เทียบเท่า `dailyOnly` — เหตุผลเต็มดู `costbyproduct.ts`
 * (ticket 06)
 *
 * ยืนยันจริง 2026-09-26: ว่างเปล่า (0 แถวข้อมูล) ในบัญชีทดสอบนี้ — ตรงกับสเปกต้นทาง §6.5
 * (transfers อยู่ในลิสต์ 14 รายงานที่ว่างเปล่าในรอบมือจริง)
 */
export const transfer: Report = {
  id: 'transfer',
  label: 'รายงานจัดสินค้าส่ง',
  path: '/th/inventory/transfer',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-26 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'สาขาส่งสินค้า', 'สาขารับสินค้า', 'รหัสวัตถุดิบ', 'รายการสินค้า', 'จำนวน', 'หน่วย',
    'เลขที่เอกสารจากระบบเรา', 'Due date',
  ],
  headerRowIndex: 1,
};
