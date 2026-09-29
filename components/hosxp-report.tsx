'use client';
import { useEffect, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { Field, Table, thaiDate, type Api } from './ui';
import { bangkokNow, fiscalRange, fiscalYearForDate } from '@/src/domain/validation';
import { HOSXP_ROOMS } from '@/src/domain/hosxp';

const STATUS: Record<string, string> = { ATTENDED: 'มาตามนัด', PENDING: 'รอตรวจ', MISSED: 'ไม่มาตามนัด' };
type Count = { appointments: number; people: number; attended: number; pending: number; missed: number };
type Row = { oapp_id: string; display_name: string; appointment_date: string; appointment_time: string | null;
  room_name: string; doctor_name: string | null; location: string; fiscal_year: number; status: string };
type Report = { summary: Count; rooms: (Count & { code: string; name: string })[]; rows: Row[] };

export function HosxpReport({ api, canExport }: { api: Api; canExport: boolean }) {
  const year = fiscalYearForDate(bangkokNow().day), range = fiscalRange(year);
  const [from, setFrom] = useState(range.start), [to, setTo] = useState(range.end);
  const [room, setRoom] = useState(''), [status, setStatus] = useState(''), [q, setQ] = useState('');
  const [report, setReport] = useState<Report>(), [error, setError] = useState(''), [busy, setBusy] = useState(true);
  const query = new URLSearchParams(Object.entries({ from, to, room, status, q }).filter(([, v]) => v)).toString();
  useEffect(() => {
    let alive = true;
    async function load() {
      setBusy(true); setError('');
      try { const r = await api(`reports?${query}`); if (alive) setReport(r as Report); }
      catch (e) { if (alive) { setReport(undefined); setError(e instanceof Error ? e.message : 'อ่านข้อมูล HOSxP ไม่สำเร็จ'); } }
      finally { if (alive) setBusy(false); }
    }
    void load();
    return () => { alive = false; };
  }, [api, query]);
  const s = report?.summary;
  return <><div className="section-head"><div><h2>รายงานการตรวจสุขภาพ</h2>
    <p className="muted">อ่านนัดจาก HOSxP · ค่าเริ่มต้นปีงบประมาณ {year} · สถานะดูจากการมาตามนัดใน HOSxP (visit_vn)</p></div>
    <div className="actions"><button onClick={() => window.print()}><Printer size={16}/>พิมพ์ / PDF</button>
      {canExport && <a className="button" href={`/api/v1/exports/appointments?${query}`}><Download size={16}/>ข้อมูลนัด Excel</a>}</div></div>
    <div className="surface"><div className="filters">
      <Field label="ค้นหาบุคลากร" placeholder="ชื่อ–นามสกุล" value={q} onChange={e => setQ(e.target.value)}/>
      <Field label="ตั้งแต่วันที่" type="date" value={from} onChange={e => setFrom(e.target.value)}/>
      <Field label="ถึงวันที่" type="date" value={to} onChange={e => setTo(e.target.value)}/>
      <label>ห้องบริการ<select aria-label="ห้องบริการ" value={room} onChange={e => setRoom(e.target.value)}><option value="">ทุกห้องบริการ</option>{HOSXP_ROOMS.map(r => <option key={r.code} value={r.code}>{r.name}</option>)}</select></label>
      <label>สถานะ<select aria-label="สถานะ" value={status} onChange={e => setStatus(e.target.value)}><option value="">ทุกสถานะ</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    </div></div>
    {error && <p className="error" role="alert">{error}</p>}
    {busy && <p role="status" className="muted">กำลังอ่านข้อมูลจาก HOSxP…</p>}
    {report && !error && <>
      <div className="metrics">
        <div><span>นัดหมายทั้งหมด</span><strong>{s!.appointments.toLocaleString()}<small>นัด</small></strong><p>{s!.people.toLocaleString()} คน</p></div>
        <div><span>มาตามนัด</span><strong>{s!.attended.toLocaleString()}<small>นัด</small></strong><p>{s!.appointments ? Math.round(s!.attended / s!.appointments * 100) : 0}% ของนัดทั้งหมด</p></div>
        <div><span>รอตรวจ</span><strong>{s!.pending.toLocaleString()}<small>นัด</small></strong><p>ยังไม่ถึงวันนัด</p></div>
        <div><span>ไม่มาตามนัด</span><strong>{s!.missed.toLocaleString()}<small>นัด</small></strong><p>เลยวันนัดแล้วยังไม่มา</p></div>
      </div>
      <section className="surface padded"><div className="section-head"><h3>แยกตามห้องบริการ</h3></div>
        <Table headers={['ห้องบริการ', 'นัดทั้งหมด', 'จำนวนคน', 'มาตามนัด', 'รอตรวจ', 'ไม่มาตามนัด']}>
          {report.rooms.map(r => <tr key={r.code}><td>{r.name}</td><td>{r.appointments}</td><td>{r.people}</td><td>{r.attended}</td><td>{r.pending}</td><td>{r.missed}</td></tr>)}
        </Table></section>
      <section className="surface padded"><div className="section-head"><h3>รายการนัด</h3><p className="muted">{thaiDate(report ? from : '')} – {thaiDate(to)}</p></div>
        <Table headers={['บุคลากร', 'วัน–เวลานัด', 'ห้องบริการ / ผู้ให้บริการ', 'จุดติดต่อ', 'สถานะ']} empty={!report.rows.length}>
          {report.rows.map(a => <tr key={a.oapp_id}><td>{a.display_name}</td>
            <td>{thaiDate(a.appointment_date)}<small>{a.appointment_time ? `${a.appointment_time.slice(0, 5)} น.` : 'ไม่ระบุเวลา'} · ปีงบประมาณ {a.fiscal_year}</small></td>
            <td>{a.room_name}<small>{a.doctor_name || 'ไม่ระบุผู้ให้บริการ'}</small></td><td>{a.location || '—'}</td>
            <td><span className="badge">{STATUS[a.status]}</span></td></tr>)}
        </Table></section>
    </>}</>;
}
