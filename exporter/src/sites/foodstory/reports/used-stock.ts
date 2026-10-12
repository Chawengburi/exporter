import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "การใช้สินค้าคงคลัง" — #31 ในสเปกต้นทาง, toolbar A, `/th/inventory/used_stock`
 *
 * มี tab strip 2 tab: ทั้งหมด / กำลังใช้งานอยู่ (สเปกต้นทาง §6.4) — 🔴 ยืนยันจริง 2026-09-26 ว่า
 * tab ที่ active โดย default คือ **"กำลังใช้งานอยู่"** ไม่ใช่ "ทั้งหมด" ทั้งที่ลำดับในตาราง §2.5/§6.4
 * ของสเปกต้นทางเขียน "ทั้งหมด" ไว้ก่อน — ต่างจาก `purchase-detail`/`transfer-detail` ที่มี `?type=`
 * บังคับ tab ได้ตรง ๆ หน้านี้ไม่มี query param เลือก tab จึงยึดหลักเดียวกับที่ตกลงไว้ตอน ticket 08
 * (เอา tab ที่ active จริงตอนโหลด ไม่ใช่ตัวที่เรียงอยู่ก่อนในตาราง) — เก็บไว้ตามที่โหลดมาจริง
 * ไม่ได้ลองคลิกไปที่ "ทั้งหมด" เพิ่ม (นอกขอบเขต ticket นี้)
 *
 * 🔴 ไม่มีตัวกรองวันที่จริง (`.carlendar-force` มี class `hide`) — เหมือนกลุ่ม inventory ทั้งหมด
 * ที่เช็คมาแล้ว (ticket 08) ไม่มี concept เทียบเท่า `dailyOnly` — เหตุผลเต็มดู `costbyproduct.ts`
 * (ticket 06)
 */
export const usedStock: Report = {
  id: 'used_stock',
  label: 'การใช้สินค้าคงคลัง',
  path: '/th/inventory/used_stock',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-26 (unzip ตรง ๆ) — 435 แถวข้อมูล ตรงกับ "Showing 1 to 435 of 435
  // entries" เป๊ะ — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'ชื่อ', 'รหัสวัตถุดิบ', 'ป้ายกำกับ', 'หน่วย', 'ค่าใช้จ่ายต่อหน่วย', 'จำนวนที่ใช้ทั้งหมด',
    'จำนวนที่ใช้ต่อวัน', 'มูลค่าสินค้าที่ใช้', 'สาขา',
  ],
  headerRowIndex: 1,
};
