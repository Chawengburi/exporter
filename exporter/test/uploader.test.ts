import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  asOfStateKey,
  buildEmptyPayload,
  buildIngestPayload,
  classifyEmptyBatchResponse,
  classifyIngestResponse,
  documentTypeFor,
  finalizeAfterRetries,
  finalizeEmptyAfterRetries,
  isAsOfRegression,
  isEmptyReportOutcome,
  selectPendingFiles,
  SOURCE_SYSTEM,
} from '../src/core/uploader.ts';
import type { RawFileEntry } from '../src/core/raw-manifest.ts';
import type { RecordedOutcome } from '../src/core/run-record.ts';

const entry = (overrides: Partial<RawFileEntry> = {}): RawFileEntry => ({
  file: '20261015T131425+0700__reservation-stats-term.xlsx',
  site: 'hoteltime',
  report: 'reservation-stats-term',
  label: 'Reporting — reservation statistics for a stay period',
  family: 'picture',
  runKind: 'daily',
  range: { from: '2026-11-01', to: '2026-11-30' },
  actualRange: null,
  takenAt: '2026-10-15T13:14:25+07:00',
  rows: 1,
  sheets: ['export'],
  bytes: 4485,
  sha256: '37bdb80c1766618239b3dfb2145c6d8de84716ba082c6f62ddf3fac3cda8556f',
  source: 'https://th07.hoteltime.com/pms/ReservationStats.aspx?type=term',
  sourceName: 'export_forecast_by_parameters.xlsx',
  filterColumn: 'Name',
  filterNote: 'สถิติรวม เก็บเป็นภาพของวันที่ดึง',
  ...overrides,
});

test('documentTypeFor: สูตร hoteltime_ + ชื่อรายงาน (เปลี่ยน - เป็น _)', () => {
  assert.equal(documentTypeFor('hoteltime', 'reservation-stats-term'), 'hoteltime_reservation_stats_term');
  assert.equal(documentTypeFor('hoteltime', 'housekeeping-all-in-one'), 'hoteltime_housekeeping_all_in_one');
  assert.equal(documentTypeFor('hoteltime', 'arrivals'), 'hoteltime_arrivals');
});

test('documentTypeFor: 3 ข้อยกเว้นที่ชื่อต่างจากสูตร (manual §6, ยืนยันกับ catalog จริง 2026-10-15)', () => {
  assert.equal(documentTypeFor('hoteltime', 'reservations-search'), 'hoteltime_reservation_search');
  assert.equal(documentTypeFor('hoteltime', 'reservations-ratecode'), 'hoteltime_reservation_ratecode');
  assert.equal(documentTypeFor('hoteltime', 'reservations-cancelled'), 'hoteltime_reservation_cancelled');
});

test('documentTypeFor: FoodStory จับคู่ตามตาราง (ยังไม่ยืนยันจากทีม uploader, ticket 08)', () => {
  assert.equal(documentTypeFor('foodstory', 'salebysumdate'), 'foodstory_sales_by_day');
  assert.equal(documentTypeFor('foodstory', 'crm'), 'foodstory_customer_spend_by_phone');
});

test('documentTypeFor: FoodStory purchase/stock ปลดบล็อกแล้ว (เทียบคอลัมน์จริงกับทีม uploader 2026-10-19)', () => {
  assert.equal(documentTypeFor('foodstory', 'purchase-detail'), 'foodstory_purchase_request_lines');
  assert.equal(documentTypeFor('foodstory', 'purchase_stock'), 'foodstory_purchase_orders');
});

test('documentTypeFor: FoodStory รายงานที่ไม่อยู่ในตาราง — คืน undefined ไม่เดา (ไม่ throw)', () => {
  assert.equal(documentTypeFor('foodstory', 'no-such-report'), undefined);
});

test('SOURCE_SYSTEM: hoteltime ตรง ๆ, FoodStory คือ foodstory (เปลี่ยนจาก wongnai_pos 2026-10-19)', () => {
  assert.equal(SOURCE_SYSTEM.hoteltime, 'hoteltime');
  assert.equal(SOURCE_SYSTEM.foodstory, 'foodstory');
});

