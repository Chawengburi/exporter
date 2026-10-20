#!/usr/bin/env node
/**
 * ตั้งค่า Windmill ให้รัน HotelTime ทุกวัน — แทนการคลิกหน้าเว็บตาม INSTALL.md ข้อ 4–6 (ข้อ 3 `docker compose up -d` ยังทำก่อน) (ticket 03 ของ exporter-ubuntu-deploy)
 *
 *   node windmill/setup.mjs                 ← หลัง `docker compose up -d` · รันซ้ำได้ (ไม่มีอะไรเปลี่ยน = ไม่แตะอะไร)
 *   node windmill/setup.mjs --base http://127.0.0.1:18000
 *
 * ทำ 4 อย่างผ่าน REST API (ทดสอบกับ Windmill CE 1.815.0 ที่ปักหมุดใน .env.example):
 *  1. เปลี่ยนรหัส admin@windmill.dev จากค่าเริ่มต้น `changeme` เป็นรหัสสุ่ม เก็บใน windmill/.admin-password (600, ไม่อยู่ใน git) —
 *     เขียนไฟล์ก่อนแล้วค่อยเปลี่ยนรหัส (เปลี่ยนสำเร็จแต่เขียนไฟล์ไม่ได้ = ล็อกตัวเองออก) · ถ้าไฟล์มีแต่รหัสยังเป็น changeme ให้ใช้รหัสในไฟล์
 *  2. worker group "custom" ฟัง tag `chromium` (worker ที่มี Chromium + mount exporter/)
 *  3. สคริปต์ `u/<ผู้ตั้ง>/pms_export_daily` และ `..._catchup` — เนื้อหาจาก windmill/scripts/*.sh (แก้ไฟล์ใน repo แล้วรันซ้ำ = deploy เวอร์ชันใหม่)
 *  4. schedule เที่ยง และ 15:00/18:00 (Asia/Bangkok) — permissioned_as เป็นผู้ที่รันสคริปต์นี้เสมอ (กับดักใน INSTALL.md §6: ผู้ที่ตั้งเดิม
 *     ถูกลบแล้ว schedule ล้มเงียบ ๆ — รันซ้ำแก้ให้เอง)
 *
 * ข้อความเป็นภาษาไทยทั้งหมด (เครื่องปลายทางไม่มี AI ช่วยอ่าน) · ไม่พิมพ์ token/รหัสผ่านออกจอ
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PASSWORD_FILE = path.join(HERE, '.admin-password');
// เครื่องที่เปลี่ยนอีเมล admin ไปแล้วตั้ง WM_ADMIN_EMAIL=... ตอนรัน · เครื่องใหม่ใช้ค่าเริ่มต้นของ Windmill
const ADMIN_EMAIL = process.env.WM_ADMIN_EMAIL ?? 'admin@windmill.dev';
const DEFAULT_PASSWORD = 'changeme';
const WORKSPACE = 'admins';
const WORKER_GROUP = 'worker__custom';
const TAG = 'chromium';
const TIMEZONE = 'Asia/Bangkok';
const JOBS = [
  { name: 'pms_export_daily', summary: 'HotelTime รอบรายวัน (เที่ยง)', cron: '0 0 12 * * *' },
  { name: 'pms_export_daily_catchup', summary: 'HotelTime รอบเก็บตก (15:00 / 18:00)', cron: '0 0 15,18 * * *' },
];

class SetupError extends Error {}

function baseUrl() {
  const i = process.argv.indexOf('--base');
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1].replace(/\/$/, '');
  // WM_PORT: environment ก่อน แล้ว windmill/.env (docker compose อ่านจากที่เดียวกัน) — ยอมรับ "9000" / '9000' / export WM_PORT=9000
  const env = existsSync(path.join(HERE, '.env')) ? readFileSync(path.join(HERE, '.env'), 'utf8') : '';
  const port = process.env.WM_PORT ?? /^(?:export\s+)?WM_PORT=["']?(\d+)["']?\s*$/m.exec(env)?.[1] ?? '8000';
  return `http://127.0.0.1:${port}`;
}
const BASE = baseUrl();

async function call(method, route, { token, body, okStatuses = [200, 201] } = {}) {
  const res = await fetch(`${BASE}/api${route}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!okStatuses.includes(res.status)) {
    throw new SetupError(`Windmill ตอบ ${res.status} ที่ ${method} ${route}: ${text.slice(0, 200)}`);
  }
  return text;
}
const json = async (method, route, opts) => JSON.parse(await call(method, route, opts));

async function waitForServer() {
  const deadline = Date.now() + 180_000; // เปิดครั้งแรก db + migration อาจนานเป็นนาที
  for (;;) {
    try {
      const v = await call('GET', '/version');
      return v.trim();
    } catch {
      if (Date.now() > deadline) throw new SetupError(`ต่อ Windmill ที่ ${BASE} ไม่ได้ภายใน 3 นาที — เปิดอยู่ไหม? (cd windmill && docker compose ps)`);
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
}

async function login(password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password }),
  });
  return res.ok ? (await res.text()).trim() : null;
}

/** คืน token ของ admin พร้อมรหัสที่ไม่ใช่ค่าเริ่มต้น — สร้าง/ใช้ .admin-password */
async function adminToken(report) {
  // ไฟล์ว่าง = ไม่มีรหัส (|| ไม่ใช่ ??) · บังคับ 600 ทุกรอบ — ข้อความ error ด้านล่างบอกให้คนสร้างไฟล์เอง ซึ่งจะได้ 644
  const saved = existsSync(PASSWORD_FILE) ? readFileSync(PASSWORD_FILE, 'utf8').trim() || null : null;
  if (existsSync(PASSWORD_FILE)) chmodSync(PASSWORD_FILE, 0o600);
  if (saved) {
    const token = await login(saved);
    if (token) return token;
  }
  const fresh = await login(DEFAULT_PASSWORD);
  if (!fresh) {
    throw new SetupError(
      saved
        ? `ล็อกอิน ${ADMIN_EMAIL} ด้วยรหัสใน windmill/.admin-password ไม่ได้ — มีคนเปลี่ยนรหัสในหน้าเว็บ? ใส่รหัสปัจจุบันลงไฟล์นั้น (บรรทัดเดียว) แล้วรันใหม่`
        : `รหัส ${ADMIN_EMAIL} ไม่ใช่ค่าเริ่มต้นแล้ว แต่ไม่มีไฟล์ windmill/.admin-password — ใส่รหัสปัจจุบันลงไฟล์นั้น (บรรทัดเดียว) แล้วรันใหม่`,
    );
  }
  // รหัสยังเป็น changeme: ใช้รหัสในไฟล์ถ้ามี (รอบก่อนเขียนไฟล์แล้วแต่ตั้งรหัสไม่สำเร็จ) ไม่งั้นสุ่มใหม่แล้วเขียนไฟล์ก่อน
  const password = saved ?? randomBytes(24).toString('base64url');
  if (!saved) writeFileSync(PASSWORD_FILE, `${password}\n`, { mode: 0o600 }); // ไฟล์ว่างทับได้ — ไม่มีรหัสอยู่ในนั้น
  await call('POST', '/users/setpassword', { token: fresh, body: { password } });
  const token = await login(password);
  if (!token) throw new SetupError('เปลี่ยนรหัส admin แล้วแต่ล็อกอินด้วยรหัสใหม่ไม่ได้ — ถ่ายรูปหน้าจอนี้ส่งผู้ดูแลระบบ');
  report('เปลี่ยนรหัส admin จากค่าเริ่มต้นแล้ว — รหัสใหม่อยู่ใน windmill/.admin-password (อ่าน: cat windmill/.admin-password)');
  return token;
}

