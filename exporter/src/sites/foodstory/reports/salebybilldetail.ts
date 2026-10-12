import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "ยอดขายตามรายละเอียดบิล" — #9 ในสเปกต้นทาง, toolbar B, `/th/salebybilldetail`
 *
 * สเปกต้นทาง §5.3 วัดมาว่าใบนี้เกิน 5,000 แถวได้จริง (5,352 แถวเดือน ส.ค. 2026) — เพดานของ
 * FoodStory คือ 5000 (มาจากตัวเลือกสูงสุดของ "Show N rows") ต่างจาก HotelTime (2000)
 *
 * primitives ปกติ (login → setDateRangeByTyping → dismissInterstitial → waitForReady →
 * selectShowNRows → triggerExportAndCaptureDownload) ใช้ได้ตรง ๆ ไม่ต้องมีกลไกใหม่สำหรับ "ดึง
 * รอบเดียว" — กลไกใหม่อยู่ที่ "ดึงเกิน 5000 แถวยังไงให้ครบ": ใช้
 * `core/rowcap.ts::fetchWithRowCapSplit()` (ผ่าครึ่งช่วงวันที่ซ้ำ ดึงใหม่ทั้งสองฝั่ง รวมผล — สรุป
 * มาจาก pattern เดียวกับที่ HotelTime ใช้กับ ROW_CAP=2000) โดย runner ที่ยังไม่มีในตอนนี้ (รอ
 * ticket 12) จะเป็นคนเรียก `fetchWithRowCapSplit(range, 5000, fetchOne)` โดย `fetchOne` ผูกกับ
 * `setDateRangeByTyping`+`waitForReady`+download ของรายงานนี้เอง
 *
 * 🔴 **ยังไม่เคย live-verify กลไกผ่าครึ่งกับข้อมูลจริงที่เกิน 5000 แถว** — บัญชีทดสอบ (Chaweng
 * Buri Resort) มียอดขายน้อยเกินไป (สูงสุดที่วัดได้ตอน recon คือ 80 แถวในช่วงทดสอบ) สร้าง
 * 5000+ แถวจริงไม่ได้ตอนนี้ พิสูจน์อัลกอริทึมผ่าน unit test ด้วยข้อมูลจำลองแทน (ดู
 * `test/rowcap.test.ts`) ต้อง live-verify ซ้ำเมื่อมีเดือนที่มีข้อมูลจริงเกินเพดาน (ticket 12
 * เป็นจุดที่เหมาะสมกว่าตอนสร้าง runner จริง)
 */
export const salebybilldetail: Report = {
  id: 'salebybilldetail',
  label: 'ยอดขายตามรายละเอียดบิล',
  path: '/th/salebybilldetail',
  // toolbar B → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-26 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'วันที่ชำระเงิน', 'เวลาที่ชำระเงิน', 'หมายเลขใบเสร็จ / ID', 'INV. No', 'รหัสถาดเก็บเงิน',
    'รหัสเมนู', 'ชื่อเมนู', 'ประเภทการสั่ง', 'จำนวน', 'ราคาต่อหน่วย', 'ยอดก่อนลด', 'ส่วนลดสินค้า',
    'ส่วนลดสินค้า %', 'ราคาสุทธิ', 'ประเภทภาษีของรายการ', 'ช่องทาง', 'โต๊ะ', 'ชื่อลูกค้า',
    'เบอร์โทรศัพท์', 'ประเภทการชำระเงิน', 'วิธีบันทึกรายการชำระ', 'รหัสชำระเงินแบบกำหนดเอง',
    'หมายเหตุ', 'ประเภทโปรโมชั่น', 'กลุ่ม', 'หมวดสินค้า', 'เปิดบิลโดย', 'ปิดบิลโดย', 'สาขา',
  ],
  headerRowIndex: 1,
};

/** เพดานจำนวนแถวของ FoodStory (มาจาก "Show N rows" สูงสุด — ต่างจาก HotelTime ที่ 2000) */
export const FOODSTORY_ROW_CAP = 5000;
