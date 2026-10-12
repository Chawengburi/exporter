import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readSaleByChannelCsv } from '../src/sites/foodstory/salebychannel.ts';

const tmp = mkdtempSync(path.join(tmpdir(), 'foodstory-channel-'));

// เนื้อไฟล์จริงที่ดาวน์โหลดได้ 2026-09-26 (unzip ตรง ๆ — ไม่ใช่ .xlsx ยืนยันแล้วว่าเป็น .csv จริง)
const REAL_CSV = [
  'ช่องทาง,ชื่อสาขา,จำนวนบิล,ยอดขาย,ยอดหัก GP,ค่าจัดส่ง,รายรับสุทธิ',
  '"=""หน้าร้าน""","=""""","=""32""","=""10,010.0""","=""0.0""","=""0.0""","=""10,010.0"""',
  '"=""""","=""Chaweng Buri Resort""","=""32""","=""10,010.0""","=""0.0""","=""0.0""","=""10,010.0"""',
  '"=""รวมทั้งหมด""","=""""","=""32""","=""10,010.0""","=""0.0""","=""0.0""","=""10,010.0"""',
].join('\r\n') + '\r\n';

test('🔴 แกะ Excel forced-text ("=""ค่า""") ออกจากทุกเซลล์ (ไฟล์จริง 2026-09-26)', async () => {
  const p = path.join(tmp, 'salebychannel.csv');
  writeFileSync(p, REAL_CSV, 'utf-8');

  const sheet = await readSaleByChannelCsv(p);

  assert.deepEqual([...sheet.header], ['ช่องทาง', 'ชื่อสาขา', 'จำนวนบิล', 'ยอดขาย', 'ยอดหัก GP', 'ค่าจัดส่ง', 'รายรับสุทธิ']);
  assert.equal(sheet.rows.length, 3);
  assert.deepEqual([...sheet.rows[0]!], ['หน้าร้าน', '', '32', '10,010.0', '0.0', '0.0', '10,010.0']);
  assert.deepEqual([...sheet.rows[1]!], ['', 'Chaweng Buri Resort', '32', '10,010.0', '0.0', '0.0', '10,010.0']);
  // 🔴 แถวรวมท้ายใช้คำว่า "รวมทั้งหมด" ไม่ใช่ "Total"/"รวม" แบบรายงานอื่น — คืนดิบไว้ ไม่ตัดออก
  assert.deepEqual([...sheet.rows[2]!], ['รวมทั้งหมด', '', '32', '10,010.0', '0.0', '0.0', '10,010.0']);
});

test('ไฟล์ว่างเปล่าล้มดัง ๆ แทนตีความมั่ว', async () => {
  const p = path.join(tmp, 'empty.csv');
  writeFileSync(p, '', 'utf-8');
  await assert.rejects(() => readSaleByChannelCsv(p), /ไฟล์ไม่มีแถวเลยสักแถว/);
});
