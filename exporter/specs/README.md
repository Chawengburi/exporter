# specs — pms-export

> ชื่อเดิมของ `exporter/` ก่อน rename 2026-09-28 (ADR-0004) — spec ชุดนี้เขียนก่อน rename จึงคง
> ชื่อ `pms-export` และ prefix `PMS_*` ไว้ตามจริง ณ ตอนนั้น (ตอนนี้คือคำสั่ง `exporter` และ `HOTELTIME_*`)

เอกสารการ **ตัดสินใจ** ของโปรเจกต์นี้ · แยกจาก [`../recon/NOTES.md`](../recon/NOTES.md)
ซึ่งเก็บ **สิ่งที่สังเกตเห็น** จากการสำรวจของจริง

> กติกา: อะไรที่วัดมาจากเว็บจริงอยู่ใน `recon/NOTES.md` · อะไรที่เรา *เลือก* ว่าจะทำแบบไหน
> และเพราะอะไร อยู่ในนี้ · spec ทุกใบต้องอ้างหลักฐานกลับไปที่ NOTES ไม่ใช่ยืนยันลอย ๆ

| # | ไฟล์ | ครอบคลุม |
|---|---|---|
| 01 | [01-spec-scope-and-architecture.md](./01-spec-scope-and-architecture.md) | ทำไมมีโปรเจกต์นี้ · รูปแบบ "AI เขียน สคริปต์รัน" · ขอบเขตที่ตกลงและสิ่งที่จงใจไม่ทำ |
| 02 | [02-spec-hoteltime-constraints.md](./02-spec-hoteltime-constraints.md) | ข้อจำกัด 6 ข้อของ HotelTime ที่บังคับดีไซน์ · **อ่านก่อนแก้โค้ดใด ๆ** |
| 03 | [03-spec-report-definition.md](./03-spec-report-definition.md) | ทำไม `reports/` เป็น TypeScript ไม่ใช่ JSON · สัญญาของ `Report` · วิธีเพิ่มรายงานใหม่ |
| 04 | [04-spec-verification.md](./04-spec-verification.md) | ชั้นตรวจ 5 ด่าน · ด่านที่ถอดออกและเพราะอะไร · บั๊กที่ชั้นตรวจจับได้จริง |
| 05 | [05-spec-output-and-provenance.md](./05-spec-output-and-provenance.md) | `--format raw\|csv\|both` · การรวมเป็นไฟล์รายปี · `manifest.json` |
| 06 | [06-spec-credentials-and-session.md](./06-spec-credentials-and-session.md) | `.env` และลำดับความสำคัญ · การกันความลับหลุด · ทำไมล็อกอินใหม่ทุกรอบ |
| 07 | [07-spec-audit-trail-export.md](./07-spec-audit-trail-export.md) | 🚧 **DRAFT** — ดึง Audit trail ซึ่ง**ไม่มีปุ่ม export** · เพดาน 500 แถว · สิ่งที่ต้องแก้ในโค้ดเดิม |
| 08 | [08-spec-multi-site.md](./08-spec-multi-site.md) | 🚧 **DRAFT** — ทำให้ย้ายไปเว็บอื่น/instance อื่นได้ · `--profile` ที่ทำได้เลย · ชั้น `Site` ที่**จงใจยังไม่ทำ** |
| 09 | [09-spec-recon-schema-and-codegen.md](./09-spec-recon-schema-and-codegen.md) | 🔄 **REVISED (2026-09-18)** — ลด **token ต่อรายงานใหม่** จาก ~100k เหลือ ~2k · recon schema + generator · จำนวนจริง 66 หน้ามี export (วัดจาก sweep ไม่ใช่ประมาณ) · go/no-go: GO ทำ §12 ก่อน ยังไม่ GO เขียน generator |

**ลำดับการอ่านสำหรับคนที่เพิ่งมารับงาน:** 01 → 02 → 03 · ที่เหลืออ่านเมื่อจะแตะส่วนนั้น

สถานะ: ใบ 01–06 **ACCEPTED (2026-09-08)** — เขียนหลังรันจริงครบทั้ง 3 รายงานแล้ว ทุกตัวเลขวัดมาจริง ·
ใบ 07 **DRAFT** — สำรวจหน้าจริงแล้วแต่ยังไม่ได้เขียนโค้ด ·
ใบ 08 **DRAFT** — วิเคราะห์จากโค้ดที่มีอยู่ ยังไม่มีเว็บที่สองให้สำรวจ ·
ใบ 09 **REVISED (2026-09-18)** — เนื้อหา DRAFT เดิม (2026-09-10) ยังอยู่ครบ เพิ่ม §0 กับ §15
อธิบายว่าอะไรแทนที่แล้วจริง (ดู ADR-0001) กับ go/no-go ที่แก้ใหม่จากตัวเลขจริง (66 หน้ามี export
ไม่ใช่ตัวเลขประมาณ) · **เริ่มที่ §12 ก่อนเสมอ** (ทดลองย้อนหลังกับ 3 รายงานที่มีเฉลยอยู่แล้ว ฟรี
— ยังไม่มีใครทำ)
