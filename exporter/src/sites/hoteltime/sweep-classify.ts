/**
 * ตัวจำแนกผลการกวาดเมนู — ฟังก์ชันบริสุทธิ์ล้วน ไม่แตะเบราว์เซอร์
 *
 * ตาม ADR-0001: การกวาดคือขั้นถูก (สคริปต์อ่านอย่างเดียว) ที่แทนที่การให้ AI อ่านทุกหน้าเอง
 * ไฟล์นี้แปลงข้อเท็จจริงดิบที่สคริปต์กวาดเก็บมาได้ต่อหนึ่งหน้า ให้เป็นสรุปที่เจ้าของข้อมูล
 * อ่านแล้วชี้ได้ว่าอยากได้รายงานไหน — ไม่ตีความเกินกว่าที่สังเกตเห็นจริง
 */

export type PageProbe = {
  readonly href: string;
  /** โหลดหน้าสำเร็จไหม — false เมื่อ timeout, error, หรือหน้าเปลี่ยนโครงสร้างจนหาไม่เจอ */
  readonly reachable: boolean;
  readonly errorMessage?: string;
  readonly title?: string;
  /** จำนวนลิงก์ที่มีชื่อ accessible ตรงกับ EXPORT_LINK_NAME บนหน้านั้น */
  readonly exportLinkCount?: number;
  /** เจอข้อความ "mandatory item" ในตัวหน้าไหม (สัญญาณเดียวกับที่ assertFormAccepted ใช้) */
  readonly hasMandatoryMarker?: boolean;
  /** ชื่อ control (attribute name) ของทุก <input> ในฟอร์มบนหน้านั้น */
  readonly inputNames?: readonly string[];
  /** target ของลิงก์ `javascript:__doPostBack('<target>', ...)` — ปุ่มแบบลิงก์ที่ไม่ใช่ <input> */
  readonly postbackTargets?: readonly string[];
};

export type PageSummary = {
  readonly href: string;
  readonly reachable: boolean;
  readonly errorMessage?: string;
  readonly title?: string;
  readonly hasExportLink: boolean;
  readonly hasMandatoryField: boolean;
  /** ชื่อ group ของช่องวันที่ที่พบ (รูปแบบ `<group>$calFrom`/`<group>$calTo` — ดู findDateRangeGroups) */
  readonly dateRangeGroups: readonly string[];
  /** ชื่อ control ของทุก input ในฟอร์ม — ใช้ตอน recon เชิงลึกภายหลัง ไม่ต้องอ่านหน้าใหม่ */
  readonly inputNames: readonly string[];
  readonly inputCount: number;
  /** ชื่อ control ที่ส่วนท้ายขึ้นต้นด้วย `btn` จากทั้ง <input> และลิงก์ postback (ไม่ซ้ำ) */
  readonly buttonNames: readonly string[];
  /** ปุ่มตัวแรกที่ชื่อคล้าย "ค้นหา/แสดงผล" — สัญญาณว่าปุ่ม export อาจโผล่หลังกด ไม่ใช่หลักฐาน */
  readonly searchButton: string | null;
};

/**
 * 🔴 ทำไมต้องเก็บชื่อปุ่ม (2026-09-28): ตัวกวาดไม่กดอะไรเลย (ADR-0001) หน้าที่ปุ่ม export โผล่หลังกด
 * Search/Display เท่านั้น (recon/NOTES.md เจอแบบนี้จริง) จึงถูกนับเป็น "ไม่มี export" — ชื่อปุ่มบอกได้
 * ว่าหน้าไหนน่าสงสัย ให้เจ้าของข้อมูลเห็นก่อนเลือก แล้วค่อยยืนยันตอน recon เชิงลึก
 * ยึดชื่อจากรายงานที่ทำจริง (`btnFind` 7 ใบ, `btnShow` ของ RateCode) + คำที่มีความหมายเดียวกัน
 */
const SEARCH_BUTTON = /^btn(Find|Show|Search|Display|Refresh|View|Filter)/i;
const lastSegment = (name: string) => name.slice(name.lastIndexOf('$') + 1);

/** ปุ่มตัวแรกที่ชื่อคล้าย "ค้นหา/แสดงผล" — ใช้ร่วมกับการตรวจเบื้องต้น (probe-classify.ts) */
export function findSearchButton(names: readonly string[]): string | null {
  return names.find((n) => SEARCH_BUTTON.test(lastSegment(n))) ?? null;
}

function findButtons(names: readonly string[]): string[] {
  return [...new Set(names.filter((n) => /^btn/i.test(lastSegment(n))))];
}

/**
 * ดึงชื่อ group ของช่องวันที่จากคู่ input name ที่ลงท้าย `$calFrom`/`$calTo`
 *
 * ยึดรูปแบบเดียวที่พบจริงในทุกหน้าที่สำรวจมาแล้ว (3 รายงานที่มี + audit trail ที่สำรวจไว้ใน
 * spec 07) — ไม่ใช่การเดา · หน้าที่ใช้รูปแบบอื่นจะไม่ถูกจับได้ตรงนี้ แต่จะยังเห็นชื่อ control
 * เต็มได้จาก inputCount/raw data เมื่อ recon เชิงลึกภายหลัง
 */
