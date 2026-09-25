'use client';
import { HospitalLogo } from '@/components/hospital-logo';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
export default function Login(){
 const router=useRouter();
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 return <main className="login"><section className="login-story"><div className="brand"><HospitalLogo/><div>โรงพยาบาลพลับพลาชัย<small>PLUBPHLACHAI HOSPITAL</small></div></div><div><p className="eyebrow">สุขภาพบุคลากร</p><h1>ดูแลสุขภาพคนทำงาน<br/>ให้ครบทุกนัดหมาย</h1><p>วางแผนการตรวจ ติดตามการเข้ารับบริการ<br/>และดูภาพรวมสุขภาพบุคลากรในแต่ละปีงบประมาณ</p></div><small>ระบบงานภายใน · งานอาชีวอนามัย</small></section><section className="login-form"><form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');const f=new FormData(e.currentTarget);try{const r=await fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:f.get('username'),password:f.get('password')})});const b=await r.json();if(!r.ok)throw Error(b.message??'เข้าสู่ระบบไม่ได้');const me=await (await fetch('/api/v1/me')).json();router.replace(me.roles?.includes('ADMIN')?'/admin':'/');router.refresh();}catch(e){setError(e instanceof Error?e.message:'เชื่อมต่อไม่ได้');setBusy(false);}}}><Link href="/">← กลับไปปฏิทิน</Link><p className="eyebrow">ยินดีต้อนรับ</p><h2>เข้าสู่ระบบเจ้าหน้าที่</h2><p className="muted">ใช้บัญชีที่ผู้ดูแลระบบจัดเตรียมให้</p><label>ชื่อผู้ใช้<input name="username" autoComplete="username" required autoFocus/></label><label>รหัสผ่าน<input name="password" type="password" autoComplete="current-password" required/></label>{error&&<p role="alert" className="error">{error}</p>}<button className="primary" disabled={busy}>{busy?'กำลังเข้าสู่ระบบ…':'เข้าสู่ระบบ'}<ArrowRight size={18}/></button><p className="helper">หากยังไม่มีบัญชีหรือลืมรหัสผ่าน<br/>กรุณาติดต่อผู้ดูแลระบบของโรงพยาบาล</p></form></section></main>;
}
