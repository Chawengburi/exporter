#!/usr/bin/env node
import { Command, Option } from 'commander';
import { ALL_REPORTS, runExport } from './sites/hoteltime/export.ts';
import { runLoginCheck } from './sites/hoteltime/login.ts';
import { runSweep } from './sites/hoteltime/sweep.ts';
import { DEFAULT_BASELINE_INTERVAL_DAYS } from './core/order.ts';
import { reportIds } from './sites/hoteltime/reports/index.ts';
import { ALL_REPORTS as FOODSTORY_ALL_REPORTS, runFoodStoryExport } from './sites/foodstory/export.ts';
import { runFoodStoryLoginCheck } from './sites/foodstory/login.ts';
import { reportIds as foodstoryReportIds } from './sites/foodstory/reports/index.ts';

/**
 * รายชื่อ site ที่มีจริงตอนนี้ — `foodstory` เพิ่มเข้ามาที่ ticket 12 (batch review + ต่อเข้า
 * registry) `--site` ยังเป็น flag แบบเส้นเดียวตรง ๆ ไม่ได้สร้าง multi-site dispatch abstraction
 * เต็มรูปแบบ (ADR-0004) — แค่ if/else ตาม `--site` ในแต่ละ command เพราะ 2 site ยังมี shape ของ
 * option ต่างกันจริง (FoodStory มีรายเดือน + `--daily` ตามโมเดลใหม่ แต่ไม่มี baseline/format/`--date` — ADR-0006, ใบ 06)
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
  .description('ดึงรายงานแล้วเก็บไฟล์ดิบตามที่ Site ให้มา (.xlsx) พร้อมที่มาใน _manifest.json')
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
    'รอบรายวัน — hoteltime: รายงานตามวันดึงเมื่อวานไฟล์ละวัน + ถ่ายรายงาน snapshot ของวันนี้ ทำเฉพาะที่ยังไม่สำเร็จ (รันซ้ำได้ทั้งวัน) · ' +
      'foodstory: เหมือนกันใน login เดียว (กด captcha ครั้งเดียว) · ใช้คู่กับ --from/--to/--last-days/--baseline ไม่ได้',
    false,
  )
  .option(
    '--date <YYYY-MM-DD>',
    'hoteltime: ดึงรายงานตามวันของวันของข้อมูลนั้นวันเดียวใหม่ (ฉบับเก่าไม่หาย) · ไม่ถ่ายรายงาน snapshot · ใช้คู่กับ --daily/--from/--to/--last-days/--baseline ไม่ได้',
  )
  .option(
    '--baseline',
    'hoteltime: ดึงรายงานตามวันของวันที่เคยดึงแล้วใหม่ ไฟล์ละวันของข้อมูล (ชื่อเดียวกับรอบรายวัน) ลง baseline/<วันที่รัน>/ · ไม่ใส่ --from/--to = ' +
      'ช่วงเริ่มต้นถึงเมื่อวาน (--baseline-interval-days วัน) · รายงาน snapshot ไม่มี baseline · ใช้คู่กับ --last-days/--daily ไม่ได้',
    false,
  )
  .option(
    '--baseline-interval-days <n>',
    `ระยะที่ baseline รอบนี้ตั้งใจครอบคลุม และจำนวนวันของช่วงเริ่มต้น (ค่าเริ่มต้น ${DEFAULT_BASELINE_INTERVAL_DAYS} — ยังไม่ยืนยันด้วยข้อมูลจริง)`,
  )
  // เลิกใช้แล้ว — ยังรับไว้แบบซ่อนเพื่อบอกเหตุผลให้คนที่พิมพ์ตามคู่มือเก่า แทน "unknown option" เฉย ๆ
  .addOption(new Option('-f, --format <x>').hideHelp())
  .addOption(new Option('--overlap-days <n>').hideHelp())
  .addOption(new Option('--retry-failed').hideHelp())
  .option('--headful', 'เปิดหน้าต่างเบราว์เซอร์ให้เห็นมันทำงาน', false)
  .option('--slow-mo <ms>', 'หน่วงทุก action กี่มิลลิวินาที ให้คนดูทัน (ใช้คู่กับ --headful)')
  .option('--json', 'พิมพ์ผลเป็น JSON', false)
  .action(async (opts: {
    site: string; report: string; from?: string; to?: string; lastDays?: string;
    daily: boolean; date?: string; overlapDays?: string; retryFailed?: boolean; baseline: boolean; baselineIntervalDays?: string;
    format?: string; headful: boolean; slowMo?: string; json: boolean;
  }) => {
    if (opts.format !== undefined) {
      console.error(
        '--format เลิกใช้แล้ว — exporter เก็บแค่ไฟล์ดิบตามที่ Site ให้มา (.xlsx) พร้อม _manifest.json ไม่เขียน CSV อีก (ADR-0007) · เอา --format ออก',
      );
      process.exitCode = 1;
      return;
    }
    if (opts.overlapDays !== undefined || opts.retryFailed) {
      console.error(
        `${opts.overlapDays !== undefined ? '--overlap-days' : '--retry-failed'} เลิกใช้แล้ว — --daily ดึงเมื่อวานไฟล์ละวันและทำเฉพาะ` +
          'ที่ยังไม่สำเร็จเองทุกครั้ง (ADR-0008) ไม่มีช่วงเหลื่อมและไม่ต้องสั่งเก็บตกแยก · เอา flag นี้ออก',
      );
      process.exitCode = 1;
      return;
    }
    const slowMo = opts.slowMo === undefined ? undefined : Number(opts.slowMo);
    if (slowMo !== undefined && (!Number.isFinite(slowMo) || slowMo < 0)) {
      console.error(`--slow-mo ต้องเป็นตัวเลข >= 0 — ได้มา ${JSON.stringify(opts.slowMo)}`);
      process.exitCode = 1;
      return;
    }

    if (opts.site === 'foodstory') {
      // FoodStory มีรอบรายเดือน (ค่าเริ่มต้น / --from --to) กับรอบรายวัน --daily (ใบ 06: เมื่อวาน + รอบเก็บตก + รายงาน snapshot) — ไม่มี baseline/format/
      // เก็บตก · ปฏิเสธตรง ๆ แทนที่จะเงียบ ๆ เพิกเฉย flag ที่ผู้ใช้ตั้งใจส่งมา
      if (opts.baseline || opts.lastDays !== undefined || opts.baselineIntervalDays !== undefined || opts.date !== undefined) {
        console.error(
          '--baseline/--last-days/--baseline-interval-days/--date ' +
            'ใช้กับ --site foodstory ไม่ได้ (มีแค่รอบรายเดือน กับ --daily · ใช้ --from/--to ' +
            'แทนถ้าจะข้ามเดือนที่แล้ว)',
        );
        process.exitCode = 1;
        return;
      }
      if (opts.daily && (opts.from !== undefined || opts.to !== undefined)) {
        console.error('--daily ของ foodstory เลือกวันเอง (เมื่อวาน + วันที่ยังขาด) — ใช้คู่กับ --from/--to ไม่ได้ (ใช้ --from/--to อย่างเดียวแทน)');
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
      if (opts.daily) await notifyAfterDaily('foodstory-daily', opts.json);
      return;
    }

    // ตัวเลขไม่ถูกต้อง (ไม่ใช่จำนวนเต็มบวก, ใช้ปนกับโหมดอื่น) ถูกปฏิเสธใน resolveRunPlan()
    // ที่เดียว — ไม่ซ้ำ validation ที่นี่ เพื่อให้กฎเรื่องช่วงวันที่/โหมดอยู่ที่จุดเดียว
    const lastDays = opts.lastDays === undefined ? undefined : Number(opts.lastDays);
    const baselineIntervalDays =
      opts.baselineIntervalDays === undefined ? undefined : Number(opts.baselineIntervalDays);
    process.exitCode = await runExport({
      reportId: opts.report,
      from: opts.from,
      to: opts.to,
      lastDays,
      daily: opts.daily,
      date: opts.date,
      baseline: opts.baseline,
      baselineIntervalDays,
      headful: opts.headful,
      slowMoMs: slowMo,
      json: opts.json,
    });
    // --date (สั่งเองวันเดียว) ไม่แจ้ง — คนสั่งเห็นผลบนจออยู่แล้ว
    if (opts.daily && opts.date === undefined) await notifyAfterDaily('hoteltime-daily', opts.json);
  });

/**
 * แจ้งผลผ่าน Discord หลังรอบรายวัน (ใบ 08) · ระยะเวลาในข้อความ = เวลาตั้งแต่โปรเซสเริ่ม (หนึ่งโปรเซสต่อหนึ่งรอบ) — ไม่เปลี่ยน exit code ของรอบไม่ว่าส่งได้หรือไม่ · โหมด --json พิมพ์ลง stderr (stdout เป็น JSON ของรอบ)
 */
