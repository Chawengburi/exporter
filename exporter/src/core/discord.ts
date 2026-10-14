import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRedactor } from './redact.ts';
import type { DayView, SiteView, StatusReport } from './status.ts';

/**
 * ข้อความ Discord (ใบ 08) — ฟังก์ชันล้วนจากผลของ `exporter status` (`buildStatus`, ใบ 07): ระดับรอ/ปัญหาตามกติกาเวลามาจาก status แล้ว ที่นี่ไม่คิดซ้ำ
 *
 * - **สรุปรายวัน** (วันละข้อความ — ไม่มีข้อความวันไหนแปลว่าระบบเงียบ): ต่อ Site วันของข้อมูลล่าสุดที่ถึงกำหนด มีข้อมูลกี่รายงาน ว่างตัวไหน ล้ม/ขาดกี่ตัว
 *   และรายงานภาพของวันนี้ครบไหม
 * - **แจ้งเตือน**: ทุกเรื่องที่ status ตัดสินว่าเป็นปัญหา (รายงานยังล้ม/ขาดหลังรอบเก็บตก, รายงานภาพของวันนี้ถ่ายไม่ได้, ภาพปิดงวด, `_run.json` เสีย/รอบไม่จบ)
 *   + วันขาดเกินที่รอบเดียวเติมได้ + FoodStory ไม่ได้กดมา `NOT_PRESSED_ALERT_DAYS` วันขึ้นไป
 * - ทุกเรื่องมีกุญแจ (`ชนิด@site@วัน@รายงาน@วันนี้`) — เรื่องเดียวกันไม่ส่งซ้ำในวันเดียวกัน (spec) · ยังไม่หายพรุ่งนี้ = เตือนอีกวันละครั้ง
 * - รายงานภาพของวันนี้ของ FoodStory ล้ม = พนักงานกดใหม่ได้ทั้งวัน → เตือนตั้งแต่ 18:30 ("ถ่ายไม่ได้ทุกรอบ" — user story 39)
 * - FoodStory ยังไม่เคยกดเลย เตือนเฉพาะเครื่องที่ตั้งวันเริ่มใช้งานแล้ว (ยังไม่ตั้ง = ยังไม่เริ่มใช้งาน)
 */

/** FoodStory ไม่ได้กดมากี่วันถึงเตือน — 2 = ไม่ได้กดทั้งเมื่อวานและวันนี้ */
export const NOT_PRESSED_ALERT_DAYS = 2;
/** เพดานความยาวข้อความของ Discord คือ 2000 ตัวอักษร — เผื่อไว้ */
const MAX_CONTENT = 1900;
const NAMES_SHOWN = 8;
const SITE_LABEL: Readonly<Record<SiteView['site'], string>> = { hoteltime: 'HotelTime', foodstory: 'FoodStory' };
/** เวลาไทยที่รายงานภาพของวันนี้ของ FoodStory ล้มแล้วถือว่า "ถ่ายไม่ได้ทุกรอบ" — เท่ากับเส้นหลังรอบเก็บตกสุดท้ายของ HotelTime */
const MANUAL_PICTURE_ALERT_AT = '18:30';

export type DiscordMessage = { readonly keys: readonly string[]; readonly content: string };
type Alert = { readonly key: string; readonly line: string };

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

function summaryLine(site: SiteView, today: string): string {
  const label = SITE_LABEL[site.site];
  const parts: string[] = [];
  const day = latestDataDay(site);
  if (day?.perDay) {
    const v = day.perDay;
    parts.push(`มีข้อมูล ${v.data}/${v.total}`);
    if (v.empty.length > 0) parts.push(`ว่าง ${v.empty.length} (${names(v.empty)})`);
    if (v.failed.length > 0) parts.push(`ล้ม ${v.failed.length} (${names(v.failed.map((f) => f.report))})`);
    if (v.notFetched.length > 0) parts.push(`ยังไม่ได้ดึง ${v.notFetched.length}`);
  } else if (day?.state) parts.push(day.state === 'running' ? 'รอบไม่จบ' : '_run.json อ่านไม่ได้');
  else parts.push('ยังไม่ได้ดึง');
  const pictures = site.days.find((d) => d.day === today)?.pictures;
  if (pictures) {
    const bad = pictures.failed.length + pictures.missing.length;
    parts.push(bad === 0 ? `ภาพวันนี้ ครบ ${pictures.taken}/${pictures.total}` : `ภาพวันนี้ ${pictures.taken}/${pictures.total} (ไม่ได้ ${bad})`);
  }
  if (site.site === 'foodstory' && site.daysSinceLastRun !== null && site.daysSinceLastRun >= 1) {
    parts.push(`ไม่ได้กดมา ${site.daysSinceLastRun} วัน`);
  }
  return `${label}: ${parts.join(' · ')}`;
}

