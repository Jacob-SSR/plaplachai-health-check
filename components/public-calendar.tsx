'use client';
import { HospitalLogo } from './hospital-logo';
import { useEffect,useState,useSyncExternalStore } from 'react';
import Link from 'next/link';
import { serviceTone } from './annual-plan';
import { LogIn,ChevronLeft,ChevronRight,Settings,LogOut,CalendarDays,List,X } from 'lucide-react';
import { Select,Table,thaiDate,type Item } from './ui';
import { bangkokNow,fiscalYearForDate } from '../src/domain/validation';
import { HOSXP_ROOMS } from '../src/domain/hosxp';
import { APPOINTMENT_STATUS,type AppointmentStatus } from '../src/domain/appointment-status';
import { labGroups,thaiList } from '../src/domain/notice';

type Appt={oapp_id:string;day:string;time:string;group_id:number;group_name:string;name:string;work_group:string;department:string;clinic_name:string;doctor_name:string;location:string;status?:AppointmentStatus;lab_tests?:string[]};
type Data={departments:Item[];appointments:Appt[]};
type Account={admin:boolean;name:string;csrf:string}|null;
const WEEKDAYS=['จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์','อาทิตย์'],SIZES=['ก','ก+','ก++'];
type View='calendar'|'agenda';
// Viewer preferences (text size, calendar or day list) are kept per browser. Storage may be blocked,
// so the choice also lives in memory for this page.
const memory=new Map<string,string>(),listeners=new Set<()=>void>();
const load=(key:string)=>{try{return window.localStorage.getItem(key)??memory.get(key)??null;}catch{return memory.get(key)??null;}};
const save=(key:string,value:string)=>{memory.set(key,value);try{window.localStorage.setItem(key,value);}catch{}listeners.forEach(f=>f());};
const NARROW='(max-width: 780px)';
function subscribe(f:()=>void){listeners.add(f);const media=window.matchMedia(NARROW);media.addEventListener('change',f);window.addEventListener('storage',f);
  return()=>{listeners.delete(f);media.removeEventListener('change',f);window.removeEventListener('storage',f);};}
