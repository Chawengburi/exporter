import { formatDMY, type DateRange } from './order.ts';
import type { NamedSheet } from './xlsx.ts';

/**
 * ชั้นตรวจ — เทียบไฟล์ที่ได้กับ "ใบสั่ง" ที่ runner ถือมาตั้งแต่ก่อนเปิดเบราว์เซอร์
 *
 * หลักการ (artifact §06): runner รู้อยู่แล้วว่ามันเพิ่งไปขออะไร ช่วงไหน จึงไม่ต้องให้ใคร
 * *ตัดสิน* ว่าไฟล์ถูกไหม แค่ *เทียบ* กับใบสั่ง — เปลี่ยนปัญหาวิจารณญาณเป็นปัญหาเปรียบเทียบค่า
 *
 * ไฟล์นี้เป็น logic ล้วน ไม่แตะเบราว์เซอร์ **และไม่ผูกกับ site ไหนเลย** (ADR-0004) — ส่วนที่
 * ตรวจไฟล์หนึ่งก้อนเทียบกับนิยามรายงานของ site หนึ่ง (เดิมคือ `verifyChunk`) ย้ายไปอยู่ที่
 * `sites/hoteltime/verify.ts` แล้ว เพราะผูกกับรูปร่าง `Report` ของ HotelTime โดยเฉพาะ
 * (`hasRowCap`, `dateColumn`, `skipDateCoverageCheck` ฯลฯ) — ไฟล์นี้เหลือแค่ส่วนที่พิสูจน์แล้วว่า
 * ใช้ร่วมกันข้าม site ได้จริง: เทียบก้อนสะสมกับช่วงที่สั่ง (`verifyMerged`) และเทียบ manifest
 * สองรอบ (`compareManifestFiles`)
 */

export class VerifyError extends Error {
  override readonly name: string = 'VerifyError';
}

export type ChunkVerdict = {
  readonly range: DateRange;
  readonly filePath: string;
  /** ผลรวมแถวข้อมูลของทุกชีต */
  readonly rowCount: number;
  /** ทุกชีตของไฟล์ตามลำดับแท็บ (รวมชีตว่าง) — ไม่ใช่แค่ชีตแรก */
  readonly sheets: readonly NamedSheet[];
  /** ช่วงวันที่ที่พบจริงในไฟล์ (จากคอลัมน์วันที่ของรายงาน) */
  readonly actualSpan: { readonly from: Date; readonly to: Date };
};

/**
 * ตรวจผลรวมของทั้งรายงานหลังดึงครบทุกก้อน
 *
 * 🔴 ด่านสำคัญตรงนี้คือ **ก้อนทั้งหมดต้องปูเต็มช่วงที่สั่งพอดี** — จับกรณีที่ก้อนหนึ่ง
 * หายไปเงียบ ๆ หลังการผ่าครึ่ง ซึ่งเป็นวิธีที่ข้อมูลจะขาดโดยไม่มีอะไรฟ้อง
 * ต้องนับก้อนที่ว่างเปล่าเข้ามาด้วย เพราะ "ว่างจริง" ก็ถือว่าครอบคลุมแล้ว
 *
 * ⚠️ เคยเขียนด่าน "นับแถวซ้ำ" ไว้ตรงนี้แล้วถอดออก (2026-09-08) — **แถวที่เหมือนกันเป๊ะ
 * เป็นข้อมูลที่ถูกต้อง** เพราะหนึ่ง reservation ที่จองหลายห้องประเภทเดียวกันและยังไม่ระบุ
 * เลขห้อง จะได้หลายแถวที่ทุกช่องเหมือนกัน (ยืนยันจากข้อมูลจริง: 764 แถวมีซ้ำแบบนี้ 30 แถว
 * และหน้าเว็บเองก็บอก "55 reservations → 65 rooms") · การกันส่งซ้ำเข้าคลังเป็นเรื่องของ
 * ขาอัปโหลดที่ระดับ *ไฟล์* ไม่ใช่ระดับแถว
 */
export function verifyMerged(
  verdicts: readonly ChunkVerdict[],
  emptyRanges: readonly DateRange[],
  requested: DateRange,
): { totalRows: number; coveredChunks: number } {
  const covered = [...verdicts.map((v) => v.range), ...emptyRanges];
  assertCoversExactly(covered, requested);

  return {
    totalRows: verdicts.reduce((n, v) => n + v.rowCount, 0),
    coveredChunks: covered.length,
  };
}

