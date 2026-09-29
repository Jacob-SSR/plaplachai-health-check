'use client';
import { useState } from 'react';
import { HOSXP_ROOMS } from '../src/domain/hosxp';
import { Field, Table, s, type Item, type Api } from './ui';

export function HosxpRooms() {
  return <><div className="section-head"><div><h2>ห้องบริการจาก HOSxP</h2>
    <p className="muted">ใช้รหัสห้องจาก kskdepartment ที่กำหนดไว้ พร้อมใช้งานทั้ง 4 ห้อง</p></div></div>
    <div className="surface"><Table headers={['รหัสห้อง (depcode)','ห้องบริการ']}>
      {HOSXP_ROOMS.map(room=><tr key={room.code}><td>{room.code}</td><td>{room.name}</td></tr>)}
    </Table></div><p className="helper">ปีงบประมาณคำนวณจากวันนัดใน oapp อัตโนมัติ เช่น 1 ตุลาคม 2569 เป็นปีงบประมาณ 2570</p></>;
}

export function HosxpPersonnel({employees,api,reload,canManage}:{employees:Item[];api:Api;reload:()=>void;canManage:boolean}) {
  const [search,setSearch]=useState(''),[status,setStatus]=useState('Y');
  const [error,setError]=useState(''),[saving,setSaving]=useState<number|null>(null);
  const source=employees.filter(e=>e.hosxp_doctor_code);
  const people=source.filter(e=>(status===''||Boolean(e.active)===(status==='Y'))&&`${e.hosxp_doctor_code} ${e.hosxp_doctor_name}`.includes(search));
  async function toggle(e:Item) {
    setSaving(e.id);setError('');
    try{await api(`employees/${e.id}/recipient`,'PATCH',{enabled:!e.notification_enabled});reload();}
    catch(err){setError(err instanceof Error?err.message:'บันทึกไม่สำเร็จ');}
    finally{setSaving(null);}
  }
  return <><div className="section-head"><div><h2>บุคลากรจาก HOSxP</h2>
    <p className="muted">ดึงรายชื่อจาก doctor อัตโนมัติ · Y = ยังปฏิบัติงาน · N = พ้นสภาพ</p></div></div>
    {error&&<p className="error" role="alert">{error}</p>}
    <div className="surface"><div className="filters">
      <Field label="ค้นหาบุคลากร" placeholder="ชื่อหรือรหัสใน HOSxP" value={search} onChange={e=>setSearch(e.target.value)}/>
      <label>สถานะ<select value={status} onChange={e=>setStatus(e.target.value)}><option value="Y">ยังปฏิบัติงาน</option><option value="N">ไม่ได้ปฏิบัติงาน</option><option value="">ทั้งหมด</option></select></label>
      <p>{people.length} คน</p></div>
      <Table headers={['รหัส doctor','ชื่อบุคลากร','สถานะ','CID สำหรับจับคู่นัด','แจ้งเตือน']} empty={!people.length}>
        {people.map(e=><tr key={e.id}><td>{s(e.hosxp_doctor_code)}</td><td>{s(e.hosxp_doctor_name)}</td>
          <td>{e.active?'ยังปฏิบัติงาน':'ไม่ได้ปฏิบัติงาน'}</td><td>{e.has_cid?'พร้อมจับคู่':'ต้องตรวจ CID ใน HOSxP'}</td>
          <td>{canManage?<button disabled={saving!==null||!e.has_cid||!e.active} onClick={()=>void toggle(e)}>{e.notification_enabled?'เปิดรับแจ้งเตือน':'ปิดรับแจ้งเตือน'}</button>:e.notification_enabled?'เปิด':'ปิด'}</td></tr>)}
      </Table>
      {!source.length&&<p className="helper">ยังไม่ได้รับรายชื่อจาก HOSxP ให้ตรวจการเชื่อมต่อและเริ่ม worker เพื่อดึงข้อมูล</p>}
    </div></>;
}
