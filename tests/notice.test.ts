import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labGroups, noticeFlex, noticeTitle, noticeMessage, noticeText, type Notice } from '../src/domain/notice';
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

test('every notice tells the person to bring the national ID card', () => {
  assert.ok(noticeText(notice).includes('บัตรประจำตัวประชาชน'));
  assert.ok(JSON.stringify(noticeFlex(notice)).includes('บัตรประจำตัวประชาชน'));
  assert.ok(noticeMessage(notice).html.includes('บัตรประจำตัวประชาชน'));
});

test('LAB notice lists the tests formally and adds preparation only when the tests need it', () => {
  const lab: Notice = { ...notice, service: 'LAB', tests: ['CBC', 'FBS', 'UA'] };
  const text = noticeText(lab);
  assert.ok(text.includes('• การตรวจเลือด') && text.includes('• การตรวจปัสสาวะ'));
  assert.ok(!text.includes('CBC') && !text.includes('FBS'), 'no item codes in the notice');
  assert.ok(text.includes('งดอาหารและเครื่องดื่มทุกชนิด ยกเว้นน้ำเปล่า อย่างน้อย 8 ชั่วโมง'));
  assert.ok(text.includes('ปัสสาวะช่วงกลาง'));
  assert.ok(JSON.stringify(noticeFlex(lab)).includes('การเตรียมตัวก่อนรับการตรวจ'));
  const cbcOnly = noticeText({ ...notice, service: 'LAB', tests: ['CBC'] });
  assert.ok(!cbcOnly.includes('งดอาหาร') && !cbcOnly.includes('ปัสสาวะ'));
  assert.ok(!noticeText(notice).includes('🧪'));
});

test('only blood, urine and other examinations are named; EKG, sputum and X-ray are other, not blood', () => {
  const text = noticeText({ ...notice, service: 'LAB', tests: ['EKG', 'Sputum for AFB', 'CXR'] });
  assert.ok(text.includes('• การตรวจอื่นๆ'));
  assert.ok(!text.includes('การตรวจเลือด') && !text.includes('คลื่นไฟฟ้าหัวใจ'));
  assert.deepEqual(labGroups(['CBC', 'UA', 'EKG']), ['การตรวจเลือด', 'การตรวจปัสสาวะ', 'การตรวจอื่นๆ']);
  assert.ok(text.includes('เก็บเสมหะ'));
});

test('preparation ticked in HOSxP replaces the generic advice; "อื่นๆ" LAB is an other examination', () => {
  const text = noticeText({ ...notice, service: 'LAB', tests: ['FBS', 'อื่นๆ'], preparation: ['งดน้ำและอาหาร 10-12 ชั่วโมง (หลัง 2 ทุ่ม)'] });
  assert.ok(text.includes('งดน้ำและอาหาร 10-12 ชั่วโมง (หลัง 2 ทุ่ม)'));
  assert.ok(!text.includes('อย่างน้อย 8 ชั่วโมง'));
  assert.deepEqual(labGroups(['FBS', 'อื่นๆ']), ['การตรวจเลือด', 'การตรวจอื่นๆ']);
  assert.ok(noticeText({ ...notice, preparation: ['กรุณานำบัตรนัดมาด้วย'] }).includes('กรุณานำบัตรนัดมาด้วย'));
});

test('every notice asks for the patient record book if the person has one', () => {
  assert.ok(noticeText(notice).includes('สมุดประจำตัวผู้ป่วย (ถ้ามี)'));
  assert.ok(JSON.stringify(noticeFlex(notice)).includes('สมุดประจำตัวผู้ป่วย (ถ้ามี)'));
});

test('cancellation notice says the appointment is cancelled, asks nothing to be brought and gives the contact note', () => {
  const text = noticeText({ ...notice, kind: 'CANCELLED', service: 'LAB', tests: ['FBS'], preparation: ['งดน้ำและอาหาร 6-8 ชั่วโมง'] });
  assert.ok(text.includes('แจ้งยกเลิกวันนัด') && text.includes('ถูกยกเลิกแล้ว') && text.includes('29 มกราคม 2570'));
  assert.ok(!text.includes('สิ่งที่ต้องนำมา') && !text.includes('งดน้ำและอาหาร') && !text.includes('กรุณามาก่อนเวลานัด'));
  assert.ok(text.includes('หากต้องการนัดใหม่'));
  const flex = JSON.stringify(noticeFlex({ ...notice, kind: 'CANCELLED' }));
  assert.ok(flex.includes('#B91C1C') && !flex.includes('สิ่งที่ต้องนำมา'));
});

