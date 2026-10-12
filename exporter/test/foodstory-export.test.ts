import assert from 'node:assert/strict';
import { test } from 'node:test';
import { utcDate } from '../src/core/order.ts';
import type { FoodStoryReportResult } from '../src/sites/foodstory/export.ts';
import {
  crossCheckSales,
  groupOf,
  periodLabel,
  planFoodStoryRun,
  previousMonthRange,
  spotCheckCoreReports,
} from '../src/sites/foodstory/export.ts';
import { REPORTS } from '../src/sites/foodstory/reports/index.ts';

// ── แผนของรอบรัน: รายงานไหนรัน + salebychannel + reservation-report (ใบสุดท้ายเสมอ) ──
// reservation-report ต้องรันหลังสุดเพราะเข้าได้ทางเดียวคือคลิก sidebar ข้ามไป manage.foodstory.co
// แล้วไม่กลับมา owner.foodstory.co อีก (ticket 11)

test('planFoodStoryRun("all") — 47 ใบ + salebychannel + reservation-report', () => {
  const plan = planFoodStoryRun('all');
  assert.ok(plan);
  assert.equal(plan.reports.length, REPORTS.length);
  assert.equal(plan.saleByChannel, true);
  assert.equal(plan.reservation, true);
  assert.equal(plan.total, REPORTS.length + 2);
});

test('planFoodStoryRun("reservation-report") — ไม่มีรายงาน DataTables ไม่มี salebychannel', () => {
  const plan = planFoodStoryRun('reservation-report');
  assert.deepEqual(plan, { reports: [], saleByChannel: false, reservation: true, total: 1 });
});

test('planFoodStoryRun รายงานเดียว / salebychannel', () => {
  const one = planFoodStoryRun('salebysumdate');
  assert.deepEqual(one?.reports.map((r) => r.id), ['salebysumdate']);
  assert.equal(one?.reservation, false);
  assert.deepEqual(planFoodStoryRun('salebychannel'), { reports: [], saleByChannel: true, reservation: false, total: 1 });
});

test('planFoodStoryRun id ที่ไม่รู้จัก → null', () => {
  assert.equal(planFoodStoryRun('nope'), null);
});

test('groupOf: reservation-report มีกลุ่มของตัวเอง', () => {
  assert.equal(groupOf('reservation-report'), 'reservation');
});

test('previousMonthRange: กลางปีปกติ', () => {
  const r = previousMonthRange(utcDate(2026, 9, 26));
  assert.deepEqual(r, { from: utcDate(2026, 8, 1), to: utcDate(2026, 8, 31) });
});

test('🔴 previousMonthRange: ข้ามปี (มกราคม → ธันวาคมปีก่อน) — จุดที่บั๊ก off-by-one ชอบเกิด', () => {
  const r = previousMonthRange(utcDate(2026, 1, 15));
  assert.deepEqual(r, { from: utcDate(2025, 12, 1), to: utcDate(2025, 12, 31) });
});

test('previousMonthRange: เดือนก่อนหน้ามี 28 วัน (กุมภาพันธ์)', () => {
  const r = previousMonthRange(utcDate(2026, 3, 1));
  assert.deepEqual(r, { from: utcDate(2026, 2, 1), to: utcDate(2026, 2, 28) });
});

test('periodLabel: pad เดือนหลักเดียวด้วย 0', () => {
  assert.equal(periodLabel({ from: utcDate(2026, 8, 1), to: utcDate(2026, 8, 31) }), '2026-08');
  assert.equal(periodLabel({ from: utcDate(2026, 1, 1), to: utcDate(2026, 1, 31) }), '2026-01');
});

test('groupOf: id ที่รู้จักคืนกลุ่มถูก', () => {
  assert.equal(groupOf('outputtax'), 'tax');
  assert.equal(groupOf('inv_movement'), 'inventory');
  assert.equal(groupOf('salebychannel'), 'sales');
});

test('groupOf: id ที่ไม่รู้จักโยน error ทันที ไม่เดาให้', () => {
  assert.throws(() => groupOf('ไม่มีจริง'), /ไม่รู้จักกลุ่มของรายงาน/);
});

const sheet = (header: readonly string[], rows: readonly (readonly string[])[]) => ({ title: '', header, rows });