test('buildIngestPayload: map field ตรงจาก RawFileEntry + as_of ที่ส่งเข้ามา', () => {
  const payload = buildIngestPayload(entry(), '2026-10-15T06:14:25Z', 'hoteltime_reservation_stats_term');
  assert.deepEqual(payload, {
    source_system: 'hoteltime',
    document_type: 'hoteltime_reservation_stats_term',
    report: 'reservation-stats-term',
    range_from: '2026-11-01',
    range_to: '2026-11-30',
    as_of: '2026-10-15T06:14:25Z',
    rows: 1,
    report_label: 'Reporting — reservation statistics for a stay period',
    filter_column: 'Name',
    filter_note: 'สถิติรวม เก็บเป็นภาพของวันที่ดึง',
  });
});

test('buildIngestPayload: ไม่มี rows (FoodStory ที่ผ่าหลายไฟล์) ไม่ส่ง field rows เลย', () => {
  const payload = buildIngestPayload(entry({ rows: undefined }), '2026-10-15T06:14:25Z', 'x');
  assert.equal('rows' in payload, false);
});

test('selectPendingFiles: ข้ามไฟล์ที่มี uploaded แล้ว เอาแต่ไฟล์ที่ยังไม่มี', () => {
  const a = entry({ file: 'a.xlsx' });
  const b = entry({ file: 'b.xlsx', uploaded: { at: '2026-10-15T00:00:00Z', fileId: 'abc' } });
  assert.deepEqual(selectPendingFiles([a, b]), [a]);
});

// ── classifyIngestResponse (ticket 02: retryable/non-retryable แยกกัน) ──

test('classifyIngestResponse: ok:true ไม่ duplicate → sent', () => {
  const body = { failed: 0, succeeded: 1, results: [{ index: 0, name: 'a.xlsx', ok: true, file_id: 'f1', status: 'embedding' }] };
  assert.deepEqual(classifyIngestResponse(200, body), { kind: 'sent', fileId: 'f1' });
});

test('classifyIngestResponse: ok:true + duplicate:true → duplicate กับ file_id เดิม', () => {
  const body = { failed: 0, succeeded: 1, results: [{ index: 0, ok: true, file_id: 'f1', status: 'indexed', duplicate: true }] };
  assert.deepEqual(classifyIngestResponse(200, body), { kind: 'duplicate', fileId: 'f1' });
});

test('classifyIngestResponse: ok:true + retried:true (ไม่มี duplicate) → ถือเป็น duplicate ด้วย (ticket 02 checklist ระบุ "รวม retried:true")', () => {
  const body = { results: [{ index: 0, ok: true, file_id: 'f1', retried: true }] };
  assert.deepEqual(classifyIngestResponse(200, body), { kind: 'duplicate', fileId: 'f1' });
});

test('classifyIngestResponse: ok:true + rows_mismatch → rows-mismatch ไม่ใช่ sent เฉย ๆ (ไฟล์เข้าระบบแล้วจริง)', () => {
  const body = { results: [{ index: 0, ok: true, file_id: 'f1', rows_mismatch: { manifest: 10, converted: 9 } }] };
  assert.deepEqual(classifyIngestResponse(200, body), { kind: 'rows-mismatch', fileId: 'f1' });
});

test('classifyIngestResponse: 400 → rejected (ไม่ retry) พร้อมข้อความจาก body.message', () => {
  const body = { data: {}, message: 'Manifest[0]: unknown document_type "x".', status: 400 };
  assert.deepEqual(classifyIngestResponse(400, body), { kind: 'rejected', reason: 'Manifest[0]: unknown document_type "x".' });
});

test('classifyIngestResponse: ok:true แต่ไม่มี file_id (คำตอบผิดรูปแบบ) → rejected ไม่ใช่ sent/duplicate ว่างเปล่า', () => {
  const body = { failed: 0, succeeded: 1, results: [{ index: 0, ok: true, status: 'embedding' }] };
  assert.equal(classifyIngestResponse(200, body).kind, 'rejected');
});

test('classifyIngestResponse: stage:"convert" → rejected (ไม่ retry — ผลจะเหมือนเดิม)', () => {
  const body = { failed: 1, succeeded: 0, results: [{ index: 0, ok: false, stage: 'convert', error: 'แปลงไฟล์ไม่ได้' }] };
  assert.deepEqual(classifyIngestResponse(200, body), { kind: 'rejected', reason: 'แปลงไฟล์ไม่ได้' });
});

