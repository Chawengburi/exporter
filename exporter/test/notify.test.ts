import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { notifyLogPath } from '../src/core/discord.ts';
import { notifyDiscord, notifyUpload } from '../src/notify.ts';
import type { UploadRunResult } from '../src/core/uploader.ts';

// ใบ 08: แจ้งผลหลังรอบรายวัน — ใช้แคตตาล็อกจริงของทั้งสอง Site กับคลังปลอม + เซิร์ฟเวอร์ Discord ปลอม · ไม่ส่งซ้ำ · ส่งไม่ได้ไม่โยน error และบันทึกไว้ ·
// URL ของ webhook ไม่อยู่ในบันทึก

// ค่าใน shell ชนะ .env — เทสต์ใช้ .env ปลอมของตัวเองเท่านั้น
delete process.env.DISCORD_WEBHOOK_URL_EXPORT;
delete process.env.DISCORD_WEBHOOK_URL_UPLOAD;
delete process.env.EXPORTER_GO_LIVE;

const thai = (iso: string) => new Date(`${iso}+07:00`);
const dirs: string[] = [];
after(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

/** คลังปลอม: HotelTime วันที่ 13 — postings ล้ม ที่เหลือของรายงานตามวันไม่มี (แคตตาล็อกจริง 22 ตัว) */
async function fakeStore(): Promise<{ dataDir: string; envFile: (url: string | null) => Promise<string> }> {
  const root = await mkdtemp(path.join(tmpdir(), 'notify-'));
  dirs.push(root);
  const dataDir = path.join(root, 'data');
  const folder = path.join(dataDir, 'hoteltime', 'daily', '2026-10', '2026-10-13');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, '_run.json'), JSON.stringify({
    site: 'hoteltime', kind: 'daily', dataThrough: '2026-10-13', skipped: [],
    runs: [{ startedAt: '2026-10-14T05:00:00.000Z', finishedAt: '2026-10-14T05:10:00.000Z', reports: ['postings'] }],
    reports: { postings: { report: 'postings', status: 'failed', error: 'Timeout 60000ms exceeded', attempts: 3, finishedAt: '2026-10-14T05:10:00.000Z' } },
  }));
  return {
    dataDir,
    // url เดียวใช้แทนทั้งสอง channel (export/upload) — แต่ละเทสต์เรียก notifyDiscord หรือ notifyUpload อย่างเดียว ไม่เคยทั้งคู่
    envFile: async (url) => {
      const file = path.join(root, '.env');
      await writeFile(file, `EXPORTER_GO_LIVE=2026-10-13\n${url ? `DISCORD_WEBHOOK_URL_EXPORT=${url}\nDISCORD_WEBHOOK_URL_UPLOAD=${url}\n` : ''}`);
      return file;
    },
  };
}

