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
 * - **สรุปรายวัน** (วันละข้อความ — ไม่มีข้อความวันไหนแปลว่าระบบเงียบ): ต่อ Site วันของข้อมูลล่าสุดที่ถึงกำหนด มีข้อมูลกี่รายงาน ว่างตัวไหน ล้ม/ขาดกี่ตัว
 *   และรายงาน snapshot ของวันนี้ครบไหม
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

const THAI_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'] as const;

/** `THAI_MONTH[month - 1]` แบบปลอดภัย (`noUncheckedIndexedAccess`) — เดือนนอกช่วง 1-12 (input ผิดรูป) ได้เลขเดือน
 * ดิบกลับมาแทน `undefined` ไม่ให้ข้อความ Discord ที่ส่งออกไปจริงมีคำว่า "undefined" โผล่เงียบ ๆ */
function thaiMonthName(month: number): string {
  return THAI_MONTH[month - 1] ?? String(month);
}

/**
 * "16 ต.ค. 2026 04:30" สำหรับ subtext เวลาใต้หัวข้อ notification (เจ้าของระบบขอ 2026-10-19) — รับทั้งสองรูปที่ใช้ใน
 * โค้ดนี้: "YYYY-MM-DD HH:MM" ที่เป็นเวลาไทยอยู่แล้ว (`StatusReport.at`) แยงตรงด้วย regex ไม่ผ่าน `Date` เพื่อไม่ให้
 * timezone ของเครื่องที่รันมาปน และ ISO UTC (`opts.at` ของขาอัปโหลด) ที่ต้องแปลงเป็นเวลาไทยก่อนด้วย `thaiClock`
 */
