import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayCsvTargets, planLegacyMigration, type LegacyFile } from '../src/migration/plan.ts';

// ticket 05 ของ exporter-daily-expansion-and-data-store — ย้าย downloads*/ เดิมเข้าคลัง data/ (ADR-0005)

const f = (path: string, sha: string): LegacyFile => ({ path, sha256: sha, bytes: 10 });

const MANIFESTS = new Map([
  ['downloads-archive/2026-10-01', new Map([
    ['reservations-search', { from: '2026-09-29', to: '2026-10-01' }],
    ['arrivals', { from: '2026-10-01', to: '2026-10-01' }],
  ])],
  ['downloads-archive/2026-10-02', new Map([
    ['reservations-search', { from: '2026-09-30', to: '2026-10-02' }],
  ])],
]);

test('แต่ละวันของ archive กลายเป็นโฟลเดอร์รายวันของวันนั้น — ไฟล์ดิบไป _raw/ และ CSV ได้ชื่อตามช่วงข้อมูลจริง', () => {
  const plan = planLegacyMigration([
    f('downloads-archive/2026-10-01/raw/arrivals/2026-10-01_2026-10-01.xlsx', 'a1'),
    f('downloads-archive/2026-10-01/raw/arrivals/manifest.json', 'm1'),
    f('downloads-archive/2026-10-01/arrivals-2026.csv', 'c1'),
    f('downloads-archive/2026-10-01/reservations-search-2026.csv', 'c2'),
  ], MANIFESTS);
  assert.deepEqual(plan.copies, [
    { from: 'downloads-archive/2026-10-01/arrivals-2026.csv', to: 'data/hoteltime/daily/2026-10/2026-10-01/2026-10-01__arrivals.csv' },
    { from: 'downloads-archive/2026-10-01/raw/arrivals/2026-10-01_2026-10-01.xlsx', to: 'data/hoteltime/daily/2026-10/2026-10-01/_raw/arrivals/2026-10-01_2026-10-01.xlsx' },
    { from: 'downloads-archive/2026-10-01/raw/arrivals/manifest.json', to: 'data/hoteltime/daily/2026-10/2026-10-01/_raw/arrivals/manifest.json' },
    { from: 'downloads-archive/2026-10-01/reservations-search-2026.csv', to: 'data/hoteltime/daily/2026-10/2026-10-01/2026-09-29_2026-10-01__reservations-search.csv' },
  ]);
});

test('ไฟล์รายวันของแต่ละวันเก็บครบทุกวัน แม้ sha จะเหมือนวันก่อน — โฟลเดอร์ของวันต้องสมบูรณ์ในตัวเอง', () => {
  const plan = planLegacyMigration([
    f('downloads-archive/2026-10-01/raw/reservations-search/x.xlsx', 'same'),
    f('downloads-archive/2026-10-02/raw/reservations-search/x.xlsx', 'same'),
  ], MANIFESTS);
  assert.equal(plan.copies.length, 2);
  assert.equal(plan.duplicates.length, 0);
});

test('CSV ปีเก่าที่ค้างจาก back-fill (ก๊อปซ้ำทุกวัน) เหลือชุดเดียวใน backfill/ ตามวันแรกที่เจอ', () => {
  const plan = planLegacyMigration([
    f('downloads-archive/2026-10-01/reservations-search-2024.csv', 's24'),
    f('downloads-archive/2026-10-02/reservations-search-2024.csv', 's24'),
  ], MANIFESTS);
  assert.deepEqual(plan.copies, [
    { from: 'downloads-archive/2026-10-01/reservations-search-2024.csv', to: 'data/hoteltime/backfill/legacy-2026-10-01/reservations-search-2024.csv' },
  ]);
  assert.deepEqual(plan.duplicates, [
    { from: 'downloads-archive/2026-10-02/reservations-search-2024.csv', sameAs: 'data/hoteltime/backfill/legacy-2026-10-01/reservations-search-2024.csv' },
  ]);
});

