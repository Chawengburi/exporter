import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRedactor } from './redact.ts';
import type { DayView, SiteView, StatusReport } from './status.ts';
import { thaiClock } from './thai-time.ts';
import { isUnresolvedDocumentTypeReason } from './uploader.ts';
import type { EmptyResultEntry, UploadFileResult, UploadRunResult } from './uploader.ts';

/**
 * ข้อความ Discord (ใบ 08) — ฟังก์ชันล้วนจากผลของ `exporter status` (`buildStatus`, ใบ 07): ระดับรอ/ปัญหาตามกติกาเวลามาจาก status แล้ว ที่นี่ไม่คิดซ้ำ
 *
 * - **สรุปรอบ** (ทุกรอบรายวัน — เจ้าของระบบขอ 2026-10-21 ให้เหมือนขา upload): ต่อ Site บรรทัดเดียวแบบ log ok/ว่าง/ล้ม + snapshot ของวันนี้
 *   · Site ที่วันนี้ไม่ได้รันบอกว่าไม่ได้รัน
 * - **แจ้งเตือน**: ทุกเรื่องที่ status ตัดสินว่าเป็นปัญหา (รายงานยังล้ม/ขาดหลังรอบเก็บตก, รายงาน snapshot ของวันนี้ถ่ายไม่ได้, snapshot ปิดงวด, `_run.json` เสีย/รอบไม่จบ)
 *   + วันขาดเกินที่รอบเดียวเติมได้ + FoodStory ไม่ได้กดมา `NOT_PRESSED_ALERT_DAYS` วันขึ้นไป
 * - ทุกเรื่องมีกุญแจ (`ชนิด@site@วัน@รายงาน@วันนี้`) — เรื่องเดียวกันไม่ส่งซ้ำในวันเดียวกัน (spec) · ยังไม่หายพรุ่งนี้ = เตือนอีกวันละครั้ง
 * - รายงาน snapshot ของวันนี้ของ FoodStory ล้ม = พนักงานกดใหม่ได้ทั้งวัน → เตือนตั้งแต่ 18:30 ("ถ่ายไม่ได้ทุกรอบ" — user story 39)
 * - FoodStory ยังไม่เคยกดเลย เตือนเฉพาะเครื่องที่ตั้งวันเริ่มใช้งานแล้ว (ยังไม่ตั้ง = ยังไม่เริ่มใช้งาน)
 */

/** FoodStory ไม่ได้กดมากี่วันถึงเตือน — 2 = ไม่ได้กดทั้งเมื่อวานและวันนี้ */
export const NOT_PRESSED_ALERT_DAYS = 2;
/** เพดานความยาวข้อความของ Discord คือ 2000 ตัวอักษร — เผื่อไว้ (เดิมเป็นเพดานของ `content` เฉย ๆ ตอนนี้ของ Text Display component แต่ยังอนุรักษ์นิยมไว้เท่าเดิม) */
const MAX_CONTENT = 1900;
const NAMES_SHOWN = 8;
const SITE_LABEL: Readonly<Record<SiteView['site'], string>> = { hoteltime: 'HotelTime', foodstory: 'FoodStory' };
/** เวลาไทยที่รายงาน snapshot ของวันนี้ของ FoodStory ล้มแล้วถือว่า "ถ่ายไม่ได้ทุกรอบ" — เท่ากับเส้นหลังรอบเก็บตกสุดท้ายของ HotelTime */
const MANUAL_PICTURE_ALERT_AT = '18:30';
/**
 * สีแถบซ้ายของ Discord Container (เจ้าของระบบขอ 2026-10-18 ให้ใช้ container ของ Discord แทน emoji) — เขียว/เหลือง/แดง
 * ตามระดับเดียวกับ verdict ของ `exporter status` (ใบ 07) — ok/action/problem
 */
export const DISCORD_COLOR = { ok: 0x57f287, action: 0xfaa61a, problem: 0xed4245 } as const;

export type DiscordMessage = { readonly keys: readonly string[]; readonly content: string; readonly accentColor: number };
type Alert = { readonly key: string; readonly line: string };
/**
 * ข้อมูลของรอบที่เพิ่งรัน สำหรับบรรทัด subtext แบบ log — `at` = เวลาจริงของรอบ (export: "YYYY-MM-DD HH:MM" เวลาไทย ·
 * upload: ISO) ไม่ใช่เวลาประเมิน status ที่อาจถูกเลื่อนเป็น 18:30 · ไม่ใส่ = ไม่โชว์ส่วนนั้น
 */
export type RunInfo = {
  readonly at?: string;
  readonly label?: string;
  readonly durationMs?: number;
  /** ชื่อไฟล์ที่รอบนี้ export ได้ แยกตาม Site (ขา export เท่านั้น — ขา upload อ่านชื่อจากผลอัปโหลดเอง) */
  readonly files?: Readonly<Partial<Record<SiteView['site'], readonly string[]>>>;
};

// ข้อความ Discord เป็นภาษาอังกฤษทั้งหมด (เจ้าของระบบขอ 2026-10-21) — ข้อความที่ staff อ่านบนเครื่อง (`exporter status`, CLI) ยังเป็นไทยตามเดิม
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** `MONTH[month - 1]` แบบปลอดภัย (`noUncheckedIndexedAccess`) — เดือนนอกช่วง 1-12 ได้เลขดิบแทน "undefined" */
function monthName(month: number): string {
  return MONTH[month - 1] ?? String(month);
}

