'use client';
import { useEffect, useState } from 'react';
import { CalendarCheck, CalendarClock, CalendarX, Download, Printer, Search, Users, Wallet } from 'lucide-react';
import { thaiDate, type Api } from './ui';
import { bangkokNow, fiscalRange, fiscalYearForDate } from '@/src/domain/validation';
import { HOSXP_ROOMS } from '@/src/domain/hosxp';

const STATUS: Record<string, string> = { ATTENDED: 'มาตามนัด', PENDING: 'รอตรวจ', MISSED: 'ไม่มาตามนัด' };
type Count = { appointments: number; people: number; attended: number; pending: number; missed: number; amount: number };
type Procedure = { name: string; qty: number; amount: number };
type Row = { oapp_id: string; display_name: string; work_group: string; appointment_date: string; appointment_time: string | null;
  room_name: string; doctor_name: string | null; location: string; fiscal_year: number; status: string;
  amount: number | null; procedures: Procedure[]; icd10: { code: string; name: string }[] };
type Report = { summary: Count; rooms: (Count & { code: string; name: string })[]; procedures: (Procedure & { visits: number })[];
  icd10: { code: string; name: string; visits: number; amount: number }[]; rows: Row[] };
const baht = (v: number) => v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (part: number, whole: number) => whole ? Math.round(part / whole * 100) : 0;
// First and last day of the month `offset` months from `day`.
function monthRange(day: string, offset: number) {
  const d = new Date(`${day.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + offset);
  const from = d.toISOString().slice(0, 10); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0);
  return { from, to: d.toISOString().slice(0, 10) };
}
const PAGE = 50;

// Attended / missed / pending as one stacked bar, with the counts as text beside it.
export function StatusBar({ c }: { c: { appointments: number; attended: number; missed: number; pending: number } }) {
  return <div className="rp-status"><div className="rp-stack" role="img" aria-label={`มาตามนัด ${c.attended} ไม่มาตามนัด ${c.missed} รอ ${c.pending}`}>
    <i className="ok" style={{ width: `${pct(c.attended, c.appointments)}%` }}/><i className="miss" style={{ width: `${pct(c.missed, c.appointments)}%` }}/>
    <i className="wait" style={{ width: `${pct(c.pending, c.appointments)}%` }}/></div>
    <small>มา {c.attended} · ไม่มา {c.missed} · รอ {c.pending}</small></div>;
}
// Top entries by money, each with a bar against the largest; "ดูทั้งหมด" shows the rest.
export function TopList<T extends { amount: number; visits: number }>({ title, note, items, label, empty }:
  { title: string; note: string; items: T[]; label: (t: T) => React.ReactNode; empty: string }) {
  const [all, setAll] = useState(false), max = Math.max(1, ...items.map(i => i.amount)), shown = all ? items : items.slice(0, 8);
  return <section className="surface padded rp-top"><div className="rp-section-title"><h3>{title}</h3><p className="muted">{note}</p></div>
    {!items.length ? <p className="rp-empty">{empty}</p> : <ol>{shown.map((t, i) => <li key={i}>
      <div className="rp-top-row"><span className="rp-top-label">{label(t)}</span><strong>{baht(t.amount)}</strong></div>
      <div className="rp-meter"><i style={{ width: `${Math.max(2, t.amount / max * 100)}%` }}/></div><small>{t.visits.toLocaleString()} ครั้ง</small></li>)}</ol>}
    {items.length > 8 && <button className="link-button" onClick={() => setAll(v => !v)}>{all ? 'ย่อ' : `ดูทั้งหมด (${items.length})`}</button>}
  </section>;
}

export function HosxpReport({ api, canExport }: { api: Api; canExport: boolean }) {
  const today = bangkokNow().day, fy = fiscalYearForDate(today);
  const fyRange = (y: number) => { const r = fiscalRange(y); return { from: r.start, to: r.end }; };
  const presets: [string, { from: string; to: string }][] = [['ปีงบนี้', fyRange(fy)], ['ปีงบที่แล้ว', fyRange(fy - 1)], ['เดือนนี้', monthRange(today, 0)], ['เดือนที่แล้ว', monthRange(today, -1)]];
  const [{ from, to }, setPeriod] = useState(fyRange(fy)), [custom, setCustom] = useState(false);
  const [room, setRoom] = useState(''), [status, setStatus] = useState(''), [qInput, setQInput] = useState(''), [q, setQ] = useState('');
  const [report, setReport] = useState<Report>(), [error, setError] = useState(''), [busy, setBusy] = useState(true), [shown, setShown] = useState(PAGE);
  // Search waits for typing to pause, so each keystroke does not read HOSxP again.
  useEffect(() => { const t = setTimeout(() => { setQ(qInput.trim()); setShown(PAGE); }, 400); return () => clearTimeout(t); }, [qInput]);
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
  const choose = (p: { from: string; to: string }) => { setPeriod(p); setCustom(false); setShown(PAGE); };
  const active = presets.find(([, p]) => !custom && p.from === from && p.to === to)?.[0];
  const s = report?.summary, visits = s ? s.attended : 0;
  return <div className="rp">
    <div className="section-head"><div><h2>รายงานการตรวจสุขภาพ</h2>
      <p className="muted">นัดจาก HOSxP · {thaiDate(from)} – {thaiDate(to)} · ค่าบริการจากหัตถการที่เรียกเก็บในแต่ละครั้งที่มา</p></div>
      <div className="actions"><button onClick={() => window.print()}><Printer size={18}/>พิมพ์</button>
        {canExport && <a className="button primary rp-excel" href={`/api/v1/exports/appointments?${query}`}><Download size={18}/>ดาวน์โหลด Excel</a>}</div></div>

    <div className="surface filters rp-filters">
      <div className="rp-chips" role="group" aria-label="ช่วงวันนัด">
        {presets.map(([label, p]) => <button key={label} aria-pressed={active === label} onClick={() => choose(p)}>{label}</button>)}
        <button aria-pressed={custom || !active} onClick={() => setCustom(true)}>กำหนดเอง</button></div>
      {(custom || !active) && <div className="rp-dates"><label>ตั้งแต่<input type="date" value={from} onChange={e => setPeriod({ from: e.target.value, to })}/></label>
        <label>ถึง<input type="date" value={to} onChange={e => setPeriod({ from, to: e.target.value })}/></label></div>}
      <div className="rp-fields">
        <label className="rp-search"><Search size={18}/><input aria-label="ค้นหาบุคลากร" placeholder="ค้นหาชื่อบุคลากร" value={qInput} onChange={e => setQInput(e.target.value)}/></label>
        <label>ห้องบริการ<select aria-label="ห้องบริการ" value={room} onChange={e => setRoom(e.target.value)}><option value="">ทุกห้องบริการ</option>{HOSXP_ROOMS.map(r => <option key={r.code} value={r.code}>{r.name}</option>)}</select></label>
      </div>
    </div>

    {error && <p className="error" role="alert">{error}</p>}
    {busy && !report && <p role="status" className="rp-loading">กำลังอ่านข้อมูลจาก HOSxP…</p>}
    {report && s && !error && <div aria-busy={busy} className={busy ? 'rp-dim' : ''}>
      <div className="rp-kpis">
        <div className="rp-kpi"><Users size={22}/><span>นัดหมายทั้งหมด</span><strong>{s.appointments.toLocaleString()}</strong><small>{s.people.toLocaleString()} คน</small></div>
        <div className="rp-kpi ok"><CalendarCheck size={22}/><span>มาตามนัด</span><strong>{s.attended.toLocaleString()}</strong>
          <small>{pct(s.attended, s.appointments)}% ของนัดทั้งหมด</small><div className="rp-meter"><i style={{ width: `${pct(s.attended, s.appointments)}%` }}/></div></div>
        <div className="rp-kpi miss"><CalendarX size={22}/><span>ไม่มาตามนัด</span><strong>{s.missed.toLocaleString()}</strong><small>{pct(s.missed, s.appointments)}% · เลยวันนัดแล้ว</small></div>
        <div className="rp-kpi wait"><CalendarClock size={22}/><span>รอตรวจ</span><strong>{s.pending.toLocaleString()}</strong><small>ยังไม่ถึงวันนัด</small></div>
        <div className="rp-kpi money"><Wallet size={22}/><span>ค่าบริการรวม</span><strong>{baht(s.amount)}</strong><small>บาท · เฉลี่ย {baht(visits ? s.amount / visits : 0)} ต่อครั้ง</small></div>
      </div>

      <section className="surface padded"><div className="rp-section-title"><h3>แยกตามห้องบริการ</h3></div>
        <div className="table-scroll"><table className="rp-table"><thead><tr><th>ห้องบริการ</th><th>การมาตามนัด</th><th className="num">นัด</th><th className="num">คน</th><th className="num">ค่าบริการ (บาท)</th></tr></thead>
          <tbody>{report.rooms.map(r => <tr key={r.code}><td><strong>{r.name}</strong></td><td><StatusBar c={r}/></td>
            <td className="num">{r.appointments.toLocaleString()}</td><td className="num">{r.people.toLocaleString()}</td><td className="num"><strong>{baht(r.amount)}</strong></td></tr>)}
            <tr className="rp-total"><td>รวม</td><td><StatusBar c={s}/></td><td className="num">{s.appointments.toLocaleString()}</td><td className="num">{s.people.toLocaleString()}</td><td className="num">{baht(s.amount)}</td></tr></tbody></table></div>
      </section>

      <div className="rp-two">
        <TopList title="แยกตามหัตถการ" note="รายการที่เรียกเก็บใน HOSxP (ไม่รวมยา)" items={report.procedures} empty="ยังไม่มีค่าบริการในช่วงนี้"
          label={p => <>{p.name}<small> ×{p.qty.toLocaleString()}</small></>}/>
        <TopList title="แยกตาม ICD-10 (โรคหลัก)" note="ค่าบริการของแต่ละครั้งนับเข้าโรคหลัก" items={report.icd10} empty="ยังไม่มีรหัส ICD-10 ในช่วงนี้"
          label={c => <><b>{c.code}</b> {c.name}</>}/>
      </div>

      <section className="surface padded"><div className="rp-section-title"><h3>รายการนัด</h3><p className="muted">{report.rows.length.toLocaleString()} รายการ</p></div>
        <div className="rp-chips small" role="group" aria-label="สถานะ">
          {[['', 'ทั้งหมด'], ...Object.entries(STATUS)].map(([k, v]) => <button key={k} aria-pressed={status === k} onClick={() => { setStatus(k); setShown(PAGE); }}>{v}</button>)}</div>
        <div className="table-scroll"><table className="rp-table"><thead><tr><th>บุคลากร / กลุ่มงาน</th><th>วัน–เวลานัด</th><th>ห้องบริการ</th><th>สถานะ</th><th>ICD-10 / หัตถการ</th><th className="num">ค่าบริการ (บาท)</th></tr></thead>
          <tbody>{!report.rows.length ? <tr><td colSpan={6} className="empty">ไม่มีนัดตามเงื่อนไขนี้</td></tr> : report.rows.slice(0, shown).map(a => <tr key={a.oapp_id}>
            <td><strong>{a.display_name}</strong><small>{a.work_group || '—'}</small></td>
            <td>{thaiDate(a.appointment_date)}<small>{a.appointment_time ? `${a.appointment_time.slice(0, 5)} น.` : 'ไม่ระบุเวลา'}</small></td>
            <td>{a.room_name}<small>{a.doctor_name || ''}</small></td>
            <td><span className={`badge status-${a.status.toLowerCase()}`}>{STATUS[a.status]}</span></td>
            <td>{a.icd10.length || a.procedures.length ? <>{a.icd10.map(c => <small key={c.code}><b>{c.code}</b> {c.name}</small>)}
              {a.procedures.map(p => <small key={p.name}>{p.name} ×{p.qty} · {baht(p.amount)}</small>)}</> : '—'}</td>
            <td className="num">{a.amount == null ? '—' : <strong>{baht(a.amount)}</strong>}</td></tr>)}</tbody></table></div>
        {report.rows.length > shown && <div className="rp-more"><span className="muted">แสดง {shown.toLocaleString()} จาก {report.rows.length.toLocaleString()}</span>
          <button onClick={() => setShown(v => v + PAGE)}>แสดงเพิ่ม</button></div>}
      </section>
    </div>}
  </div>;
}