function thaiDisplayAt(at: string): string {
  const plain = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(at);
  if (plain) {
    const [, y, m, d, hh, mm] = plain as unknown as [string, string, string, string, string, string];
    return `${Number(d)} ${thaiMonthName(Number(m))} ${y} ${hh}:${mm}`;
  }
  const c = thaiClock(new Date(at));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${c.day} ${thaiMonthName(c.month)} ${c.year} ${p(c.hour)}:${p(c.minute)}`;
}

function names(ids: readonly string[]): string {
  const more = ids.length > NAMES_SHOWN ? ` และอีก ${ids.length - NAMES_SHOWN}` : '';
  return `${ids.slice(0, NAMES_SHOWN).join(', ')}${more}`;
}
const firstLine = (s: string) => {
  const line = s.split('\n')[0] ?? '';
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
};

/** วันของข้อมูลล่าสุดที่ถึงกำหนดของ Site (เมื่อวาน หลัง 07:00) */
const latestDataDay = (site: SiteView): DayView | undefined => [...site.days].reverse().find((d) => d.perDay !== null);

/**
 * บรรทัดรายละเอียดของ site หนึ่ง (ไม่รวม "ล้ม" — ย้ายไปรวมเป็น section "ไม่สำเร็จ" คนละก้อนแล้ว เพื่อให้คนที่ไม่ได้
 * อ่านโค้ด/ไม่สนใจรายละเอียดกวาดตาเห็นว่า "มีอะไรต้องดู" ได้ทันที ไม่ต้องแยกจากตัวเลขปกติเอง — เจ้าของระบบขอ 2026-10-19)
 */
function summarySiteBlock(site: SiteView, today: string): string {
  const label = SITE_LABEL[site.site];
  const day = latestDataDay(site);
  const parts: string[] = [];
  let fraction = '';
  if (day?.perDay) {
    const v = day.perDay;
    fraction = ` • (${v.data}/${v.total}) ไฟล์`;
    parts.push(`มีข้อมูล ${v.data}/${v.total}`);
    if (v.empty.length > 0) parts.push(`ว่าง ${v.empty.length} (${names(v.empty)})`);
    if (v.notFetched.length > 0) parts.push(`ยังไม่ได้ดึง ${v.notFetched.length}`);
  } else if (day?.state) parts.push(day.state === 'running' ? 'รอบไม่จบ' : '_run.json อ่านไม่ได้');
  else parts.push('ยังไม่ได้ดึง');
  const pictures = site.days.find((d) => d.day === today)?.pictures;
  if (pictures) {
    const bad = pictures.failed.length + pictures.missing.length;
    parts.push(bad === 0 ? `snapshot วันนี้ ครบ ${pictures.taken}/${pictures.total}` : `snapshot วันนี้ ${pictures.taken}/${pictures.total} (ไม่ได้ ${bad})`);
  }
  if (site.site === 'foodstory' && site.daysSinceLastRun !== null && site.daysSinceLastRun >= 1) {
    parts.push(`ไม่ได้กดมา ${site.daysSinceLastRun} วัน`);
  }
  return `**${label}${fraction}**\n${parts.join(' · ')}`;
}

const FAILURE_SHOWN = 8;

/** ก้อน "ไม่สำเร็จ" — ใช้ร่วมกันทั้งขา export/upload (เจ้าของระบบขอ 2026-10-19): ชื่อรายงาน/ไฟล์ + เหตุผลสั้น ๆ
 * ต่อรายการ ไม่ใช่แค่ตัวเลข เพราะคนเข้ามาดู (ไม่ต้องเข้าใจโค้ด) จำชื่อรายงาน/ไฟล์ได้ แต่ไม่รู้จัก error code */
function failuresBlock(failures: readonly { readonly label: string; readonly reason: string }[]): string {
  const shown = failures.slice(0, FAILURE_SHOWN).map((f) => `• ${f.label}: ${f.reason}`);
  const more = failures.length > FAILURE_SHOWN ? [`... และอีก ${failures.length - FAILURE_SHOWN} รายการ`] : [];
  return [`ไม่สำเร็จ ${failures.length} ไฟล์`, ...shown, ...more].join('\n');
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

function summaryOf(report: StatusReport, today: string): string {
  const dataDay = report.sites.map(latestDataDay).filter((d) => d !== undefined).map((d) => d.day).sort().at(-1);
  const total = report.sites.reduce((sum, s) => sum + (latestDataDay(s)?.perDay?.data ?? 0), 0);
  const verdict = report.verdict === 'ok' ? 'ปกติ'
    : report.verdict === 'action' ? `มีสิ่งที่ต้องทำ ${report.actions.length} อย่าง`
    : `มีเรื่องต้องดู ${report.problems.length} เรื่อง`;
  const verdictLine = `${verdict}${report.verdict === 'ok' ? '' : ' — รายละเอียด: รัน exporter status บนเครื่อง'}`;

  const header = [`## Export เอกสารแล้ว ${total} ไฟล์`, `-# ${thaiDisplayAt(report.at)}${dataDay ? ` — ข้อมูลวันที่ ${dataDay}` : ''}`].join('\n');
  const sitesBlock = report.sites.map((s) => summarySiteBlock(s, today)).join('\n\n');
  const failures = exportFailures(report, today);

  const blocks = failures.length > 0 ? [sitesBlock, `${failuresBlock(failures)}\n\n${verdictLine}`] : [`${sitesBlock}\n\n${verdictLine}`];
  return [header, ...blocks].join(SECTION_BREAK);
}

