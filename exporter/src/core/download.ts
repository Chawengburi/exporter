import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Download } from 'playwright';

/**
 * เซฟ `Download` ของ Playwright ไปที่ path ที่กำหนด — แยกออกมาเพราะแพทเทิร์น
 * `mkdir(recursive)+path.join+saveAs` ซ้ำกันทุกจุดที่จับ download (DataTables ใน
 * `sites/foodstory/interactions.ts` และ bespoke module อย่าง `reservation-report.ts`)
 */
export async function saveDownload(download: Download, downloadDir: string, destFileName: string): Promise<string> {
  await mkdir(downloadDir, { recursive: true });
  const destPath = path.join(downloadDir, destFileName);
  await download.saveAs(destPath);
  return destPath;
}
