import type { Page } from 'playwright';
import type { ReportFamily } from '../../../core/raw-manifest.ts';
import type { ReportPeriod } from '../../../core/run-planner.ts';
import type { DateRange } from '../../../core/order.ts';

/**
 * สัญญาที่ทุกรายงานต้องทำตาม
 *
 * ทำไมเป็น TypeScript ไม่ใช่ JSON config — สามใบที่สำรวจมา (2026-09-08) ต่างกัน
 * แทบทุกมิติ: ใบหนึ่งมีเพดาน 2000 อีกใบไม่มี · ใบหนึ่งมีฟิลด์บังคับที่ห้ามล้าง ·
 * ใบหนึ่งเก็บวันที่เป็น Excel serial อีกสองใบเป็นข้อความ · แถวสรุปเชื่อได้แค่ใบเดียว
 * JSON จะสู้ความต่างระดับนี้ไม่ไหวแล้วค่อย ๆ กลายเป็นภาษาโปรแกรมครึ่งใบ
 * รายละเอียดที่มาของทุกค่าอยู่ใน recon/NOTES.md
 */

export type ChunkStrategy = {
  /** `monthly` = ต้องซอยรายเดือน · `whole` = ยิงทั้งช่วงทีเดียวได้ */
  readonly kind: 'monthly' | 'whole';
  /** เหตุผล — เขียนไว้ให้คนที่มาอ่านทีหลังไม่เผลอ "ปรับให้เร็วขึ้น" แล้วข้อมูลหาย */
  readonly reason: string;
};

