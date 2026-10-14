import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RunKind } from './order.ts';
import { supersededPath, type SiteId } from './placement.ts';

/**
 * `_manifest.json` ของโฟลเดอร์รอบ — ที่มาของ**ไฟล์ดิบ**ทุกไฟล์ในโฟลเดอร์ (ADR-0007) รูปเดียวกันทุก Site
 *
 * ขาอัปโหลดอ่านไฟล์นี้อย่างเดียวก็ส่งได้ ไม่ต้องเปิดไฟล์ข้อมูล: รายงานไหน ตระกูลอะไร ช่วงวันของข้อมูล / เวลาที่ถ่าย, sha256 ตอนดาวน์โหลด
 * (ไบต์ต้องตรงกันตอนส่ง), จำนวนแถว ชื่อชีต และหน้าเว็บต้นทาง · ออกแบบให้ทุก Site ใช้รูปเดียวกัน — HotelTime ใช้ตั้งแต่ใบ 02 ส่วน FoodStory
 * ยังเขียน `_manifest.json` รูปเดิมของตัวเองจนกว่าจะย้ายมาในใบ 06 (ทั้งสองอยู่คนละโฟลเดอร์ของ Site ไม่ชนกัน)
 */

/** รายงานตามวัน / รายงานภาพ (ADR-0008 · CONTEXT.md) */
export type ReportFamily = 'per-day' | 'picture';

export type RawFileEntry = {
  /** ชื่อไฟล์ในโฟลเดอร์รอบ — ชื่อเดียวกับที่ส่งต่อ */
  readonly file: string;
  readonly site: SiteId;
  readonly report: string;
  readonly label: string;
  readonly family: ReportFamily;
  readonly runKind: RunKind;
  /** ช่วงวันของข้อมูลที่ไฟล์ครอบ (ISO date) — รายงานภาพคือช่วงที่ภาพนั้นสรุป เช่น ต้นเดือนถึงวันนี้ หรือวันปฏิบัติการ */
  readonly range: { readonly from: string; readonly to: string };
  /** ช่วงวันที่ที่พบจริงในไฟล์ · null = รายงานที่ไม่มีคอลัมน์วันที่ให้วัด */
  readonly actualRange: { readonly from: string; readonly to: string } | null;
  /** เวลาที่ได้ไฟล์มา เวลาไทยแบบ ISO มี offset (`2026-10-13T12:00:05+07:00`) — เวลาที่ถ่ายของรายงานภาพ */
  readonly takenAt: string;
  /** จำนวนแถวของไฟล์นี้ · ไม่มี = ไม่รู้รายไฟล์ (FoodStory ที่ผ่าเป็นหลายส่วน รู้แค่ยอดรวม) */
  readonly rows?: number;
  /** ทุกชีตตามลำดับแท็บ */
  readonly sheets: readonly string[];
  readonly bytes: number;
  /** sha256 ของไบต์ที่ดาวน์โหลดมา ก่อนแตะอะไรทั้งสิ้น */
  readonly sha256: string;
  /** หน้าเว็บต้นทาง */
  readonly source: string;
  /** ชื่อไฟล์ที่ Site เสนอตอนดาวน์โหลด (หลักฐานที่มา — Site อาจใช้ชื่อเดียวกันข้ามรายงาน) */
  readonly sourceName?: string;
  /** คอลัมน์ที่ใช้กรองวันที่ และคำอธิบายแกนวันที่ของตัวกรอง */
  readonly filterColumn: string;
  readonly filterNote: string;
  /** ระยะที่ baseline รอบนี้ตั้งใจครอบคลุม (เฉพาะ baseline) */
  readonly baselineIntervalDays?: number;
  /** **ภาพปิดงวด** — ภาพของงวด (เดือน/ปี) ที่จบแล้วทั้งงวด (ใบ 05) · ไม่มี = ไม่ใช่ */
  readonly periodClose?: true;
};

/**
 * ไฟล์ที่ถูกย้ายไป `_superseded/` เพราะผลใหม่ได้ชื่อเดียวกันแต่ไบต์ต่างกัน — ไฟล์ที่ export มาไม่ถูกลบหรือทับเลย (ADR-0005)
 * · `was` = รายการเดิมของไฟล์นั้น (null = ไม่มีใน manifest เช่น รอบก่อนตายก่อนเขียน manifest)
 */
export type SupersededEntry = {
  readonly file: string;
  readonly supersededAt: string;
  readonly was: RawFileEntry | null;
};

export type RawManifest = {
  readonly version: 1;
  /** ไฟล์ปัจจุบันในโฟลเดอร์รอบ — ชุดที่ขาอัปโหลดส่ง */
  readonly files: readonly RawFileEntry[];
  readonly superseded?: readonly SupersededEntry[];
};

export const RAW_MANIFEST = '_manifest.json';

