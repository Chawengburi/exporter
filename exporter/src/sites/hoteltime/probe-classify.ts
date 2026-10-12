import { parseCellDate } from '../../core/xlsx.ts';
import { findDateRangeGroups, findSearchButton } from './sweep-classify.ts';

/**
 * การตรวจเบื้องต้น (probe — CONTEXT.md) ส่วนที่ตัดสินล้วน ๆ ไม่แตะเบราว์เซอร์ · ticket 09 ของ
 * `.scratch/exporter-daily-expansion-and-data-store/`
 *
 * ขั้นอยู่ระหว่างการกวาด (เปิดหน้าดูเฉย ๆ) กับ recon เชิงลึก (AI อ่านหน้า): สคริปต์สั่งค้นจริงแบบอ่านอย่างเดียว
 * แล้วตอบว่า export ได้จริงไหม มีข้อมูลไหม และควรทำรอบรายวันแบบไหน — ผลคือหลักฐานให้ตัดสินว่าหน้าไหน
 * คุ้มจ่าย recon เชิงลึก แทนการเลือกจากชื่อหน้าอย่างเดียว
 */

/**
 * หน้าสั่งงาน/หน้าตั้งค่าที่ห้ามตรวจเด็ดขาด แม้จะมีปุ่มค้นหา (ตัดสินใจ 2026-10-07 ตอน grill-with-docs) —
 * กดค้นหาเฉย ๆ ก็ไม่ควรเสี่ยงกับหน้าที่ออกแบบมาเพื่อเปลี่ยนข้อมูล
 */
export const EXCLUDED_FROM_PROBE: ReadonlySet<string> = new Set([
  'SubjectMerge.aspx',
  'payment/PaymentBookList.aspx',
  'AccountingQueuesOverview.aspx',
  'settings/ImportantDay.aspx',
  'res3/HotelPopupNotes.aspx',
]);

/** ปิดถาวรแล้ว — เจ้าของระบบยืนยันว่าไม่เคยใช้ cashier module (pilot ticket 05, 2026-09-22) */
const CLOSED_PERMANENTLY = /^payment\/PaymentList\.aspx/i;

export type ProbeTarget = {
  readonly href: string;
  readonly title: string;
  readonly searchButton: string | null;
  readonly dateRangeGroups: readonly string[];
  readonly singleDates: readonly string[];
};

type SweepEntry = {
  readonly href: string;
  readonly title?: string;
  readonly inputNames?: readonly string[];
  readonly buttonNames?: readonly string[];
  readonly searchButton?: string | null;
};

/**
 * control ที่การตรวจเบื้องต้นจะแตะได้ของหน้าหนึ่ง — ใช้ทั้งกับข้อมูลจากการกวาดและกับ input ที่อ่านสด ๆ
 * ตอนเปิดหน้า · ช่องวันเดี่ยวคือชื่อที่ส่วนท้ายขึ้นต้นด้วย `cal` ซึ่งไม่ใช่ครึ่งหนึ่งของคู่ calFrom/calTo
 */
export function controlsOf(inputNames: readonly string[]): Omit<ProbeTarget, 'href' | 'title'> {
  const dateRangeGroups = findDateRangeGroups(inputNames);
  const inGroup = (n: string) => dateRangeGroups.some((g) => n === `${g}$calFrom` || n === `${g}$calTo`);
  const singleDates = inputNames.filter((n) => {
    const last = n.slice(n.lastIndexOf('$') + 1);
    return /^cal/i.test(last) && !inGroup(n) && !inputNames.some((o) => o.startsWith(`${n}$`));
  });
  return { searchButton: findSearchButton(inputNames), dateRangeGroups, singleDates };
}

/**
 * หน้าที่ต้องตรวจจากผลการกวาด: หน้าที่มีปุ่ม export + หน้าที่ไม่มีแต่มีปุ่มค้นหา (export อาจโผล่หลังกด)
 * ตัดรายงานที่ทำแล้ว หน้าที่ปิดถาวร และ 5 หน้าที่ห้ามตรวจ
 */
export function selectProbeTargets(
  sweep: { readonly hasExport: readonly SweepEntry[]; readonly noExport: readonly SweepEntry[] },
  doneHrefs: readonly string[],
): ProbeTarget[] {
  const done = new Set(doneHrefs.map((h) => h.toLowerCase()));
  const skip = (href: string) =>
    EXCLUDED_FROM_PROBE.has(href) || done.has(href.toLowerCase()) || CLOSED_PERMANENTLY.test(href);

  const fromExport = sweep.hasExport
    .filter((p) => !skip(p.href))
    .map((p) => ({ href: p.href, title: p.title ?? '', ...controlsOf(p.inputNames ?? []) }));
  const fromSearch = sweep.noExport
    .filter((p) => !!p.searchButton && !skip(p.href))
    .map((p) => ({
      href: p.href,
      title: p.title ?? '',
      ...controlsOf(p.buttonNames ?? []),
      searchButton: p.searchButton ?? null,
    }));
  return [...fromExport, ...fromSearch];
}

