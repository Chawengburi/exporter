import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { zipSync } from 'fflate';

/**
 * สร้างไฟล์ xlsx จำลองสำหรับเทสต์ — ไม่ใช้ไฟล์จริงที่มีข้อมูลแขก
 *
 * มีกับดักเดียวกับไฟล์จริงของ HotelTime: styles.xml ผิดสเปก (ตัวอ่านต้องไม่แตะ) และเซลล์ว่างถูกตัดออกจาก XML ·
 * ลำดับชีตมาจาก `xl/workbook.xml` + rels แบบไฟล์จริง — `file` แยกจากลำดับได้ เพื่อพิสูจน์ว่าตัวอ่านไม่เดาลำดับจากชื่อไฟล์ใน zip
 */

const enc = new TextEncoder();
const tmp = mkdtempSync(path.join(tmpdir(), 'exporter-xlsx-'));

export type XlsxOpts = { shared?: string[]; sharedXml?: string; styles?: string };

export type FixtureSheet = { readonly name: string; readonly file: string; readonly xml: string };

export function makeWorkbook(name: string, sheets: readonly FixtureSheet[], opts: XlsxOpts = {}): string {
  const shared = opts.shared ?? [];
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': enc.encode('<?xml version="1.0"?><Types/>'),
    'xl/workbook.xml': enc.encode(
      '<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 10}"/>`).join('') +
        '</sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': enc.encode(
      '<?xml version="1.0"?><Relationships>' +
        sheets.map((s, i) => `<Relationship Id="rId${i + 10}" Type="worksheet" Target="worksheets/${s.file}"/>`).join('') +
        '</Relationships>',
    ),
    // styles ที่ผิดสเปทแบบเดียวกับของจริง — ตัวอ่านต้องไม่แตะไฟล์นี้เลย
    'xl/styles.xml': enc.encode(opts.styles ?? '<styleSheet><alignment vertical="middel"/></styleSheet>'),
  };
  for (const s of sheets) files[`xl/worksheets/${s.file}`] = enc.encode(s.xml);
  if (opts.sharedXml !== undefined) {
    files['xl/sharedStrings.xml'] = enc.encode(opts.sharedXml);
  } else if (shared.length > 0) {
    files['xl/sharedStrings.xml'] = enc.encode(
      `<sst count="${shared.length}">${shared.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`,
    );
  }
  const p = path.join(tmp, name);
  writeFileSync(p, zipSync(files));
  return p;
}

/** workbook ชีตเดียว (ชื่อ Sheet1) จาก XML ของชีตตรง ๆ */
export function makeXlsx(name: string, sheetXml: string, opts: XlsxOpts = {}): string {
  return makeWorkbook(name, [{ name: 'Sheet1', file: 'sheet1.xml', xml: sheetXml }], opts);
}

/** XML ของชีตจากแถวที่ให้ — inline string ทั้งหมด (อ่านง่ายในเทสต์) · รองรับไม่เกิน 26 คอลัมน์ */
export function sheetXml(rows: readonly (readonly string[])[]): string {
  const cell = (v: string, r: number, c: number) =>
    `<c r="${String.fromCharCode(65 + c)}${r}" t="inlineStr"><is><t>${v}</t></is></c>`;
  return `<worksheet><sheetData>${rows
    .map((row, i) => `<row r="${i + 1}">${row.map((v, c) => cell(v, i + 1, c)).join('')}</row>`)
    .join('')}</sheetData></worksheet>`;
}

/** path ใหม่ในโฟลเดอร์ชั่วคราวเดียวกับ fixture (สำหรับไฟล์ที่เทสต์เขียนเองตรง ๆ) */
export function tmpPath(name: string): string {
  return path.join(tmp, name);
}