export type Report = {
  readonly id: string;
  readonly label: string;
  /** path ใต้ `/pms/` */
  readonly path: string;
  readonly chunk: ChunkStrategy;
  /**
   * ใบนี้โดนเพดาน 2000 แถวของ HotelTime ได้ไหม
   * ถ้า true ชั้นตรวจจะถือว่า "ได้ 2000 แถวพอดี" = ชนเพดาน = ล้มเหลว แล้วผ่าครึ่งช่วงดึงใหม่
   */
  readonly hasRowCap: boolean;
  /**
   * true = รายงานปฏิบัติการรายวัน กรองด้วยวันปฏิบัติการ (เช่น วันเข้าพัก) ไม่ใช่ created date
   * รองรับแค่ `--daily` (= วันนี้วันเดียว) เท่านั้น ไม่มี back-fill/baseline — ดู ADR-0003
   */
  readonly dailyOnly: boolean;
  /**
   * ตระกูลของรายงาน (ADR-0008 · CONTEXT.md) — `per-day` = **รายงานตามวัน** ได้ไฟล์ละวันของข้อมูล ·
   * `picture` = **รายงาน snapshot** ถ่าย ณ เวลาที่ดึง ทุกครั้งเป็นฉบับใหม่ ชื่อไฟล์เป็นเวลาที่ถ่าย · ไม่เท่ากับ `dailyOnly` เสมอไป:
   * `manager-day-detail` ดึงแบบ dailyOnly แต่เป็นยอดของเมื่อวานวันเดียว จึงเป็นรายงานตามวัน
   */
  readonly family: ReportFamily;
  /**
   * งวดของ **รายงาน snapshot** สำหรับ **snapshot ปิดงวด** (ADR-0008, ใบ 05) — `month`/`year` = ยอดสะสมของเดือน/ปี ถ่าย snapshot ของงวดที่จบแล้วทั้งงวดในรอบแรก
   * ของงวดถัดไป · `none` = snapshot ณ ขณะนั้น พยากรณ์ หรือช่วงเลื่อน ไม่มีงวดให้ปิด · รายงานตามวันไม่ใส่
   */
  readonly period?: ReportPeriod;
  /**
   * คอลัมน์ในไฟล์ที่ใช้ยืนยันว่า filter ทำงานจริง (ด่านช่วงวัน) และบันทึกเป็น `filterColumn` ใน `_manifest.json` — รายงานที่ข้ามด่านวันที่
   * ยังต้องใส่ค่าที่มีจริงในไฟล์เพื่อให้ type ผ่าน แต่ไม่ถูกใช้ตรวจ
   */
  readonly dateColumn: string;
  /**
   * true = ข้ามด่านที่ 5 ของ `verifyChunk` ทั้งหมด (อ่านคอลัมน์วันที่ + เช็คค่าว่าง + เทียบช่วง
   * กับที่สั่ง) — ใช้เมื่อรายงานไม่มีคอลัมน์ไหนเลยที่มีค่าครบทุกแถวและเท่ากับวันที่ถูกกรองเสมอ
   * ตัวอย่าง: "Housekeeping" (ห้องว่างไม่มีแขก ช่อง Arrival/Departure เป็นค่าว่างเลย — เช็คค่าว่างพังก่อนถึงขั้นเทียบช่วง)
   * · ถ้าแถวคือช่วงที่คร่อมวันที่เลือก (แบบ In-house guests เดิม) ให้ใช้ `overlapColumns` แทน ไม่ใช่ข้ามด่าน
   * 🔴 เสียด่านเดียวที่จับ "filter ไม่ทำงานจริง" ได้ — ตั้งเป็น true เฉพาะเมื่อพิสูจน์แล้วว่า
   * ไม่มีคอลัมน์ไหนใช้แทนได้จริง ๆ ไม่ใช่ทางลัดเวลาขี้เกียจหาคอลัมน์ที่ถูกต้อง
   */
  readonly skipDateCoverageCheck: boolean;
  /**
   * รายงานที่แถวคือ "ช่วงพักที่คร่อมช่วงที่ขอ" (เช่น City tax, Profiles) — ด่านที่ 5 ตรวจว่าทุกแถวแตะช่วงที่สั่ง (วันเริ่ม ≤ ปลายช่วง,
   * วันจบ ≥ ต้นช่วง) แทนการบังคับให้ `dateColumn` อยู่ในช่วงพอดี · ไม่ใส่ = ด่านเดิม
   */
  readonly overlapColumns?: { readonly from: string; readonly to: string };
  /** คำอธิบายว่ากรองด้วยวันที่แกนไหน — ลง manifest ให้ปลายทางรู้ความหมายของช่วง · ไม่ใส่ = ใช้คำอธิบายตั้งต้นใน export.ts */
  readonly filterNote?: string;
  /**
   * ช่วงข้อมูลจริงของรายงานภาพรวม (dailyOnly) ที่ค้นช่วงอื่นที่ไม่ใช่ "วันนี้" เช่น สถิติทั้งปี/เดือนหน้า, ใบค้างชำระตั้งแต่ 2024 —
   * `applyFilters` ใช้ตั้งตัวกรอง และช่วงใน `_run.json` / `_manifest.json` ใช้ช่วงนี้แทนวันที่ดึง (ticket 26) — รายงานตามวันยังใช้ช่วงนี้ตั้งชื่อไฟล์
   * · โฟลเดอร์ยังเป็นวันที่ดึง · ไม่ใส่ = ช่วงข้อมูลคือช่วงที่ขอ
   */
  readonly dataWindow?: (day: Date) => DateRange;
  /**
   * id ของปุ่ม export ที่ต้องกด เมื่อหน้ามี export หลายแบบ (เช่น `pc_btnExportXLS` สรุป / `pc_btnExportDetailXLS` รายละเอียด — ticket 24)
   * · ไม่ใส่ = ลิงก์ "Export: MS Excel" ที่ต้องมีชิ้นเดียว · การกดปุ่ม export ไม่ผ่าน allowedControls เหมือนลิงก์ export เดิม (อ่านอย่างเดียว)
   */
  readonly exportLink?: string;
  /**
   * ค่าเผื่อขอบของช่วงวันที่ (วัน) — ปกติ 0
   *
   * 🔴 ตั้งมากกว่า 0 เฉพาะเมื่อพิสูจน์แล้วว่าฝั่ง HotelTime ตัดขอบด้วย timezone
   * คนละอันกับที่ค่าใน export ใช้ · อย่าตั้งเพื่อ "ให้ผ่าน" เพราะด่านนี้คือด่านเดียว
   * ที่จับได้ว่า filter ไม่ทำงาน
   */
  readonly boundaryToleranceDays: number;

  /** หัวตารางที่คาดหวัง — ต่างจากนี้เมื่อไหร่แปลว่ารายงานเปลี่ยน ต้องสำรวจใหม่ */
  readonly expectedColumns: readonly string[];
  /**
   * `data-driven` = คอลัมน์หลัง `expectedColumns` เปลี่ยนตามข้อมูลของช่วงที่ค้น (เช่น ชื่อ segment ที่มีการจองในช่วงนั้น) — ตรวจแค่ว่าหัว
   * ขึ้นต้นด้วย `expectedColumns` · ไม่ใส่ = หัวต้องตรงเป๊ะ (เจอจาก snapshot ปิดงวดปี 2025 ใบ 05: segment ของปี 2025 กับ 2026 คนละชุด)
   */
  readonly trailingColumns?: 'data-driven';
  /** ชื่อ control ของปุ่ม Search */
  readonly searchButton: string;

  /**
   * รายการ control ทั้งหมดที่รายงานนี้ได้รับอนุญาตให้แตะ (กรอก/กด) — บังคับผ่าน
   * `assertControlAllowed()` ที่ `core/gate.ts` ก่อนทุกครั้ง ต้องมี `searchButton` รวมอยู่ด้วย
   * 🔴 นี่คือเกราะกันเผลอกดปุ่มที่เขียนข้อมูล (เช่น `Reinstate room`) — ดู
   * `specs/02-spec-hoteltime-constraints.md` §7 และ ADR-0001 อย่าใส่ชื่อ control ที่ไม่ได้
   * ใช้จริงใน `applyFilters` เพื่อ "กันเผื่อ" เพราะรายการนี้คือขอบเขตความไว้ใจ ไม่ใช่เอกสาร
   */
  readonly allowedControls: readonly string[];

  /**
   * ตั้ง filter ให้ตรงกับช่วงที่ขอ
   * 🔴 ต้องจัดการช่วงวันที่ default ที่หน้าเว็บกรอกมาให้ด้วยเสมอ ไม่ใช่แค่กรอกช่องที่ต้องการ
   */
  applyFilters(page: Page, range: DateRange): Promise<void>;

  /**
   * ค้นแล้วเจอข้อมูลหรือไม่ — ต้องเรียก **ก่อน** กด export เสมอ
   *
   * 🔴 เมื่อผลว่าง HotelTime จะไม่ส่งไฟล์มาเลยทั้งที่ลิงก์ export ยังอยู่
   * การกด export ไปดื้อ ๆ จะได้แค่ timeout · สัญญาณที่ใช้ต่างกันในแต่ละใบ
   * จึงให้แต่ละรายงานตอบเอง
   */
  hasResults(page: Page): Promise<boolean>;

  /**
   * จำนวนแถวที่หน้าเว็บบอก ใช้เทียบกับจำนวนแถวในไฟล์
   * คืน `null` เมื่อใบนี้ไม่มีตัวเลขที่เชื่อถือได้ — อย่าเดา
   */
  expectedRowCount(page: Page): Promise<number | null>;
};