test('classifyIngestResponse: stage:"llm"/"save"/"read" → retryable', () => {
  for (const stage of ['llm', 'save', 'read']) {
    const body = { results: [{ index: 0, ok: false, stage, error: `ล้มที่ ${stage}` }] };
    assert.deepEqual(classifyIngestResponse(200, body), { kind: 'retryable', message: `ล้มที่ ${stage}` });
  }
});

test('classifyIngestResponse: 5xx → retryable', () => {
  assert.deepEqual(classifyIngestResponse(503, { message: 'service unavailable' }), { kind: 'retryable', message: 'service unavailable' });
});

test('classifyIngestResponse: 429 → retryable พร้อม retryAfterMs จาก header (วินาที → ms)', () => {
  assert.deepEqual(classifyIngestResponse(429, { message: 'rate limited' }, '120'), {
    kind: 'retryable',
    message: 'rate limited',
    retryAfterMs: 120_000,
  });
});

test('classifyIngestResponse: 429 ไม่มี/อ่านไม่ออก Retry-After → retryable ไม่มี retryAfterMs (ผู้เรียก fallback เอง)', () => {
  const r = classifyIngestResponse(429, {}, null);
  assert.equal(r.kind, 'retryable');
  assert.equal((r as { retryAfterMs?: number }).retryAfterMs, undefined);
});

test('classifyIngestResponse: 413/อื่น ๆ ที่ไม่รู้จัก → rejected (ปลอดภัยไว้ก่อน ไม่เดาว่า retry ได้)', () => {
  assert.equal(classifyIngestResponse(413, {}).kind, 'rejected');
});

test('classifyIngestResponse: body ผิดรูปแบบ (ไม่มี results) → rejected แทนการ throw', () => {
  assert.equal(classifyIngestResponse(200, { succeeded: 1 }).kind, 'rejected');
});

// ── finalizeAfterRetries (ticket 02: ไฟล์ที่ลองครบ 3 ครั้งแล้วยังไม่ผ่าน → stuck) ──

test('finalizeAfterRetries: retryable ที่ลองครบแล้ว → stuck พร้อมจำนวนครั้งและข้อความล่าสุด', () => {
  assert.deepEqual(finalizeAfterRetries({ kind: 'retryable', message: 'timeout' }, 3), { kind: 'stuck', attempts: 3, lastMessage: 'timeout' });
});

test('finalizeAfterRetries: ผลที่ไม่ใช่ retryable (sent/duplicate/rejected/rows-mismatch) ผ่านตรง ไม่แปลงเป็น stuck', () => {
  assert.deepEqual(finalizeAfterRetries({ kind: 'sent', fileId: 'f1' }, 1), { kind: 'sent', fileId: 'f1' });
  assert.deepEqual(finalizeAfterRetries({ kind: 'rejected', reason: 'x' }, 1), { kind: 'rejected', reason: 'x' });
});

// ── as_of regression guard (ticket 03) ──

test('asOfStateKey: ประกอบจาก report + range — สอง RawFileEntry ของรายงาน/ช่วงเดียวกันได้ key เดียวกัน', () => {
  assert.equal(asOfStateKey(entry()), 'reservation-stats-term@2026-11-01@2026-11-30');
  assert.equal(asOfStateKey(entry({ range: { from: '2026-10-01', to: '2026-10-01' } })), 'reservation-stats-term@2026-10-01@2026-10-01');
});

test('isAsOfRegression: ไม่มีค่าเดิมเลย → ไม่ถือเป็นย้อนหลัง (ยังไม่เคยส่ง)', () => {
  assert.equal(isAsOfRegression('2026-10-15T06:00:00Z', undefined), false);
});

test('isAsOfRegression: as_of ใหม่เก่ากว่าค่าที่เคยส่งสำเร็จ → ย้อนหลัง', () => {
  assert.equal(isAsOfRegression('2026-10-14T06:00:00Z', '2026-10-15T06:00:00Z'), true);
});

test('isAsOfRegression: as_of เท่ากับค่าเดิมเป๊ะ (ส่งซ้ำ/retry) → ไม่ถือเป็นย้อนหลัง', () => {
  assert.equal(isAsOfRegression('2026-10-15T06:00:00Z', '2026-10-15T06:00:00Z'), false);
});

