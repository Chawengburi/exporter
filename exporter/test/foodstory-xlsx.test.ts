import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFoodStorySheet } from '../src/sites/foodstory/xlsx.ts';
import { makeWorkbook, makeXlsx, sheetXml } from './_xlsx-fixture.ts';

// รูปร่างจริงที่ดาวน์โหลดได้จาก salebysumdate 2026-09-23 (unzip ตรง ๆ ยืนยันแล้ว — ดู ticket 02
// §Comments) — 17 คอลัมน์จริง แถวข้อมูลมีแค่แถว Total ที่กรอกแค่คอลัมน์ A ("Total") คอลัมน์อื่น
// ว่างหมด (ไม่ใช่ค่า 0 ที่เขียนไว้ — เว็บไม่เขียนเซลล์ที่ไม่มีค่าลง XML เลย) เพราะช่วงที่ทดสอบ
// ไม่มียอดขายจริง — 🔴 ยังไม่เคยเห็นไฟล์ที่มีแถวข้อมูลจริง (ไม่ใช่ Total) เลยสักครั้ง
const REAL_HEADER_XML = `<worksheet><sheetData>
  <row r="1"><c r="A1" t="inlineStr"><is><t>รายงานสรุปยอดขายแยกตามวัน</t></is></c></row>
  <row r="2">
    <c r="A2" t="inlineStr"><is><t>วันที่</t></is></c>
    <c r="B2" t="inlineStr"><is><t>ยอดก่อนลด</t></is></c>
    <c r="C2" t="inlineStr"><is><t>ส่วนลดสินค้า</t></is></c>
    <c r="D2" t="inlineStr"><is><t>ส่วนลดบิล</t></is></c>
    <c r="E2" t="inlineStr"><is><t>ยอดรวม ยอดก่อนลด - ส่วนลดสินค้า</t></is></c>
    <c r="F2" t="inlineStr"><is><t>ค่าบริการ</t></is></c>
    <c r="G2" t="inlineStr"><is><t>ยอดก่อนภาษี ยอดรวม + ค่าบริการ</t></is></c>
    <c r="H2" t="inlineStr"><is><t>ภาษี</t></is></c>
    <c r="I2" t="inlineStr"><is><t>มูลค่า Voucher มูลค่า Voucher มีโอกาสที่จะมากกว่ายอดรวมทั้งบิล ส่วนลดที่ใช้ได้สูงสุดจึงเป็นยอดรวมของบิล</t></is></c>
    <c r="J2" t="inlineStr"><is><t>ส่วนลด Voucher</t></is></c>
    <c r="K2" t="inlineStr"><is><t>ยอดปัดเศษ</t></is></c>
    <c r="L2" t="inlineStr"><is><t>ค่าจัดส่ง</t></is></c>
    <c r="M2" t="inlineStr"><is><t>รวมสุทธิ (ยอดก่อนภาษี + ภาษี +  ยอดปัดเศษ) -  ยอดขายสินค้าไม่มีภาษี</t></is></c>
    <c r="N2" t="inlineStr"><is><t>ทิป</t></is></c>
    <c r="O2" t="inlineStr"><is><t>คืนเงิน</t></is></c>
    <c r="P2" t="inlineStr"><is><t>จำนวนบิล</t></is></c>
    <c r="Q2" t="inlineStr"><is><t>สาขา</t></is></c>
  </row>
  <row r="3"><c r="A3" t="inlineStr"><is><t>Total</t></is></c></row>
</sheetData></worksheet>`;

const REAL_HEADER = [
  'วันที่', 'ยอดก่อนลด', 'ส่วนลดสินค้า', 'ส่วนลดบิล', 'ยอดรวม ยอดก่อนลด - ส่วนลดสินค้า',
  'ค่าบริการ', 'ยอดก่อนภาษี ยอดรวม + ค่าบริการ', 'ภาษี',
  'มูลค่า Voucher มูลค่า Voucher มีโอกาสที่จะมากกว่ายอดรวมทั้งบิล ส่วนลดที่ใช้ได้สูงสุดจึงเป็นยอดรวมของบิล',
  'ส่วนลด Voucher', 'ยอดปัดเศษ', 'ค่าจัดส่ง',
  'รวมสุทธิ (ยอดก่อนภาษี + ภาษี +  ยอดปัดเศษ) -  ยอดขายสินค้าไม่มีภาษี', 'ทิป', 'คืนเงิน',
  'จำนวนบิล', 'สาขา',
];