/**
 * รวม manifest เดิมของโฟลเดอร์กับไฟล์ของรอบนี้ — เก็บรายการเดิมเฉพาะไฟล์ที่ยังอยู่ในโฟลเดอร์และไม่ถูกไฟล์ชื่อเดียวกันของรอบนี้แทน
 * (ไฟล์ของรายงานตามวันที่ถูกแทนหายจากดิสก์ไปแล้ว รายการของมันจึงหลุดเอง · ภาพฉบับก่อนยังอยู่ รายการจึงอยู่ต่อ) · เรียงตามรายงานแล้วชื่อไฟล์
 */
export function mergeRawManifest(
  previous: readonly RawFileEntry[],
  added: readonly RawFileEntry[],
  filesInFolder: ReadonlySet<string>,
): RawFileEntry[] {
  const replaced = new Set(added.map((e) => e.file));
  return [...previous.filter((e) => filesInFolder.has(e.file) && !replaced.has(e.file)), ...added].sort(
    (a, b) => a.report.localeCompare(b.report) || a.file.localeCompare(b.file),
  );
}

async function readRawManifest(folder: string): Promise<RawManifest | null> {
  try {
    return JSON.parse(await readFile(path.join(folder, RAW_MANIFEST), 'utf8')) as RawManifest;
  } catch {
    return null;
  }
}

/**
 * บันทึกผลของรายงานหนึ่งลง `_manifest.json` ทันทีหลังวางไฟล์ — เขียนต่อรายงาน ไม่รอจบทั้งรอบ ให้ manifest ไปพร้อมกับไฟล์ของมัน
 * (รอบที่ตายกลางทางไม่ทิ้งไฟล์ใหม่ที่ไม่มีรายการ หรือรายการ sha256 เก่าของไฟล์ที่ถูกแทนแล้ว)
 */
export async function recordPublished(
  folder: string,
  added: readonly RawFileEntry[],
  moved: readonly { readonly from: string; readonly to: string }[],
  filesInFolder: ReadonlySet<string>,
  movedAt: string,
): Promise<void> {
  const previous = await readRawManifest(folder);
  const was = new Map((previous?.files ?? []).map((e) => [e.file, e]));
  await writeRawManifest(folder, {
    version: 1,
    files: mergeRawManifest(previous?.files ?? [], added, filesInFolder),
    superseded: [
      ...(previous?.superseded ?? []),
      ...moved.map((m): SupersededEntry => ({ file: m.to, supersededAt: movedAt, was: was.get(m.from) ?? null })),
    ],
  });
}

/** เขียนไฟล์ชั่วคราวแล้ว rename ทับ — manifest เดิมไม่หายถ้าเขียนไม่สำเร็จ */
async function writeRawManifest(folder: string, manifest: RawManifest): Promise<string> {
  const target = path.join(folder, RAW_MANIFEST);
  await writeFile(`${target}.partial`, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await rename(`${target}.partial`, target);
  return target;
}

/**
 * วางไฟล์ดิบลงโฟลเดอร์รอบด้วยชื่อ ISO (ADR-0007) หลังผ่านทุกด่านแล้ว — **ไม่ลบ ไม่ทับไฟล์ที่ export มาเลย** (ADR-0005):
 * ชื่อซ้ำกับไฟล์ที่มีอยู่และไบต์ต่างกัน → ไฟล์เดิมย้ายไป `_superseded/` ก่อน · ไบต์เหมือนกันทุก byte → เก็บชุดเดียว (ไม่ได้ข้อมูลหายแม้ byte เดียว)
 * · ไฟล์ชื่ออื่นของรายงานเดียวกัน (เช่น ภาพฉบับก่อน หรือช่วงวันอื่น) ไม่ถูกแตะ · rename จากที่พักในโฟลเดอร์เดียวกัน (ระบบไฟล์เดียวกัน ไม่คัดลอก)
 * · คืนรายการไฟล์ที่ถูกย้าย ให้ผู้เรียกบันทึกลง manifest
 */
export async function publishRawFiles(
  outDir: string,
  files: readonly { readonly staged: string; readonly entry: RawFileEntry }[],
  movedAt: Date,
): Promise<{ from: string; to: string }[]> {
  const moved: { from: string; to: string }[] = [];
  // FoodStory พักไฟล์นอกโฟลเดอร์รอบ (`_downloads/`) — โฟลเดอร์วันของข้อมูลอาจยังไม่มี (HotelTime พักในโฟลเดอร์รอบเลยไม่เคยเจอ)
  if (files.length > 0) await mkdir(outDir, { recursive: true });
  for (const f of files) {
    const target = path.join(outDir, f.entry.file);
    const existing = await readFile(target).catch(() => null);
    if (existing !== null) {
      if (createHash('sha256').update(existing).digest('hex') === f.entry.sha256) {
        await rm(f.staged);
        continue;
      }
      const to = supersededPath(movedAt, f.entry.file);
      await mkdir(path.join(outDir, path.dirname(to)), { recursive: true });
      await rename(target, path.join(outDir, to));
      moved.push({ from: f.entry.file, to });
    }
    await rename(f.staged, target);
  }
  return moved;
}
