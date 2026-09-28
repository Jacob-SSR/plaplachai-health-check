'use client';
import { useEffect, useState } from 'react';
import { Field, Table, s, thaiDate, type Api } from './ui';
import { bangkokNow, addDays } from '@/src/domain/validation';

type Appointment = { oapp_id: string; display_name: string; appointment_date: string;
  appointment_time: string | null; clinic: string | null; depcode: string | null; location: string; source_status_id: string | number | null };
export function HosxpSchedule({ api }: { api: Api }) {
  const [from, setFrom] = useState(() => bangkokNow().day);
  const [to, setTo] = useState(() => addDays(bangkokNow().day, 30));
  const [data, setData] = useState<Appointment[]>([]), [error, setError] = useState('');
  const [busy, setBusy] = useState(true), [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    async function load() {
      setBusy(true); setError('');
      try {
        const result = await api(`hosxp/oapp?${new URLSearchParams({ from, to })}`) as { data: Appointment[] };
        if (alive) setData(result.data);
      } catch (e) { if (alive) { setData([]); setError(e instanceof Error ? e.message : 'อ่านข้อมูล HOSxP ไม่สำเร็จ'); } }
      finally { if (alive) setBusy(false); }
    }
    void load();
    return () => { alive = false; };
  }, [api, from, to, tick]);
  return <><div className="section-head"><div><h2>นัดหมายจาก HOSxP</h2>
    <p className="muted">สร้าง เลื่อน และยกเลิกนัดใน HOSxP ข้อมูลวันนัดในหน้านี้อ่านจาก HOSxP</p></div>
    <button disabled={busy} onClick={() => setTick(t => t + 1)}>โหลดวันนัดล่าสุด</button></div>
    <div className="surface"><div className="filters">
      <Field label="ตั้งแต่วันที่นัด" type="date" value={from} onChange={e => setFrom(e.target.value)}/>
      <Field label="ถึงวันที่นัด" type="date" value={to} onChange={e => setTo(e.target.value)}/>
    </div>{error && <p className="error" role="alert">{error}</p>}
    {busy ? <p role="status">กำลังอ่านวันนัดจาก HOSxP…</p> : !error && <>
      <p className="helper">{data.length} นัด · เฉพาะบุคลากรที่จับคู่ CID กับทะเบียนเดิมได้</p>
      <Table headers={['บุคลากร', 'วัน–เวลานัด', 'คลินิก / แผนก', 'สถานที่', 'เลขนัด / รหัสสถานะ HOSxP']} empty={!data.length}>
        {data.map(a => <tr key={a.oapp_id}><td>{a.display_name}</td><td>{thaiDate(a.appointment_date)}
          <small>{a.appointment_time ? `${a.appointment_time.slice(0, 5)} น.` : 'ไม่ระบุเวลา'}</small></td>
          <td>{s(a.clinic) || '—'} / {s(a.depcode) || '—'}</td><td>{a.location || '—'}</td><td>{a.oapp_id}<small>สถานะต้นทาง: {s(a.source_status_id)||'ไม่ระบุ'}</small></td></tr>)}
      </Table></>}</div></>;
}
