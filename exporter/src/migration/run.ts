import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import { parseCsv } from '../core/csv.ts';
import { readRunRecord, recordRun, type ReportOutcome } from '../core/run-record.ts';
import { PROJECT_ROOT } from '../sites/hoteltime/config.ts';
import { dayCsvTargets, planLegacyMigration, type DayRanges, type LegacyFile, type MigrationPlan } from './plan.ts';

/**
 * คำสั่ง `exporter migrate-legacy` — ticket 05 · ค่าเริ่มต้นอ่านอย่างเดียว (แสดงแผน) · `--apply` ก๊อปเข้าคลังแล้ว
 * ตรวจ sha256 ซ้ำทุกไฟล์ **ไม่ลบโฟลเดอร์เดิม** — การลบให้คนทำเองหลังยืนยัน (ADR-0005)
 */

export type MigrateOptions = { readonly apply: boolean; readonly json: boolean };

const LEGACY_ROOTS = ['downloads', 'downloads-archive', 'downloads-backfill', 'downloads-baseline'];

type Manifest = {
  readonly requested: { readonly from: string; readonly to: string };
  readonly fetchedAt: string;
  readonly totalRows: number;
  readonly files: readonly { readonly actualFrom: string; readonly actualTo: string }[];
};

async function sha256File(file: string): Promise<string> {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

async function walk(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: string[] = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

const posix = (p: string) => p.split(path.sep).join('/');

/** manifest ของรายงานรายวันแต่ละวันใน archive — ใช้ตั้งชื่อ CSV ตามช่วงข้อมูลจริงและสร้าง _run.json ของวันนั้น */
async function readDayManifests(root: string): Promise<Map<string, Map<string, Manifest>>> {
  const out = new Map<string, Map<string, Manifest>>();
  for (const file of await walk(path.join(root, 'downloads-archive'))) {
    const rel = posix(path.relative(root, file));
    const m = /^(downloads-archive\/\d{4}-\d{2}-\d{2})\/raw\/([^/]+)\/manifest\.json$/.exec(rel);
    if (!m) continue;
    const byReport = out.get(m[1]!) ?? new Map<string, Manifest>();
    byReport.set(m[2]!, JSON.parse(await readFile(file, 'utf8')) as Manifest);
    out.set(m[1]!, byReport);
  }
  return out;
}

async function existingTargets(root: string, plan: MigrationPlan): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const { to } of plan.copies) {
    const abs = path.join(root, to);
    if (await stat(abs).then(() => true, () => false)) out.set(to, await sha256File(abs));
  }
  return out;
}

/** `_run.json` + `_summary.txt` ของวันที่ย้ายมา สร้างจาก manifest เดิม — ไม่ทับบันทึกที่มีอยู่แล้ว */
async function writeDayRecords(root: string, manifests: Map<string, Map<string, Manifest>>, plan: MigrationPlan): Promise<number> {
  let written = 0;
  for (const [dir, byReport] of manifests) {
    const day = dir.slice(-10);
    const folder = path.join(root, 'data', 'hoteltime', 'daily', day.slice(0, 7), day);
    if (await readRunRecord(folder)) continue;
    const outcomes: ReportOutcome[] = [];
    for (const [report, m] of byReport) {
      const files = await Promise.all(dayCsvTargets(plan, day, report).map(async (to) => {
        const abs = path.join(root, to);
        // นับแถวจากไฟล์เอง — ช่วงที่คร่อมปีมี CSV สองไฟล์ จะใช้ totalRows ของทั้งรายงานกับทุกไฟล์ไม่ได้
        const rows = Math.max(0, parseCsv(await readFile(abs, 'utf8')).length - 1);
        return { file: path.basename(to), rows, sha256: await sha256File(abs) };
      }));
      const froms = m.files.map((x) => x.actualFrom).sort();
      const tos = m.files.map((x) => x.actualTo).sort();
      outcomes.push({
        report, status: 'ok', rows: m.totalRows, range: m.requested,
        actualRange: froms.length > 0 ? { from: froms[0]!, to: tos[tos.length - 1]! } : null,
        files, attempts: 1,
      });
    }
    const times = [...byReport.values()].map((m) => m.fetchedAt).sort();
    await recordRun(folder, {
      site: 'hoteltime', kind: 'daily', dataThrough: day,
      startedAt: new Date(times[0]!), finishedAt: new Date(times[times.length - 1]!), outcomes,
    });
    written++;
  }
  return written;
}

