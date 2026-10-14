/**
 * อ่าน CSV ตาม RFC 4180 — ไฟล์ CSV ที่ Site ให้มาเอง (เช่น salebychannel ของ FoodStory) และ CSV เก่าในคลัง (การย้ายของเดิม)
 * · exporter ไม่เขียน CSV แล้ว (ADR-0007: เก็บแค่ไฟล์ดิบ)
 */

export class CsvError extends Error {
  override readonly name = 'CsvError';
}

/** UTF-8 BOM — CSV ที่ Excel/Site เขียนมักขึ้นต้นด้วยตัวนี้ parser ข้ามให้เอง */
export const BOM = '﻿';

/** parser ขั้นต่ำสำหรับ CSV ที่เจอจริงในโปรเจกต์นี้ — ไม่ได้ตั้งใจให้รองรับ CSV ทุกสำเนียงในโลก */
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
