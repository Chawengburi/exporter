#!/usr/bin/env node
import { Command, Option } from 'commander';
import { ALL_REPORTS, runExport, type OutputFormat } from './sites/hoteltime/export.ts';
import { runLoginCheck } from './sites/hoteltime/login.ts';
import { runSweep } from './sites/hoteltime/sweep.ts';
import { DEFAULT_BASELINE_INTERVAL_DAYS, DEFAULT_DAILY_OVERLAP_DAYS } from './core/order.ts';
import { reportIds } from './sites/hoteltime/reports/index.ts';
import { ALL_REPORTS as FOODSTORY_ALL_REPORTS, runFoodStoryExport } from './sites/foodstory/export.ts';
import { runFoodStoryLoginCheck } from './sites/foodstory/login.ts';
import { reportIds as foodstoryReportIds } from './sites/foodstory/reports/index.ts';

/**
 * รายชื่อ site ที่มีจริงตอนนี้ — `foodstory` เพิ่มเข้ามาที่ ticket 12 (batch review + ต่อเข้า
 * registry) `--site` ยังเป็น flag แบบเส้นเดียวตรง ๆ ไม่ได้สร้าง multi-site dispatch abstraction
 * เต็มรูปแบบ (ADR-0004) — แค่ if/else ตาม `--site` ในแต่ละ command เพราะ 2 site ยังมี shape ของ
 * option ต่างกันจริง (FoodStory มีรายเดือน + `--daily` = เมื่อวาน แต่ไม่มี baseline/format/เก็บตก — ADR-0006)
 */
const KNOWN_SITES = ['hoteltime', 'foodstory'] as const;

/** ใช้ Option.choices() ของ commander เอง เพื่อให้ error ของค่าที่ไม่รู้จักออกมาเป็นข้อความ
 * CLI ปกติ (พร้อม exit code 1) ไม่ใช่ stack trace ดิบจาก throw เอง */
function siteOption(description: string): Option {
  return new Option('--site <id>', description).choices(KNOWN_SITES).default('hoteltime');
}

const program = new Command();

// เดิมชื่อ 'pms-export' — rename เป็น 'exporter' 2026-09-28 ตาม ADR-0004 (ticket 13)
program
  .name('exporter')
  .description('ดึงรายงานจากเว็บที่ไม่มี API ด้วย Playwright แล้วเซฟลงดิสก์ (hoteltime, foodstory)')
  .version('0.1.0');

program
  .command('login')
  .description('ตรวจว่า credential ใน .env ใช้ล็อกอินได้จริง')
  .addOption(siteOption('site ที่จะเช็ค'))
  .option('--check', 'ล็อกอินแล้วออก (พฤติกรรมเดียวที่มีตอนนี้)', true)
  .option('--headful', 'เปิดหน้าต่างเบราว์เซอร์ให้เห็น แทนการรัน headless', false)
  .option('--json', 'พิมพ์ผลเป็น JSON', false)
  .action(async (opts: { site: string; headful: boolean; json: boolean }) => {
    process.exitCode = opts.site === 'foodstory'
      ? await runFoodStoryLoginCheck({ headful: opts.headful, json: opts.json })
      : await runLoginCheck({ headful: opts.headful, json: opts.json });
  });

