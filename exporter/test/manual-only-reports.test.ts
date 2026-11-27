import assert from 'node:assert/strict';
import test from 'node:test';
import { MANUAL_ONLY_REPORTS, REPORTS, findReport, isManualOnlyReport, plannedOutsideRounds, reportIds } from '../src/sites/hoteltime/reports/index.ts';
import { documentTypeFor } from '../src/core/uploader.ts';

test('manual-only report is reachable by id but absent from every planner list', () => {
  const id = 'reservations-cancelled-by-stay';
  assert.equal(isManualOnlyReport(id), true);
  assert.ok(findReport(id), 'findReport must resolve it so --report <id> works');
  assert.ok(reportIds().includes(id), 'listed in --report help');
  assert.ok(!REPORTS.some((r) => r.id === id), 'not in REPORTS (all / daily / baseline / status read REPORTS)');
  assert.ok(!plannedOutsideRounds().some((r) => r.id === id), 'not planned by daily/status');
});

test('manual-only reports keep the safety contract of a per-day, non-daily, date-check-skipping report', () => {
  for (const r of MANUAL_ONLY_REPORTS) {
    assert.equal(r.dailyOnly, false);
    assert.equal(r.family, 'per-day');
    assert.ok(r.allowedControls.includes(r.searchButton));
    assert.equal(r.chunk.kind, 'monthly');
  }
});

test('by-stay cancelled report shares the uploader document type of the cancelled report', () => {
  assert.equal(documentTypeFor('hoteltime', 'reservations-cancelled-by-stay'), documentTypeFor('hoteltime', 'reservations-cancelled'));
});
