import assert from 'node:assert/strict';
import { test } from 'node:test';
import { uploadDiscordMessages } from '../src/core/discord.ts';
import { unresolvedDocumentTypeReason, type UploadRunResult } from '../src/core/uploader.ts';

// ticket 05 ของ exporter-upload-to-uploader: ข้อความ Discord ของขาอัปโหลด — มิเรอร์รูปแบบของ discordMessages (ใบ 08)
// ให้อ่านเป็นระบบเดียวกัน: สรุปท้ายรอบหนึ่งข้อความกึ่งทางการ + แจ้งเตือนทันทีเฉพาะปฏิเสธถาวร (ไม่ retry ได้)

const base: UploadRunResult = {
  site: 'hoteltime',
  sent: 3,
  duplicate: 1,
  rowsMismatch: 0,
  rejected: 0,
  blocked: 0,
  stuck: 0,
  results: [
    { file: 'a.xlsx', report: 'a', kind: 'sent', fileId: 'f1' },
    { file: 'b.xlsx', report: 'b', kind: 'sent', fileId: 'f2' },
    { file: 'c.xlsx', report: 'c', kind: 'sent', fileId: 'f3' },
    { file: 'd.xlsx', report: 'd', kind: 'duplicate', fileId: 'f4' },
  ],
  emptyReports: [],
  emptyResults: [],
};

const AT = '2026-10-15T12:00:05.000Z';
const noneSent = new Set<string>();

