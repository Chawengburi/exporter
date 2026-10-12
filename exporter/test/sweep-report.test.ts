import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSweepReport, type PageSummary } from '../src/sites/hoteltime/sweep-classify.ts';

const S = (overrides: Partial<PageSummary>): PageSummary => ({
  href: 'x.aspx',
  reachable: true,
  hasExportLink: false,
  hasMandatoryField: false,
  dateRangeGroups: [],
  inputNames: [],
  inputCount: 0,
  buttonNames: [],
  searchButton: null,
  ...overrides,
});

test('จัดกลุ่มเป็น unreachable / noExport / hasExport ตามหมวด ไม่ใช่รายการเดียวเรียงยาว', () => {
  const report = buildSweepReport([
    S({ href: 'a.aspx', reachable: false, errorMessage: 'timeout' }),
    S({ href: 'b.aspx', hasExportLink: false, title: 'B' }),
    S({ href: 'c.aspx', hasExportLink: true, title: 'C', dateRangeGroups: ['ctl00$pc$cal'] }),
  ]);

  assert.equal(report.total, 3);
  assert.deepEqual(report.unreachable, [{ href: 'a.aspx', error: 'timeout' }]);
  assert.equal(report.noExport.length, 1);
  assert.equal(report.noExport[0]!.href, 'b.aspx');
  assert.equal(report.hasExport.length, 1);
  assert.equal(report.hasExport[0]!.href, 'c.aspx');
  assert.deepEqual(report.hasExport[0]!.dateRangeGroups, ['ctl00$pc$cal']);
});

test('หน้าที่ไม่มี export ไม่มี inputNames เต็มรายการติดไปด้วย — มีแค่ inputCount', () => {
  const report = buildSweepReport([
    S({ href: 'b.aspx', hasExportLink: false, inputNames: ['ctl00$pc$foo'], inputCount: 1 }),
  ]);
  assert.equal((report.noExport[0] as { inputNames?: unknown }).inputNames, undefined);
  assert.equal(report.noExport[0]!.inputCount, 1);
});

test('noExport ติดชื่อปุ่ม + ปุ่มค้นหา และนับหน้าที่มีปุ่มค้นหาไว้บนสุด', () => {
  const report = buildSweepReport([
    S({ href: 'a.aspx', buttonNames: ['ctl00$pc$btnFind'], searchButton: 'ctl00$pc$btnFind' }),
    S({ href: 'b.aspx', buttonNames: ['ctl00$pc$btnSave'], searchButton: null }),
    S({ href: 'c.aspx', hasExportLink: true, buttonNames: ['ctl00$pc$btnFind'], searchButton: 'ctl00$pc$btnFind' }),
  ]);
  assert.deepEqual(report.noExport[0]!.buttonNames, ['ctl00$pc$btnFind']);
  assert.equal(report.noExport[0]!.searchButton, 'ctl00$pc$btnFind');
  assert.equal(report.noExport[1]!.searchButton, null);
  assert.equal(report.noExportWithSearchButton, 1);
});
