import { test,after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { fixture,testGuard } from '../fixture';
import { rows,execute,transaction,pool } from '../../src/server/db';
import { createAppointment,updateAppointment,changeStatus,listAppointments } from '../../src/server/appointments';
import { validateImport,confirmImport,template,exportAppointments,parseWorkbook,HEADERS } from '../../src/server/excel';
import { reports } from '../../src/server/reports';
import { dispatchOne,scheduleReminders } from '../../src/server/notifications';
import { addDays } from '../../src/domain/validation';
import { sendTestNotification } from '../../src/server/notification-test';
import { encrypt } from '../../src/server/crypto';
testGuard();after(()=>pool().end());
test('transactional scheduling, scoped reads, Excel roundtrip and worker safeguards',async t=>{
 const f=await fixture(),a=f.actor;
 const input={memberId:f.people[0].memberId,planId:f.planId,groupId:f.groupId,roundNo:1,attemptNo:1,date:f.range.start,time:'08:30',location:'=literal Excel text',queueLabel:'',note:'',serviceIds:[f.serviceId]};
 let appointmentId=0;
 await t.test('create, duplicate detection, second round and stale version',async()=>{
  const created=await transaction(db=>createAppointment(input,a,db));appointmentId=created.id;
  await assert.rejects(transaction(db=>createAppointment(input,a,db)),/มีนัดบริการ/);
  await assert.rejects(transaction(db=>createAppointment({...input,memberId:f.people[1].memberId,date:addDays(f.range.end,1)},a,db)),/นอกช่วง/);
  await transaction(db=>createAppointment({...input,roundNo:2,time:'10:00'},a,db));
  await transaction(db=>updateAppointment(appointmentId,{...input,time:'09:00'},1,'ทดสอบ',a,db));
  await assert.rejects(transaction(db=>updateAppointment(appointmentId,input,1,'stale',a,db)),/ข้อมูลเปลี่ยน/);
 });
 await t.test('department scope and no accidental cross-year booking',async()=>{
  const limited={...a,roles:['STAFF'],departments:[]};
  assert.equal((await listAppointments(new URLSearchParams({year:String(f.yearId)}),limited)).total,0);
  await assert.rejects(transaction(db=>createAppointment({...input,memberId:f.people[1].memberId},limited,db)),/ขอบเขต/);
 });
 await t.test('attendance transition and complete denominator',async()=>{
  await assert.rejects(changeStatus(appointmentId,'COMPLETED',2,'invalid',a),/ลำดับ/);
  await changeStatus(appointmentId,'CHECKED_IN',2,'เข้ารับบริการ',a);
  await changeStatus(appointmentId,'COMPLETED',3,'ตรวจครบ',a);
  const r=await reports(new URLSearchParams({year:String(f.yearId),department:String(f.departmentId)}),a);
  assert.equal(r.summary.completed,1);assert.equal(r.summary.fully_complete,0);assert.equal(r.summary.eligible,4);
 });
 const makeBook=async(personIndexes:number[],bad=false)=>{const book=new ExcelJS.Workbook();const sh=book.addWorksheet('Appointments');sh.addRow([...HEADERS]);for(const i of personIndexes)sh.addRow(['CREATE','','',f.fy,f.planCode,f.people[i].employeeCode,f.groupCode,1,1,bad?'2027-02-29':f.range.start,'11:00','','ห้องทดสอบ',f.serviceCode,'']);return Buffer.from(await book.xlsx.writeBuffer());};
 await t.test('template downloads, rejects formulas, export keeps literal strings',async()=>{
  const book=new ExcelJS.Workbook();await book.xlsx.load(await template(f.yearId,f.planId,a) as never);assert.ok(book.getWorksheet('รายการรายคน'));
  const b=new ExcelJS.Workbook();await b.xlsx.load(await makeBook([1]) as never);b.getWorksheet('Appointments')!.getCell('O2').value={formula:'1+1',result:2};const parsed=await parseWorkbook(Buffer.from(await b.xlsx.writeBuffer()));assert.equal(parsed.errors.length,1);
  const out=new ExcelJS.Workbook();await out.xlsx.load(await exportAppointments(new URLSearchParams({year:String(f.yearId),department:String(f.departmentId)}),a) as never);assert.equal(out.getWorksheet('Appointments')!.getCell('M2').value,'=literal Excel text');
 });
 await t.test('preview error blocks whole import; concurrent change rolls back every row',async()=>{
  const invalid=await validateImport(await makeBook([1],true),'test.xlsx',f.yearId,f.planId,a);assert.equal(invalid.invalid,1);await assert.rejects(confirmImport(invalid.batchId,invalid.digest,a));
  const p=await validateImport(await makeBook([1,2]),'test.xlsx',f.yearId,f.planId,a);assert.equal(p.invalid,0);
  await transaction(db=>createAppointment({...input,memberId:f.people[2].memberId,time:'11:00'},a,db));
  await assert.rejects(confirmImport(p.batchId,p.digest,a));
  assert.equal((await rows('SELECT id FROM health_check_appointments WHERE member_id=?',[f.people[1].memberId])).length,0);
 });
 await t.test('successful confirm digest survives JSON normalization and replay is idempotent',async()=>{
  const p=await validateImport(await makeBook([1]),'test.xlsx',f.yearId,f.planId,a);assert.equal(p.invalid,0);
  assert.equal((await confirmImport(p.batchId,p.digest,a)).success,1);
  assert.equal((await confirmImport(p.batchId,p.digest,a)).alreadyCommitted,true);
  assert.equal((await rows('SELECT id FROM health_check_appointments WHERE member_id=?',[f.people[1].memberId])).length,1);
 });
 await t.test('concurrent booking produces one appointment',async()=>{
  const outcomes=await Promise.allSettled([1,2].map(roundNo=>transaction(db=>createAppointment({...input,roundNo,memberId:f.people[3].memberId},a,db))));
  assert.equal(outcomes.filter(v=>v.status==='fulfilled').length,1);
 });
 await t.test('dry-run never contacts provider, repeated schedule is deduplicated',async()=>{
  const future=f.day<f.range.end?addDays(f.day,1):f.day;
  const [previous]=await rows<{round_no:number}>('SELECT round_no FROM health_check_appointments WHERE member_id=?',[f.people[3].memberId]);
  const appt=await transaction(db=>createAppointment({...input,memberId:f.people[3].memberId,roundNo:3-previous.round_no,date:future,time:'23:59'},a,db));
  const [original]=await rows('SELECT * FROM notification_settings WHERE id=1');let calls=0;
  try{
   await execute("UPDATE notification_settings SET enabled=1,mode='DRY_RUN' WHERE id=1");
   const fakeNow=new Date(`${addDays(future,-1)}T09:00:00+07:00`);await scheduleReminders(fakeNow);assert.equal(await scheduleReminders(fakeNow),0);
   const [rule]=await rows<{id:number}>('SELECT id FROM notification_rules WHERE days_before=1');
   const job=randomUUID();await execute("INSERT IGNORE INTO notification_jobs(id,appointment_id,schedule_version,rule_id,scheduled_at,available_at) VALUES(?,?,1,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())",[job,appt.id,rule.id]);
   await execute('UPDATE notification_jobs SET available_at=UTC_TIMESTAMP() WHERE appointment_id=?',[appt.id]);
   while(await dispatchOne({send:async()=>{calls++;return {outcome:'ACCEPTED'};}})){}
   assert.equal(calls,0);const [r]=await rows('SELECT status FROM notification_jobs WHERE appointment_id=?',[appt.id]);assert.equal(r.status,'DRY_RUN');
  }finally{await execute('UPDATE notification_settings SET enabled=?,mode=? WHERE id=1',[original.enabled,original.mode]);}
 });
});

test('manual notification verifies gates, sends once, and preserves uncertain outcomes',async()=>{
 const f=await fixture(),actor={...f.actor,permissions:['notification.manage']},employeeId=f.people[0].employeeId;
 const request={employeeId,requestId:randomUUID()};let calls=0;
 const provider={send:async(cid:string,message:string)=>{calls++;assert.equal(cid,'1234567890121');assert.ok(message.includes('ข้อความทดสอบ'));return {outcome:'ACCEPTED' as const};}};
 const keys=['MOPH_LIVE_ENABLED','MOPH_CLIENT_KEY','MOPH_SECRET_KEY'],oldEnv=keys.map(k=>process.env[k]);
 const [settings]=await rows('SELECT enabled,mode FROM notification_settings WHERE id=1');
 try{
  await assert.rejects(sendTestNotification(request,{...actor,permissions:[]},provider),/สิทธิ์/);
  await assert.rejects(sendTestNotification(request,actor,provider),/MOPH_LIVE_ENABLED/);
  process.env.MOPH_LIVE_ENABLED='true';delete process.env.MOPH_CLIENT_KEY;delete process.env.MOPH_SECRET_KEY;
  await assert.rejects(sendTestNotification(request,actor,provider),/Client_ID/);
  process.env.MOPH_CLIENT_KEY='fake';process.env.MOPH_SECRET_KEY='fake';
  await execute("UPDATE notification_settings SET enabled=1,mode='DRY_RUN' WHERE id=1");
  await assert.rejects(sendTestNotification(request,actor,provider),/LIVE/);
  await execute("UPDATE notification_settings SET enabled=1,mode='LIVE' WHERE id=1");
  await assert.rejects(sendTestNotification(request,actor,provider),/ผู้รับต้อง/);assert.equal(calls,0);
  await execute('UPDATE employees SET notification_enabled=1,cid_ciphertext=?,cid_verified_at=UTC_TIMESTAMP() WHERE id=?',[encrypt('1234567890121'),employeeId]);
  const results=await Promise.all([sendTestNotification(request,actor,provider),sendTestNotification(request,actor,provider)]);
  assert.equal(calls,1);assert.ok(results.some(r=>r.status==='ACCEPTED'));
  assert.equal((await sendTestNotification(request,actor,provider)).status,'ACCEPTED');assert.equal(calls,1);
  await assert.rejects(sendTestNotification({...request,requestId:randomUUID()},actor,provider),/1 นาที/);
  await execute('UPDATE notification_test_sends SET created_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 2 MINUTE) WHERE id=?',[request.requestId]);
  const uncertain={...request,requestId:randomUUID()};
  const failedTransport={send:async()=>{calls++;throw Error('secret payload must not escape');}};
  const unknown=await sendTestNotification(uncertain,actor,failedTransport);assert.equal(unknown.status,'UNKNOWN');assert.ok(!JSON.stringify(unknown).includes('secret payload'));
  assert.equal((await sendTestNotification(uncertain,actor,failedTransport)).status,'UNKNOWN');assert.equal(calls,2);
  const pending=randomUUID();await execute("INSERT INTO notification_test_sends(id,actor_user_id,employee_id,status,created_at) VALUES(?,?,?,'SENDING',DATE_SUB(UTC_TIMESTAMP(),INTERVAL 3 MINUTE))",[pending,actor.id,employeeId]);
  assert.equal((await sendTestNotification({...request,requestId:pending},actor,provider)).status,'UNKNOWN');assert.equal(calls,2);
 }finally{
  keys.forEach((k,i)=>{if(oldEnv[i]===undefined)delete process.env[k];else process.env[k]=oldEnv[i];});
  await execute('UPDATE notification_settings SET enabled=?,mode=? WHERE id=1',[settings.enabled,settings.mode]);
 }
});