test('uploadDiscordMessages: มีไฟล์ถูกประมวลผล → ได้ข้อความสรุปหนึ่งข้อความ มีตัวเลขครบ อ่านง่ายกึ่งทางการ', () => {
  const messages = uploadDiscordMessages(base, { at: AT, alreadySent: noneSent });
  assert.equal(messages.length, 1);
  assert.match(messages[0]!.content, /### Upload done · \d{2}:\d{2}/); // หัวข้อบอกว่าเป็นเรื่องอัปโหลด แยกจากสรุป export ("Export done")
  assert.match(messages[0]!.content, /HotelTime/);
  assert.match(messages[0]!.content, /3\/\d+ sent/);
  assert.match(messages[0]!.content, /1 duplicate/);
  assert.doesNotMatch(messages[0]!.content, /Problems|Action needed|finished with problems/); // ไม่มีปัญหาเลย = ไม่มีบรรทัดสถานะ
});

test('uploadDiscordMessages: โชว์ชื่อรายงานที่อัปโหลดสำเร็จเป็นลิสต์แนวตั้ง (ไม่มีนามสกุล)', () => {
  const messages = uploadDiscordMessages(base, { at: AT, alreadySent: noneSent });
  assert.match(messages[0]!.content, /\*\*Uploaded data · HotelTime\*\* \(\d+\)\n```\n[a-z]/);
});

test('uploadDiscordMessages: ไม่มีไฟล์ไหนถูกประมวลผลเลย (รันซ้ำแบบ no-op) → ไม่ส่งอะไรเลย ไม่ใช่สรุปตัวเลขศูนย์', () => {
  const empty: UploadRunResult = { ...base, sent: 0, duplicate: 0, results: [], emptyReports: [] };
  assert.deepEqual(uploadDiscordMessages(empty, { at: AT, alreadySent: noneSent }), []);
});

test('uploadDiscordMessages: รายงานว่างที่ยังไม่ได้ประกาศ (flag ปิด/document_type ยัง resolve ไม่ได้/ยังไม่ผ่าน) นับรวมในสรุปด้วย ไม่ถือเป็น no-op', () => {
  const onlyEmpty: UploadRunResult = { ...base, sent: 0, duplicate: 0, results: [], emptyReports: [{ report: 'x' }] };
  const messages = uploadDiscordMessages(onlyEmpty, { at: AT, alreadySent: noneSent });
  assert.equal(messages.length, 1);
  assert.match(messages[0]!.content, /1 empty not announced/);
  assert.doesNotMatch(messages[0]!.content, /empty announced/);
});

// ticket 13: "ว่าง" เฉย ๆ เคยแปลว่า "ไม่ต้องทำอะไร รอทีม uploader" — ตอนนี้ต้องแยกประกาศสำเร็จจากยังไม่ประกาศ
test('uploadDiscordMessages: รายงานว่างที่ประกาศ empty สำเร็จแล้ว ขึ้นเป็น "ว่าง-ประกาศสำเร็จ" แยกจากที่ยังไม่ประกาศ', () => {
  const mixed: UploadRunResult = {
    ...base,
    sent: 0,
    duplicate: 0,
    results: [],
    emptyReports: [{ report: 'x' }, { report: 'y' }],
    emptyResults: [{ report: 'x', kind: 'announced', superseded: [] }],
  };
  const messages = uploadDiscordMessages(mixed, { at: AT, alreadySent: noneSent });
  assert.equal(messages.length, 1);
  assert.match(messages[0]!.content, /1 empty announced/);
  assert.match(messages[0]!.content, /1 empty not announced/);
});

test('uploadDiscordMessages: empty item ที่ปฏิเสธถาวร/ค้างถาวร ขึ้นชื่อรายงานจริงใน section "Failed" ด้วย (ไม่ใช่แค่ไฟล์ปกติ)', () => {
  const withEmptyFailures: UploadRunResult = {
    ...base,
    sent: 0,
    duplicate: 0,
    results: [],
    emptyReports: [{ report: 'x' }, { report: 'y' }],
    emptyResults: [
      { report: 'x', kind: 'rejected', reason: 'unknown document_type' },
      { report: 'y', kind: 'stuck', attempts: 3, lastMessage: 'timeout' },
    ],
  };
  const messages = uploadDiscordMessages(withEmptyFailures, { at: AT, alreadySent: noneSent });
  assert.equal(messages.length, 1); // emptyResults ที่ rejected/stuck ไม่ใช่ 'rejected'/'stuck' ของไฟล์ปกติ ไม่เข้าเกณฑ์แจ้งเตือนแยกทันที
  assert.match(messages[0]!.content, /\*\*Failed \(2\)\*\*/);
  assert.match(messages[0]!.content, /• HotelTime: x \(empty\): unknown document_type/);
  assert.match(messages[0]!.content, /• HotelTime: y \(empty\): stuck after 3 attempts — timeout/);
});

// เจ้าของระบบขอ 2026-10-19 (รอบสอง): รวมสรุป+แจ้งเตือนเป็นข้อความเดียว ไม่ต้องมี heartbeat/ข้อความแยกอีกต่อไป
test('uploadDiscordMessages: มี rejected → verdict เป็นปัญหา และรวมอยู่ในข้อความเดียวกับสรุป (ไม่แยกข้อความอีกต่อไป)', () => {
  const withRejected: UploadRunResult = {
    ...base,
    rejected: 1,
    results: [...base.results, { file: 'e.xlsx', report: 'e', kind: 'rejected', reason: 'document_type ไม่อยู่ใน catalog' }],
  };
  const messages = uploadDiscordMessages(withRejected, { at: AT, alreadySent: noneSent });
  assert.equal(messages.length, 1); // รวมเป็นข้อความเดียว
  const [message] = messages;
  assert.match(message!.content, /### Upload /);
  assert.match(message!.content, /Upload finished with problems/);
  assert.match(message!.content, /e\.xlsx.*document_type ไม่อยู่ใน catalog/);
  // สรุป+แจ้งเตือนรวมกันแล้ว ชื่อไฟล์จริงต้องอยู่ทั้ง section "ไม่สำเร็จ" (ของสรุป) และ "เรื่องที่ต้องดู" (ของแจ้งเตือน)
  assert.match(message!.content, /\*\*Failed \(1\)\*\*\n• HotelTime: e\.xlsx \(e\): document_type ไม่อยู่ใน catalog/);
  assert.match(message!.content, /\*\*Needs attention\*\*/); // หัวข้อย่อย ไม่ใช่หัวข้อเต็ม เพราะมีสรุปอยู่แล้วในข้อความเดียวกัน
  // key ของทั้งสรุปและแจ้งเตือนต้องอยู่ในข้อความรวมนี้ ให้ sendAndLog บันทึก dedup ถูกทั้งคู่
  assert.ok(message!.keys.some((k) => k.startsWith('upload-summary@')));
  assert.ok(message!.keys.some((k) => k.startsWith('upload-rejected@')));
});

test('uploadDiscordMessages: stuck/blocked ไม่ส่งแจ้งเตือนทันที (เห็นแค่ในสรุป) — เฉพาะ rejected ที่ไม่ retry ได้เท่านั้นที่ด่วน', () => {
  const withStuckAndBlocked: UploadRunResult = {
    ...base,
    stuck: 1,
    blocked: 1,
    results: [
      ...base.results,
      { file: 'f.xlsx', report: 'f', kind: 'stuck', attempts: 3, lastMessage: 'timeout' },
      { file: 'g.xlsx', report: 'g', kind: 'blocked-as-of', asOf: '2026-10-15T00:00:00Z', lastKnownAsOf: '2026-10-16T00:00:00Z' },
    ],
  };
  const messages = uploadDiscordMessages(withStuckAndBlocked, { at: AT, alreadySent: noneSent });
  assert.equal(messages.length, 1); // แค่สรุป ไม่มีแจ้งเตือนแยก
  // ticket (notification redesign 2026-10-19): ค้างถาวรไม่ใช่ตัวเลขเปล่า ๆ อีกต่อไป — ขึ้นเป็นรายชื่อไฟล์จริงใน section "ไม่สำเร็จ"
  assert.match(messages[0]!.content, /f\.xlsx.*stuck after 3 attempts/);
  assert.match(messages[0]!.content, /1 blocked/);
});

test('uploadDiscordMessages: rows_mismatch ปรากฏเป็นคำเตือนในสรุป ไม่ใช่ความล้มเหลว', () => {
  const withMismatch: UploadRunResult = {
    ...base,
    rowsMismatch: 1,
    results: [...base.results, { file: 'h.xlsx', report: 'h', kind: 'rows-mismatch', fileId: 'f9' }],
  };
  const messages = uploadDiscordMessages(withMismatch, { at: AT, alreadySent: noneSent });
  assert.equal(messages.length, 1);
  assert.match(messages[0]!.content, /1 rows mismatch/);
});

test('uploadDiscordMessages: rejected ซ้ำไฟล์เดิมในวันเดียวกัน (เรียกซ้ำ) ไม่แจ้งเตือนซ้ำ — alreadySent กันไว้', () => {
  const withRejected: UploadRunResult = {
    ...base,
    rejected: 1,
    results: [{ file: 'e.xlsx', report: 'e', kind: 'rejected', reason: 'x' }],
  };
  const first = uploadDiscordMessages(withRejected, { at: AT, alreadySent: noneSent });
  const alertKey = first[0]!.keys.find((k) => k.startsWith('upload-rejected@'))!;
  const second = uploadDiscordMessages(withRejected, { at: '2026-10-15T15:00:00.000Z', alreadySent: new Set([alertKey]) });
  assert.equal(second.some((m) => m.content.includes('Needs attention')), false); // แจ้งแล้ววันนี้ ไม่แจ้งซ้ำ (รวมเป็นข้อความเดียวแล้ว — ไม่มี section นี้เลยตอนที่ไม่มีอะไรใหม่)
  assert.equal(second.some((m) => m.content.includes('### Upload ')), true); // สรุปยังส่งตามปกติทุกรอบ
});

test('uploadDiscordMessages: คนละวัน rejected ไฟล์เดิมแจ้งซ้ำได้ (ยังไม่ได้แก้จริง ต้องรู้ทุกวัน)', () => {
  const withRejected: UploadRunResult = {
    ...base,
    rejected: 1,
    results: [{ file: 'e.xlsx', report: 'e', kind: 'rejected', reason: 'x' }],
  };
  const day1 = uploadDiscordMessages(withRejected, { at: '2026-10-15T12:00:00.000Z', alreadySent: noneSent });
  const key1 = day1[0]!.keys.find((k) => k.startsWith('upload-rejected@'))!;
  const day2 = uploadDiscordMessages(withRejected, { at: '2026-10-16T12:00:00.000Z', alreadySent: new Set([key1]) });
  assert.equal(day2.some((m) => m.content.includes('Needs attention')), true);
});

// พบจริง 2026-10-19: FoodStory 57 ไฟล์ rejected เพราะ document_type ยัง resolve ไม่ได้ (รู้สาเหตุอยู่แล้ว ticket 08
// ยัง block) ทำให้ยิง alert "เรื่องที่ต้องดู" สแปม 57 ข้อความ ทั้งที่ไม่มีอะไรทำได้ตอนนี้ — ต้องไม่นับเป็นเรื่องเร่งด่วน
test('uploadDiscordMessages: rejected เพราะ document_type ยัง resolve ไม่ได้ (FoodStory) → ไม่แจ้งเตือนสแปม ไม่ใช่ "เรื่องต้องดู" แต่ยังนับเป็น backlog ให้เห็นในสรุป', () => {
  const foodstoryPending: UploadRunResult = {
    ...base,
    site: 'foodstory',
    sent: 0,
    duplicate: 0,
    rejected: 3,
    results: [
      { file: 'a.xlsx', report: 'crm', kind: 'rejected', reason: unresolvedDocumentTypeReason('foodstory', 'crm') },
      { file: 'b.xlsx', report: 'pay', kind: 'rejected', reason: unresolvedDocumentTypeReason('foodstory', 'pay') },
      { file: 'c.xlsx', report: 'order', kind: 'rejected', reason: unresolvedDocumentTypeReason('foodstory', 'order') },
    ],
  };
  const messages = uploadDiscordMessages(foodstoryPending, { at: AT, alreadySent: noneSent });
  assert.equal(messages.length, 1); // แค่สรุป — ไม่มี "เรื่องที่ต้องดู" แยกเลย ไม่ว่าจะกี่ไฟล์
  assert.doesNotMatch(messages[0]!.content, /Failed \(/); // ไม่ใช่ความล้มเหลว ไม่เข้า section นี้
  assert.match(messages[0]!.content, /3 waiting for document_type/); // ยังเห็น backlog ได้ แบบไม่ตกใจ
  assert.doesNotMatch(messages[0]!.content, /Upload finished with problems/); // verdict ไม่ใช่ "มีเรื่องต้องดู"
});

test('uploadDiscordMessages: rejected แบบจริง (catalog ไม่ตรง) ยังแจ้งเตือนและขึ้น "ไม่สำเร็จ"/"เรื่องต้องดู" เหมือนเดิม — ไม่ได้ปิดกั้นไปด้วย', () => {
  const genuineRejected: UploadRunResult = {
    ...base,
    sent: 0,
    duplicate: 0,
    rejected: 1,
    results: [{ file: 'z.xlsx', report: 'z', kind: 'rejected', reason: 'document_type "x" ไม่อยู่ใน catalog จริงของ uploader — ไม่ส่ง ไม่เดา' }],
  };
  const messages = uploadDiscordMessages(genuineRejected, { at: AT, alreadySent: noneSent });
  assert.equal(messages.length, 1); // สรุป+แจ้งเตือนรวมเป็นข้อความเดียว (เจ้าของระบบขอ 2026-10-19 รอบสอง)
  assert.match(messages[0]!.content, /\*\*Failed \(1\)\*\*/);
  assert.match(messages[0]!.content, /Upload finished with problems/);
});
