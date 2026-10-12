import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "รายงานการใช้ Voucher" — #51 ในสเปกต้นทาง, toolbar B, `/th/voucher`
 *
 * toolbar B ต่างจาก A แค่มีปุ่มเพิ่ม "✉ ส่งออกทั้งหมด" (ส่งออกทั้งหมดทาง email ไม่ใช่ดาวน์โหลด —
 * สเปกต้นทาง §3 ระบุให้ใช้เป็น fallback เฉพาะกรณี row-cap เท่านั้น) ปุ่ม "Excel" ที่กดจริงยังเป็น
 * ข้อความเดียวกับ toolbar A ทุกประการ ไม่ต้องแก้ primitive อะไรเลย
 *
 * 🔴 ไม่มีตัวกรองวันที่จริง (`.carlendar-force` มี class `hide`) — ยืนยันจริง 2026-09-26 เหมือน
 * ทุกใบในกลุ่มที่เหลือของ ticket 10 — ไม่มี concept เทียบเท่า `dailyOnly` — เหตุผลเต็มดู
 * `costbyproduct.ts` (ticket 06)
 *
 * ยืนยันจริง 2026-09-26: ว่างเปล่า (0 แถวข้อมูล) ในบัญชีทดสอบนี้ — ตรงกับสเปกต้นทาง §6.5
 * ("vouchers" อยู่ในลิสต์ 14 รายงานที่ว่างเปล่าในรอบมือจริง)
 */
export const voucher: Report = {
  id: 'voucher',
  label: 'รายงานการใช้ Voucher',
  path: '/th/voucher',
  // toolbar B → ปุ่มข้อความ "Excel" เหมือน toolbar A (ปุ่ม "ส่งออกทั้งหมด" ไม่ใช้)
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-26 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'วันที่และเวลา', 'หมายเลขใบเสร็จ', 'ยอดสุทธิ', 'มูลค่า Voucher', 'มูลค่าที่ใช้',
    'มูลค่าคงเหลือหลังใช้ มูลค่า Voucher - มูลค่าที่ใช้', 'ยอดที่ต้องจ่ายเพิ่ม', 'รหัสอ้างอิง',
    'ปิดบิลโดย', 'สาขา',
  ],
  headerRowIndex: 1,
};
