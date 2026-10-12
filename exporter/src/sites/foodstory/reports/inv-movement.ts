import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "ความเคลื่อนไหวสินค้าในคลัง" — #42 ในสเปกต้นทาง, toolbar A, `/th/inventory/inv_movement/`
 * (🔴 มี trailing slash อยู่ใน href จริง ตามที่สเปกต้นทางเตือนไว้ — ยืนยันแล้วว่า path ที่ต่อแบบนี้
 * ไปได้จริง ไม่ error) — หนึ่งใน "core report" ที่สเปกต้นทาง §8.3 ใช้ spot-check ว่าไม่ว่างเปล่า
 *
 * 🔴 ไม่มีตัวกรองวันที่จริง (`.carlendar-force` มี class `hide`) — เหมือนกลุ่ม inventory ทั้งหมด
 * ที่เช็คมาแล้ว (ticket 08) ไม่มี concept เทียบเท่า `dailyOnly` — เหตุผลเต็มดู `costbyproduct.ts`
 * (ticket 06)
 *
 * 🔴🔴 ค้นพบสำคัญ 2026-09-26 — **รายงานนี้เกิน 5,000 แถวจริง (9,179 แถวยืนยันจากไฟล์จริง) แต่ไม่มี
 * ตัวกรองวันที่ให้ผ่าครึ่งเลย** ต่างจาก `order.ts`/`salebybilldetail.ts` (ที่ก็เกิน cap เหมือนกัน
 * แต่มีตัวกรองวันที่จริงให้ `core/rowcap.ts::fetchWithRowCapSplit()` ใช้ผ่าครึ่งช่วงได้) — กลไก
 * "ชนเพดาน → ผ่าครึ่งช่วงวันที่ → ดึงใหม่ทั้งสองฝั่ง" ของ `fetchWithRowCapSplit` **ใช้ไม่ได้กับ
 * รายงานนี้เลย** เพราะไม่มีตัวกรองวันที่ให้ผ่า (ผ่าไปก็ได้ผลลัพธ์ 9,179 แถวเท่าเดิมทั้งสองฝั่ง —
 * รวมกันจะซ้ำซ้อนหนักกว่าที่ cap ไว้เฉย ๆ เสียอีก) เรื่องนี้ **ยังไม่มีทางแก้ในสโคปนี้** — ต้องตัดสินใจ
 * ในระดับ runner (รอ ticket 12 หรือ ticket ใหม่) ว่าจะยอมรับ truncate ที่ 5,000 แถวพร้อม flag เตือน
 * ในทุกครั้ง หรือหาแกนกรองอื่น (เช่น รหัสวัตถุดิบ/สาขา) แทนวันที่ ไม่ใช่แค่ apply
 * `fetchWithRowCapSplit` ตรง ๆ แบบ `order.ts`
 */
export const invMovement: Report = {
  id: 'inv_movement',
  label: 'ความเคลื่อนไหวสินค้าในคลัง',
  path: '/th/inventory/inv_movement/',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-26 (unzip ตรง ๆ) — คอลัมน์สุดท้ายเป็นสตริงว่างจริง (มี header เปล่า
  // ต่อท้ายในไฟล์จริง ไม่ใช่ความผิดพลาดตอน parse) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'วันที่', 'เวลา', 'รหัสวัตถุดิบ', 'สินค้าคงคลัง', 'หน่วยหลัก / หน่วยรีสต็อก', 'เหตุการณ์',
    'ปริมาณก่อนเปลี่ยน', 'ปริมาณที่เปลี่ยนแปลง', 'ปริมาณหลังเปลี่ยน', 'ราคาก่อนเปลี่ยน',
    'ราคาที่เปลี่ยนแปลง', 'ราคาหลังเปลี่ยน', 'ผู้แก้ไข', 'หมายเหตุ', 'สาขา', '',
  ],
  headerRowIndex: 1,
};