/**
 * แยกเวลาเป็นส่วน ๆ ตามเวลาไทย — รับทั้ง "YYYY-MM-DD HH:MM" ที่เป็นเวลาไทยอยู่แล้ว (`StatusReport.at` แยกด้วย regex ไม่ผ่าน `Date`
 * กัน timezone ของเครื่องมาปน) และ ISO UTC (ขาอัปโหลด) ที่ต้องแปลงด้วย `thaiClock`
 */
function clockParts(at: string): { readonly date: string; readonly time: string } {
  const plain = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(at);
  if (plain) {
    const [, y, m, d, hh, mm] = plain as unknown as [string, string, string, string, string, string];
    return { date: `${Number(d)} ${monthName(Number(m))} ${y}`, time: `${hh}:${mm}` };
  }
  const c = thaiClock(new Date(at));
  const p = (n: number) => String(n).padStart(2, '0');
  return { date: `${c.day} ${monthName(c.month)} ${c.year}`, time: `${p(c.hour)}:${p(c.minute)}` };
}

/** "2m 41s" / "41s" / "1h 02m" */
function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** subtext ใต้หัวข้อ: วันที่ · ที่มาของรอบ · ระยะเวลา · (ส่วนเพิ่ม เช่น data date) */
function subtext(at: string, run: RunInfo | undefined, extra: readonly string[] = []): string {
  const parts = [clockParts(at).date, run?.label, run?.durationMs !== undefined ? formatDuration(run.durationMs) : undefined, ...extra];
  return `-# ${parts.filter((p) => p !== undefined && p !== '').join(' · ')}`;
}

