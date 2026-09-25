import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { rows } from '../src/server/db';
import type { Actor } from '../src/server/auth';
import { saveMaster,createYear,createPlan,createEmployee,enroll } from '../src/server/registry';
import { bangkokNow,fiscalRange } from '../src/domain/validation';
export function testGuard(){if(process.env.ALLOW_TEST_DATABASE!=='true'||!process.env.DB_NAME?.endsWith('_test')||process.env.MOPH_LIVE_ENABLED==='true')throw Error('Tests require ALLOW_TEST_DATABASE=true, DB_NAME ending _test, MOPH_LIVE_ENABLED=false');}
export async function fixture(){
 testGuard();const [u]=await rows<{id:number}>('SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.code=\'ADMIN\' LIMIT 1');
 if(!u)throw Error('Run db:bootstrap first');
 const actor:Actor={id:u.id,username:'test',displayName:'ทดสอบ',roles:['ADMIN'],permissions:[],departments:[],csrf:''};
 const tag=randomUUID().slice(0,8),day=bangkokNow().day,ad=Number(day.slice(0,4)),fy=ad+543+(day.slice(5)>='10-01'?1:0);
 const existing=await rows<{id:number}>('SELECT id FROM fiscal_years WHERE fiscal_year=?',[fy]);
 const yearId=existing[0]?.id??(await createYear({year:fy},actor)).id,range=fiscalRange(fy);
 const department=await saveMaster('departments',undefined,{code:`D${tag}`,name:`หน่วยงานทดสอบ ${tag}`},actor);
 const position=await saveMaster('positions',undefined,{code:`P${tag}`,name:'เจ้าหน้าที่ทดสอบ'},actor);
 const group=await saveMaster('groups',undefined,{code:`G${tag}`,name:'ตรวจสุขภาพ (ข้อมูลสมมติ)'},actor);
 const service=await saveMaster('services',undefined,{code:`S${tag}`,name:'ตรวจทั่วไป',groupId:group.id},actor);
 const plan=await createPlan({yearId,code:`PLAN${tag}`,name:`แผนทดสอบ ${tag}`,location:'ห้องทดสอบ',start:range.start,end:range.end,serviceIds:[service.id]},actor);
 const people=[];
 for(let i=1;i<=4;i++){
  const employeeCode=`T${tag}${i}`,employee=await createEmployee({employeeCode,prefix:'',firstName:`ทดสอบ${i}`,lastName:'ข้อมูลสมมติ',departmentId:department.id,positionId:position.id,validFrom:range.start},actor);
  const member=await enroll({employeeId:employee.id,planId:plan.id,snapshotDate:range.start,rounds:2,serviceIds:[service.id]},actor);people.push({employeeId:employee.id,memberId:member.id,employeeCode});
 }
 return {actor,yearId,fy,range,day,departmentId:department.id!,positionId:position.id!,groupId:group.id!,groupCode:`G${tag}`,serviceId:service.id!,serviceCode:`S${tag}`,planId:plan.id,planCode:`PLAN${tag}`,people};
}