test('🔴 ตัดแถวชื่อรายงานออกจาก header และตัดแถว Total ออกจากข้อมูล (ไฟล์จริง 2026-09-23)', () => {
  const p = makeXlsx('salebysumdate.xlsx', REAL_HEADER_XML);
  const sheet = readFoodStorySheet(p, { headerRowIndex: 1 });

  assert.equal(sheet.title, 'รายงานสรุปยอดขายแยกตามวัน');
  assert.equal(sheet.header.length, 17);
  assert.deepEqual([...sheet.header], REAL_HEADER);
  // ช่วงที่ทดสอบไม่มียอดขายจริง — เหลือแค่แถว Total ที่ถูกตัดออก จึงไม่มีแถวข้อมูลเลย
  assert.equal(sheet.rows.length, 0);
});

test('🔴 headerRowIndex + dataStartRowIndex ต่างกันได้จริงต่อรายงาน (ไฟล์จริงของ outputtax 2026-09-23)', () => {
  // จำลองรูปย่อของ outputtax จริง: แถว metadata 5 แถวก่อน header ที่แถว 5 (0-indexed) ตามด้วย
  // แถวลอย ๆ ("วัน เดือน ปี"/"เลขที่" ฯลฯ — ไม่ใช่ข้อมูล ยืนยันจริงว่าใช้คอลัมน์คนละชุดกับ
  // header/ข้อมูลจริง) ที่แถว 6 ก่อนข้อมูลจริงจะเริ่มที่แถว 7 — แถวสรุปท้ายใช้ "รวม" (ไทย)
  const p = makeXlsx(
    'outputtax-shape.xlsx',
    `<worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>รายงานภาษีขาย</t></is></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>เดือนภาษี สิงหาคม - กันยายน ปี 2569</t></is></c></row>
      <row r="3"><c r="A3" t="inlineStr"><is><t>ชื่อผู้ประกอบการ : Chaweng Buri Resort</t></is></c></row>
      <row r="4"><c r="A4" t="inlineStr"><is><t>เลขประจำตัวผู้เสียภาษีอากร</t></is></c></row>
      <row r="5"><c r="A5" t="inlineStr"><is><t>ที่อยู่ : ...</t></is></c></row>
      <row r="6">
        <c r="A6" t="inlineStr"><is><t>ใบกำกับภาษี</t></is></c>
        <c r="C6" t="inlineStr"><is><t>POS ID</t></is></c>
      </row>
      <row r="7">
        <c r="A7" t="inlineStr"><is><t>วัน เดือน ปี</t></is></c>
        <c r="B7" t="inlineStr"><is><t>เลขที่</t></is></c>
      </row>
      <row r="8"><c r="A8" t="inlineStr"><is><t>25/08/2569</t></is></c><c r="C8" t="inlineStr"><is><t>ABC123</t></is></c></row>
      <row r="9"><c r="A9" t="inlineStr"><is><t>รวม</t></is></c><c r="C9"><v>12160</v></c></row>
    </sheetData></worksheet>`,
  );
  const sheet = readFoodStorySheet(p, { headerRowIndex: 5, dataStartRowIndex: 7, totalRowMarkers: ['รวม'] });

  assert.deepEqual([...sheet.header], ['ใบกำกับภาษี', '', 'POS ID']);
  // แถวลอย ๆ (แถว 6) ต้องไม่ปนเข้ามาในข้อมูล — เหลือแค่แถวจริง 1 แถว ไม่ใช่ 2
  assert.equal(sheet.rows.length, 1);
  assert.deepEqual([...sheet.rows[0]!], ['25/08/2569', '', 'ABC123']);
});

