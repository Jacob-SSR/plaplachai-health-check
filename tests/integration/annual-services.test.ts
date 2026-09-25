import { test,after } from 'node:test';
import assert from 'node:assert/strict';
import { fixture,testGuard } from '../fixture';
import { rows,transaction,closePool } from '../../src/server/db';
import { createYear,enroll } from '../../src/server/registry';
import { prepareAnnualServices } from '../../src/server/annual-services';

testGuard();after(closePool);
test('four permanent services are reused across years with independent annual registers',async()=>{
 const f=await fixture();
 const catalog=await rows<{service_id:number;name:string}>('SELECT d.service_id,s.name FROM standard_health_services d JOIN health_check_services s ON s.id=d.service_id ORDER BY sort_order');
 assert.deepEqual(catalog.map(s=>s.name),['ทันตกรรม','แผนไทย','กายภาพ','ตรวจเลือด']);
 const existing=await rows<{fiscal_year:number}>('SELECT fiscal_year FROM fiscal_years');const used=new Set(existing.map(y=>y.fiscal_year));
 const years=Array.from({length:199},(_,i)=>2600+i).filter(y=>!used.has(y)).slice(0,2);assert.equal(years.length,2);
 const members=[];
 for(const year of years){
  const y=await createYear({year},f.actor);
  const [plan]=await rows<{id:number}>('SELECT id FROM health_check_plans WHERE fiscal_year_id=?',[y.id]);assert.ok(plan);
  assert.equal(await transaction(db=>prepareAnnualServices(y.id,db)),plan.id);
  const ids=await rows<{service_id:number}>('SELECT service_id FROM plan_services WHERE plan_id=? ORDER BY service_id',[plan.id]);
  assert.deepEqual(ids.map(s=>s.service_id),catalog.map(s=>s.service_id).sort((a,b)=>a-b));
  const member=await enroll({employeeId:f.people[0].employeeId,planId:plan.id,snapshotDate:`${year-544}-10-01`,rounds:1,serviceIds:catalog.map(s=>s.service_id)},f.actor);members.push(member.id);
 }
 assert.notEqual(members[0],members[1]);
 const counts=await rows<{count:number}>('SELECT COUNT(*) count FROM member_service_requirements WHERE member_id IN (?,?)',members);assert.equal(counts[0].count,8);
 assert.equal((await rows('SELECT * FROM standard_health_services')).length,4);
});
