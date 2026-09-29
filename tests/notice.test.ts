import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noticeFlex, noticeMessage, noticeText, type Notice } from '../src/domain/notice';
import { MophAlertProvider, mophRequest } from '../src/providers/moph-alert';

const notice: Notice = { kind: 'NEW', name: 'บุคลากรสมมติ', date: '2027-01-29', time: '08:31:00', service: 'แพทย์แผนไทย', location: 'ห้องบัตร' };

test('notice text reads well for every kind and never prints null', () => {
  const text = noticeText(notice);
  for (const part of ['โรงพยาบาลพลับพลาชัย', 'คุณบุคลากรสมมติ', '29 มกราคม 2570', '08:31 น.', 'แพทย์แผนไทย', 'ห้องบัตร']) assert.ok(text.includes(part), part);
  assert.match(noticeText({ ...notice, kind: 'REMINDER', daysBefore: 2 }), /อีก 2 วัน/);
  assert.match(noticeText({ ...notice, kind: 'CHANGED' }), /เปลี่ยนแปลง/);
  assert.ok(!noticeText({ ...notice, time: null, location: '' }).includes('null'));
});

test('flex card follows the LINE bubble shape and shows the logo only from an https URL', () => {
  const flex = noticeFlex(notice, 'https://example.test/logo.png');
  assert.equal(flex.type, 'flex'); assert.equal(flex.contents.type, 'bubble');
  assert.ok(JSON.stringify(flex).includes('https://example.test/logo.png'));
  assert.ok(!JSON.stringify(noticeFlex(notice)).includes('"type":"image"'));
  assert.ok(flex.altText.length <= 400);
});

test('request body per mode: flex via messages, MOPH template via template endpoint', () => {
  const message = noticeMessage(notice);
  const flex = mophRequest('1111111111111', message, 'flex');
  assert.match(flex.url, /\/alert\/v3\.1\/messages$/);
  assert.equal((flex.body as { messages: { type: string }[] }).messages[0].type, 'flex');
  const template = mophRequest('1111111111111', message, 'template');
  assert.match(template.url, /\/alert\/v3\.1\/template$/);
  assert.equal((template.body as { cid: string }).cid, '1111111111111');
  assert.equal((template.body as { message_type: string }).message_type, 'HPT');
});

test('a rejected flex card falls back once to the MOPH template; an uncertain result never does', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { MOPH_LIVE_ENABLED: 'true', MOPH_CLIENT_KEY: 'k', MOPH_SECRET_KEY: 's' }); delete process.env.MOPH_API_MODE;
  try {
    const urls: string[] = [];
    const rejectFlex = new MophAlertProvider(async url => { urls.push(String(url));
      return String(url).endsWith('/messages') ? Response.json({ message_code: 404, message: 'Error template' }, { status: 200 }) : Response.json({ message_code: 200, message: 'Success' }); });
    assert.equal((await rejectFlex.send('1111111111111', noticeMessage(notice))).outcome, 'ACCEPTED');
    assert.deepEqual(urls.map(u => u.split('/').pop()), ['messages', 'template']);
    urls.length = 0;
    const uncertain = new MophAlertProvider(async url => { urls.push(String(url)); return new Response('oops', { status: 502 }); });
    assert.equal((await uncertain.send('1111111111111', noticeMessage(notice))).outcome, 'UNKNOWN');
    assert.equal(urls.length, 1);
  } finally { process.env = saved; }
});