/** parseCellDate โยนเมื่ออ่านไม่ได้ (รายงานที่ทำแล้วถือว่าผิด) — การตรวจเบื้องต้นแค่อยากรู้ว่าใช่วันที่หรือเปล่า */
function tryParseDate(v: string): Date | null {
  try {
    return parseCellDate(v);
  } catch {
    return null;
  }
}

/** คอลัมน์ที่ค่าส่วนใหญ่ (≥ 80% ของช่องที่ไม่ว่าง) อ่านเป็นวันที่ได้ — ไว้ตรวจว่าผลปูเต็มช่วงที่ขอไหม */
export function findDateColumns(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  return header.filter((_, i) => {
    const values = rows.map((r) => (r[i] ?? '').trim()).filter((v) => v !== '');
    if (values.length === 0) return false;
    // parseCellDate รับตัวเลขเป็น Excel serial ด้วย — ยอดเงิน 100 จะกลายเป็นปี 1900 จึงนับเฉพาะปีที่เป็นไปได้
    const dates = values.filter((v) => {
      const year = tryParseDate(v)?.getUTCFullYear();
      return year !== undefined && year >= 2000 && year <= 2100;
    }).length;
    return dates / values.length >= 0.8;
  });
}

export type ProbeObservation = {
  readonly href: string;
  /** ลิงก์ export หลังกดค้นหา */
  readonly exportLinkCount: number;
  /** ลิงก์ export ตอนเพิ่งเปิดหน้า ก่อนตั้งวันที่และกดค้นหา */
  readonly exportLinkCountBeforeSearch: number;
  /** หน้าขึ้น "* mandatory item" หลังกดค้นหา */
  readonly formRejected: boolean;
  readonly downloaded: boolean;
  /** จำนวนแถวข้อมูล (ไม่นับหัวตาราง) · null = ไม่ได้ไฟล์ */
  readonly rows: number | null;
  readonly dateColumns: readonly string[];
  readonly dateRangeGroups: readonly string[];
  readonly singleDates: readonly string[];
  /** error ระหว่างตรวจที่ไม่ใช่ "ไม่มีไฟล์มา" (redact แล้ว) */
  readonly error: string | null;
};

export type ProbeVerdict =
  | { readonly verdict: 'pass'; readonly dailyMode: 'ledger' | 'snapshot' | 'whole'; readonly reason: string }
  | { readonly verdict: 'no-export' | 'no-data' | 'undetermined'; readonly reason: string };

/**
 * ตัดสินผลตรวจหนึ่งหน้า — ผ่าน (+ แบบรอบรายวันที่เหมาะ) · ไม่มีข้อมูล · ไม่มีปุ่ม export · บอกแบบรอบรายวันไม่ได้
 *
 * ledger ต้องมีทั้งตัวกรองช่วงวันที่และคอลัมน์วันที่ในผล — ไม่มีคอลัมน์วันที่ก็ตรวจไม่ได้ว่าแต่ละรอบปูเต็มช่วงที่ขอ
 * (ด่านเดียวกับ verifyChunk ของรายงานที่ทำแล้ว) จึงส่งให้คนตัดสินแทนการเดา
 */
export function judgeProbe(o: ProbeObservation): ProbeVerdict {
  if (o.formRejected) return { verdict: 'undetermined', reason: 'ฟอร์มถูกปฏิเสธ — มีฟิลด์บังคับที่ต้องรู้ความหมายก่อน' };
  if (o.error !== null) return { verdict: 'undetermined', reason: `ตรวจไม่จบ: ${o.error.split('\n')[0]}` };
  if (o.exportLinkCount === 0 && o.exportLinkCountBeforeSearch > 0) {
    // หลายหน้าซ่อนลิงก์ export เมื่อผลค้นว่าง — หน้านั้น export ได้ แค่ 90 วันล่าสุดไม่มีข้อมูล
    return { verdict: 'no-data', reason: 'ปุ่ม export มีตอนเปิดหน้าแต่หายหลังกดค้นหา — น่าจะไม่มีข้อมูลในช่วงที่ค้น' };
  }
  if (o.exportLinkCount === 0) return { verdict: 'no-export', reason: 'ไม่มีปุ่ม export ทั้งก่อนและหลังกดค้นหา' };
  if (!o.downloaded || o.rows === null || o.rows === 0) {
    return { verdict: 'no-data', reason: 'กด export แล้วไม่มีไฟล์มา หรือไฟล์ไม่มีแถวข้อมูล (ในช่วงที่ค้น)' };
  }
  if (o.dateRangeGroups.length > 0) {
    if (o.dateColumns.length === 0) {
      return { verdict: 'undetermined', reason: 'กรองช่วงวันที่ได้ แต่ผลไม่มีคอลัมน์วันที่ให้ตรวจว่าปูเต็ม' };
    }
    return { verdict: 'pass', dailyMode: 'ledger', reason: `กรองช่วงวันที่ได้ และผลมีคอลัมน์วันที่ ${o.dateColumns.join(', ')}` };
  }
  if (o.singleDates.length > 0) return { verdict: 'pass', dailyMode: 'snapshot', reason: 'เลือกได้ทีละวัน — ภาพของวันนั้น' };
  return { verdict: 'pass', dailyMode: 'whole', reason: 'ไม่มีตัวกรองวันที่ — เก็บเป็นภาพรวมของวันนั้นทุกวัน' };
}
