import { ROW_CAP, formatDMY, type DateRange } from '../../core/order.ts';
import { VerifyError, type ChunkVerdict } from '../../core/verify.ts';
import { parseCellDate, readSheets, requireColumn, type Sheet } from '../../core/xlsx.ts';
import type { Report } from './reports/_types.ts';

/**
 * ตรวจไฟล์ที่ export มาจาก HotelTime หนึ่งก้อน เทียบกับนิยามรายงาน (`Report`) ของ HotelTime
 * โดยเฉพาะ — ย้ายมาจาก `core/verify.ts` เดิม (ADR-0004): ใช้ `report.hasRowCap`/`dateColumn`/
 * `boundaryToleranceDays`/`skipDateCoverageCheck`/`expectedColumns` ซึ่งเป็น field เฉพาะของ
 * `Report` แบบ HotelTime ไม่มีความหมายกับ site อื่น — `VerifyError`/`ChunkVerdict` ที่ใช้ร่วมกัน
 * ข้าม site ได้จริงยังอยู่ที่ `core/verify.ts` เหมือนเดิม
 *
 * ลำดับการตรวจเรียงจาก "พังชัด" ไป "พังเงียบ" เพื่อให้ข้อความ error ชี้ต้นเหตุที่แท้จริง
 */

/**
 * ชนเพดาน 2000 ของ HotelTime — แยกชนิดไว้เพราะผู้เรียก "แก้ได้" ด้วยการผ่าครึ่งช่วง
 * ต่างจาก VerifyError อื่นที่ต้องเรียกคน
 */
