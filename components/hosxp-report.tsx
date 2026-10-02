'use client';
import { useEffect, useState } from 'react';
import { Download, Printer, Search } from 'lucide-react';
import { thaiDate, type Api } from './ui';
import { bangkokNow, fiscalRange, fiscalYearForDate } from '@/src/domain/validation';
import { HOSXP_ROOMS } from '@/src/domain/hosxp';
import { baht, monthRange, pct, Pager, RankTable, ReportSkeleton, StatusBar, SummaryStrip } from './report-kit';

const STATUS: Record<string, string> = { ATTENDED: 'มาตามนัด', PENDING: 'รอตรวจ', MISSED: 'ไม่มาตามนัด' };
type Count = { appointments: number; people: number; attended: number; pending: number; missed: number; amount: number };
type Procedure = { name: string; qty: number; amount: number };
type Row = { oapp_id: string; display_name: string; work_group: string; appointment_date: string; appointment_time: string | null;
  room_name: string; doctor_name: string | null; location: string; fiscal_year: number; status: string;
  amount: number | null; procedures: Procedure[]; icd10: { code: string; name: string }[] };
type Report = { summary: Count; rooms: (Count & { code: string; name: string })[]; procedures: (Procedure & { visits: number })[];
  icd10: { code: string; name: string; visits: number; amount: number }[]; rows: Row[] };

