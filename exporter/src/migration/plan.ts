/**
 * แผนย้ายผลเดิมใน `downloads/` + `downloads-*` เข้าคลัง `data/` (ADR-0005) — ticket 05 ของ
 * `.scratch/exporter-daily-expansion-and-data-store/` · ฟังก์ชันล้วน ไม่แตะดิสก์ ผู้เรียกอ่านไฟล์ + sha256 มาให้
 *
 * กฎ:
 *  - แต่ละวันของ `downloads-archive/<วัน>/` → `data/hoteltime/daily/<เดือน>/<วัน>/` · ไฟล์ดิบไป `_raw/` · CSV ของรอบ
 *    รายวันได้ชื่อตามช่วงข้อมูลจริงจาก manifest · **เก็บครบทุกวันแม้ sha ซ้ำกับวันก่อน** เพราะโฟลเดอร์ของวันต้องสมบูรณ์
 *    ในตัวเอง (ไฟล์รายวันเล็กมาก ความบวมจริงมาจากสองกลุ่มข้างล่าง)
 *  - CSV ปีเก่าที่ค้างจาก back-fill (ก๊อปซ้ำทุกวัน) → `data/hoteltime/backfill/legacy-<วันแรกที่เจอฉบับนั้น>/` ชุดเดียว
 *  - FoodStory รายเดือนที่ก๊อปซ้ำทุกวัน → `data/foodstory/monthly/<เดือน>/` ชุดเดียว · ฉบับที่เนื้อหาต่างไปได้
 *    `monthly/<เดือน>__<วัน>/` ตามกฎดึงเดือนเดิมซ้ำ
 *  - ไฟล์จุกจิก (`.DS_Store`, `.gitkeep`) ไม่ย้าย · ไฟล์ที่ไม่รู้จักไป `data/_unsorted/` — ไม่มีอะไรหาย
 *  - `downloads/` ปัจจุบันทำทีหลังสุด: sha ซ้ำกับของที่วางแผนแล้ว = สำเนา · ที่เหลือไป `data/_unsorted/downloads/`
 *  - ปลายทางที่มีอยู่แล้ว: sha ตรง = ข้าม (รันซ้ำได้) · sha ไม่ตรง = conflict ห้ามทับ
 */

export type LegacyFile = { readonly path: string; readonly sha256: string; readonly bytes: number };
export type DayRanges = ReadonlyMap<string, ReadonlyMap<string, { readonly from: string; readonly to: string }>>;

type Move = { readonly from: string; readonly to: string };

export type MigrationPlan = {
  readonly copies: readonly Move[];
  readonly duplicates: readonly { readonly from: string; readonly sameAs: string }[];
  readonly ignored: readonly { readonly from: string; readonly reason: string }[];
  readonly alreadyThere: readonly Move[];
  /** ปลายทางมีไฟล์อยู่แล้วแต่ sha ไม่ตรง หรือสองไฟล์ในแผนได้ปลายทางเดียวกัน — มีแม้แต่รายการเดียว --apply ไม่ก๊อปอะไรเลย */
  readonly conflicts: readonly Move[];
};

/**
 * CSV รายวันที่บันทึกผลรอบของวันหนึ่งต้องอ้างถึง — ทั้งที่จะก๊อปและที่ย้ายมาแล้วในรอบก่อน · เลือกจากปลายทาง (อยู่ใน
 * โฟลเดอร์ของวันนั้น) ไม่ใช่ต้นทาง เพราะ CSV ปีเก่าในโฟลเดอร์ archive เดียวกันถูกย้ายไป backfill/
 */
export function dayCsvTargets(plan: MigrationPlan, day: string, report: string): string[] {
  const dayDir = `data/hoteltime/daily/${day.slice(0, 7)}/${day}/`;
  return [...plan.copies, ...plan.alreadyThere]
    .map((m) => m.to)
    .filter((to) => to.startsWith(dayDir) && !to.slice(dayDir.length).includes('/') && to.endsWith(`__${report}.csv`))
    .sort();
}

const JUNK = new Set(['.DS_Store', '.gitkeep']);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function span(from: string, to: string): string {
  return from === to ? from : `${from}_${to}`;
}

