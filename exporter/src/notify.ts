import { DiscordError, discordMessages, postDiscord, readNotifyLog, webhookRedactor, writeNotifyLog, type DiscordMessage } from './core/discord.ts';
import { buildStatus, defaultDataDir, readStoreSnapshot, readWebhookUrl } from './core/status.ts';
import { formatISO } from './core/order.ts';
import { thaiClock, thaiToday } from './core/thai-time.ts';
import { defaultEnvFile, statusSetup } from './status-setup.ts';

/**
 * แจ้งผลผ่าน Discord (ใบ 08) — ประกอบ status (ใบ 07) + ข้อความ (core/discord.ts) + บันทึกว่าส่งอะไรไปแล้ว (`data/_notify/discord.json`)
 *
 * เรียกหลังจบ `export --daily` ทุกรอบ (ทั้งสอง Site) และจาก `exporter notify` · **ไม่โยน error และไม่เปลี่ยน exit code ของรอบ export**: ไม่มี URL = ข้าม ·
 * ส่งไม่ได้ (Discord ล่ม/rate limit หลังลองซ้ำแล้ว) = บันทึกว่าส่งไม่ได้แล้วจบ (เรื่องที่ยังไม่ได้ส่ง ส่งในครั้งถัดไปเอง) · URL ไม่ถูกพิมพ์หรือบันทึกที่ไหน
 *
 * จังหวะ: รอบรายวัน HotelTime ที่จบตั้งแต่ 18:00 คือรอบเก็บตกสุดท้ายของวัน → ประเมิน status เหมือนเป็น 18:30 (หลังรอบเก็บตก — ล้ม = ปัญหา ไม่ใช่ "รอ") และส่ง
 * **สรุปรายวัน** (วันละครั้ง) · สรุปที่ส่งไม่ได้ ส่งใหม่ในครั้งถัดไปของเย็นวันเดียวกัน (ทุก trigger) · `exporter notify --summary` สั่งส่งสรุปเองได้
 */

export type NotifyTrigger = 'hoteltime-daily' | 'foodstory-daily' | 'manual';
export type NotifyResult =
  | { readonly status: 'skipped'; readonly reason: string }
  | { readonly status: 'dry-run'; readonly messages: readonly DiscordMessage[] }
  | { readonly status: 'sent'; readonly messages: number }
  | { readonly status: 'failed'; readonly sent: number; readonly error: string };

const FINAL_RUN_HOUR = 18;
const FINAL_EVALUATION_MIN = 18 * 60 + 30;

/** รอบรายวัน HotelTime ที่จบหลัง 18:00 = รอบสุดท้ายของวัน → ประเมินเหมือนเป็น 18:30 (ไม่ถอยเวลา ถ้าเลย 18:30 แล้ว) */
function evaluationTime(now: Date, trigger: NotifyTrigger): Date {
  const c = thaiClock(now);
  if (trigger !== 'hoteltime-daily' || c.hour < FINAL_RUN_HOUR || c.hour * 60 + c.minute >= FINAL_EVALUATION_MIN) return now;
  return new Date(now.getTime() + (FINAL_EVALUATION_MIN - (c.hour * 60 + c.minute)) * 60_000 - c.second * 1000);
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
}): Promise<NotifyResult> {
  const now = opts.now ?? new Date();
  const dataDir = opts.dataDir ?? defaultDataDir();
  const envFile = opts.envFile ?? defaultEnvFile();
  let redact = (s: string) => s;
  try {
    const url = readWebhookUrl(envFile);
    if (url !== null) redact = webhookRedactor(url);
    if (url === null && !opts.dryRun) return { status: 'skipped', reason: 'ยังไม่ได้ตั้ง DISCORD_WEBHOOK_URL ใน exporter/.env — ข้ามการส่ง Discord' };
    const log = await readNotifyLog(dataDir);
    const clock = thaiClock(now);
    const today = formatISO(thaiToday(now));
    // สรุปที่ส่งไม่ได้เมื่อเย็นนี้ → ส่งใหม่ครั้งถัดไปของเย็นวันเดียวกัน ไม่ว่า trigger ไหน
    const summaryFailedToday = log.failures.some((f) => f.keys.includes(`summary@${today}`));
    const summary = opts.summary ?? (clock.hour >= FINAL_RUN_HOUR && (opts.trigger === 'hoteltime-daily' || summaryFailedToday));
    const report = buildStatus(await readStoreSnapshot(dataDir), evaluationTime(now, opts.trigger), statusSetup(envFile));
    const messages = discordMessages(report, { summary, alreadySent: new Set(Object.keys(log.sent)) });
    if (opts.dryRun) return { status: 'dry-run', messages };
    if (url === null || messages.length === 0) return { status: 'sent', messages: 0 };

    const sent: Record<string, string> = {};
    let failure: { at: string; keys: readonly string[]; error: string } | undefined;
    for (const m of messages) {
      try {
        await postDiscord(url, m.content);
      } catch (err) {
        // หยุดที่ข้อความแรกที่ส่งไม่ได้ (ลองซ้ำในตัวส่งแล้ว — ข้อความถัดไปก็คงไม่ผ่าน) · ที่เหลือส่งครั้งถัดไป
        failure = { at: now.toISOString(), keys: m.keys, error: err instanceof DiscordError ? err.message : 'ส่ง Discord ไม่ได้ (ไม่ทราบสาเหตุ)' };
        break;
      }
      for (const k of m.keys) sent[k] = now.toISOString();
    }
    await writeNotifyLog(dataDir, { sent, ...(failure ? { failure } : {}) }, now);
    const done = messages.filter((m) => m.keys.every((k) => k in sent)).length;
    return failure ? { status: 'failed', sent: done, error: failure.error } : { status: 'sent', messages: done };
  } catch (err) {
    // ห้ามทำให้รอบ export ล้ม · redact เผื่อไว้ (ตัวส่งเป็นจุดเดียวที่ถือ URL และ redact เองแล้ว)
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
