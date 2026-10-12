/**
 * ประตูบังคับอ่านอย่างเดียว
 *
 * ทุกการแตะหน้าเว็บ (กรอกช่อง/กดปุ่ม/กดลิงก์) ต้องผ่านฟังก์ชันนี้ก่อนเสมอ — เป็นชั้นเดียว
 * ในระบบที่บังคับได้ว่ารายงานหนึ่งจะแตะได้เฉพาะ control ที่ตัวเองประกาศไว้ล่วงหน้าเท่านั้น
 * เหตุผล: หน้าผลลัพธ์บางหน้ามีปุ่มที่เขียนข้อมูลจริง (เช่น `Reinstate room` ใน
 * `ResDeleteList.aspx` — ดู `specs/02-spec-hoteltime-constraints.md` §7) และเมื่อ
 * นิยามรายงานเริ่มถูกสร้างโดย AI จำนวนมาก จะไม่มีคนรีวิวทุกใบเหมือนแต่ก่อน — ดู ADR-0001
 */
export class GateError extends Error {
  override readonly name = 'GateError';
}

export function assertControlAllowed(
  allowedControls: readonly string[],
  controlName: string,
  reportId: string,
): void {
  if (!allowedControls.includes(controlName)) {
    throw new GateError(
      `รายงาน "${reportId}" พยายามแตะ control "${controlName}" ซึ่งไม่อยู่ในรายการที่อนุญาต\n` +
        `  รายการที่อนุญาต: ${
          allowedControls.length === 0 ? '(ว่าง — ไม่อนุญาตอะไรเลย)' : allowedControls.join(', ')
        }`,
    );
  }
}