export type ManifestFileEntry = {
  readonly file: string;
  readonly rows: number;
  readonly sha256: string;
};

export type DriftEntry =
  | { readonly kind: 'unchanged'; readonly file: string }
  | {
      readonly kind: 'changed';
      readonly file: string;
      readonly oldRows: number;
      readonly newRows: number;
      readonly oldSha256: string;
      readonly newSha256: string;
    }
  | { readonly kind: 'missing'; readonly file: string; readonly oldRows: number }
  | { readonly kind: 'added'; readonly file: string; readonly newRows: number };

/**
 * เทียบก้อนของการดึงสองรอบ (จาก `files` ใน manifest.json) โดยใช้ชื่อไฟล์เป็นคีย์ —
 * ชื่อไฟล์เข้ารหัสช่วงวันที่ไว้แล้ว (`<from>_<to>.xlsx`) จึงเทียบก้อนเดียวกันได้ตรง ๆ
 * โดยไม่ต้องแยกแยะช่วงวันที่เอง
 *
 * ใช้ตอบคำถาม "ข้อมูลถูกแก้ย้อนหลังไหม" — `sha256`ต่างกันทั้งที่ชื่อไฟล์ (ช่วงวันที่) เดิม
 * คือหลักฐานตรงที่สุดว่าเนื้อในเปลี่ยน ไม่ต้องเปิดไฟล์เทียบเอง
 */
export function compareManifestFiles(
  oldFiles: readonly ManifestFileEntry[],
  newFiles: readonly ManifestFileEntry[],
): DriftEntry[] {
  const oldByFile = new Map(oldFiles.map((f) => [f.file, f]));
  const newByFile = new Map(newFiles.map((f) => [f.file, f]));
  const drift: DriftEntry[] = [];

  for (const [file, oldEntry] of oldByFile) {
    const newEntry = newByFile.get(file);
    if (newEntry === undefined) {
      drift.push({ kind: 'missing', file, oldRows: oldEntry.rows });
    } else if (newEntry.sha256 === oldEntry.sha256) {
      drift.push({ kind: 'unchanged', file });
    } else {
      drift.push({
        kind: 'changed',
        file,
        oldRows: oldEntry.rows,
        newRows: newEntry.rows,
        oldSha256: oldEntry.sha256,
        newSha256: newEntry.sha256,
      });
    }
  }

  for (const [file, newEntry] of newByFile) {
    if (!oldByFile.has(file)) {
      drift.push({ kind: 'added', file, newRows: newEntry.rows });
    }
  }

  return drift;
}

/** ก้อนทั้งหมดต่อกันสนิทและปูเต็มช่วงที่สั่งพอดี ไม่มีรู ไม่ทับกัน */
function assertCoversExactly(ranges: readonly DateRange[], requested: DateRange): void {
  if (ranges.length === 0) throw new VerifyError('ไม่มีก้อนใดถูกดึงเลย');

  const sorted = [...ranges].sort((a, b) => a.from.getTime() - b.from.getTime());
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;

  if (first.from.getTime() !== requested.from.getTime() || last.to.getTime() !== requested.to.getTime()) {
    throw new VerifyError(
      `ก้อนที่ดึงมาไม่ครอบคลุมช่วงที่สั่ง\n` +
        `  สั่ง:     ${formatDMY(requested.from)} → ${formatDMY(requested.to)}\n` +
        `  ครอบคลุม: ${formatDMY(first.from)} → ${formatDMY(last.to)}`,
    );
  }

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    const gapDays = Math.round((cur.from.getTime() - prev.to.getTime()) / 86_400_000);
    if (gapDays !== 1) {
      throw new VerifyError(
        gapDays > 1
          ? `มีช่วงที่ไม่ได้ดึง: ${formatDMY(prev.to)} → ${formatDMY(cur.from)} ขาดไป ${gapDays - 1} วัน`
          : `ก้อนทับกัน: ${formatDMY(prev.from)}–${formatDMY(prev.to)} กับ ${formatDMY(cur.from)}–${formatDMY(cur.to)}`,
      );
    }
  }
}
