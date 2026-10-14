import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

/**
 * ตัวอ่าน xlsx แบบทนไฟล์ของ HotelTime
 *
 * 🔴 ทำไมไม่ใช้ไลบรารี xlsx สำเร็จรูป — ไฟล์ที่ HotelTime สร้างเขียน `xl/styles.xml`
 * ผิดสเปก (ค่า `vertical` ของ alignment ไม่อยู่ใน enum ที่ OOXML กำหนด) ตัวอ่านที่
 * parse stylesheet จะปฏิเสธทั้งไฟล์ — openpyxl โยน
 * `ValueError: Unable to read workbook: could not read stylesheet` (ทดสอบ 2026-09-08)
 *
 * ตัวนี้จึงอ่านเฉพาะไฟล์ที่ต้องใช้จริง (`workbook.xml` + rels เพื่อรู้ว่ามีชีตอะไรตามลำดับไหน, `sharedStrings.xml`
 * และ worksheet ทุกชีต) และ **ไม่แตะ styles.xml เลย** ซึ่งแปลว่าเราไม่สนใจการจัดรูปแบบ — เราต้องการแค่ค่า
 *
 * 🔴 กับดักที่สอง: เซลล์ว่างถูก "ตัดออก" จาก XML ไม่ได้เขียนเป็นแท็กว่าง
 * แถว header มี 22 ช่องแต่แถวข้อมูลมีแค่ ~15 ช่อง การไล่อ่านตามลำดับที่เจอ
 * จะทำให้ค่าเลื่อนคอลัมน์ทั้งแถวโดยไม่มีอะไรฟ้อง — จึงอ่านตำแหน่งจาก attribute `r`
 * (เช่น `r="B2"` = คอลัมน์ที่ 1) เสมอ
 */

export class XlsxError extends Error {
  override readonly name = 'XlsxError';
}

export type Sheet = {
  /** ค่าในแถวแรก จัดตำแหน่งตามคอลัมน์จริงแล้ว ช่องที่ว่างเป็น '' */
  readonly header: readonly string[];
  /** แถวข้อมูล (ไม่รวม header) จัดตำแหน่งตามคอลัมน์จริงแล้ว ทุกแถวยาวเท่ากับ header */
  readonly rows: readonly (readonly string[])[];
};

/** แปลงอ้างอิงเซลล์ (`B2`, `AA10`) เป็นดัชนีคอลัมน์เริ่มที่ 0 */
export function columnIndex(ref: string): number {
  const m = /^([A-Z]+)/.exec(ref);
  if (!m) throw new XlsxError(`อ้างอิงเซลล์ไม่ถูกต้อง: ${JSON.stringify(ref)}`);
  let n = 0;
  for (const ch of m[1]!) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
};

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m]!);
}

/** ดึงข้อความจาก `<t>` ทุกตัวที่อยู่ในชิ้นส่วนที่ให้มา (รองรับ rich text ที่แตกเป็นหลาย run) */
function textOf(fragment: string): string {
  let out = '';
  for (const m of fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) {
    out += m[1] === undefined ? '' : decodeXml(m[1]);
  }
  return out;
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si(?:\s[^>]*)?\/>/g)) {
    out.push(m[1] === undefined ? '' : textOf(m[1]));
  }
  return out;
}

/**
 * แปลง XML ของชีตเป็นแถวดิบทั้งหมด จัดตำแหน่งคอลัมน์ตรงแล้ว — **ไม่ตัดสินว่าแถวไหนคือ header**
 * เพราะนั่นเป็นเรื่องเฉพาะ site (HotelTime: แถวแรกคือ header เสมอ · FoodStory: แถวแรกเป็นชื่อ
 * รายงาน แถวสองถึงเป็น header จริง — ดู `sites/foodstory/xlsx.ts`) ไฟล์นี้จึงคืนแค่แถวดิบ
 * ให้ผู้เรียกตัดสินเอง (`readSheets()` ด้านล่างคือ interpretation แบบ HotelTime)
 *
 * ความกว้างคำนวณจาก**คอลัมน์สุดท้ายที่เจอทั้งชีต** ไม่ใช่แค่แถวแรก — กันกรณีมีแถวนำ (เช่น
 * ชื่อรายงานของ FoodStory) ที่แคบกว่าแถวข้อมูลจริงมาก จนตัดข้อมูลทิ้งถ้าอิงความกว้างจากแถวแรก
 */