async function ensureWorkerTag(token, report) {
  // เติม tag ที่ขาด ไม่ทับ tag/ค่าอื่นที่ผู้ดูแลตั้งเพิ่มเองในหน้าเว็บ
  const current = await json('GET', `/configs/get/${WORKER_GROUP}`, { token });
  const tags = current?.worker_tags ?? [];
  if (tags.includes(TAG)) return;
  const keep = Object.fromEntries(Object.entries(current ?? {}).filter(([, v]) => v !== null));
  await call('POST', `/configs/update/${WORKER_GROUP}`, { token, body: { ...keep, worker_tags: [...tags, TAG] } });
  report(`worker group "custom" ฟัง tag ${TAG}`);
}

async function ensureScript(token, scriptPath, job, report) {
  const content = readFileSync(path.join(HERE, 'scripts', `${job.name}.sh`), 'utf8');
  const wanted = { path: scriptPath, summary: job.summary, description: '', content, language: 'bash', tag: TAG };
  const exists = await json('GET', `/w/${WORKSPACE}/scripts/exists/p/${scriptPath}`, { token });
  if (!exists) {
    await call('POST', `/w/${WORKSPACE}/scripts/create`, { token, body: wanted });
    report(`สร้างสคริปต์ ${scriptPath}`);
    return;
  }
  const current = await json('GET', `/w/${WORKSPACE}/scripts/get/p/${scriptPath}`, { token });
  if (current.content === content && current.language === 'bash' && current.tag === TAG) return;
  await call('POST', `/w/${WORKSPACE}/scripts/create`, { token, body: { ...wanted, parent_hash: current.hash } });
  report(`deploy สคริปต์ ${scriptPath} เวอร์ชันใหม่ (เนื้อหาใน repo เปลี่ยน)`);
}

