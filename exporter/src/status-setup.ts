import path from 'node:path';
import { defaultDataDir, readSetupValues, type StatusSetup } from './core/status.ts';
import { plannedReports as foodstoryReports } from './sites/foodstory/reports/index.ts';
import { plannedReports as hoteltimeReports } from './sites/hoteltime/reports/index.ts';

/**
 * ข้อมูลประกอบของ `exporter status` และการแจ้ง Discord — แคตตาล็อกของทั้งสอง Site + ค่าตั้งจาก `exporter/.env` · อยู่นอก core เพราะต้องรู้จัก Site
 * (core ไม่ import Site)
 */
export function defaultEnvFile(): string {
  return path.join(defaultDataDir(), '..', '.env');
}

export function statusSetup(envFile = defaultEnvFile()): StatusSetup {
  return { catalog: { hoteltime: hoteltimeReports(), foodstory: foodstoryReports() }, ...readSetupValues(envFile) };
}