// Phones get the day list by default: a 7-column month does not fit a narrow screen.
const viewSnapshot=():View=>{const v=load('calendar-view');return v==='calendar'||v==='agenda'?v:window.matchMedia(NARROW).matches?'agenda':'calendar';};
const sizeSnapshot=()=>{const v=Number(load('calendar-text-size'));return v>0&&v<SIZES.length?v:0;};
const groups=HOSXP_ROOMS.map(room=>({id:Number(room.code),name:room.name}));
export function PublicCalendar({account}:{account:Account}){
  const [data,setData]=useState<Data>({departments:[],appointments:[]});
  const [month,setMonth]=useState(()=>bangkokNow().day.slice(0,7));
  const [filters,setFilters]=useState<Record<string,string>>({}),[selected,setSelected]=useState(''),[detail,setDetail]=useState<Appt>(),[notify,setNotify]=useState<{id:string;text:string;busy:boolean}>(),[error,setError]=useState(''),[busy,setBusy]=useState(true);
  const size=useSyncExternalStore(subscribe,sizeSnapshot,()=>0),view=useSyncExternalStore(subscribe,viewSnapshot,():View=>'calendar');
  const chooseSize=(i:number)=>save('calendar-text-size',String(i)),chooseView=(v:View)=>save('calendar-view',v);
  useEffect(()=>{if(!detail)return;const close=(e:KeyboardEvent)=>{if(e.key==='Escape')setDetail(undefined);};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[detail]);
  const query=new URLSearchParams({month,...Object.fromEntries(Object.entries(filters).filter(([,v])=>v))}).toString();
  useEffect(()=>{
    const controller=new AbortController();
    async function load(){
      setBusy(true);setError('');setData({departments:[],appointments:[]});
      try{const r=await fetch(`/api/v1/public-calendar?${query}`,{signal:controller.signal,cache:'no-store'});const body=await r.json();if(!r.ok)throw Error(body.message);if(!controller.signal.aborted)setData(body);}
      catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'โหลดนัดหมายไม่สำเร็จ');}
      finally{if(!controller.signal.aborted)setBusy(false);}
    }
    void load();const timer=setInterval(()=>void load(),30000);
    return()=>{controller.abort();clearInterval(timer);};
  },[query]);
  const first=new Date(`${month}-01T00:00:00Z`),fiscalYear=fiscalYearForDate(`${month}-01`),today=bangkokNow().day;
  const days=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate(),offset=(first.getUTCDay()+6)%7;
  const go=(target:string)=>{setMonth(target);setSelected('');setDetail(undefined);};
  const shift=(step:number)=>{const d=new Date(first);d.setUTCMonth(d.getUTCMonth()+step);go(d.toISOString().slice(0,7));};
  const list=data.appointments.filter(v=>!selected||v.day===selected);
  const tone=(groupId:number)=>serviceTone(groups.find(g=>g.id===groupId)?.name??'',0);
  const time=(a:Appt)=>a.time?a.time.slice(0,5):'';
  const sorted=(list:Appt[])=>[...list].sort((a,b)=>(a.time||'99').localeCompare(b.time||'99')||a.name.localeCompare(b.name,'th'));
  const byDay=new Map<string,Appt[]>();for(const a of data.appointments)byDay.set(a.day,[...(byDay.get(a.day)??[]),a]);
  const MAX_IN_DAY=4;
  const open=(a:Appt)=>{setSelected(a.day);setDetail(a);setNotify(undefined);};
  const SENT:Record<string,string>={ACCEPTED:'ส่งแล้ว · MOPH รับคำขอ',BLOCKED:'ยังส่งไม่ได้',FAILED:'ส่งไม่ผ่าน',UNKNOWN:'ยังยืนยันผลไม่ได้ ตรวจ LINE ของผู้รับก่อนส่งซ้ำ',CANCELLED:'ยกเลิก'};
  async function sendNotice(a:Appt){
    if(!account||!window.confirm(`ส่งแจ้งเตือนนัดให้ ${a.name} ตอนนี้?`))return;
    setNotify({id:a.oapp_id,text:'กำลังส่ง…',busy:true});
    try{const r=await fetch('/api/v1/notifications/manual',{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':account.csrf},body:JSON.stringify({oappId:a.oapp_id})});
      const b=await r.json();if(!r.ok)throw Error(b.message);setNotify({id:a.oapp_id,text:`${SENT[b.status]??b.status}${b.safe_error?` · ${b.safe_error}`:''}`,busy:false});}
    catch(e){setNotify({id:a.oapp_id,text:e instanceof Error?e.message:'ส่งไม่สำเร็จ',busy:false});}
  }
  const monthName=new Intl.DateTimeFormat('th-TH',{month:'long',year:'numeric',timeZone:'UTC'}).format(first);
  const longDay=(day:string)=>new Intl.DateTimeFormat('th-TH',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${day}T00:00:00Z`));
  const chip=(a:Appt)=><button key={a.oapp_id} className={`cal-chip ${tone(a.group_id)}`} title={`${a.name} · ${a.group_name}`} onClick={()=>open(a)}>
    {time(a)&&<b>{time(a)}</b>}<span>{a.name}</span></button>;
  const agendaDays=[...byDay.keys()].filter(d=>!selected||d===selected).sort();
  return <div className={`public-shell text-size-${size}`}><header className="public-header">
    <Link href="/" className="brand"><HospitalLogo/><div>โรงพยาบาลพลับพลาชัย<small>ตารางตรวจสุขภาพบุคลากร</small></div></Link>
    <div className="actions">{account?.admin&&<Link className="button primary" href="/admin"><Settings size={17}/>จัดการระบบ</Link>}
      {account?<><span className="small muted">{account.name}</span><button aria-label="ออกจากระบบ" onClick={async()=>{const r=await fetch('/api/v1/auth/logout',{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':account.csrf},body:'{}'});if(r.ok)window.location.reload();else setError('ออกจากระบบไม่สำเร็จ');}}><LogOut size={17}/></button></>:<Link className="button primary" href="/login"><LogIn size={17}/>เข้าสู่ระบบ</Link>}
    </div></header>
    <main className="public-content"><div className="section-head"><div><p className="eyebrow">ปฏิทินประจำปีงบประมาณ {fiscalYear}</p>
      <h1>ตารางตรวจสุขภาพบุคลากร</h1><p className="muted">วันนัดจาก HOSxP · สร้าง เลื่อน และยกเลิกนัดที่ HOSxP</p><span className="badge">ปีงบประมาณ {fiscalYear} · คำนวณอัตโนมัติ</span></div>
      <div className="text-size" role="group" aria-label="ขนาดตัวอักษร"><span>ขนาดตัวอักษร</span>
        {SIZES.map((label,i)=><button key={label} aria-pressed={size===i} aria-label={`ตัวอักษร${['ปกติ','ใหญ่','ใหญ่มาก'][i]}`} onClick={()=>chooseSize(i)} style={{fontSize:15+i*3}}>{label}</button>)}</div></div>
      {error&&<p role="alert" className="error">{error} · ยังโหลดข้อมูลนัดหมายไม่ได้</p>}
      <section className="surface" aria-label="ปฏิทินตรวจสุขภาพ"><div className="filters">
        {data.departments.length>0&&<Select label="หน่วยงาน" options={data.departments} value={filters.department??''} onChange={e=>setFilters({...filters,department:e.target.value})}/>}
        <label>ห้องบริการ<select aria-label="ห้องบริการ" value={filters.group??''} onChange={e=>setFilters({...filters,group:e.target.value})}><option value="">ทุกห้องบริการ</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
        <div className="view-switch" role="group" aria-label="รูปแบบการแสดง">
          <button aria-pressed={view==='calendar'} onClick={()=>chooseView('calendar')}><CalendarDays size={20}/>ปฏิทิน</button>
          <button aria-pressed={view==='agenda'} onClick={()=>chooseView('agenda')}><List size={20}/>รายการตามวัน</button></div></div>
        <div className="service-legend" aria-label="สีของแต่ละห้องบริการ">{groups.map(g=><span key={g.id} className={serviceTone(g.name,0)}>{g.name}</span>)}</div>
        <div className="month-nav"><button className="month-step" aria-label="เดือนก่อน" disabled={month<='1960-02'} onClick={()=>shift(-1)}><ChevronLeft size={24}/><span>เดือนก่อน</span></button>
          <div className="month-title"><h2>{monthName}</h2>{busy?<span className="muted" role="status">กำลังโหลด…</span>:!error&&<span className="muted">{data.appointments.length} นัดหมาย</span>}</div>
          <button className="month-step" aria-label="เดือนถัดไป" disabled={month>='2199-11'} onClick={()=>shift(1)}><span>เดือนถัดไป</span><ChevronRight size={24}/></button></div>
        {month!==today.slice(0,7)&&<div className="back-today"><button onClick={()=>go(today.slice(0,7))}>กลับไปเดือนนี้</button></div>}
        {view==='calendar'?<div className="calendar-scroll"><div className="calendar">{WEEKDAYS.map((v,i)=><div key={v} className={`weekday${i>4?' weekend':''}`}>{v}</div>)}
          {Array.from({length:offset},(_,i)=><div key={`blank${i}`} className="day blank"/>)}
          {Array.from({length:days},(_,i)=>{const day=`${month}-${String(i+1).padStart(2,'0')}`,people=sorted(byDay.get(day)??[]),weekend=(offset+i)%7>4;
            return <div key={day} className={`day${selected===day?' selected-day':''}${day===today?' is-today':''}${weekend?' weekend':''}${day<today?' past':''}`}>
              <button className="day-number" aria-label={`ดูนัด ${longDay(day)}${people.length?` ${people.length} คน`:''}`} onClick={()=>{setSelected(day);setDetail(undefined);}}>
                <span>{i+1}</span>{day===today&&<em>วันนี้</em>}{people.length>0&&<small>{people.length} คน</small>}</button>
              {people.slice(0,MAX_IN_DAY).map(chip)}
              {people.length>MAX_IN_DAY&&<button className="cal-more" onClick={()=>{setSelected(day);setDetail(undefined);document.getElementById('day-list')?.scrollIntoView({behavior:'smooth'});}}>+ อีก {people.length-MAX_IN_DAY} คน</button>}
            </div>;})}</div></div>
        :<div className="agenda">{!busy&&!error&&!agendaDays.length&&<p className="empty-note">ไม่มีนัดหมายในเดือนนี้</p>}
          {agendaDays.map(day=><section key={day} className={`agenda-day${day===today?' is-today':''}${day<today?' past':''}`} aria-label={longDay(day)}>
            <h3><span>{longDay(day)}</span>{day===today&&<em>วันนี้</em>}<small>{byDay.get(day)!.length} คน</small></h3>
            <ul>{sorted(byDay.get(day)!).map(a=><li key={a.oapp_id}><button onClick={()=>open(a)}>
              <b className="agenda-time">{time(a)?`${time(a)} น.`:'ไม่ระบุเวลา'}</b>
              <span className="agenda-name">{a.name}<small>{a.work_group||'ไม่ระบุกลุ่มงาน'}</small></span>
              <span className={`agenda-room ${tone(a.group_id)}`}>{a.clinic_name||a.group_name}</span></button></li>)}</ul></section>)}
          {selected&&<div className="back-today"><button onClick={()=>setSelected('')}>ดูทั้งเดือน</button></div>}</div>}
      </section>
      {detail&&<div className="dialog-backdrop" onClick={e=>{if(e.target===e.currentTarget)setDetail(undefined);}}>
        <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="appt-title">
        <div className="dialog-head"><div><h2 id="appt-title">{detail.name}</h2><span className={`badge ${tone(detail.group_id)}`}>{detail.group_name}</span></div>
          <button className="dialog-close" autoFocus onClick={()=>setDetail(undefined)}><X size={22}/>ปิด</button></div>
        <dl className="detail-list">
          <div className="span-all big"><dt>วันและเวลานัด</dt><dd>{longDay(detail.day)} · {time(detail)?`${time(detail)} น.`:'ไม่ระบุเวลา'}</dd></div>
          <div className="span-all big"><dt>จุดติดต่อ (ไปก่อน)</dt><dd>{detail.location||'—'}</dd></div>
          <div><dt>กลุ่มงาน</dt><dd>{detail.work_group||'ไม่ระบุ'}</dd></div>
          <div><dt>หน่วยงาน</dt><dd>{detail.department||'ไม่ระบุ'}</dd></div>
          <div><dt>สถานะ</dt><dd>{detail.status?<span className={`badge status-${detail.status.toLowerCase()}`}>{APPOINTMENT_STATUS[detail.status]}</span>:'—'}</dd></div>
          <div><dt>คลินิกที่นัด</dt><dd>{detail.clinic_name||detail.group_name}</dd></div>
          <div><dt>ผู้ให้บริการ</dt><dd>{detail.doctor_name||'ไม่ระบุ'}</dd></div>
          {!!detail.lab_tests?.length&&<div className="span-all"><dt>รายการตรวจทางห้องปฏิบัติการ</dt><dd>{thaiList(labGroups(detail.lab_tests))}<small>{detail.lab_tests.join(', ')}</small></dd></div>}
        </dl>{notify?.id===detail.oapp_id&&<p className="notice" role="status">{notify.text}</p>}
        {account?.admin&&detail.status!=='MISSED'&&detail.status!=='ATTENDED'&&<div className="dialog-actions"><button className="primary" disabled={notify?.busy} onClick={()=>void sendNotice(detail)}>ส่งแจ้งเตือน LINE หมอพร้อม</button></div>}
      </section></div>}
      {view==='calendar'&&<section className="surface padded" id="day-list"><div className="section-head"><div><h2>{selected?`นัด${longDay(selected)}`:'นัดหมายในเดือนนี้'}</h2>
        <p className="muted">{busy?'กำลังโหลด':error?'ยังไม่สามารถยืนยันจำนวนนัด':`${list.length} นัดหมาย`} · เวลาไทย</p></div>{selected&&<button onClick={()=>{setSelected('');setDetail(undefined);}}>ดูทั้งเดือน</button>}</div>
        {!busy&&!error&&<><Table headers={['วันที่','เวลา','ชื่อ','กลุ่มงาน','คลินิก / ห้องบริการ','จุดติดต่อ (ไปก่อน)']} empty={!list.length}>{list.map(a=><tr key={a.oapp_id} className="clickable-row" onClick={()=>open(a)}><td>{thaiDate(a.day)}</td><td>{time(a)?`${time(a)} น.`:'ไม่ระบุเวลา'}</td><td><button className="link-button" onClick={()=>open(a)}>{a.name}</button></td><td>{a.work_group||'—'}</td><td><span className={`badge ${tone(a.group_id)}`}>{a.clinic_name||a.group_name}</span></td><td>{a.location||'—'}</td></tr>)}</Table>
        {!list.length&&<p className="helper">ยังไม่มีนัดหมายในช่วงนี้ สามารถดูปฏิทินและเลื่อนเดือนได้ตามปกติ</p>}</>}
      </section>}
    </main><footer className="page-footer">โรงพยาบาลพลับพลาชัย · งานตรวจสุขภาพบุคลากร<span>ข้อมูลตารางอาจเปลี่ยนแปลง โปรดติดต่อเจ้าหน้าที่เมื่อต้องการเลื่อนนัด</span></footer></div>;
}