function names(ids: readonly string[]): string {
  const more = ids.length > NAMES_SHOWN ? ` and ${ids.length - NAMES_SHOWN} more` : '';
  return `${ids.slice(0, NAMES_SHOWN).join(', ')}${more}`;
}
const firstLine = (s: string) => {
  const line = s.split('\n')[0] ?? '';
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** วันของข้อมูลล่าสุดที่ถึงกำหนดของ Site (เมื่อวาน หลัง 07:00) */
const latestDataDay = (site: SiteView): DayView | undefined => [...site.days].reverse().find((d) => d.perDay !== null);

/**
 * บรรทัดเดียวต่อ site แบบ log: `ok/total · empty · failed` + snapshot — "ล้ม" ยังแตกเป็นรายชื่อใน section "Failed" ด้านล่าง
 * (ให้คนที่ไม่ได้อ่านโค้ดกวาดตาเห็นว่ามีอะไรต้องดูทันที) · site ที่วันนี้ไม่ได้รัน บอกตรง ๆ ว่าไม่ได้รัน + รอบล่าสุดเมื่อไร
 */
function summarySiteBlock(site: SiteView, today: string): string {
  const label = SITE_LABEL[site.site];
  if (site.lastRunDay !== today) return `**${label}** not run today (${site.lastRunDay ? `last run ${site.lastRunDay}` : 'never run'})`;
  const day = latestDataDay(site);
  const parts: string[] = [];
  if (day?.perDay) {
    const v = day.perDay;
    parts.push(`${v.data + v.empty.length}/${v.total} ok`);
    parts.push(v.empty.length > 0 ? `${v.empty.length} empty (${names(v.empty)})` : '0 empty');
    parts.push(`${v.failed.length} failed`);
    if (v.notFetched.length > 0) parts.push(`${v.notFetched.length} not fetched`);
  } else if (day?.state) parts.push(day.state === 'running' ? 'run did not finish' : '_run.json unreadable');
  else parts.push('no data fetched yet');
  const pictures = site.days.find((d) => d.day === today)?.pictures;
  if (pictures) {
    const bad = pictures.failed.length + pictures.missing.length;
    parts.push(bad === 0 ? `snapshots ${pictures.taken}/${pictures.total}` : `snapshots ${pictures.taken}/${pictures.total} (${bad} missing)`);
  }
  return `**${label}** ${parts.join(' · ')}`;
}

const FAILURE_SHOWN = 8;
/** งบความยาวของรายชื่อไฟล์ต่อก้อน — รายชื่อยาวเกินถูกตัดเป็น "… and N more" ไม่ให้ข้อความทะลุเพดานของ Discord */
const FILES_BUDGET = 1200;

/** "**Exported · HotelTime** (22)\na.xlsx, b.xlsx, …" — ว่าง = ไม่มีก้อนนี้ */
function filesBlock(title: string, files: readonly string[]): string | undefined {
  if (files.length === 0) return undefined;
  const shown: string[] = [];
  let used = 0;
  for (const raw of files) {
    const f = raw.replace(/^(hoteltime|foodstory)__/, ''); // ชื่อ Site อยู่ในหัวข้อก้อนแล้ว — ตัดออกให้รายชื่อสั้นลงจะได้โชว์ได้มากไฟล์ขึ้น
    if (used + f.length + 2 > FILES_BUDGET) break;
    shown.push(f);
    used += f.length + 2;
  }
  const more = files.length - shown.length;
  return `**${title}** (${files.length})\n${shown.join(', ')}${more > 0 ? ` … and ${more} more` : ''}`;
}

/** คำสรุปท้ายข้อความ: ปกติ/สิ่งที่ต้องทำ/ปัญหา + รายการจริง (ไม่ต้องให้คนไปรัน `exporter status` เอง) */
function statusVerdict(report: StatusReport): string {
  if (report.verdict === 'ok') return 'All good';
  const isProblem = report.verdict === 'problem';
  const count = isProblem ? report.problems.length : report.actions.length;
  const notes = [...report.notes.problems, ...report.notes.actions];
  // รายการที่ไม่มีคำอังกฤษ (ปัญหารายวัน/snapshot ปิดงวด) ขึ้นเป็น alert "Needs attention" แยกอยู่แล้ว
  const uncovered = report.problems.length + report.actions.length - notes.length;
  const head = isProblem ? `${plural(count, 'problem')} to check` : `${plural(count, 'action')} needed`;
  const tail = uncovered > 0 ? [`(${uncovered} more listed under "Needs attention"; details: "exporter status")`] : [];
  return [head, ...notes.map((n) => `• ${n}`), ...tail].join('\n');
}

/** ก้อน "Failed" — ใช้ร่วมกันทั้งขา export/upload: ชื่อรายงาน/ไฟล์ + เหตุผลสั้น ๆ ต่อรายการ ไม่ใช่แค่ตัวเลข */
function failuresBlock(failures: readonly { readonly label: string; readonly reason: string }[]): string {
  const shown = failures.slice(0, FAILURE_SHOWN).map((f) => `• ${f.label}: ${f.reason}`);
  const more = failures.length > FAILURE_SHOWN ? [`... and ${failures.length - FAILURE_SHOWN} more`] : [];
  return [`Failed: ${plural(failures.length, 'file')}`, ...shown, ...more].join('\n');
}

/** รายงานตามวัน + รายงาน snapshot ของวันนี้ที่ล้มจริง (ไม่รวม "ยังไม่ได้ดึง"/"ยังไม่ได้ถ่าย" ที่เป็นแค่ยังไม่ถึงตา ไม่ใช่ความล้มเหลว) */
function exportFailures(report: StatusReport, today: string): { readonly label: string; readonly reason: string }[] {
  const out: { label: string; reason: string }[] = [];
  for (const site of report.sites) {
    const label = SITE_LABEL[site.site];
    const day = latestDataDay(site);
    for (const f of day?.perDay?.failed ?? []) out.push({ label: `${label}: ${f.report}`, reason: firstLine(f.error) });
    const pictures = site.days.find((d) => d.day === today)?.pictures;
    for (const f of pictures?.failed ?? []) out.push({ label: `${label}: ${f.report} (snapshot)`, reason: firstLine(f.error) });
  }
  return out;
}

const STATUS_HINT = 'run "exporter status" on the machine for details';

function summaryOf(report: StatusReport, today: string, run: RunInfo | undefined): string {
  const dataDay = report.sites.map(latestDataDay).filter((d) => d !== undefined).map((d) => d.day).sort().at(-1);
  const verdictLine = statusVerdict(report);
  const title = report.verdict === 'problem' ? 'Export finished with problems' : report.verdict === 'action' ? 'Export done · action needed' : 'Export done';

  const at = run?.at ?? report.at;
  const header = [`### ${title} · ${clockParts(at).time}`, subtext(at, run, dataDay ? [`data date ${dataDay}`] : [])].join('\n');
  const sitesBlock = report.sites.map((s) => summarySiteBlock(s, today)).join('\n');
  const failures = exportFailures(report, today);

  const files = report.sites.map((s) => filesBlock(`Exported · ${SITE_LABEL[s.site]}`, run?.files?.[s.site] ?? [])).filter((b) => b !== undefined);
  const blocks = [sitesBlock, ...files, failures.length > 0 ? `${failuresBlock(failures)}\n\n${verdictLine}` : verdictLine];
  return [header, ...blocks].join(SECTION_BREAK);
}

function alertsOf(report: StatusReport, today: string): Alert[] {
  const out: Alert[] = [];
  const time = report.at.slice(11);
  for (const site of report.sites) {
    const label = SITE_LABEL[site.site];
    for (const d of site.days) {
      if (d.level !== 'problem') continue;
      const at = `${label} ${d.day === today ? `today ${d.day}` : `data for ${d.day}`}`;
      if (d.state !== undefined) {
        out.push({ key: `state@${site.site}@${d.day}`, line: `${at}: ${d.state === 'running' ? 'run did not finish' : '_run.json unreadable'}` });
        continue;
      }
      for (const f of d.perDay?.failed ?? []) {
        out.push({ key: `failed@${site.site}@${d.day}@${f.report}`, line: `${at}: ${f.report} failed — ${firstLine(f.error)}` });
      }
      // FoodStory ที่ยังไม่ได้ดึง = เรื่อง "ไม่ได้กด" (เตือนแยก) ไม่ใช่ปัญหาของวันนั้น
      if (site.site === 'hoteltime') {
        for (const id of d.perDay?.notFetched ?? []) out.push({ key: `missing@${site.site}@${d.day}@${id}`, line: `${at}: ${id} not fetched` });
      }
      if (d.day === today && d.pictures && (site.site === 'hoteltime' || time >= MANUAL_PICTURE_ALERT_AT)) {
        for (const f of d.pictures.failed) out.push({ key: `picture@${site.site}@${d.day}@${f.report}`, line: `${at}: snapshot ${f.report} could not be taken — ${firstLine(f.error)}` });
        for (const id of d.pictures.missing) out.push({ key: `picture@${site.site}@${d.day}@${id}`, line: `${at}: snapshot ${id} not taken yet` });
      }
    }
    for (const c of site.closes) {
      if (c.level !== 'problem') continue;
      const lost = today > c.retryUntil;
      const period = c.period === 'year' ? `year ${c.periodEnd.slice(0, 4)}` : `month ${c.periodEnd.slice(0, 7)}`;
      for (const id of [...c.failed.map((f) => f.report), ...c.missing]) {
        out.push({
          key: `close@${site.site}@${c.periodEnd}@${id}${lost ? '@lost' : ''}`,
          line: `${label} period-close snapshot for ${period}: ${id} ${lost ? 'lost for good (retry window is over)' : `not taken yet — retrying until ${c.retryUntil}`}`,
        });
      }
    }
    if (site.backlogDays > 0) {
      out.push({ key: `backlog@${site.site}@${today}`, line: `${label}: ${plural(site.backlogDays, 'day')} of data missing, more than one run can fill` });
    }
    const neverPressed = site.daysSinceLastRun === null && report.setup.goLive !== null;
    if (site.site === 'foodstory' && (neverPressed || (site.daysSinceLastRun ?? 0) >= NOT_PRESSED_ALERT_DAYS)) {
      out.push({
        key: `not-pressed@${site.site}@${today}`,
        line: site.daysSinceLastRun === null ? 'FoodStory has never been run' : `FoodStory not run for ${site.daysSinceLastRun} days — ask staff to double-click "Exporter - FoodStory Daily"`,
      });
    }
  }
  return out;
}

/**
 * รวมบรรทัดเป็นข้อความไม่เกินเพดานของ Discord — บรรทัดเดียวยาวเกินถูกตัด (กุญแจยังอยู่ ไม่มีเรื่องหาย) · `headers.first`
 * ใช้กับก้อนแรกเท่านั้น `headers.rest` ใช้กับก้อนที่ 2 เป็นต้นไป (ถ้ามี เพราะยาวเกินจนต้องแบ่งหลายข้อความ) — ต่างกันได้
 * เพราะก้อนแรกอาจถูกเอาไปรวมกับข้อความสรุป (ใช้ header สั้น ไม่ต้องมีหัวข้อซ้ำ) แต่ก้อนที่เหลือกลายเป็นข้อความเดี่ยว ๆ
 * แยกออกไปเอง ต้องมีหัวข้อเต็มของตัวเอง (พบจาก code review 2026-10-19)
 */
function pack(headers: { readonly first: string; readonly rest: string }, alerts: readonly Alert[], accentColor: number): DiscordMessage[] {
  const out: DiscordMessage[] = [];
  let keys: string[] = [];
  let lines: string[] = [];
  const header = () => (out.length === 0 ? headers.first : headers.rest);
  const flush = () => {
    if (keys.length > 0) out.push({ keys, content: [header(), ...lines].join('\n'), accentColor });
    keys = [];
    lines = [];
  };
  for (const a of alerts) {
    const h = header();
    const line = `• ${a.line}`.slice(0, MAX_CONTENT - h.length - 1);
    if ([h, ...lines, line].join('\n').length > MAX_CONTENT) flush();
    keys.push(a.key);
    lines.push(line);
  }
  flush();
  return out;
}

/**
 * เลือก header ของแต่ละก้อน alert ให้ตรงกับว่าก้อนแรกจะถูกรวมกับสรุปหรือไม่ — รวมกันอยู่ที่เดียวนี้ไม่ให้สอง caller
 * (`discordMessages`/`uploadDiscordMessages`) ต้องเขียน ternary เดิมซ้ำกัน (พบจาก code review 2026-10-19)
 */
function alertHeaders(hasSummary: boolean, fullHeader: string): { readonly first: string; readonly rest: string } {
  return { first: hasSummary ? '**Needs attention**' : fullHeader, rest: fullHeader };
}

/**
 * รวมสรุปกับแจ้งเตือนเข้า**ข้อความเดียว**เมื่อทั้งสองมีอยู่ในการเรียกเดียวกัน (เจ้าของระบบขอ 2026-10-19) — ถ้ามีแจ้งเตือน
 * เกินเพดานความยาวจนต้องแบ่งหลายข้อความ (`pack` คืนมาหลายชิ้น) รวมแค่ชิ้นแรกกับสรุป ชิ้นที่เหลือยังเป็นข้อความแยก
 * เพราะเพดานความยาวของ Discord บังคับ ไม่มีทางเลี่ยง
 */
function mergeFirstMessages(summaryMsg: DiscordMessage | undefined, alertMsgs: readonly DiscordMessage[]): DiscordMessage[] {
  if (summaryMsg === undefined) return [...alertMsgs];
  const [first, ...rest] = alertMsgs;
  if (first === undefined) return [summaryMsg];
  const merged: DiscordMessage = {
    keys: [...summaryMsg.keys, ...first.keys],
    content: [summaryMsg.content, first.content].join(SECTION_BREAK),
    accentColor: first.accentColor, // มีเรื่องต้องดูจริง → ใช้สีของแจ้งเตือนทับสีของสรุปเสมอ
  };
  return [merged, ...rest];
}

/**
 * ข้อความที่ต้องส่งตอนนี้ — `summary` = ส่งสรุปของรอบนี้ (ผู้เรียกตัดสิน: ทุกรอบรายวัน, หรือสั่งเอง) · `alreadySent` = กุญแจที่ส่งไปแล้ว ·
 * กุญแจสรุป = `summary@<เวลาของรอบ>` (ต่อรอบ ไม่ใช่ต่อวัน — เจ้าของระบบขอ 2026-10-21 ให้สรุปทุกรอบเหมือนขา upload)
 */
export function discordMessages(report: StatusReport, opts: { readonly summary: boolean; readonly alreadySent: ReadonlySet<string>; readonly run?: RunInfo }): DiscordMessage[] {
  const today = report.at.slice(0, 10);
  const summaryKey = `summary@${opts.run?.at ?? report.at}`;
  const summaryMsg: DiscordMessage | undefined = opts.summary && !opts.alreadySent.has(summaryKey)
    ? { keys: [summaryKey], content: summaryOf(report, today, opts.run), accentColor: DISCORD_COLOR[report.verdict] }
    : undefined;

  const seen = new Set<string>();
  // เรื่องเดียวกันไม่ซ้ำในวันเดียวกัน — วันนี้อยู่ในกุญแจทุกตัว (กุญแจที่มีวันนี้อยู่แล้วไม่ต่อซ้ำ)
  // "ไม่ได้กด"/"ขาดเกินเพดาน" มีคำอังกฤษอยู่ในรายการสิ่งที่ต้องทำของสรุปแล้ว — ไม่ขึ้นซ้ำเป็น alert ในรอบที่ส่งสรุป (opts.summary) — รวมรอบที่สรุปเคยส่งไปแล้ว
  const fresh = alertsOf(report, today)
    .filter((a) => !opts.summary || !/^(not-pressed|backlog)@/.test(a.key))
    .map((a) => (a.key.endsWith(`@${today}`) ? a : { ...a, key: `${a.key}@${today}` }))
    .filter((a) => !opts.alreadySent.has(a.key) && !seen.has(a.key) && seen.add(a.key));
  const at = opts.run?.at ?? report.at;
  const alertMsgs = pack(alertHeaders(summaryMsg !== undefined, `### Needs attention\n${subtext(at, undefined)}`), fresh, DISCORD_COLOR.problem);
  return mergeFirstMessages(summaryMsg, alertMsgs);
}

// ── ticket 05 ของ exporter-upload-to-uploader: ข้อความ Discord ของขาอัปโหลด ──
//
// มิเรอร์รูปของสรุป/แจ้งเตือนข้างบน: สรุปท้ายรอบอัปโหลดหนึ่งข้อความเสมอ (อัปโหลดรันได้หลายครั้งต่อวัน แต่ละครั้งมีของตัวเอง
// ให้รายงาน) + แจ้งทันทีเฉพาะไฟล์ที่ถูกปฏิเสธถาวร (`rejected` — convert/400, ไม่ retry ได้) เรื่องเดียวไม่ซ้ำในวันเดียวกัน

/**
 * `rejected` ที่เกิดจากยังไม่มี `document_type` (FoodStory จนกว่า ticket 08) — รู้สาเหตุอยู่แล้วและทำอะไรไม่ได้
 * ตอนนี้ ต่างจาก `rejected` แบบอื่น (catalog ไม่ตรง, as_of หาไม่เจอ, uploader ปฏิเสธจริง) ที่เป็นเรื่องผิดปกติ
 * ที่ต้องรีบดู — แยกออกจากทุกจุดที่ตัดสินความเร่งด่วน (verdict/สี/alert) ไม่ให้กลายเป็น "เรื่องต้องดู" ปลอม ๆ
 * (เจ้าของระบบขอ 2026-10-19 หลังเจอ FoodStory ยิง alert สแปม 57 ข้อความ) — ยังนับรวมอยู่ใน
 * `UploadRunResult.rejected`/exit code ของ CLI เหมือนเดิม แค่ไม่ให้ไปเป็นความเร่งด่วนฝั่ง Discord
 */
function isPendingDocumentType(item: UploadFileResult): boolean {
  return item.kind === 'rejected' && isUnresolvedDocumentTypeReason(item.reason);
}

function genuineRejectedCount(r: UploadRunResult): number {
  return r.results.filter((item) => item.kind === 'rejected' && !isPendingDocumentType(item)).length;
}

function pendingDocumentTypeCount(r: UploadRunResult): number {
  return r.results.filter(isPendingDocumentType).length;
}

function uploadVerdictLine(r: UploadRunResult): string {
  const genuineRejected = genuineRejectedCount(r);
  if (genuineRejected > 0 || r.stuck > 0) return `${plural(genuineRejected + r.stuck, 'problem')} to check — ${STATUS_HINT}`;
  if (r.blocked > 0) return `${plural(r.blocked, 'file')} blocked because as_of is in the past — check with the uploader team if you meant to send them`;
  return 'All good';
}

/** สีแถบซ้าย — มีไฟล์ปฏิเสธถาวร (ไม่รวม "รอ document_type")/ค้างถาวร = แดง · บล็อก(as_of) ยังไม่ใช่ปัญหาแต่ต้องดู = เหลือง · ปกติ = เขียว */
function uploadAccentColor(r: UploadRunResult): number {
  if (genuineRejectedCount(r) > 0 || r.stuck > 0) return DISCORD_COLOR.problem;
  if (r.blocked > 0) return DISCORD_COLOR.action;
  return DISCORD_COLOR.ok;
}

/** บรรทัดเดียวของ site แบบ log: `sent/total · duplicate · failed` + ตัวเลขเสริมเฉพาะที่ไม่เป็นศูนย์ (ชื่อไฟล์ที่ล้มอยู่ใน section "Failed") */
function uploadSiteBlock(r: UploadRunResult): string {
  const label = SITE_LABEL[r.site];
  const failed = genuineRejectedCount(r) + r.stuck;
  const parts = [`${r.sent}/${r.results.length} sent`, `${r.duplicate} duplicate`, `${failed} failed`];
  // rows_mismatch คือคำเตือน ไม่ใช่ความล้มเหลว แต่ก็ไม่ใช่ sent เฉย ๆ
  if (r.rowsMismatch > 0) parts.push(`${r.rowsMismatch} rows mismatch`);
  // ticket 13: แยก "ประกาศรายงานว่างสำเร็จแล้ว" (ไม่ต้องทำอะไร) กับ "ยังไม่ประกาศ" (ยัง backlog — flag ปิด/document_type ยัง resolve ไม่ได้/ลองแล้วไม่ผ่าน)
  const announcedEmpty = r.emptyResults.filter((e) => e.kind === 'announced').length;
  const pendingEmpty = r.emptyReports.length - announcedEmpty;
  if (announcedEmpty > 0) parts.push(`${announcedEmpty} empty announced`);
  if (pendingEmpty > 0) parts.push(`${pendingEmpty} empty not announced`);
  // รอ document_type (FoodStory จนกว่า ticket 08) — นับให้เห็น backlog แต่ไม่ใช่ "failed" เพราะไม่ใช่เรื่องผิดปกติที่ต้องรีบดู
  const pendingDocType = pendingDocumentTypeCount(r);
  if (pendingDocType > 0) parts.push(`${pendingDocType} waiting for document_type`);
  // ไฟล์ที่ติ๊ก "ยังรอส่ง (pending)" ใน ticket 05 — สาเหตุคือ as_of ย้อนหลัง ไม่ใช่แค่ยังไม่ถึงตา
  if (r.blocked > 0) parts.push(`${r.blocked} blocked (as_of)`);
  return `**${label}** ${parts.join(' · ')}`;
}

/** ข้อความเหตุผลของ `rejected`/`stuck` หนึ่งรายการ — ใช้ร่วมกันทั้งไฟล์ปกติและ `empty` (คนละ type แต่ shape ของสอง kind นี้เหมือนกัน) */
function failureReason(item: { readonly kind: 'rejected'; readonly reason: string } | { readonly kind: 'stuck'; readonly attempts: number; readonly lastMessage: string }): string {
  return item.kind === 'rejected' ? item.reason : `stuck after ${plural(item.attempts, 'attempt')} — ${item.lastMessage}`;
}

/** ไฟล์/รายงาน (ปกติและ `empty`) ที่ปฏิเสธถาวรหรือค้างถาวรของรอบนี้ มีชื่อจริงต่อรายการ — ไม่รวม "รอ document_type" (ดู `isPendingDocumentType`) */
function uploadFailures(r: UploadRunResult): { readonly label: string; readonly reason: string }[] {
  const label = SITE_LABEL[r.site];
  const fromFiles = r.results
    .filter((item): item is UploadFileResult & ({ readonly kind: 'rejected' } | { readonly kind: 'stuck' }) => (item.kind === 'rejected' && !isPendingDocumentType(item)) || item.kind === 'stuck')
    .map((item) => ({ label: `${label}: ${item.file} (${item.report})`, reason: failureReason(item) }));
  const fromEmpty = r.emptyResults
    .filter((item): item is EmptyResultEntry & ({ readonly kind: 'rejected' } | { readonly kind: 'stuck' }) => item.kind === 'rejected' || item.kind === 'stuck')
    .map((item) => ({ label: `${label}: ${item.report} (empty)`, reason: failureReason(item) }));
  return [...fromFiles, ...fromEmpty];
}

function uploadSummaryOf(r: UploadRunResult, at: string, run: RunInfo | undefined): string {
  const header = [`### Upload done · ${clockParts(at).time}`, subtext(at, run)].join('\n');
  const siteBlock = uploadSiteBlock(r);
  const failures = uploadFailures(r);
  const verdictLine = uploadVerdictLine(r);
  const sentFiles = r.results.filter((item) => item.kind === 'sent' || item.kind === 'duplicate' || item.kind === 'rows-mismatch').map((item) => item.file);
  const files = filesBlock(`Uploaded · ${SITE_LABEL[r.site]}`, sentFiles);
  const blocks = [siteBlock, ...(files !== undefined ? [files] : []), failures.length > 0 ? `${failuresBlock(failures)}\n\n${verdictLine}` : verdictLine];
  return [header, ...blocks].join(SECTION_BREAK);
}

/** แจ้งทันทีเฉพาะ `rejected` ที่ "ผิดปกติจริง" — ไม่รวม "รอ document_type" (เจ้าของระบบขอ 2026-10-19 หลังเจอ spam 57 ข้อความ) */
function uploadAlertsOf(r: UploadRunResult): Alert[] {
  const label = SITE_LABEL[r.site];
  return r.results
    .filter((item): item is UploadFileResult & { readonly kind: 'rejected' } => item.kind === 'rejected' && !isPendingDocumentType(item))
    .map((item) => ({ key: `upload-rejected@${r.site}@${item.file}`, line: `${label}: ${item.file} (${item.report}) rejected, not sent — ${item.reason}` }));
}

/**
 * ข้อความของขาอัปโหลด — เรียกครั้งเดียวต่อการรัน `exporter upload` หนึ่งครั้ง (`at` ควรเป็นเวลาจริงของรอบนั้น ไม่ใช่
 * วันเฉย ๆ เพราะอัปโหลดรันได้หลายครั้งต่อวัน) · ไม่มีไฟล์ไหนถูกประมวลผลเลยและไม่มีรายงานว่าง = ไม่ส่งอะไร · การแจ้งเตือนไฟล์
 * ถูกปฏิเสธถาวรกันซ้ำในวันเดียวกันแบบเดียวกับแจ้งเตือนฝั่ง export
 */
export function uploadDiscordMessages(result: UploadRunResult, opts: { readonly at: string; readonly alreadySent: ReadonlySet<string>; readonly run?: RunInfo }): DiscordMessage[] {
  if (result.results.length === 0 && result.emptyReports.length === 0) return [];
  const today = opts.at.slice(0, 10);
  const summaryKey = `upload-summary@${result.site}@${opts.at}`;
  const summaryMsg: DiscordMessage | undefined = !opts.alreadySent.has(summaryKey)
    ? { keys: [summaryKey], content: uploadSummaryOf(result, opts.at, opts.run), accentColor: uploadAccentColor(result) }
    : undefined;

  const seen = new Set<string>();
  const fresh = uploadAlertsOf(result)
    .map((a) => (a.key.endsWith(`@${today}`) ? a : { ...a, key: `${a.key}@${today}` }))
    .filter((a) => !opts.alreadySent.has(a.key) && !seen.has(a.key) && seen.add(a.key));
  const alertMsgs = pack(alertHeaders(summaryMsg !== undefined, `### Needs attention\n${subtext(opts.at, undefined)}`), fresh, DISCORD_COLOR.problem);
  return mergeFirstMessages(summaryMsg, alertMsgs);
}

// ── ตัวส่ง ──

export class DiscordError extends Error {
  override readonly name = 'DiscordError';
}

/** ความลับของ URL webhook ทุกรูปที่อาจโผล่ในข้อความผิดพลาด — ทั้ง URL, URL ไม่มี query, และ token (ส่วนท้ายของ path) */
export function webhookRedactor(url: string) {
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    // URL ผิดรูป — redact เท่าที่มี
  }
  const token = parsed?.pathname.split('/').filter((s) => s !== '').at(-1);
  return createRedactor([url, parsed ? `${parsed.origin}${parsed.pathname}` : null, token]);
}

