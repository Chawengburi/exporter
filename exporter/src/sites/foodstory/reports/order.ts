import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "สถานะการสั่งสินค้า" — #25 ในสเปกต้นทาง, toolbar A, `/th/order`
 *
 * สเปกต้นทาง §5.3 วัดมาว่าใบนี้เกิน 5,000 แถวได้จริง (5,739 แถวเดือน ส.ค. 2026) — เพดานเดียวกับ
 * `salebybilldetail` (ticket 05, ค่าคงที่ `FOODSTORY_ROW_CAP` ที่ `reports/salebybilldetail.ts`)
 * ใช้ `core/rowcap.ts::fetchWithRowCapSplit()` ตัวเดียวกันได้ตรง ๆ ไม่ต้องคิดตรรกะใหม่ — runner
 * ที่ยังไม่มี (รอ ticket 12) จะเป็นคนเรียก `fetchWithRowCapSplit(range, FOODSTORY_ROW_CAP,
 * fetchOne)` โดย `fetchOne` ผูกกับ `setDateRangeByTyping`+`waitForReady`+download ของรายงานนี้เอง
 * (แบบเดียวกับ salebybilldetail)
 *
 * ยืนยันจริง 2026-09-27: ช่วง 30 วันล่าสุดได้ 2,493 แถว (ยังไม่ชนเพดาน) — บัญชีทดสอบยังไม่เคย
 * แตะ 5000 แถวจริงเหมือนกับ salebybilldetail กลไกผ่าครึ่งจึงยังพิสูจน์ได้แค่ผ่าน unit test
 * (`test/rowcap.test.ts`) ไม่ใช่ข้อมูลจริง เหมือนกัน — ดู ticket 07 §Comments
 *
 * โครงไฟล์เหมือน `salebysumdate` (แถว 0 = ชื่อ, แถว 1 = header, แถวสรุป "Total")
 */
export const order: Report = {
  id: 'order',
  label: 'สถานะการสั่งสินค้า',
  path: '/th/order',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-27 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'วันที่เปิดบิล', 'เวลาเปิดบิล', 'เวลาสั่ง', 'รหัสถาดเก็บเงิน', 'หมายเลขใบเสร็จ / ID',
    'ชื่อสินค้า', 'จำนวน', 'ราคารวม', 'รับออเดอร์โดย', 'สถานะ', 'ช่วงเวลายกเลิก', 'สถานะบิล',
    'ประเภทการสั่ง', 'หมายเหตุ', 'สาขา',
  ],
  headerRowIndex: 1,
};
