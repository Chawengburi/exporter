import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// ticket 11: the staff double-click file — runs the real script in a fake exporter folder whose `src/index.ts` is a stand-in that writes `_run.json`
// into the store the way the exporter does (or writes nothing = failed before finishing, e.g. the captcha was too slow) and then exits with a given exit code — no browser is opened · real use
// is proven by a person trying it following the guide (seam agreed with the owner 2026-10-12) · the summary on screen is read from the `_run.json` that combines the results of the whole folder, not from what the exporter prints
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
  /** start time of the run (UTC ISO) — the folder whose day equals the run's start day (Thai time) is today's snapshot-report folder */
  readonly startedAt?: string;
};

/**
 * `reports` = the latest per-report status in the `_run.json` of yesterday's folder · `folders` = a run that writes several folders (back-filled days + today's snapshots — ticket 06)
 * · neither given = the stand-in writes no `_run.json` at all
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
    // ticket 11's original run has no run entries (runs is empty) — the launcher must count every report in the folder as before
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

// 17:00 Thai time 2026-10-14 — a run that backfills the 12th and 13th and takes the snapshots of the 14th
const STARTED = '2026-10-14T10:00:00.000Z';

const all = (n: number, state: ReportState): Record<string, ReportState> =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`r${i}`, state]));

function run(file: string): { code: number | null; out: string } {
  // stdin = the key pressed at "Press any key to close this window"
  const r = spawnSync('bash', [file], { input: 'x', encoding: 'utf8', timeout: 30_000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test('all passed: runs the FoodStory daily exporter run with a visible browser, then summarises that it is done and nothing more is needed', async () => {
  const fake = await fakeExporter({ reports: all(49, { status: 'ok' }) });
  const { code, out } = run(fake.launcher);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(await readFile(fake.argsFile, 'utf8')), ['export', '--site', 'foodstory', '--report', 'all', '--daily', '--headful']);
  assert.match(out, /Done[\s\S]*49\/49/);
  assert.match(out, /you can close this window/);
});

test('some reports: says how many passed and how many failed and what to do (double-click again, then tell the administrator)', async () => {
  const failed = { status: 'failed' } as const;
  const fake = await fakeExporter({ exit: 2, reports: { ...all(45, { status: 'ok' }), f1: failed, f2: failed, f3: failed, f4: failed } });
  const { code, out } = run(fake.launcher);
  assert.equal(code, 2);
  assert.match(out, /got 45 of 49[\s\S]*4 reports failed/);
  assert.match(out, /Double-click[\s\S]*again/);
  assert.match(out, /administrator/);
});

test('a re-run where this run failed some reports but the files that passed in an earlier run are still in the folder = the folder is complete -> says done, no pointless call to the administrator', async () => {
  const kept = { status: 'failed', previousOk: true } as const;
  const fake = await fakeExporter({ exit: 2, reports: { ...all(47, { status: 'ok' }), a: kept, b: kept } });
  const { code, out } = run(fake.launcher);
  assert.equal(code, 0);
  assert.match(out, /Done[\s\S]*49\/49/);
});

test('failed before finishing (no _run.json — e.g. the captcha was not solved within 5 minutes, the internet): states the common causes, to try again/tell the administrator', async () => {
  const fake = await fakeExporter({ exit: 1 });
  const { code, out } = run(fake.launcher);
  assert.equal(code, 1);
  assert.match(out, /Failed/);
  assert.match(out, /captcha/i);
  assert.match(out, /administrator/);
});

test('logged in but not a single report obtained: does not blame the captcha — tell the administrator', async () => {
  const fake = await fakeExporter({ exit: 1, reports: all(49, { status: 'failed' }) });
  const { code, out } = run(fake.launcher);
  assert.equal(code, 1);
  assert.match(out, /not a single report/);
  assert.doesNotMatch(out, /captcha/i);
  assert.match(out, /administrator/);
});

test('no .env settings file: says so clearly, does not start', async () => {
  const fake = await fakeExporter({ env: false });
  const { code, out } = run(fake.launcher);
  assert.equal(code, 1);
  assert.match(out, /\.env/);
  assert.equal(existsSync(fake.argsFile), false);
});

test('not installed yet (no node_modules): says so clearly, does not start', async () => {
  const fake = await fakeExporter({ nodeModules: false });
  const { code, out } = run(fake.launcher);
  assert.equal(code, 1);
  assert.match(out, /npm install/);
  assert.equal(existsSync(fake.argsFile), false);
});

test('double-clicking again while the previous run of this folder is still going: says it is already running, does not start a second run · a stale lock from a dead run does not block', async () => {
  const fake = await fakeExporter({ reports: all(49, { status: 'ok' }) });
  const lock = path.join(fake.dir, 'data', 'foodstory', '.daily-launcher.pid');
  await mkdir(path.dirname(lock), { recursive: true });
  await writeFile(lock, `${process.pid}\n`); // this process is alive = a run is going
  const busy = run(fake.launcher);
  assert.equal(busy.code, 1);
  assert.match(busy.out, /already running/);
  assert.equal(existsSync(fake.argsFile), false);

  await writeFile(lock, '999999\n'); // a pid that does not exist = a stale lock
  assert.equal(run(fake.launcher).code, 0);
  assert.equal(existsSync(lock), false, 'the lock must be released when it finishes');
});

test('called through a symlink on the Desktop: still finds the exporter folder', async () => {
  const fake = await fakeExporter({ reports: all(49, { status: 'ok' }) });
  const link = path.join(await tempDir('fs-desktop-'), 'Exporter - FoodStory Daily.command');
  await symlink(fake.launcher, link);
  const { code, out } = run(link);
  assert.equal(code, 0, out);
  assert.ok(existsSync(fake.argsFile));
});

// Tried for real 2026-10-12: a window left at "Press any key" still held the lock — a staff member left it open overnight, so tomorrow's double-click would say "already running"
// the lock must be released as soon as the pull finishes, before waiting for a key
test('while waiting at "Press any key" at the end, the lock must already be released (a window left open does not block the next run)', async () => {
  const { spawn } = await import('node:child_process');
  const fake = await fakeExporter({ reports: all(49, { status: 'ok' }) });
  const lock = path.join(fake.dir, 'data', 'foodstory', '.daily-launcher.pid');
  const child = spawn('bash', [fake.launcher], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  const waiting = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`never reached the wait for a key: ${out}`)), 20_000);
    const onData = (b: Buffer) => {
      out += b.toString();
      if (out.includes('Press any key')) { clearTimeout(timer); resolve(); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
  });
  const closed = new Promise<number | null>((resolve) => child.on('close', resolve));
  try {
    await waiting;
    assert.equal(existsSync(lock), false, 'still holding the lock while waiting for a key');
    child.stdin.end('x');
    assert.equal(await closed, 0);
  } finally {
    child.kill(); // failing midway must not leave bash hanging on stdin so that the test never finishes
  }
});

test('🔴 one run back-fills several days + today\'s snapshots (ticket 06): combines the results of every folder this run wrote, says which days were obtained, and the warning about days still missing', async () => {
  const fake = await fakeExporter({
    folders: [
      { day: '2026-10-12', reports: all(42, { status: 'ok' }), startedAt: STARTED },
      { day: '2026-10-13', reports: all(42, { status: 'ok' }), startedAt: STARTED },
      { day: '2026-10-14', reports: all(7, { status: 'ok' }), startedAt: STARTED, warnings: ['ยังขาดอีก 2 วันของข้อมูล เกินจำนวนวันสูงสุดต่อรอบ (3)'] },
    ],
  });
  const { code, out } = run(fake.launcher);
  assert.equal(code, 0);
  assert.match(out, /Done[\s\S]*91\/91/);
  assert.match(out, /Per-day reports: data for 2026-10-12, 2026-10-13\n/);
  assert.match(out, /Snapshot reports: took 7 report\(s\)/);
  assert.match(out, /ยังขาดอีก 2 วัน/);
});

test('🔴 nothing outstanding (the exporter ends with 0 without logging in and without writing _run.json): says it is complete, not "Failed"', async () => {
  const fake = await fakeExporter({ exit: 0 });
  const { code, out } = run(fake.launcher);
  assert.equal(code, 0);
  assert.match(out, /Nothing outstanding/);
  assert.doesNotMatch(out, /Failed/);
});

test('🔴 partial: still says which days were obtained, how many snapshot reports and period-close snapshots — counts only what was really obtained, a day that failed entirely is not shown (code review of ticket 06 — it used to say this only when everything passed)', async () => {
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
  assert.match(out, /Partial/);
  assert.match(out, /Per-day reports: data for 2026-09-30, 2026-10-13\n/);
  assert.match(out, /Snapshot reports: took 1 report\(s\) · period-close snapshots 1 report\(s\)/);
});
