import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyRowCount } from '../src/sites/foodstory/verify.ts';
import type { ShowingInfo } from '../src/sites/foodstory/interactions.ts';
import type { FoodStorySheet } from '../src/sites/foodstory/xlsx.ts';

const sheet = (rows: number): FoodStorySheet => ({
  title: 'x',
  header: ['a'],
  rows: Array.from({ length: rows }, () => ['1']),
});
const showing = (total: number): ShowingInfo => ({ from: 1, to: total, total });

test('จำนวนแถวตรงกับที่หน้าเว็บบอกผ่านเงียบ ๆ', () => {
  assert.doesNotThrow(() => verifyRowCount(sheet(3), showing(3)));
});

test('🔴 จับกรณีไฟล์ถูกตัด (เช่นลืมเปลี่ยน Show N rows)', () => {
  assert.throws(
    () => verifyRowCount(sheet(25), showing(5000)),
    /จำนวนแถวในไฟล์ \(25\) ไม่ตรงกับที่หน้าเว็บบอก \(5000\)/,
  );
});

test('ผลว่างทั้งสองฝั่งก็ผ่าน — 0 แถวไม่ใช่ error', () => {
  assert.doesNotThrow(() => verifyRowCount(sheet(0), showing(0)));
});