test('crossCheckSales: ยอดตรงกันเป๊ะ (ส่วนต่าง 0) ถือว่าผ่าน', () => {
  const salebysumdate = sheet(
    ['วันที่', 'รวมสุทธิ (ยอดก่อนภาษี + ภาษี +  ยอดปัดเศษ) -  ยอดขายสินค้าไม่มีภาษี'],
    [['01/08/2026', '1000'], ['02/08/2026', '2000']],
  );
  const salebymonthsum = sheet(
    ['เดือน', 'รวมสุทธิ (ยอดก่อนภาษี + ภาษี +  ยอดปัดเศษ) -  ยอดขายสินค้าไม่มีภาษี'],
    [['สิงหาคม', '3000']],
  );
  const result = crossCheckSales({ from: utcDate(2026, 8, 1), to: utcDate(2026, 8, 31) }, salebysumdate, salebymonthsum);
  assert.equal(result?.ok, true);
});

test('🔴 crossCheckSales: หาแถวของเดือนเป้าหมายเท่านั้น ไม่รวมทั้งไฟล์ (salebymonthsum มีทุกเดือนของปี)', () => {
  const salebysumdate = sheet(
    ['วันที่', 'รวมสุทธิ (ยอดก่อนภาษี + ภาษี +  ยอดปัดเศษ) -  ยอดขายสินค้าไม่มีภาษี'],
    [['01/08/2026', '3000']],
  );
  const salebymonthsum = sheet(
    ['เดือน', 'รวมสุทธิ (ยอดก่อนภาษี + ภาษี +  ยอดปัดเศษ) -  ยอดขายสินค้าไม่มีภาษี'],
    [['กรกฎาคม', '14410'], ['สิงหาคม', '3000'], ['กันยายน', '321230']],
  );
  const result = crossCheckSales({ from: utcDate(2026, 8, 1), to: utcDate(2026, 8, 31) }, salebysumdate, salebymonthsum);
  assert.equal(result?.ok, true);
});

test('crossCheckSales: ส่วนต่างเกินเพดานที่ยอมรับ (฿5,750) ต้อง flag ว่าน่าสงสัย', () => {
  const salebysumdate = sheet(
    ['วันที่', 'รวมสุทธิ (ยอดก่อนภาษี + ภาษี +  ยอดปัดเศษ) -  ยอดขายสินค้าไม่มีภาษี'],
    [['01/08/2026', '1000000']],
  );
  const salebymonthsum = sheet(
    ['เดือน', 'รวมสุทธิ (ยอดก่อนภาษี + ภาษี +  ยอดปัดเศษ) -  ยอดขายสินค้าไม่มีภาษี'],
    [['สิงหาคม', '1010000']],
  );
  const result = crossCheckSales({ from: utcDate(2026, 8, 1), to: utcDate(2026, 8, 31) }, salebysumdate, salebymonthsum);
  assert.equal(result?.ok, false);
});

test('crossCheckSales: ไฟล์ใดไฟล์หนึ่งยังไม่มี (ยังไม่ได้ดึง) คืน null ไม่ throw', () => {
  assert.equal(crossCheckSales({ from: utcDate(2026, 8, 1), to: utcDate(2026, 8, 31) }, null, null), null);
});

const result = (id: string, status: FoodStoryReportResult['status'], rowsExported: number | null = null): FoodStoryReportResult => ({
  id, label: id, group: 'sales', path: `/th/${id}`, status,
  rowCountReported: rowsExported, rowsExported, files: [], note: null,
});

test('spotCheckCoreReports: salebysumdate มีข้อมูล แต่ core report อื่นว่างเปล่า — flag', () => {
  const warnings = spotCheckCoreReports([
    result('salebysumdate', 'ok', 31),
    result('salebyproduct', 'empty', 0),
    result('costbyproduct', 'ok', 217),
    result('inv_movement', 'truncated', 5000),
  ]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /salebyproduct/);
});

test('spotCheckCoreReports: salebysumdate เองก็ว่างเปล่า — ไม่มีฐานให้เทียบ ไม่ flag อะไร', () => {
  const warnings = spotCheckCoreReports([
    result('salebysumdate', 'empty', 0),
    result('salebyproduct', 'empty', 0),
  ]);
  assert.deepEqual(warnings, []);
});

test('spotCheckCoreReports: ทุกใบมีข้อมูลปกติ — ไม่มี warning', () => {
  const warnings = spotCheckCoreReports([
    result('salebysumdate', 'ok', 31),
    result('salebyproduct', 'ok', 358),
    result('costbyproduct', 'ok', 217),
    result('inv_movement', 'truncated', 5000),
  ]);
  assert.deepEqual(warnings, []);
});

