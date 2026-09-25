import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { rows,execute,transaction,type DB } from './db';
import { type Actor,scopeSql,hasScope } from './auth';
import { ensure,id,text,code,date,fiscalRange,inRange,validCid } from '../domain/validation';
import { audit } from './audit';
import { encrypt,cidHash } from './crypto';
import { type RecordRow } from './appointments';

export const masterTables:Record<string,string>={departments:'departments',positions:'positions',levels:'position_levels',employmentTypes:'employment_types',groups:'service_groups',services:'health_check_services'};
const masterSchema=z.object({code,name:text(),active:z.boolean().default(true),parentId:id.nullable().optional(),groupId:id.optional(),version:id.optional()});
export async function masters(actor:Actor) {
  const result:Record<string,unknown>={};
  for(const [key,table] of Object.entries(masterTables)) result[key]=await rows(`SELECT * FROM ${table} ORDER BY name`);
  result.years=await rows('SELECT * FROM fiscal_years ORDER BY fiscal_year DESC');
  result.plans=await rows(`SELECT p.*,(SELECT GROUP_CONCAT(service_id) FROM plan_services WHERE plan_id=p.id) service_ids FROM health_check_plans p ORDER BY p.id DESC`);
  result.canManage=actor.permissions.includes('master.write');return result;
}
export async function saveMaster(kind:string,recordId:number|undefined,body:unknown,actor:Actor) {
  const table=masterTables[kind];ensure(table,'ไม่พบประเภทข้อมูล',404);
  const input=masterSchema.parse(body);
  return transaction(async db=>{
    if(input.parentId) {
      ensure(kind==='departments','parentId ใช้ได้เฉพาะหน่วยงาน');
      const parents=await rows<RecordRow>('SELECT id,parent_id FROM departments FOR UPDATE',[],db);
      const map=new Map(parents.map(r=>[Number(r.id),r.parent_id==null?null:Number(r.parent_id)]));
      ensure(map.has(input.parentId),'ไม่พบหน่วยงานแม่');
      const seen=new Set<number>();let current:number|null=input.parentId;
      while(current!=null){ensure(current!==recordId&&!seen.has(current),'โครงสร้างหน่วยงานวนซ้ำ');seen.add(current);current=map.get(current)??null;}
    }
    if(kind==='services') ensure(input.groupId,'กรุณาเลือกกลุ่มบริการ');
    const columns=['code','name','active'],values:unknown[]=[input.code,input.name,input.active];
    if(kind==='departments'){columns.push('parent_id');values.push(input.parentId??null);}
    if(kind==='services'){columns.push('service_group_id');values.push(input.groupId);}
    let savedId=recordId;
    if(recordId) {
      ensure(input.version,'กรุณาส่ง version');
      const [old]=await rows<RecordRow>(`SELECT * FROM ${table} WHERE id=? FOR UPDATE`,[recordId],db);ensure(old,'ไม่พบรายการ',404);
      ensure(Number(old.version)===input.version,'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่',409);
      ensure(old.code===input.code,'ไม่เปลี่ยนรหัส master ที่สร้างแล้ว');
      if(kind==='services') ensure(Number(old.service_group_id)===input.groupId,'ไม่ย้ายกลุ่มของรายการตรวจเดิม');
      await execute(`UPDATE ${table} SET ${columns.map(c=>`${c}=?`).join(',')},version=version+1 WHERE id=?`,[...values,recordId],db);
    } else {savedId=(await execute(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`,values,db)).insertId;}
    await audit(db,actor.id,recordId?'UPDATE':'CREATE',table,savedId!,{code:input.code,name:input.name,active:input.active});
    return {id:savedId};
  });
}
const employeeSchema=z.object({employeeCode:code,prefix:z.string().trim().max(30).default(''),firstName:text(100),lastName:text(100),departmentId:id,positionId:id,levelId:id.nullable().default(null),employmentTypeId:id.nullable().default(null),validFrom:date});
export async function employees(actor:Actor) {
  const scope=scopeSql(actor,'a.department_id');
  return rows(`SELECT e.id,e.employee_code,e.prefix,e.first_name,e.last_name,e.active,e.version,e.notification_enabled,
   (e.cid_ciphertext IS NOT NULL) has_cid,a.department_id,a.position_id,a.level_id,a.employment_type_id,a.valid_from,d.name department_name,p.name position_name
   FROM employees e JOIN employee_assignments a ON a.employee_id=e.id AND a.valid_to IS NULL
   JOIN departments d ON d.id=a.department_id JOIN positions p ON p.id=a.position_id WHERE ${scope.sql} ORDER BY e.first_name,e.last_name`,scope.params);
}
export async function createEmployee(body:unknown,actor:Actor) {
  const input=employeeSchema.parse(body);
  return transaction(async db=>{
    const result=await execute('INSERT INTO employees(employee_code,prefix,first_name,last_name) VALUES(?,?,?,?)',[input.employeeCode,input.prefix,input.firstName,input.lastName],db);
    await insertAssignment(result.insertId,input,db);
    await audit(db,actor.id,'CREATE','employees',result.insertId,{employeeCode:input.employeeCode,departmentId:input.departmentId,positionId:input.positionId});return {id:result.insertId};
  });
}
async function insertAssignment(employeeId:number,input:z.infer<typeof employeeSchema>,db:DB) {
  for(const [table,idValue] of [['departments',input.departmentId],['positions',input.positionId],['position_levels',input.levelId],['employment_types',input.employmentTypeId]] as const) {
    if(idValue) ensure((await rows(`SELECT id FROM ${table} WHERE id=? AND active=1`,[idValue],db)).length,'ตำแหน่ง/หน่วยงาน/ประเภทที่เลือกไม่ได้เปิดใช้งาน');
  }
  await execute('INSERT INTO employee_assignments(employee_id,department_id,position_id,level_id,employment_type_id,valid_from) VALUES(?,?,?,?,?,?)',[employeeId,input.departmentId,input.positionId,input.levelId,input.employmentTypeId,input.validFrom],db);
}
export async function updateEmployee(employeeId:number,body:unknown,actor:Actor) {
  const input=employeeSchema.extend({version:id,active:z.boolean()}).parse(body);
  return transaction(async db=>{
    const [old]=await rows<RecordRow>('SELECT * FROM employees WHERE id=? FOR UPDATE',[employeeId],db);ensure(old,'ไม่พบบุคลากร',404);
    ensure(Number(old.version)===input.version,'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่',409);ensure(old.employee_code===input.employeeCode,'รหัสบุคลากรเปลี่ยนไม่ได้');
    const [a]=await rows<RecordRow>('SELECT * FROM employee_assignments WHERE employee_id=? AND valid_to IS NULL FOR UPDATE',[employeeId],db);
    const changed=Number(a.department_id)!==input.departmentId||Number(a.position_id)!==input.positionId||(a.level_id==null?null:Number(a.level_id))!==input.levelId||(a.employment_type_id==null?null:Number(a.employment_type_id))!==input.employmentTypeId;
    if(changed){ensure(input.validFrom>String(a.valid_from),'วันย้ายต้องหลังวันเริ่มประวัติเดิม');await execute('UPDATE employee_assignments SET valid_to=? WHERE id=?',[input.validFrom,a.id],db);await insertAssignment(employeeId,input,db);}
    await execute('UPDATE employees SET prefix=?,first_name=?,last_name=?,active=?,version=version+1 WHERE id=?',[input.prefix,input.firstName,input.lastName,input.active,employeeId],db);
    await audit(db,actor.id,'UPDATE','employees',employeeId,{departmentId:input.departmentId,positionId:input.positionId,active:input.active,assignmentChanged:changed});return {id:employeeId};
  });
}
export async function setRecipient(employeeId:number,body:unknown,actor:Actor) {
  const input=z.object({cid:z.string().optional(),enabled:z.boolean(),verified:z.boolean().default(false)}).parse(body);
  if(input.cid){ensure(validCid(input.cid),'เลขบัตรประชาชนไม่ถูกต้อง');ensure(input.verified,'กรุณายืนยันว่าตรวจสอบเลขผู้รับกับเจ้าของข้อมูลแล้ว');}
  return transaction(async db=>{
    const [e]=await rows<RecordRow>('SELECT id,cid_ciphertext,cid_verified_at FROM employees WHERE id=? FOR UPDATE',[employeeId],db);ensure(e,'ไม่พบบุคลากร',404);
    ensure(!input.enabled || input.cid || (e.cid_ciphertext&&e.cid_verified_at),'ต้องตรวจสอบเลขผู้รับก่อนเปิดการแจ้งเตือน');
    if(input.cid) await execute('UPDATE employees SET cid_ciphertext=?,cid_hmac=?,cid_verified_at=UTC_TIMESTAMP(6) WHERE id=?',[encrypt(input.cid),cidHash(input.cid),employeeId],db);
    await execute('UPDATE employees SET notification_enabled=?,version=version+1 WHERE id=?',[input.enabled,employeeId],db);
    await audit(db,actor.id,'RECIPIENT_SETTINGS','employees',employeeId,{enabled:input.enabled,cidChanged:!!input.cid});return {ok:true};
  });
}
export async function createYear(body:unknown,actor:Actor) {
  const {year}=z.object({year:z.number().int().min(2500).max(2800)}).parse(body),range=fiscalRange(year);
  return transaction(async db=>{const r=await execute('INSERT INTO fiscal_years(fiscal_year,start_date,end_date) VALUES(?,?,?)',[year,range.start,range.end],db);await audit(db,actor.id,'CREATE','fiscal_years',r.insertId,{year});return {id:r.insertId};});
}
export async function closeYear(yearId:number,body:unknown,actor:Actor) {
  const input=z.object({status:z.enum(['OPEN','CLOSED']),version:id,reason:text(500)}).parse(body);
  return transaction(async db=>{
    const r=await execute('UPDATE fiscal_years SET status=?,version=version+1 WHERE id=? AND version=?',[input.status,yearId,input.version],db);ensure(r.affectedRows,'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่',409);
    await audit(db,actor.id,'STATUS','fiscal_years',yearId,{status:input.status,reason:input.reason});return {ok:true};
  });
}
export async function createPlan(body:unknown,actor:Actor) {
  const input=z.object({yearId:id,code,name:text(),location:text(),start:date,end:date,serviceIds:z.array(id).min(1)}).parse(body);
  return transaction(async db=>{
    const [year]=await rows<RecordRow>('SELECT * FROM fiscal_years WHERE id=? FOR UPDATE',[input.yearId],db);ensure(year?.status==='OPEN','ปีงบประมาณปิดหรือไม่พบ');
    ensure(inRange(input.start,String(year.start_date),String(year.end_date))&&inRange(input.end,String(year.start_date),String(year.end_date))&&input.end>=input.start,'ช่วงแผนไม่ถูกต้อง');
    const services=await rows('SELECT id FROM health_check_services WHERE active=1 AND id IN ('+input.serviceIds.map(()=>'?').join(',')+')',input.serviceIds,db);ensure(services.length===new Set(input.serviceIds).size,'รายการตรวจปิดหรือไม่พบ');
    const r=await execute('INSERT INTO health_check_plans(fiscal_year_id,code,name,location,start_date,end_date) VALUES(?,?,?,?,?,?)',[input.yearId,input.code,input.name,input.location,input.start,input.end],db);
    for(const serviceId of new Set(input.serviceIds)) await execute('INSERT INTO plan_services(plan_id,service_id) VALUES(?,?)',[r.insertId,serviceId],db);
    await audit(db,actor.id,'CREATE','plans',r.insertId,{yearId:input.yearId,code:input.code});return {id:r.insertId};
  });
}
export async function enroll(body:unknown,actor:Actor) {
  const input=z.object({employeeId:id,planId:id,snapshotDate:date,serviceIds:z.array(id).min(1),rounds:id.max(10)}).parse(body);
  return transaction(async db=>{
    const [employee]=await rows<RecordRow>('SELECT * FROM employees WHERE id=? AND active=1 FOR UPDATE',[input.employeeId],db);ensure(employee,'ไม่พบบุคลากรที่เปิดใช้งาน');
    const [plan]=await rows<RecordRow>(`SELECT p.*,y.status year_status,y.start_date year_start,y.end_date year_end FROM health_check_plans p JOIN fiscal_years y ON y.id=p.fiscal_year_id WHERE p.id=? FOR UPDATE`,[input.planId],db);ensure(plan?.status==='OPEN'&&plan.year_status==='OPEN','แผนหรือปีปิดอยู่');
    ensure(inRange(input.snapshotDate,String(plan.year_start),String(plan.year_end)),'วันที่อ้างอิงต้องอยู่ในปีงบประมาณ');
    const [assignment]=await rows<RecordRow>(`SELECT a.*,d.name department_name,p.name position_name FROM employee_assignments a JOIN departments d ON d.id=a.department_id JOIN positions p ON p.id=a.position_id WHERE a.employee_id=? AND a.valid_from<=? AND (a.valid_to IS NULL OR a.valid_to>?)`,[input.employeeId,input.snapshotDate,input.snapshotDate],db);
    ensure(assignment,'ไม่มีประวัติหน่วยงาน/ตำแหน่งในวันที่อ้างอิง');
    ensure(hasScope(actor,Number(assignment.department_id)),'หน่วยงานอยู่นอกสิทธิ์',403);
    let [member]=await rows<{id:number}>('SELECT id FROM fiscal_year_members WHERE fiscal_year_id=? AND employee_id=?',[plan.fiscal_year_id,input.employeeId],db);
    if(!member) {
      const r=await execute('INSERT INTO fiscal_year_members(fiscal_year_id,employee_id,assignment_id,department_id,display_name,department_name,position_name,snapshot_date) VALUES(?,?,?,?,?,?,?,?)',[plan.fiscal_year_id,input.employeeId,assignment.id,assignment.department_id,`${employee.prefix}${employee.first_name} ${employee.last_name}`,assignment.department_name,assignment.position_name,input.snapshotDate],db);member={id:r.insertId};
    }
    for(const serviceId of new Set(input.serviceIds)){
      ensure((await rows('SELECT service_id FROM plan_services WHERE plan_id=? AND service_id=?',[input.planId,serviceId],db)).length,'รายการตรวจไม่ได้อยู่ในแผน');
      for(let round=1;round<=input.rounds;round++) await execute('INSERT IGNORE INTO member_service_requirements(member_id,plan_id,fiscal_year_id,service_id,round_no) VALUES(?,?,?,?,?)',[member.id,input.planId,plan.fiscal_year_id,serviceId,round],db);
    }
    await audit(db,actor.id,'ENROLL','fiscal_year_members',member.id,{planId:input.planId,serviceIds:input.serviceIds,rounds:input.rounds});return member;
  });
}
export async function updatePlan(planId:number,body:unknown,actor:Actor) {
  const input=z.object({name:text(),location:text(),start:date,end:date,status:z.enum(['OPEN','CLOSED']),version:id,reason:text(500)}).parse(body);
  return transaction(async db=>{
    const [p]=await rows<RecordRow>('SELECT p.*,y.status year_status,y.start_date year_start,y.end_date year_end FROM health_check_plans p JOIN fiscal_years y ON y.id=p.fiscal_year_id WHERE p.id=? FOR UPDATE',[planId],db);
    ensure(p&&p.year_status==='OPEN','ปีงบประมาณปิดหรือไม่พบแผน',409);ensure(Number(p.version)===input.version,'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่',409);
    ensure(inRange(input.start,String(p.year_start),String(p.year_end))&&inRange(input.end,String(p.year_start),String(p.year_end))&&input.start<=input.end,'ช่วงแผนไม่ถูกต้อง');
    const outside=await rows('SELECT id FROM health_check_appointments WHERE plan_id=? AND (appointment_date<? OR appointment_date>?) LIMIT 1',[planId,input.start,input.end],db);ensure(!outside.length,'ช่วงแผนใหม่ต้องครอบคลุมนัดที่มีอยู่');
    await execute('UPDATE health_check_plans SET name=?,location=?,start_date=?,end_date=?,status=?,version=version+1 WHERE id=?',[input.name,input.location,input.start,input.end,input.status,planId],db);
    if(input.status==='CLOSED')await execute("UPDATE notification_jobs j JOIN health_check_appointments a ON a.id=j.appointment_id SET j.status='CANCELLED',j.safe_error='PLAN_CLOSED' WHERE a.plan_id=? AND j.status='PENDING'",[planId],db);
    await audit(db,actor.id,'UPDATE','plans',planId,{name:input.name,status:input.status,reason:input.reason});return {id:planId};
  });
}
export async function members(yearId:number,actor:Actor) {
  const scope=scopeSql(actor);
  return rows(`SELECT m.*,e.employee_code,(SELECT GROUP_CONCAT(DISTINCT CONCAT(r.plan_id,':',r.service_id,':',r.round_no)) FROM member_service_requirements r WHERE r.member_id=m.id AND r.status='REQUIRED') requirements
   FROM fiscal_year_members m JOIN employees e ON e.id=m.employee_id WHERE m.fiscal_year_id=? AND ${scope.sql} ORDER BY m.display_name`,[yearId,...scope.params]);
}
export async function saveUser(body:unknown,actor:Actor) {
  const input=z.object({username:z.string().regex(/^[A-Za-z0-9_.-]{3,100}$/),displayName:text(200),password:z.string().min(12).refine(p=>Buffer.byteLength(p)<=72,'รหัสผ่านไม่เกิน 72 bytes'),role:z.enum(['ADMIN','STAFF','VIEWER']),departmentIds:z.array(id).default([])}).parse(body);
  const hash=await bcrypt.hash(input.password,12);
  return transaction(async db=>{
    const r=await execute('INSERT INTO users(username,display_name,password_hash) VALUES(?,?,?)',[input.username,input.displayName,hash],db);
    await execute('INSERT INTO user_roles(user_id,role_id) SELECT ?,id FROM roles WHERE code=?',[r.insertId,input.role],db);
    for(const departmentId of new Set(input.departmentIds)) await execute('INSERT INTO user_department_scopes(user_id,department_id) VALUES(?,?)',[r.insertId,departmentId],db);
    await audit(db,actor.id,'CREATE_USER','users',r.insertId,{role:input.role,departmentIds:input.departmentIds});return {id:r.insertId};
  });
}