function alertsOf(report: StatusReport, today: string): Alert[] {
  const out: Alert[] = [];
  const time = report.at.slice(11);
  for (const site of report.sites) {
    const label = SITE_LABEL[site.site];
    for (const d of site.days) {
      if (d.level !== 'problem') continue;
      const at = `${label} ${d.day === today ? `วันนี้ ${d.day}` : `ข้อมูลวันที่ ${d.day}`}`;
      if (d.state !== undefined) {
        out.push({ key: `state@${site.site}@${d.day}`, line: `${at}: ${d.note}` });
        continue;
      }
      for (const f of d.perDay?.failed ?? []) {
        out.push({ key: `failed@${site.site}@${d.day}@${f.report}`, line: `${at}: ${f.report} ล้ม — ${firstLine(f.error)}` });
      }
      // FoodStory ที่ยังไม่ได้ดึง = เรื่อง "ไม่ได้กด" (เตือนแยก) ไม่ใช่ปัญหาของวันนั้น
      if (site.site === 'hoteltime') {
        for (const id of d.perDay?.notFetched ?? []) out.push({ key: `missing@${site.site}@${d.day}@${id}`, line: `${at}: ${id} ยังไม่ได้ดึง` });
      }
      if (d.day === today && d.pictures && (site.site === 'hoteltime' || time >= MANUAL_PICTURE_ALERT_AT)) {
        for (const f of d.pictures.failed) out.push({ key: `picture@${site.site}@${d.day}@${f.report}`, line: `${at}: รายงาน snapshot ${f.report} ถ่ายไม่ได้ — ${firstLine(f.error)}` });
        for (const id of d.pictures.missing) out.push({ key: `picture@${site.site}@${d.day}@${id}`, line: `${at}: รายงาน snapshot ${id} ยังไม่ได้ถ่าย` });
      }
    }
    for (const c of site.closes) {
      if (c.level !== 'problem') continue;
      const lost = today > c.retryUntil;
      const period = c.period === 'year' ? `ปี ${c.periodEnd.slice(0, 4)}` : `เดือน ${c.periodEnd.slice(0, 7)}`;
      for (const id of [...c.failed.map((f) => f.report), ...c.missing]) {
        out.push({
          key: `close@${site.site}@${c.periodEnd}@${id}${lost ? '@lost' : ''}`,
          line: `${label} snapshot ปิดงวด${period}: ${id} ${lost ? 'หายถาวร (พ้นช่วงลองซ้ำแล้ว)' : `ยังไม่ได้ — ${c.note}`}`,
        });
      }
    }
    if (site.backlogDays > 0) {
      out.push({ key: `backlog@${site.site}@${today}`, line: `${label}: ขาดอีก ${site.backlogDays} วันของข้อมูล เกินที่รอบเดียวเติมได้` });
    }
    const neverPressed = site.daysSinceLastRun === null && report.setup.goLive !== null;
    if (site.site === 'foodstory' && (neverPressed || (site.daysSinceLastRun ?? 0) >= NOT_PRESSED_ALERT_DAYS)) {
      out.push({
        key: `not-pressed@${site.site}@${today}`,
        line: site.daysSinceLastRun === null ? 'FoodStory ยังไม่เคยกดเลย' : `FoodStory ไม่ได้กดมา ${site.daysSinceLastRun} วัน — ให้พนักงานดับเบิลคลิก "ดึง FoodStory"`,
      });
    }
  }
  return out;
}