async function notifyAfterDaily(trigger: 'hoteltime-daily' | 'foodstory-daily', json: boolean): Promise<void> {
  const { describeNotify, notifyDiscord } = await import('./notify.ts');
  const line = describeNotify(await notifyDiscord({ trigger, durationMs: Math.round(performance.now()) }));
  if (json) console.error(line);
  else console.log(line);
}

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
  .command('status')
  .description('สรุปภาษาไทยหน้าเดียวว่าระบบปกติไหม — อ่านจากคลัง data/ เท่านั้น ไม่เปิดเบราว์เซอร์ (exit 0 = ปกติ/มีสิ่งต้องทำ · 1 = มีปัญหา · 2 = ใช้คำสั่งผิด)')
  .option('--json', 'พิมพ์ผลเป็น JSON', false)
  .option('--days <n>', 'ย้อนดูกี่วัน', '7')
  .option('--data <dir>', 'โฟลเดอร์คลัง (ค่าเริ่มต้น exporter/data)')
  .option('--at <time>', 'ประเมินเหมือนเป็นเวลานี้ (ตรวจย้อนหลัง/ทดสอบ) — ไม่ใส่ timezone = เวลาไทย เช่น 2026-10-12T20:00')
  .action(async (opts: { json: boolean; days: string; data?: string; at?: string }) => {
    const { buildStatus, defaultDataDir, readStoreSnapshot, renderStatus } = await import('./core/status.ts');
    const { statusSetup } = await import('./status-setup.ts');
    const { existsSync } = await import('node:fs');
    const usage = (message: string) => {
      console.error(message);
      process.exitCode = 2; // แยกจาก 1 (= ระบบมีปัญหา) ให้ cron/การแจ้งเตือนรู้ว่าเป็นแค่สั่งผิด
    };
    const days = Number(opts.days);
    // ไม่มี timezone = เวลาไทย (คนอ่านเวลาไทย) · วันที่อย่างเดียว = เที่ยงคืนเวลาไทย
    const atText = opts.at && !/(Z|[+-]\d{2}:?\d{2})$/.test(opts.at) ? `${opts.at.includes('T') ? opts.at : `${opts.at}T00:00`}+07:00` : opts.at;
    const at = atText ? new Date(atText) : new Date();
    if (!Number.isInteger(days) || days < 2) return usage('--days ต้องเป็นจำนวนเต็มตั้งแต่ 2 ขึ้นไป');
    if (Number.isNaN(at.getTime())) return usage('--at อ่านไม่ออก — ใช้แบบ 2026-10-12T20:00 (เวลาไทย) หรือ 2026-10-12T13:00:00Z');
    const dataDir = opts.data ?? defaultDataDir();
    if (!existsSync(dataDir)) return usage(`ไม่พบโฟลเดอร์คลัง ${dataDir} — ใส่ --data ให้ถูก หรือรันจากโฟลเดอร์ exporter ที่ติดตั้งแล้ว`);
    const { readUploadBacklog } = await import('./upload.ts');
    const uploadBacklog = await Promise.all((['hoteltime', 'foodstory'] as const).map((site) => readUploadBacklog(dataDir, site)));
    // ค่าตั้งอ่านจาก exporter/.env ของโค้ดชุดนี้ (ไม่ใช่ของ --data) — อ่านแค่วันเริ่มใช้งานกับว่ามี URL webhook ไหม
    const report = buildStatus(await readStoreSnapshot(dataDir), at, statusSetup(), { windowDays: days, uploadBacklog });
    process.stdout.write(opts.json ? `${JSON.stringify(report, null, 2)}\n` : renderStatus(report));
    process.exitCode = report.verdict === 'problem' ? 1 : 0;
  });

