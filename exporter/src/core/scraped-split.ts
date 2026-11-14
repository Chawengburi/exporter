import { ScrapeError, assertScrapedHeader, scrapedMinuteOfDay } from './scraped-table.ts';

/**
 * นโยบายแบ่งช่วงเวลาเมื่อหน้าเว็บชนเพดานแถว (ADR-0012 · ticket 04) — ฟังก์ชันล้วน รับ "ตัวดึงหนึ่งช่วง" เข้ามา ไม่แตะเบราว์เซอร์
 *
 * ช่วงเป็นครึ่งเปิด `[start, end)` หน่วยนาทีของวัน (0–1440) · ช่อง To ของหน้าเว็บไม่รวมนาทีที่ระบุ จึงต่อช่วงชิดกันได้โดยไม่ซ้ำไม่ตก (recon ticket 01)
 * ชนเพดาน (ได้แถว ≥ `rowCap` = หน้าตัดแถวเก่าสุดทิ้ง) → ผ่าที่ชั่วโมงเต็มกลาง ๆ แล้วดึงสองท่อนซ้ำ ลงไปถึง `MIN_WINDOW_MINUTES` · ชั่วโมงเดียวยังชน = ล้ม
 */
export const DAY_MINUTES = 1440;
export const MIN_WINDOW_MINUTES = 60;

/** ดึงหนึ่งช่วง คืนตารางเต็มตามหน้าเว็บ (แถวแรกคือหัว) */
export type WindowFetcher = (startMinute: number, endMinute: number) => Promise<readonly (readonly string[])[]>;

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}${m === DAY_MINUTES ? ' (วันถัดไป)' : ''}`;

export async function fetchSplitTable(opts: {
  readonly fetchWindow: WindowFetcher;
  readonly expectedHeader: readonly string[];
  readonly dateColumn: string;
  readonly rowCap: number;
}): Promise<readonly (readonly string[])[]> {
  const iDate = opts.expectedHeader.indexOf(opts.dateColumn);
  let firstHeader: readonly string[] | undefined;

  async function fetchRange(start: number, end: number): Promise<readonly (readonly string[])[]> {
    const [header, ...body] = await opts.fetchWindow(start, end);
    assertScrapedHeader(header, opts.expectedHeader);
    firstHeader ??= header;
    let outside = 0;
    for (const r of body) {
      const m = scrapedMinuteOfDay(r[iDate] ?? '');
      if (m === null || m < start || m >= end) outside++;
    }
    if (outside > 0) throw new ScrapeError(`ช่วง ${hhmm(start)}–${hhmm(end)} มี ${outside} แถวนอกช่วงที่ขอ — ฟิลเตอร์เวลาของหน้าเว็บไม่ทำงานตามที่สั่ง`);
    if (body.length < opts.rowCap) return body;
    if (end - start <= MIN_WINDOW_MINUTES) {
      throw new ScrapeError(`ช่วง ${hhmm(start)}–${hhmm(end)} ได้ ${body.length} แถว ถึงเพดาน ${opts.rowCap} ทั้งที่เป็นช่วงเล็กสุด (${MIN_WINDOW_MINUTES} นาที) — แบ่งต่อไม่ได้ ข้อมูลอาจถูกตัด`);
    }
    // ผ่าครึ่งแล้วปัดลงเป็นชั่วโมงเต็ม (อย่างน้อย 1 ชั่วโมง): 1440→720, 720→360, 180→60+120
    const mid = start + Math.max(MIN_WINDOW_MINUTES, Math.floor((end - start) / 120) * 60);
    const earlier = await fetchRange(start, mid);
    const later = await fetchRange(mid, end);
    return [...later, ...earlier]; // หน้าเว็บเรียงใหม่ไปเก่า → ท่อนหลังมาก่อน (ลำดับเวลาในแต่ละแถวถูกตรวจซ้ำที่ scrapedTableToRawFile)
  }

  const body = await fetchRange(0, DAY_MINUTES);
  return [firstHeader!, ...body];
}
