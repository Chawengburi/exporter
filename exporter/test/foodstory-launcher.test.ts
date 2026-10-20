import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// ticket 11: ไฟล์ดับเบิลคลิกของพนักงาน — รันสคริปต์จริงในโฟลเดอร์ exporter ปลอม ที่ `src/index.ts` เป็นตัวแทนที่เขียน `_run.json`
// ลงคลังแบบ exporter (หรือไม่เขียนเลย = ล้มก่อนจบ เช่น captcha ไม่ทัน) แล้วจบด้วย exit code ที่กำหนด — ไม่เปิดเบราว์เซอร์ · การใช้งานจริง
// พิสูจน์ด้วยคนลองตามคู่มือ (seam ตกลงกับเจ้าของ 2026-10-12) · สรุปบนจออ่านจาก `_run.json` ที่รวมผลทั้งโฟลเดอร์ ไม่ใช่ข้อความที่ exporter พิมพ์
const LAUNCHER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'launchers', 'foodstory-daily.command');

const tempDirs: string[] = [];
after(async () => {
  for (const d of tempDirs) await rm(d, { recursive: true, force: true });
});
async function tempDir(prefix: string): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(d);
  return d;
}

type ReportState = { readonly status: 'ok' | 'failed'; readonly previousOk?: boolean };
type Fake = { readonly dir: string; readonly launcher: string; readonly argsFile: string };

type FakeFolder = {
  readonly day: string; readonly reports: Readonly<Record<string, ReportState>>; readonly warnings?: readonly string[];
  /** เวลาเริ่มรอบ (UTC ISO) — โฟลเดอร์ที่วันตรงกับวันที่เริ่มรอบ (เวลาไทย) คือโฟลเดอร์รายงาน snapshot ของวันนี้ */
  readonly startedAt?: string;
};

/**
 * `reports` = สถานะล่าสุดรายใบใน `_run.json` ของโฟลเดอร์เมื่อวาน · `folders` = รอบที่เขียนหลายโฟลเดอร์ (เติมวันที่ขาด + snapshot ของวันนี้ — ใบ 06)
 * · ไม่ระบุทั้งคู่ = ตัวแทนไม่เขียน `_run.json` เลย
 */
async function fakeExporter(opts: {
  env?: boolean;
  nodeModules?: boolean;
  exit?: number;
  reports?: Readonly<Record<string, ReportState>>;
  folders?: readonly FakeFolder[];
} = {}): Promise<Fake> {
  const dir = await tempDir('fs-launcher-');
  await mkdir(path.join(dir, 'launchers'));
  await mkdir(path.join(dir, 'src'));
  const launcher = path.join(dir, 'launchers', 'foodstory-daily.command');
  await copyFile(LAUNCHER, launcher);
  await chmod(launcher, 0o755);
  if (opts.env ?? true) await writeFile(path.join(dir, '.env'), 'FOODSTORY_EMAIL=x\n');
  if (opts.nodeModules ?? true) await mkdir(path.join(dir, 'node_modules'));
  const argsFile = path.join(dir, 'args.json');
  const toRecord = (f: FakeFolder, runs: boolean) => ({
    site: 'foodstory', kind: 'daily', dataThrough: f.day, skipped: [],
    // รอบเดิมของ ticket 11 ไม่มีรายการรอบ (runs ว่าง) — launcher ต้องนับทุกใบในโฟลเดอร์เหมือนเดิม
    runs: runs ? [{ startedAt: f.startedAt ?? 'x', finishedAt: 'x', reports: Object.keys(f.reports), ...(f.warnings ? { warnings: f.warnings } : {}) }] : [],
    reports: Object.fromEntries(Object.entries(f.reports).map(([id, r]) => [id, {
      report: id, status: r.status,
      ...(r.previousOk ? { previousOk: { finishedAt: '2026-10-12T05:00:00.000Z', rows: 1 } } : {}),
    }])),
  });
  const writes = opts.folders !== undefined
    ? opts.folders.map((f) => ({ dir: path.join(dir, 'data', 'foodstory', 'daily', f.day.slice(0, 7), f.day), record: toRecord(f, true) }))
    : opts.reports !== undefined
      ? [{ dir: path.join(dir, 'data', 'foodstory', 'daily', '2026-10', '2026-10-11'), record: toRecord({ day: '2026-10-11', reports: opts.reports }, false) }]
      : [];
  await writeFile(path.join(dir, 'src', 'index.ts'), `
    import { mkdirSync, writeFileSync } from 'node:fs';
    writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));
    for (const w of ${JSON.stringify(writes)}) {
      mkdirSync(w.dir, { recursive: true });
      writeFileSync(w.dir + '/_run.json', JSON.stringify(w.record));
    }
    process.exit(${opts.exit ?? 0});
  `);
  return { dir, launcher, argsFile };
}

