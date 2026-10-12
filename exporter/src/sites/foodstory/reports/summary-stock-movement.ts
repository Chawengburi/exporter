import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "สรุปความเคลื่อนไหวสินค้าในคลัง" — #43 ในสเปกต้นทาง, toolbar A,
 * `/th/inventory/summary_stock_movement/` (🔴 มี trailing slash อยู่ใน href จริง ตามที่สเปกต้นทาง
 * เตือนไว้ — ยืนยันแล้วว่า path ที่ต่อแบบนี้ไปได้จริง ไม่ error)
 *
 * 🔴 ไม่มีตัวกรองวันที่จริง (`.carlendar-force` มี class `hide`) — เหมือนกลุ่ม inventory ทั้งหมด
 * ที่เช็คมาแล้ว (ticket 08) ไม่มี concept เทียบเท่า `dailyOnly` — เหตุผลเต็มดู `costbyproduct.ts`
 * (ticket 06) ตัวรายงานเองมีคอลัมน์ "ปริมาณก่อนวันที่เริ่มต้น"/"ปริมาณสิ้นสุดวัน" ที่ฟังดูเหมือน
 * ผูกกับช่วงวันที่ แต่เป็นแค่ชื่อคอลัมน์ตายตัวของสรุปทั้งเดือน ไม่ใช่ตัวกรองที่ปรับได้จริง
 *
 * โครงไฟล์เหมือน `salebysumdate` (แถว 0 = ชื่อ, แถว 1 = header, แถวสรุป "Total")
 */
export const summaryStockMovement: Report = {
  id: 'summary_stock_movement',
  label: 'สรุปความเคลื่อนไหวสินค้าในคลัง',
  path: '/th/inventory/summary_stock_movement/',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-26 (unzip ตรง ๆ) — 315 แถวข้อมูล ตรงกับ "Showing 1 to 315 of 315
  // entries" เป๊ะ — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'สินค้าคงคลัง', 'รหัสวัตถุดิบ', 'ป้ายกำกับ', 'หน่วย', 'ปริมาณก่อนวันที่เริ่มต้น',
    'เพิ่มจากการรับสินค้าคงคลัง (GR)', 'เพิ่มจากการเติมรวดเร็ว', 'เพิ่มจากนำเข้าสินค้าคงคลัง',
    'เพิ่มจากการตรวจสอบสินค้า', 'เพิ่มจากยกเลิก Transfer out', 'เพิ่มจากการยกเลิกออเดอร์',
    'เพิ่มจากการทำลาย', 'เพิ่มจากการคืนสินค้า (TO)', 'รวมจากการเพิ่ม', 'รวมจากการตัดสต็อก',
    'ลดจาก Transfer out', 'ลดจาก Waste', 'รวมจากการลด', 'ตัดสต็อคเนื่องจากมีการรับสินค้าที่เป็นสูตรใหญ่',
    'ปริมาณสิ้นสุดวัน', 'สาขา',
  ],
  headerRowIndex: 1,
};