function summaryOf(report: StatusReport, today: string): string {
  const dataDay = report.sites.map(latestDataDay).filter((d) => d !== undefined).map((d) => d.day).sort().at(-1);
  const verdict = report.verdict === 'ok' ? '✅ ปกติ'
    : report.verdict === 'action' ? `⚠️ มีสิ่งที่ต้องทำ ${report.actions.length} อย่าง`
    : `🚨 มีเรื่องต้องดู ${report.problems.length} เรื่อง`;
  return [
    `📊 สรุป exporter ประจำวัน ${today}${dataDay ? ` (ข้อมูลวันที่ ${dataDay})` : ''}`,
    ...report.sites.map((s) => summaryLine(s, today)),
    `${verdict}${report.verdict === 'ok' ? '' : ' — รายละเอียด: รัน exporter status บนเครื่อง'}`,
  ].join('\n');
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
        for (const f of d.pictures.failed) out.push({ key: `picture@${site.site}@${d.day}@${f.report}`, line: `${at}: รายงานภาพ ${f.report} ถ่ายไม่ได้ — ${firstLine(f.error)}` });
        for (const id of d.pictures.missing) out.push({ key: `picture@${site.site}@${d.day}@${id}`, line: `${at}: รายงานภาพ ${id} ยังไม่ได้ถ่าย` });
      }
    }
    for (const c of site.closes) {
      if (c.level !== 'problem') continue;
      const lost = today > c.retryUntil;
      const period = c.period === 'year' ? `ปี ${c.periodEnd.slice(0, 4)}` : `เดือน ${c.periodEnd.slice(0, 7)}`;
      for (const id of [...c.failed.map((f) => f.report), ...c.missing]) {
        out.push({
          key: `close@${site.site}@${c.periodEnd}@${id}${lost ? '@lost' : ''}`,
          line: `${label} ภาพปิดงวด${period}: ${id} ${lost ? 'หายถาวร (พ้นช่วงลองซ้ำแล้ว)' : `ยังไม่ได้ — ${c.note}`}`,
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

/** รวมบรรทัดเป็นข้อความไม่เกินเพดานของ Discord — บรรทัดเดียวยาวเกินถูกตัด (กุญแจยังอยู่ ไม่มีเรื่องหาย) */
function pack(header: string, alerts: readonly Alert[]): DiscordMessage[] {
  const out: DiscordMessage[] = [];
  let keys: string[] = [];
  let lines: string[] = [];
  const flush = () => {
    if (keys.length > 0) out.push({ keys, content: [header, ...lines].join('\n') });
    keys = [];
    lines = [];
  };
  for (const a of alerts) {
    const line = `• ${a.line}`.slice(0, MAX_CONTENT - header.length - 1);
    if ([header, ...lines, line].join('\n').length > MAX_CONTENT) flush();
    keys.push(a.key);
    lines.push(line);
  }
  flush();
  return out;
}

/** ข้อความที่ต้องส่งตอนนี้ — `summary` = ถึงเวลาสรุปของวันนี้ (ผู้เรียกตัดสิน) · `alreadySent` = กุญแจที่ส่งไปแล้ว */
export function discordMessages(report: StatusReport, opts: { readonly summary: boolean; readonly alreadySent: ReadonlySet<string> }): DiscordMessage[] {
  const today = report.at.slice(0, 10);
  const out: DiscordMessage[] = [];
  const summaryKey = `summary@${today}`;
  if (opts.summary && !opts.alreadySent.has(summaryKey)) out.push({ keys: [summaryKey], content: summaryOf(report, today) });
  const seen = new Set<string>();
  // เรื่องเดียวกันไม่ซ้ำในวันเดียวกัน — วันนี้อยู่ในกุญแจทุกตัว (กุญแจที่มีวันนี้อยู่แล้วไม่ต่อซ้ำ)
  const fresh = alertsOf(report, today)
    .map((a) => (a.key.endsWith(`@${today}`) ? a : { ...a, key: `${a.key}@${today}` }))
    .filter((a) => !opts.alreadySent.has(a.key) && !seen.has(a.key) && seen.add(a.key));
  out.push(...pack(`🚨 exporter — เรื่องที่ต้องดู (${report.at})`, fresh));
  return out;
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

/**
 * POST ข้อความไปที่ webhook (ไม่ mention ใคร) · rate limit (429) / 5xx / ต่อไม่ได้ ลองซ้ำเอง `retries` ครั้ง (ค่าเริ่มต้น 2) ตาม `retry_after` ของ Discord ·
 * ผิดพลาดทุกแบบ = `DiscordError` ที่ไม่มี URL/token ของ webhook (ตัว redact เดิม) — ผู้เรียกบันทึกแล้วไปต่อ (ครั้งถัดไปที่เรียกส่งเรื่องที่ค้างให้เอง)
 */
export async function postDiscord(url: string, content: string, opts: { readonly timeoutMs?: number; readonly retries?: number } = {}): Promise<void> {
  const redact = webhookRedactor(url);
  const retries = opts.retries ?? RETRY_WAIT_MS.length;
  for (let attempt = 0; ; attempt++) {
    let failure: { message: string; retryAfterMs: number | null; retryable: boolean };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
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
