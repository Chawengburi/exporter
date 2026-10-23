import type { WorkPlan } from '../../core/run-planner.ts';
import { loginFailureReason } from '../../core/run-record.ts';
import { ID as RESERVATION_ID } from './reservation-report.ts';

/**
 * ลำดับงานของรอบรายวัน FoodStory ใน **login เดียว** (กด captcha ครั้งเดียว — ADR-0006/0009, ใบ 06) จากแผนของตัววางแผน (core/run-planner.ts)
 *
 * ช่วงวันที่ของ FoodStory เป็นของ session ทั้งรอบ (สเปกต้นทาง §4.2) ไม่ใช่ของแต่ละรายงาน จึงต้อง: ตั้งช่วงทีละ **วันของข้อมูล** แล้วดึงทุก
 * รายงานตามวันของวันนั้น · **รายงาน snapshot**ไม่กรองตามวัน แต่ `salebymonthsum` เลือกปีจากช่วงของ session จึงตั้งเป็น**วันที่ถ่าย** (snapshot ปกติ = ต้นงวด
 * ถึงวันนี้ ตาม spec — ตั้งเป็นเมื่อวานแล้ววันที่ 1 ม.ค. ได้ปีที่แล้วทั้งปี ซ้ำกับ snapshot ปิดงวด: code review ใบ 06) หรือวันสุดท้ายของงวด (snapshot ปิดงวด) ก่อน · `reservation-report` คลิก sidebar ข้ามไป manage.foodstory.co แล้วไม่กลับมา owner อีก — ต้องอยู่ท้ายสุดเสมอ
 * ทุกวันต่อกัน (ตั้งช่วงด้วยปฏิทินของหน้านั้นเอง ไม่ใช่ช่วงของ session)
 */
export type FoodStoryStep =
  | { readonly kind: 'set-range'; readonly day: string }
  | { readonly kind: 'report'; readonly report: string; readonly day: string; readonly periodClose: boolean }
  | { readonly kind: 'reservation'; readonly day: string };
/** ขั้นที่ได้ผลเป็นรายงาน (ไม่ใช่การตั้งช่วง) */
export type ReportStep = Extract<FoodStoryStep, { kind: 'report' | 'reservation' }>;

/**
 * login ล้ม (exporter-foodstory-scheduled-daily ใบ 02) → ทุกขั้นที่ได้ผลเป็นรายงานในแผนของรอบนี้ล้มด้วยเหตุผลเดียวที่มีตัวบอก login ล้ม — ผู้เรียก
 * บันทึกผลตามทางเดิม ให้ status/Discord เห็นว่ารอบนี้รันแล้วแต่ login ไม่ผ่าน (เดิมไม่มีบันทึกเลย จึงดูเหมือนยังไม่มีใครรัน) · แผนมีเฉพาะรายงานที่ยังไม่
 * สำเร็จ จึงไม่มีผลที่เคยผ่านถูกทับ · รอบเก็บตกถัดไปลองใหม่เอง (ADR-0008)
 */
export function loginFailedSteps(steps: readonly FoodStoryStep[], reason: string): { readonly step: ReportStep; readonly error: string }[] {
  const error = loginFailureReason(reason);
  return steps.filter((s): s is ReportStep => s.kind !== 'set-range').map((step) => ({ step, error }));
}

export function foodstoryDailySteps(plan: WorkPlan): FoodStoryStep[] {
  const steps: FoodStoryStep[] = [];
  let range: string | null = null;
  const setRange = (day: string) => {
    if (range === day) return;
    steps.push({ kind: 'set-range', day });
    range = day;
  };

  for (const day of [...new Set(plan.perDay.map((i) => i.day))].sort()) {
    const due = plan.perDay.filter((i) => i.day === day && i.report !== RESERVATION_ID);
    if (due.length === 0) continue;
    setRange(day);
    for (const i of due) steps.push({ kind: 'report', report: i.report, day, periodClose: false });
  }
  for (const i of plan.pictures) {
    setRange(i.day);
    steps.push({ kind: 'report', report: i.report, day: i.day, periodClose: false });
  }
  for (const i of plan.periodCloses) {
    setRange(i.day);
    steps.push({ kind: 'report', report: i.report, day: i.day, periodClose: true });
  }
  for (const i of plan.perDay.filter((x) => x.report === RESERVATION_ID).sort((a, b) => a.day.localeCompare(b.day))) {
    steps.push({ kind: 'reservation', day: i.day });
  }
  return steps;
}
