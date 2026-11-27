import assert from 'node:assert/strict';
import test from 'node:test';
import { formRejectionReason } from '../src/sites/hoteltime/webforms.ts';

test('formRejectionReason flags "mandatory item" and "invalid date" (case-insensitive), ignores normal pages', () => {
  assert.match(formRejectionReason('Period: * mandatory item') ?? '', /mandatory item/);
  assert.match(formRejectionReason('Cancelled from - to: 01/01/2025 * Invalid date') ?? '', /invalid date/);
  assert.equal(formRejectionReason('Total reservations: 19'), null);
  assert.equal(formRejectionReason(''), null);
});
