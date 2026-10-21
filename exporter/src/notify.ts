import {
  DiscordError,
  discordMessages,
  postDiscord,
  readNotifyLog,
  uploadDiscordMessages,
  webhookRedactor,
  writeNotifyLog,
  type DiscordMessage,
} from './core/discord.ts';
import { buildStatus, defaultDataDir, readStoreSnapshot, readWebhookUrl, type Folder } from './core/status.ts';
import { formatISO } from './core/order.ts';
import { thaiClock, thaiToday } from './core/thai-time.ts';
import { defaultEnvFile, statusSetup } from './status-setup.ts';
import type { UploadRunResult } from './core/uploader.ts';

/**
 * แจ้งผลผ่าน Discord (ใบ 08) — ประกอบ status (ใบ 07) + ข้อความ (core/discord.ts) + บันทึกว่าส่งอะไรไปแล้ว (`data/_notify/discord.json`)
 *
 * เรียกหลังจบ `export --daily` ทุกรอบ (ทั้งสอง Site) และจาก `exporter notify` · **ไม่โยน error และไม่เปลี่ยน exit code ของรอบ export**: ไม่มี URL = ข้าม ·
 * ส่งไม่ได้ (Discord ล่ม/rate limit หลังลองซ้ำแล้ว) = บันทึกว่าส่งไม่ได้แล้วจบ (เรื่องที่ยังไม่ได้ส่ง ส่งในครั้งถัดไปเอง) · URL ไม่ถูกพิมพ์หรือบันทึกที่ไหน
 *
 * จังหวะ: **ทุกรอบรายวัน** ส่งสรุปหนึ่งข้อความ (2026-10-21 — เดิมวันละครั้งตอน 18:00) · รอบรายวัน HotelTime ที่จบตั้งแต่ 18:00 คือรอบเก็บตกสุดท้ายของวัน →
 * ประเมิน status เหมือนเป็น 18:30 (หลังรอบเก็บตก — ล้ม = ปัญหา ไม่ใช่ "รอ") · `exporter notify --summary` สั่งส่งสรุปเองได้
 *
 * `notifyUpload` (ticket 05 ของ `exporter-upload-to-uploader`) ใช้ log/ตัวส่งไฟล์เดียวกันนี้ (`sendAndLog`) แต่คนละ Discord
 * channel กับขา export — เจ้าของระบบขอ 2026-10-18 ให้แยก channel กัน: `DISCORD_WEBHOOK_URL_EXPORT` (ขา export, ฟังก์ชันนี้)
 * vs `DISCORD_WEBHOOK_URL_UPLOAD` (ขา upload, `notifyUpload`)
 */

export type NotifyTrigger = 'hoteltime-daily' | 'foodstory-daily' | 'manual';
export type NotifyResult =
  | { readonly status: 'skipped'; readonly reason: string }
  | { readonly status: 'dry-run'; readonly messages: readonly DiscordMessage[] }
  | { readonly status: 'sent'; readonly messages: number }
  | { readonly status: 'failed'; readonly sent: number; readonly error: string };

const FINAL_RUN_HOUR = 18;
const TRIGGER_LABEL: Readonly<Record<NotifyTrigger, string>> = { 'hoteltime-daily': 'HotelTime daily run', 'foodstory-daily': 'FoodStory run', manual: 'manual' };
const FINAL_EVALUATION_MIN = 18 * 60 + 30;

/** รอบรายวัน HotelTime ที่จบหลัง 18:00 = รอบสุดท้ายของวัน → ประเมินเหมือนเป็น 18:30 (ไม่ถอยเวลา ถ้าเลย 18:30 แล้ว) */
function evaluationTime(now: Date, trigger: NotifyTrigger): Date {
  const c = thaiClock(now);
  if (trigger !== 'hoteltime-daily' || c.hour < FINAL_RUN_HOUR || c.hour * 60 + c.minute >= FINAL_EVALUATION_MIN) return now;
  return new Date(now.getTime() + (FINAL_EVALUATION_MIN - (c.hour * 60 + c.minute)) * 60_000 - c.second * 1000);
}

