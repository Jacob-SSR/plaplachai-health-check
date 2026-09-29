'use client';
import { bangkokNow,fiscalYearForDate } from '@/src/domain/validation';
import { HospitalLogo } from './hospital-logo';
import { useCallback,useEffect,useMemo,useState } from 'react';
import { CalendarDays,Users,ClipboardList,ChartNoAxesCombined,Bell,ShieldCheck,History,LogOut,RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { Actor } from '@/src/server/auth';
import { type Masters,type Filters } from './schedule';
import { Registry } from './registry';
import { HosxpSchedule } from './hosxp-schedule';
import { HosxpReport } from './hosxp-report';
import { Notifications } from './notifications';
import { Table,s,thaiDate,type Item,type Api } from './ui';
const nav=[{key:'schedule',title:'นัดหมายจาก HOSxP',icon:CalendarDays,permission:'appointment.read'},{key:'personnel',title:'บุคลากร',icon:Users,permission:'employee.read'},{key:'reports',title:'รายงาน',icon:ChartNoAxesCombined,permission:'report.read'},{key:'notifications',title:'แจ้งเตือน',icon:Bell,permission:'notification.manage'},{key:'users',title:'บัญชีผู้ใช้',icon:ShieldCheck,permission:'user.manage'},{key:'audit',title:'ประวัติการใช้งาน',icon:History,permission:'audit.read'}];
type Loaded={masters:Masters;employees:Item[];report?:Report;users:Item[];jobs:Item[];settings?:Item;audit:Item[]};
const empty:Loaded={masters:{},employees:[],users:[],jobs:[],audit:[]};
export function Workspace({actor}:{actor:Actor}){
 const router=useRouter();
 const allowed=nav.filter(v=>actor.permissions.includes(v.permission));
 const [tab,setTab]=useState(allowed[0]?.key??'reports'),[yearId,setYearId]=useState(''),[filters]=useState<Filters>({}),[tick,setTick]=useState(0),[data,setData]=useState<Loaded>(empty),[busy,setBusy]=useState(true),[error,setError]=useState('');
 const api:Api=useCallback(async(path,method='GET',body)=>{const r=await fetch(`/api/v1/${path}`,{method,cache:'no-store',headers:{...(body?{'Content-Type':'application/json'}:{}),'x-csrf-token':actor.csrf},...(body?{body:JSON.stringify(body)}:{})});if(r.status===401){router.replace('/login');router.refresh();throw Error('กรุณาเข้าสู่ระบบใหม่');}const b=await r.json();if(!r.ok)throw Error(b.message+(b.fieldErrors?': '+b.fieldErrors.map((v:{field:string;message:string})=>`${v.field} ${v.message}`).join(' · '):''));return b;},[actor.csrf,router]);
 const reload=useCallback(()=>setTick(t=>t+1),[]);
 const query=useMemo(()=>new URLSearchParams({year:yearId,...Object.fromEntries(Object.entries(filters).filter(([,v])=>v))}).toString(),[yearId,filters]);
 useEffect(()=>{let alive=true;async function load(){setBusy(true);setError('');try{
  const masters=await api('masters') as Masters;
  const current=masters.years?.find(y=>Number(y.fiscal_year)===fiscalYearForDate(bangkokNow().day));
  if(current&&yearId!==s(current.id)){if(alive){setData({...empty,masters});setYearId(s(current.id));}return;}
  const can=(p:string)=>actor.permissions.includes(p);
  const [employees,report,users,jobs,settings,audit]=await Promise.all([
   ['personnel','notifications'].includes(tab)&&can('employee.read')?api('employees'):[],
   undefined,
   tab==='users'?api('users'):[],tab==='notifications'?api('notifications'):[],
   tab==='notifications'?api('notification-settings'):undefined,tab==='audit'?api('audit'):[]]);
  if(alive)setData({masters,employees:employees as Item[],report:report as Report|undefined,users:users as Item[],jobs:jobs as Item[],settings:settings as Item|undefined,audit:audit as Item[]});
 }catch(e){if(alive)setError(e instanceof Error?e.message:'เชื่อมต่อระบบไม่ได้');}finally{if(alive)setBusy(false);}}void load();return()=>{alive=false;};},[api,actor.permissions,yearId,query,tab,tick]);
 const year=data.masters.years?.find(y=>s(y.id)===yearId),canManage=actor.roles.includes('ADMIN');
 return <div className="app-shell"><a className="skip-link" href="#main">ข้ามไปเนื้อหา</a><aside className="sidebar"><div className="brand"><HospitalLogo/><div>พลับพลาชัย<small>สุขภาพบุคลากร</small></div></div><p className="nav-caption">พื้นที่ทำงาน</p><nav aria-label="เมนูหลัก">{allowed.map(v=><button key={v.key} aria-current={tab===v.key?'page':undefined} onClick={()=>{setTab(v.key);setError('');}}><v.icon size={19}/>{v.title}</button>)}</nav><div className="sidebar-footer"><div className="avatar">{actor.displayName.slice(0,1)}</div><div><strong>{actor.displayName}</strong><small>{canManage?'ผู้ดูแลระบบ':'เจ้าหน้าที่'}</small></div><button aria-label="ออกจากระบบ" onClick={async()=>{try{await api('auth/logout','POST',{});router.replace('/login');router.refresh();}catch(e){setError(e instanceof Error?e.message:'ออกจากระบบไม่ได้');}}}><LogOut size={18}/></button></div></aside><div className="main-wrap"><header className="topbar"><div><span className="eyebrow">โรงพยาบาลพลับพลาชัย</span><h1>งานตรวจสุขภาพบุคลากร</h1></div><div className="year-control"><span className="badge">ปีงบประมาณปัจจุบัน {fiscalYearForDate(bangkokNow().day)} · อัตโนมัติ</span><button aria-label="โหลดข้อมูลใหม่" className="icon-button" onClick={reload}><RefreshCw size={18}/></button></div></header><main id="main" className="content" aria-busy={busy}>
 {year&&<div className="period"><span>{thaiDate(year.start_date)} – {thaiDate(year.end_date)}</span><span>{year.status==='OPEN'?'เปิดบันทึกข้อมูล':'ปิดปีงบประมาณแล้ว'}</span></div>}
 {error&&<div role="alert" className="error">{error} <button onClick={reload}>ลองอีกครั้ง</button></div>}
 {busy&&<div className="loading" role="status">กำลังโหลดข้อมูล…</div>}
 {!error&&<>{false?<section className="surface welcome"><ClipboardList size={42}/><h2>ยังไม่มีรายงานของปีงบประมาณนี้</h2><p>ดูวันนัดปัจจุบันที่เมนู นัดหมายจาก HOSxP</p></section>:<>
 {tab==='reports'&&<HosxpReport api={api} canExport={actor.permissions.includes('export.execute')}/>}
 {tab==='schedule'&&<HosxpSchedule api={api}/>}
 {['personnel','users'].includes(tab)&&<Registry key={tab} tab={tab} masters={data.masters} employees={data.employees} api={api} reload={reload} canManage={canManage} users={data.users} csrf={actor.csrf}/>}
 {tab==='notifications'&&data.settings&&<Notifications employees={data.employees} jobs={data.jobs} settings={data.settings} api={api} reload={reload}/>}
 {tab==='audit'&&<><div className="section-head"><div><h2>ประวัติการใช้งาน</h2><p className="muted">200 เหตุการณ์ล่าสุด · เวลา UTC</p></div></div><div className="surface"><Table headers={['เวลา UTC','ผู้ดำเนินการ','การกระทำ','รายการอ้างอิง','รายละเอียด']} empty={!data.audit.length}>{data.audit.map(a=><tr key={a.id}><td>{s(a.created_at)}</td><td>{s(a.actor)||'Worker'}</td><td>{s(a.action)}</td><td>{s(a.entity_type)} #{s(a.entity_id)}</td><td className="audit-detail">{JSON.stringify(a.changes)}</td></tr>)}</Table></div></>}
 </>}</>}
 </main><footer className="page-footer">ระบบตรวจสุขภาพบุคลากร · โรงพยาบาลพลับพลาชัย <span>ข้อมูลสำหรับผู้มีสิทธิ์ใช้งานเท่านั้น</span></footer></div></div>;
}