const RETRY_WAIT_MS = [2_000, 5_000];
const MAX_RETRY_WAIT_MS = 15_000;

/** flag `IS_COMPONENTS_V2` ของ Discord — ข้อความแบบ component ห้ามมี `content` ระดับบนร่วมด้วย */
const IS_COMPONENTS_V2 = 1 << 15;
/** `type` ของ component ที่ใช้ — 17 = Container (แถบสีซ้าย), 10 = Text Display, 14 = Separator (เส้นขีดแบ่ง) */
const COMPONENT_TYPE = { container: 17, textDisplay: 10, separator: 14 } as const;

/**
 * ตัวแบ่ง Text Display หลายก้อนด้วย Separator component จริงของ Discord (ไม่ใช่เส้น "-" ในข้อความ) — เจ้าของระบบขอ
 * 2026-10-19 ให้ข้อความสรุป (header + เวลา / แต่ละ site / ไม่สำเร็จ) มีเส้นแบ่งจริงระหว่างท่อนที่ไม่เกี่ยวกัน ·
 * ฝังเป็น sentinel ใน `content` string เดียว (ไม่เปลี่ยน `DiscordMessage.content: string` เดิม) แล้วแยกตอนส่งจริง
 * ใน `containerPayload` — ข้อความที่ไม่มี sentinel นี้เลย (alert ของ `pack()`) ได้ Text Display เดียวเหมือนเดิมทุกจุด
 */
