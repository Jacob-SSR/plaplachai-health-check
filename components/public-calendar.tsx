'use client';
import { HospitalLogo } from './hospital-logo';
import { useEffect,useState } from 'react';
import Link from 'next/link';
import { serviceTone } from './annual-plan';
import { LogIn,ChevronLeft,ChevronRight,Settings,LogOut } from 'lucide-react';
import { Select,Table,n,thaiDate,type Item } from './ui';
import { bangkokNow,fiscalYearForDate } from '../src/domain/validation';
import { HOSXP_ROOMS } from '../src/domain/hosxp';

type Slot={day:string;time:string;group_id:number;group_name:string;location:string;appointments:number};
type Data={departments:Item[];slots:Slot[]};
type Account={admin:boolean;name:string;csrf:string}|null;
const groups=HOSXP_ROOMS.map(room=>({id:Number(room.code),name:room.name}));
export function PublicCalendar({account}:{account:Account}){
  const [data,setData]=useState<Data>({departments:[],slots:[]});
  const [month,setMonth]=useState(()=>bangkokNow().day.slice(0,7));
  const [filters,setFilters]=useState<Record<string,string>>({}),[selected,setSelected]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(true);
  const query=new URLSearchParams({month,...Object.fromEntries(Object.entries(filters).filter(([,v])=>v))}).toString();
  useEffect(()=>{
    const controller=new AbortController();
    async function load(){
      setBusy(true);setError('');setData({departments:[],slots:[]});
      try{const r=await fetch(`/api/v1/public-calendar?${query}`,{signal:controller.signal,cache:'no-store'});const body=await r.json();if(!r.ok)throw Error(body.message);if(!controller.signal.aborted)setData(body);}
      catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'โหลดนัดหมายไม่สำเร็จ');}
      finally{if(!controller.signal.aborted)setBusy(false);}
    }
    void load();const timer=setInterval(()=>void load(),30000);
    return()=>{controller.abort();clearInterval(timer);};
  },[query]);
  const first=new Date(`${month}-01T00:00:00Z`),fiscalYear=fiscalYearForDate(`${month}-01`);
  const days=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate(),offset=(first.getUTCDay()+6)%7;
  const shift=(step:number)=>{const d=new Date(first);d.setUTCMonth(d.getUTCMonth()+step);setMonth(d.toISOString().slice(0,7));setSelected('');};
  const slots=data.slots.filter(v=>!selected||v.day===selected);
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
        <Select label="หน่วยงาน" options={data.departments} value={filters.department??''} onChange={e=>setFilters({...filters,department:e.target.value})}/>
        <label>ห้องบริการ<select aria-label="ห้องบริการ" value={filters.group??''} onChange={e=>setFilters({...filters,group:e.target.value})}><option value="">ทุกห้องบริการ</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
        <p className="helper">แสดงเฉพาะภาพรวม ไม่มีรายชื่อหรือผลตรวจส่วนบุคคล</p></div>
        <div className="month-nav"><button aria-label="เดือนก่อน" disabled={month<='1960-02'} onClick={()=>shift(-1)}><ChevronLeft size={18}/></button>
          <h2>{new Intl.DateTimeFormat('th-TH',{month:'long',year:'numeric',timeZone:'UTC'}).format(first)}</h2>
          <button aria-label="เดือนถัดไป" disabled={month>='2199-11'} onClick={()=>shift(1)}><ChevronRight size={18}/></button></div>
        <div className="calendar-scroll"><div className="calendar">{['จ.','อ.','พ.','พฤ.','ศ.','ส.','อา.'].map(v=><div key={v} className="weekday">{v}</div>)}
          {Array.from({length:offset},(_,i)=><div key={`blank${i}`} className="day blank"/>)}
          {Array.from({length:days},(_,i)=>{const day=`${month}-${String(i+1).padStart(2,'0')}`;return <div key={day} className={`day ${selected===day?'selected-day':''}`}>
            <button className="day-number" aria-label={`ดูนัด ${thaiDate(day)}`} onClick={()=>setSelected(day)}>{i+1}</button>
            {groups.map((g,index)=>{const count=data.slots.filter(v=>v.day===day&&v.group_id===g.id).reduce((sum,v)=>sum+n(v.appointments),0);return count?<button key={g.id} className={`calendar-chip ${serviceTone(g.name,index)}`} onClick={()=>setSelected(day)}>{g.name}<b>{count}</b></button>:null;})}
          </div>;})}</div></div>
      </section>
      <section className="surface padded"><div className="section-head"><div><h2>{selected?`นัดวันที่ ${thaiDate(selected)}`:'นัดหมายในเดือนนี้'}</h2>
        <p className="muted">{busy?'กำลังโหลด':error?'ยังไม่สามารถยืนยันจำนวนนัด':`${slots.reduce((sum,v)=>sum+n(v.appointments),0)} นัดหมาย`} · เวลาไทย</p></div>{selected&&<button onClick={()=>setSelected('')}>ดูทั้งเดือน</button>}</div>
        {!busy&&!error&&<><Table headers={['วันที่','เวลา','ห้องบริการ','สถานที่','จำนวนผู้มีนัด']} empty={!slots.length}>{slots.map((v,i)=><tr key={i}><td>{thaiDate(v.day)}</td><td>{v.time?`${v.time.slice(0,5)} น.`:'ไม่ระบุเวลา'}</td><td>{v.group_name}</td><td>{v.location}</td><td>{v.appointments}</td></tr>)}</Table>
        {!slots.length&&<p className="helper">ยังไม่มีนัดหมายในช่วงนี้ สามารถดูปฏิทินและเลื่อนเดือนได้ตามปกติ</p>}</>}
      </section>
    </main><footer className="page-footer">โรงพยาบาลพลับพลาชัย · งานตรวจสุขภาพบุคลากร<span>ข้อมูลตารางอาจเปลี่ยนแปลง โปรดติดต่อเจ้าหน้าที่เมื่อต้องการเลื่อนนัด</span></footer></div>;
}