// ticket 03: ผลรายใบของ FoodStory → บันทึกผลรอบชุดเดียวกับ HotelTime (`_run.json`/`_summary.txt`/exit code)
test('ผลรายใบ FoodStory → ReportOutcome: ok/empty/split = ผ่าน · failed/truncated = ล้ม (ถูกตัดคือข้อมูลไม่ครบ)', async () => {
  const { toReportOutcomes } = await import('../src/sites/foodstory/export.ts');
  const base = { label: 'x', group: 'sales', path: '/th/x', rowCountReported: null, note: null };
  const results: FoodStoryReportResult[] = [
    { ...base, id: 'a', status: 'ok', rowsExported: 10, files: ['/o/2026-08__sales__a.xlsx'], attempts: 2 },
    { ...base, id: 'b', status: 'empty', rowsExported: 0, files: [] },
    { ...base, id: 'c', status: 'split', rowsExported: 3000, files: ['/o/c_part1.xlsx', '/o/c_part2.xlsx'] },
    { ...base, id: 'd', status: 'truncated', rowsExported: 2000, files: ['/o/d.xlsx'], note: 'ชนเพดาน' },
    { ...base, id: 'e', status: 'failed', rowsExported: null, files: [], note: 'Timeout' },
  ];
  const range = { from: utcDate(2026, 8, 1), to: utcDate(2026, 8, 31) };
  const got = toReportOutcomes(results, range, (f) => `sha-of-${f.split('/').pop()}`);
  assert.deepEqual(got.map((o) => [o.report, o.status, o.attempts]), [
    ['a', 'ok', 2], ['b', 'ok', 1], ['c', 'ok', 1], ['d', 'failed', 1], ['e', 'failed', 1],
  ]);
  const a = got[0]!;
  assert.ok(a.status === 'ok');
  assert.deepEqual(a.files, [{ file: '2026-08__sales__a.xlsx', rows: 10, sha256: 'sha-of-2026-08__sales__a.xlsx' }]);
  assert.deepEqual(a.range, { from: '2026-08-01', to: '2026-08-31' });
  const d = got[3]!;
  assert.ok(d.status === 'failed');
  assert.match(d.error, /truncated[\s\S]*ชนเพดาน/);
});

// ticket 03 (/code-review): ไฟล์เดิมของรายงานในโฟลเดอร์รอบถูกแทนก็ต่อเมื่อรอบใหม่ผ่าน — ดาวน์โหลดลงที่พักก่อน แล้วค่อยย้ายเข้าคลัง
// (เดิมลบก่อนเริ่มดึง: ดึงซ้ำวันเดียวกันแล้วล้ม = ไฟล์ที่เคยได้หายไปจากคลัง ขัด ADR-0005)
async function publishFixture() {
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const root = await mkdtemp(path.join(tmpdir(), 'fs-publish-'));
  const outDir = path.join(root, 'monthly', '2026-09__2026-10-08');
  const staging = path.join(root, '_downloads', 'salebybilldetail');
  await mkdir(outDir, { recursive: true });
  await mkdir(staging, { recursive: true });
  for (const f of ['2026-09__sales__salebybilldetail_part1.xlsx', '2026-09__sales__salebybilldetail_part2.xlsx',
    '2026-09__sales__salebybill.xlsx']) await writeFile(path.join(outDir, f), 'old');
  return { outDir, staging, path };
}
const detailBase = { id: 'salebybilldetail', label: 'x', group: 'sales', path: '/th/x', rowCountReported: 10, note: null };

test('publishReport: ผ่าน → ไฟล์เก่าของรายงานนี้ถูกแทน ไฟล์ใหม่ย้ายเข้าโฟลเดอร์รอบ รายงานอื่นไม่ถูกแตะ', async () => {
  const { publishReport } = await import('../src/sites/foodstory/export.ts');
  const { readdir, writeFile } = await import('node:fs/promises');
  const { outDir, staging, path } = await publishFixture();
  const staged = path.join(staging, '2026-09__sales__salebybilldetail.xlsx');
  await writeFile(staged, 'new');
  const got = await publishReport({ ...detailBase, status: 'ok', rowsExported: 10, files: [staged] }, outDir, '2026-09');
  assert.deepEqual(got.files, [path.join(outDir, '2026-09__sales__salebybilldetail.xlsx')]);
  assert.deepEqual((await readdir(outDir)).sort(), ['2026-09__sales__salebybill.xlsx', '2026-09__sales__salebybilldetail.xlsx']);
  assert.deepEqual(await readdir(staging), []);
});

test('publishReport: ล้ม → ไฟล์เดิมในคลังอยู่ครบ', async () => {
  const { publishReport } = await import('../src/sites/foodstory/export.ts');
  const { readdir } = await import('node:fs/promises');
  const { outDir } = await publishFixture();
  const r = { ...detailBase, status: 'failed' as const, rowsExported: null, files: [], note: 'Timeout' };
  assert.deepEqual(await publishReport(r, outDir, '2026-09'), r);
  assert.equal((await readdir(outDir)).length, 3);
});

