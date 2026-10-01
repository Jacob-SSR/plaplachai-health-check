import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oappRange, readPersonnelOapp, tickedLabs, preparationNotes, visitCharges, type OappReader } from '../src/server/hosxp';
import { hosxpFingerprint, activeHosxpStatus, futureHosxpAppointment } from '../src/server/hosxp-sync';
import { reminderText } from '../src/server/notifications';
import { fiscalYearForDate } from '../src/domain/validation';
import { calendarPeriod } from '../src/server/public-calendar';
import { reportStatus } from '../src/server/hosxp-report';

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
    // LAB included: every staff appointment is read (any clinic may order LAB), then filtered.
    assert.deepEqual(values, [range.from, range.to]);
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
    process.env.HOSXP_ACTIVE_STATUS_IDS='NULL';
    assert.equal(activeHosxpStatus(1), true);
    process.env.HOSXP_ACTIVE_STATUS_IDS='NULL,5';
    assert.equal(activeHosxpStatus(5), true);
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
    assert.deepEqual(values,[range.from,range.to,'D001','S001']);
    assert.ok(!sql.includes('D001'));
    return [appointment,{...appointment,oapp_id:'other-room',depcode:'000'}];
  });
  assert.equal(data.length,1);assert.equal(data[0].room_name,'LAB');
  assert.equal(data[0].doctor_name,'ผู้ให้บริการสมมติ');assert.equal(data[0].fiscal_year,2570);
  const all=await readPersonnelOapp(range,{},async()=>[
    ...['033','006','019','023','000'].map(depcode=>({...appointment,oapp_id:depcode,depcode}))]);
  assert.equal(all.length,4);
});

test('report status comes from the HOSxP visit link and the appointment date',()=>{
  assert.equal(reportStatus({visited:true,appointment_date:'2027-01-29'},'2026-09-29'),'ATTENDED');
  assert.equal(reportStatus({visited:false,appointment_date:'2027-01-29'},'2026-09-29'),'PENDING');
  assert.equal(reportStatus({visited:false,appointment_date:'2026-09-28'},'2026-09-29'),'MISSED');
});

test('an appointment from any clinic with a LAB order is a LAB appointment',async()=>{
  let sql='';
  const data=await readPersonnelOapp(range,{},async s=>{sql=s;return [
    {...appointment,oapp_id:'ncd',depcode:'099',has_lab:1},{...appointment,oapp_id:'other',depcode:'099',has_lab:0},{...appointment,oapp_id:'dental',depcode:'019',has_lab:1}];});
  assert.match(sql,/EXISTS\(SELECT 1 FROM lab_app_head lh WHERE lh\.oapp_id=o\.oapp_id\) has_lab/);
  assert.ok(!sql.includes('o.depcode IN'));
  assert.deepEqual(data.map(a=>[a.oapp_id,a.room_name,a.has_lab]),[['ncd','LAB',true],['dental','ทันตกรรม',true]]);
  const dentalOnly=await readPersonnelOapp(range,{room:'019'},async()=>[
    {...appointment,oapp_id:'ncd',depcode:'099',has_lab:1},{...appointment,oapp_id:'dental',depcode:'019',has_lab:1}]);
  assert.deepEqual(dentalOnly.map(a=>a.oapp_id),['dental']);
});

test('LAB and preparation ticked on the HOSxP appointment screen come from note2 and note1 (any clinic)',async()=>{
  // Shape of a real oapp row: ticked LAB items in note2, ticked preparation lines in note1.
  const data=await readPersonnelOapp(range,{},async()=>[
    {...appointment,oapp_id:'obst',depcode:'',has_lab:0,note:'ทดสอบ',note1:'งดน้ำและอาหาร 6-8 ชั่วโมง (หลังเที่ยงคืน)\nกรุณานำบัตรนัดมาด้วย\nอื่น ๆ\n',note2:'FBS\nU/A\n'} as never,
    {...appointment,oapp_id:'plain',depcode:'',has_lab:0,note:'FBS talk only',note2:null} as never]);
  assert.deepEqual(data.map(a=>[a.oapp_id,a.room_name,a.lab_ticked]),[['obst','LAB',['FBS','U/A']]]);
  assert.deepEqual(data[0].prep_notes,['งดน้ำและอาหาร 6-8 ชั่วโมง (หลังเที่ยงคืน)','กรุณานำบัตรนัดมาด้วย']);
  assert.deepEqual(tickedLabs({note2:'CBC\r\nEKG\r\n',lab_list_text:'CBC'}),['CBC','EKG']);
  assert.deepEqual(preparationNotes({note1:null,perform_text:'จิบน้ำได้'}),['จิบน้ำได้']);
});