// 17:00 เวลาไทย 2026-10-14 — รอบที่เติมวันที่ 12, 13 และถ่าย snapshot ของวันที่ 14
const STARTED = '2026-10-14T10:00:00.000Z';

const all = (n: number, state: ReportState): Record<string, ReportState> =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`r${i}`, state]));

function run(file: string): { code: number | null; out: string } {
  // stdin = ปุ่มที่กดตอน "กดปุ่มใดก็ได้เพื่อปิดหน้าต่าง"
  const r = spawnSync('bash', [file], { input: 'x', encoding: 'utf8', timeout: 30_000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test('ผ่านครบ: รัน exporter รอบรายวัน FoodStory แบบเปิดเบราว์เซอร์ แล้วสรุปภาษาไทยว่าเสร็จ ไม่ต้องทำอะไรต่อ', async () => {
  const fake = await fakeExporter({ reports: all(49, { status: 'ok' }) });
  const { code, out } = run(fake.launcher);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(await readFile(fake.argsFile, 'utf8')), ['export', '--site', 'foodstory', '--report', 'all', '--daily', '--headful']);
  assert.match(out, /เสร็จเรียบร้อย[\s\S]*49\/49/);
  assert.match(out, /ปิดหน้าต่างนี้ได้เลย/);
});

test('ได้บางใบ: บอกว่าได้กี่ใบ ไม่ผ่านกี่ใบ และต้องทำอะไร (ดับเบิลคลิกใหม่ แล้วค่อยแจ้งผู้ดูแลระบบ)', async () => {
  const failed = { status: 'failed' } as const;
  const fake = await fakeExporter({ exit: 2, reports: { ...all(45, { status: 'ok' }), f1: failed, f2: failed, f3: failed, f4: failed } });
  const { code, out } = run(fake.launcher);
  assert.equal(code, 2);
  assert.match(out, /ได้ 45 จาก 49[\s\S]*ไม่ผ่าน 4 รายงาน/);
  assert.match(out, /ดับเบิลคลิก[\s\S]*อีกครั้ง/);
  assert.match(out, /ผู้ดูแลระบบ/);
});

test('รันซ้ำแล้วรอบนี้ล้มบางใบ แต่ไฟล์ที่ผ่านของรอบก่อนในโฟลเดอร์ยังอยู่ = โฟลเดอร์ครบ → ขึ้นว่าเสร็จ ไม่ให้แจ้งผู้ดูแลระบบเปล่า ๆ', async () => {
  const kept = { status: 'failed', previousOk: true } as const;
  const fake = await fakeExporter({ exit: 2, reports: { ...all(47, { status: 'ok' }), a: kept, b: kept } });
  const { code, out } = run(fake.launcher);
  assert.equal(code, 0);
  assert.match(out, /เสร็จเรียบร้อย[\s\S]*49\/49/);
});

test('ล้มก่อนจบ (ไม่มี _run.json — เช่น กด captcha ไม่ทัน 5 นาที, อินเทอร์เน็ต): บอกสาเหตุที่พบบ่อย ให้ลองใหม่/แจ้งผู้ดูแลระบบ', async () => {
  const fake = await fakeExporter({ exit: 1 });
  const { code, out } = run(fake.launcher);
  assert.equal(code, 1);
  assert.match(out, /ไม่สำเร็จ/);
  assert.match(out, /captcha/i);
  assert.match(out, /ผู้ดูแลระบบ/);
});

test('เข้าสู่ระบบได้แต่ไม่ได้รายงานเลยสักใบ: ไม่โทษ captcha — ให้แจ้งผู้ดูแลระบบ', async () => {
  const fake = await fakeExporter({ exit: 1, reports: all(49, { status: 'failed' }) });
  const { code, out } = run(fake.launcher);
  assert.equal(code, 1);
  assert.match(out, /ไม่ได้รายงานเลย/);
  assert.doesNotMatch(out, /captcha/i);
  assert.match(out, /ผู้ดูแลระบบ/);
});

test('ไม่มีไฟล์ตั้งค่า .env: บอกชัด ไม่เริ่มรัน', async () => {
  const fake = await fakeExporter({ env: false });
  const { code, out } = run(fake.launcher);
  assert.equal(code, 1);
  assert.match(out, /\.env/);
  assert.equal(existsSync(fake.argsFile), false);
});

test('ยังไม่ได้ติดตั้ง (ไม่มี node_modules): บอกชัด ไม่เริ่มรัน', async () => {
  const fake = await fakeExporter({ nodeModules: false });
  const { code, out } = run(fake.launcher);
  assert.equal(code, 1);
  assert.match(out, /npm install/);
  assert.equal(existsSync(fake.argsFile), false);
});

test('ดับเบิลคลิกซ้ำระหว่างรอบก่อนของโฟลเดอร์นี้ยังรันอยู่: บอกว่ารันอยู่แล้ว ไม่เริ่มรอบที่สอง · ตัวล็อกค้างจากรอบที่ตายไปแล้วไม่ขวาง', async () => {
  const fake = await fakeExporter({ reports: all(49, { status: 'ok' }) });
  const lock = path.join(fake.dir, 'data', 'foodstory', '.daily-launcher.pid');
  await mkdir(path.dirname(lock), { recursive: true });
  await writeFile(lock, `${process.pid}\n`); // process นี้ยังมีชีวิต = มีรอบรันอยู่
  const busy = run(fake.launcher);
  assert.equal(busy.code, 1);
  assert.match(busy.out, /รันอยู่แล้ว/);
  assert.equal(existsSync(fake.argsFile), false);

  await writeFile(lock, '999999\n'); // pid ที่ไม่มีอยู่ = ตัวล็อกค้าง
  assert.equal(run(fake.launcher).code, 0);
  assert.equal(existsSync(lock), false, 'จบแล้วต้องปลดล็อก');
});

test('เรียกผ่าน symlink บน Desktop: ยังหาโฟลเดอร์ exporter เจอ', async () => {
  const fake = await fakeExporter({ reports: all(49, { status: 'ok' }) });
  const link = path.join(await tempDir('fs-desktop-'), 'Exporter - FoodStory Daily.command');
  await symlink(fake.launcher, link);
  const { code, out } = run(link);
  assert.equal(code, 0, out);
  assert.ok(existsSync(fake.argsFile));
});

// ลองจริง 2026-10-12: หน้าต่างค้างที่ "กดปุ่มใดก็ได้" ยังถือล็อกอยู่ — พนักงานเปิดทิ้งไว้ข้ามวัน พรุ่งนี้ดับเบิลคลิกจะขึ้นว่า "รันอยู่แล้ว"
// ต้องปลดล็อกทันทีที่ดึงเสร็จ ก่อนรอกดปุ่ม
test('ระหว่างรอ "กดปุ่มใดก็ได้" ตอนจบ ล็อกต้องถูกปลดแล้ว (เปิดหน้าต่างทิ้งไว้ไม่ขวางรอบถัดไป)', async () => {
  const { spawn } = await import('node:child_process');
  const fake = await fakeExporter({ reports: all(49, { status: 'ok' }) });
  const lock = path.join(fake.dir, 'data', 'foodstory', '.daily-launcher.pid');
  const child = spawn('bash', [fake.launcher], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  const waiting = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ไม่ถึงขั้นรอกดปุ่ม: ${out}`)), 20_000);
    const onData = (b: Buffer) => {
      out += b.toString();
      if (out.includes('กดปุ่มใดก็ได้')) { clearTimeout(timer); resolve(); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
  });
  const closed = new Promise<number | null>((resolve) => child.on('close', resolve));
  try {
    await waiting;
    assert.equal(existsSync(lock), false, 'ยังถือล็อกอยู่ระหว่างรอกดปุ่ม');
    child.stdin.end('x');
    assert.equal(await closed, 0);
  } finally {
    child.kill(); // ล้มกลางทางต้องไม่ทิ้ง bash ค้างรอ stdin จน test ไม่จบ
  }
});

test('🔴 รอบเดียวเติมหลายวัน + snapshot ของวันนี้ (ใบ 06): รวมผลทุกโฟลเดอร์ที่รอบนี้เขียน บอกวันที่ได้ และคำเตือนวันที่ยังขาด', async () => {
  const fake = await fakeExporter({
    folders: [
      { day: '2026-10-12', reports: all(42, { status: 'ok' }), startedAt: STARTED },
      { day: '2026-10-13', reports: all(42, { status: 'ok' }), startedAt: STARTED },
      { day: '2026-10-14', reports: all(7, { status: 'ok' }), startedAt: STARTED, warnings: ['ยังขาดอีก 2 วันของข้อมูล เกินจำนวนวันสูงสุดต่อรอบ (3)'] },
    ],
  });
  const { code, out } = run(fake.launcher);
  assert.equal(code, 0);
  assert.match(out, /เสร็จเรียบร้อย[\s\S]*91\/91/);
  assert.match(out, /รายงานตามวัน: ข้อมูลวันที่ 2026-10-12, 2026-10-13\n/);
  assert.match(out, /รายงาน snapshot: ถ่าย 7 รายงาน/);
  assert.match(out, /ยังขาดอีก 2 วัน/);
});

test('🔴 ไม่มีงานค้าง (exporter จบ 0 โดยไม่ login ไม่เขียน _run.json): บอกว่าครบแล้ว ไม่ใช่ "ไม่สำเร็จ"', async () => {
  const fake = await fakeExporter({ exit: 0 });
  const { code, out } = run(fake.launcher);
  assert.equal(code, 0);
  assert.match(out, /ไม่มีงานค้าง|ครบแล้ว/);
  assert.doesNotMatch(out, /ไม่สำเร็จ/);
});

test('🔴 ได้บางส่วน: ยังบอกว่าได้ข้อมูลวันไหน snapshot กี่รายงาน และ snapshot ปิดงวด — นับเฉพาะที่ได้จริง วันที่ล้มทั้งวันไม่ขึ้น (code review ใบ 06 — เดิมบอกเฉพาะตอนผ่านครบ)', async () => {
  const fake = await fakeExporter({
    folders: [
      { day: '2026-09-30', reports: { a: { status: 'ok' }, 'salebymonthsum@period-close': { status: 'ok' } }, startedAt: STARTED },
      { day: '2026-10-12', reports: { a: { status: 'failed' } }, startedAt: STARTED },
      { day: '2026-10-13', reports: { a: { status: 'ok' }, b: { status: 'failed' } }, startedAt: STARTED },
      { day: '2026-10-14', reports: { current_stock: { status: 'ok' }, supplier: { status: 'failed' } }, startedAt: STARTED },
    ],
  });
  const { code, out } = run(fake.launcher);
  assert.equal(code, 2);
  assert.match(out, /ได้บางส่วน/);
  assert.match(out, /รายงานตามวัน: ข้อมูลวันที่ 2026-09-30, 2026-10-13\n/);
  assert.match(out, /รายงาน snapshot: ถ่าย 1 รายงาน · snapshot ปิดงวด 1 รายงาน/);
});
