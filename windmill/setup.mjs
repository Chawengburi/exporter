#!/usr/bin/env node
/**
 * Sets Windmill up to run HotelTime and FoodStory every day — replaces clicking through the web UI as in INSTALL.md steps 4–6 (step 3, `docker compose up -d`, still comes first)
 * (ticket 03 of exporter-ubuntu-deploy · FoodStory: ticket 04 of exporter-foodstory-scheduled-daily)
 *
 *   node windmill/setup.mjs                 <- after `docker compose up -d` · safe to re-run (nothing changed = nothing touched)
 *   node windmill/setup.mjs --base http://127.0.0.1:18000
 *
 * Does 4 things through the REST API (tested against Windmill CE 1.815.0, pinned in .env.example):
 *  1. Changes the admin@windmill.dev password from the default `changeme` to a random one, kept in windmill/.admin-password (600, not in git) —
 *     the file is written first and the password changed afterwards (changed but file not written = locked out) · if the file exists but the password is still changeme, use the password in the file
 *  2. the worker group "custom" listens on the tag `chromium` (the worker that has Chromium + the exporter/ mount)
 *  3. the scripts `u/<who set it up>/pms_export_daily`, `foodstory_export_daily` and the `..._catchup` ones for each Site — content from windmill/scripts/*.sh
 *     (edit the file in the repo and re-run = a new version is deployed)
 *  4. schedules at noon and 15:00/18:00 (Asia/Bangkok) — the same times for both Sites (there is a single chromium worker, so jobs queue one after another) — permissioned_as is always the user who runs this script (a trap noted in INSTALL.md §6: if the original user
 *     was deleted the schedule fails silently — re-running fixes it)
 *
 * Never prints tokens/passwords to the screen
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PASSWORD_FILE = path.join(HERE, '.admin-password');
// a machine whose admin email has been changed sets WM_ADMIN_EMAIL=... when running this · a new machine uses Windmill's default
const ADMIN_EMAIL = process.env.WM_ADMIN_EMAIL ?? 'admin@windmill.dev';
const DEFAULT_PASSWORD = 'changeme';
const WORKSPACE = 'admins';
const WORKER_GROUP = 'worker__custom';
const TAG = 'chromium';
const TIMEZONE = 'Asia/Bangkok';
// Time cap of the FoodStory job (seconds), set on the script itself rather than relying on Windmill's default: a normal run takes about 5 minutes + about 3 minutes per missing day (at most 3 days) +
// login/captcha solving (3 retries) — about 20 minutes in the heavy case, 1 hour allowed · HotelTime takes under 15 minutes and sets none (the existing behaviour)
const FOODSTORY_TIMEOUT_S = 3600;
// Data pipeline (hoteltime-schema) timeout: 1 hour. Normally a few minutes; not yet measured against the real D1.
const PIPELINE_TIMEOUT_S = 3600;
// Both Sites use the same times — status/Discord use a single set of time rules (core/status.ts: deadline 15:00 / the last run is evaluated at 18:30)
const DAILY_CRON = '0 0 12 * * *';
const CATCHUP_CRON = '0 0 15,18 * * *';
const JOBS = [
  { name: 'pms_export_daily', summary: 'HotelTime daily run (noon)', cron: DAILY_CRON },
  { name: 'pms_export_daily_catchup', summary: 'HotelTime catch-up run (15:00 / 18:00)', cron: CATCHUP_CRON },
  { name: 'foodstory_export_daily', summary: 'FoodStory daily run (noon)', cron: DAILY_CRON, timeout: FOODSTORY_TIMEOUT_S },
  { name: 'foodstory_export_daily_catchup', summary: 'FoodStory catch-up run (15:00 / 18:00)', cron: CATCHUP_CRON, timeout: FOODSTORY_TIMEOUT_S },
];
// Data pipeline (hoteltime-schema): registered only when the pipeline bundle is installed (../pipeline/.env exists); otherwise the jobs would fail red every day.
// After installing the bundle later, run setup.mjs again to register them. 19:00 = after the 15:00/18:00 catch-up runs and the 18:30 status. Full Silver check: Sunday 20:00.
// The chromium worker is a single one and jobs queue behind each other: if the 18:00 FoodStory run takes almost an hour, the pipeline may start a little after 19:00. That is fine.
const PIPELINE_ENV = path.join(HERE, '..', 'pipeline', '.env');
const PIPELINE_JOBS = [
  { name: 'ht_pipeline_daily', summary: 'HotelTime data pipeline Bronze→Silver→Gold→D1 (19:00)', cron: '0 0 19 * * *', timeout: PIPELINE_TIMEOUT_S },
  { name: 'ht_pipeline_weekly_verify', summary: 'Full check of Silver against every source xlsx (Sunday 20:00)', cron: '0 0 20 * * 0', timeout: PIPELINE_TIMEOUT_S },
];

class SetupError extends Error {}

function baseUrl() {
  const i = process.argv.indexOf('--base');
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1].replace(/\/$/, '');
  // WM_PORT: the environment first, then windmill/.env (docker compose reads from the same place) — accepts "9000" / '9000' / export WM_PORT=9000
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
    throw new SetupError(`Windmill answered ${res.status} at ${method} ${route}: ${text.slice(0, 200)}`);
  }
  return text;
}
const json = async (method, route, opts) => JSON.parse(await call(method, route, opts));

async function waitForServer() {
  const deadline = Date.now() + 180_000; // on the first start, the db + migration can take minutes
  for (;;) {
    try {
      const v = await call('GET', '/version');
      return v.trim();
    } catch {
      if (Date.now() > deadline) throw new SetupError(`Could not reach Windmill at ${BASE} within 3 minutes — is it running? (cd windmill && docker compose ps)`);
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

/** Returns the admin token together with a non-default password — creates/uses .admin-password */
async function adminToken(report) {
  // an empty file = no password (|| not ??) · force 600 every time — the error messages below tell a person to create the file themselves, which would give 644
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
        ? `Could not log in as ${ADMIN_EMAIL} with the password in windmill/.admin-password — did someone change the password in the web UI? Put the current password in that file (a single line) and run again`
        : `The password of ${ADMIN_EMAIL} is no longer the default, but there is no windmill/.admin-password file — put the current password in that file (a single line) and run again`,
    );
  }
  // the password is still changeme: use the password in the file if there is one (a previous run wrote the file but failed to set the password), otherwise generate a new one and write the file first
  const password = saved ?? randomBytes(24).toString('base64url');
  if (!saved) writeFileSync(PASSWORD_FILE, `${password}\n`, { mode: 0o600 }); // an empty file can be overwritten — there is no password in it
  await call('POST', '/users/setpassword', { token: fresh, body: { password } });
  const token = await login(password);
  if (!token) throw new SetupError('Changed the admin password but could not log in with the new one — take a screenshot of this screen and send it to the administrator');
  report('Changed the admin password from the default — the new password is in windmill/.admin-password (read it with: cat windmill/.admin-password)');
  return token;
}

