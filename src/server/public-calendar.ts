import { rows } from './db';
import { id,ensure,bangkokNow } from '../domain/validation';

export async function publicCalendar(params:URLSearchParams){
  const years=await rows<{id:number;fiscal_year:number;start_date:string;end_date:string}>('SELECT id,fiscal_year,start_date,end_date FROM fiscal_years ORDER BY fiscal_year DESC');
  const groups=[{id:1,name:'นัดหมายจาก HOSxP'}];
  const departments=await rows('SELECT id,name FROM departments WHERE active=1 AND NOT EXISTS(SELECT 1 FROM departments child WHERE child.parent_id=departments.id) ORDER BY name');
  const yearId=params.has('year')?id.parse(params.get('year')):years[0]?.id;
  if(!yearId)return {years,groups,departments,year:null,month:null,slots:[]};
  const year=years.find(y=>y.id===yearId);ensure(year,'ไม่พบปีงบประมาณ',404);
  const today=bangkokNow().day.slice(0,7),first=year.start_date.slice(0,7),last=year.end_date.slice(0,7);
  const month=params.get('month')??(today<first?first:today>last?last:today);
  ensure(/^\d{4}-(0[1-9]|1[0-2])$/.test(month)&&month>=first&&month<=last,'เดือนต้องอยู่ในปีงบประมาณ');
  const next=new Date(`${month}-01T00:00:00Z`);next.setUTCMonth(next.getUTCMonth()+1);
  const where=['a.active=1','e.active=1','a.appointment_date>=?','a.appointment_date<?'];
  const values:unknown[]=[`${month}-01`,next.toISOString().slice(0,10)];
  if(params.get('group')){where.push('1=?');values.push(id.parse(params.get('group')));}
  if(params.get('department')){where.push('EXISTS(SELECT 1 FROM employee_assignments m WHERE m.employee_id=e.id AND m.department_id=? AND m.valid_from<=? AND (m.valid_to IS NULL OR m.valid_to>?))');values.push(id.parse(params.get('department')),bangkokNow().day,bangkokNow().day);}
  const slots=await rows(`SELECT a.appointment_date day,COALESCE(a.appointment_time,'') time,1 group_id,'นัดหมายจาก HOSxP' group_name,a.location,COUNT(*) appointments
    FROM hosxp_appointments a JOIN employees e ON e.id=a.employee_id
    WHERE ${where.join(' AND ')} GROUP BY a.appointment_date,a.appointment_time,a.location ORDER BY a.appointment_date,a.appointment_time`,values);
  return {years,groups,departments,year,month,slots};
}
