/**
 * เขียน/อ่าน CSV ตาม RFC 4180
 *
 * ทำไมผลลัพธ์เป็น CSV ไม่ใช่ xlsx (ตัดสิน 2026-09-08):
 *  - ไม่ต้องพึ่งไลบรารีเขียน xlsx และไม่ต้องผลิต styles.xml ที่ HotelTime เขียนผิดสเปกซ้ำ
 *  - ปลายทางคือ uploader ที่แปลงทุกอย่างเป็น markdown อยู่แล้ว และงาน parquet/DuckDB
 *    (spec 13) อ่าน CSV ได้ตรง ๆ
 *  - แก้เรื่อง Excel serial ได้ในตัว เพราะเราเขียนวันที่ออกมาเป็นข้อความเองทั้งหมด
 */

export class CsvError extends Error {
  override readonly name = 'CsvError';
}

/** UTF-8 BOM — ใส่ไว้เพื่อให้ Excel เปิดชื่อผู้เข้าพักภาษาไทยได้ไม่เป็นตัวยึกยือ */
export const BOM = '﻿';

const NEEDS_QUOTE = /[",\r\n]/;

function quoteField(v: string): string {
  return NEEDS_QUOTE.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
}

export type CsvOptions = {
  /** ใส่ UTF-8 BOM (ค่าเริ่มต้น true) — DuckDB กับ markitdown ข้ามให้เอง Excel ต้องการ */
  readonly bom?: boolean;
};

export function toCsv(
  header: readonly string[],
  rows: readonly (readonly string[])[],
  opts: CsvOptions = {},
): string {
  for (const [i, r] of rows.entries()) {
    if (r.length !== header.length) {
      throw new CsvError(
        `แถวที่ ${i + 1} มี ${r.length} ช่อง แต่หัวตารางมี ${header.length} ช่อง — ปฏิเสธไม่เขียนไฟล์ที่คอลัมน์เลื่อน`,
      );
    }
  }
  const lines = [header, ...rows].map((r) => r.map(quoteField).join(','));
  // CRLF ตาม RFC 4180 · ปิดท้ายด้วย newline หนึ่งตัว
  return (opts.bom === false ? '' : BOM) + lines.join('\r\n') + '\r\n';
}

/** parser ขั้นต่ำไว้ตรวจไฟล์ที่เราเขียนเอง — ไม่ได้ตั้งใจให้รองรับ CSV ทุกสำเนียงในโลก */
export function parseCsv(text: string): string[][] {
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  while (i < src.length) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"') { inQuotes = true; i += 1; continue; }
    if (ch === ',') { endField(); i += 1; continue; }
    if (ch === '\r') { if (src[i + 1] === '\n') i += 1; endRow(); i += 1; continue; }
    if (ch === '\n') { endRow(); i += 1; continue; }
    field += ch; i += 1;
  }
  if (inQuotes) throw new CsvError('CSV จบกลางเครื่องหมายคำพูด — ไฟล์น่าจะไม่ครบ');
  if (field !== '' || row.length > 0) endRow();
  return rows;
}
