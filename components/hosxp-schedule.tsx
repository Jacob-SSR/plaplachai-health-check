'use client';
import { useEffect, useState } from 'react';
import { Field, Table, s, thaiDate, type Api } from './ui';
import { bangkokNow, addDays } from '@/src/domain/validation';
import { HOSXP_ROOMS } from '@/src/domain/hosxp';

type Appointment = { oapp_id: string; display_name: string; appointment_date: string;
  appointment_time: string | null; clinic: string | null; depcode: string | null; location: string; source_status_id: string | number | null;
  room_name:string;doctor_code:string|null;doctor_name:string|null;fiscal_year:number };
const SENT: Record<string, string> = { ACCEPTED: 'ส่งแล้ว · MOPH รับคำขอ', DRY_RUN: 'โหมดทดสอบ · ไม่ได้ส่งจริง', BLOCKED: 'ยังส่งไม่ได้', FAILED: 'ส่งไม่ผ่าน', UNKNOWN: 'ยังยืนยันผลไม่ได้', CANCELLED: 'ยกเลิก' };
export function HosxpSchedule({ api, canNotify = false }: { api: Api; canNotify?: boolean }) {
  const [from, setFrom] = useState(() => bangkokNow().day);
  const [to, setTo] = useState(() => addDays(bangkokNow().day, 30));
  const [room,setRoom]=useState(''),[personnel,setPersonnel]=useState('');
  const [people,setPeople]=useState<{code:string;name:string}[]>([]),[optionsError,setOptionsError]=useState('');
  const [data, setData] = useState<Appointment[]>([]), [error, setError] = useState('');
  const [busy, setBusy] = useState(true), [tick, setTick] = useState(0);
  const [sending, setSending] = useState(''), [sent, setSent] = useState<Record<string, string>>({});
  async function notify(a: Appointment) {
    if (!window.confirm(`ส่งแจ้งเตือนนัดให้ ${a.display_name} ตอนนี้?`)) return;
    setSending(a.oapp_id);
    try { const r = await api('notifications/manual', 'POST', { oappId: a.oapp_id }) as { status: string; safe_error: string | null };
      setSent(v => ({ ...v, [a.oapp_id]: `${SENT[r.status] ?? r.status}${r.safe_error ? ` · ${r.safe_error}` : ''}` })); }
    catch (e) { setSent(v => ({ ...v, [a.oapp_id]: e instanceof Error ? e.message : 'ส่งไม่สำเร็จ' })); }
    finally { setSending(''); }
  }
  useEffect(()=>{let alive=true;api('hosxp/options').then(result=>{if(alive){setPeople((result as {personnel:{code:string;name:string}[]}).personnel);setOptionsError('');}}).catch(()=>{if(alive)setOptionsError('ยังโหลดรายชื่อบุคลากรไม่ได้');});return()=>{alive=false;};},[api,tick]);
  useEffect(() => {
    let alive = true;
    async function load() {
      setBusy(true); setError('');
      try {
        const result = await api(`hosxp/oapp?${new URLSearchParams({ from, to,room,personnel })}`) as { data: Appointment[] };
        if (alive) setData(result.data);
      } catch (e) { if (alive) { setData([]); setError(e instanceof Error ? e.message : 'อ่านข้อมูล HOSxP ไม่สำเร็จ'); } }
      finally { if (alive) setBusy(false); }
    }
    void load();
    return () => { alive = false; };
  }, [api, from, to,room,personnel, tick]);
  return <><div className="section-head"><div><h2>นัดหมายจาก HOSxP</h2>
    <p className="muted">สร้าง เลื่อน และยกเลิกนัดใน HOSxP ข้อมูลวันนัดในหน้านี้อ่านจาก HOSxP</p></div>
    <button disabled={busy} onClick={() => setTick(t => t + 1)}>โหลดวันนัดล่าสุด</button></div>
    <div className="surface"><div className="filters">
      <Field label="ตั้งแต่วันที่นัด" type="date" value={from} onChange={e => setFrom(e.target.value)}/>
      <Field label="ถึงวันที่นัด" type="date" value={to} onChange={e => setTo(e.target.value)}/>
      <label>ห้องบริการ<select aria-label="ห้องบริการ" value={room} onChange={e=>setRoom(e.target.value)}><option value="">ทุกห้องบริการ</option>{HOSXP_ROOMS.map(r=><option key={r.code} value={r.code}>{r.name}</option>)}</select></label>
      <label>บุคลากรที่มีนัด<select aria-label="บุคลากรที่มีนัด" value={personnel} onChange={e=>setPersonnel(e.target.value)}><option value="">บุคลากรทั้งหมด</option>{people.map(d=><option key={d.code} value={d.code}>{d.name}</option>)}</select></label>
    </div>{error && <p className="error" role="alert">{error}</p>}
    {optionsError&&<p className="helper" role="status">{optionsError}</p>}
    {busy ? <p role="status">กำลังอ่านวันนัดจาก HOSxP…</p> : !error && <>
      <p className="helper">{data.length} นัด · บุคลากรจาก doctor ที่ยังปฏิบัติงาน (active=Y) จับคู่วันนัดด้วยชื่อหรือ CID</p>
      <Table headers={['บุคลากร', 'วัน–เวลานัด / ปีงบประมาณ', 'ห้องบริการ / ผู้ให้บริการ', 'จุดติดต่อ (ไปก่อน)', 'เลขนัด / รหัสสถานะ HOSxP', ...(canNotify ? ['แจ้งเตือน'] : [])]} empty={!data.length}>
        {data.map(a => <tr key={a.oapp_id}><td>{a.display_name}</td><td>{thaiDate(a.appointment_date)}
          <small>{a.appointment_time ? `${a.appointment_time.slice(0, 5)} น.` : 'ไม่ระบุเวลา'} · ปีงบประมาณ {a.fiscal_year}</small></td>
          <td>{a.room_name}<small>{a.doctor_name||a.doctor_code||'ไม่ระบุผู้ให้บริการ'}</small></td><td>{a.location || '—'}</td><td>{a.oapp_id}<small>สถานะต้นทาง: {s(a.source_status_id)||'ไม่ระบุ'}</small></td>
          {canNotify && <td><button disabled={!!sending} onClick={() => void notify(a)}>{sending === a.oapp_id ? 'กำลังส่ง…' : 'ส่งแจ้งเตือน'}</button>{sent[a.oapp_id] && <small role="status">{sent[a.oapp_id]}</small>}</td>}</tr>)}
      </Table></>}</div></>;
}
