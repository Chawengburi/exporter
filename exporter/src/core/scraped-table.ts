/**
 * ไฟล์ดิบแบบ scrape (ADR-0012) — ตารางข้อความจากหน้าเว็บที่ไม่มีปุ่ม export → CSV + สถิติ + ด่านความครบ · ฟังก์ชันล้วน ไม่แตะเบราว์เซอร์
 *
 * เซลล์ทุกช่องเป็นข้อความตามหน้าเว็บทุกตัวอักษร (ไม่แปลงวันที่ ไม่ตัด ไม่กรองแถว) · ข้อความ error บอกได้แค่จำนวน ชื่อคอลัมน์ และวัน —
 * **ห้ามมีเนื้อแถว** (ชื่อผู้ใช้ เลขจอง ห้อง) เพราะข้อความล้มไปอยู่ใน log / `_run.json` / Discord
 */

export class ScrapeError extends Error {
  override readonly name = 'ScrapeError';
}

export type ScrapeSpec = {
  /** หัวตารางที่คาด ต้องตรงเป๊ะ (รวมคอลัมน์ไอคอนที่ไม่มีชื่อ) */
  readonly expectedHeader: readonly string[];
  /** เพดานแถวของหน้า — ได้แถวเท่าเพดานขึ้นไป = ถือว่าถูกตัด */
  readonly rowCap: number;
  /** คอลัมน์วันที่ ข้อความรูป `DD/MM/YYYY HH:MM:SS` */
  readonly dateColumn: string;
  /** วันของข้อมูล (ISO `YYYY-MM-DD`) — ทุกแถวต้องอยู่ในวันนี้ */
  readonly day: string;
};

export type ScrapedFile = {
  readonly csv: string;
  readonly rowCount: number;
  /** เวลาแรก/สุดท้ายตามเวลาจริง (ข้อความเดิมจากหน้า) ไม่ขึ้นกับลำดับแถว */
  readonly firstAt: string;
  readonly lastAt: string;
};

const DATE_TEXT = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/;

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
}

/** เวลาเป็นตัวเลขเทียบกันได้ (YYYYMMDDHHMMSS) · อ่านไม่ออก = null */
function sortKey(text: string): { key: number; isoDay: string } | null {
  const m = DATE_TEXT.exec(text);
  if (m === null) return null;
  return { key: Number(`${m[3]}${m[2]}${m[1]}${m[4]}${m[5]}${m[6]}`), isoDay: `${m[3]}-${m[2]}-${m[1]}` };
}

export function scrapedTableToRawFile(table: readonly (readonly string[])[], spec: ScrapeSpec): ScrapedFile {
  const [header, ...body] = table;
  if (header === undefined || header.length !== spec.expectedHeader.length || header.some((h, i) => h !== spec.expectedHeader[i])) {
    // แถวแรกที่ได้อาจเป็นแถวข้อมูล (ตารางไม่มีหัว) — แสดงเฉพาะเมื่อไม่ใช่ (ไม่มีเซลล์รูปวันที่เวลา) และตัดความยาว กันชื่อผู้ใช้/เลขจองรั่วลง log
    const got = header ?? [];
    const looksLikeData = got.some((c) => DATE_TEXT.test(c));
    const gotText = looksLikeData ? `${got.length} คอลัมน์ (แถวแรกเหมือนแถวข้อมูล ไม่ใช่หัวตาราง — ไม่แสดงเนื้อหา)` : JSON.stringify(got.map((c) => c.slice(0, 40)));
    throw new ScrapeError(
      `หัวตารางไม่ตรงที่คาด — หน้าเว็บน่าจะเปลี่ยนโครงสร้าง ต้องสำรวจใหม่\n` +
        `  คาด: ${JSON.stringify(spec.expectedHeader)}\n  ได้: ${gotText}`,
    );
  }
  if (body.length === 0) {
    throw new ScrapeError(
      'ได้ 0 แถวทั้งวัน — นับเป็นล้ม ไม่ใช่ "ว่าง" (ระบบที่ใช้งานอยู่มีเหตุการณ์ทุกวัน 0 แถวแปลว่าอ่านผิดหรือฟิลเตอร์ไม่ทำงาน) (ADR-0012)',
    );
  }
  if (body.length >= spec.rowCap) {
    throw new ScrapeError(`ได้ ${body.length} แถว ถึงเพดาน ${spec.rowCap} — หน้าเว็บตัดแถวที่เก่าที่สุดทิ้ง ต้องแบ่งช่วงเวลาแล้วดึงใหม่`);
  }
  const iDate = spec.expectedHeader.indexOf(spec.dateColumn);
  let first: { key: number; text: string } | null = null;
  let last: { key: number; text: string } | null = null;
  let outside = 0;
  let unreadable = 0;
  for (const r of body) {
    const text = r[iDate] ?? '';
    const k = sortKey(text);
    if (k === null) {
      unreadable++;
      continue;
    }
    if (k.isoDay !== spec.day) outside++;
    if (first === null || k.key < first.key) first = { key: k.key, text };
    if (last === null || k.key > last.key) last = { key: k.key, text };
  }
  if (unreadable > 0) throw new ScrapeError(`วันที่ในคอลัมน์ ${spec.dateColumn} อ่านไม่ออก ${unreadable} แถว (คาดรูป DD/MM/YYYY HH:MM:SS)`);
  if (outside > 0) throw new ScrapeError(`มี ${outside} แถวอยู่นอกวัน ${spec.day} — ฟิลเตอร์วันที่ของหน้าเว็บไม่ทำงานตามที่สั่ง`);

  const lines = [header, ...body].map((r) => r.map(csvCell).join(','));
  return { csv: `${lines.join('\n')}\n`, rowCount: body.length, firstAt: first!.text, lastAt: last!.text };
}
