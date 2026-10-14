/**
 * สัญญาที่ทุกรายงานของ FoodStory ต้องทำตาม — **ไม่ใช่ interface เดียวกับ HotelTime**
 * โดยเจตนา (ADR-0004) รูปร่างต่างกันจริงเพราะกลไกของเว็บต่างกันสิ้นเชิง (jQuery DataTables
 * ไม่มี postback เทียบกับ ASP.NET WebForms) การบังคับให้ใช้ shape เดียวกันจะได้แค่ field
 * ที่ไม่มีความหมายฝั่งใดฝั่งหนึ่งเต็มไปหมด
 *
 * ไม่มี `applyFilters`/ช่วงวันที่ในนี้โดยเจตนา — ต่างจาก HotelTime ตรงที่ช่วงวันที่ของ
 * FoodStory เป็น **session state ระดับรอบการรัน** ไม่ใช่ระดับรายงาน (สเปกต้นทาง §4.2: ตั้ง
 * ครั้งเดียวแล้วคงอยู่ข้ามหน้ารายงาน) จึงเรียก `setDateRangeByTyping` จาก runner ครั้งเดียว
 * ก่อนวนลูปรายงาน ไม่ใช่ให้แต่ละรายงานประกาศ/เรียกเอง
 */
export type Report = {
  readonly id: string;
  readonly label: string;
  /** path ใต้ baseUrl เช่น '/th/salebysumdate' */
  readonly path: string;
  /** ข้อความปุ่ม export ที่ต้องกด — 'Excel' (toolbar A/B) หรือ 'Export Excel' (toolbar C/D) */
  readonly exportButtonText: string;
  /**
   * control ทั้งหมดที่รายงานนี้แตะจริงผ่าน primitives ของ interactions.ts — บังคับผ่าน
   * `core/gate.ts::assertControlAllowed` ก่อนทุกครั้ง (เกราะแบบเดียวกับ HotelTime ตกลงกันไว้
   * ตอน grill แม้ implementation จะต่างกัน — ดู ticket 02)
   */
  readonly allowedControls: readonly string[];
  /** หัวตารางที่คาดหวัง — ต่างจากนี้แปลว่ารายงานเปลี่ยนโครง ต้องสำรวจใหม่ */
  readonly expectedColumns: readonly string[];
  /**
   * ตำแหน่งแถว header ในไฟล์ที่ดาวน์โหลดจริง (0-indexed) — **ต่างกันจริงต่อรายงาน** ห้ามสมมติว่า
   * เป็นแถว 1 เสมอ (ยืนยันจริง: `salebysumdate` แถว 1, `outputtax` แถว 5 — มีแถว metadata
   * บริษัท/เลขผู้เสียภาษี/ที่อยู่คั่นอยู่ก่อน) ส่งต่อให้ `xlsx.ts::readFoodStorySheet()` ตรง ๆ
   */
  readonly headerRowIndex: number;
  /**
   * แถวแรกที่เป็นข้อมูลจริง (0-indexed) — ระบุเฉพาะเมื่อไม่ใช่ `headerRowIndex + 1` (ปกติของ
   * รายงานส่วนใหญ่) `outputtax` ต้องระบุเพราะมีแถวลอย ๆ คั่นอยู่ระหว่าง header กับข้อมูลจริง
   */
  readonly dataStartRowIndex?: number;
  /** คำที่ใช้ระบุแถวสรุปท้ายตาราง — ค่า default ('Total','รวม') ใช้ได้กับส่วนใหญ่ ระบุเฉพาะเมื่อต่าง */
  readonly totalRowMarkers?: readonly string[];
  /**
   * ชีตอื่นนอกจากชีตแรกที่ไฟล์ของรายงานนี้มีจริงและรู้แล้วว่าคืออะไร — ไม่ประกาศ = ไฟล์ที่มีชีตเกินจะล้มดัง ๆ
   * (ส่งต่อให้ `readFoodStorySheet()` · ticket 01 ของ exporter-daily-per-day-raw)
   */
  readonly knownExtraSheets?: readonly string[];
};
