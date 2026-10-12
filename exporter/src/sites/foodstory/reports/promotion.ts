import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "รายงานโปรโมชั่น" — #49 ในสเปกต้นทาง, toolbar A, `/th/promotion`, **nested tabs** (สเปกต้นทาง
 * §6.4)
 *
 * มี tab **2 ระดับซ้อนกัน** (สเปกต้นทาง §6.4 เรียกระดับในว่า "sub-tabs" — ยืนยันแล้วว่าคำนี้ถูกต้อง
 * ตรงตัว ไม่ใช่คำที่ทำให้เข้าใจผิด):
 * 1. tab strip นอก (`ul.nav-tabs`): ทั้งหมด/หน้าร้าน/CRM/LINE MAN — default active คือ "ทั้งหมด"
 *    จริงตามที่ ticket คาดไว้ (ตรงกับ acceptance criterion ที่ตกลงไว้)
 * 2. sub-tab ใน: "ส่วนลดรายเมนู" (ระดับรายการสินค้า, default active) / "ส่วนลดท้ายบิล" (ระดับบิล)
 *    — 🔴 ตอนแรกเข้าใจผิดว่าทั้งสองตาราง render พร้อมกันเสมอ (เพราะนับ `.dt-buttons` เจอ 2 ชุดใน DOM
 *    พร้อมกัน) แต่ **พิสูจน์แล้วว่าเข้าใจผิด**: เช็ค `offsetParent`/`getComputedStyle` ก่อน-หลังคลิก
 *    "ส่วนลดท้ายบิล" เจอ toolbar ตัวแรกสลับจาก visible→hidden และตัวที่สองจาก hidden→visible
 *    พอดี (2026-09-26) — เป็น **tab ที่คลิกสลับได้จริงตามที่สเปกบอก** ไม่ใช่สองตารางคู่ขนาน บทเรียน:
 *    การนับ element ใน DOM เฉยๆ (ไม่เช็ค visibility) แยกไม่ออกจาก Bootstrap tab-pane pattern
 *    มาตรฐานที่ทุก pane ถูก render ไว้ในหน้าตลอด แต่โชว์ทีละอันด้วย class/display — ต้องเช็ค
 *    visibility จริงก่อนสรุปเสมอ (เจอจาก code review, ไม่ใช่ที่ตรวจพบเอง)
 *
 * **การตัดสินใจ:** นิยามนี้จับเฉพาะ sub-tab แรกที่ active by default ("ส่วนลดรายเมนู") ตรงตาม
 * หลัก "เอาแค่ tab แรก" ของ ticket นี้ทุกประการ (ไม่ใช่ scope reduction พิเศษอย่างที่เข้าใจผิดตอนแรก)
 * ยืนยันจากไฟล์จริงว่า `triggerExportAndCaptureDownload` จับตารางนี้จริง (header มีคอลัมน์
 * "ชื่อเมนู" ซึ่งมีแค่ sub-tab นี้เท่านั้นที่มี) — sub-tab "ส่วนลดท้ายบิล" ไม่ได้จับไว้ เหมือนกับที่
 * `purchase-detail`/`transfer-detail` (ticket 08/09) ไม่จับ tab อื่นนอกจาก tab แรกเช่นกัน
 *
 * 🔴 ไม่มีตัวกรองวันที่จริง (`.carlendar-force` มี class `hide`) — เหมือนทุกใบในกลุ่มที่เหลือของ
 * ticket 10 — ไม่มี concept เทียบเท่า `dailyOnly` — เหตุผลเต็มดู `costbyproduct.ts` (ticket 06)
 *
 * ยืนยันจริง 2026-09-26: ว่างเปล่า (0 แถวข้อมูล) ในบัญชีทดสอบนี้ — ตรงกับสเปกต้นทาง §6.5
 * ("promotions" อยู่ในลิสต์ 14 รายงานที่ว่างเปล่าในรอบมือจริง)
 */
export const promotion: Report = {
  id: 'promotion',
  label: 'รายงานโปรโมชั่น',
  path: '/th/promotion',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-26 (unzip ตรง ๆ) — ตารางแรก "ส่วนลดรายเมนู" เท่านั้น (ดูคอมเมนต์
  // ด้านบน) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'วันเวลา', 'หมายเลขใบเสร็จ / ID', 'ชื่อเมนู', 'ชื่อโปรโมชั่น', 'ประเภทโปรโมชั่น', 'โปรโมชั่นโค้ด',
    'เหตุผล', 'จำนวนการใช้', 'ส่วนลด ส่วนลดสินค้า + ส่วนลดบิล', 'ชื่อผู้ใช้', 'สาขา', 'ชื่อลูกค้า CRM',
    'เบอร์ลูกค้า CRM',
  ],
  headerRowIndex: 1,
};
