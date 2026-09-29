'use client';
import { useState } from 'react';
import { HosxpPersonnel } from './hosxp-registry';
import { Plus } from 'lucide-react';
import { Field,Checks,Table,FormPanel,s,ids,type Item,type Api } from './ui';
import type { Masters } from './schedule';
export function Registry({tab,masters,employees,api,reload,canManage,users}:{tab:string;masters:Masters;employees:Item[];api:Api;reload:()=>void;canManage:boolean;users:Item[]}){
 const [form,setForm]=useState<string>(),[item,setItem]=useState<Item>();
 const open=(name:string,value?:Item)=>{setItem(value);setForm(name);};
 const close=()=>{setForm(undefined);setItem(undefined);};
 const save=async(path:string,method:string,body:unknown)=>{await api(path,method,body);reload();};
 if(tab==='personnel')return <HosxpPersonnel employees={employees} api={api} reload={reload} canManage={canManage}/>;
 return <><div className="section-head"><div><h2>บัญชีผู้ใช้งาน</h2><p className="muted">บัญชีสำหรับเข้าใช้งานเว็บนี้</p></div>{canManage&&<button className="primary" onClick={()=>open('user')}><Plus size={18}/>เพิ่มบัญชี</button>}</div>
 {form==='user'&&<FormPanel title="เพิ่มบัญชีผู้ใช้" onClose={close} onSubmit={f=>save('users','POST',{username:f.get('username'),displayName:f.get('displayName'),password:f.get('password'),role:f.get('role'),departmentIds:ids(f,'departmentIds')})}><Field label="ชื่อผู้ใช้" name="username" pattern="[A-Za-z0-9_.-]{3,100}" autoComplete="off" required/><Field label="ชื่อที่แสดง" name="displayName" required/><Field label="รหัสผ่าน (อย่างน้อย 12 ตัว)" name="password" type="password" minLength={12} autoComplete="new-password" required/><label>บทบาท<select name="role"><option value="STAFF">เจ้าหน้าที่ · ดูปฏิทิน</option><option value="VIEWER">ผู้ดูข้อมูล · ดูปฏิทินและภาพรวม</option><option value="ADMIN">ผู้ดูแลระบบ · ทุกหน่วยงาน</option></select></label><Checks label="หน่วยงานที่มีสิทธิ์ (สำหรับเจ้าหน้าที่และผู้ดูรายงาน)" name="departmentIds" options={masters.departments??[]}/></FormPanel>}
 {form==='userStatus'&&item&&<FormPanel title="สถานะบัญชี" onClose={close} onSubmit={()=>save(`users/${item.id}`,'PATCH',{active:!item.active})}><p>ยืนยัน{item.active?'ระงับ':'เปิด'}บัญชี {s(item.username)}</p></FormPanel>}
 <div className="surface"><Table headers={['ชื่อผู้ใช้','ชื่อที่แสดง','บทบาท','สถานะ','จัดการ']} empty={!users.length}>{users.map(u=><tr key={u.id}><td>{s(u.username)}</td><td>{s(u.display_name)}</td><td>{s(u.roles)}</td><td>{u.active?'ใช้งาน':'ระงับ'}</td><td><button onClick={()=>open('userStatus',u)}>{u.active?'ระงับบัญชี':'เปิดบัญชี'}</button></td></tr>)}</Table></div>
 </>;
}