test('CSV ปีเก่าที่เนื้อหาเปลี่ยน (back-fill รอบใหม่) — เก็บทุกฉบับ คนละโฟลเดอร์ ไม่ทับกัน', () => {
  const plan = planLegacyMigration([
    f('downloads-archive/2026-10-01/reservations-search-2024.csv', 'v1'),
    f('downloads-archive/2026-10-02/reservations-search-2024.csv', 'v2'),
  ], MANIFESTS);
  assert.deepEqual(plan.copies.map((c) => c.to), [
    'data/hoteltime/backfill/legacy-2026-10-01/reservations-search-2024.csv',
    'data/hoteltime/backfill/legacy-2026-10-02/reservations-search-2024.csv',
  ]);
});

test('FoodStory รายเดือนที่ถูกก๊อปไปทุกวัน เหลือชุดเดียวใน foodstory/monthly/ · ฉบับที่ต่างกันได้โฟลเดอร์รอบใหม่', () => {
  const plan = planLegacyMigration([
    f('downloads-archive/2026-10-01/foodstory/2026-08/2026-08__sales__salebydate.xlsx', 'fs1'),
    f('downloads-archive/2026-10-02/foodstory/2026-08/2026-08__sales__salebydate.xlsx', 'fs1'),
    f('downloads-archive/2026-10-03/foodstory/2026-08/2026-08__sales__salebydate.xlsx', 'fs2'),
  ], MANIFESTS);
  assert.deepEqual(plan.copies.map((c) => c.to), [
    'data/foodstory/monthly/2026-08/2026-08__sales__salebydate.xlsx',
    'data/foodstory/monthly/2026-08__2026-10-03/2026-08__sales__salebydate.xlsx',
  ]);
  assert.equal(plan.duplicates.length, 1);
});

test('ไฟล์จุกจิกไม่ย้าย · ไฟล์ที่ไม่รู้จักไป _unsorted/ (ไม่มีอะไรหาย)', () => {
  const plan = planLegacyMigration([
    f('downloads-archive/2026-10-01/.DS_Store', 'x'),
    f('downloads-archive/2026-10-01/raw/.DS_Store', 'y'),
    f('downloads/.gitkeep', 'z'),
    f('downloads-archive/2026-09-22/data_csv.zip', 'zip'),
    f('downloads-archive/2026-09-22/foodstory/order-recon.xlsx', 'rec'),
  ], MANIFESTS);
  assert.deepEqual(plan.ignored.map((i) => i.from).sort(), [
    'downloads-archive/2026-10-01/.DS_Store',
    'downloads-archive/2026-10-01/raw/.DS_Store',
    'downloads/.gitkeep',
  ]);
  assert.deepEqual(plan.copies.map((c) => c.to), [
    'data/_unsorted/downloads-archive/2026-09-22/data_csv.zip',
    'data/_unsorted/downloads-archive/2026-09-22/foodstory/order-recon.xlsx',
  ]);
});

test('downloads/ ปัจจุบัน: ไฟล์ที่ sha ซ้ำกับของที่ย้ายแล้วนับเป็นสำเนา · ที่เหลือไป _unsorted/downloads/', () => {
  const plan = planLegacyMigration([
    f('downloads-archive/2026-10-01/raw/arrivals/x.xlsx', 'a'),
    f('downloads/raw/arrivals/x.xlsx', 'a'),
    f('downloads/raw/arrivals/y.xlsx', 'new'),
  ], MANIFESTS);
  assert.deepEqual(plan.duplicates, [
    { from: 'downloads/raw/arrivals/x.xlsx', sameAs: 'data/hoteltime/daily/2026-10/2026-10-01/_raw/arrivals/x.xlsx' },
  ]);
  assert.equal(plan.copies.at(-1)?.to, 'data/_unsorted/downloads/raw/arrivals/y.xlsx');
});