program
  .command('export')
  .description('ดึงรายงานแล้วเขียนเป็น CSV รายปี (hoteltime) หรือ .xlsx รายเดือน (foodstory)')
  .addOption(siteOption('site ที่จะดึง'))
  .requiredOption(
    '-r, --report <id|all>',
    `รายงานที่จะดึง — hoteltime: ${reportIds().join(' | ')} | ${ALL_REPORTS}\n` +
      `                      foodstory: ${foodstoryReportIds().join(' | ')} | salebychannel | reservation-report | ${FOODSTORY_ALL_REPORTS}\n` +
      `                      ${ALL_REPORTS} ของ hoteltime: --daily รันครบทุกใบ รอบอื่นข้ามรายงานรายวัน (ADR-0003)\n` +
      `                      ${FOODSTORY_ALL_REPORTS} ของ foodstory: ทุกใบข้างบน (reservation-report รันเป็นใบสุดท้าย)`,
  )
  .option('--from <DD/MM/YYYY>', 'วันเริ่ม (ค่าเริ่มต้น 01/01/2024) — ใช้คู่กับ --last-days ไม่ได้')
  .option('--to <DD/MM/YYYY>', 'วันสิ้นสุด (ค่าเริ่มต้น วันนี้) — ใช้คู่กับ --last-days ไม่ได้')
  .option('--last-days <n>', 'ดึงย้อนหลัง N วันจากวันนี้ รวมวันนี้ (n >= 1) — แทนการระบุ --from/--to')
  .option(
    '--daily',
    `รอบรายวัน — hoteltime: ดึงเฉพาะขอบหน้า (ค่าเริ่มต้นเหลื่อม ${DEFAULT_DAILY_OVERLAP_DAYS} วัน) · foodstory: เมื่อวานวันเดียว · ใช้คู่กับ --from/--to/--last-days/--baseline ไม่ได้`,
    false,
  )
  .option('--overlap-days <n>', `จำนวนวันเหลื่อมของ --daily (ค่าเริ่มต้น ${DEFAULT_DAILY_OVERLAP_DAYS})`)
  .option(
    '--retry-failed',
    'รอบเก็บตก (ใช้คู่กับ --daily): รันซ้ำเฉพาะใบที่สถานะล่าสุดในโฟลเดอร์ของวันนี้ยังล้ม — ไม่มีใบล้มก็จบทันทีโดยไม่เปิดเบราว์เซอร์',
    false,
  )
  .option(
    '--baseline',
    'โหมด baseline — ดึงทั้งช่วงใหม่หมดเหมือน back-fill ใช้คู่กับ --from/--to/--last-days/--daily ไม่ได้',
    false,
  )
  .option(
    '--baseline-interval-days <n>',
    `ระยะที่ baseline รอบนี้ตั้งใจครอบคลุม (ค่าเริ่มต้น ${DEFAULT_BASELINE_INTERVAL_DAYS} — ยังไม่ยืนยันด้วยข้อมูลจริง)`,
  )
  .option(
    '-f, --format <raw|csv|both>',
    'raw = เก็บ .xlsx ดิบ + manifest · csv = CSV รายปี · both = ทั้งคู่',
    'both',
  )
  .option('--headful', 'เปิดหน้าต่างเบราว์เซอร์ให้เห็นมันทำงาน', false)
  .option('--slow-mo <ms>', 'หน่วงทุก action กี่มิลลิวินาที ให้คนดูทัน (ใช้คู่กับ --headful)')
  .option('--json', 'พิมพ์ผลเป็น JSON', false)
  .action(async (opts: {
    site: string; report: string; from?: string; to?: string; lastDays?: string;
    daily: boolean; overlapDays?: string; retryFailed: boolean; baseline: boolean; baselineIntervalDays?: string;
    format: string; headful: boolean; slowMo?: string; json: boolean;
  }) => {
    const slowMo = opts.slowMo === undefined ? undefined : Number(opts.slowMo);
    if (slowMo !== undefined && (!Number.isFinite(slowMo) || slowMo < 0)) {
      console.error(`--slow-mo ต้องเป็นตัวเลข >= 0 — ได้มา ${JSON.stringify(opts.slowMo)}`);
      process.exitCode = 1;
      return;
    }

    if (opts.site === 'foodstory') {
      // FoodStory มีรอบรายเดือน (ค่าเริ่มต้น / --from --to) กับรอบรายวัน --daily = เมื่อวาน (ticket 10) — ไม่มี baseline/format/
      // เก็บตก · ปฏิเสธตรง ๆ แทนที่จะเงียบ ๆ เพิกเฉย flag ที่ผู้ใช้ตั้งใจส่งมา
      if (opts.retryFailed || opts.baseline || opts.lastDays !== undefined || opts.overlapDays !== undefined
        || opts.baselineIntervalDays !== undefined || opts.format !== 'both') {
        console.error(
          '--retry-failed/--baseline/--last-days/--overlap-days/--baseline-interval-days/--format ' +
            'ใช้กับ --site foodstory ไม่ได้ (มีแค่รอบรายเดือน กับ --daily = เมื่อวาน · ใช้ --from/--to ' +
            'แทนถ้าจะข้ามเดือนที่แล้ว)',
        );
        process.exitCode = 1;
        return;
      }
      if (opts.daily && (opts.from !== undefined || opts.to !== undefined)) {
        console.error('--daily ของ foodstory ดึงเมื่อวานวันเดียวเสมอ — ใช้คู่กับ --from/--to ไม่ได้ (ใช้ --from/--to อย่างเดียวแทน)');
        process.exitCode = 1;
        return;
      }
      process.exitCode = await runFoodStoryExport({
        reportId: opts.report,
        from: opts.from,
        to: opts.to,
        headful: opts.headful,
        slowMoMs: slowMo,
        json: opts.json,
        daily: opts.daily,
      });
      return;
    }

    if (opts.retryFailed && !opts.daily) {
      console.error('--retry-failed ใช้ได้กับ --daily เท่านั้น (รอบเก็บตกของโฟลเดอร์วันนี้)');
      process.exitCode = 1;
      return;
    }
    if (opts.format !== 'raw' && opts.format !== 'csv' && opts.format !== 'both') {
      console.error(`--format ต้องเป็น raw, csv หรือ both — ได้มา ${JSON.stringify(opts.format)}`);
      process.exitCode = 1;
      return;
    }
    // ตัวเลขไม่ถูกต้อง (ไม่ใช่จำนวนเต็มบวก, ใช้ปนกับโหมดอื่น) ถูกปฏิเสธใน resolveRunPlan()
    // ที่เดียว — ไม่ซ้ำ validation ที่นี่ เพื่อให้กฎเรื่องช่วงวันที่/โหมดอยู่ที่จุดเดียว
    const lastDays = opts.lastDays === undefined ? undefined : Number(opts.lastDays);
    const overlapDays = opts.overlapDays === undefined ? undefined : Number(opts.overlapDays);
    const baselineIntervalDays =
      opts.baselineIntervalDays === undefined ? undefined : Number(opts.baselineIntervalDays);
    process.exitCode = await runExport({
      reportId: opts.report,
      from: opts.from,
      to: opts.to,
      lastDays,
      daily: opts.daily,
      retryFailed: opts.retryFailed,
      overlapDays,
      baseline: opts.baseline,
      baselineIntervalDays,
      format: opts.format as OutputFormat,
      headful: opts.headful,
      slowMoMs: slowMo,
      json: opts.json,
    });
  });