function parseRows(xml: string, shared: readonly string[]): readonly (readonly string[])[] {
  const rawRows: Map<number, string>[] = [];

  for (const rowMatch of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>|<row(?:\s[^>]*)?\/>/g)) {
    const body = rowMatch[1] ?? '';
    const cells = new Map<number, string>();

    for (const cm of body.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]!;
      const inner = cm[2] ?? '';

      const refM = /\br="([A-Z]+\d+)"/.exec(attrs);
      if (!refM) continue; // ไม่มี r ก็ระบุคอลัมน์ไม่ได้ ข้ามดีกว่าเดา
      const col = columnIndex(refM[1]!);
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];

      let value: string;
      if (type === 'inlineStr') {
        value = textOf(inner);
      } else {
        const vM = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner);
        if (!vM) continue;
        const raw = decodeXml(vM[1]!);
        if (type === 's') {
          const idx = Number(raw);
          const s = shared[idx];
          if (s === undefined) throw new XlsxError(`sharedString ดัชนี ${idx} ไม่มีอยู่`);
          value = s;
        } else {
          value = raw;
        }
      }
      cells.set(col, value);
    }
    rawRows.push(cells);
  }

  // ห้าม Math.max(...ทุกเซลล์) — ชีตระดับ baseline มีเซลล์เป็นแสน เกินจำนวน argument ที่ stack รับได้
  let maxCol = 0;
  for (const cells of rawRows) for (const col of cells.keys()) if (col > maxCol) maxCol = col;
  const width = maxCol + 1;
  return rawRows.map((cells) => Array.from({ length: width }, (_, i) => cells.get(i) ?? ''));
}

/** หนึ่งชีตของ workbook — ชื่อตามที่ผู้ใช้เห็นในแท็บ และแถวดิบ (ไม่ตัดสินว่าแถวไหนคือ header) */
export type RawSheet = {
  readonly name: string;
  readonly rows: readonly (readonly string[])[];
};

/** ค่า attribute หนึ่งตัวของแท็ก (ลำดับ attribute ในไฟล์จริงไม่แน่นอน จึงไม่จับเป็น regex ก้อนเดียว) */
function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name.replace(':', '\\:')}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]!) : undefined;
}

/**
 * อ่าน**ทุกชีต**ของไฟล์ xlsx ตามลำดับแท็บใน `xl/workbook.xml` — ไม่ตัดสินว่าแถวไหนคือ header
 *
 * 🔴 เดิมอ่านแค่ชีตแรก: `occupancy-by-nationality-stay-reason` ของ HotelTime มีหนึ่งชีตต่อกลุ่มเหตุผลการเข้าพัก และ
 * `outputtax` ของ FoodStory มีชีต "Full Tax Invoice" ต่อท้าย — ชีตที่เหลือไม่เคยถูกตรวจ (ticket 01 ของ
 * exporter-daily-per-day-raw) · ลำดับและชื่อมาจาก workbook.xml + rels ไม่เดาจากชื่อไฟล์ใน zip (`sheet10.xml`
 * เรียงตามตัวอักษรก่อน `sheet2.xml`)
 */
export function readWorkbook(filePath: string): readonly RawSheet[] {
  const pkg = openPackage(filePath);
  const sharedRaw = pkg.read('xl/sharedStrings.xml');
  const shared = sharedRaw ? parseSharedStrings(sharedRaw) : [];
  return pkg.sheets.map(({ name, xml }) => ({ name, rows: parseRows(xml(), shared) }));
}

