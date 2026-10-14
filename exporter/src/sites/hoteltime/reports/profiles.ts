import type { Page } from 'playwright';
import { formatDMY, type DateRange } from '../../../core/order.ts';
import { assertCheckboxes, gridRowCount, setDateRange, setSelect } from '../webforms.ts';
import type { Report } from './_types.ts';

/**
 * Profiles (ticket 19 ของ exporter-daily-expansion-and-data-store) — ทะเบียนแขกตามการเข้าพัก · 🔴 **ข้อมูลส่วนบุคคลของแขกเยอะ**
 * (ชื่อ วันเกิด เลขพาสปอร์ต ที่อยู่ อีเมล โทรศัพท์) เจ้าของระบบยืนยันว่าต้องการทุกวัน (2026-10-07) · ห้ามแปะตัวอย่างข้อมูลที่ไหน
 *
 * แถวคือ **การเข้าพักที่คร่อมช่วงที่เลือก** ไม่ใช่รายการที่เกิดในช่วงนั้น (การตรวจเบื้องต้น: 128 จาก 2,640 แถวเข้าพักก่อนช่วง) — ใช้ด่าน
 * "คร่อมช่วง" (`overlapColumns`) · หน้า Foreign police (`?type=fpolice`) กรองแค่แขกต่างชาติ (จุดประสงค์ของรายงานตำรวจ) และให้
 * **เฉพาะแขกที่เข้าพักในช่วง** (การตรวจเบื้องต้น: 0 แถวเข้าพักก่อนช่วง) จึงใช้ด่านเดิมที่เข้มกว่า (Reservation from อยู่ในช่วงพอดี)
 * · ช่องติ๊ก "กรองด้วยวันเข้าพัก" (`cbDateArrival`) คือตัวที่ทำให้สองหน้าต่างกัน: guest book **ไม่ติ๊ก** (= การเข้าพักที่คร่อมช่วง) ·
 * Foreign police **ติ๊ก** (= เข้าพักในช่วง) — ยืนยันสถานะทุกรอบ · ดรอปดาวน์ประเทศ/กลุ่มห้องตั้งแบบ explicit — ค่าตั้งต้นเปลี่ยนเงียบ ๆ แล้ว
 * Foreign police จะกลายเป็นทะเบียนแขกทั้งหมด หรือกลุ่มห้องหายไปบางส่วน ซึ่งด่านวันที่จับไม่ได้
 * · แกนวันที่เป็นวันเข้าพัก (แก้ย้อนหลังได้ เหมือน arrival-period) — baseline เก็บการแก้ (ADR-0002)
 * · recon อ่านอย่างเดียว 2026-10-07 อยู่ใน `recon/NOTES.md`
 */

const RANGE = 'ctl00$pc'; // ช่องชื่อ ctl00$pc$calFrom/calTo ตรง ๆ — setDateRange ต่อ suffix ให้ (ไม่ใช่ทั้ง panel)
const COUNTRY = 'ctl00$pc$ddlCountry';
const COUNTRY_FILTER = 'ctl00$pc$ddlCountryFilter';
const ROOM_GROUP = 'ctl00$pc$ddlRoomGroup';
const FIND = 'ctl00$pc$btnFind';
const ALLOWED_CONTROLS = [RANGE, COUNTRY, COUNTRY_FILTER, ROOM_GROUP, FIND];

type ProfilesSpec = {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly expectedColumns: readonly string[];
  /** ค่าดรอปดาวน์ประเทศ / ฐานการกรองประเทศ ตามค่าตั้งต้นของหน้านั้น (recon 2026-10-07) */
  readonly country: string;
  readonly countryFilter: string;
  /** แถวคือการเข้าพักที่คร่อมช่วง (true) หรือเข้าพักในช่วงเท่านั้น (false → ด่านเดิมบน Reservation from) */
  readonly overlap: boolean;
  readonly filterNote: string;
};

function profiles(spec: ProfilesSpec): Report {
  return {
    id: spec.id,
    label: spec.label,
    path: spec.path,
    allowedControls: ALLOWED_CONTROLS,
    dailyOnly: false,
    family: 'per-day',
    skipDateCoverageCheck: false,
    ...(spec.overlap ? { overlapColumns: { from: 'Reservation from', to: 'Reservation to' } } : {}),
    // ~880 แถว/เดือน (2,640 ใน 90 วัน) — ทั้งช่วงเกิน 2000
    chunk: { kind: 'monthly', reason: '~880 แถว/เดือน — ทั้งช่วงเกินเพดาน 2000' },
    hasRowCap: true,
    dateColumn: 'Reservation from',
    filterNote: spec.filterNote,
    searchButton: FIND,
    boundaryToleranceDays: 0,
    expectedColumns: spec.expectedColumns,

    async applyFilters(page: Page, range: DateRange): Promise<void> {
      await assertCheckboxes(page, 'ctl00$pc$cbDateArrival', !spec.overlap);
      await setSelect(page, COUNTRY, spec.country, ALLOWED_CONTROLS, spec.id);
      await setSelect(page, COUNTRY_FILTER, spec.countryFilter, ALLOWED_CONTROLS, spec.id);
      await setSelect(page, ROOM_GROUP, '--- all ---', ALLOWED_CONTROLS, spec.id);
      await setDateRange(page, RANGE, formatDMY(range.from), formatDMY(range.to), ALLOWED_CONTROLS, spec.id);
    },
    async hasResults(page: Page): Promise<boolean> {
      const rows = await gridRowCount(page, '[id*="dtgData"]');
      return rows !== null && rows > 1;
    },
    async expectedRowCount(): Promise<number | null> {
      return null;
    },
  };
}

export const guestProfiles = profiles({
  id: 'guest-profiles',
  label: 'Profiles — guest book',
  path: 'GuestBook.aspx',
  country: '--- not specified ---',
  countryFilter: 'post address',
  overlap: true,
  filterNote: 'การเข้าพักที่คร่อมช่วง (Reservation from/to) — วันเข้าพักแก้ย้อนหลังได้ · baseline รายเดือนมีการเข้าพักที่คร่อมสิ้นเดือนซ้ำในสองก้อน (ไม่ตัดซ้ำ ADR-0002)',
  expectedColumns: [
    'Reservation ID', 'Reservation from', 'Reservation to', 'Stay nights', 'Stays', 'Title', 'Name', 'Last name',
    'Birthday:', 'Reason of stay', 'Nationality', 'Passport / document number', 'Visa number', 'Travel document type',
    'Valid until:', 'Street', 'City', 'Post Code', 'State', 'E-mail', 'Telephone', 'Room',
  ],
});

export const foreignPoliceProfiles = profiles({
  id: 'foreign-police-profiles',
  label: 'Profiles — foreign police report',
  path: 'GuestBook.aspx?type=fpolice',
  country: '--- foreign country ---',
  countryFilter: 'nationality',
  overlap: false,
  filterNote: 'แขกต่างชาติที่เข้าพักในช่วง (Reservation from) — วันเข้าพักแก้ย้อนหลังได้',
  expectedColumns: [
    'Reservation from', 'Reservation to', 'Stay nights', 'Title', 'Name', 'Last name', 'Birthday:', 'Reason of stay',
    'Nationality', 'Passport / document number', 'Visa number', 'Travel document type', 'Valid until:', 'Street', 'City',
    'Post Code',
  ],
});