/**
 * รวมบรรทัดเป็นข้อความไม่เกินเพดานของ Discord — บรรทัดเดียวยาวเกินถูกตัด (กุญแจยังอยู่ ไม่มีเรื่องหาย) · `headers.first`
 * ใช้กับก้อนแรกเท่านั้น `headers.rest` ใช้กับก้อนที่ 2 เป็นต้นไป (ถ้ามี เพราะยาวเกินจนต้องแบ่งหลายข้อความ) — ต่างกันได้
 * เพราะก้อนแรกอาจถูกเอาไปรวมกับข้อความสรุป (ใช้ header สั้น ไม่ต้องมี H1 ซ้ำ) แต่ก้อนที่เหลือกลายเป็นข้อความเดี่ยว ๆ
 * แยกออกไปเอง ต้องมี H1 เต็มของตัวเอง — ไม่งั้นก้อนที่ 2+ จะไม่มีหัวข้อที่สมบูรณ์ (พบจาก code review 2026-10-19)
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
  return { first: hasSummary ? '**เรื่องที่ต้องดู**' : fullHeader, rest: fullHeader };
}

/**
 * รวมสรุปกับแจ้งเตือนเข้า**ข้อความเดียว**เมื่อทั้งสองมีอยู่ในการเรียกเดียวกัน (เจ้าของระบบขอ 2026-10-19 — เดิมแยก 2
 * ข้อความเพราะ "สรุป" เคยมีไว้ทำหน้าที่ heartbeat ด้วย แต่เจ้าของระบบตัดสินใจไม่ต้องการ heartbeat แยกแล้ว เอาแค่รวม
 * เป็นข้อความเดียวไปตามที่สั่ง) — ถ้ามีแจ้งเตือนเกินเพดานความยาวจนต้องแบ่งหลายข้อความ (`pack` คืนมาหลายชิ้น) รวมแค่
 * ชิ้นแรกกับสรุป ชิ้นที่เหลือยังเป็นข้อความแยกเพราะเพดานความยาวของ Discord บังคับ ไม่มีทางเลี่ยง
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

/** ข้อความที่ต้องส่งตอนนี้ — `summary` = ถึงเวลาสรุปของวันนี้ (ผู้เรียกตัดสิน) · `alreadySent` = กุญแจที่ส่งไปแล้ว */
export function discordMessages(report: StatusReport, opts: { readonly summary: boolean; readonly alreadySent: ReadonlySet<string> }): DiscordMessage[] {
  const today = report.at.slice(0, 10);
  const summaryKey = `summary@${today}`;
  const summaryMsg: DiscordMessage | undefined = opts.summary && !opts.alreadySent.has(summaryKey)
    ? { keys: [summaryKey], content: summaryOf(report, today), accentColor: DISCORD_COLOR[report.verdict] }
    : undefined;

  const seen = new Set<string>();
  // เรื่องเดียวกันไม่ซ้ำในวันเดียวกัน — วันนี้อยู่ในกุญแจทุกตัว (กุญแจที่มีวันนี้อยู่แล้วไม่ต่อซ้ำ)
  const fresh = alertsOf(report, today)
    .map((a) => (a.key.endsWith(`@${today}`) ? a : { ...a, key: `${a.key}@${today}` }))
    .filter((a) => !opts.alreadySent.has(a.key) && !seen.has(a.key) && seen.add(a.key));
  const alertMsgs = pack(alertHeaders(summaryMsg !== undefined, `## เรื่องที่ต้องดู\n-# ${thaiDisplayAt(report.at)}`), fresh, DISCORD_COLOR.problem);
  return mergeFirstMessages(summaryMsg, alertMsgs);
}

// ── ticket 05 ของ exporter-upload-to-uploader: ข้อความ Discord ของขาอัปโหลด ──
//
// มิเรอร์รูปของสรุป/แจ้งเตือนข้างบนให้เป็นภาษาเดียวกัน (กึ่งทางการ อ่านง่าย): 📤 สรุปท้ายรอบอัปโหลดหนึ่งข้อความเสมอ
// (ไม่ใช่รายวัน — อัปโหลดรันได้หลายครั้งต่อวัน แต่ละครั้งมีของตัวเองให้รายงาน) + 🚨 แจ้งทันทีเฉพาะไฟล์ที่ถูกปฏิเสธถาวร
// (`rejected` — convert/400, ไม่ retry ได้) เรื่องเดียวไม่ซ้ำในวันเดียวกัน เหมือนแจ้งเตือนของฝั่ง export

