import type { Page } from 'playwright';

export class InFlightError extends Error {
  override readonly name = 'InFlightError';
}

const DEFAULT_POLL_MS = 250;

type RequestLike = { url(): string; resourceType(): string };
type RequestEvent = 'request' | 'requestfinished' | 'requestfailed';
type FrameLike = { parentFrame(): unknown };
type RequestEmitter = {
  on(event: RequestEvent, listener: (request: RequestLike) => void): unknown;
  on(event: 'framenavigated', listener: (frame: FrameLike) => void): unknown;
  off(event: RequestEvent, listener: (request: RequestLike) => void): unknown;
  off(event: 'framenavigated', listener: (frame: FrameLike) => void): unknown;
};

export type InFlightTracker = {
  /** path (ไม่มี query — กัน token หลุดลง error) ของ request ที่ยังไม่จบ */
  pendingPaths(): string[];
  stop(): void;
};

/**
 * นับ xhr/fetch ที่ไป host ของเว็บและยังไม่จบ
 *
 * 🔴 ทำไมต้องมี (diagnose 2026-09-28): หลัง login แอปพาไป `/th/summary` ซึ่งยิง
 * `POST /summary/get-*` 8 ตัวพร้อมกัน แต่ละตัวพกช่วงวันที่ปัจจุบันของ session ไปด้วย ถ้าเรา
 * navigate ออกก่อนมันจบ ฝั่ง server (Laravel) ยังรันต่อ แล้วตอนจบก็เขียน `laravel_session`
 * ทั้งก้อนกลับ (ไม่มี session lock — last writer wins) ทับ `POST /api/setDate` ที่เราตั้งไปแล้ว
 * → ช่วงวันที่ย้อนกลับเป็นค่าเดิม (หลัง login ใหม่คือ "วันนี้") ถ้าย้อนก่อน `setDateRangeByTyping`
 * ตรวจ header จะล้มแบบที่เห็น แต่ถ้าย้อนทีหลังจะดึงผิดช่วงเงียบ ๆ (verify.ts เทียบแค่จำนวนแถว)
 * พิสูจน์ใน harness: ไป summary แล้วออกเร็ว → ตั้งช่วงใหม่ → ~16 วิต่อมา server กลับเป็นค่าเดิม 2/2
 * และตัดทิ้งแล้วว่าไม่ใช่เพราะ endpoint เอาวันที่ใน body ไปเขียน session (ถ่วง request ไว้ฝั่ง client
 * ให้ถึง server หลัง setDate — ช่วงวันที่ไม่ย้อน) ต้องซ้อนกันจริงฝั่ง server เท่านั้น จึงแก้ด้วยการรอให้
 * request ที่ค้างจบก่อนยิง setDate (ทั้งหลัง login และก่อนกด "ตกลง") — request ที่ถูก abort ฝั่ง
 * client ตอน navigate ออก (tracker มองไม่เห็นแล้ว แต่ server ยังรันต่อ) ยังเป็นช่องโหว่ที่เหลือ
 * ซึ่ง `assertSessionDateRange` ใน interactions.ts ดักไว้ก่อน export ทุกไฟล์
 *
 * 🔴 main frame navigate → ล้างรายการทิ้ง (พังจริง 2026-09-28, batch ส.ค.): request ของหน้าเดิมที่ถูก
 * ทิ้งตอน navigate ไม่ได้ event requestfinished/requestfailed จาก Playwright เสมอไป เลยค้างเป็นผี
 * ตลอดไป (`/th/salebymonthsum/getdata` ทำให้ `salebybilldetail` รอ 90 วิแล้วล้ม) — ตรงกับหลักเดิม
 * ข้างบนอยู่แล้วว่า request ที่หลุดไปพร้อมหน้าเก่า tracker ไม่รับผิดชอบ ให้ `assertSessionDateRange` ดักแทน
 */
export function trackInFlightRequests(page: RequestEmitter, host: string): InFlightTracker {
  const pending = new Set<RequestLike>();
  const matches = (r: RequestLike) =>
    (r.resourceType() === 'xhr' || r.resourceType() === 'fetch') && new URL(r.url()).host === host;
  const onStart = (r: RequestLike) => {
    if (matches(r)) pending.add(r);
  };
  const onEnd = (r: RequestLike) => {
    pending.delete(r);
  };
  const onNavigated = (f: FrameLike) => {
    if (f.parentFrame() === null) pending.clear();
  };
  page.on('request', onStart);
  page.on('requestfinished', onEnd);
  page.on('requestfailed', onEnd);
  page.on('framenavigated', onNavigated);
  return {
    pendingPaths: () => [...pending].map((r) => new URL(r.url()).pathname),
    stop() {
      page.off('request', onStart);
      page.off('requestfinished', onEnd);
      page.off('requestfailed', onEnd);
      page.off('framenavigated', onNavigated);
    },
  };
}

/** รอจน tracker ไม่เหลือ request ค้าง — เกินเวลาโยน InFlightError แทนการไปต่อทั้งที่ยังเสี่ยงโดนเขียนทับ */
export async function waitForInFlightToSettle(
  tracker: InFlightTracker,
  timeoutMs: number,
  pollMs: number = DEFAULT_POLL_MS,
): Promise<void> {
  const deadlineAt = Date.now() + timeoutMs;
  while (tracker.pendingPaths().length > 0) {
    if (Date.now() >= deadlineAt) {
      throw new InFlightError(
        `request ของหน้าเว็บยังไม่จบภายใน ${timeoutMs / 1000} วินาที: ` +
          `${tracker.pendingPaths().join(', ')} — ไปต่อไม่ได้ เพราะเมื่อมันจบจะเขียน session ทับช่วงวันที่ที่ตั้ง`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

const trackers = new WeakMap<object, InFlightTracker>();

/** ติด tracker ให้ page ตลอดอายุ session — เรียกครั้งเดียวตอนสร้าง page (session.ts::openSession) */
export function installInFlightTracker(page: RequestEmitter | Page, host: string): void {
  trackers.set(page, trackInFlightRequests(page as RequestEmitter, host));
}

/**
 * รอให้ xhr/fetch ที่ page นี้ยิงไปยัง host ของเว็บจบหมด — ไม่มี tracker = โยน ไม่ข้ามเงียบ ๆ
 * (page ที่ไม่ได้มาจาก openSession ใช้ฟังก์ชันที่พึ่งสิ่งนี้ไม่ได้ ต้องรู้ตัว)
 */
export async function settlePageRequests(
  page: RequestEmitter | Page,
  timeoutMs: number,
  pollMs: number = DEFAULT_POLL_MS,
): Promise<void> {
  const tracker = trackers.get(page);
  if (!tracker) {
    throw new InFlightError('page นี้ไม่มี in-flight tracker — ต้องสร้างผ่าน openSession() (หรือเรียก installInFlightTracker เอง)');
  }
  await waitForInFlightToSettle(tracker, timeoutMs, pollMs);
}