export class RowCapError extends VerifyError {
  override readonly name = 'RowCapError';
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * หัวตารางตรงกับนิยามไหม — รายงานที่คอลัมน์ท้ายเปลี่ยนตามข้อมูล (`trailingColumns`) ตรวจคอลัมน์นำ และต้องมีคอลัมน์ท้ายอย่างน้อยหนึ่งคอลัมน์
 * (ตารางที่มีแค่คอลัมน์นำไม่ใช่รายงานที่ตั้งใจ — กันหน้าอื่นที่บังเอิญขึ้นต้นเหมือนกันผ่านด่าน)
 */
function headerMatches(header: readonly string[], report: Report): boolean {
  const n = report.expectedColumns.length;
  return report.trailingColumns === 'data-driven'
    ? header.length > n && sameList(header.slice(0, n), report.expectedColumns)
    : sameList(header, report.expectedColumns);
}

export function verifyChunk(
  report: Report,
  range: DateRange,
  filePath: string,
  reportedRowCount: number | null,
): ChunkVerdict {
  // ทุกชีต ไม่ใช่แค่ชีตแรก (ticket 01 ของ exporter-daily-per-day-raw) — บางรายงานแตกหนึ่งชีตต่อกลุ่ม เช่น
  // occupancy-by-nationality-stay-reason · ชีตที่ไม่มีแถวเลยไม่ต้องมีหัวตาราง แต่ทั้งไฟล์ต้องมีอย่างน้อยหนึ่งชีตที่มีแถว
  const sheets = readSheets(filePath); // โยน XlsxError เองพร้อมข้อความที่ใช้ได้
  const sheetsWithRows = sheets.filter((s) => s.header.length > 0);
  if (sheetsWithRows.length === 0) throw new VerifyError(`ไม่พบแถวใดเลยในชีต: ${filePath}`);

  // 1) หัวตารางต้องตรงเป๊ะทุกชีต — ต่างเมื่อไหร่แปลว่ารายงานเปลี่ยน ต้องสำรวจใหม่ก่อนเชื่อข้อมูล
  for (const s of sheetsWithRows) {
    if (!headerMatches(s.header, report)) {
      throw new VerifyError(
        `หัวตารางไม่ตรงกับที่บันทึกไว้สำหรับรายงาน "${report.id}"` +
          (sheets.length > 1 ? ` (ชีต "${s.name}")` : '') +
          `\n  คาดหวัง (${report.expectedColumns.length}): ${report.expectedColumns.join(' | ')}\n` +
          `  ได้จริง  (${s.header.length}): ${s.header.join(' | ')}\n` +
          `  รายงานน่าจะถูกแก้ที่ฝั่ง HotelTime — ต้องสำรวจใหม่และอัปเดต expectedColumns ก่อนใช้ข้อมูลนี้`,
      );
    }
  }

  // หัวตารางเท่ากันทุกชีตแล้ว ตำแหน่งคอลัมน์จึงใช้ร่วมกันได้ — ด่านที่เหลือตรวจแถวของทุกชีตรวมกัน
  const sheet: Sheet = { header: sheetsWithRows[0]!.header, rows: sheetsWithRows.flatMap((s) => s.rows) };
  const rowCount = sheet.rows.length;

  // 2) รายงานว่างคือความล้มเหลว ไม่ใช่ผลลัพธ์
  //    (runner ควรกรองก้อนว่างออกด้วย hasResults ตั้งแต่ก่อน export แล้ว มาถึงนี่แปลว่าผิดปกติ)
  if (rowCount === 0) {
    throw new VerifyError(
      `ไฟล์ของช่วง ${formatDMY(range.from)}–${formatDMY(range.to)} ไม่มีแถวข้อมูลเลย\n` +
        `  ถ้าช่วงนี้ควรไม่มีข้อมูลจริง ๆ runner ต้องข้ามตั้งแต่ก่อน export ไม่ใช่มาตรวจตอนนี้`,
    );
  }

  // 3) 🔴 ชนเพดาน — ต้องตรวจ "ก่อน" เทียบกับตัวเลขบนหน้าเว็บ เพราะตัวเลขนั้นถูกคำนวณ
  //    หลังโดนตัดแล้ว มันจึงตรงกับไฟล์เสมอและกลบปัญหานี้ทั้งหมด
  if (report.hasRowCap && rowCount === ROW_CAP) {
    throw new RowCapError(
      `ได้ ${ROW_CAP} แถวพอดีสำหรับช่วง ${formatDMY(range.from)}–${formatDMY(range.to)} — ถือว่าชนเพดานของ HotelTime\n` +
        `  ข้อมูลถูกตัดเงียบ ๆ โดยไม่มี error · ต้องผ่าครึ่งช่วงแล้วดึงใหม่`,
    );
  }

  // 4) เทียบกับจำนวนที่หน้าเว็บบอก (เฉพาะใบที่ตัวเลขเชื่อถือได้)
  if (reportedRowCount !== null && reportedRowCount !== rowCount) {
    throw new VerifyError(
      `จำนวนแถวไม่ตรงกับที่หน้าเว็บแสดง — หน้าเว็บบอก ${reportedRowCount} แต่ไฟล์มี ${rowCount} แถว\n` +
        `  ช่วง ${formatDMY(range.from)}–${formatDMY(range.to)} · อาจโดนแบ่งหน้า หรือไฟล์ที่ได้เป็นของผลลัพธ์เก่า`,
    );
  }

  // report.skipDateCoverageCheck (ADR-0003 §3, ticket 03) ข้ามด่านที่ 5 ทั้งหมดตั้งแต่การอ่าน
  // คอลัมน์วันที่เลย — บางรายงาน (เช่น Housekeeping) ไม่มีคอลัมน์วันที่ที่มีค่าครบทุกแถวด้วยซ้ำ
  // (ห้องว่างไม่มีแขก ช่อง Arrival/Departure จึงว่าง) ไม่ใช่แค่ "ไม่ตรงช่วง" — actualSpan ใช้
  // ช่วงที่สั่งตรง ๆ แทน (ซื่อสัตย์กว่าเดาว่า "ตรวจแล้ว")
  if (report.skipDateCoverageCheck) {
    return { range, filePath, rowCount, sheets, actualSpan: { from: range.from, to: range.to } };
  }

  // 5ข) รายงานแบบช่วงพักที่คร่อมช่วงที่ขอ — แต่ละแถวต้องแตะช่วงที่สั่ง (ไม่ใช่อยู่ในช่วงพอดี)
  if (report.overlapColumns !== undefined) {
    const fromIdx = requireColumn(sheet, report.overlapColumns.from);
    const toIdx = requireColumn(sheet, report.overlapColumns.to);
    const pairs = sheet.rows.map((r) => [r[fromIdx] ?? '', r[toIdx] ?? ''] as const);
    return { range, filePath, rowCount, sheets, actualSpan: checkOverlapCoverage(pairs, range, report.overlapColumns) };
  }

  // 5) ช่วงวันที่ในไฟล์ต้องอยู่ในก้อนที่สั่ง — ด่านนี้คือตัวที่จับเพดาน 2000 ได้ตอนแรก
  //    และเป็นด่านเดียวที่จับ "filter ไม่ทำงาน" ได้จริง
  const dateCol = requireColumn(sheet, report.dateColumn);
  const dates: Date[] = [];
  let blanks = 0;
  for (const row of sheet.rows) {
    const d = parseCellDate(row[dateCol] ?? '');
    if (d === null) blanks += 1;
    else dates.push(d);
  }

  if (blanks > 0) {
    throw new VerifyError(
      `คอลัมน์ "${report.dateColumn}" มีค่าว่าง ${blanks} จาก ${rowCount} แถว\n` +
        `  ตรวจช่วงวันที่ต่อไม่ได้ถ้าไม่รู้ว่าแถวเหล่านั้นอยู่ช่วงไหน`,
    );
  }

  // reduce แทน Math.min(...) — หนึ่งค่าต่อแถว ช่วงยาว ๆ จะเกินจำนวน argument ที่ stack รับได้ (ดู core/xlsx.ts)
  const times = dates.map((d) => d.getTime());
  const from = new Date(times.reduce((a, b) => (b < a ? b : a)));
  const to = new Date(times.reduce((a, b) => (b > a ? b : a)));

  const slackMs = report.boundaryToleranceDays * 86_400_000;
  if (from.getTime() < range.from.getTime() - slackMs || to.getTime() > range.to.getTime() + slackMs) {
    throw new VerifyError(
      `ช่วงวันที่ในไฟล์หลุดออกนอกที่สั่ง — filter ไม่ได้ทำงานอย่างที่คิด\n` +
        `  สั่ง:    ${formatDMY(range.from)} → ${formatDMY(range.to)}` +
        (report.boundaryToleranceDays > 0 ? ` (เผื่อขอบ ±${report.boundaryToleranceDays} วัน)` : '') +
        `\n  ได้จริง: ${formatDMY(from)} → ${formatDMY(to)}  (คอลัมน์ "${report.dateColumn}")`,
    );
  }

  return { range, filePath, rowCount, sheets, actualSpan: { from, to } };
}

/**
 * ด่านที่ 5 สำหรับรายงานแบบ "ช่วงพักที่คร่อมช่วงที่ขอ" (City tax, Profiles — แถวคือการเข้าพักที่ทับช่วงที่เลือก ไม่ใช่รายการที่เกิดใน
 * ช่วงนั้น): ทุกแถวต้องมีวันเริ่ม ≤ ปลายช่วง และวันจบ ≥ ต้นช่วง · ยังจับ "filter ไม่ทำงาน" ได้ (แถวนอกช่วงทั้งก้อน) โดยไม่ล้มกับแขก
 * ที่เข้าพักก่อนช่วง · คืนช่วงจริง = วันเริ่มต่ำสุด–วันจบสูงสุด
 */
export function checkOverlapCoverage(
  rows: readonly (readonly [string, string])[],
  range: DateRange,
  columns: { readonly from: string; readonly to: string },
): { from: Date; to: Date } {
  let blanks = 0;
  let outside = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const [a, b] of rows) {
    const from = parseCellDate(a);
    const to = parseCellDate(b);
    if (from === null || to === null) {
      blanks += 1;
      continue;
    }
    if (from.getTime() > range.to.getTime() || to.getTime() < range.from.getTime()) outside += 1;
    min = Math.min(min, from.getTime());
    max = Math.max(max, to.getTime());
  }
  if (blanks > 0) {
    throw new VerifyError(
      `คอลัมน์ "${columns.from}"/"${columns.to}" มีค่าว่าง ${blanks} จาก ${rows.length} แถว — ตรวจไม่ได้ว่าแถวเหล่านั้นคร่อมช่วงไหน`,
    );
  }
  if (outside > 0) {
    throw new VerifyError(
      `${outside} แถวไม่คร่อมช่วงที่สั่ง ${formatDMY(range.from)} → ${formatDMY(range.to)} — filter ไม่ได้ทำงานอย่างที่คิด\n` +
        `  (คอลัมน์ "${columns.from}" → "${columns.to}")`,
    );
  }
  return { from: new Date(min), to: new Date(max) };
}
