import { setTimeout as delay } from 'node:timers/promises';

/**
 * นโยบายลองใหม่ — ใบหนึ่งล้มเพราะเน็ตกระตุกหรือเว็บช้าชั่วคราว ไม่ควรกลายเป็นข้อมูลที่หายไปทั้งวัน
 * (เคยเกิด 2026-09-26: login timeout ตอนเที่ยง ทั้งรอบว่าง)
 *
 * **ลองใหม่เฉพาะความผิดพลาดชั่วคราว** — ชนเพดานแถว, verify ไม่ผ่าน, รหัสผิด, captcha ฯลฯ ลองซ้ำก็ได้ผลเดิม
 * และบางอย่างลองซ้ำแล้วแย่ลง (รหัสผิดหลายครั้ง = บัญชีถูกล็อก) จึงคืนความล้มเหลวทันที · คืนผลเป็น union
 * ไม่โยน error เพื่อให้ผู้เรียกได้จำนวนครั้งที่ลองไปบันทึกใน `_run.json` ทั้งกรณีผ่านและล้ม
 */

export type RetryPolicy = {
  /** จำนวนครั้งที่ลองใหม่หลังครั้งแรก — 2 = รวมสูงสุด 3 ครั้ง */
  readonly maxRetries: number;
  /** ระยะรอก่อนลองใหม่ครั้งแรก แล้วเพิ่มเป็นสองเท่าทุกครั้ง */
  readonly baseDelayMs: number;
};

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxRetries: 2, baseDelayMs: 30_000 };

export type Attempted<T> =
  | { readonly ok: true; readonly value: T; readonly attempts: number }
  | { readonly ok: false; readonly error: unknown; readonly attempts: number };

export type RetryOptions = {
  readonly policy: RetryPolicy;
  readonly isRetryable: (err: unknown) => boolean;
  /** ใส่แทนได้ใน test — ค่าเริ่มต้นรอจริง */
  readonly sleep?: (ms: number) => Promise<void>;
  /** เรียกก่อนรอแต่ละครั้ง — ให้ผู้เรียกพิมพ์ความคืบหน้าเอง */
  readonly onRetry?: (err: unknown, attempt: number, waitMs: number) => void;
};

/** รันงานซ้ำตามนโยบาย · งานต้องเริ่มจากศูนย์ได้ทุกครั้ง (เปิด session ใหม่ ล็อกอินใหม่) */
export async function withRetry<T>(task: () => Promise<T>, opts: RetryOptions): Promise<Attempted<T>> {
  const sleep = opts.sleep ?? ((ms: number) => delay(ms));
  for (let attempt = 1; ; attempt++) {
    try {
      return { ok: true, value: await task(), attempts: attempt };
    } catch (err) {
      if (attempt > opts.policy.maxRetries || !opts.isRetryable(err)) return { ok: false, error: err, attempts: attempt };
      const waitMs = opts.policy.baseDelayMs * 2 ** (attempt - 1);
      opts.onRetry?.(err, attempt, waitMs);
      await sleep(waitMs);
    }
  }
}

/**
 * ความผิดพลาดชั่วคราวของเบราว์เซอร์ที่ลองใหม่แล้วมีโอกาสผ่าน — ใช้ได้ทุก Site เพราะมาจาก Playwright
 *
 * แยกด้วย `name`/ข้อความ ไม่ใช่ `instanceof` เพราะ core ไม่ผูกกับ playwright · ทุกอย่างที่ไม่เข้าข่าย
 * (รวม LoginError ของ "ยังอยู่หน้า login หลังกด Submit" ที่อาจแปลว่ารหัสผิด) ถือว่าไม่ลองใหม่
 */
export function isTransientBrowserError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'TimeoutError') return true;
  return /net::ERR_|Navigation failed|Target page, context or browser has been closed|ECONNRESET|socket hang up/.test(
    err.message,
  );
}

/**
 * สำหรับงานที่ลองใหม่บน page เดิมที่ล็อกอินค้างไว้ (FoodStory — ล็อกอินใหม่ต้องมีคนกด captcha, ADR-0006)
 * · เบราว์เซอร์/page ถูกปิดแล้วลองซ้ำบน page เดิมไม่มีทางผ่าน ทุกใบที่เหลือจะรอเปล่า ๆ ใบละ 90 วินาที
 */
export function isTransientOnSamePage(err: unknown): boolean {
  if (err instanceof Error && /Target page, context or browser has been closed/.test(err.message)) return false;
  return isTransientBrowserError(err);
}

/**
 * `withRetry` ด้วยนโยบายตั้งต้นของ exporter + ข้อความความคืบหน้าแบบเดียวกันทุก Site
 *
 * `describe` ต้องคืนข้อความที่ redact แล้ว (ผู้เรียกถือ Redactor) · `log` ไม่ใส่ = เงียบ (โหมด `--json`)
 */
export function withBrowserRetry<T>(
  task: () => Promise<T>,
  opts: {
    readonly label: string;
    readonly describe: (err: unknown) => string;
    readonly log?: (line: string) => void;
    readonly isRetryable?: (err: unknown) => boolean;
    readonly policy?: RetryPolicy;
  },
): Promise<Attempted<T>> {
  return withRetry(task, {
    policy: opts.policy ?? DEFAULT_RETRY_POLICY,
    isRetryable: opts.isRetryable ?? isTransientBrowserError,
    onRetry: (err, n, waitMs) =>
      opts.log?.(`↻ ${opts.label} ครั้งที่ ${n} ล้มชั่วคราว — รอ ${waitMs / 1000} วินาทีแล้วลองใหม่: ${opts.describe(err).split('\n')[0]}`),
  });
}
