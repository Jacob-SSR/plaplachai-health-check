import { rows } from './db';
import { id,ensure,bangkokNow,fiscalYearForDate,fiscalRange } from '../domain/validation';
import { HOSXP_ROOMS,hosxpRoom } from '../domain/hosxp';
import { readPersonnelOapp,withEmployees } from './hosxp';
import { activeHosxpStatus } from './hosxp-sync';
import { hrLookup } from './hr-personnel';

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
  const next=new Date(`${month}-01T00:00:00Z`);next.setUTCMonth(next.getUTCMonth()+1);next.setUTCDate(0);
  let room:string|undefined;
  if(params.get('group')) {
    room=String(id.parse(params.get('group'))).padStart(3,'0');
    ensure(hosxpRoom(room),'เลือกได้เฉพาะห้องบริการทั้ง 4');
  }
  const department=params.get('department')?id.parse(params.get('department')):undefined;
  // Read HOSxP live so a new appointment shows without waiting for the worker.
  let data=(await readPersonnelOapp({from:`${month}-01`,to:next.toISOString().slice(0,10)},{room})).filter(a=>activeHosxpStatus(a.source_status_id));
  if(department)data=await withEmployees(data,undefined,department);
  const hr=await hrLookup();
  const appointments=data.map(a=>({oapp_id:a.oapp_id,day:a.appointment_date,time:a.appointment_time??'',
    group_id:Number(a.depcode),group_name:a.room_name,name:a.display_name,
    work_group:hr(a.personnel_code,a.display_name)?.work_group??'',department:hr(a.personnel_code,a.display_name)?.department??'',clinic_name:a.clinic_name??'',
    doctor_name:a.doctor_name??'',location:a.location}))
    .sort((a,b)=>`${a.day} ${a.time} ${a.name}`.localeCompare(`${b.day} ${b.time} ${b.name}`));
  return {groups,departments,year,month,appointments};
}