test('appointments without depcode are placed by clinic name (older physio and Thai medicine)',async()=>{
  const data=await readPersonnelOapp(range,{},async sql=>{
    assert.ok(!sql.includes('o.depcode IN'));
    return [
      {...appointment,oapp_id:'physio',depcode:'',clinic:'027',clinic_name:'กายภาพบำบัด'},
      {...appointment,oapp_id:'imc',depcode:null,clinic:'041',clinic_name:'IMC กายภาพ'},
      {...appointment,oapp_id:'thai',depcode:'',clinic:'026',clinic_name:'แพทย์แผนไทย'},
      {...appointment,oapp_id:'general',depcode:'',clinic:'000',clinic_name:'ตรวจโรคทั่วไป'},
      {...appointment,oapp_id:'physio-dep',depcode:'033',clinic:'000',clinic_name:'ตรวจโรคทั่วไป'},
    ] as never;
  });
  assert.deepEqual(data.map(a=>[a.oapp_id,a.room_name]),[['physio','กายภาพบำบัด'],['imc','กายภาพบำบัด'],['thai','แพทย์แผนไทย'],['physio-dep','กายภาพบำบัด']]);
  const physioOnly=await readPersonnelOapp(range,{room:'033'},async()=>[{...appointment,oapp_id:'physio',depcode:'',clinic_name:'กายภาพบำบัด'}] as never);
  assert.equal(physioOnly.length,1);
});

test('visit charges sum procedures per VN, count ICD-10 only, and bind every VN', async () => {
  const seen: string[][] = [];
  const charges = await visitCharges(['660101080000', '660101080000', null, 'bad vn', '660101080001'], async (sql, values) => {
    seen.push(values);
    assert.doesNotMatch(sql, /660101/);
    if (/opitemrece/.test(sql)) {
      assert.match(sql, /JOIN nondrugitems n ON n.icode=o.icode/);
      return [{ vn: '660101080000', icode: '3000001', name: 'นวดพร้อมประคบสมุนไพร', qty: '1', amount: '250.00' },
        { vn: '660101080000', icode: '3000002', name: 'อบไอน้ำสมุนไพร', qty: '2', amount: '120.50' }];
    }
    assert.match(sql, /FROM ovstdiag d LEFT JOIN icd101 i ON i.code=d.icd10/);
    return [{ vn: '660101080000', code: 'm545', name: 'Low back pain' }, { vn: '660101080000', code: '9007', name: 'ICD-9 op' },
      { vn: '660101080000', code: 'M545', name: 'Low back pain' }, { vn: '660101080001', code: 'Z000', name: null }];
  });
  assert.deepEqual(seen, [['660101080000', '660101080001'], ['660101080000', '660101080001']]);
  assert.deepEqual(charges.get('660101080000'), { amount: 370.5,
    procedures: [{ name: 'นวดพร้อมประคบสมุนไพร', qty: 1, amount: 250 }, { name: 'อบไอน้ำสมุนไพร', qty: 2, amount: 120.5 }],
    icd10: [{ code: 'M545', name: 'Low back pain' }] });
  assert.deepEqual(charges.get('660101080001'), { amount: 0, procedures: [], icd10: [{ code: 'Z000', name: '' }] });
  assert.equal((await visitCharges([], async () => { throw Error('not called'); })).size, 0);
});