export function planLegacyMigration(
  files: readonly LegacyFile[],
  dayRanges: DayRanges,
  existing: ReadonlyMap<string, string> = new Map(),
): MigrationPlan {
  const copies: Move[] = [];
  const duplicates: { from: string; sameAs: string }[] = [];
  const ignored: { from: string; reason: string }[] = [];
  const alreadyThere: Move[] = [];
  const conflicts: Move[] = [];
  const targets = new Set<string>();
  /** sha → ปลายทางแรกที่วางแผนไว้ — ใช้จับสำเนาของ downloads/ ปัจจุบัน */
  const planned = new Map<string, string>();
  /** กลุ่มที่ตัดสำเนาซ้ำ: ชื่อหลัก → (sha → ปลายทางของฉบับนั้น) */
  const versions = new Map<string, Map<string, string>>();

  const emit = (file: LegacyFile, to: string) => {
    if (targets.has(to)) {
      conflicts.push({ from: file.path, to });
      return;
    }
    targets.add(to);
    if (!planned.has(file.sha256)) planned.set(file.sha256, to);
    const there = existing.get(to);
    if (there === file.sha256) alreadyThere.push({ from: file.path, to });
    else if (there !== undefined) conflicts.push({ from: file.path, to });
    else copies.push({ from: file.path, to });
  };
  const isJunk = (file: LegacyFile) => {
    if (!JUNK.has(file.path.slice(file.path.lastIndexOf('/') + 1))) return false;
    ignored.push({ from: file.path, reason: 'ไฟล์จุกจิกของระบบ' });
    return true;
  };

  /** ฉบับแรกได้ `first` · sha เดิมซ้ำ = สำเนา · ฉบับใหม่ที่เนื้อหาต่างได้ `nextVersion` */
  const dedupe = (file: LegacyFile, key: string, first: string, nextVersion: string) => {
    const seen = versions.get(key) ?? new Map<string, string>();
    versions.set(key, seen);
    const prior = seen.get(file.sha256);
    if (prior !== undefined) {
      duplicates.push({ from: file.path, sameAs: prior });
      return;
    }
    const to = seen.size === 0 ? first : nextVersion;
    seen.set(file.sha256, to);
    emit(file, to);
  };

  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const current = sorted.filter((f) => f.path.startsWith('downloads/'));

  for (const file of sorted.filter((f) => !f.path.startsWith('downloads/'))) {
    if (isJunk(file)) continue;
    const parts = file.path.split('/');
    const [root, second] = parts;

    if (root === 'downloads-backfill' && second !== undefined) {
      const rest = parts.slice(2).join('/').replace(/^raw\//, '_raw/');
      emit(file, `data/hoteltime/backfill/${second}/${rest}`);
      continue;
    }
    if (root === 'downloads-baseline') {
      const rest = parts.slice(1).join('/').replace(/^raw\//, '_raw/');
      emit(file, `data/hoteltime/baseline/legacy/${rest}`);
      continue;
    }
    if (root !== 'downloads-archive' || second === undefined || !DAY.test(second)) {
      emit(file, `data/_unsorted/${file.path}`);
      continue;
    }

    const day = second;
    const dayDir = `data/hoteltime/daily/${day.slice(0, 7)}/${day}`;
    const rest = parts.slice(2);

    if (rest[0] === 'raw' && rest.length === 3) {
      emit(file, `${dayDir}/_raw/${rest[1]}/${rest[2]}`);
      continue;
    }
    if (rest[0] === 'foodstory' && rest.length === 3 && /^\d{4}-\d{2}$/.test(rest[1]!)) {
      const month = rest[1]!;
      dedupe(file, `foodstory/${month}/${rest[2]}`,
        `data/foodstory/monthly/${month}/${rest[2]}`,
        `data/foodstory/monthly/${month}__${day}/${rest[2]}`);
      continue;
    }
    if (rest[0] === 'foodstory' && rest.length === 2) {
      // ไฟล์ทดลองตอนพัฒนา FoodStory (`*-recon.xlsx` ฯลฯ) ที่ติดมากับการก๊อปทุกวัน — ไม่ใช่ผล export จริง แต่ไม่ทิ้ง
      // · เก็บในโฟลเดอร์ของวันที่เจอฉบับนั้นครั้งแรก ให้รู้ว่ามาจากวันไหน
      const target = `data/_unsorted/downloads-archive/${day}/foodstory/${rest[1]}`;
      dedupe(file, `foodstory-loose/${rest[1]}`, target, target);
      continue;
    }
    const csv = rest.length === 1 ? /^(.+)-(\d{4})\.csv$/.exec(rest[0]!) : null;
    if (csv) {
      const [, report, yearText] = csv;
      const range = dayRanges.get(`downloads-archive/${day}`)?.get(report!);
      const year = yearText!;
      if (range && range.from.slice(0, 4) <= year && year <= range.to.slice(0, 4)) {
        // CSV ของรอบรายวันวันนั้น — ช่วงในชื่อคือส่วนของปีนั้นที่อยู่ในช่วงที่ขอ (แบบเดียวกับรอบใหม่)
        const from = range.from.slice(0, 4) === year ? range.from : `${year}-01-01`;
        const to = range.to.slice(0, 4) === year ? range.to : `${year}-12-31`;
        emit(file, `${dayDir}/${span(from, to)}__${report}.csv`);
      } else {
        // ฉบับแรกอยู่ในโฟลเดอร์ของวันที่เก่าที่สุด · ฉบับที่เนื้อหาเปลี่ยน (back-fill รอบใหม่) ชื่อเดียวกันอยู่โฟลเดอร์
        // เดียวกันไม่ได้ จึงได้โฟลเดอร์ของวันที่ฉบับนั้นโผล่ครั้งแรก — ข้อมูลจริงวันนี้มีฉบับเดียว (legacy-2026-09-22)
        const target = `data/hoteltime/backfill/legacy-${day}/${rest[0]}`;
        dedupe(file, `stale-csv/${rest[0]}`, target, target);
      }
      continue;
    }
    emit(file, `data/_unsorted/downloads-archive/${day}/${rest.join('/')}`);
  }

  for (const file of current) {
    if (isJunk(file)) continue;
    const same = planned.get(file.sha256);
    if (same !== undefined) duplicates.push({ from: file.path, sameAs: same });
    else emit(file, `data/_unsorted/${file.path}`);
  }
  return { copies, duplicates, ignored, alreadyThere, conflicts };
}
