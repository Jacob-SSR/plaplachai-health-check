import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oappRange, readOappForRecipients, type OappReader } from '../src/server/hosxp';
import { hosxpFingerprint, activeHosxpStatus, futureHosxpAppointment } from '../src/server/hosxp-sync';
import { reminderText } from '../src/server/notifications';

const range = { from: '2026-10-01', to: '2026-10-31' };
const recipient = { id: 1, display_name: 'บุคลากรสมมติ', cid: '1234567890121' };
const appointment = { oapp_id: '9007199254740993', recipient_cid: recipient.cid,
  nextdate: '2026-10-02', nexttime: null, clinic: '015', depcode: '015',
  contact_point: 'ห้องบัตร', oapp_status_id: null, update_datetime: null };

test('oapp range defaults to Bangkok today and rejects invalid or unbounded ranges', () => {
  assert.deepEqual(oappRange(new URLSearchParams(), '2026-09-28'), { from: '2026-09-28', to: '2026-10-28' });
  for (const r of [{ from: '2026-02-29', to: '2026-03-01' },
    { from: '2026-10-02', to: '2026-10-01' }, { from: '2026-01-01', to: '2028-01-01' }]) {
    assert.throws(() => oappRange(new URLSearchParams(r)));
  }
});

test('oapp reads only existing recipients using bound CID values and removes identifiers from output', async () => {
  let calls = 0;
  const reader: OappReader = async (sql, values) => {
    calls++;
    assert.match(sql, /FROM oapp o JOIN patient p ON p.hn=o.hn/);
    assert.match(sql, /p.cid IN \(\?\)/);
    assert.ok(!sql.includes(recipient.cid));
    assert.deepEqual(values, [recipient.cid, range.from, range.to]);
    return [appointment, { ...appointment, oapp_id: '2', recipient_cid: 'unregistered' }];
  };
  const data = await readOappForRecipients([recipient], range, reader);
  assert.equal(calls, 1); assert.equal(data.length, 1);
  assert.equal(data[0].oapp_id, '9007199254740993');
  assert.equal(data[0].appointment_time, null);
  assert.equal(data[0].source_status_id, null);
  assert.equal(data[0].location, 'ห้องบัตร');
  assert.ok(!JSON.stringify(data).includes(recipient.cid));
  assert.ok(!('recipient_cid' in data[0]));
});

test('no source query for an empty register and invalid/duplicate CID cannot broaden the query', async () => {
  let calls = 0;
  const reader: OappReader = async () => { calls++; return []; };
  assert.deepEqual(await readOappForRecipients([], range, reader), []);
  await assert.rejects(readOappForRecipients([{ ...recipient, cid: "' OR 1=1" }], range, reader));
  await assert.rejects(readOappForRecipients([recipient, recipient], range, reader));
  assert.equal(calls, 0);
});

test('source failure and overflow are explicit, never a misleading empty or truncated result', async () => {
  await assert.rejects(readOappForRecipients([recipient], range, async () => { throw Error('SOURCE_OFFLINE'); }), /SOURCE_OFFLINE/);
  await assert.rejects(readOappForRecipients([recipient], range, async () => Array(1001).fill(appointment)), /ช่วงวันที่สั้นลง/);
});

test('source changes affecting the appointment change its fingerprint; unrelated edits do not', async () => {
  const [a] = await readOappForRecipients([recipient], range, async () => [appointment]);
  assert.equal(hosxpFingerprint(a), hosxpFingerprint({ ...a, source_updated_at: '2026-10-01 09:00:00' }));
  for (const change of [{ appointment_date: '2026-10-03' }, { appointment_time: '09:30:00' },
    { employee_id: 2 }, { location: 'ห้องใหม่' }, { source_status_id: 9 }]) {
    assert.notEqual(hosxpFingerprint(a), hosxpFingerprint({ ...a, ...change }));
  }
});

test('unknown source statuses do not send and missing time is not fabricated', () => {
  const saved=process.env.HOSXP_ACTIVE_STATUS_IDS;
  try {
    delete process.env.HOSXP_ACTIVE_STATUS_IDS;
    assert.equal(activeHosxpStatus(null), true);
    assert.equal(activeHosxpStatus(99), false);
    process.env.HOSXP_ACTIVE_STATUS_IDS='NULL,1';
    assert.equal(activeHosxpStatus(1), true);
  } finally {
    if(saved===undefined)delete process.env.HOSXP_ACTIVE_STATUS_IDS;else process.env.HOSXP_ACTIVE_STATUS_IDS=saved;
  }
  const now=new Date('2026-10-02T02:30:00Z');
  assert.equal(futureHosxpAppointment('2026-10-02',null,now),true);
  assert.equal(futureHosxpAppointment('2026-10-02','09:00:00',now),false);
  assert.equal(futureHosxpAppointment('2026-10-01',null,now),false);
  assert.match(reminderText({appointment_date:'2026-10-02',appointment_time:null,location:''}),/ยืนยันเวลา/);
  assert.ok(!reminderText({appointment_date:'2026-10-02',appointment_time:null}).includes('null'));
});