export const SECTION_BREAK = '\u0000SECTION-BREAK\u0000';

/** ห่อข้อความเป็น Discord Container หนึ่งอัน (แถบสีซ้ายตาม `accentColor`) — แบ่งเป็นหลาย Text Display ด้วย Separator
 * จริงตรงจุดที่มี `SECTION_BREAK` — เจ้าของระบบขอ 2026-10-18 แทนข้อความ plain content เดิม, ขอเส้นแบ่งจริงเพิ่ม 2026-10-19 */
function containerPayload(content: string, accentColor: number): unknown {
  // .trim() กัน \n เกินจากการ join header หลายบรรทัด (H1+subtext) เข้ากับ SECTION_BREAK แล้วต่อด้วยเนื้อหาอีกก้อน
  // ไม่ให้ Text Display ที่ได้มีบรรทัดเปล่านำหน้า/ตามหลังเกินจำเป็น
  const parts = content.split(SECTION_BREAK).map((part) => part.trim());
  const components = parts.flatMap((part, i) =>
    i === 0 ? [{ type: COMPONENT_TYPE.textDisplay, content: part }] : [{ type: COMPONENT_TYPE.separator }, { type: COMPONENT_TYPE.textDisplay, content: part }],
  );
  return {
    flags: IS_COMPONENTS_V2,
    components: [{
      type: COMPONENT_TYPE.container,
      accent_color: accentColor,
      components,
    }],
    allowed_mentions: { parse: [] },
  };
}

