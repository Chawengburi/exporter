import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { notifyLogPath } from '../src/core/discord.ts';
import { notifyDiscord } from '../src/notify.ts';

// ใบ 08: แจ้งผลหลังรอบรายวัน — ใช้แคตตาล็อกจริงของทั้งสอง Site กับคลังปลอม + เซิร์ฟเวอร์ Discord ปลอม · ไม่ส่งซ้ำ · ส่งไม่ได้ไม่โยน error และบันทึกไว้ ·
// URL ของ webhook ไม่อยู่ในบันทึก

delete process.env.DISCORD_WEBHOOK_URL; // ค่าใน shell ชนะ .env — เทสต์ใช้ .env ปลอมของตัวเองเท่านั้น
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
    envFile: async (url) => {
      const file = path.join(root, '.env');
      await writeFile(file, `EXPORTER_GO_LIVE=2026-10-13\n${url ? `DISCORD_WEBHOOK_URL=${url}\n` : ''}`);
      return file;
    },
  };
}

async function fakeDiscord(status = 204) {
  const bodies: { content: string }[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      bodies.push(JSON.parse(body));
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
    assert.match(all, /สรุป exporter ประจำวัน 2026-10-14/);
    assert.match(all, /HotelTime[^\n]*2026-10-13[^\n]*postings ล้ม[^\n]*Timeout/);
    const count = discord.bodies.length;
    const again = await notifyDiscord({ trigger: 'hoteltime-daily', now: thai('2026-10-14T18:40'), dataDir: s.dataDir, envFile });
    assert.deepEqual(again, { status: 'sent', messages: 0 });
    assert.equal(discord.bodies.length, count);
    assert.doesNotMatch(await readFile(notifyLogPath(s.dataDir), 'utf8'), /token-should-never-be-logged|api\/webhooks/);
  } finally {
    await discord.close();
  }
});

test('รอบเที่ยง (ยังมีรอบเก็บตก): ไม่ส่งสรุป และรายงานที่ล้มยังเป็น "รอ" — ไม่แจ้งเตือน', async () => {
  const s = await fakeStore();
  const discord = await fakeDiscord();
  try {
    await notifyDiscord({ trigger: 'hoteltime-daily', now: thai('2026-10-14T12:10'), dataDir: s.dataDir, envFile: await s.envFile(discord.url) });
    const all = discord.bodies.map((b) => b.content).join('\n');
    assert.doesNotMatch(all, /สรุป|postings/);
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

test('🔴 สรุปที่ส่งไม่ได้ตอน 18:xx ส่งใหม่ครั้งถัดไปของเย็นวันเดียวกัน แม้ trigger เป็น FoodStory (ไม่งั้นวันนั้นไม่มีสรุป = ดูเหมือนระบบเงียบ)', async () => {
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
    assert.match(up.bodies.map((b) => b.content).join('\n'), /สรุป exporter ประจำวัน 2026-10-14/);
  } finally {
    await up.close();
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
