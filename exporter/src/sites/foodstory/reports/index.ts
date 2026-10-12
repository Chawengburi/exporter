import { addWaste } from './add-waste.ts';
import { checkStock } from './check-stock.ts';
import { costbyproduct } from './costbyproduct.ts';
import { crm } from './crm.ts';
import { currentStock } from './current-stock.ts';
import { drawer } from './drawer.ts';
import { drawerPaid } from './drawer-paid.ts';
import { employee } from './employee.ts';
import { fulltaxinvoice } from './fulltaxinvoice.ts';
import { ingredient } from './ingredient.ts';
import { ingredientaddon } from './ingredientaddon.ts';
import { intermidiate } from './intermidiate.ts';
import { invMovement } from './inv-movement.ts';
import { inventoryActivity } from './inventory-activity.ts';
import { inventorySupplier } from './inventory-supplier.ts';
import { option } from './option.ts';
import { optionByDate } from './option-by-date.ts';
import { order } from './order.ts';
import { orderByEmployee } from './order-by-employee.ts';
import { outputtax } from './outputtax.ts';
import { pay } from './pay.ts';
import { paymentByEmployee } from './payment-by-employee.ts';
import { promotion } from './promotion.ts';
import { promotionUse } from './promotion-use.ts';
import { purchaseDetail } from './purchase-detail.ts';
import { purchaseStock } from './purchase-stock.ts';
import { saleClaim } from './sale-claim.ts';
import { salebybill } from './salebybill.ts';
import { salebybilldetail } from './salebybilldetail.ts';
import { salebycategory } from './salebycategory.ts';
import { salebydate } from './salebydate.ts';
import { salebygroup } from './salebygroup.ts';
import { salebymonthsum } from './salebymonthsum.ts';
import { salebyoption } from './salebyoption.ts';
import { salebyproduct } from './salebyproduct.ts';
import { salebyproductdaily } from './salebyproductdaily.ts';
import { salebyproducthourly } from './salebyproducthourly.ts';
import { salebysumdate } from './salebysumdate.ts';
import { summaryStockMovement } from './summary-stock-movement.ts';
import { table } from './table.ts';
import { transfer } from './transfer.ts';
import { transferDetail } from './transfer-detail.ts';
import { transferStock } from './transfer-stock.ts';
import { usedStock } from './used-stock.ts';
import { usedStockByDate } from './used-stock-by-date.ts';
import { voucher } from './voucher.ts';
import { working } from './working.ts';
import type { Report } from './_types.ts';

/**
 * ทะเบียนรายงานของ FoodStory — เฉพาะรายงานที่เป็น `Report` shape เท่านั้น
 *
 * ✅ ต่อเข้า CLI/registry การรัน production แล้ว (ticket 12, 2026-09-26) — `sites/foodstory/
 * export.ts::runFoodStoryExport()` import array นี้ตรง ๆ และ `src/index.ts` เรียกผ่าน
 * `--site foodstory` ยืนยันจริงแล้วว่ารันได้ครบทั้ง 47 ใบ + `salebychannel` (48 รวม) ผ่าน
 * batch run จริงเดือน ส.ค. 2026 — ไม่ใช่แค่ recon เดี่ยว ๆ ต่อใบเหมือนก่อนหน้านี้อีกต่อไป
 *

 * รายงานที่ไม่อยู่ในนี้เพราะเป็นข้อยกเว้นจริง (ไม่ใช่ลืมใส่):
 * - `subtaxinvoice` (#3, toolbar D) และ `salebyproductmonthly` (#15, toolbar D) — ทั้งคู่
 *   ดาวน์โหลดออกมาเป็น `.xls` แบบ binary เก่า (OLE2/CFB, ไลบรารี "Maatwebsite") ที่
 *   `core/xlsx.ts` อ่านไม่ได้เลย ยืนยันแล้วว่าเป็นแพทเทิร์นของ toolbar D ทั้งคู่ ไม่ใช่เรื่อง
 *   บังเอิญ — ตัดสินใจข้ามไปก่อน (ticket 03/05 §Comments)
 * - `salebychannel` (#10, toolbar E) — ไม่ใช่ `Report` shape เลย (ไม่มี Show N rows, export
 *   เป็นไอคอนตรง ๆ ได้ไฟล์ .csv ไม่ใช่ .xlsx) อยู่ที่ `sites/foodstory/salebychannel.ts` แยก
 *   ต่างหาก มีฟังก์ชันดาวน์โหลด/อ่านของตัวเอง (`downloadSaleByChannel`/`readSaleByChannelCsv`)
 * - `/th/crm/question` (#46, toolbar G) — ไม่มี export control เลย (card layout ไม่ใช่ตาราง) —
 *   ข้ามตามที่สเปกต้นทางบอกไว้ตรง ๆ (ticket 10)
 * - `/th/reservation-report` (#55) — คนละ host (`manage.foodstory.co`) และ UI ไม่ใช่ DataTables
 *   เลย แยกไป ticket 11 ต่างหาก
 * - `/th/inventory/goods-received` (#44, toolbar F) — ไม่มีปุ่ม Excel เลย (มีแค่ Copy +
 *   ส่งออกทั้งหมดทาง email) — ข้ามตามสเปกต้นทาง §3 (ยังไม่เช็คว่าจะทำ email-export fallback
 *   ไหม อยู่นอกสโคปของทั้ง ticket 08/09/10)
 */
export const REPORTS: readonly Report[] = [
  salebysumdate,
  outputtax,
  fulltaxinvoice,
  salebydate,
  salebybill,
  pay,
  salebyproduct,
  salebyproducthourly,
  salebyproductdaily,
  salebycategory,
  salebygroup,
  salebyoption,
  saleClaim,
  salebymonthsum,
  salebybilldetail,
  costbyproduct,
  intermidiate,
  ingredient,
  ingredientaddon,
  order,
  option,
  optionByDate,
  orderByEmployee,
  paymentByEmployee,
  currentStock,
  checkStock,
  inventoryActivity,
  inventorySupplier,
  purchaseStock,
  purchaseDetail,
  addWaste,
  usedStock,
  usedStockByDate,
  transferStock,
  transferDetail,
  transfer,
  invMovement,
  summaryStockMovement,
  crm,
  drawer,
  drawerPaid,
  promotion,
  promotionUse,
  voucher,
  employee,
  working,
  table,
];

export function findReport(id: string): Report | undefined {
  return REPORTS.find((r) => r.id === id);
}

export function reportIds(): string[] {
  return REPORTS.map((r) => r.id);
}
