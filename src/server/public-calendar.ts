import { rows } from './db';
import { id,ensure,bangkokNow,fiscalYearForDate,fiscalRange } from '../domain/validation';
import { HOSXP_ROOMS,hosxpRoom } from '../domain/hosxp';

export function calendarPeriod(params:URLSearchParams) {
  const month=params.get('month')??bangkokNow().day.slice(0,7);
  ensure(/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(month),'เดือนต้องเป็น YYYY-MM');
  const fiscalYear=fiscalYearForDate(`${month}-01`),range=fiscalRange(fiscalYear);
  return {month,year:{id:fiscalYear,fiscal_year:fiscalYear,start_date:range.start,end_date:range.end}};
}

export async function publicCalendar(params:URLSearchParams){
  // Calendar dates never depend on stored fiscal years or appointments.
  const {month,year}=calendarPeriod(params);
  const groups=HOSXP_ROOMS.map(room=>({id:Number(room.code),name:room.name}));
  const departments=await rows('SELECT id,name FROM departments WHERE active=1 AND NOT EXISTS(SELECT 1 FROM departments child WHERE child.parent_id=departments.id) ORDER BY name');
  const next=new Date(`${month}-01T00:00:00Z`);next.setUTCMonth(next.getUTCMonth()+1);
  const where=['a.active=1','e.active=1','a.appointment_date>=?','a.appointment_date<?',`a.depcode IN (${HOSXP_ROOMS.map(()=>'?').join(',')})`];
  const values:unknown[]=[`${month}-01`,next.toISOString().slice(0,10),...HOSXP_ROOMS.map(room=>room.code)];
  if(params.get('group')) {
    const room=String(id.parse(params.get('group'))).padStart(3,'0');
    ensure(hosxpRoom(room),'เลือกได้เฉพาะห้องบริการทั้ง 4');where.push('a.depcode=?');values.push(room);
  }
  if(params.get('department')){where.push('EXISTS(SELECT 1 FROM employee_assignments m WHERE m.employee_id=e.id AND m.department_id=? AND m.valid_from<=? AND (m.valid_to IS NULL OR m.valid_to>?))');values.push(id.parse(params.get('department')),bangkokNow().day,bangkokNow().day);}
  const records=await rows<{day:string;time:string;depcode:string;location:string;appointments:number}>(`SELECT a.appointment_date day,COALESCE(a.appointment_time,'') time,a.depcode,a.location,COUNT(*) appointments
    FROM hosxp_appointments a JOIN employees e ON e.id=a.employee_id
    WHERE ${where.join(' AND ')} GROUP BY a.appointment_date,a.appointment_time,a.depcode,a.location ORDER BY a.appointment_date,a.appointment_time`,values);
  const slots=records.map(row=>({...row,group_id:Number(row.depcode),group_name:hosxpRoom(row.depcode)!.name}));
  return {groups,departments,year,month,slots};
}
