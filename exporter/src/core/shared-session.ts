import { setTimeout as delay } from 'node:timers/promises';
import { withRetry, type Attempted, type RetryPolicy } from './retry.ts';

/**
 * **session เดียวต่อรอบดึง** (ticket 12 ของ 4h-rounds) — เปิดเบราว์เซอร์และ login ครั้งเดียวแล้วดึงทุกงานของรอบใน session นั้น
 * แทน login ใหม่ต่อรายงาน (วัดแล้วเร็วขึ้น ~2.1 เท่า — ticket 06) · seam ของ test = {@link SessionProvider}: สลับเป็นของปลอมได้ ไม่ต้องใช้เบราว์เซอร์จริง
 */
export type SessionProvider<S> = {
  /** session ปัจจุบัน — เปิด + login เมื่อเรียกครั้งแรกเท่านั้น */
  get(): Promise<S>;
  /** ปิดตัวเก่าแล้วเปิด + login ใหม่ (ใช้เมื่อ session หลุด) */
  renew(): Promise<S>;
  close(): Promise<void>;
};

/**
 * `open` = เปิดเบราว์เซอร์ + login · `isFatal` = ความผิดพลาดที่ลองใหม่ไม่ช่วย และลองซ้ำอาจแย่ลง (รหัสผิด = บัญชีถูกล็อก): พอเกิดในการเปิดครั้งแรก provider จำไว้ และ
 * ทุกการเรียกถัดไปล้มด้วย error เดิมทันทีโดยไม่เปิด/login ซ้ำ — งานที่เหลือของรอบล้มเร็วและบันทึกเป็นล้มต่องาน (เก็บตกรอบถัดไป ADR-0009)
 */
export function createSharedSession<S>(opts: {
  readonly open: () => Promise<S>;
  readonly close: (session: S) => Promise<void>;
  readonly isFatal: (err: unknown) => boolean;
}): SessionProvider<S> {
  let current: Promise<S> | undefined;
  let fatal: { readonly error: unknown } | undefined;
  let everOpened = false;

  const open = (): Promise<S> => {
    if (fatal !== undefined) return Promise.reject(fatal.error);
    const p = opts.open().then(
      (s) => {
        everOpened = true;
        return s;
      },
      (error: unknown) => {
        current = undefined;
        // ล็อกเฉพาะตอนยังไม่เคยเปิดสำเร็จ (รหัสผิดเกิดตั้งแต่ครั้งแรก) — login ใหม่กลางรอบที่ล้มอาจเป็นหน้าช้า/เด้งหน้าอื่น ไม่ใช่รหัสผิด ไม่ควรทำให้ที่เหลือล้มหมด
        if (!everOpened && opts.isFatal(error)) fatal = { error };
        throw error;
      },
    );
    current = p;
    return p;
  };
  const dispose = async (): Promise<void> => {
    const old = current;
    current = undefined;
    if (old !== undefined) await old.then((s) => opts.close(s), () => undefined).catch(() => undefined);
  };

  return {
    get: () => current ?? open(),
    renew: async () => {
      await dispose();
      return open();
    },
    close: dispose,
  };
}

/**
 * รันงานหนึ่งใน session ที่ใช้ร่วมกัน: ความผิดพลาดชั่วคราว (`isRetryable`) ลองซ้ำตามนโยบายใน session เดิม · session หลุด (`isSessionLost`) → `renew()` **หนึ่งครั้ง**
 * แล้วลองงานนั้นซ้ำหนึ่งครั้ง — หลุดซ้ำ = ล้ม (ไม่วนไม่รู้จบ) · อย่างอื่นล้มทันที · งานหนึ่งล้มไม่กระทบงานถัดไป (ผู้เรียกวนต่อ)
 */
export function runInSharedSession<S, T>(
  provider: SessionProvider<S>,
  task: (session: S) => Promise<T>,
  opts: {
    readonly isSessionLost: (err: unknown) => boolean;
    readonly isRetryable: (err: unknown) => boolean;
    readonly policy: RetryPolicy;
    readonly sleep?: (ms: number) => Promise<void>;
    readonly onRetry?: (err: unknown, attempt: number, waitMs: number) => void;
  },
): Promise<Attempted<T>> {
  let renewed = false;
  let stale = false; // ล้มชั่วคราวครั้งก่อน — หน้าเดิมอาจค้าง (modal / postback ไม่จบ) ลองซ้ำบนเบราว์เซอร์ใหม่
  return withRetry(
    async () => {
      const session = stale ? await provider.renew() : await provider.get();
      stale = false;
      try {
        return await task(session);
      } catch (err) {
        if (opts.isSessionLost(err) && !renewed) {
          renewed = true;
          return await task(await provider.renew());
        }
        if (!opts.isSessionLost(err) && opts.isRetryable(err)) stale = true;
        throw err;
      }
    },
    { policy: opts.policy, isRetryable: (e) => !opts.isSessionLost(e) && opts.isRetryable(e), sleep: opts.sleep ?? ((ms) => delay(ms)), ...(opts.onRetry !== undefined ? { onRetry: opts.onRetry } : {}) },
  );
}

/** ปิดหน้าต่างอื่นทั้งหมดนอกจากหน้าหลัก — popup/ดาวน์โหลดค้างของงานก่อนหน้าต้องไม่รั่วไปงานถัดไปใน session เดียวกัน */
export async function closeStrayPages(getPages: () => readonly { close(): Promise<void> }[], keep: unknown): Promise<void> {
  // เบราว์เซอร์ตายแล้ว pages() อาจโยน error — กลืนไว้ ไม่ให้บังคลุม error เดิมของงานที่ตัวตรวจ "session หลุด" ต้องเห็น
  let pages: readonly { close(): Promise<void> }[];
  try {
    pages = getPages();
  } catch {
    return;
  }
  for (const p of pages) if (p !== keep) await p.close().catch(() => undefined);
}