test('mergeManifest: ดึงซ้ำบางใบลงโฟลเดอร์เดิม — ใบที่ไม่ได้รันใหม่คงที่มาเดิม · เช็คไขว้เก่าใช้ต่อเฉพาะเมื่อไม่ได้รัน 2 ใบที่ใช้เทียบ', async () => {
  const { mergeManifest } = await import('../src/sites/foodstory/export.ts');
  const r = (id: string, rows: number): FoodStoryReportResult =>
    ({ id, label: id, group: 'sales', path: `/th/${id}`, status: 'ok', rowCountReported: rows, rowsExported: rows, files: [], note: null });
  const head = { period: '2026-09', branch: 'b', requestedRange: { from: '2026-09-01', to: '2026-09-30' }, spotCheckWarnings: [] };
  const prev = { ...head, runStartedUtc: 'T1', reports: [r('salebysumdate', 30), r('salebymonthsum', 3), r('order', 5)],
    crossCheck: { ok: true, note: 'เดิม' } };
  const merged = mergeManifest(prev, { ...head, runStartedUtc: 'T2', reports: [r('order', 7)], crossCheck: null });
  assert.deepEqual(merged.reports.map((x) => [x.id, x.rowsExported]), [['salebysumdate', 30], ['salebymonthsum', 3], ['order', 7]]);
  assert.equal(merged.runStartedUtc, 'T2');
  assert.deepEqual(merged.crossCheck, { ok: true, note: 'เดิม' });
  // รัน salebysumdate ใหม่ใบเดียว → เช็คไขว้เดิมเทียบกับไฟล์เก่า ใช้ไม่ได้แล้ว
  assert.equal(mergeManifest(prev, { ...head, runStartedUtc: 'T2', reports: [r('salebysumdate', 31)], crossCheck: null }).crossCheck, null);
  // ไม่มี manifest เดิม = ของรอบนี้
  assert.equal(mergeManifest(null, prev), prev);
});

// /code-review รอบสอง: truncated (ข้อมูลไม่ครบ) ห้ามแทนไฟล์เดิมที่ผ่านแล้ว — แต่ถ้ายังไม่มีไฟล์ของใบนี้ เก็บไฟล์ที่ได้ไว้ (ดีกว่าไม่มี)
test('publishReport: truncated มีไฟล์เดิมของใบนี้อยู่ → ไม่แทน และนับเป็นล้ม · ไม่มีไฟล์เดิม → เก็บไฟล์ที่ได้', async () => {
  const { publishReport } = await import('../src/sites/foodstory/export.ts');
  const { readdir, readFile, writeFile } = await import('node:fs/promises');
  const { outDir, staging, path } = await publishFixture();
  const staged = path.join(staging, '2026-09__sales__salebybilldetail.xlsx');
  await writeFile(staged, 'capped');
  const truncated = { ...detailBase, status: 'truncated' as const, rowsExported: 5000, files: [staged], note: 'ชนเพดาน' };
  const got = await publishReport(truncated, outDir, '2026-09');
  assert.equal(got.status, 'failed');
  assert.deepEqual(got.files, []);
  assert.match(got.note ?? '', /ชนเพดาน[\s\S]*ไม่แทนไฟล์เดิม/);
  assert.equal(await readFile(path.join(outDir, '2026-09__sales__salebybilldetail_part1.xlsx'), 'utf8'), 'old');

  const fresh = path.join(path.dirname(outDir), '2026-10');
  const kept = await publishReport({ ...truncated, id: 'order', files: [staged] }, fresh, '2026-09');
  assert.equal(kept.status, 'truncated');
  assert.deepEqual(await readdir(fresh), ['2026-09__sales__salebybilldetail.xlsx']);
});

