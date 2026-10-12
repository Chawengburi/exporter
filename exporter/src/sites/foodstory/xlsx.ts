import { readRawRows } from '../../core/xlsx.ts';

/**
 * ตีความไฟล์ .xlsx ของ FoodStory — รูปร่างต่างจาก HotelTime (ดู core/xlsx.ts สำหรับเหตุผลที่
 * แยก readRawRows ออกจาก readSheet เดิม)
 *
 * 🔴 ตำแหน่งแถว header **ต่างกันจริงต่อรายงาน** — ยืนยันจากไฟล์จริง 2026-09-23: `salebysumdate`
 * แถว 0 = ชื่อรายงาน (1 คอลัมน์), แถว 1 = header แต่ `outputtax` มีแถว metadata ก่อนหน้าอีกหลาย
 * บรรทัด (ชื่อผู้ประกอบการ/เลขผู้เสียภาษี/ที่อยู่/สาขา ฯลฯ) ทำให้ header จริงอยู่ที่แถว 5 (0-indexed)
 * ต่างหาก — ห้ามเดาว่า header อยู่แถว 1 เสมอ ต้อง recon ทุกรายงานเอง (ตาม ticket 03) แล้วส่ง
 * `headerRowIndex` ที่ถูกต้องมาจาก Report definition ของแต่ละใบ
 *
 * แถวสรุปท้ายตารางก็ใช้คำต่างกันด้วย: `salebysumdate` ใช้ "Total" (อังกฤษ) แต่ `outputtax`/
 * `fulltaxinvoice` ใช้ "รวม" (ไทย) — รับเป็น array ของคำที่ยอมรับได้แทนที่จะ hardcode คำเดียว
 *
 * 🔴 `outputtax` ยังมีกับดักที่ 3: มีแถวลอย ๆ คั่นระหว่าง header กับข้อมูลจริง (แถว 6, 0-indexed) —
 * เป็นกล่องเล็ก ๆ แสดง "วัน เดือน ปี / เลขที่ / สำนักงานใหญ่ / สาขา" ที่ใช้คอลัมน์คนละชุดกับทั้ง
 * header (A,C,D,E,F,H-M) และแถวข้อมูลจริง (A,B,D-L) ยืนยันจากไฟล์จริงว่าไม่ใช่ข้อมูลจริงเลย
 * (จำนวนแถวข้อมูลจริงเริ่มนับจากแถวถัดไปพอดี ตรงกับ `Showing 1 to 30 of 30` เป๊ะ) — รองรับด้วย
 * `dataStartRowIndex` แยกจาก `headerRowIndex` แทนที่จะสมมติว่าข้อมูลเริ่มทันทีหลัง header เสมอ
 */

export class FoodStoryXlsxError extends Error {
  override readonly name = 'FoodStoryXlsxError';
}

export type FoodStorySheet = {
  readonly title: string;
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
};

export type ReadFoodStorySheetOptions = {
  /** แถวที่เป็น header จริง (0-indexed) — ต้องยืนยันจากไฟล์จริงต่อรายงาน ห้ามเดา */
  readonly headerRowIndex: number;
  /**
   * แถวแรกที่เป็นข้อมูลจริง (0-indexed) — ปกติคือ `headerRowIndex + 1` แต่บางรายงาน (เช่น
   * `outputtax`) มีแถวลอย ๆ คั่นอยู่ระหว่างกลาง ต้องระบุแยกถ้าไม่ใช่ค่า default
   */
  readonly dataStartRowIndex?: number;
  /** คำที่ใช้ระบุแถวสรุปท้ายตาราง (เจอได้มากกว่าหนึ่งภาษา) */
  readonly totalRowMarkers?: readonly string[];
};

const DEFAULT_TOTAL_ROW_MARKERS = ['Total', 'รวม'];

export function readFoodStorySheet(filePath: string, opts: ReadFoodStorySheetOptions): FoodStorySheet {
  const rows = readRawRows(filePath);
  const dataStartRowIndex = opts.dataStartRowIndex ?? opts.headerRowIndex + 1;
  if (rows.length < opts.headerRowIndex + 1) {
    throw new FoodStoryXlsxError(
      `ไฟล์มีแค่ ${rows.length} แถว แต่คาดว่า header อยู่ที่แถว ${opts.headerRowIndex} (0-indexed) — ${filePath}`,
    );
  }

  // 🔴 title มาจากคอลัมน์ A ของแถว 0 เสมอ — ใช้ได้กับ salebysumdate แต่ outputtax/fulltaxinvoice
  // ใส่ชื่อรายงานไว้คอลัมน์ G แทน (ยืนยันจริง 2026-09-23) จึงได้ '' เปล่า ๆ กับสองรายงานนี้
  // ไม่ได้แก้ให้ generic เพราะ title ไม่ถูกใช้ตรวจสอบอะไรจริงจัง (ไม่ใช่ส่วนหนึ่งของ
  // expectedColumns/row-count reconciliation) — เป็นข้อจำกัดที่รู้ตัวแล้ว ไม่ใช่บั๊กที่ซ่อนอยู่
  const title = rows[0]![0] ?? '';
  const header = rows[opts.headerRowIndex]!;
  const rest = rows.slice(dataStartRowIndex);
  const totalMarkers = opts.totalRowMarkers ?? DEFAULT_TOTAL_ROW_MARKERS;

  // แถวสรุปไม่ใช่ทุกไฟล์จะมี (ผลว่างตามสเปกต้นทาง §6.5 อาจไม่มีแถวสรุป) — ตัดออกเฉพาะ
  // เมื่อเจอจริงเท่านั้น ไม่ตัด rest.slice(0, -1) เดาสุ่มสี่สุ่มห้า
  const hasTotalRow = rest.length > 0 && totalMarkers.includes(rest[rest.length - 1]![0] ?? '');
  const dataRows = hasTotalRow ? rest.slice(0, -1) : rest;

  return { title, header, rows: dataRows };
}