/**
 * ปลายทาง webhook ต้องมี query `with_components=true` ถึงจะรับข้อความแบบ Components V2 — ไม่งั้น Discord ตอบ 400
 * "Cannot send an empty message" ทั้งที่ Text Display มีเนื้อหาอยู่ (พังจริง 2026-10-18, verified กับ webhook จริง)
 */
function withComponentsQuery(url: string): string {
  const u = new URL(url);
  u.searchParams.set('with_components', 'true');
  return u.toString();
}

/**
 * POST ข้อความไปที่ webhook (ไม่ mention ใคร) · rate limit (429) / 5xx / ต่อไม่ได้ ลองซ้ำเอง `retries` ครั้ง (ค่าเริ่มต้น 2) ตาม `retry_after` ของ Discord ·
 * ผิดพลาดทุกแบบ = `DiscordError` ที่ไม่มี URL/token ของ webhook (ตัว redact เดิม) — ผู้เรียกบันทึกแล้วไปต่อ (ครั้งถัดไปที่เรียกส่งเรื่องที่ค้างให้เอง)
 */
export async function postDiscord(
  url: string,
  message: { readonly content: string; readonly accentColor?: number },
  opts: { readonly timeoutMs?: number; readonly retries?: number } = {},
): Promise<void> {
  const redact = webhookRedactor(url);
  const retries = opts.retries ?? RETRY_WAIT_MS.length;
  for (let attempt = 0; ; attempt++) {
    let failure: { message: string; retryAfterMs: number | null; retryable: boolean };
    try {
      const res = await fetch(withComponentsQuery(url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(containerPayload(message.content, message.accentColor ?? DISCORD_COLOR.ok)),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      });
      if (res.ok) return;
      const body = await res.text().catch(() => '');
      let retryAfter: unknown = null;
      try {
        retryAfter = (JSON.parse(body) as { retry_after?: unknown }).retry_after;
      } catch {
        // ไม่ใช่ JSON
      }
      failure = {
        message: `Discord ตอบ HTTP ${res.status}${body ? ` — ${body.slice(0, 200)}` : ''}`,
        retryAfterMs: typeof retryAfter === 'number' ? retryAfter * 1000 : null,
        retryable: res.status === 429 || res.status >= 500,
      };
    } catch (err) {
      const cause = err instanceof Error ? `${err.message}${err.cause instanceof Error ? ` (${err.cause.message})` : ''}` : String(err);
      failure = { message: `ส่ง Discord ไม่ได้ — ${cause}`, retryAfterMs: null, retryable: true };
    }
    if (!failure.retryable || attempt >= retries) throw new DiscordError(redact(failure.message));
    const wait = Math.min(failure.retryAfterMs ?? RETRY_WAIT_MS[attempt] ?? RETRY_WAIT_MS.at(-1)!, MAX_RETRY_WAIT_MS);
    await new Promise((r) => setTimeout(r, wait));
  }
}