test('mergeManifest: ใบที่รันซ้ำแล้วล้มแต่เดิมผ่าน → คงรายการเดิม (ไฟล์เดิมยังอยู่) และเช็คไขว้เดิมใช้ต่อ', async () => {
  const { mergeManifest } = await import('../src/sites/foodstory/export.ts');
  const r = (id: string, status: 'ok' | 'failed'): FoodStoryReportResult =>
    ({ id, label: id, group: 'sales', path: `/th/${id}`, status, rowCountReported: null, rowsExported: status === 'ok' ? 3 : null,
      files: status === 'ok' ? [`/o/${id}.xlsx`] : [], note: status === 'ok' ? null : 'Timeout' });
  const head = { period: '2026-09', branch: 'b', requestedRange: { from: '2026-09-01', to: '2026-09-30' }, spotCheckWarnings: [] };
  const prev = { ...head, runStartedUtc: 'T1', reports: [r('salebysumdate', 'ok'), r('salebymonthsum', 'ok'), r('order', 'ok'), r('pay', 'failed')],
    crossCheck: { ok: true, note: 'เดิม' } };
  const merged = mergeManifest(prev, { ...head, runStartedUtc: 'T2',
    reports: [r('salebysumdate', 'failed'), r('salebymonthsum', 'ok'), r('order', 'failed'), r('pay', 'failed')], crossCheck: null });
  assert.deepEqual(merged.reports.map((x) => [x.id, x.status]),
    [['salebysumdate', 'ok'], ['order', 'ok'], ['salebymonthsum', 'ok'], ['pay', 'failed']]);
  // salebymonthsum ถูกแทนด้วยไฟล์ใหม่ → เช็คไขว้เดิมเทียบกับไฟล์เก่า ใช้ไม่ได้
  assert.equal(merged.crossCheck, null);
  const onlyFailed = mergeManifest(prev, { ...head, runStartedUtc: 'T2', reports: [r('salebysumdate', 'failed')], crossCheck: null });
  assert.deepEqual(onlyFailed.crossCheck, { ok: true, note: 'เดิม' });
});

// ticket 10 (ADR-0006): รอบรายวันของ FoodStory = เมื่อวาน (เวลาไทย) วันเดียว — ปิดยอดแล้ว ไม่ได้ยอดครึ่งวัน · ไฟล์ขึ้นต้นด้วยวันนั้น
test('ช่วงข้อมูลของรอบ: --daily = เมื่อวานวันเดียว (ข้ามเดือน/ข้ามปี) · ไม่ระบุ = เดือนที่แล้ว · --from/--to = ตามที่ขอ', async () => {
  const { foodstoryWindow } = await import('../src/sites/foodstory/export.ts');
  const day = (y: number, m: number, d: number) => utcDate(y, m, d);
  assert.deepEqual(foodstoryWindow({ daily: true }, day(2026, 10, 12)),
    { kind: 'daily', range: { from: day(2026, 10, 11), to: day(2026, 10, 11) }, label: '2026-10-11' });
  assert.deepEqual(foodstoryWindow({ daily: true }, day(2026, 11, 1)).range, { from: day(2026, 10, 31), to: day(2026, 10, 31) });
  assert.deepEqual(foodstoryWindow({ daily: true }, day(2027, 1, 1)),
    { kind: 'daily', range: { from: day(2026, 12, 31), to: day(2026, 12, 31) }, label: '2026-12-31' });
  assert.deepEqual(foodstoryWindow({ daily: false }, day(2026, 10, 12)),
    { kind: 'monthly', range: { from: day(2026, 9, 1), to: day(2026, 9, 30) }, label: '2026-09' });
  assert.deepEqual(foodstoryWindow({ daily: false, from: day(2026, 8, 1), to: day(2026, 8, 31) }, day(2026, 10, 12)),
    { kind: 'monthly', range: { from: day(2026, 8, 1), to: day(2026, 8, 31) }, label: '2026-08' });
});

// /code-review ticket 10: รันซ้ำวันเดียวกันแล้วได้ 0 แถว ทั้งที่รอบก่อนในโฟลเดอร์นี้มีไฟล์ — ข้อมูลของเมื่อวานไม่ควรหายไปเฉย ๆ
// ถือว่าน่าสงสัย ไม่แทน (เหมือน truncated) · ไม่มีไฟล์เดิม = ว่างจริง ผ่านตามปกติ
test('publishReport: empty มีไฟล์เดิมของใบนี้อยู่ → ไม่ลบไฟล์เดิม และนับเป็นล้ม · ไม่มีไฟล์เดิม → empty ตามปกติ', async () => {
  const { publishReport } = await import('../src/sites/foodstory/export.ts');
  const { readFile } = await import('node:fs/promises');
  const { outDir, path } = await publishFixture();
  const empty = { ...detailBase, status: 'empty' as const, rowsExported: 0, files: [] };
  const got = await publishReport(empty, outDir, '2026-09');
  assert.equal(got.status, 'failed');
  assert.match(got.note ?? '', /0 แถว[\s\S]*ไม่แทนไฟล์เดิม/);
  assert.equal(await readFile(path.join(outDir, '2026-09__sales__salebybilldetail_part1.xlsx'), 'utf8'), 'old');
  assert.equal((await publishReport({ ...empty, id: 'order' }, outDir, '2026-09')).status, 'empty');
});
