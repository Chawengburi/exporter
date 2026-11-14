import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// ticket 02 (exporter-ubuntu-deploy): place the double-click file on the Desktop with a single command — macOS = a symlink to the .command,
// Ubuntu = a .desktop file (Terminal=true) · runs the real script with HOME pointed at a temporary folder (the real Desktop is not touched) — the same test suite runs on
// a Mac and in a Linux container, with the checks depending on process.platform
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

test('places the double-click file on the Desktop pointing back at this folder\'s launchers/foodstory-daily.command · safe to re-run', async () => {
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
    assert.ok(((await stat(file)).mode & 0o111) !== 0, 'the .desktop file must be executable, otherwise GNOME refuses to open it');
    assert.ok(existsSync(path.join(home, '.local', 'share', 'applications', 'foodstory-daily.desktop')), 'it must also be in the app menu');
  }
  const again = install(home);
  assert.equal(again.code, 0, again.out);
});

test('a file with the same name on the Desktop that is not ours: not overwritten, tells the user to delete it themselves', async () => {
  const home = await fakeHome();
  const desktop = path.join(home, 'Desktop');
  await mkdir(desktop, { recursive: true });
  const other = path.join(desktop, process.platform === 'darwin' ? `${NAME}.command` : `${NAME}.desktop`);
  await writeFile(other, 'someone else\n');
  const { code, out } = install(home);
  assert.equal(code, 1);
  assert.match(out, /already exists/);
  assert.equal(await readFile(other, 'utf8'), 'someone else\n');
});

test('a leftover symlink with the same name on the Desktop (pointing elsewhere): not written through to create a file at the target', async () => {
  const { symlink } = await import('node:fs/promises');
  const home = await fakeHome();
  const desktop = path.join(home, 'Desktop');
  await mkdir(desktop, { recursive: true });
  const elsewhere = path.join(home, 'elsewhere.txt');
  await symlink(elsewhere, path.join(desktop, process.platform === 'darwin' ? `${NAME}.command` : `${NAME}.desktop`));
  const { code, out } = install(home);
  assert.equal(code, 1);
  assert.match(out, /already exists/);
  assert.equal(existsSync(elsewhere), false);
});

test('macOS: our own existing symlink pointing at the repo\'s old location (the folder was moved) -> repointed to the new one', { skip: process.platform !== 'darwin' }, async () => {
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

test('Linux: the app menu has a file with the same name that is not ours -> nothing is placed anywhere (no half installs)', { skip: process.platform === 'darwin' }, async () => {
  const home = await fakeHome();
  const apps = path.join(home, '.local', 'share', 'applications');
  await mkdir(apps, { recursive: true });
  await writeFile(path.join(apps, 'foodstory-daily.desktop'), 'someone else\n');
  const { code } = install(home);
  assert.equal(code, 1);
  assert.equal(existsSync(path.join(home, 'Desktop', `${NAME}.desktop`)), false);
});