test('รันซ้ำได้: ปลายทางที่มีอยู่แล้วและ sha ตรงกันข้ามไป · sha ไม่ตรงคือ conflict ห้ามทับ', () => {
  const files = [
    f('downloads-archive/2026-10-01/raw/arrivals/x.xlsx', 'a'),
    f('downloads-archive/2026-10-01/raw/arrivals/y.xlsx', 'b'),
  ];
  const existing = new Map([
    ['data/hoteltime/daily/2026-10/2026-10-01/_raw/arrivals/x.xlsx', 'a'],
    ['data/hoteltime/daily/2026-10/2026-10-01/_raw/arrivals/y.xlsx', 'DIFFERENT'],
  ]);
  const plan = planLegacyMigration(files, MANIFESTS, existing);
  assert.deepEqual(plan.copies, []);
  assert.equal(plan.alreadyThere.length, 1);
  assert.deepEqual(plan.conflicts.map((c) => c.from), ['downloads-archive/2026-10-01/raw/arrivals/y.xlsx']);
});

test('ไฟล์ทดลองของ FoodStory ที่ก๊อปซ้ำทุกวัน เหลือชุดเดียวในโฟลเดอร์ของวันแรกที่เจอ (รู้ว่ามาจากวันไหน)', () => {
  const plan = planLegacyMigration([
    f('downloads-archive/2026-09-22/foodstory/order-recon.xlsx', 'rec'),
    f('downloads-archive/2026-09-23/foodstory/order-recon.xlsx', 'rec'),
  ], MANIFESTS);
  assert.deepEqual(plan.copies.map((c) => c.to), ['data/_unsorted/downloads-archive/2026-09-22/foodstory/order-recon.xlsx']);
  assert.equal(plan.duplicates.length, 1);
});

test('สองไฟล์ที่ได้ปลายทางเดียวกัน (เนื้อหาต่าง) เป็น conflict ไม่ใช่ทับกัน', () => {
  // ไม่ควรเกิดกับโครงจริง แต่ถ้าเกิด (เช่น กฎใหม่ที่พลาด) ต้องหยุดที่แผน ไม่ใช่ไปพังกลาง --apply
  const plan = planLegacyMigration([
    f('downloads-backfill/2026-10-01_000000/a.csv', 'x'),
    f('downloads-backfill/2026-10-01_000000/a.csv', 'y'),
  ], MANIFESTS);
  assert.equal(plan.copies.length, 1);
  assert.deepEqual(plan.conflicts.map((c) => c.to), ['data/hoteltime/backfill/2026-10-01_000000/a.csv']);
});

test('CSV ที่บันทึกผลรอบของวันหนึ่งอ้างถึง = เฉพาะ CSV รายวันในโฟลเดอร์ของวันนั้น ไม่รวม CSV ปีเก่าที่ย้ายไป backfill/', () => {
  const plan = planLegacyMigration([
    f('downloads-archive/2026-10-01/reservations-search-2024.csv', 'old'),
    f('downloads-archive/2026-10-01/reservations-search-2026.csv', 'new'),
  ], MANIFESTS);
  assert.deepEqual(dayCsvTargets(plan, '2026-10-01', 'reservations-search'), [
    'data/hoteltime/daily/2026-10/2026-10-01/2026-09-29_2026-10-01__reservations-search.csv',
  ]);
});

test('CSV ของวันที่ย้ายมาแล้วในรอบก่อน (alreadyThere) ยังถูกนับในบันทึกผลรอบ — รันซ้ำหลังสะดุดได้ผลเหมือนเดิม', () => {
  const files = [f('downloads-archive/2026-10-01/arrivals-2026.csv', 'c1')];
  const plan = planLegacyMigration(files, MANIFESTS, new Map([
    ['data/hoteltime/daily/2026-10/2026-10-01/2026-10-01__arrivals.csv', 'c1'],
  ]));
  assert.deepEqual(dayCsvTargets(plan, '2026-10-01', 'arrivals'), ['data/hoteltime/daily/2026-10/2026-10-01/2026-10-01__arrivals.csv']);
});
