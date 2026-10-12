import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "รายละเอียดการโอนวัตถุดิบ" — #39 ในสเปกต้นทาง, toolbar A,
 * `/th/inventory/transfer-detail?type=tr`
 *
 * มี 3 tab: TR / TO / GR (สเปกต้นทาง §6.4) — เอาแค่ tab แรก (TR) ตามที่ตกลงไว้ ไม่วนทุก tab —
 * 🔴 ยืนยันจริง 2026-09-26 ว่า `?type=tr` เลือก tab "TR" (`class="active"`) ได้จริงตามที่สเปกต้นทาง
 * เดาไว้ว่า "unverified, test before relying on it" (§6.4) — **ยืนยันแล้วว่าใช้ได้จริง** ต่างจาก
 * `purchase-detail` (ticket 08) ที่ยืนยันแค่ว่า default tab คือ PR แต่ไม่ได้ลองเปลี่ยน query param
 * เอง ที่นี่ลองเปลี่ยนจริงแล้วเห็นผลตรงกับที่คาด
 *
 * 🔴 ไม่มีตัวกรองวันที่จริง (`.carlendar-force` มี class `hide`) — เหมือนกลุ่ม inventory ทั้งหมด
 * ที่เช็คมาแล้ว (ticket 08) ไม่มี concept เทียบเท่า `dailyOnly` — เหตุผลเต็มดู `costbyproduct.ts`
 * (ticket 06)
 *
 * ยืนยันจริง 2026-09-26: ว่างเปล่า (0 แถวข้อมูล) ในบัญชีทดสอบนี้ — ตรงกับสเปกต้นทาง §6.5
 * ("the inventory PR/TR detail reports" อยู่ในลิสต์ 14 รายงานที่ว่างเปล่าในรอบมือจริง)
 */
export const transferDetail: Report = {
  id: 'transfer-detail',
  label: 'รายละเอียดการโอนวัตถุดิบ',
  path: '/th/inventory/transfer-detail?type=tr',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-26 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'วันที่', 'ชื่อ', 'รหัสวัตถุดิบ', 'ป้ายกำกับ', 'TR', 'วันที่ออก TR', 'สถานะ TR', 'หน่วย',
    'ขอโอนสินค้า', 'ค่าใช้จ่ายต่อหน่วย', 'ค่าใช้จ่ายสุทธิ', 'TO', 'ผู้ส่ง', 'ผู้รับ',
  ],
  headerRowIndex: 1,
};
