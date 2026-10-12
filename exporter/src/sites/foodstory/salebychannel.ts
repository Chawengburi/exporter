import { readFile } from 'node:fs/promises';
import type { Page } from 'playwright';
import { parseCsv } from '../../core/csv.ts';
import {
  dismissInterstitial,
  triggerIconDownloadAndCapture,
  CONTROL_DISMISS_INTERSTITIAL,
  CONTROL_ICON_DOWNLOAD,
} from './interactions.ts';

/**
 * "ยอดขายแยกตามช่องทางการขาย" — #10 ในสเปกต้นทาง, toolbar E, `/th/salebychannel`
 *
 * 🔴 **ไม่ใช่ `Report` shape** โดยเจตนา — ต่างจากรายงานอื่นทุกใบในสามมิติพร้อมกัน จนฝืนยัดเข้า
 * `_types.ts::Report` แล้วจะได้ field ที่ไม่มีความหมายเต็มไปหมด (ตรงกับปรัชญา ADR-0004 ที่ไม่
 * บังคับ shape เดียวกันข้ามรายงานที่กลไกต่างกันจริง):
 *   1. ไม่มี `Show N rows`/DataTables เลย — เป็น dashboard ที่มีกราฟ ไม่ใช่ตารางแบ่งหน้า
 *   2. export เป็นไอคอนเดียวกดแล้วดาวน์โหลดทันที ไม่มีเมนู/ปุ่มข้อความ "Excel" ให้กด
 *   3. **ไฟล์ที่ได้เป็น .csv ไม่ใช่ .xlsx** — `core/xlsx.ts` อ่านไม่ได้ ต้องใช้ `core/csv.ts` แทน
 *
 * ยืนยันจริง 2026-09-26: ไอคอนดาวน์โหลดคือ `button.button-download` ที่มี
 * `img[src*="download_channel"]` (ปุ่มข้างเคียงใช้ class เดียวกันหมดแต่ src ต่างกัน — เจาะจงด้วย
 * src ไม่ใช่แค่ class) หายากเพราะไม่มี text/aria-label ใด ๆ เลย ต้องหาผ่าน aria snapshot
 * (`button: - img` ไม่มีชื่อ) แล้วไล่ดู src ของ `<img>` ข้างในทีละตัว
 */

export const ID = 'salebychannel';
export const PATH = '/th/salebychannel';
export const LABEL = 'ยอดขายแยกตามช่องทางการขาย';

const ICON_SELECTOR = 'button.button-download:has(img[src*="download_channel"])';
const ALLOWED_CONTROLS = [CONTROL_DISMISS_INTERSTITIAL, CONTROL_ICON_DOWNLOAD];

/** ยืนยันจากไฟล์จริง 2026-09-26 — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่ */
export const EXPECTED_COLUMNS = ['ช่องทาง', 'ชื่อสาขา', 'จำนวนบิล', 'ยอดขาย', 'ยอดหัก GP', 'ค่าจัดส่ง', 'รายรับสุทธิ'];

export async function downloadSaleByChannel(page: Page, downloadDir: string, destFileName: string): Promise<string> {
  await dismissInterstitial(page, ALLOWED_CONTROLS, ID);
  return triggerIconDownloadAndCapture(page, ALLOWED_CONTROLS, ID, ICON_SELECTOR, downloadDir, destFileName);
}

export class SaleByChannelCsvError extends Error {
  override readonly name = 'SaleByChannelCsvError';
}

export type SaleByChannelSheet = {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
};

// FoodStory เขียนทุกเซลล์เป็นสูตร Excel แบบบังคับ text ("=""ค่า""") กันตัวเลข/วันที่โดนตีความ
// ผิด — RFC4180 quoting ชั้นนอกแกะออกแล้วจะเหลือ `="ค่า"` ต้องแกะชั้นในอีกที
const EXCEL_FORCED_TEXT_PATTERN = /^="(.*)"$/;

function unwrapExcelForcedText(field: string): string {
  const m = EXCEL_FORCED_TEXT_PATTERN.exec(field);
  return m ? m[1]! : field;
}

/**
 * อ่านไฟล์ .csv ที่ดาวน์โหลดจาก salebychannel — **ไม่มีแถวสรุป/header-position แบบมาตรฐาน**
 * (ต่างจาก readFoodStorySheet ของรายงานอื่น) โครงจริงเป็นตารางย่อยไขว้มิติ: แถวช่องทาง, แถวสาขา,
 * แถวรวมทั้งหมด ("รวมทั้งหมด" — คำนี้เอง ไม่ใช่ "Total"/"รวม" แบบรายงานอื่น) ปนกันตามจำนวนสาขา/
 * ช่องทางจริง จึงคืนทุกแถวดิบให้ผู้เรียกตีความเอง ไม่ตัดแถวไหนออกให้
 *
 * 🔴 `core/csv.ts::parseCsv()` เขียนไว้เป็น "parser ขั้นต่ำไว้ตรวจไฟล์ที่เราเขียนเอง" ไม่ได้
 * ตั้งใจรองรับ CSV ทุกสำเนียง — ที่นี่ป้อนไฟล์ของ FoodStory เอง (บุคคลที่สาม) ให้มันแทน ใช้ได้จริง
 * เพราะไฟล์นี้ตาม RFC4180 มาตรฐาน (quote คู่ปกติ ไม่มี newline ในเซลล์ที่เจอ) แต่ถ้า FoodStory
 * เปลี่ยนรูปแบบ CSV ในอนาคต (เช่น encoding อื่น หรือ quoting ที่ parser นี้ไม่ได้ตั้งใจรองรับ)
 * จะไม่ใช่ความรับผิดชอบที่ parseCsv() ประกาศไว้ตั้งแต่แรก — ตรวจสอบไฟล์จริงอีกครั้งถ้าเริ่มพัง
 */
export async function readSaleByChannelCsv(filePath: string): Promise<SaleByChannelSheet> {
  const text = await readFile(filePath, 'utf-8');
  const rows = parseCsv(text).map((row) => row.map(unwrapExcelForcedText));

  if (rows.length === 0) {
    throw new SaleByChannelCsvError(`ไฟล์ไม่มีแถวเลยสักแถว — ${filePath}`);
  }

  return { header: rows[0]!, rows: rows.slice(1) };
}
