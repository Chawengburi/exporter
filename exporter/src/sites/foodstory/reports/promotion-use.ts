import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "รายงานการใช้โปรโมชั่น" — #50 ในสเปกต้นทาง, toolbar A, `/th/promotion/use`
 *
 * มี tab strip 4 tab: ทั้งหมด / หน้าร้าน / CRM / LINE MAN (สเปกต้นทาง §6.4) — 🔴 ยืนยันจริง
 * 2026-09-26 ว่า tab แรก "ทั้งหมด" active โดย default จริง (`class="active"`) ตามที่ ticket
 * คาดไว้ — **ต่างจาก `/th/promotion` (ticket นี้เหมือนกัน) ตรงที่หน้านี้ไม่มีตารางซ้อนคู่กัน
 * แบบ "ส่วนลดรายเมนู/ส่วนลดท้ายบิล"** — มีแค่ toolbar/ตารางเดียวจริง ยืนยันจาก DOM ตรง ๆ
 * (นับ `.dt-buttons` ได้ 1 ชุดเท่านั้น) ตรงกับที่สเปกต้นทาง §6.4 ระบุว่าโครง "sub-tabs" พิเศษมีแค่
 * บน `/th/promotion` เท่านั้น ไม่รวม `/th/promotion/use`
 *
 * 🔴 ไม่มีตัวกรองวันที่จริง (`.carlendar-force` มี class `hide`) — เหมือนทุกใบในกลุ่มที่เหลือของ
 * ticket 10 — ไม่มี concept เทียบเท่า `dailyOnly` — เหตุผลเต็มดู `costbyproduct.ts` (ticket 06)
 *
 * ยืนยันจริง 2026-09-26: ว่างเปล่า (0 แถวข้อมูล) ในบัญชีทดสอบนี้ — ตรงกับสเปกต้นทาง §6.5
 * ("promotions" อยู่ในลิสต์ 14 รายงานที่ว่างเปล่าในรอบมือจริง)
 */
export const promotionUse: Report = {
  id: 'promotion_use',
  label: 'รายงานการใช้โปรโมชั่น',
  path: '/th/promotion/use',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-26 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: ['ชื่อโปรโมชั่น', 'ประเภทโปรโมชั่น', 'จำนวนการใช้', 'ยอดส่วนลด', 'สาขา'],
  headerRowIndex: 1,
};
