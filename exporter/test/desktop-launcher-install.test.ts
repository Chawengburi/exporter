import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// ticket 02 (exporter-ubuntu-deploy): วางไฟล์ดับเบิลคลิกบน Desktop ด้วยคำสั่งเดียว — macOS = symlink ไป .command,
// Ubuntu = ไฟล์ .desktop (Terminal=true) · รันสคริปต์จริงโดยชี้ HOME ไปโฟลเดอร์ชั่วคราว (ไม่แตะ Desktop จริง) — test ชุดเดียวรันได้ทั้งบน
// Mac และใน container Linux ผลที่ตรวจตาม process.platform
const LAUNCHERS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'launchers');
const INSTALL = path.join(LAUNCHERS, 'install-desktop-launcher.sh');
const TARGET = path.join(LAUNCHERS, 'foodstory-daily.command');
const NAME = 'Exporter - FoodStory Daily';

const homes: string[] = [];
after(async () => {
  for (const h of homes) await rm(h, { recursive: true, force: true });
});
async function fakeHome(): Promise<string> {
  const h = await mkdtemp(path.join(tmpdir(), 'fs-home-'));
  homes.push(h);
  return h;
}
function install(home: string): { code: number | null; out: string } {
  const r = spawnSync('bash', [INSTALL], { encoding: 'utf8', env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test('วางไฟล์ดับเบิลคลิกบน Desktop ที่ชี้กลับมาที่ launchers/foodstory-daily.command ของโฟลเดอร์นี้ · รันซ้ำได้', async () => {
  const home = await fakeHome();
  const first = install(home);
  assert.equal(first.code, 0, first.out);
  const desktop = path.join(home, 'Desktop');
  if (process.platform === 'darwin') {
    const link = path.join(desktop, `${NAME}.command`);
    assert.ok((await lstat(link)).isSymbolicLink());
    assert.equal(await readlink(link), TARGET);
  } else {
    const file = path.join(desktop, `${NAME}.desktop`);
    const entry = await readFile(file, 'utf8');
    assert.match(entry, /^\[Desktop Entry\]$/m);
    assert.match(entry, /^Type=Application$/m);
    assert.match(entry, new RegExp(`^Name=${NAME}$`, 'm'));
    assert.match(entry, /^Terminal=true$/m);
    assert.ok(entry.includes(`Exec=bash "${TARGET}"`), entry);
    assert.ok(((await stat(file)).mode & 0o111) !== 0, 'ไฟล์ .desktop ต้อง executable ไม่งั้น GNOME ไม่ยอมเปิด');
    assert.ok(existsSync(path.join(home, '.local', 'share', 'applications', 'foodstory-daily.desktop')), 'ต้องอยู่ในเมนูแอปด้วย');
  }
  const again = install(home);
  assert.equal(again.code, 0, again.out);
});

test('มีไฟล์ชื่อเดียวกันบน Desktop ที่ไม่ใช่ของเรา: ไม่เขียนทับ บอกให้ลบเอง', async () => {
  const home = await fakeHome();
  const desktop = path.join(home, 'Desktop');
  await mkdir(desktop, { recursive: true });
  const other = path.join(desktop, process.platform === 'darwin' ? `${NAME}.command` : `${NAME}.desktop`);
  await writeFile(other, 'ของคนอื่น\n');
  const { code, out } = install(home);
  assert.equal(code, 1);
  assert.match(out, /มีไฟล์ชื่อนี้อยู่แล้ว/);
  assert.equal(await readFile(other, 'utf8'), 'ของคนอื่น\n');
});

test('มี symlink ค้างชื่อเดียวกันบน Desktop (ชี้ไปที่อื่น): ไม่เขียนทะลุ symlink ไปสร้างไฟล์ที่ปลายทาง', async () => {
  const { symlink } = await import('node:fs/promises');
  const home = await fakeHome();
  const desktop = path.join(home, 'Desktop');
  await mkdir(desktop, { recursive: true });
  const elsewhere = path.join(home, 'elsewhere.txt');
  await symlink(elsewhere, path.join(desktop, process.platform === 'darwin' ? `${NAME}.command` : `${NAME}.desktop`));
  const { code, out } = install(home);
  assert.equal(code, 1);
  assert.match(out, /มีไฟล์ชื่อนี้อยู่แล้ว/);
  assert.equal(existsSync(elsewhere), false);
});

test('macOS: symlink เดิมของเราที่ชี้ไป repo ตำแหน่งเก่า (ย้ายโฟลเดอร์) → เปลี่ยนให้ชี้ที่ใหม่', { skip: process.platform !== 'darwin' }, async () => {
  const { symlink } = await import('node:fs/promises');
  const home = await fakeHome();
  const desktop = path.join(home, 'Desktop');
  await mkdir(desktop, { recursive: true });
  const link = path.join(desktop, `${NAME}.command`);
  await symlink('/old/place/exporter/launchers/foodstory-daily.command', link);
  const { code, out } = install(home);
  assert.equal(code, 0, out);
  assert.equal(await readlink(link), TARGET);
});

test('Linux: เมนูแอปมีไฟล์ชื่อเดียวกันที่ไม่ใช่ของเรา → ไม่วางอะไรเลยสักที่ (ไม่ติดตั้งครึ่งเดียว)', { skip: process.platform === 'darwin' }, async () => {
  const home = await fakeHome();
  const apps = path.join(home, '.local', 'share', 'applications');
  await mkdir(apps, { recursive: true });
  await writeFile(path.join(apps, 'foodstory-daily.desktop'), 'ของคนอื่น\n');
  const { code } = install(home);
  assert.equal(code, 1);
  assert.equal(existsSync(path.join(home, 'Desktop', `${NAME}.desktop`)), false);
});