export function findDateRangeGroups(inputNames: readonly string[]): string[] {
  // ต้องมีครบทั้งคู่ — หน้าที่มีแค่ `$calFrom` (เช่น Deposit to use, Unpaid invoices by date) คือช่องวันเดี่ยว ไม่ใช่ช่วง
  // (การตรวจเบื้องต้น 2026-10-07 พังที่ "หา calTo ไม่เจอ" เพราะเดิมนับครึ่งเดียวเป็นช่วง)
  const names = new Set(inputNames);
  const groups = new Set<string>();
  for (const name of inputNames) {
    if (name.endsWith('$calFrom')) {
      const group = name.slice(0, -'$calFrom'.length);
      if (names.has(`${group}$calTo`)) groups.add(group);
    }
  }
  return [...groups];
}

/**
 * ฟิลด์ระบบของ ASP.NET WebForms — ขึ้นต้นด้วย `__` เสมอ (`__VIEWSTATE`, `__EVENTTARGET`,
 * `__EVENTARGUMENT`, `__EVENTVALIDATION` ฯลฯ ดูหัว core/webforms.ts) มีเหมือนกันทุกหน้า
 * ไม่ใช่ control เฉพาะของหน้านั้น กรองออกเพื่อไม่ให้ผลรวมทั้งเว็บบวมโดยไม่ได้ข้อมูลใหม่
 */
function isFrameworkField(name: string): boolean {
  return name.startsWith('__');
}

export type SweepReport = {
  readonly total: number;
  readonly unreachable: readonly { readonly href: string; readonly error: string | undefined }[];
  /** หน้าที่ไม่มีปุ่ม export — ไม่ใส่ inputNames เต็มรายการ เพราะยังไม่ใช่ตัวเลือกที่จะ recon เชิงลึกตอนนี้ */
  readonly noExport: readonly {
    readonly href: string;
    readonly title: string | undefined;
    readonly inputCount: number;
    readonly buttonNames: readonly string[];
    readonly searchButton: string | null;
  }[];
  /** จำนวนหน้าใน noExport ที่มีปุ่มชื่อคล้ายค้นหา — ผู้สมัครที่ export อาจโผล่หลังกดค้นหา */
  readonly noExportWithSearchButton: number;
  readonly hasExport: readonly {
    readonly href: string;
    readonly title: string | undefined;
    readonly dateRangeGroups: readonly string[];
    readonly inputNames: readonly string[];
  }[];
};

/**
 * รวมผลของทุกหน้าเป็นรายงานเดียว จัดกลุ่มตามความสำคัญแทนที่จะเรียงยาวเส้นเดียว
 *
 * เหตุผล: หน้าที่ไม่มีปุ่ม export ส่วนใหญ่ (settings/admin) มี input เป็นร้อยตัว — ถ้าใส่
 * inputNames เต็มทุกหน้า ไฟล์รวมจะบวมจากหน้าที่ยังไม่ใช่ผู้สมัคร recon จนเกินเป้าที่ตั้งไว้
 * ("หลักพัน ไม่ใช่หลักหมื่น token") เพราะหน้าที่มีปุ่ม export คือกลุ่มที่ ticket 03 ตัดสินใจ
 * แล้วว่าจะทำก่อน — ให้รายละเอียดเต็มเฉพาะกลุ่มนั้น กลุ่มอื่นบอกแค่พอให้รู้ว่ามีอะไรอยู่
 */
export function buildSweepReport(summaries: readonly PageSummary[]): SweepReport {
  const unreachable = summaries
    .filter((s) => !s.reachable)
    .map((s) => ({ href: s.href, error: s.errorMessage }));

  const reachable = summaries.filter((s) => s.reachable);

  const noExport = reachable
    .filter((s) => !s.hasExportLink)
    .map((s) => ({
      href: s.href, title: s.title, inputCount: s.inputCount,
      buttonNames: s.buttonNames, searchButton: s.searchButton,
    }));

  const hasExport = reachable
    .filter((s) => s.hasExportLink)
    .map((s) => ({ href: s.href, title: s.title, dateRangeGroups: s.dateRangeGroups, inputNames: s.inputNames }));

  const noExportWithSearchButton = noExport.filter((p) => p.searchButton !== null).length;
  return { total: summaries.length, unreachable, noExport, noExportWithSearchButton, hasExport };
}

export function classifyPage(probe: PageProbe): PageSummary {
  if (!probe.reachable) {
    return {
      href: probe.href,
      reachable: false,
      errorMessage: probe.errorMessage,
      hasExportLink: false,
      hasMandatoryField: false,
      dateRangeGroups: [],
      inputNames: [],
      inputCount: 0,
      buttonNames: [],
      searchButton: null,
    };
  }

  const inputNames = (probe.inputNames ?? []).filter((n) => !isFrameworkField(n));
  const buttonNames = findButtons([...inputNames, ...(probe.postbackTargets ?? [])]);
  return {
    href: probe.href,
    reachable: true,
    title: probe.title,
    hasExportLink: (probe.exportLinkCount ?? 0) > 0,
    hasMandatoryField: probe.hasMandatoryMarker ?? false,
    dateRangeGroups: findDateRangeGroups(inputNames),
    inputNames,
    inputCount: inputNames.length,
    buttonNames,
    searchButton: findSearchButton(buttonNames),
  };
}
