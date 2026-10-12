/**
 * ตัวกรองความลับออกจากข้อความก่อนพิมพ์ / ก่อนโยน error
 *
 * ทำไมต้องมี: ข้อความ error ของ Playwright ชอบแนบ HTML ของหน้าหรือค่าที่กรอกลงฟอร์มมาด้วย
 * และหน้า HotelTime เป็น WebForms ที่ echo ค่าใน __VIEWSTATE — รหัสผ่านจึงหลุดลง log
 * ได้ง่ายกว่าที่คิด ทุกอย่างที่จะพิมพ์ออกจอหรือลงไฟล์ต้องผ่านตัวนี้ก่อนเสมอ
 */

export type Redactor = (input: string) => string;

const MASK = '«redacted»';

/**
 * ความลับที่สั้นกว่านี้ไม่กรอง — เพราะถ้ารหัสคือ "123" การแทนที่ทุก "123"
 * จะทำลายข้อความจนอ่านไม่ออก และ mask เองก็ไม่ได้ช่วยอะไรเพราะเดาได้อยู่ดี
 */
const MIN_SECRET_LENGTH = 4;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createRedactor(secrets: readonly (string | undefined | null)[]): Redactor {
  const patterns = secrets
    .filter((s): s is string => typeof s === 'string' && s.length >= MIN_SECRET_LENGTH)
    // ยาวก่อน เผื่อความลับตัวหนึ่งเป็นส่วนหนึ่งของอีกตัว จะได้ไม่กรองครึ่ง ๆ กลาง ๆ
    .sort((a, b) => b.length - a.length)
    .flatMap((secret) => {
      const variants = new Set<string>([secret, encodeURIComponent(secret)]);
      return [...variants].map((v) => new RegExp(escapeRegExp(v), 'g'));
    });

  if (patterns.length === 0) return (input) => input;

  return (input) => patterns.reduce((acc, re) => acc.replace(re, MASK), input);
}

/** ดึงข้อความจาก error อะไรก็ได้ให้เป็น string แล้วกรองความลับออก */
export function redactError(err: unknown, redact: Redactor): string {
  const raw = err instanceof Error ? (err.stack ?? err.message) : String(err);
  return redact(raw);
}
