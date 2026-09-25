import { execute,rows,type DB } from './db';
import { ensure } from '../domain/validation';

// Service identities are permanent. Only the annual scheduling container is new each year.
export async function prepareAnnualServices(yearId:number,db:DB){
  const [year]=await rows<{id:number;fiscal_year:number;start_date:string;end_date:string;status:string}>('SELECT * FROM fiscal_years WHERE id=? FOR UPDATE',[yearId],db);
  ensure(year?.status==='OPEN','ปีงบประมาณปิดหรือไม่พบ');
  const services=await rows<{service_id:number}>(`SELECT d.service_id FROM standard_health_services d
    JOIN health_check_services s ON s.id=d.service_id JOIN service_groups g ON g.id=s.service_group_id
    WHERE s.active=1 AND g.active=1 ORDER BY d.sort_order`,[],db);
  ensure(services.length===4,'กรุณาเปิดใช้งานบริการประจำทั้ง 4 รายการก่อนเปิดปีงบประมาณ');
  const code=`PPC_FY_${year.fiscal_year}`;
  let [plan]=await rows<{id:number;fiscal_year_id:number}>('SELECT id,fiscal_year_id FROM health_check_plans WHERE code=?',[code],db);
  if(!plan){
    const result=await execute('INSERT INTO health_check_plans(fiscal_year_id,code,name,location,start_date,end_date) VALUES(?,?,?,?,?,?)',
      [yearId,code,`ตรวจสุขภาพบุคลากร ปี ${year.fiscal_year}`,'โรงพยาบาลพลับพลาชัย',year.start_date,year.end_date],db);
    plan={id:result.insertId,fiscal_year_id:yearId};
  }
  ensure(plan.fiscal_year_id===yearId,'รหัสชุดตรวจประจำปีชนกับข้อมูลเดิม',409);
  for(const service of services)await execute('INSERT IGNORE INTO plan_services(plan_id,service_id) VALUES(?,?)',[plan.id,service.service_id],db);
  return plan.id;
}