/**
 * `rejected` ที่เกิดจากยังไม่มี `document_type` (FoodStory จนกว่า ticket 08) — รู้สาเหตุอยู่แล้วและทำอะไรไม่ได้
 * ตอนนี้ ต่างจาก `rejected` แบบอื่น (catalog ไม่ตรง, as_of หาไม่เจอ, uploader ปฏิเสธจริง) ที่เป็นเรื่องผิดปกติ
 * ที่ต้องรีบดู — แยกออกจากทุกจุดที่ตัดสินความเร่งด่วน (verdict/สี/alert) ไม่ให้กลายเป็น "เรื่องต้องดู" ปลอม ๆ
 * (เจ้าของระบบขอ 2026-10-19 หลังเจอ FoodStory ยิง alert สแปม 57 ข้อความจากเหตุผลที่รู้อยู่แล้วล่วงหน้า) — ยังนับ
 * รวมอยู่ใน `UploadRunResult.rejected`/exit code ของ CLI เหมือนเดิม (ไม่แก้ตรงนั้น) แค่ไม่ให้ไปเป็นความเร่งด่วน
 * ฝั่ง Discord
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
  // ข้อความเดิมมี "— รายละเอียด: รัน exporter status บนเครื่อง" ต่อท้าย — คงไว้เหมือนฝั่ง export (summaryOf
  // ด้านบน) เพื่อให้ wording สองขาสอดคล้องกัน (พบจาก code review ว่าหลุดหายไปตอนทำ section "ไม่สำเร็จ")
  const genuineRejected = genuineRejectedCount(r);
  if (genuineRejected > 0 || r.stuck > 0) return `มีเรื่องต้องดู ${genuineRejected + r.stuck} เรื่อง — รายละเอียด: รัน exporter status บนเครื่อง`;
  if (r.blocked > 0) return `มี ${r.blocked} ไฟล์ถูกบล็อกเพราะ as_of ย้อนหลัง — คุยกับทีม uploader ก่อนถ้าตั้งใจส่งจริง`;
  return 'ปกติ';
}

/** สีแถบซ้าย — มีไฟล์ปฏิเสธถาวร (ไม่รวม "รอ document_type")/ค้างถาวร = แดง · บล็อก(as_of) ยังไม่ใช่ปัญหาแต่ต้องดู = เหลือง · ปกติ = เขียว */
function uploadAccentColor(r: UploadRunResult): number {
  if (genuineRejectedCount(r) > 0 || r.stuck > 0) return DISCORD_COLOR.problem;
  if (r.blocked > 0) return DISCORD_COLOR.action;
  return DISCORD_COLOR.ok;
}

/** รายละเอียดของ site หนึ่ง — ไม่รวม "ปฏิเสธ"/"ค้างถาวร" เป็นตัวเลขเปล่า ๆ อีกต่อไป (ย้ายไปเป็นรายชื่อไฟล์จริงใน
 * section "ไม่สำเร็จ" แทน — เหตุผลเดียวกับฝั่ง export: คนดูจำชื่อไฟล์ได้ ไม่รู้จัก error code) */