async function ensureWorkerTag(token, report) {
  // add the missing tag, without overwriting other tags/values the administrator added in the web UI
  const current = await json('GET', `/configs/get/${WORKER_GROUP}`, { token });
  const tags = current?.worker_tags ?? [];
  if (tags.includes(TAG)) return;
  const keep = Object.fromEntries(Object.entries(current ?? {}).filter(([, v]) => v !== null));
  await call('POST', `/configs/update/${WORKER_GROUP}`, { token, body: { ...keep, worker_tags: [...tags, TAG] } });
  report(`the worker group "custom" now listens on the tag ${TAG}`);
}

async function ensureScript(token, scriptPath, job, report) {
  const content = readFileSync(path.join(HERE, 'scripts', `${job.name}.sh`), 'utf8');
  const wanted = { path: scriptPath, summary: job.summary, description: '', content, language: 'bash', tag: TAG, ...(job.timeout ? { timeout: job.timeout } : {}) };
  const exists = await json('GET', `/w/${WORKSPACE}/scripts/exists/p/${scriptPath}`, { token });
  if (!exists) {
    await call('POST', `/w/${WORKSPACE}/scripts/create`, { token, body: wanted });
    report(`Created the script ${scriptPath}`);
    return;
  }
  const current = await json('GET', `/w/${WORKSPACE}/scripts/get/p/${scriptPath}`, { token });
  if (current.content === content && current.language === 'bash' && current.tag === TAG && (current.timeout ?? null) === (job.timeout ?? null)) return;
  await call('POST', `/w/${WORKSPACE}/scripts/create`, { token, body: { ...wanted, parent_hash: current.hash } });
  report(`Deployed a new version of the script ${scriptPath} (the content in the repo changed)`);
}

