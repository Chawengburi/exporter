import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRedactor, redactError } from '../src/core/redact.ts';

test('กรองรหัสผ่านออกจากข้อความ', () => {
  const redact = createRedactor(['hunter2secret']);
  assert.equal(redact('login failed for hunter2secret'), 'login failed for «redacted»');
});

test('กรองทุกครั้งที่เจอ ไม่ใช่ครั้งแรกครั้งเดียว', () => {
  const redact = createRedactor(['s3cr3tpw']);
  assert.equal(redact('s3cr3tpw and s3cr3tpw'), '«redacted» and «redacted»');
});

test('กรองรูปแบบ url-encoded ด้วย เพราะ WebForms echo ค่าที่ post กลับมา', () => {
  const redact = createRedactor(['p@ss word']);
  assert.equal(redact('body=p%40ss%20word'), 'body=«redacted»');
});

test('ความลับที่สั้นเกินไปไม่กรอง — จะทำลายข้อความจนอ่านไม่ออก', () => {
  const redact = createRedactor(['abc']);
  assert.equal(redact('abcdef'), 'abcdef');
});

test('ความลับที่ยาวกว่าถูกกรองก่อน ไม่ให้ตัวสั้นกัดตัวยาวขาดครึ่ง', () => {
  const redact = createRedactor(['pass', 'password123']);
  assert.equal(redact('my password123 here'), 'my «redacted» here');
});

test('อักขระพิเศษใน regex ไม่ทำให้พัง', () => {
  const redact = createRedactor(['a.*b[c]$']);
  assert.equal(redact('x a.*b[c]$ y'), 'x «redacted» y');
  assert.equal(redact('x aXXbc y'), 'x aXXbc y');
});

test('ไม่มีความลับให้กรอง ก็คืนข้อความเดิม', () => {
  const redact = createRedactor([undefined, null, '']);
  assert.equal(redact('nothing to hide'), 'nothing to hide');
});

test('redactError กรองความลับที่ติดมากับ stack ของ error', () => {
  const redact = createRedactor(['topsecretvalue']);
  const err = new Error('failed to fill topsecretvalue');
  assert.ok(!redactError(err, redact).includes('topsecretvalue'));
});

test('redactError รับค่าที่ไม่ใช่ Error ได้', () => {
  const redact = createRedactor(['topsecretvalue']);
  assert.equal(redactError('boom topsecretvalue', redact), 'boom «redacted»');
});