program
  .command('sweep')
  .description(
    'กวาดทุกหน้าในเมนูแบบอ่านอย่างเดียว (ไม่คลิกไม่กรอก) บันทึกว่าหน้าไหนมี ' +
      'ปุ่ม export, ฟิลด์บังคับ, ช่องวันที่ — ใช้เลือกว่าจะ recon เชิงลึกหน้าไหนต่อ',
  )
  .addOption(siteOption('site ที่จะกวาด'))
  .option('--headful', 'เปิดหน้าต่างเบราว์เซอร์ให้เห็นมันทำงาน', false)
  .option('--json', 'พิมพ์สรุปผลเป็น JSON', false)
  .option('--out <path>', 'path ของไฟล์ผลลัพธ์ (ค่าเริ่มต้น recon/menu-sweep.json)')
  .action(async (opts: { site: string; headful: boolean; json: boolean; out?: string }) => {
    process.exitCode = await runSweep({ headful: opts.headful, json: opts.json, out: opts.out });
  });

program
  .command('probe')
  .description(
    'การตรวจเบื้องต้น (HotelTime): ลองค้นทุกหน้าผู้สมัครแบบอ่านอย่างเดียว ดูว่า export ได้จริงไหม มีข้อมูลไหม ' +
      'เหมาะกับรอบรายวันแบบไหน — ผลอยู่ที่ recon/PROBE.md + recon/probe-<วันที่>.json',
  )
  .option('--only <hrefs>', 'ตรวจเฉพาะหน้าที่ระบุ คั่นด้วยจุลภาค (path ตามผลการกวาด เช่น reports/PostingsReport.aspx)')
  .option('--keep-dates', 'ไม่ตั้งช่วงวันที่ ใช้ค่าตั้งต้นของหน้า', false)
  .option('--out <name>', 'ชื่อไฟล์ผลใน recon/ (ค่าเริ่มต้น PROBE → PROBE.md + probe-<วัน>.json)')
  .option('--headful', 'เปิดหน้าต่างเบราว์เซอร์ให้เห็นมันทำงาน', false)
  .option('--json', 'พิมพ์สรุปผลเป็น JSON', false)
  .action(async (opts: { only?: string; keepDates: boolean; out?: string; headful: boolean; json: boolean }) => {
    const { runProbe } = await import('./sites/hoteltime/probe.ts');
    process.exitCode = await runProbe({
      headful: opts.headful,
      json: opts.json,
      keepDates: opts.keepDates,
      ...(opts.only ? { only: opts.only } : {}),
      ...(opts.out ? { outName: opts.out } : {}),
    });
  });

program
  .command('migrate-legacy')
  .description(
    'ย้ายผลเดิมใน downloads/ + downloads-archive/ (และ downloads-backfill/, downloads-baseline/) เข้าคลัง data/ — ' +
      'ค่าเริ่มต้นแสดงแผนอย่างเดียว · --apply ก๊อปแล้วตรวจ sha256 · ไม่ลบโฟลเดอร์เดิม',
  )
  .option('--apply', 'ก๊อปจริงตามแผน (ไม่ทำอะไรเลยถ้ามี conflict)', false)
  .option('--json', 'พิมพ์ผลเป็น JSON', false)
  .action(async (opts: { apply: boolean; json: boolean }) => {
    const { runMigrateLegacy } = await import('./migration/run.ts');
    process.exitCode = await runMigrateLegacy({ apply: opts.apply, json: opts.json });
  });

program
  .command('reports')
  .description('แสดงรายงานทั้งหมดที่รองรับ')
  .addOption(siteOption('site ที่จะแสดง'))
  .action(async (opts: { site: string }) => {
    if (opts.site === 'foodstory') {
      const { REPORTS } = await import('./sites/foodstory/reports/index.ts');
      for (const r of REPORTS) {
        console.log(`${r.id}\n  ${r.label}  ·  ${r.path}\n`);
      }
      console.log(`salebychannel\n  ยอดขายแยกตามช่องทางการขาย  ·  /th/salebychannel  (ไม่ใช่ Report shape — ดู salebychannel.ts)\n`);
      return;
    }
    const { REPORTS } = await import('./sites/hoteltime/reports/index.ts');
    for (const r of REPORTS) {
      console.log(`${r.id}\n  ${r.label}  ·  /pms/${r.path}`);
      console.log(`  แบ่งก้อน: ${r.chunk.kind === 'monthly' ? 'รายเดือน' : 'ทั้งช่วง'} — ${r.chunk.reason}`);
      console.log(`  คอลัมน์ที่ใช้กรอง: ${r.dateColumn}\n`);
    }
  });

await program.parseAsync(process.argv);
