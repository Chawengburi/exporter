import { CONTROL_DISMISS_INTERSTITIAL, CONTROL_EXCEL_BUTTON, CONTROL_SHOW_N_ROWS } from '../interactions.ts';
import type { Report } from './_types.ts';

/**
 * "รายงานการออกใบกำกับภาษีเต็มรูปแทนใบกำกับภาษีอย่างย่อ" — #4 ในสเปกต้นทาง, toolbar C,
 * `/th/fulltaxinvoice`
 *
 * ยืนยันจริง 2026-09-23 (unzip ตรง ๆ, ดู ticket 03 §Comments): แถว 0 = ชื่อรายงาน, แถว 1-5 =
 * metadata (เดือนภาษี/ประเภทรายงาน/ชื่อผู้ประกอบการ/เลขผู้เสียภาษี/ที่อยู่/ชื่อสถานประกอบการ),
 * แถว 6 = header จริง, **แถว 7 เป็นกล่องลอย ๆ ("สำนักงานใหญ่"/"สาขา") ไม่ใช่ข้อมูล** — โครงเดียวกับ
 * `outputtax` เป๊ะ (แถวลอยอยู่ถัดจาก header 1 แถวเสมอ ทั้งคู่ใช้ toolbar C — สงสัยว่าอาจเป็นแพทเทิร์น
 * ร่วมของ toolbar C แต่ยังไม่ได้พิสูจน์กับรายงานอื่น ห้ามสมมติกับรายงานใหม่โดยไม่ recon ก่อน)
 *
 * ช่วงที่ทดสอบไม่มีข้อมูลจริง (ตรงกับสเปกต้นทาง §6.5 — "empty reports are normal") ยืนยันว่า
 * ดาวน์โหลดได้ header-only file จริง ไม่ error: แถวหลัง header (แถว 8, 0-indexed) เป็นแถวสรุป
 * "รวม" ทันที ไม่มีแถวข้อมูลเลย (`I9`/`J9`/`K9` = 0 หมด) — 🔴 `dataStartRowIndex`/โครงนี้ยัง
 * ไม่เคย live-verify กับเดือนที่มีข้อมูลจริง (ไม่รู้ว่าแถวลอยที่แถว 7 จะขยับ/หายไปไหมถ้ามีข้อมูล)
 */
export const fulltaxinvoice: Report = {
  id: 'fulltaxinvoice',
  label: 'รายงานการออกใบกำกับภาษีเต็มรูปแทนใบกำกับภาษีอย่างย่อ',
  path: '/th/fulltaxinvoice',
  // toolbar C → ปุ่มข้อความ "Export Excel"
  exportButtonText: 'Export Excel',
  allowedControls: [CONTROL_DISMISS_INTERSTITIAL, CONTROL_SHOW_N_ROWS, CONTROL_EXCEL_BUTTON],
  // ยืนยันจากไฟล์จริง 2026-09-23 — คอลัมน์ H ว่างเปล่าในไฟล์จริง (ไม่ได้ใช้)
  expectedColumns: [
    'เลขที่', 'วัน เดือน ปี', 'เลขรหัสประจำเครื่องบันทึกการเก็บเงินที่อธิบดีกำหนดPOS ID',
    'เลขที่ใบกำกับภาษี(เต็มรูป)Document No', 'ชื่อผู้ซื้อสินค้า/ผู้รับบริการ',
    'เลขประจำตัวผู้เสียภาษีอากรของผู้ซื้อสินค้า / ผู้รับบริการ', 'สถานประกอบการ', '',
    'มูลค่าสินค้าหรือบริการ', 'จำนวนเงินภาษีมูลค่าเพิ่ม', 'จำนวนเงินรวม',
    'หมายเหตุ : ออกแทนใบกำกับภาษี เลขที่',
  ],
  headerRowIndex: 6,
  dataStartRowIndex: 8, // ข้าม row 7 ที่เป็นกล่องลอย ๆ ไม่ใช่ข้อมูล (โครงเดียวกับ outputtax)
  totalRowMarkers: ['รวม'],
};
