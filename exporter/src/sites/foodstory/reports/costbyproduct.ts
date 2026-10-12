import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "ต้นทุนต่อเมนู" — #21 ในสเปกต้นทาง, toolbar A, `/th/costbyproduct`
 * เป็นหนึ่งใน "core report" ที่สเปกต้นทาง §8 ข้อ 3 ใช้ spot-check ว่ามีข้อมูลจริง (ไม่ควรว่างเปล่า
 * ในเดือนที่มีการค้าขาย)
 *
 * โครงไฟล์เหมือน `salebysumdate` (แถว 0 = ชื่อ, แถว 1 = header, แถวสรุป "Total")
 *
 * ## ทำไมไม่มี concept เทียบเท่า `dailyOnly` ของ HotelTime (ADR-0003)
 *
 * รายงานกลุ่ม "Master data" (§2.4 ทั้ง 4 ใบ: costbyproduct, intermidiate, ingredient,
 * ingredientaddon) **ไม่มีตัวกรองวันที่เลย** — ยืนยันจริง 2026-09-26: ไม่มีปุ่ม/ช่องให้ตั้งช่วง
 * วันที่บนหน้าเลย primitives ที่ใช้ (dismissInterstitial → waitForReady → selectShowNRows →
 * triggerExportAndCaptureDownload) ไม่มีขั้นตั้งช่วงวันที่แทรกเลยสักจุด
 *
 * `dailyOnly` ของ HotelTime (ADR-0003) มีไว้แยก "กรองด้วยวันปฏิบัติการวันเดียว" ออกจาก
 * "created-date ledger ที่สะสมได้" — เป็นการเลือกระหว่าง **สอง concept ของการกรองวันที่** ที่ต่าง
 * กัน ไม่ใช่ "มี filter หรือไม่มี filter" ส่วนรายงานกลุ่มนี้ของ FoodStory ไม่มี concept การกรอง
 * วันที่ให้เลือกเลยตั้งแต่แรก (เป็น snapshot ของสถานะปัจจุบันล้วน ๆ เช่น "เมนูนี้ราคาเท่าไหร่ตอนนี้")
 * จึงไม่มีอะไรให้ "ตัดสินใจว่าจะกรองแบบไหน" — สร้าง field ใหม่ใน `Report` type มาแทน "ไม่ต้องกรอง"
 * จะเป็นการเพิ่ม concept ที่ไม่มีความหมายจริง (ตรงข้ามกับ ADR-0004 ที่ไม่บังคับ shape ให้เหมือนกัน
 * ข้ามกลไกที่ต่างกันจริง) — **ตัดสินใจ: ไม่เพิ่ม field ใหม่ ดึงค่าปัจจุบันทุกครั้งที่รันตรง ๆ
 * ตามที่ตกลงไว้ตอน grill (ดึงพร้อมรอบเดียวกับรายงานอื่นทุกเดือน ไม่แยก schedule)**
 */
export const costbyproduct: Report = {
  id: 'costbyproduct',
  label: 'ต้นทุนต่อเมนู',
  path: '/th/costbyproduct',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-26 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'รหัสสินค้า', 'ชื่อสินค้า', 'กลุ่ม', 'หมวดสินค้า', 'ต้นทุน ต้นทุนเฉลี่ย x จำนวนการขาย',
    'ต้นทุน %', 'ราคา', 'กำไร %', 'สาขา',
  ],
  headerRowIndex: 1,
};