program
  .command('notify')
  .description('แจ้งผลผ่าน Discord (ใบ 08) — ส่งเรื่องที่ต้องดูที่ยังไม่เคยส่ง (+ สรุปของวันนี้ถ้าใส่ --summary) · รอบ export --daily เรียกเองอยู่แล้ว')
  .option('--summary', 'ส่งสรุปของวันนี้ด้วย (วันละครั้ง — ส่งแล้วไม่ส่งซ้ำ)', false)
  .option('--dry-run', 'พิมพ์ข้อความที่จะส่ง ไม่ส่งจริงและไม่บันทึก', false)
  .option('--data <dir>', 'โฟลเดอร์คลัง (ค่าเริ่มต้น exporter/data)')
  .action(async (opts: { summary: boolean; dryRun: boolean; data?: string }) => {
    const { describeNotify, notifyDiscord } = await import('./notify.ts');
    const result = await notifyDiscord({ trigger: 'manual', summary: opts.summary, dryRun: opts.dryRun, ...(opts.data ? { dataDir: opts.data } : {}) });
    if (result.status === 'dry-run') for (const m of result.messages) console.log(`── ${m.keys.join(', ')}\n${m.content}\n`);
    console.log(describeNotify(result));
    process.exitCode = result.status === 'failed' ? 1 : 0;
  });