test('isAsOfRegression: as_of ใหม่กว่าค่าเดิม → ไม่ย้อนหลัง', () => {
  assert.equal(isAsOfRegression('2026-10-16T06:00:00Z', '2026-10-15T06:00:00Z'), false);
});

// ── empty-report tracking (ticket 04) ──

const okOutcome = (overrides: Partial<RecordedOutcome & { status: 'ok' }> = {}): RecordedOutcome =>
  ({
    report: 'arrivals',
    status: 'ok',
    rows: 3,
    range: { from: '2026-10-15', to: '2026-10-15' },
    actualRange: { from: '2026-10-15', to: '2026-10-15' },
    files: [{ file: 'arrivals.xlsx', rows: 3, sha256: 'aa'.repeat(32) }],
    attempts: 1,
    finishedAt: '2026-10-15T06:00:00.000Z',
    ...overrides,
  }) as RecordedOutcome;

test('isEmptyReportOutcome: ok + 0 แถว + ไม่มีไฟล์ → ว่างจริง', () => {
  assert.equal(isEmptyReportOutcome(okOutcome({ rows: 0, files: [] })), true);
});

test('isEmptyReportOutcome: ok + มีแถว/มีไฟล์ → ไม่ว่าง', () => {
  assert.equal(isEmptyReportOutcome(okOutcome()), false);
});

test('isEmptyReportOutcome: status ล้ม → ไม่ใช่ "ว่าง" (เป็นแค่ยังไม่รู้)', () => {
  assert.equal(isEmptyReportOutcome({ report: 'x', status: 'failed', error: 'timeout', attempts: 1, finishedAt: '2026-10-15T06:00:00.000Z' } as RecordedOutcome), false);
});

// ── empty array contract (ticket 11) ──

test('asOfStateKey: ใช้กับ item ที่ไม่มี RawFileEntry เต็ม (แค่ report/range) ได้เหมือนกัน — key format เดียวกับไฟล์', () => {
  assert.equal(asOfStateKey({ report: 'arrivals', range: { from: '2026-10-15', to: '2026-10-15' } }), 'arrivals@2026-10-15@2026-10-15');
});

test('buildEmptyPayload: map field ตาม contract ครบ 6 ตัว', () => {
  const payload = buildEmptyPayload('hoteltime', 'departures', { from: '2026-10-12', to: '2026-10-12' }, '2026-10-12T05:11:31Z', 'hoteltime_departures');
  assert.deepEqual(payload, {
    source_system: 'hoteltime',
    document_type: 'hoteltime_departures',
    report: 'departures',
    range_from: '2026-10-12',
    range_to: '2026-10-12',
    as_of: '2026-10-12T05:11:31Z',
  });
});

test('buildEmptyPayload: FoodStory ใช้ source_system foodstory เหมือน buildIngestPayload', () => {
  assert.equal(buildEmptyPayload('foodstory', 'x', { from: '2026-10-12', to: '2026-10-12' }, 'a', 'foodstory_x').source_system, 'foodstory');
});

// request ที่มี `empty` รายการเดียว — เรียก classifyEmptyBatchResponse ด้วย count=1 แล้วเอารายการแรก (ไม่มี
// ฟังก์ชัน single-item แยกต่างหากในซอร์ส — ไม่มี production caller ที่ต้องใช้ ตัดออกตาม code review ของ ticket 11)
const classifyOneEmpty = (httpStatus: number, body: unknown, retryAfterHeader?: string | null) => classifyEmptyBatchResponse(httpStatus, body, 1, retryAfterHeader)[0];

test('classifyEmptyBatchResponse (count=1): ok:true, superseded ไม่ว่าง → announced พร้อมรายการที่ถูกซ่อน', () => {
  const body = { empty_results: [{ index: 0, report: 'departures', ok: true, superseded: ['old456'] }] };
  assert.deepEqual(classifyOneEmpty(200, body), { kind: 'announced', superseded: ['old456'] });
});

test('classifyEmptyBatchResponse (count=1): ok:true, superseded ว่าง → announced เหมือนกัน (ไม่มีไฟล์เก่าให้ซ่อน ไม่ใช่ error)', () => {
  const body = { empty_results: [{ index: 0, ok: true, superseded: [] }] };
  assert.deepEqual(classifyOneEmpty(200, body), { kind: 'announced', superseded: [] });
});