test('ไม่มีแถว Total/รวม ก็ไม่ตัดแถวข้อมูลสุดท้ายทิ้ง (ยังไม่เคยเห็นไฟล์แบบนี้จริง — สมมุติฐานสังเคราะห์)', () => {
  const p = makeXlsx(
    'no-total-synthetic.xlsx',
    `<worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>ชื่อรายงาน</t></is></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>วันที่</t></is></c></row>
      <row r="3"><c r="A3" t="inlineStr"><is><t>23/09/2026</t></is></c></row>
    </sheetData></worksheet>`,
  );
  const sheet = readFoodStorySheet(p, { headerRowIndex: 1 });
  assert.equal(sheet.rows.length, 1);
  assert.deepEqual([...sheet.rows[0]!], ['23/09/2026']);
});

test('ไม่มีแถวข้อมูลเลย (แค่ชื่อรายงาน + header) คืน rows ว่างไม่ใช่ error', () => {
  const p = makeXlsx(
    'empty-data.xlsx',
    `<worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>ชื่อรายงาน</t></is></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>วันที่</t></is></c></row>
    </sheetData></worksheet>`,
  );
  assert.deepEqual(readFoodStorySheet(p, { headerRowIndex: 1 }).rows, []);
});

test('🔴 ไฟล์ที่มีแถวน้อยกว่า headerRowIndex ที่คาดล้มดัง ๆ แทนตีความมั่ว', () => {
  const p = makeXlsx(
    'too-few-rows.xlsx',
    `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>ชื่อรายงาน</t></is></c></row></sheetData></worksheet>`,
  );
  assert.throws(() => readFoodStorySheet(p, { headerRowIndex: 1 }), /คาดว่า header อยู่ที่แถว 1/);
});

test('🔴 outputtax มีชีต "Full Tax Invoice" ต่อท้าย — ประกาศไว้แล้วอ่านชีตแรกเป็นข้อมูล ไม่ล้ม', () => {
  // ไฟล์จริงของ outputtax (ทุกรอบที่มีในคลัง 2026-10-13) มี 2 ชีต: "Output Tax" กับ "Full Tax Invoice" ที่หัวตารางตรงกับ
  // รายงาน fulltaxinvoice — ชีตที่สองเป็นตารางของรายงานอื่นที่ดึงแยกอยู่แล้ว จึงประกาศไว้ในนิยามว่ารู้จัก
  const p = makeWorkbook('outputtax-two-tabs.xlsx', [
    { name: 'Output Tax', file: 'sheet1.xml', xml: sheetXml([['รายงานภาษีขาย'], ['เลขที่', 'ยอด'], ['1', '100'], ['รวม', '100']]) },
    { name: 'Full Tax Invoice', file: 'sheet2.xml', xml: sheetXml([['รายงานใบกำกับเต็มรูป'], ['เลขที่', 'ยอด'], ['รวม', '0']]) },
  ]);

  const sheet = readFoodStorySheet(p, { headerRowIndex: 1, knownExtraSheets: ['Full Tax Invoice'] });

  assert.deepEqual([...sheet.header], ['เลขที่', 'ยอด']);
  assert.deepEqual(sheet.rows.map((r) => [...r]), [['1', '100']]);
});

test('🔴 ชีตที่ไม่ได้ประกาศไว้ในนิยาม — ล้มพร้อมบอกชื่อชีต ไม่ทิ้งเงียบ ๆ', () => {
  const p = makeWorkbook('unknown-tab.xlsx', [
    { name: 'Output Tax', file: 'sheet1.xml', xml: sheetXml([['t'], ['เลขที่'], ['1']]) },
    { name: 'Something New', file: 'sheet2.xml', xml: sheetXml([['x'], ['y']]) },
  ]);
  assert.throws(() => readFoodStorySheet(p, { headerRowIndex: 1 }), /Something New/);
});
