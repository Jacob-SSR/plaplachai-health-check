import { createHash } from 'node:crypto';
import { z } from 'zod';
import { rows,execute,transaction,type DB } from './db';
import { ensure,code,date,text } from '../domain/validation';
import { audit } from './audit';

const personSchema=z.object({
  employeeCode:code,prefix:z.string().max(30).default(''),firstName:text(100),lastName:text(100),
  position:text(150),level:z.string().max(150).default(''),department:text(),group:text(),
  employmentType:z.string().max(150).default(''),active:z.boolean(),sourceRow:z.number().int().positive(),
});
export const personnelSeedSchema=z.object({version:z.literal(1),source:text(),snapshotDate:date,people:z.array(personSchema).min(1).max(2000)});
export type PersonnelSeed=z.infer<typeof personnelSeedSchema>;
const tables={departments:'departments',positions:'positions',levels:'position_levels',employmentTypes:'employment_types'};

async function master(db:DB,kind:keyof typeof tables,name:string,parentId:number|null=null){
  const table=tables[kind],isDepartment=kind==='departments';
  const found=await rows<{id:number;active:number}>(`SELECT id,active FROM ${table} WHERE name=?${isDepartment?' AND parent_id <=> ?':''} FOR UPDATE`,isDepartment?[name,parentId]:[name],db);
  ensure(found.length<=1,'พบ master ชื่อเดียวกันมากกว่าหนึ่งรายการ กรุณาตรวจข้อมูลเดิม',409);
  if(found.length){ensure(found[0].active,'master ที่ต้องใช้นำเข้าปิดใช้งานอยู่',409);return found[0].id;}
  const generated=`HR-${kind.slice(0,3).toUpperCase()}-${createHash('sha256').update(JSON.stringify([name,parentId])).digest('hex').slice(0,24)}`;
  const r=await execute(`INSERT INTO ${table}(code,name${isDepartment?',parent_id':''}) VALUES(?,?${isDepartment?',?':''})`,isDepartment?[generated,name,parentId]:[generated,name],db);
  return r.insertId;
}

export async function importPersonnelSeed(body:unknown,actorId:number|null){
  const seed=personnelSeedSchema.parse(body);
  ensure(new Set(seed.people.map(p=>p.employeeCode)).size===seed.people.length,'รหัสบุคลากรซ้ำในไฟล์');
  ensure(new Set(seed.people.map(p=>`${p.firstName}\0${p.lastName}`)).size===seed.people.length,'ชื่อซ้ำในไฟล์ ต้องแยกตัวบุคคลก่อนนำเข้า');
  return transaction(async db=>{
    // Serialize initial population imports; existing employees are never matched by name alone.
    await rows('SELECT id FROM hospitals ORDER BY id LIMIT 1 FOR UPDATE',[],db);
    let created=0,unchanged=0;
    for(const p of seed.people){
      const groupId=await master(db,'departments',p.group);
      const departmentId=await master(db,'departments',p.department,groupId);
      const positionId=await master(db,'positions',p.position);
      const levelId=p.level?await master(db,'levels',p.level):null;
      const employmentTypeId=p.employmentType?await master(db,'employmentTypes',p.employmentType):null;
      const [old]=await rows<{id:number;prefix:string;first_name:string;last_name:string}>('SELECT id,prefix,first_name,last_name FROM employees WHERE employee_code=? FOR UPDATE',[p.employeeCode],db);
      if(old){
        ensure(old.first_name===p.firstName&&old.last_name===p.lastName,'รหัสในไฟล์ชนกับบุคลากรเดิม หยุดนำเข้าทั้งชุด',409);
        // Preserve later transfers and edits on replay instead of restoring an old snapshot.
        unchanged++;continue;
      }
      const duplicates=await rows('SELECT id FROM employees WHERE first_name=? AND last_name=? FOR UPDATE',[p.firstName,p.lastName],db);
      ensure(!duplicates.length,`แถว ${p.sourceRow}: พบชื่อในระบบแต่รหัสต่างกัน ให้ตรวจรับ employeeCode ก่อนนำเข้า ไม่รวมคนจากชื่ออัตโนมัติ`,409);
      const e=await execute('INSERT INTO employees(employee_code,prefix,first_name,last_name,active) VALUES(?,?,?,?,?)',[p.employeeCode,p.prefix,p.firstName,p.lastName,p.active],db);
      await execute('INSERT INTO employee_assignments(employee_id,department_id,position_id,level_id,employment_type_id,valid_from) VALUES(?,?,?,?,?,?)',[e.insertId,departmentId,positionId,levelId,employmentTypeId,seed.snapshotDate],db);
      created++;
    }
    await audit(db,actorId,'PERSONNEL_SEED','employees',null,{source:seed.source,snapshotDate:seed.snapshotDate,total:seed.people.length,created,unchanged});
    return {total:seed.people.length,created,unchanged,positions:new Set(seed.people.map(p=>p.position)).size,groups:new Set(seed.people.map(p=>p.group)).size,departments:new Set(seed.people.map(p=>`${p.group}\0${p.department}`)).size};
  });
}