async function ensureSchedule(token, scriptPath, job, who, report) {
  const exists = await json('GET', `/w/${WORKSPACE}/schedules/exists/${scriptPath}`, { token });
  if (!exists) {
    await call('POST', `/w/${WORKSPACE}/schedules/create`, {
      token,
      body: { path: scriptPath, schedule: job.cron, timezone: TIMEZONE, script_path: scriptPath, is_flow: false, args: {}, enabled: true },
    });
    report(`ตั้งเวลา ${scriptPath}: ${job.cron} (${TIMEZONE})`);
    return;
  }
  const current = await json('GET', `/w/${WORKSPACE}/schedules/get/${scriptPath}`, { token });
  if (current.schedule !== job.cron || current.timezone !== TIMEZONE || current.permissioned_as !== `u/${who}`) {
    await call('POST', `/w/${WORKSPACE}/schedules/update/${scriptPath}`, { token, body: { schedule: job.cron, timezone: TIMEZONE, args: {} } });
    report(`แก้เวลา ${scriptPath}: ${job.cron} (${TIMEZONE}) · ผูกกับผู้ใช้ ${who}`);
  }
  if (!current.enabled) {
    await call('POST', `/w/${WORKSPACE}/schedules/setenabled/${scriptPath}`, { token, body: { enabled: true } });
    report(`เปิดใช้ schedule ${scriptPath}`);
  }
}

async function main() {
  const changes = [];
  const report = (line) => {
    changes.push(line);
    console.log(`   ✔ ${line}`);
  };
  console.log(`ตั้งค่า Windmill ที่ ${BASE}`);
  console.log(`   Windmill ${await waitForServer()}`);
  const token = await adminToken(report);
  const who = (await json('GET', `/w/${WORKSPACE}/users/whoami`, { token })).username;
  await ensureWorkerTag(token, report);
  for (const job of JOBS) {
    const scriptPath = `u/${who}/${job.name}`;
    await ensureScript(token, scriptPath, job, report);
    await ensureSchedule(token, scriptPath, job, who, report);
  }
  console.log(changes.length === 0 ? '   ✔ ไม่มีอะไรเปลี่ยน — ตั้งค่าไว้ครบอยู่แล้ว' : `   เปลี่ยน ${changes.length} อย่าง`);
  console.log(`   HotelTime จะรันเองทุกวัน 12:00 (เก็บตก 15:00 / 18:00) · ดูประวัติการรันที่ ${BASE}/runs (ล็อกอิน ${ADMIN_EMAIL})`);
}

try {
  await main();
} catch (err) {
  console.error(`   ✘ ${err instanceof SetupError ? err.message : `ตั้งค่า Windmill ไม่สำเร็จ: ${err?.message ?? err}`}`);
  console.error('     แก้แล้วรันคำสั่งเดิมซ้ำได้เลย — ส่วนที่ตั้งไปแล้วจะไม่ทำซ้ำ');
  process.exitCode = 1;
}