// payload เป็น Discord Container (Components V2, เจ้าของระบบขอ 2026-10-18) — อาจมีหลาย Text Display คั่นด้วย
// Separator (เจ้าของระบบขอ 2026-10-19) รวม content ของทุก Text Display ในนั้นด้วย "\n" ให้ดูเหมือนข้อความเดียว
// (ไม่ต้องแก้ assertion เดิมทั้งไฟล์ที่เคยคาด Text Display ตัวเดียว)
type ContainerPayload = { readonly components: readonly [{ readonly components: readonly { readonly type: number; readonly content?: string }[] }] };
async function fakeDiscord(status = 204) {
  const bodies: { content: string }[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const payload = JSON.parse(body) as ContainerPayload;
      const content = payload.components[0].components.map((c) => c.content).filter((c): c is string => c !== undefined).join('\n');
      bodies.push({ content });
      res.writeHead(status, { 'content-type': 'application/json' }).end(status === 204 ? undefined : JSON.stringify({ message: 'boom' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/api/webhooks/9/token-should-never-be-logged`, bodies, close: () => new Promise((r) => server.close(r)) };
}

test('🔴 ไม่ได้ตั้ง URL = ข้ามการส่ง ไม่โยน error ไม่เขียนบันทึก', async () => {
  const s = await fakeStore();
  const r = await notifyDiscord({ trigger: 'hoteltime-daily', now: thai('2026-10-14T18:10'), dataDir: s.dataDir, envFile: await s.envFile(null) });
  assert.equal(r.status, 'skipped');
  assert.equal(existsSync(notifyLogPath(s.dataDir)), false);
});

test('🔴 รอบ HotelTime ที่จบหลัง 18:00 = รอบสุดท้ายของวัน: ส่งสรุป + แจ้งรายงานที่ยังล้ม (ประเมินเหมือน 18:30) · เรียกซ้ำไม่ส่งซ้ำ · URL ไม่อยู่ในบันทึก', async () => {
  const s = await fakeStore();
  const discord = await fakeDiscord();
  try {
    const envFile = await s.envFile(discord.url);
    const first = await notifyDiscord({ trigger: 'hoteltime-daily', now: thai('2026-10-14T18:10'), dataDir: s.dataDir, envFile });
    assert.equal(first.status, 'sent');
    const all = discord.bodies.map((b) => b.content).join('\n');
    assert.match(all, /### Export finished with problems · 18:10/); // เวลาในหัวข้อ = เวลาจริงของรอบ ไม่ใช่เวลาประเมิน 18:30
    assert.match(all, /HotelTime daily run/);
    assert.match(all, /Data date 2026-10-13/);
    assert.match(all, /HotelTime[^\n]*2026-10-13[^\n]*postings failed[^\n]*Timeout/);
    const count = discord.bodies.length;
    // รอบเดิมเวลาเดิมซ้ำ (เช่น Windmill ยิงซ้ำในนาทีเดียวกัน) ไม่ส่งซ้ำ — รอบใหม่ต่างเวลาได้สรุปของตัวเอง
    const again = await notifyDiscord({ trigger: 'hoteltime-daily', now: thai('2026-10-14T18:10'), dataDir: s.dataDir, envFile });
    assert.deepEqual(again, { status: 'sent', messages: 0 });
    assert.equal(discord.bodies.length, count);
    assert.doesNotMatch(await readFile(notifyLogPath(s.dataDir), 'utf8'), /token-should-never-be-logged|api\/webhooks/);
  } finally {
    await discord.close();
  }
});

test('รอบเที่ยง (ยังมีรอบเก็บตก): ส่งสรุปของรอบ (ทุกรอบมีสรุป) แต่รายงานที่ล้มยังเป็น "รอ" — ไม่แจ้งเตือน ไม่ขึ้นสีปัญหา', async () => {
  const s = await fakeStore();
  const discord = await fakeDiscord();
  try {
    await notifyDiscord({ trigger: 'hoteltime-daily', now: thai('2026-10-14T12:10'), dataDir: s.dataDir, envFile: await s.envFile(discord.url) });
    const all = discord.bodies.map((b) => b.content).join('\n');
    assert.match(all, /### Export done · action needed · 12:10/);
    assert.doesNotMatch(all, /finished with problems|postings failed/); // postings ยังเป็น "รอ" ไม่ใช่ alert (บรรทัดใน section Failed ของสรุปไม่ใช่ alert)
  } finally {
    await discord.close();
  }
});

test('🔴 Discord ล่ม: ไม่โยน error · บันทึกว่าส่งไม่ได้ (ไม่มี URL) · ยังไม่นับว่าส่งแล้ว — ครั้งถัดไปส่งใหม่', async () => {
  const s = await fakeStore();
  const down = await fakeDiscord(500);
  try {
    const envFile = await s.envFile(down.url);
    const r = await notifyDiscord({ trigger: 'hoteltime-daily', now: thai('2026-10-14T18:10'), dataDir: s.dataDir, envFile });
    assert.equal(r.status, 'failed');
    const log = JSON.parse(await readFile(notifyLogPath(s.dataDir), 'utf8'));
    assert.equal(log.failures.length, 1);
    assert.match(log.failures[0].error, /500/);
    assert.deepEqual(log.sent, {});
    assert.doesNotMatch(JSON.stringify(log), /token-should-never-be-logged/);
  } finally {
    await down.close();
  }
  const up = await fakeDiscord();
  try {
    const r = await notifyDiscord({ trigger: 'hoteltime-daily', now: thai('2026-10-14T18:20'), dataDir: s.dataDir, envFile: await s.envFile(up.url) });
    assert.equal(r.status, 'sent');
    assert.ok(up.bodies.length >= 2);
  } finally {
    await up.close();
  }
});

test('🔴 สรุปที่ส่งไม่ได้ตอน 18:xx ไม่ค้าง: รอบถัดไป (แม้ trigger เป็น FoodStory) ส่งสรุปของรอบตัวเองตามปกติ', async () => {
  const s = await fakeStore();
  const down = await fakeDiscord(500);
  try {
    await notifyDiscord({ trigger: 'hoteltime-daily', now: thai('2026-10-14T18:10'), dataDir: s.dataDir, envFile: await s.envFile(down.url) });
  } finally {
    await down.close();
  }
  const up = await fakeDiscord();
  try {
    await notifyDiscord({ trigger: 'foodstory-daily', now: thai('2026-10-14T19:30'), dataDir: s.dataDir, envFile: await s.envFile(up.url) });
    assert.match(up.bodies.map((b) => b.content).join('\n'), /### Export (done|finished with problems) · 19:30[\s\S]*FoodStory run/);
  } finally {
    await up.close();
  }
});

// ticket 05 ของ exporter-upload-to-uploader: notifyUpload ใช้ log/ตัวส่งเดียวกับ notifyDiscord ของ export

const uploadResult = (overrides: Partial<UploadRunResult> = {}): UploadRunResult => ({
  site: 'hoteltime', sent: 2, duplicate: 0, rowsMismatch: 0, rejected: 0, blocked: 0, stuck: 0,
  results: [
    { file: 'a.xlsx', report: 'a', kind: 'sent', fileId: 'f1' },
    { file: 'b.xlsx', report: 'b', kind: 'sent', fileId: 'f2' },
  ],
  emptyReports: [],
  emptyResults: [],
  ...overrides,
});

test('notifyUpload: ไม่ได้ตั้ง URL = ข้ามการส่ง ไม่โยน error ไม่เขียนบันทึก', async () => {
  const s = await fakeStore();
  const r = await notifyUpload({ result: uploadResult(), now: thai('2026-10-15T12:00'), dataDir: s.dataDir, envFile: await s.envFile(null) });
  assert.equal(r.status, 'skipped');
  assert.equal(existsSync(notifyLogPath(s.dataDir)), false);
});

test('notifyUpload: ส่งสรุปสำเร็จ และไม่อยู่ในบันทึก URL', async () => {
  const s = await fakeStore();
  const discord = await fakeDiscord();
  try {
    const r = await notifyUpload({ result: uploadResult(), now: thai('2026-10-15T12:00'), dataDir: s.dataDir, envFile: await s.envFile(discord.url) });
    assert.equal(r.status, 'sent');
    assert.match(discord.bodies.map((b) => b.content).join('\n'), /### Upload done · 12:00[\s\S]*HotelTime/);
    assert.doesNotMatch(await readFile(notifyLogPath(s.dataDir), 'utf8'), /token-should-never-be-logged/);
  } finally {
    await discord.close();
  }
});

test('notifyUpload: ไม่มีไฟล์ไหนถูกประมวลผลเลย (no-op) → ไม่ส่งอะไรเลย', async () => {
  const s = await fakeStore();
  const discord = await fakeDiscord();
  try {
    const r = await notifyUpload({
      result: uploadResult({ sent: 0, results: [] }),
      now: thai('2026-10-15T12:00'),
      dataDir: s.dataDir,
      envFile: await s.envFile(discord.url),
    });
    assert.deepEqual(r, { status: 'sent', messages: 0 });
    assert.equal(discord.bodies.length, 0);
  } finally {
    await discord.close();
  }
});

test('notifyUpload: ไฟล์ปฏิเสธถาวร → แจ้งทันทีเป็นข้อความแยก และ export/upload ใช้บันทึกเดียวกัน (กันซ้ำร่วมกัน)', async () => {
  const s = await fakeStore();
  const discord = await fakeDiscord();
  try {
    const envFile = await s.envFile(discord.url);
    const withRejected = uploadResult({ rejected: 1, results: [{ file: 'c.xlsx', report: 'c', kind: 'rejected', reason: 'document_type ไม่รู้จัก' }] });
    const first = await notifyUpload({ result: withRejected, now: thai('2026-10-15T12:00'), dataDir: s.dataDir, envFile });
    assert.equal(first.status, 'sent');
    assert.match(discord.bodies.map((b) => b.content).join('\n'), /c\.xlsx.*document_type ไม่รู้จัก/);
    const countAfterFirst = discord.bodies.length;

    // เรียกซ้ำวันเดียวกัน ไฟล์เดิมเหตุผลเดิม — สรุปยังส่ง (เป็นรอบใหม่ มี c.xlsx ซ้ำได้ เพราะสรุปบอกสถานะปัจจุบันทุกรอบ
    // โดยตั้งใจ ไม่ใช่กันซ้ำแบบแจ้งเตือน) แต่ข้อความ "เรื่องที่ต้องดู" (แจ้งเตือนแยก) ต้องไม่ส่งซ้ำ
    await notifyUpload({ result: withRejected, now: thai('2026-10-15T15:00'), dataDir: s.dataDir, envFile });
    const newBodies = discord.bodies.slice(countAfterFirst).map((b) => b.content);
    assert.match(newBodies.join('\n'), /Upload done/); // มีสรุปรอบใหม่ (มี c.xlsx ในนี้ได้ ตามที่ตั้งใจ)
    assert.ok(!newBodies.some((b) => b.includes('Needs attention'))); // ไม่มีแจ้งเตือนแยกซ้ำ
  } finally {
    await discord.close();
  }
});

// เจ้าของระบบขอ 2026-10-18: แยก channel ของ export กับ upload — ขาหนึ่งตั้ง URL ไว้ อีกขาไม่ตั้ง ต้องไม่กระทบกัน
test('notifyDiscord/notifyUpload: คนละ channel กันจริง — ตั้งแค่ขา export ไม่กระทบขา upload และกลับกัน', async () => {
  const s = await fakeStore();
  const exportServer = await fakeDiscord();
  try {
    const file = await s.envFile(null);
    await writeFile(file, `EXPORTER_GO_LIVE=2026-10-13\nDISCORD_WEBHOOK_URL_EXPORT=${exportServer.url}\n`);
    const exported = await notifyDiscord({ trigger: 'hoteltime-daily', now: thai('2026-10-14T18:10'), dataDir: s.dataDir, envFile: file });
    assert.equal(exported.status, 'sent');
    assert.ok(exportServer.bodies.length > 0);
    const uploaded = await notifyUpload({ result: uploadResult(), now: thai('2026-10-15T12:00'), dataDir: s.dataDir, envFile: file });
    assert.equal(uploaded.status, 'skipped'); // ยังไม่ได้ตั้ง DISCORD_WEBHOOK_URL_UPLOAD — ไม่ไปส่งที่ channel export แทน
  } finally {
    await exportServer.close();
  }
});

test('dry run: คืนข้อความโดยไม่ส่งและไม่บันทึก', async () => {
  const s = await fakeStore();
  const discord = await fakeDiscord();
  try {
    const r = await notifyDiscord({ trigger: 'manual', summary: true, dryRun: true, now: thai('2026-10-14T18:40'), dataDir: s.dataDir, envFile: await s.envFile(discord.url) });
    assert.equal(r.status, 'dry-run');
    assert.ok(r.status === 'dry-run' && r.messages.length > 0);
    assert.equal(discord.bodies.length, 0);
    assert.equal(existsSync(notifyLogPath(s.dataDir)), false);
  } finally {
    await discord.close();
  }
});
