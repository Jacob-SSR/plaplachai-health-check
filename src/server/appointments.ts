import { randomUUID } from 'node:crypto';
import { rows,execute,transaction,type DB } from './db';
import { ensure,appointmentInput,inRange,bangkokNow,type AppointmentInput } from '../domain/validation';
import { type Actor,hasScope,scopeSql } from './auth';
import { audit } from './audit';

export type RecordRow=Record<string,string|number|null>;
export async function validateAppointment(input:AppointmentInput,actor:Actor,db:DB,excludeId?:number) {
  // A person lock serializes bookings and attendance across all their fiscal years.
  const [member]=await rows<RecordRow>(`SELECT m.*,e.active,e.employee_code FROM fiscal_year_members m JOIN employees e ON e.id=m.employee_id WHERE m.id=?`,[input.memberId],db);
  ensure(member && hasScope(actor,Number(member.department_id)),'ไม่พบบุคลากรในขอบเขตที่ได้รับสิทธิ์',404);
  const [employee]=await rows<RecordRow>('SELECT active FROM employees WHERE id=? FOR UPDATE',[member.employee_id],db);
  const [currentMember]=await rows<RecordRow>('SELECT eligibility_status FROM fiscal_year_members WHERE id=? FOR UPDATE',[input.memberId],db);
  ensure(employee.active && currentMember.eligibility_status==='ELIGIBLE','บุคลากรไม่ได้เปิดใช้งานหรือไม่มีสิทธิ์ในปีนี้');
  const [plan]=await rows<RecordRow>(`SELECT p.*,y.status year_status FROM health_check_plans p JOIN fiscal_years y ON y.id=p.fiscal_year_id WHERE p.id=? FOR UPDATE`,[input.planId],db);
  ensure(plan && Number(plan.fiscal_year_id)===Number(member.fiscal_year_id),'แผนและบุคลากรต้องอยู่ปีงบประมาณเดียวกัน');
  ensure(plan.status==='OPEN' && plan.year_status==='OPEN','แผนหรือปีงบประมาณปิดแล้ว',409);
  ensure(inRange(input.date,String(plan.start_date),String(plan.end_date)),'วันที่นัดอยู่นอกช่วงแผน');
  const [group]=await rows<RecordRow>('SELECT id FROM service_groups WHERE id=? AND active=1',[input.groupId],db);
  ensure(group,'กลุ่มบริการปิดใช้งานหรือไม่พบ');
  const services=await rows<RecordRow>(`SELECT s.id,s.name,r.id requirement_id FROM health_check_services s
   JOIN plan_services ps ON ps.service_id=s.id AND ps.plan_id=?
   JOIN member_service_requirements r ON r.service_id=s.id AND r.plan_id=ps.plan_id AND r.member_id=? AND r.round_no=? AND r.status='REQUIRED'
   WHERE s.service_group_id=? AND s.active=1 AND s.id IN (${input.serviceIds.map(()=>'?').join(',')})`,
   [input.planId,input.memberId,input.roundNo,input.groupId,...input.serviceIds],db);
  ensure(services.length===input.serviceIds.length,'รายการตรวจต้องอยู่ในกลุ่มบริการและรายการที่กำหนดให้บุคลากรรอบนี้');
  const duplicate=await rows(`SELECT id FROM health_check_appointments WHERE plan_id=? AND member_id=? AND service_group_id=? AND round_no=? AND attempt_no=? AND id<>? FOR UPDATE`,[input.planId,input.memberId,input.groupId,input.roundNo,input.attemptNo,excludeId??0],db);
  ensure(!duplicate.length,'มีนัดบริการและรอบนี้แล้ว ใช้การแก้ไขหรือระบุครั้งนัดใหม่อย่างชัดเจน',409,'DUPLICATE');
  const conflict=await rows(`SELECT a.id FROM health_check_appointments a JOIN fiscal_year_members m ON m.id=a.member_id WHERE m.employee_id=? AND a.appointment_date=? AND a.appointment_time=? AND a.status<>'CANCELLED' AND a.id<>? FOR UPDATE`,[member.employee_id,input.date,input.time,excludeId??0],db);
  ensure(!conflict.length,'บุคลากรมีนัดตรงวันและเวลานี้แล้ว',409,'TIME_CONFLICT');
  if(input.attemptNo>1) {
    const previous=await rows<RecordRow>(`SELECT status FROM health_check_appointments WHERE plan_id=? AND member_id=? AND service_group_id=? AND round_no=? AND attempt_no=?`,[input.planId,input.memberId,input.groupId,input.roundNo,input.attemptNo-1],db);
    ensure(previous.length && ['CANCELLED','NO_SHOW'].includes(String(previous[0].status)),'สร้างครั้งนัดใหม่ได้หลังครั้งก่อนยกเลิกหรือขาดนัดเท่านั้น');
  }
  const [assignment]=await rows<RecordRow>(`SELECT a.id,d.name department_name,p.name position_name FROM employee_assignments a JOIN departments d ON d.id=a.department_id JOIN positions p ON p.id=a.position_id WHERE a.employee_id=? AND a.valid_from<=? AND (a.valid_to IS NULL OR a.valid_to>?)`,[member.employee_id,input.date,input.date],db);
  ensure(assignment,'ไม่มีประวัติหน่วยงาน/ตำแหน่งครอบคลุมวันที่นัด');
  return {member,plan,services,snapshot:{assignmentId:assignment.id,displayName:member.display_name,departmentName:assignment.department_name,positionName:assignment.position_name,capturedAt:new Date().toISOString()}};
}
export async function createAppointment(input:AppointmentInput,actor:Actor,db:DB) {
  const checked=await validateAppointment(input,actor,db);
  const appointmentCode='APT-'+randomUUID();
  const result=await execute(`INSERT INTO health_check_appointments(appointment_code,member_id,plan_id,fiscal_year_id,service_group_id,round_no,attempt_no,appointment_date,appointment_time,queue_label,location,note,identity_snapshot,created_by)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[appointmentCode,input.memberId,input.planId,checked.member.fiscal_year_id,input.groupId,input.roundNo,input.attemptNo,input.date,input.time,input.queueLabel,input.location,input.note,JSON.stringify(checked.snapshot),actor.id],db);
  for(const service of checked.services) await execute(`INSERT INTO appointment_services(appointment_id,member_id,plan_id,service_group_id,service_id,requirement_id,round_no,service_name) VALUES(?,?,?,?,?,?,?,?)`,
    [result.insertId,input.memberId,input.planId,input.groupId,service.id,service.requirement_id,input.roundNo,service.name],db);
  await audit(db,actor.id,'CREATE','appointments',result.insertId,{date:input.date,time:input.time,groupId:input.groupId,roundNo:input.roundNo});
  return {id:result.insertId,appointmentCode,version:1};
}
export async function updateAppointment(id:number,input:AppointmentInput,version:number,reason:string,actor:Actor,db:DB) {
  // Lock in the same order as create/import (employee -> plan -> appointment).
  const checked=await validateAppointment(input,actor,db,id);
  const [old]=await rows<RecordRow>('SELECT * FROM health_check_appointments WHERE id=? FOR UPDATE',[id],db);
  ensure(old && Number(old.member_id)===input.memberId && Number(old.plan_id)===input.planId,'ไม่พบนัดหรือไม่อนุญาตให้ย้ายนัดไปบุคคล/แผนอื่น',404);
  ensure(Number(old.version)===version,'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่',409,'STALE_VERSION');
  ensure(old.status==='SCHEDULED','แก้ตารางนัดได้เฉพาะสถานะรอตรวจ',409);
  ensure(Number(old.round_no)===input.roundNo && Number(old.attempt_no)===input.attemptNo && Number(old.service_group_id)===input.groupId,'บริการ/รอบ/ครั้งเป็นรหัสนัดที่เปลี่ยนไม่ได้ ให้ยกเลิกและนัดใหม่');
  await execute(`UPDATE health_check_appointments SET appointment_date=?,appointment_time=?,queue_label=?,location=?,note=?,change_reason=?,identity_snapshot=?,version=version+1,schedule_version=schedule_version+1,updated_at=UTC_TIMESTAMP(6) WHERE id=?`,[input.date,input.time,input.queueLabel,input.location,input.note,reason,JSON.stringify(checked.snapshot),id],db);
  await execute('DELETE FROM appointment_services WHERE appointment_id=?',[id],db);
  for(const service of checked.services) await execute(`INSERT INTO appointment_services(appointment_id,member_id,plan_id,service_group_id,service_id,requirement_id,round_no,service_name) VALUES(?,?,?,?,?,?,?,?)`,[id,input.memberId,input.planId,input.groupId,service.id,service.requirement_id,input.roundNo,service.name],db);
  await execute("UPDATE notification_jobs SET status='CANCELLED',safe_error='APPOINTMENT_CHANGED' WHERE appointment_id=? AND status IN ('PENDING','BLOCKED')",[id],db);
  await audit(db,actor.id,'RESCHEDULE','appointments',id,{before:{date:old.appointment_date,time:old.appointment_time},after:{date:input.date,time:input.time},reason});
  return {id,version:version+1};
}
export async function changeStatus(id:number,status:string,version:number,reason:string,actor:Actor) {
  return transaction(async db=>{
    const [base]=await rows<RecordRow>(`SELECT m.employee_id,m.department_id FROM health_check_appointments a JOIN fiscal_year_members m ON m.id=a.member_id WHERE a.id=?`,[id],db);
    ensure(base && hasScope(actor,Number(base.department_id)),'ไม่พบนัดในขอบเขตของคุณ',404);
    await rows('SELECT id FROM employees WHERE id=? FOR UPDATE',[base.employee_id],db);
    const [a]=await rows<RecordRow>(`SELECT a.*,p.status plan_status,y.status year_status FROM health_check_appointments a JOIN health_check_plans p ON p.id=a.plan_id JOIN fiscal_years y ON y.id=a.fiscal_year_id WHERE a.id=? FOR UPDATE`,[id],db);
    ensure(Number(a.version)===version,'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่',409,'STALE_VERSION');
    ensure(a.plan_status==='OPEN' && a.year_status==='OPEN','แผนหรือปีงบประมาณปิดแล้ว',409);
    const transitions:Record<string,string[]>={SCHEDULED:['CHECKED_IN','NO_SHOW','CANCELLED'],CHECKED_IN:['COMPLETED','CANCELLED'],NO_SHOW:['CHECKED_IN'],COMPLETED:[],CANCELLED:[]};
    ensure(transitions[String(a.status)]?.includes(status),'เปลี่ยนสถานะตามลำดับนี้ไม่ได้',409);
    const now=bangkokNow();
    if(['CHECKED_IN','COMPLETED','NO_SHOW'].includes(status)) ensure(`${a.appointment_date} ${String(a.appointment_time).slice(0,5)}`<=`${now.day} ${now.clock}`,'ยังไม่ถึงวันเวลานัด');
    if(status==='COMPLETED') {
      const services=await rows<RecordRow>('SELECT * FROM appointment_services WHERE appointment_id=?',[id],db);
      ensure(services.length,'นัดนี้ไม่มีรายการตรวจ');
      for(const service of services) {
        await rows('SELECT id FROM member_service_requirements WHERE id=? FOR UPDATE',[service.requirement_id],db);
        const done=await rows("SELECT id FROM appointment_services WHERE requirement_id=? AND status='DONE' AND appointment_id<>?",[service.requirement_id,id],db);
        ensure(!done.length,'รายการตรวจรอบนี้มีการบันทึกเสร็จแล้วในนัดอื่น',409);
      }
      const [assignment]=await rows<RecordRow>(`SELECT a.id,d.name departmentName,p.name positionName FROM employee_assignments a JOIN departments d ON d.id=a.department_id JOIN positions p ON p.id=a.position_id WHERE a.employee_id=? AND a.valid_from<=? AND (a.valid_to IS NULL OR a.valid_to>?)`,[base.employee_id,now.day,now.day],db);
      ensure(assignment,'ไม่มีประวัติหน่วยงานในวันที่รับบริการ');
      await execute("UPDATE appointment_services SET status='DONE',performed_at=UTC_TIMESTAMP(6),performed_by=?,performed_snapshot=? WHERE appointment_id=?",[actor.id,JSON.stringify(assignment),id],db);
    }
    if(status==='CANCELLED') await execute("UPDATE appointment_services SET status='CANCELLED' WHERE appointment_id=?",[id],db);
    await execute('UPDATE health_check_appointments SET status=?,version=version+1,change_reason=?,updated_at=UTC_TIMESTAMP(6) WHERE id=?',[status,reason,id],db);
    if(['COMPLETED','CANCELLED','NO_SHOW','CHECKED_IN'].includes(status)) await execute("UPDATE notification_jobs SET status='CANCELLED',safe_error='APPOINTMENT_STATUS_CHANGED' WHERE appointment_id=? AND status IN ('PENDING','BLOCKED')",[id],db);
    await audit(db,actor.id,'STATUS','appointments',id,{from:a.status,to:status,reason});
    return {id,status,version:version+1};
  });
}
export function appointmentFilter(params:URLSearchParams,actor:Actor) {
  const fiscalYearId=Number(params.get('year'));ensure(Number.isInteger(fiscalYearId)&&fiscalYearId>0,'กรุณาเลือกปีงบประมาณ');
  const scope=scopeSql(actor),clauses=['a.fiscal_year_id=?',scope.sql],values:unknown[]=[fiscalYearId,...scope.params];
  for(const [param,col] of [['department','m.department_id'],['group','a.service_group_id'],['member','a.member_id'],['status','a.status'],['from','a.appointment_date'],['to','a.appointment_date']]) {
    const value=params.get(param);if(!value)continue;
    clauses.push(`${col}${param==='from'?'>=':param==='to'?'<=':'='}?`);values.push(value);
  }
  if(params.get('service')) {clauses.push('EXISTS(SELECT 1 FROM appointment_services sf WHERE sf.appointment_id=a.id AND sf.service_id=?)');values.push(params.get('service'));}
  const search=params.get('q')?.trim();if(search){ensure(search.length<=100,'คำค้นยาวเกินไป');clauses.push('(m.display_name LIKE ? OR e.employee_code LIKE ?)');values.push(`%${search}%`,`%${search}%`);}
  return {where:clauses.join(' AND '),values};
}
export async function listAppointments(params:URLSearchParams,actor:Actor,all=false) {
  const {where,values}=appointmentFilter(params,actor),page=Math.max(1,Number(params.get('page')??1)||1),size=all?10000:50;
  ensure(Number.isInteger(page) && page<=100000,'หน้าไม่ถูกต้อง');
  const joins='FROM health_check_appointments a JOIN fiscal_year_members m ON m.id=a.member_id JOIN employees e ON e.id=m.employee_id JOIN service_groups g ON g.id=a.service_group_id JOIN health_check_plans p ON p.id=a.plan_id';
  const [count]=await rows<{total:number}>(`SELECT COUNT(*) total ${joins} WHERE ${where}`,values);
  ensure(!all || count.total<=10000,'ข้อมูลเกิน 10,000 แถว กรุณาลดช่วงวัน');
  const data=await rows(`SELECT a.*,m.display_name,m.department_name,m.position_name,e.employee_code,g.name group_name,p.name plan_name,
    (SELECT GROUP_CONCAT(s.service_name ORDER BY s.id SEPARATOR ', ') FROM appointment_services s WHERE s.appointment_id=a.id) services,
    (SELECT GROUP_CONCAT(s.service_id ORDER BY s.id) FROM appointment_services s WHERE s.appointment_id=a.id) service_ids
    ${joins} WHERE ${where} ORDER BY a.appointment_date,a.appointment_time,a.id LIMIT ${size} OFFSET ${all?0:(page-1)*size}`,values);
  return {data,total:count.total,page,pageSize:size};
}
export { appointmentInput };