/**
 * ส่งข้อความที่คำนวณไว้แล้วทั้งหมด หยุดที่ข้อความแรกที่ส่งไม่ได้ (ลองซ้ำในตัวส่งแล้ว — ข้อความถัดไปก็คงไม่ผ่าน) แล้ว
 * บันทึกผลทันที — ใช้ร่วมกันระหว่าง `notifyDiscord` (export) และ `notifyUpload` (upload) เพราะเป็นส่วนเดียวที่ไม่ขึ้นกับ
 * ว่าข้อความมาจากไหน
 */
async function sendAndLog(dataDir: string, url: string, messages: readonly DiscordMessage[], now: Date): Promise<NotifyResult> {
  const sent: Record<string, string> = {};
  let failure: { at: string; keys: readonly string[]; error: string } | undefined;
  for (const m of messages) {
    try {
      await postDiscord(url, m);
    } catch (err) {
      failure = { at: now.toISOString(), keys: m.keys, error: err instanceof DiscordError ? err.message : 'ส่ง Discord ไม่ได้ (ไม่ทราบสาเหตุ)' };
      break;
    }
    for (const k of m.keys) sent[k] = now.toISOString();
  }
  await writeNotifyLog(dataDir, { sent, ...(failure ? { failure } : {}) }, now);
  const done = messages.filter((m) => m.keys.every((k) => k in sent)).length;
  return failure ? { status: 'failed', sent: done, error: failure.error } : { status: 'sent', messages: done };
}

/** ชื่อไฟล์ที่รอบนี้เขียนลงดิสก์ (รายงานที่ `finishedAt` อยู่ในช่วงของรอบ) — ไม่รู้ระยะเวลารอบ (`since` ว่าง) = ไม่โชว์ชื่อไฟล์ */
function filesOfRun(folders: readonly Folder[], since: number): string[] {
  const out: string[] = [];
  for (const f of folders) {
    if (typeof f.record === 'string') continue;
    for (const o of Object.values(f.record.reports)) {
      if (o.status !== 'ok' || Date.parse(o.finishedAt) < since) continue;
      for (const file of o.files) out.push(file.file);
    }
  }
  return out.sort();
}

export async function notifyDiscord(opts: {
  readonly trigger: NotifyTrigger;
  readonly now?: Date;
  readonly dataDir?: string;
  readonly envFile?: string;
  /** สั่งส่งสรุปของวันนี้ (ถ้ายังไม่ได้ส่ง) — ไม่ใส่ = ตามจังหวะของ trigger */
  readonly summary?: boolean;
  /** คืนข้อความโดยไม่ส่งและไม่บันทึก */
  readonly dryRun?: boolean;
  /** ระยะเวลาของรอบ export (ms) สำหรับ subtext ของสรุป */
  readonly durationMs?: number;
}): Promise<NotifyResult> {
  const now = opts.now ?? new Date();
  const dataDir = opts.dataDir ?? defaultDataDir();
  const envFile = opts.envFile ?? defaultEnvFile();
  let redact = (s: string) => s;
  try {
    const url = readWebhookUrl(envFile, 'export');
    if (url !== null) redact = webhookRedactor(url);
    if (url === null && !opts.dryRun) return { status: 'skipped', reason: 'ยังไม่ได้ตั้ง DISCORD_WEBHOOK_URL_EXPORT ใน exporter/.env — ข้ามการส่ง Discord' };
    const log = await readNotifyLog(dataDir);
    // สรุปทุกรอบรายวัน (2026-10-21) · `exporter notify` เปล่า ๆ ไม่ส่งสรุป ต้องสั่ง --summary
    const summary = opts.summary ?? opts.trigger !== 'manual';
    const snapshot = await readStoreSnapshot(dataDir);
    const report = buildStatus(snapshot, evaluationTime(now, opts.trigger), statusSetup(envFile));
    // เผื่อ 60 วินาทีก่อนเริ่มรอบ (นาฬิกา/เวลาเริ่มโปรเซส) — เส้นแบ่งว่าไฟล์ไหนเป็นของรอบนี้
    const since = opts.durationMs !== undefined ? now.getTime() - opts.durationMs - 60_000 : undefined;
    const c = thaiClock(now);
    const p = (n: number) => String(n).padStart(2, '0');
    const run = {
      at: `${formatISO(thaiToday(now))} ${p(c.hour)}:${p(c.minute)}`,
      label: TRIGGER_LABEL[opts.trigger],
      ...(opts.durationMs !== undefined ? { durationMs: opts.durationMs } : {}),
      ...(since !== undefined ? { files: { hoteltime: filesOfRun(snapshot.hoteltime, since), foodstory: filesOfRun(snapshot.foodstoryDaily, since) } } : {}),
    };
    const messages = discordMessages(report, { summary, alreadySent: new Set(Object.keys(log.sent)), run });
    if (opts.dryRun) return { status: 'dry-run', messages };
    if (url === null || messages.length === 0) return { status: 'sent', messages: 0 };
    return await sendAndLog(dataDir, url, messages, now);
  } catch (err) {
    // ห้ามทำให้รอบ export ล้ม · redact เผื่อไว้ (ตัวส่งเป็นจุดเดียวที่ถือ URL และ redact เองแล้ว)
    return { status: 'failed', sent: 0, error: redact(`แจ้ง Discord ไม่สำเร็จ — ${err instanceof Error ? err.message : String(err)}`) };
  }
}

