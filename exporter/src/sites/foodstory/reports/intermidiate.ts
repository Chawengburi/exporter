import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "สูตรอาหาร" — #22 ในสเปกต้นทาง, toolbar A, `/th/intermidiate`
 *
 * 🔴 path สะกด "intermidiate" (ไม่ใช่ "intermediate") จริง — ยืนยันแล้วว่าไม่ใช่พิมพ์ผิดตอนเขียน
 * สเปกต้นทาง เป็น URL จริงของเว็บ
 *
 * ไม่มี concept เทียบเท่า `dailyOnly` — ดูเหตุผลเต็มใน `costbyproduct.ts` (รายงานกลุ่ม Master
 * data ทั้ง 4 ใบใช้เหตุผลเดียวกัน)
 *
 * ยืนยันจริง 2026-09-26: ว่างเปล่า (0 แถวข้อมูล มีแค่ title+header+Total) ในบัญชีทดสอบนี้ —
 * ยังไม่มีสูตรอาหารตั้งค่าไว้ ดาวน์โหลดได้ header-only file จริง ไม่ error
 */
export const intermidiate: Report = {
  id: 'intermidiate',
  label: 'สูตรอาหาร',
  path: '/th/intermidiate',
  // toolbar A → ปุ่มข้อความ "Excel"
  exportButtonText: 'Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-26 (unzip ตรง ๆ) — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่
  expectedColumns: [
    'ส่วนผสมหลัก', 'ป้ายกำกับส่วนผสมหลัก', 'ราคาส่วนผสมหลัก', 'ส่วนผสมย่อย', 'ราคาส่วนผสมย่อย',
    'หน่วยของส่วนผสมย่อย', 'ปริมาณแปลงหน่วย', 'ปริมาณที่ใช้ตอนตัดสต็อค', 'หน่วยที่ใช้ตอนตัดสต็อค',
    'ต้นทุนของส่วนผสมย่อย', 'สาขา',
  ],
  headerRowIndex: 1,
};
