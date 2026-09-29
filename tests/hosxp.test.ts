import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oappRange, readPersonnelOapp, type OappReader } from '../src/server/hosxp';
import { hosxpFingerprint, activeHosxpStatus, futureHosxpAppointment } from '../src/server/hosxp-sync';
import { reminderText } from '../src/server/notifications';
import { fiscalYearForDate } from '../src/domain/validation';
import { calendarPeriod } from '../src/server/public-calendar';

const range = { from: '2026-10-01', to: '2026-10-31' };
const appointment = { oapp_id: '9007199254740993', personnel_code: 'S001', personnel_name: 'บุคลากรสมมติ',
  nextdate: '2026-10-02', nexttime: null, clinic: '015', depcode: '006', doctor:'D001', doctor_name:'ผู้ให้บริการสมมติ', department_name:'ห้องชันสูตร',
  contact_point: 'ห้องบัตร', oapp_status_id: null, update_datetime: null };

test('oapp range defaults to Bangkok today and rejects invalid or unbounded ranges', () => {
  assert.deepEqual(oappRange(new URLSearchParams(), '2026-09-28'), { from: '2026-09-28', to: '2026-10-28' });
  for (const r of [{ from: '2026-02-29', to: '2026-03-01' },
    { from: '2026-10-02', to: '2026-10-01' }, { from: '2026-01-01', to: '2028-01-01' }]) {
    assert.throws(() => oappRange(new URLSearchParams(r)));
  }
});

test('personnel are matched by name or non-empty CID, bound values only, and identifiers are not returned', async () => {
  let calls = 0;
  const reader: OappReader = async (sql, values) => {
    calls++;
    assert.match(sql, /FROM oapp o JOIN patient p ON p.hn=o.hn/);
    assert.match(sql, /s.active='Y'/);
    assert.match(sql, /REPLACE\(s.name,' ',''\)=REPLACE\(CONCAT\(TRIM\(p.fname\),TRIM\(p.lname\)\),' ',''\)/);
    assert.match(sql, /TRIM\(s.cid\)<>'' AND s.cid=p.cid/);
    assert.deepEqual(values, [range.from, range.to,'033','006','019','023']);
    // One person with two doctor codes matches twice: reported once.
    return [appointment, { ...appointment, personnel_code: 'S002' }];
  };
  const data = await readPersonnelOapp(range, {}, reader);
  assert.equal(calls, 1); assert.equal(data.length, 1);
  assert.equal(data[0].oapp_id, '9007199254740993');
  assert.equal(data[0].display_name, 'บุคลากรสมมติ');
  assert.equal(data[0].appointment_time, null);
  assert.equal(data[0].location, 'ห้องบัตร');
  assert.ok(!('cid' in data[0]) && !('hn' in data[0]));
});

test('filters cannot broaden the query', async () => {
  let called = false;
  const reader: OappReader = async () => { called = true; return []; };
  await assert.rejects(readPersonnelOapp(range, { room: '000' }, reader));
  await assert.rejects(readPersonnelOapp(range, { personnel: 'x'.repeat(41) }, reader));
  assert.equal(called, false);
});

test('source failure and overflow are explicit, never a misleading empty or truncated result', async () => {
  await assert.rejects(readPersonnelOapp(range, {}, async () => { throw Error('SOURCE_OFFLINE'); }), /SOURCE_OFFLINE/);
  await assert.rejects(readPersonnelOapp(range, {}, async () => Array.from({length:1001},(_,i)=>({...appointment,oapp_id:String(i)}))), /ช่วงวันที่สั้นลง/);
});

test('source changes affecting the appointment change its fingerprint; unrelated edits do not', async () => {
  const [source] = await readPersonnelOapp(range, {}, async () => [appointment]);
  const a = { ...source, employee_id: 1 };
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
    assert.equal(activeHosxpStatus(1), true);
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

test('Thai fiscal year follows appointment date at the October boundary without a selected year',()=>{
  for(const [day,year] of [['2026-09-30',2569],['2026-10-01',2570],['2027-01-01',2570],['2027-09-30',2570],['2027-10-01',2571]] as const){
    assert.equal(fiscalYearForDate(day),year);
  }
  assert.throws(()=>fiscalYearForDate('2026-02-29'));
  const period=calendarPeriod(new URLSearchParams({month:'2026-10',year:'wrong-old-selection'}));
  assert.equal(period.year.fiscal_year,2570);
  assert.equal(period.year.start_date,'2026-10-01');
  assert.equal(period.year.end_date,'2027-09-30');
  assert.throws(()=>calendarPeriod(new URLSearchParams({month:'2026-13'})));
});

test('only four rooms are returned and provider filters are bound SQL values',async()=>{
  const data=await readPersonnelOapp(range,{room:'006',doctor:'D001',personnel:'S001'},async(sql,values)=>{
    assert.match(sql,/LEFT JOIN doctor d ON d.code=o.doctor/);
    assert.match(sql,/LEFT JOIN kskdepartment k ON k.depcode=o.depcode/);
    assert.deepEqual(values,[range.from,range.to,'006','D001','S001']);
    assert.ok(!sql.includes('D001'));
    return [appointment,{...appointment,oapp_id:'other-room',depcode:'000'}];
  });
  assert.equal(data.length,1);assert.equal(data[0].room_name,'LAB');
  assert.equal(data[0].doctor_name,'ผู้ให้บริการสมมติ');assert.equal(data[0].fiscal_year,2570);
  const all=await readPersonnelOapp(range,{},async()=>[
    ...['033','006','019','023','000'].map(depcode=>({...appointment,oapp_id:depcode,depcode}))]);
  assert.equal(all.length,4);
});
