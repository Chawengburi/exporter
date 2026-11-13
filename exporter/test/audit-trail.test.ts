import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditWindow, auditTrail } from '../src/sites/hoteltime/reports/audit-trail.ts';

/** รายงาน audit-trail (ticket 02 ของ exporter-audit-trail) — นิยามของรายงาน: ช่วงที่ส่งเข้าหน้าเว็บ + สัญญาของ Report */

test('ช่วงที่ส่งเข้าหน้าเว็บของวัน D = D 00:00 ถึง 00:00 ของ D+1 (ช่อง To ไม่รวมนาทีที่ระบุ — ถึง 23:59 จะตกแถว 23:59:xx · recon ticket 01)', () => {
  assert.deepEqual(auditWindow(new Date(Date.UTC(2026, 10, 13))), {
    fromDate: '13/11/2026', fromHour: '00', fromMinute: '00', toDate: '14/11/2026', toHour: '00', toMinute: '00',
  });
  // ข้ามเดือน/ปี
  assert.equal(auditWindow(new Date(Date.UTC(2026, 11, 31))).toDate, '01/01/2027');
  assert.equal(auditWindow(new Date(Date.UTC(2026, 1, 28))).toDate, '01/03/2026');
});

test('🔴 ขอบเขตการแตะ: control ที่อนุญาตมีแค่ช่องวันที่/เวลาและปุ่ม Search — ไม่มี Reset filter (ADR-0001, specs/07)', () => {
  assert.ok(auditTrail.allowedControls.includes(auditTrail.searchButton));
  assert.ok(!auditTrail.allowedControls.some((c) => /Reset|Filtr/i.test(c)), auditTrail.allowedControls.join(','));
  assert.equal(auditTrail.searchButton, 'ctl00$pc$btnFind');
});