program
  .command('upload')
  .description(
    'ส่งไฟล์ดิบเข้า uploader จริง (ticket 01-07 ของ exporter-upload-to-uploader — HotelTime เท่านั้นตอนนี้ ' +
      'retry ความล้มเหลวชั่วคราวเอง กัน as_of ย้อนหลัง ข้ามรายงานว่าง และแจ้ง Discord — ดู ticket 08 สำหรับ FoodStory) ' +
      'ใส่ --folder สำหรับโฟลเดอร์เดียว หรือ --site สำหรับทุกโฟลเดอร์ที่ยังค้างของ site นั้น (แบบที่ Windmill เรียก)',
  )
  .option('--folder <path>', 'โฟลเดอร์รอบเดียวที่มี _manifest.json/_run.json เช่น data/hoteltime/daily/2026-10/2026-10-15 — ใช้คู่กับ --site ไม่ได้')
  .addOption(new Option('--site <id>', 'ส่งทุกโฟลเดอร์ที่ยังค้างของ site นี้ (ticket 07) — ใช้คู่กับ --folder ไม่ได้').choices(KNOWN_SITES))
  .option('--data <dir>', 'โฟลเดอร์คลัง (ค่าเริ่มต้น exporter/data) — เก็บ state ของ as_of/รายงานว่างไว้ที่นี่')
  .option('--json', 'พิมพ์ผลเป็น JSON', false)
  .action(async (opts: { folder?: string; site?: string; data?: string; json: boolean }) => {
    const usage = (message: string) => {
      console.error(message);
      process.exitCode = 2; // แยกจาก 1 (= มีไฟล์ค้าง/ปฏิเสธ) ให้รู้ว่าเป็นแค่สั่งผิด เหมือนคำสั่ง status
    };
    if (opts.folder !== undefined && opts.site !== undefined) return usage('ใส่ --folder หรือ --site อย่างใดอย่างหนึ่ง ไม่ใช่ทั้งคู่');
    if (opts.folder === undefined && opts.site === undefined) return usage('ต้องใส่ --folder <path> หรือ --site <hoteltime|foodstory>');
    const { describeUploadResult, uploadFolder, uploadSite } = await import('./upload.ts');
    const { notifyUpload, describeNotify } = await import('./notify.ts');
    try {
      const result = opts.folder !== undefined
        ? await uploadFolder({ folder: opts.folder, ...(opts.data ? { dataDir: opts.data } : {}) })
        : await uploadSite({ site: opts.site as 'hoteltime' | 'foodstory', ...(opts.data ? { dataDir: opts.data } : {}) });
      process.stdout.write(opts.json ? `${JSON.stringify(result, null, 2)}\n` : describeUploadResult(result));
      const notified = await notifyUpload({ result, durationMs: Math.round(performance.now()), ...(opts.data ? { dataDir: opts.data } : {}) });
      if (!opts.json) console.log(describeNotify(notified)); // Discord ไม่ทำให้รอบอัปโหลดล้ม — แค่รายงานไว้
      process.exitCode = result.stuck > 0 || result.rejected > 0 ? 1 : 0;
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
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