export function HosxpReport({ api, canExport }: { api: Api; canExport: boolean }) {
  const today = bangkokNow().day, fy = fiscalYearForDate(today);
  const fyRange = (y: number) => { const r = fiscalRange(y); return { from: r.start, to: r.end }; };
  const presets: [string, { from: string; to: string }][] = [['ปีงบนี้', fyRange(fy)], ['ปีงบที่แล้ว', fyRange(fy - 1)], ['เดือนนี้', monthRange(today, 0)], ['เดือนที่แล้ว', monthRange(today, -1)]];
  const [{ from, to }, setPeriod] = useState(fyRange(fy)), [custom, setCustom] = useState(false);
  const [room, setRoom] = useState(''), [status, setStatus] = useState(''), [qInput, setQInput] = useState(''), [q, setQ] = useState('');
  const [report, setReport] = useState<Report>(), [error, setError] = useState(''), [busy, setBusy] = useState(true);
  const [page, setPage] = useState(1), [size, setSize] = useState(50);
  // Search waits for typing to pause, so each keystroke does not read HOSxP again.
  useEffect(() => { const t = setTimeout(() => { setQ(qInput.trim()); setPage(1); }, 400); return () => clearTimeout(t); }, [qInput]);
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
  const choose = (p: { from: string; to: string }) => { setPeriod(p); setCustom(false); setPage(1); };
  const active = presets.find(([, p]) => !custom && p.from === from && p.to === to)?.[0];
  const s = report?.summary, rows = report?.rows ?? [];
  const pages = Math.max(1, Math.ceil(rows.length / size)), current = Math.min(page, pages);
  return <div className="rk">
    <div className="section-head"><div><h2>รายงานการตรวจสุขภาพ</h2>
      <p className="muted">นัดจาก HOSxP ช่วง {thaiDate(from)} – {thaiDate(to)}</p></div>
      <div className="actions"><button onClick={() => window.print()}><Printer size={17}/>พิมพ์</button>
        {canExport && <a className="button primary" href={`/api/v1/exports/appointments?${query}`}><Download size={17}/>ดาวน์โหลด Excel</a>}</div></div>

    <div className="surface rk-filters">
      <div className="rk-seg" role="group" aria-label="ช่วงวันนัด">
        {presets.map(([label, p]) => <button key={label} aria-pressed={active === label} onClick={() => choose(p)}>{label}</button>)}
        <button aria-pressed={custom || !active} onClick={() => setCustom(true)}>กำหนดเอง</button></div>
      {(custom || !active) && <><label>ตั้งแต่<input type="date" value={from} onChange={e => { setPeriod({ from: e.target.value, to }); setPage(1); }}/></label>
        <label>ถึง<input type="date" value={to} onChange={e => { setPeriod({ from, to: e.target.value }); setPage(1); }}/></label></>}
      <label>ห้องบริการ<select value={room} onChange={e => { setRoom(e.target.value); setPage(1); }}><option value="">ทุกห้องบริการ</option>{HOSXP_ROOMS.map(r => <option key={r.code} value={r.code}>{r.name}</option>)}</select></label>
      <label className="rk-search">ค้นหาบุคลากร<span><Search size={17}/><input placeholder="ชื่อ–นามสกุล" value={qInput} onChange={e => setQInput(e.target.value)}/></span></label>
    </div>

    {error && <p className="error" role="alert">{error}</p>}
    {!report && busy && <ReportSkeleton/>}
    {report && s && !error && <div aria-busy={busy} className={busy ? 'rk-busy' : undefined}>
      <SummaryStrip stats={[
        { label: 'นัดหมาย', value: s.appointments.toLocaleString(), note: `${s.people.toLocaleString()} คน` },
        { label: 'มาตามนัด', value: s.attended.toLocaleString(), note: `${pct(s.attended, s.appointments)}% ของนัด` },
        { label: 'ไม่มาตามนัด', value: s.missed.toLocaleString(), note: `${pct(s.missed, s.appointments)}% ของนัด` },
        { label: 'รอตรวจ', value: s.pending.toLocaleString(), note: 'ยังไม่ถึงวันนัด' },
        { label: 'ค่าบริการ (บาท)', value: baht(s.amount), note: 'หัตถการที่เรียกเก็บ ไม่รวมยา', tone: 'money' }]}/>

      <section className="surface rk-block"><h3>แยกตามห้องบริการ</h3>
        <div className="table-scroll"><table className="rk-table"><thead><tr><th>ห้องบริการ</th><th>การมาตามนัด</th><th className="num">นัด</th><th className="num">คน</th><th className="num">บาท</th></tr></thead>
          <tbody>{report.rooms.map(r => <tr key={r.code}><td>{r.name}</td><td><StatusBar c={r}/></td><td className="num">{r.appointments.toLocaleString()}</td>
            <td className="num">{r.people.toLocaleString()}</td><td className="num">{baht(r.amount)}</td></tr>)}</tbody>
          <tfoot><tr><td>รวม</td><td><StatusBar c={s}/></td><td className="num">{s.appointments.toLocaleString()}</td><td className="num">{s.people.toLocaleString()}</td><td className="num">{baht(s.amount)}</td></tr></tfoot></table></div>
      </section>

      <div className="rk-two">
        <section className="surface rk-block"><h3>หัตถการที่เรียกเก็บ</h3>
          <RankTable head="หัตถการ" items={report.procedures} empty="ยังไม่มีค่าบริการในช่วงนี้" label={p => <>{p.name} <span className="muted">×{p.qty.toLocaleString()}</span></>}/></section>
        <section className="surface rk-block"><h3>ICD-10 โรคหลัก</h3>
          <RankTable head="รหัส / ชื่อโรค" items={report.icd10} empty="ยังไม่มีรหัส ICD-10 ในช่วงนี้" label={c => <><b>{c.code}</b> {c.name}</>}/></section>
      </div>

      <section className="surface rk-block"><div className="rk-head"><h3>รายการนัด</h3>
        <div className="rk-seg small" role="group" aria-label="สถานะ">
          {[['', 'ทั้งหมด'], ...Object.entries(STATUS)].map(([k, v]) => <button key={k} aria-pressed={status === k} onClick={() => { setStatus(k); setPage(1); }}>{v}</button>)}</div></div>
        <div className="table-scroll"><table className="rk-table"><thead><tr><th>บุคลากร</th><th>วันนัด</th><th>ห้องบริการ</th><th>สถานะ</th><th>ICD-10 / หัตถการ</th><th className="num">บาท</th></tr></thead>
          <tbody>{!rows.length ? <tr><td colSpan={6} className="empty">ไม่มีนัดตามเงื่อนไขนี้</td></tr> : rows.slice((current - 1) * size, current * size).map(a => <tr key={a.oapp_id}>
            <td>{a.display_name}<small>{a.work_group || '—'}</small></td>
            <td>{thaiDate(a.appointment_date)}<small>{a.appointment_time ? `${a.appointment_time.slice(0, 5)} น.` : 'ไม่ระบุเวลา'}</small></td>
            <td>{a.room_name}{a.doctor_name && <small>{a.doctor_name}</small>}</td>
            <td><span className={`badge status-${a.status.toLowerCase()}`}>{STATUS[a.status]}</span></td>
            <td>{a.icd10.length || a.procedures.length ? <>{a.icd10.map(c => <small key={c.code}><b>{c.code}</b> {c.name}</small>)}
              {a.procedures.map(p => <small key={p.name}>{p.name} ×{p.qty} · {baht(p.amount)}</small>)}</> : <span className="muted">—</span>}</td>
            <td className="num">{a.amount == null ? <span className="muted">—</span> : baht(a.amount)}</td></tr>)}</tbody></table></div>
        {rows.length > 0 && <Pager page={current} size={size} total={rows.length} onPage={setPage} onSize={n => { setSize(n); setPage(1); }}/>}
      </section>
    </div>}
  </div>;
}