export async function runMigrateLegacy(opts: MigrateOptions): Promise<number> {
  const root = PROJECT_ROOT;
  const files: LegacyFile[] = [];
  for (const r of LEGACY_ROOTS) {
    for (const abs of await walk(path.join(root, r))) {
      files.push({ path: posix(path.relative(root, abs)), sha256: await sha256File(abs), bytes: (await stat(abs)).size });
    }
  }
  const manifests = await readDayManifests(root);
  const dayRanges: DayRanges = new Map([...manifests].map(([dir, byReport]) =>
    [dir, new Map([...byReport].map(([report, m]) => [report, m.requested]))]));

  const first = planLegacyMigration(files, dayRanges);
  const plan = planLegacyMigration(files, dayRanges, await existingTargets(root, first));

  const bytesOf = new Map(files.map((f) => [f.path, f.bytes]));
  const sum = (paths: readonly string[]) => paths.reduce((n, p) => n + (bytesOf.get(p) ?? 0), 0);
  const mb = (n: number) => `${(n / 1_048_576).toFixed(1)} MB`;
  const summary = {
    files: files.length,
    copies: plan.copies.length,
    copyBytes: sum(plan.copies.map((c) => c.from)),
    duplicates: plan.duplicates.length,
    duplicateBytes: sum(plan.duplicates.map((d) => d.from)),
    ignored: plan.ignored.length,
    alreadyThere: plan.alreadyThere.length,
    conflicts: plan.conflicts.length,
  };

  // แผนเต็มเขียนลง data/_migration/ (ไม่แตะโฟลเดอร์เดิม) — ขั้น plan จึง "อ่านอย่างเดียว" ในแง่ของข้อมูลเดิม
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const planPath = path.join(root, 'data', '_migration', `plan-${stamp}.json`);
  await mkdir(path.dirname(planPath), { recursive: true });
  await writeFile(planPath, `${JSON.stringify({ summary, ...plan }, null, 1)}\n`, 'utf8');

  if (!opts.json) {
    console.log(`${chalk.dim('ไฟล์เดิมทั้งหมด')}      ${summary.files}`);
    console.log(`${chalk.dim('จะก๊อปเข้าคลัง')}       ${summary.copies}  (${mb(summary.copyBytes)})`);
    console.log(`${chalk.dim('สำเนาซ้ำ ไม่ต้องก๊อป')}  ${summary.duplicates}  (${mb(summary.duplicateBytes)} — เนื้อหาเหมือนไฟล์ที่ก๊อปทุก byte)`);
    console.log(`${chalk.dim('มีอยู่ในคลังแล้ว')}     ${summary.alreadyThere}`);
    console.log(`${chalk.dim('ไฟล์จุกจิก ไม่ย้าย')}   ${summary.ignored}`);
    console.log(`${summary.conflicts > 0 ? chalk.red('conflict') : chalk.dim('conflict')}             ${summary.conflicts}`);
    console.log(`${chalk.dim('แผนเต็ม')}             ${path.relative(root, planPath)}`);
  }

  if (!opts.apply) {
    if (opts.json) console.log(JSON.stringify({ ok: true, code: 'planned', applied: false, summary, planPath }, null, 2));
    else console.log(chalk.dim('\nยังไม่ได้ก๊อปอะไร — ตรวจแผนแล้วรันซ้ำด้วย --apply'));
    return 0;
  }
  if (plan.conflicts.length > 0) {
    const text = 'มีปลายทางที่มีไฟล์อยู่แล้วแต่เนื้อหาไม่ตรง — ไม่ก๊อปอะไรเลย ดูรายการ conflicts ในแผน';
    if (opts.json) console.log(JSON.stringify({ ok: false, code: 'conflicts', text, planPath }, null, 2));
    else console.error(chalk.red(`✘ ${text}`));
    return 1;
  }

  const shaOf = new Map(files.map((f) => [f.path, f.sha256]));
  for (const { from, to } of plan.copies) {
    const dest = path.join(root, to);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(path.join(root, from), dest, constants.COPYFILE_EXCL);
    if ((await sha256File(dest)) !== shaOf.get(from)) {
      // ลบเฉพาะไฟล์ที่เพิ่งก๊อปเองในรอบนี้ (COPYFILE_EXCL รับประกันว่าไม่มีของเดิมอยู่) — ไม่งั้นรอบหน้าจะเห็นเป็น conflict ถาวร
      await rm(dest, { force: true });
      throw new Error(`sha256 หลังก๊อปไม่ตรง: ${from} → ${to} — ต้นฉบับยังอยู่ครบ รันซ้ำได้`);
    }
  }
  const records = await writeDayRecords(root, manifests, plan);

  // พิสูจน์ว่าไม่มีอะไรหาย: ทุกไฟล์เดิมที่ไม่ใช่ไฟล์จุกจิกต้องมี sha ตรงกับไฟล์อย่างน้อยหนึ่งไฟล์ในคลัง
  const inStore = new Set<string>();
  for (const abs of await walk(path.join(root, 'data'))) inStore.add(await sha256File(abs));
  const ignored = new Set(plan.ignored.map((i) => i.from));
  const missing = files.filter((f) => !ignored.has(f.path) && !inStore.has(f.sha256)).map((f) => f.path);

  const result = { ok: missing.length === 0, code: 'applied', applied: true, summary, dayRecords: records, missing, planPath };
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\n${chalk.green('✔')} ก๊อปแล้ว ${summary.copies} ไฟล์ · สร้างบันทึกผลรอบของวันที่ย้ายมา ${records} วัน`);
    if (missing.length === 0) {
      console.log(`${chalk.green('✔')} ทุกไฟล์เดิมมีเนื้อหาตรงกับไฟล์ในคลังอย่างน้อยหนึ่งไฟล์ — ไม่มีอะไรหาย`);
      console.log(chalk.dim('โฟลเดอร์เดิมยังอยู่ครบ — หลังเปิดดูคลัง data/ แล้วพอใจ ลบเองได้ด้วย (ใน exporter/):'));
      console.log(chalk.dim('  rm -rf downloads-archive/20* downloads/foodstory downloads/raw downloads/*.csv'));
    } else {
      console.error(chalk.red(`✘ ${missing.length} ไฟล์เดิมไม่มีในคลัง — อย่าลบโฟลเดอร์เดิม ดู missing ใน --json`));
    }
  }
  return missing.length === 0 ? 0 : 1;
}
