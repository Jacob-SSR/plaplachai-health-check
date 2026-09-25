import { rows } from './db';
import { id,ensure,bangkokNow } from '../domain/validation';

export async function publicCalendar(params:URLSearchParams){
  const years=await rows<{id:number;fiscal_year:number;start_date:string;end_date:string}>('SELECT id,fiscal_year,start_date,end_date FROM fiscal_years ORDER BY fiscal_year DESC');
  const groups=await rows('SELECT id,name FROM service_groups WHERE active=1 ORDER BY name');
  const departments=await rows('SELECT id,name FROM departments WHERE active=1 AND NOT EXISTS(SELECT 1 FROM departments child WHERE child.parent_id=departments.id) ORDER BY name');
  const yearId=params.has('year')?id.parse(params.get('year')):years[0]?.id;
  if(!yearId)return {years,groups,departments,year:null,month:null,slots:[]};
  const year=years.find(y=>y.id===yearId);ensure(year,'ไม่พบปีงบประมาณ',404);
  const today=bangkokNow().day.slice(0,7),first=year.start_date.slice(0,7),last=year.end_date.slice(0,7);
  const month=params.get('month')??(today<first?first:today>last?last:today);
  ensure(/^\d{4}-(0[1-9]|1[0-2])$/.test(month)&&month>=first&&month<=last,'เดือนต้องอยู่ในปีงบประมาณ');
  const next=new Date(`${month}-01T00:00:00Z`);next.setUTCMonth(next.getUTCMonth()+1);
  const where=['a.fiscal_year_id=?',"a.status<>'CANCELLED'",'a.appointment_date>=?','a.appointment_date<?'];
  const values:unknown[]=[yearId,`${month}-01`,next.toISOString().slice(0,10)];
  if(params.get('group')){where.push('a.service_group_id=?');values.push(id.parse(params.get('group')));}
  if(params.get('department')){where.push('m.department_id=?');values.push(id.parse(params.get('department')));}
  const slots=await rows(`SELECT a.appointment_date day,a.appointment_time time,g.id group_id,g.name group_name,a.location,COUNT(*) appointments
    FROM health_check_appointments a JOIN fiscal_year_members m ON m.id=a.member_id JOIN service_groups g ON g.id=a.service_group_id
    WHERE ${where.join(' AND ')} GROUP BY a.appointment_date,a.appointment_time,g.id,g.name,a.location ORDER BY a.appointment_date,a.appointment_time,g.name`,values);
  return {years,groups,departments,year,month,slots};
}