test('flex card: photo header fading into the notice colour, date box first, plain header without a photo', async () => {
  const n: Notice = { kind: 'NEW', name: 'ทดสอบ', date: '2027-01-29', time: '09:00:00', service: 'ทันตกรรม', location: 'ห้องบัตร' };
  const card = noticeFlex(n, 'https://example.test/hospital-logo.png', 'https://example.test/hospital-header.jpg') as { contents: { header: { contents: Record<string, unknown>[] }; body: { contents: Record<string, unknown>[] } } };
  const [photo, fade, content] = card.contents.header.contents;
  assert.deepEqual([photo.type, photo.url, photo.aspectMode, photo.aspectRatio], ['image', 'https://example.test/hospital-header.jpg', 'cover', '2:1']);
  assert.deepEqual(fade.background, { type: 'linearGradient', angle: '0deg', startColor: '#0D5B44', centerColor: '#0D5B44CC', centerPosition: '50%', endColor: '#0D5B4400' });
  for (const layer of [fade, content]) assert.equal(layer.position, 'absolute');
  assert.ok(JSON.stringify(content).includes('hospital-logo.png'));
  const body = JSON.stringify(card.contents.body);
  for (const part of ['เรียน คุณทดสอบ', '"text":"29"', 'ม.ค. 70', 'วันศุกร์ที่ 29 มกราคม 2570', '09:00 น.', 'ห้องบัตร', 'สิ่งที่ต้องนำมา']) assert.ok(body.includes(part), part);
  const red = noticeFlex({ ...n, kind: 'CANCELLED' }, undefined, 'https://example.test/hospital-header.jpg') as typeof card;
  assert.equal((red.contents.header.contents[1].background as { startColor: string }).startColor, '#B91C1C');
  assert.ok(JSON.stringify(red.contents.body).includes('line-through'), 'cancelled date and time are struck through');
  assert.ok(!JSON.stringify(red.contents.body).includes('สิ่งที่ต้องนำมา'));
  assert.ok(JSON.stringify(noticeFlex({ ...n, time: null })).includes('โปรดติดต่อเจ้าหน้าที่เพื่อยืนยันเวลา'));
  const plain = JSON.stringify(noticeFlex(n, 'https://example.test/hospital-logo.png'));
  assert.ok(!plain.includes('hospital-header.jpg') && !plain.includes('linearGradient'), 'no photo URL: plain colour header');
  const { publicHeaderUrl } = await import('../src/providers/moph-alert');
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { APP_ORIGIN: 'https://hc.example.test/', PUBLIC_LOGO_URL: '', PUBLIC_HEADER_URL: '' });
    assert.equal(publicHeaderUrl(), 'https://hc.example.test/hospital-header.jpg');
    Object.assign(process.env, { APP_ORIGIN: 'http://192.168.1.5:5600' });
    assert.equal(publicHeaderUrl(), 'https://raw.githubusercontent.com/Jacob-SSR/plaplachai-health-check/main/public/hospital-header.jpg', 'LAN http web: the public copy on GitHub');
    Object.assign(process.env, { PUBLIC_HEADER_URL: 'https://cdn.example.test/front.jpg' });
    assert.equal(publicHeaderUrl(), 'https://cdn.example.test/front.jpg');
  } finally { process.env = saved; }
});

test('show_brand off hides the logo and hospital name row on the card header, title stays', () => {
  const n: Notice = { kind: 'NEW', name: 'ทดสอบ', date: '2027-01-29', time: '09:00:00', service: 'ทันตกรรม', location: 'ห้องบัตร' };
  const shown = JSON.stringify((noticeFlex(n, 'https://example.test/hospital-logo.png', 'https://example.test/hospital-header.jpg') as { contents: { header: unknown } }).contents.header);
  const hidden = JSON.stringify((noticeFlex({ ...n, showBrand: false }, 'https://example.test/hospital-logo.png', 'https://example.test/hospital-header.jpg') as { contents: { header: unknown } }).contents.header);
  assert.ok(shown.includes('hospital-logo.png') && shown.includes('"text":"โรงพยาบาลพลับพลาชัย"'));
  assert.ok(!hidden.includes('hospital-logo.png') && !hidden.includes('"text":"โรงพยาบาลพลับพลาชัย"'));
  assert.ok(hidden.includes('hospital-header.jpg') && hidden.includes(noticeTitle(n)));
});
