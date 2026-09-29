import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testGuard } from '../fixture';
import { rows, execute, pool } from '../../src/server/db';
import { syncHosxpAppointments } from '../../src/server/hosxp-sync';
import { dispatchOne } from '../../src/server/notifications';
import { addDays, bangkokNow, fiscalYearForDate } from '../../src/domain/validation';

testGuard();after(()=>pool().end());
test('HOSxP baseline, deduplication, reschedule, deletion and source failure',async()=>{
  const tag=randomUUID(),now=new Date(),day=addDays(bangkokNow(now).day,10);
  const employee=await execute("INSERT INTO employees(employee_code,first_name,last_name) VALUES(?,'ทดสอบ','HOSxP')",[tag]);
  const a={source:'HOSXP' as const,oapp_id:tag,personnel_code:'S001',visited:false,clinic_name:null,has_lab:false,lab_ticked:[] as string[],employee_id:employee.insertId,display_name:'ทดสอบ',appointment_date:day,
    appointment_time:'09:00:00',clinic:'015',depcode:'006' as const,room_name:'LAB' as const,department_name:'ห้องชันสูตร',doctor_code:'D001',doctor_name:'ผู้ให้บริการสมมติ',fiscal_year:fiscalYearForDate(day),location:'ห้องทดสอบ',source_status_id:null,source_updated_at:null};
  const snapshot=[a];const source=async()=>({data:snapshot});
  await execute('UPDATE hosxp_sync_state SET initialized=0 WHERE id=1');
  await execute("UPDATE notification_settings SET enabled=1,mode='DRY_RUN' WHERE id=1");
  const jobs=()=>rows<{id:string;status:string}>('SELECT id,status FROM notification_jobs WHERE hosxp_oapp_id=?',[tag]);
  await syncHosxpAppointments(now,source);assert.equal((await jobs()).length,0);
  await syncHosxpAppointments(now,source);assert.equal((await jobs()).length,0);
  snapshot[0]={...a,appointment_time:'10:00:00'};
  await Promise.all([syncHosxpAppointments(now,source),syncHosxpAppointments(now,source)]);
  assert.equal((await jobs()).length,1);assert.equal((await jobs())[0].status,'PENDING');
  let sends=0;
  for(let i=0;i<100;i++)if(!await dispatchOne({send:async()=>{sends++;return {outcome:'ACCEPTED'};}}))break;
  assert.equal(sends,0);assert.equal((await jobs())[0].status,'DRY_RUN');
  snapshot[0]={...a,appointment_time:'11:00:00'};
  await syncHosxpAppointments(now,source);assert.equal((await jobs()).length,2);
  await assert.rejects(syncHosxpAppointments(now,async()=>{throw Error('SOURCE_UNAVAILABLE');}));
  assert.equal((await jobs()).filter(j=>j.status==='PENDING').length,1);
  snapshot.length=0;await syncHosxpAppointments(now,source);
  assert.equal((await jobs()).filter(j=>j.status==='PENDING').length,0);
  const [stored]=await rows<{active:number}>('SELECT active FROM hosxp_appointments WHERE oapp_id=?',[tag]);assert.equal(stored.active,0);
});
