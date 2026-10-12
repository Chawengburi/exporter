import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "รายละเอียดการเติมวัตถุดิบ" — #37 ในสเปกต้นทาง, toolbar A, `/th/inventory/purchase-detail?type=pr`
 *
 * มี 3 tab: PR / PO / GR (สเปกต้นทาง §6.4) — เอาแค่ tab แรก (PR) ตามที่ตกลงไว้ ไม่วนทุก tab —
 * ยืนยันจริง 2026-09-27 ว่า default tab ที่โหลดมาคือ "PR" จริง (`class="active"`) ไม่ใช่ tab อื่น
 * โดยบังเอิญ — สเปกเดาไว้ว่า `?type=po`/`?type=gr` อาจใช้ได้ตรง ๆ แต่ ticket นี้ไม่ต้องพิสูจน์
 * (เอาแค่ tab แรกตามขอบเขตที่ตกลงกัน)
 *
 * 🔴 ไม่มีตัวกรองวันที่จริง (`.carlendar-force` มี class `hide`) — เหมือนทั้งกลุ่มของ ticket นี้
 * แม้ข้อมูลจะมีคอลัมน์ "วันที่"/"วันที่ออก PO" ก็เป็นแค่ข้อมูล ไม่ใช่ตัวกรอง ไม่มี concept
 * เทียบเท่า `dailyOnly` — เหตุผลเต็มดู `costbyproduct.ts` (ticket 06)
 *
 * โครงไฟล์เหมือน `salebysumdate` (แถว 0 = ชื่อ, แถว 1 = header, แถวสรุป "Total")
 */
export const purchaseDetail: Report = {
  id: 'purchase-detail',
  label: 'รายละเอียดการเติมวัตถุดิบ',
  path: '/th/inventory/purchase-detail?type=pr',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-27 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'วันที่', 'ชื่อ', 'รหัสวัตถุดิบ', 'ป้ายกำกับ', 'PR', 'ประเภท', 'หน่วย', 'เติมสินค้า',
    'ค่าใช้จ่ายต่อหน่วย', 'ค่าใช้จ่ายสุทธิ', 'PO', 'วันที่ออก PO', 'สาขา',
  ],
  headerRowIndex: 1,
};