function uploadSiteBlock(r: UploadRunResult): string {
  const label = SITE_LABEL[r.site];
  const total = r.results.length;
  const fraction = total > 0 ? ` • (${r.sent}/${total}) ไฟล์` : '';
  const parts = [`สำเร็จ ${r.sent}`];
  if (r.duplicate > 0) parts.push(`ซ้ำ ${r.duplicate}`);
  // เหมือน describeUploadResult ของ CLI — rows_mismatch คือคำเตือน ไม่ใช่ความล้มเหลว แต่ก็ไม่ใช่ sent เฉย ๆ
  if (r.rowsMismatch > 0) parts.push(`แถวไม่ตรง ${r.rowsMismatch}`);
  // ticket 13: "ว่าง" เฉย ๆ เคยแปลว่า "ไม่ต้องทำอะไร รอทีม uploader" (ticket 04) — ตอนนี้มีทางประกาศจริงแล้ว
  // (ticket 11) ต้องแยกว่า "ประกาศสำเร็จแล้ว" (ไม่ต้องทำอะไรจริง ๆ) กับ "ยังไม่ประกาศ" (ยัง backlog อยู่ — ปิด
  // flag/document_type ยัง resolve ไม่ได้/ลองแล้วแต่ยังไม่ผ่าน) ไม่ปนเป็นตัวเลขเดียวแบบเดิม
  const announcedEmpty = r.emptyResults.filter((e) => e.kind === 'announced').length;
  const pendingEmpty = r.emptyReports.length - announcedEmpty;
  if (announcedEmpty > 0) parts.push(`ว่าง-ประกาศสำเร็จ ${announcedEmpty}`);
  if (pendingEmpty > 0) parts.push(`ว่าง-ยังไม่ประกาศ ${pendingEmpty}`);
  // รอ document_type (FoodStory จนกว่า ticket 08) — ตัวเลขนับรวมไว้ให้เห็น backlog แต่ไม่ใช่ "ปฏิเสธ"/"ไม่สำเร็จ"
  // เพราะไม่ใช่เรื่องผิดปกติที่ต้องรีบดู (เจ้าของระบบขอ 2026-10-19)
  const pendingDocType = pendingDocumentTypeCount(r);
  if (pendingDocType > 0) parts.push(`รอ document_type ${pendingDocType}`);
  // "บล็อก(as_of)" คือไฟล์ที่ติ๊ก "ยังรอส่ง (pending)" ใน ticket 05 — ใช้ชื่อนี้เพราะบอกสาเหตุที่ต้องรอได้ตรงกว่า
  // "pending" เฉย ๆ (สาเหตุคือ as_of ย้อนหลัง ไม่ใช่แค่ยังไม่ถึงตา)
  if (r.blocked > 0) parts.push(`บล็อก(as_of) ${r.blocked}`);
  return `**${label}${fraction}**\n${parts.join(' · ')}`;
}

/** ข้อความเหตุผลของ `rejected`/`stuck` หนึ่งรายการ — ใช้ร่วมกันทั้งไฟล์ปกติและ `empty` (คนละ type แต่ shape ของสอง kind นี้เหมือนกัน) */
function failureReason(item: { readonly kind: 'rejected'; readonly reason: string } | { readonly kind: 'stuck'; readonly attempts: number; readonly lastMessage: string }): string {
  return item.kind === 'rejected' ? item.reason : `ค้างถาวรหลังลอง ${item.attempts} ครั้ง — ${item.lastMessage}`;
}

/** ไฟล์/รายงาน (ปกติและ `empty`) ที่ปฏิเสธถาวรหรือค้างถาวรของรอบนี้ — มีชื่อไฟล์/รายงานจริงต่อรายการ (เจ้าของระบบขอ
 * 2026-10-19) ไม่ใช่แค่ตัวเลข เพราะคนดูจำชื่อได้ ไม่ต้องเข้าใจ as_of/stage/retry — ไม่รวม "รอ document_type" (ดู
 * `isPendingDocumentType`) เพราะไม่ใช่ความล้มเหลว เป็นแค่ backlog ที่รอทีม uploader */
function uploadFailures(r: UploadRunResult): { readonly label: string; readonly reason: string }[] {
  const label = SITE_LABEL[r.site];
  const fromFiles = r.results
    .filter((item): item is UploadFileResult & ({ readonly kind: 'rejected' } | { readonly kind: 'stuck' }) => (item.kind === 'rejected' && !isPendingDocumentType(item)) || item.kind === 'stuck')
    .map((item) => ({ label: `${label}: ${item.file} (${item.report})`, reason: failureReason(item) }));
  const fromEmpty = r.emptyResults
    .filter((item): item is EmptyResultEntry & ({ readonly kind: 'rejected' } | { readonly kind: 'stuck' }) => item.kind === 'rejected' || item.kind === 'stuck')
    .map((item) => ({ label: `${label}: ${item.report} (ว่าง)`, reason: failureReason(item) }));
  return [...fromFiles, ...fromEmpty];
}

