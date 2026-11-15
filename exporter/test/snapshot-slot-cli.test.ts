import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

/**
 * ADR-0013: `export --snapshot-slot` through the real CLI — only the paths that need no browser, no credentials and no wall-clock luck
 * (the window/done/retry rules are covered by the pure planner tests in run-planner.test.ts)
 */
const run = (args: string[], env: Record<string, string> = {}) => {
  const r = spawnSync(process.execPath, ['src/index.ts', 'export', ...args], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, HOTELTIME_USERNAME: '', HOTELTIME_PASSWORD: '', DISCORD_WEBHOOK_URL_EXPORT: '', ...env },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

test('slot switched off (HOTELTIME_SNAPSHOT_SLOTS empty): exits 0 at once, without credentials or a browser', () => {
  const r = run(['--report', 'all', '--snapshot-slot', '23'], { HOTELTIME_SNAPSHOT_SLOTS: '' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /snapshot slot 23 is switched off/);
});

test('slot 06 listed but 23 is not: slot 23 is still off', () => {
  const r = run(['--report', 'all', '--snapshot-slot', '23'], { HOTELTIME_SNAPSHOT_SLOTS: '06' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /snapshot slot 23 is switched off/);
});

test('--json says why nothing was done', () => {
  const r = run(['--report', 'all', '--snapshot-slot', '23', '--json'], { HOTELTIME_SNAPSHOT_SLOTS: '' });
  assert.equal(r.code, 0, r.out);
  assert.equal(JSON.parse(r.out.slice(0, r.out.indexOf('}\n') + 1)).code, 'slot_disabled');
});

test('an unknown slot, a typo in HOTELTIME_SNAPSHOT_SLOTS, and combining with another mode are refused (exit 1), never silently ignored', () => {
  assert.equal(run(['--report', 'all', '--snapshot-slot', '99'], { HOTELTIME_SNAPSHOT_SLOTS: '' }).code, 1);
  const typo = run(['--report', 'all', '--snapshot-slot', '23'], { HOTELTIME_SNAPSHOT_SLOTS: '06,24' });
  assert.equal(typo.code, 1);
  assert.match(typo.out, /unknown slot "24"/);
  const combined = run(['--report', 'all', '--snapshot-slot', '23', '--daily'], { HOTELTIME_SNAPSHOT_SLOTS: '23' });
  assert.equal(combined.code, 1);
  assert.match(combined.out, /cannot be combined/);
});

test('a per-day report cannot be taken in a snapshot round, and FoodStory has no snapshot slots', () => {
  const perDay = run(['--report', 'postings', '--snapshot-slot', '23'], { HOTELTIME_SNAPSHOT_SLOTS: '23' });
  assert.equal(perDay.code, 1);
  assert.match(perDay.out, /snapshot reports only/);
  const fs = run(['--site', 'foodstory', '--report', 'all', '--snapshot-slot', '23']);
  assert.equal(fs.code, 1);
  assert.match(fs.out, /HotelTime only/);
});