// ── บันทึกว่าส่งอะไรไปแล้ว (ในที่เก็บข้อมูล) ──

const LOG_DIR = '_notify';
const LOG_FILE = 'discord.json';
/** ลืมกุญแจที่ส่งเกินกี่วัน — เรื่องของวันของข้อมูลเก่ากว่านี้ไม่อยู่ในช่วงที่ status ดูแล้ว */
const KEEP_DAYS = 60;
const KEEP_FAILURES = 20;

export type NotifyLog = {
  readonly version: 1;
  /** กุญแจ → เวลาที่ส่ง (ISO) */
  readonly sent: Readonly<Record<string, string>>;
  /** ส่งไม่ได้ล่าสุด (redact แล้ว) — ให้คนตรวจ */
  readonly failures: readonly { readonly at: string; readonly keys: readonly string[]; readonly error: string }[];
};

export function notifyLogPath(dataDir: string): string {
  return path.join(dataDir, LOG_DIR, LOG_FILE);
}

export async function readNotifyLog(dataDir: string): Promise<NotifyLog> {
  try {
    const log = JSON.parse(await readFile(notifyLogPath(dataDir), 'utf8')) as NotifyLog;
    if (log && typeof log.sent === 'object' && Array.isArray(log.failures)) return log;
  } catch {
    // ไม่มีไฟล์ / ไฟล์เสีย = เริ่มใหม่ (อย่างแย่สุดคือส่งเรื่องเดิมซ้ำหนึ่งครั้ง — ดีกว่าเงียบ)
  }
  return { version: 1, sent: {}, failures: [] };
}

/**
 * บันทึกเรื่องที่ส่งแล้ว/ส่งไม่ได้ของรอบนี้ — **รวมกับไฟล์ล่าสุดบนดิสก์ตอนเขียน** (FoodStory กับ HotelTime อาจแจ้งพร้อมกัน — ไม่ให้คนเขียนทีหลังลบกุญแจของอีกคน)
 */
export async function writeNotifyLog(dataDir: string, update: { readonly sent: Readonly<Record<string, string>>; readonly failure?: NotifyLog['failures'][number] }, now: Date): Promise<void> {
  const current = await readNotifyLog(dataDir);
  const cutoff = now.getTime() - KEEP_DAYS * 86_400_000;
  const kept: NotifyLog = {
    version: 1,
    sent: Object.fromEntries(Object.entries({ ...current.sent, ...update.sent }).filter(([, at]) => Date.parse(at) >= cutoff)),
    failures: [...current.failures, ...(update.failure ? [update.failure] : [])].slice(-KEEP_FAILURES),
  };
  const file = notifyLogPath(dataDir);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.partial`, `${JSON.stringify(kept, null, 2)}\n`, 'utf8');
  await rename(`${file}.partial`, file);
}
