'use client';
import { HospitalLogo } from './hospital-logo';
import { useEffect,useState } from 'react';
import Link from 'next/link';
import { serviceTone } from './annual-plan';
import { LogIn,ChevronLeft,ChevronRight,Settings,LogOut } from 'lucide-react';
import { Select,Table,thaiDate,type Item } from './ui';
import { bangkokNow,fiscalYearForDate } from '../src/domain/validation';
import { HOSXP_ROOMS } from '../src/domain/hosxp';
import { APPOINTMENT_STATUS,type AppointmentStatus } from '../src/domain/appointment-status';

type Appt={oapp_id:string;day:string;time:string;group_id:number;group_name:string;name:string;work_group:string;department:string;clinic_name:string;doctor_name:string;location:string;status?:AppointmentStatus};
type Data={departments:Item[];appointments:Appt[]};
type Account={admin:boolean;name:string;csrf:string}|null;
const groups=HOSXP_ROOMS.map(room=>({id:Number(room.code),name:room.name}));
export function PublicCalendar({account}:{account:Account}){
  const [data,setData]=useState<Data>({departments:[],appointments:[]});
  const [month,setMonth]=useState(()=>bangkokNow().day.slice(0,7));
  const [filters,setFilters]=useState<Record<string,string>>({}),[selected,setSelected]=useState(''),[detail,setDetail]=useState<Appt>(),[notify,setNotify]=useState<{id:string;text:string;busy:boolean}>(),[error,setError]=useState(''),[busy,setBusy]=useState(true);
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
  const first=new Date(`${month}-01T00:00:00Z`),fiscalYear=fiscalYearForDate(`${month}-01`);
  const days=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate(),offset=(first.getUTCDay()+6)%7;
  const shift=(step:number)=>{const d=new Date(first);d.setUTCMonth(d.getUTCMonth()+step);setMonth(d.toISOString().slice(0,7));setSelected('');setDetail(undefined);};
  const list=data.appointments.filter(v=>!selected||v.day===selected);
  const tone=(groupId:number)=>serviceTone(groups.find(g=>g.id===groupId)?.name??'',0);
  const shortGroup=(g:string)=>g.replace(/^กลุ่มงาน/,'').trim()||'ไม่ระบุกลุ่มงาน';
  const byGroup=(list:Appt[])=>{const m=new Map<string,Appt[]>();for(const a of list){const k=shortGroup(a.work_group);m.set(k,[...(m.get(k)??[]),a]);}return [...m.entries()].sort(([a],[b])=>a.localeCompare(b,'th'));};
  const MAX_IN_DAY=6;
  const open=(a:Appt)=>{setSelected(a.day);setDetail(a);setNotify(undefined);};
  const SENT:Record<string,string>={ACCEPTED:'ส่งแล้ว · MOPH รับคำขอ',BLOCKED:'ยังส่งไม่ได้',FAILED:'ส่งไม่ผ่าน',UNKNOWN:'ยังยืนยันผลไม่ได้ ตรวจ LINE ของผู้รับก่อนส่งซ้ำ',CANCELLED:'ยกเลิก'};
  async function sendNotice(a:Appt){
    if(!account||!window.confirm(`ส่งแจ้งเตือนนัดให้ ${a.name} ตอนนี้?`))return;
    setNotify({id:a.oapp_id,text:'กำลังส่ง…',busy:true});
    try{const r=await fetch('/api/v1/notifications/manual',{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':account.csrf},body:JSON.stringify({oappId:a.oapp_id})});
      const b=await r.json();if(!r.ok)throw Error(b.message);setNotify({id:a.oapp_id,text:`${SENT[b.status]??b.status}${b.safe_error?` · ${b.safe_error}`:''}`,busy:false});}
    catch(e){setNotify({id:a.oapp_id,text:e instanceof Error?e.message:'ส่งไม่สำเร็จ',busy:false});}
  }
  return <div className="public-shell"><header className="public-header">
    <Link href="/" className="brand"><HospitalLogo/><div>โรงพยาบาลพลับพลาชัย<small>ตารางตรวจสุขภาพบุคลากร</small></div></Link>
    <div className="actions">{account?.admin&&<Link className="button primary" href="/admin"><Settings size={17}/>จัดการระบบ</Link>}
      {account?<><span className="small muted">{account.name}</span><button aria-label="ออกจากระบบ" onClick={async()=>{const r=await fetch('/api/v1/auth/logout',{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':account.csrf},body:'{}'});if(r.ok)window.location.reload();else setError('ออกจากระบบไม่สำเร็จ');}}><LogOut size={17}/></button></>:<Link className="button primary" href="/login"><LogIn size={17}/>เข้าสู่ระบบ</Link>}
    </div></header>
    <main className="public-content"><div className="section-head"><div><p className="eyebrow">ปฏิทินประจำปีงบประมาณ {fiscalYear}</p>
      <h1>ตารางตรวจสุขภาพบุคลากร</h1><p className="muted">วันนัดจาก HOSxP · สร้าง เลื่อน และยกเลิกนัดที่ HOSxP</p></div>
      <span className="badge">ปีงบประมาณ {fiscalYear} · คำนวณอัตโนมัติ</span></div>
      {error&&<p role="alert" className="error">{error} · ยังโหลดข้อมูลนัดหมายไม่ได้</p>}
      {busy&&<p role="status" className="muted">กำลังโหลดนัดหมาย…</p>}
      <section className="surface" aria-label="ปฏิทินตรวจสุขภาพ"><div className="filters">
        {data.departments.length>0&&<Select label="หน่วยงาน" options={data.departments} value={filters.department??''} onChange={e=>setFilters({...filters,department:e.target.value})}/>}
        <label>ห้องบริการ<select aria-label="ห้องบริการ" value={filters.group??''} onChange={e=>setFilters({...filters,group:e.target.value})}><option value="">ทุกห้องบริการ</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
        <p className="helper">คลิกชื่อในปฏิทินเพื่อดูรายละเอียดนัด</p></div>
        <div className="service-legend" aria-label="สีของแต่ละบริการ">{groups.map(g=><span key={g.id} className={serviceTone(g.name,0)}>{g.name}</span>)}</div>
        <div className="month-nav"><button aria-label="เดือนก่อน" disabled={month<='1960-02'} onClick={()=>shift(-1)}><ChevronLeft size={18}/></button>
          <h2>{new Intl.DateTimeFormat('th-TH',{month:'long',year:'numeric',timeZone:'UTC'}).format(first)}</h2>
          <button aria-label="เดือนถัดไป" disabled={month>='2199-11'} onClick={()=>shift(1)}><ChevronRight size={18}/></button></div>
        <div className="calendar-scroll"><div className="calendar">{['จ.','อ.','พ.','พฤ.','ศ.','ส.','อา.'].map(v=><div key={v} className="weekday">{v}</div>)}
          {Array.from({length:offset},(_,i)=><div key={`blank${i}`} className="day blank"/>)}
          {Array.from({length:days},(_,i)=>{const day=`${month}-${String(i+1).padStart(2,'0')}`;return <div key={day} className={`day ${selected===day?'selected-day':''}`}>
            <button className="day-number" aria-label={`ดูนัด ${thaiDate(day)}`} onClick={()=>setSelected(day)}>{i+1}</button>
            {(()=>{const today=data.appointments.filter(v=>v.day===day);let shown=0;return <>{byGroup(today).map(([group,people])=>{const visible=people.slice(0,Math.max(0,MAX_IN_DAY-shown));shown+=visible.length;return visible.length?<div key={group} className="cal-group"><div className="cal-group-name" title={group}>{group}</div>
              <ul>{visible.map(a=><li key={a.oapp_id}><button className="cal-person" title={`${a.name} · ${a.group_name}${a.time?' · '+a.time.slice(0,5)+' น.':''}`} onClick={()=>open(a)}><i className={`cal-dot ${tone(a.group_id)}`}/><span className="cal-name">{a.name}</span></button></li>)}</ul></div>:null;})}
              {today.length>MAX_IN_DAY&&<button className="cal-more" onClick={()=>{setSelected(day);setDetail(undefined);}}>อีก {today.length-MAX_IN_DAY} คน</button>}</>;})()}
          </div>;})}</div></div>
      </section>
      {detail&&<section className="surface padded" aria-label="รายละเอียดนัด"><div className="section-head"><div><h2>{detail.name}</h2>
        <p className="muted"><span className={`badge ${tone(detail.group_id)}`}>{detail.group_name}</span></p></div><div className="actions">{account?.admin&&detail.status!=='MISSED'&&detail.status!=='ATTENDED'&&<button className="primary" disabled={notify?.busy} onClick={()=>void sendNotice(detail)}>ส่งแจ้งเตือน LINE หมอพร้อม</button>}<button onClick={()=>setDetail(undefined)}>ปิด</button></div></div>
        <dl className="detail-list">
          <div><dt>ชื่อ</dt><dd>{detail.name}</dd></div>
          <div><dt>กลุ่มงาน</dt><dd>{detail.work_group||'ไม่ระบุ'}</dd></div>
          <div><dt>หน่วยงาน</dt><dd>{detail.department||'ไม่ระบุ'}</dd></div>
          <div><dt>วันที่นัด</dt><dd>{thaiDate(detail.day)}</dd></div>
          <div><dt>สถานะ</dt><dd>{detail.status?<span className={`badge status-${detail.status.toLowerCase()}`}>{APPOINTMENT_STATUS[detail.status]}</span>:'—'}</dd></div>
          <div><dt>เวลานัด</dt><dd>{detail.time?`${detail.time.slice(0,5)} น.`:'ไม่ระบุเวลา'}</dd></div>
          <div><dt>คลินิกที่นัด</dt><dd>{detail.clinic_name||detail.group_name}</dd></div>
          <div><dt>ห้องบริการ</dt><dd>{detail.group_name}</dd></div>
          <div><dt>ผู้ให้บริการ</dt><dd>{detail.doctor_name||'ไม่ระบุ'}</dd></div>
          <div><dt>จุดติดต่อ (ไปก่อน)</dt><dd>{detail.location||'—'}</dd></div>
        </dl>{notify?.id===detail.oapp_id&&<p className="notice" role="status">{notify.text}</p>}</section>}
      <section className="surface padded"><div className="section-head"><div><h2>{selected?`นัดวันที่ ${thaiDate(selected)}`:'นัดหมายในเดือนนี้'}</h2>
        <p className="muted">{busy?'กำลังโหลด':error?'ยังไม่สามารถยืนยันจำนวนนัด':`${list.length} นัดหมาย`} · เวลาไทย</p></div>{selected&&<button onClick={()=>{setSelected('');setDetail(undefined);}}>ดูทั้งเดือน</button>}</div>
        {!busy&&!error&&<><Table headers={['วันที่','เวลา','ชื่อ','กลุ่มงาน','คลินิก / ห้องบริการ','จุดติดต่อ (ไปก่อน)']} empty={!list.length}>{list.map(a=><tr key={a.oapp_id} className="clickable-row" onClick={()=>open(a)}><td>{thaiDate(a.day)}</td><td>{a.time?`${a.time.slice(0,5)} น.`:'ไม่ระบุเวลา'}</td><td><button className="link-button" onClick={()=>open(a)}>{a.name}</button></td><td>{a.work_group||'—'}</td><td><span className={`badge ${tone(a.group_id)}`}>{a.clinic_name||a.group_name}</span></td><td>{a.location||'—'}</td></tr>)}</Table>
        {!list.length&&<p className="helper">ยังไม่มีนัดหมายในช่วงนี้ สามารถดูปฏิทินและเลื่อนเดือนได้ตามปกติ</p>}</>}
      </section>
    </main><footer className="page-footer">โรงพยาบาลพลับพลาชัย · งานตรวจสุขภาพบุคลากร<span>ข้อมูลตารางอาจเปลี่ยนแปลง โปรดติดต่อเจ้าหน้าที่เมื่อต้องการเลื่อนนัด</span></footer></div>;
}