/**
 * แจ้งผลของ `exporter upload` หนึ่งรอบ (ticket 05 ของ `exporter-upload-to-uploader`) — เรียกทุกครั้งหลัง
 * `uploadFolder` จบ ไม่ว่าจะมีปัญหาหรือไม่ (ฟังก์ชันข้อความเองตัดสินว่าควรส่งอะไร รวมถึงไม่ส่งเลยถ้าไม่มีอะไรเกิดขึ้น
 * จริง) ใช้ log/ตัวส่งไฟล์เดียวกับ `notifyDiscord` แต่ส่งเข้า `DISCORD_WEBHOOK_URL_UPLOAD` คนละ channel (เจ้าของระบบขอ 2026-10-18)
 */
export async function notifyUpload(opts: {
  readonly result: UploadRunResult;
  readonly now?: Date;
  readonly dataDir?: string;
  readonly envFile?: string;
  readonly dryRun?: boolean;
  /** ระยะเวลาของรอบ upload (ms) สำหรับ subtext ของสรุป */
  readonly durationMs?: number;
}): Promise<NotifyResult> {
  const now = opts.now ?? new Date();
  const dataDir = opts.dataDir ?? defaultDataDir();
  const envFile = opts.envFile ?? defaultEnvFile();
  let redact = (s: string) => s;
  try {
    const url = readWebhookUrl(envFile, 'upload');
    if (url !== null) redact = webhookRedactor(url);
    if (url === null && !opts.dryRun) return { status: 'skipped', reason: 'ยังไม่ได้ตั้ง DISCORD_WEBHOOK_URL_UPLOAD ใน exporter/.env — ข้ามการส่ง Discord' };
    const log = await readNotifyLog(dataDir);
    const messages = uploadDiscordMessages(opts.result, {
      at: now.toISOString(),
      alreadySent: new Set(Object.keys(log.sent)),
      run: { ...(opts.durationMs !== undefined ? { durationMs: opts.durationMs } : {}) },
    });
    if (opts.dryRun) return { status: 'dry-run', messages };
    if (url === null || messages.length === 0) return { status: 'sent', messages: 0 };
    return await sendAndLog(dataDir, url, messages, now);
  } catch (err) {
    return { status: 'failed', sent: 0, error: redact(`แจ้ง Discord ไม่สำเร็จ — ${err instanceof Error ? err.message : String(err)}`) };
  }
}

/** บรรทัดเดียวสำหรับท้ายรอบ export / คำสั่ง notify */
export function describeNotify(r: NotifyResult): string {
  if (r.status === 'skipped') return `Discord: ${r.reason}`;
  if (r.status === 'dry-run') return `Discord (dry run): จะส่ง ${r.messages.length} ข้อความ — ยังไม่ได้ส่งและไม่ได้บันทึก`;
  if (r.status === 'failed') {
    return `⚠ Discord: ส่งไม่ได้ (ส่งได้ ${r.sent} ข้อความ) — ${r.error} · บันทึกไว้ใน data/_notify/discord.json แล้ว ครั้งถัดไปส่งต่อเอง`;
  }
  return r.messages === 0 ? 'Discord: ไม่มีเรื่องใหม่ต้องแจ้ง' : `Discord: ส่งแล้ว ${r.messages} ข้อความ`;
}