test('classifyEmptyBatchResponse (count=1): ok:false, stage:"save" → retryable ตาม manual', () => {
  const body = { empty_results: [{ index: 0, ok: false, stage: 'save', error: 'บันทึกไม่ได้' }] };
  assert.deepEqual(classifyOneEmpty(200, body), { kind: 'retryable', message: 'บันทึกไม่ได้' });
});

test('classifyEmptyBatchResponse (count=1): ok:false, stage อื่น/ไม่มี stage → rejected (ปลอดภัยไว้ก่อน ไม่เดาว่า retry ได้)', () => {
  assert.equal(classifyOneEmpty(200, { empty_results: [{ index: 0, ok: false, stage: 'convert', error: 'x' }] })?.kind, 'rejected');
  assert.equal(classifyOneEmpty(200, { empty_results: [{ index: 0, ok: false }] })?.kind, 'rejected');
});

test('classifyEmptyBatchResponse (count=1): 400 → rejected พร้อมข้อความจาก body.message (เหมือนไฟล์)', () => {
  const body = { message: 'At least one file is required in field "files".', status: 400 };
  assert.deepEqual(classifyOneEmpty(400, body), { kind: 'rejected', reason: 'At least one file is required in field "files".' });
});

test('classifyEmptyBatchResponse (count=1): 429 → retryable พร้อม retryAfterMs จาก header', () => {
  assert.deepEqual(classifyOneEmpty(429, { message: 'rate limited' }, '60'), { kind: 'retryable', message: 'rate limited', retryAfterMs: 60_000 });
});

test('classifyEmptyBatchResponse (count=1): 5xx → retryable', () => {
  assert.deepEqual(classifyOneEmpty(503, { message: 'service unavailable' }), { kind: 'retryable', message: 'service unavailable' });
});

test('classifyEmptyBatchResponse (count=1): body ผิดรูปแบบ (ไม่มี empty_results) → rejected แทนการ throw', () => {
  assert.equal(classifyOneEmpty(200, { succeeded: 0 })?.kind, 'rejected');
});

test('finalizeEmptyAfterRetries: retryable ที่ลองครบแล้ว → stuck', () => {
  assert.deepEqual(finalizeEmptyAfterRetries({ kind: 'retryable', message: 'timeout' }, 3), { kind: 'stuck', attempts: 3, lastMessage: 'timeout' });
});

test('finalizeEmptyAfterRetries: announced/rejected ผ่านตรง ไม่แปลงเป็น stuck', () => {
  assert.deepEqual(finalizeEmptyAfterRetries({ kind: 'announced', superseded: [] }, 1), { kind: 'announced', superseded: [] });
  assert.deepEqual(finalizeEmptyAfterRetries({ kind: 'rejected', reason: 'x' }, 1), { kind: 'rejected', reason: 'x' });
});

test('classifyEmptyBatchResponse: 200 — จับคู่ empty_results[i] กับแต่ละรายการตามลำดับ index', () => {
  const body = {
    empty_results: [
      { index: 0, report: 'departures', ok: true, superseded: ['old1'] },
      { index: 1, report: 'arrivals', ok: false, stage: 'save', error: 'บันทึกไม่ได้' },
    ],
  };
  assert.deepEqual(classifyEmptyBatchResponse(200, body, 2), [
    { kind: 'announced', superseded: ['old1'] },
    { kind: 'retryable', message: 'บันทึกไม่ได้' },
  ]);
});

test('classifyEmptyBatchResponse: 400/429/5xx กระทบทุกรายการใน batch เท่ากัน (ยังไม่มีใครถูกบันทึกเลย)', () => {
  assert.deepEqual(classifyEmptyBatchResponse(400, { message: 'bad' }, 3), [
    { kind: 'rejected', reason: 'bad' },
    { kind: 'rejected', reason: 'bad' },
    { kind: 'rejected', reason: 'bad' },
  ]);
  assert.deepEqual(classifyEmptyBatchResponse(503, { message: 'down' }, 2), [
    { kind: 'retryable', message: 'down' },
    { kind: 'retryable', message: 'down' },
  ]);
});
