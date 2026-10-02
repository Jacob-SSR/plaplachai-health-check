'use client';
import { useState } from 'react';
import { Field, Table, s, type Item, type Api } from './ui';

export function HosxpPersonnel({employees,api,reload,canManage,csrf=''}:{employees:Item[];api:Api;reload:()=>void;canManage:boolean;csrf?:string}) {
  const [search,setSearch]=useState(''),[status,setStatus]=useState('Y');
  const [error,setError]=useState(''),[saving,setSaving]=useState<number|null>(null),[imported,setImported]=useState('');
  const source=employees.filter(e=>e.hosxp_doctor_code);
  const people=source.filter(e=>(status===''||Boolean(e.active)===(status==='Y'))&&`${e.hosxp_doctor_code} ${e.hosxp_doctor_name} ${s(e.hr_work_group)} ${s(e.hr_department)}`.includes(search));
  async function toggle(e:Item) {
    setSaving(e.id);setError('');
    try{await api(`employees/${e.id}/recipient`,'PATCH',{enabled:!e.notification_enabled});reload();}
    catch(err){setError(err instanceof Error?err.message:'บันทึกไม่สำเร็จ');}
    finally{setSaving(null);}
  }
  async function importHr(file:File) {
    setError('');setImported('');
    try{
      const r=await fetch('/api/v1/hr-personnel',{method:'POST',headers:{'Content-Type':'application/octet-stream','x-csrf-token':csrf},body:file});
      const b=await r.json();if(!r.ok)throw Error(b.message);
      setImported(`นำเข้าแล้ว ${b.total} คน · ${b.workGroups} กลุ่มงาน · ใช้ CID จากไฟล์กับบุคลากร ${b.matched ?? 0} คน (เปลี่ยน ${b.changed ?? 0} คน)`);reload();
    }catch(err){setError(err instanceof Error?err.message:'นำเข้าไม่สำเร็จ');}
  }
  return <><div className="section-head"><div><h2>บุคลากรจาก HOSxP</h2>
    <p className="muted">ดึงรายชื่อจาก doctor อัตโนมัติ · Y = ยังปฏิบัติงาน · N = พ้นสภาพ · กลุ่มงาน/หน่วยงานจากไฟล์ทะเบียนบุคลากร</p></div>
    {canManage&&<label className="button">นำเข้าไฟล์ทะเบียนบุคลากร (.xlsx)<input type="file" accept=".xlsx" hidden onChange={e=>{const f=e.target.files?.[0];if(f)void importHr(f);e.target.value='';}}/></label>}</div>
    {imported&&<p className="notice" role="status">{imported}</p>}
    {error&&<p className="error" role="alert">{error}</p>}
    <div className="surface"><div className="filters">
      <Field label="ค้นหาบุคลากร" placeholder="ชื่อ รหัส หรือกลุ่มงาน" value={search} onChange={e=>setSearch(e.target.value)}/>
      <label>สถานะ<select value={status} onChange={e=>setStatus(e.target.value)}><option value="Y">ยังปฏิบัติงาน</option><option value="N">ไม่ได้ปฏิบัติงาน</option><option value="">ทั้งหมด</option></select></label>
      <p>{people.length} คน</p></div>
      <Table headers={['รหัส doctor','ชื่อบุคลากร','กลุ่มงาน / หน่วยงาน','ตำแหน่ง','สถานะ','CID สำหรับจับคู่นัด','แจ้งเตือน']} empty={!people.length}>
        {people.map(e=><tr key={e.id}><td>{s(e.hosxp_doctor_code)}</td><td>{s(e.hosxp_doctor_name)}</td>
          <td>{s(e.hr_work_group)||'—'}<small>{s(e.hr_department)}</small></td><td>{s(e.hr_position)||'—'}</td>
          <td>{e.active?'ยังปฏิบัติงาน':'ไม่ได้ปฏิบัติงาน'}</td><td>{e.has_cid?(e.cid_source==='HR'?'CID จากทะเบียนบุคลากร':'CID จาก HOSxP'):'ยังไม่มี CID (นำเข้าไฟล์ทะเบียนบุคลากร)'}</td>
          <td>{canManage?<button disabled={saving!==null||!e.has_cid||!e.active} onClick={()=>void toggle(e)}>{e.notification_enabled?'เปิดรับแจ้งเตือน':'ปิดรับแจ้งเตือน'}</button>:e.notification_enabled?'เปิด':'ปิด'}</td></tr>)}
      </Table>
      {!source.length&&<p className="helper">ยังไม่ได้รับรายชื่อจาก HOSxP ให้ตรวจการเชื่อมต่อและเริ่ม worker เพื่อดึงข้อมูล</p>}
    </div></>;
}