/** ชื่อทุกชีตตามลำดับแท็บ โดยไม่ parse แถว — สำหรับบันทึกใน manifest */
export function readSheetNames(filePath: string): readonly string[] {
  return openPackage(filePath).sheets.map((s) => s.name);
}

/** แตก zip แล้วหาชีตตามลำดับใน `xl/workbook.xml` + rels · XML ของชีตอ่านตอนเรียก `xml()` เท่านั้น */
function openPackage(filePath: string): {
  readonly read: (name: string) => string | undefined;
  readonly sheets: readonly { readonly name: string; readonly xml: () => string }[];
} {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(readFileSync(filePath));
  } catch (err) {
    throw new XlsxError(
      `แตกไฟล์ xlsx ไม่สำเร็จ: ${filePath}\n` +
        `  ไฟล์อาจไม่ใช่ xlsx จริง (ตรวจ magic bytes ว่าเป็น PK) หรือดาวน์โหลดมาไม่ครบ\n` +
        `  ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const dec = new TextDecoder('utf-8');
  const read = (name: string): string | undefined => {
    const raw = files[name];
    return raw ? dec.decode(raw) : undefined;
  };

  const workbook = read('xl/workbook.xml');
  const rels = read('xl/_rels/workbook.xml.rels');
  if (workbook === undefined || rels === undefined) {
    throw new XlsxError(
      `ไม่พบ xl/workbook.xml หรือ rels ของมันในไฟล์: ${filePath} — บอกไม่ได้ว่ามีชีตอะไรบ้าง\n` +
        `  ไฟล์ที่มี: ${Object.keys(files).join(', ')}`,
    );
  }

  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\s[^>]*>/g)) {
    const id = attr(m[0], 'Id');
    const target = attr(m[0], 'Target');
    if (id !== undefined && target !== undefined) targets.set(id, target);
  }

  const sheets: { name: string; xml: () => string }[] = [];
  for (const m of workbook.matchAll(/<sheet\s[^>]*>/g)) {
    const name = attr(m[0], 'name') ?? '';
    const target = targets.get(attr(m[0], 'r:id') ?? '');
    // Target เป็น path สัมพัทธ์จาก xl/ (ปกติ) หรือ absolute จากรากของ package (ขึ้นต้น /)
    const part = target === undefined ? undefined : target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    if (part === undefined || files[part] === undefined) {
      throw new XlsxError(`ชีต "${name}" ไม่มีไฟล์ worksheet ตามที่ workbook.xml อ้างถึง (${part ?? 'ไม่มี rels'}) — ${filePath}`);
    }
    sheets.push({ name, xml: () => read(part)! });
  }
  if (sheets.length === 0) throw new XlsxError(`ไม่พบชีตใดเลยใน workbook.xml: ${filePath}`);
  return { read, sheets };
}

/** ชีตแบบ HotelTime ที่รู้ชื่อแท็บด้วย */
export type NamedSheet = Sheet & { readonly name: string };

/**
 * อ่าน**ทุกชีต**แบบ HotelTime (แถวแรกของแต่ละชีตคือ header) ตามลำดับแท็บ · ชีตที่ไม่มีแถวเลยได้ header และ rows ว่าง
 * (ไม่ล้มที่นี่ — ผู้เรียกตัดสินว่าทั้งไฟล์ว่างหรือไม่)
 */
export function readSheets(filePath: string): readonly NamedSheet[] {
  return readWorkbook(filePath).map(({ name, rows }) => ({ name, header: rows[0] ?? [], rows: rows.slice(1) }));
}

/**
 * หาดัชนีคอลัมน์จากชื่อหัวตาราง
 *
 * ⚠️ ไฟล์ของ HotelTime มีชื่อคอลัมน์ซ้ำ (`Reservation number` อยู่ทั้งตำแหน่ง 0 และ 15)
 * ฟังก์ชันนี้จึงคืน "ตัวแรกที่เจอ" อย่างจงใจ และมี requireColumn ไว้ให้ล้มดัง ๆ เมื่อไม่เจอ
 */
export function findColumn(sheet: Sheet, name: string): number {
  return sheet.header.indexOf(name);
}

/**
 * แปลง Excel serial number เป็นวันที่
 *
 * 🔴 จำเป็นเพราะรายงานแต่ละใบเก็บวันที่คนละแบบ — ยืนยันจากของจริง 2026-09-08:
 *   - `ReservationListMaster` → เก็บเป็นข้อความ `"01/09/2026"`
 *   - `reports/ResListRateCode` → เก็บเป็น **ตัวเลข serial** `45658`
 * ต่างกันเพราะใบหลังใส่ number format ไว้ที่ styles ซึ่งเราเมินทั้งไฟล์โดยเจตนา
 * จึงได้ค่าดิบมา — ต้องแปลงเอง
 *
 * ฐานคือ 1899-12-30 ตามระบบ 1900 ของ Excel (ที่เผื่อบั๊กปี 1900 ไว้แล้ว)
 *
 * 🔴 ต้องใช้ `Math.floor` ไม่ใช่ `Math.round` — ส่วนจำนวนเต็มคือวันที่ ส่วนทศนิยมคือ
 * เวลาในวันนั้น การปัดเศษจะดันทุกอย่างที่เกิดหลังเที่ยงไปเป็นวันถัดไป
 * เคยเขียนเป็น round แล้วชั้นตรวจจับได้ (2026-09-08): คอลัมน์ `Cancelled` ของใบ
 * Cancelled มีเศษเวลาทุกค่า เช่น `46142.757265625` = 30/04/2026 18:10 ซึ่งถูกปัด
 * เป็น 01/05/2026 — วันที่ราวครึ่งคอลัมน์จะเพี้ยนไปหนึ่งวันโดยไม่มีอะไรฟ้อง
 */
export function excelSerialToDate(serial: number): Date {
  if (!Number.isFinite(serial) || serial < 1) {
    throw new XlsxError(`Excel serial ไม่ถูกต้อง: ${serial}`);
  }
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
}

/**
 * อ่านค่าเซลล์เป็นวันที่ โดยรองรับทั้งสองแบบที่ HotelTime ใช้
 * คืน null เมื่อเซลล์ว่าง เพื่อให้ผู้เรียกตัดสินใจเองว่าค่าว่างคือความล้มเหลวหรือไม่
 */
export function parseCellDate(raw: string): Date | null {
  const s = raw.trim();
  // "---" คือ "ไม่มีค่า" ของ HotelTime (เช่น Last stay date ของแขกใหม่, ห้องว่างใน Housekeeping all-in-one)
  if (s === '' || /^-+$/.test(s)) return null;

  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (dmy) return new Date(Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])));

  // DD.MM.YY / DD.MM.YYYY — Housekeeping all-in-one เขียนแบบนี้ (เจอ 2026-10-07) · ปีสองหลักคือ 20xx
  const dotted = /^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/.exec(s);
  if (dotted) {
    const y = dotted[3]!.length === 2 ? 2000 + Number(dotted[3]) : Number(dotted[3]);
    return new Date(Date.UTC(y, Number(dotted[2]) - 1, Number(dotted[1])));
  }

  if (/^\d+(\.\d+)?$/.test(s)) return excelSerialToDate(Number(s));

  throw new XlsxError(`อ่านค่าเซลล์เป็นวันที่ไม่ได้: ${JSON.stringify(raw)}`);
}

export function requireColumn(sheet: Sheet, name: string): number {
  const i = findColumn(sheet, name);
  if (i < 0) {
    throw new XlsxError(
      `ไม่พบคอลัมน์ "${name}" ในไฟล์\n  คอลัมน์ที่มี: ${sheet.header.map((h) => JSON.stringify(h)).join(', ')}`,
    );
  }
  return i;
}
