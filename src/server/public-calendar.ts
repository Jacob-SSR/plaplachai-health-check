import { rows } from './db';
import { id,ensure,bangkokNow,fiscalYearForDate,fiscalRange } from '../domain/validation';
import { HOSXP_ROOMS,hosxpRoom } from '../domain/hosxp';
import { readPersonnelOapp,withEmployees } from './hosxp';
import { activeHosxpStatus } from './hosxp-sync';

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
  let data:{appointment_date:string;appointment_time:string|null;depcode:string;location:string;source_status_id:unknown;personnel_code:string}[]=
    (await readPersonnelOapp({from:`${month}-01`,to:next.toISOString().slice(0,10)},{room})).filter(a=>activeHosxpStatus(a.source_status_id));
  if(department)data=await withEmployees(data,undefined,department);
  const counts=new Map<string,{day:string;time:string;depcode:string;location:string;appointments:number}>();
  for(const a of data){
    const key=[a.appointment_date,a.appointment_time??'',a.depcode,a.location].join('|');
    const slot=counts.get(key)??{day:a.appointment_date,time:a.appointment_time??'',depcode:a.depcode,location:a.location,appointments:0};
    slot.appointments++;counts.set(key,slot);
  }
  const slots=[...counts.values()].sort((a,b)=>`${a.day} ${a.time}`.localeCompare(`${b.day} ${b.time}`))
    .map(row=>({...row,group_id:Number(row.depcode),group_name:hosxpRoom(row.depcode)!.name}));
  return {groups,departments,year,month,slots};
}