async function ensureSchedule(token, scriptPath, job, who, report) {
  const exists = await json('GET', `/w/${WORKSPACE}/schedules/exists/${scriptPath}`, { token });
  if (!exists) {
    await call('POST', `/w/${WORKSPACE}/schedules/create`, {
      token,
      body: { path: scriptPath, schedule: job.cron, timezone: TIMEZONE, script_path: scriptPath, is_flow: false, args: {}, enabled: true },
    });
    report(`Set the schedule of ${scriptPath}: ${job.cron} (${TIMEZONE})`);
    return;
  }
  const current = await json('GET', `/w/${WORKSPACE}/schedules/get/${scriptPath}`, { token });
  if (current.schedule !== job.cron || current.timezone !== TIMEZONE || current.permissioned_as !== `u/${who}`) {
    await call('POST', `/w/${WORKSPACE}/schedules/update/${scriptPath}`, { token, body: { schedule: job.cron, timezone: TIMEZONE, args: {} } });
    report(`Updated the schedule of ${scriptPath}: ${job.cron} (${TIMEZONE}) · bound to user ${who}`);
  }
  if (!current.enabled) {
    await call('POST', `/w/${WORKSPACE}/schedules/setenabled/${scriptPath}`, { token, body: { enabled: true } });
    report(`Enabled the schedule of ${scriptPath}`);
  }
}

async function main() {
  const changes = [];
  const report = (line) => {
    changes.push(line);
    console.log(`   ✔ ${line}`);
  };
  console.log(`Setting up Windmill at ${BASE}`);
  console.log(`   Windmill ${await waitForServer()}`);
  const token = await adminToken(report);
  const who = (await json('GET', `/w/${WORKSPACE}/users/whoami`, { token })).username;
  await ensureWorkerTag(token, report);
  const pipelineInstalled = existsSync(PIPELINE_ENV);
  if (!pipelineInstalled) console.log('   - skipping the data pipeline jobs (pipeline/.env not found: install the pipeline bundle, then run this command again)');
  for (const job of [...JOBS, ...(pipelineInstalled ? PIPELINE_JOBS : [])]) {
    const scriptPath = `u/${who}/${job.name}`;
    await ensureScript(token, scriptPath, job, report);
    await ensureSchedule(token, scriptPath, job, who, report);
  }
  console.log(changes.length === 0 ? '   ✔ Nothing changed — everything is already set up' : `   Changed ${changes.length} thing(s)`);
  console.log(`   HotelTime and FoodStory will run by themselves every day at 12:00 (catch-up 15:00 / 18:00) · see the run history at ${BASE}/runs (log in as ${ADMIN_EMAIL})`);
}

try {
  await main();
} catch (err) {
  console.error(`   ✘ ${err instanceof SetupError ? err.message : `Setting up Windmill failed: ${err?.message ?? err}`}`);
  console.error('     Fix it and re-run the same command — what has already been set up will not be repeated');
  process.exitCode = 1;
}