function uploadSummaryOf(r: UploadRunResult, at: string): string {
  const header = [`## อัปโหลดเข้า uploader แล้ว ${r.sent} ไฟล์`, `-# ${thaiDisplayAt(at)}`].join('\n');
  const siteBlock = uploadSiteBlock(r);
  const failures = uploadFailures(r);
  const verdictLine = uploadVerdictLine(r);
  const blocks = failures.length > 0 ? [siteBlock, `${failuresBlock(failures)}\n\n${verdictLine}`] : [`${siteBlock}\n\n${verdictLine}`];
  return [header, ...blocks].join(SECTION_BREAK);
}

/** แจ้งทันทีเฉพาะ `rejected` ที่ "ผิดปกติจริง" — ไม่รวม "รอ document_type" (FoodStory จนกว่า ticket 08) เพราะรู้
 * สาเหตุอยู่แล้วและไม่มีอะไรให้ทำตอนนี้ ไม่ใช่เรื่องที่ต้องรีบดูทุกไฟล์ (เจ้าของระบบขอ 2026-10-19 หลังเจอ spam 57 ข้อความ) */
function uploadAlertsOf(r: UploadRunResult): Alert[] {
  const label = SITE_LABEL[r.site];
  return r.results
    .filter((item): item is UploadFileResult & { readonly kind: 'rejected' } => item.kind === 'rejected' && !isPendingDocumentType(item))
    .map((item) => ({ key: `upload-rejected@${r.site}@${item.file}`, line: `${label}: ${item.file} (${item.report}) ปฏิเสธไม่ส่ง — ${item.reason}` }));
}

/**
 * ข้อความของขาอัปโหลด — เรียกครั้งเดียวต่อการรัน `exporter upload` หนึ่งครั้ง (`at` ควรเป็นเวลาจริงของรอบนั้น ไม่ใช่
 * วันเฉย ๆ เพราะอัปโหลดรันได้หลายครั้งต่อวัน) · ไม่มีไฟล์ไหนถูกประมวลผลเลยและไม่มีรายงานว่าง = ไม่ส่งอะไร (ไม่ใช่สรุป
 * ตัวเลขศูนย์ที่ไม่มีใครอยากเห็นซ้ำ ๆ) · การแจ้งเตือนไฟล์ถูกปฏิเสธถาวรกันซ้ำในวันเดียวกันแบบเดียวกับแจ้งเตือนฝั่ง export
 */
export function uploadDiscordMessages(result: UploadRunResult, opts: { readonly at: string; readonly alreadySent: ReadonlySet<string> }): DiscordMessage[] {
  if (result.results.length === 0 && result.emptyReports.length === 0) return [];
  const today = opts.at.slice(0, 10);
  const summaryKey = `upload-summary@${result.site}@${opts.at}`;
  const summaryMsg: DiscordMessage | undefined = !opts.alreadySent.has(summaryKey)
    ? { keys: [summaryKey], content: uploadSummaryOf(result, opts.at), accentColor: uploadAccentColor(result) }
    : undefined;

  const seen = new Set<string>();
  // เหมือน discordMessages ของฝั่ง export — กันต่อ @${today} ซ้ำถ้ากุญแจมีวันนี้อยู่แล้ว (เผื่ออนาคตมีกุญแจที่มีวันในตัว)
  const fresh = uploadAlertsOf(result)
    .map((a) => (a.key.endsWith(`@${today}`) ? a : { ...a, key: `${a.key}@${today}` }))
    .filter((a) => !opts.alreadySent.has(a.key) && !seen.has(a.key) && seen.add(a.key));
  // เดิมแยกเป็น 2 ข้อความเสมอ — เจ้าของระบบขอ 2026-10-19 ให้รวมเป็นข้อความเดียวเมื่อมีสรุปอยู่แล้วในการเรียกนี้
  // (ขา upload มีสรุปแทบทุกครั้งที่เรียก ไม่ dedup ตามวันแบบขา export) เหมือนที่ทำกับ discordMessages ข้างบน
  const alertMsgs = pack(alertHeaders(summaryMsg !== undefined, `## เรื่องที่ต้องดู\n-# ${thaiDisplayAt(opts.at)}`), fresh, DISCORD_COLOR.problem);
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
