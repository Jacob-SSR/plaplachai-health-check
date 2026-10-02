'use client';
// Building blocks of the report page: summary strip, status bar, ranked table, pager and loading skeleton.
// Kept plain on purpose: the app's own table and border styles, colour only where it carries meaning.
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const baht = (v: number) => v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pct = (part: number, whole: number) => whole ? Math.round(part / whole * 100) : 0;
// First and last day of the month `offset` months from `day`.
export function monthRange(day: string, offset: number) {
  const d = new Date(`${day.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + offset);
  const from = d.toISOString().slice(0, 10); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0);
  return { from, to: d.toISOString().slice(0, 10) };
}

export type Stat = { label: string; value: string; note?: string; tone?: 'money' };
export function SummaryStrip({ stats }: { stats: Stat[] }) {
  return <dl className="rk-summary" style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}>
    {stats.map(s => <div key={s.label} className={s.tone === 'money' ? 'money' : undefined}><dt>{s.label}</dt><dd>{s.value}</dd>{s.note && <p>{s.note}</p>}</div>)}
  </dl>;
}

type Counts = { appointments: number; attended: number; missed: number; pending: number };
// Came / missed / pending as one thin bar; the numbers are in the text beside it.
export function StatusBar({ c }: { c: Counts }) {
  return <div className="rk-status"><span className="rk-stack" aria-hidden>
    <i className="ok" style={{ width: `${pct(c.attended, c.appointments)}%` }}/><i className="miss" style={{ width: `${pct(c.missed, c.appointments)}%` }}/>
    <i className="wait" style={{ width: `${pct(c.pending, c.appointments)}%` }}/></span>
    <span className="rk-status-text">มา {c.attended} · ไม่มา {c.missed} · รอ {c.pending}</span></div>;
}

// Ranked by money, with a share bar against the first row.
export function RankTable<T extends { amount: number; visits: number }>({ head, items, label, empty, limit = 10 }:
  { head: string; items: T[]; label: (t: T) => React.ReactNode; empty: string; limit?: number }) {
  const max = Math.max(1, ...items.map(i => i.amount));
  return <table className="rk-table rk-rank"><thead><tr><th className="rank">#</th><th>{head}</th><th className="num">ครั้ง</th><th className="num">บาท</th></tr></thead>
    <tbody>{!items.length ? <tr><td colSpan={4} className="empty">{empty}</td></tr> : items.slice(0, limit).map((t, i) => <tr key={i}>
      <td className="rank">{i + 1}</td><td>{label(t)}<span className="rk-share" aria-hidden><i style={{ width: `${Math.max(1, t.amount / max * 100)}%` }}/></span></td>
      <td className="num">{t.visits.toLocaleString()}</td><td className="num">{baht(t.amount)}</td></tr>)}</tbody>
    {items.length > limit && <tfoot><tr><td colSpan={4}>และอีก {items.length - limit} รายการในไฟล์ Excel</td></tr></tfoot>}</table>;
}

// Page numbers with the first, last and two around the current page; "…" for the gaps.
export function pageList(page: number, pages: number) {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter(p => p >= 1 && p <= pages));
  const list: (number | '…')[] = [];
  for (const p of [...keep].sort((a, b) => a - b)) { if (list.length && p - (list[list.length - 1] as number) > 1) list.push('…'); list.push(p); }
  return list;
}
export function Pager({ page, size, total, onPage, onSize }: { page: number; size: number; total: number; onPage: (p: number) => void; onSize: (s: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size)), first = total ? (page - 1) * size + 1 : 0, last = Math.min(total, page * size);
  return <nav className="rk-pager" aria-label="เปลี่ยนหน้า">
    <span className="rk-range">แสดง {first.toLocaleString()}–{last.toLocaleString()} จาก {total.toLocaleString()} รายการ</span>
    <span className="rk-pages">
      <button onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="หน้าก่อน"><ChevronLeft size={18}/>ก่อนหน้า</button>
      {pageList(page, pages).map((p, i) => p === '…' ? <span key={`gap${i}`} className="rk-gap">…</span>
        : <button key={p} aria-current={p === page ? 'page' : undefined} onClick={() => onPage(p)}>{p}</button>)}
      <button onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="หน้าถัดไป">ถัดไป<ChevronRight size={18}/></button>
    </span>
    <label className="rk-size">แถวต่อหน้า<select value={size} onChange={e => onSize(Number(e.target.value))}>{[25, 50, 100].map(n => <option key={n}>{n}</option>)}</select></label>
  </nav>;
}

// Same shape as the loaded page, so nothing jumps when the data arrives.
export function ReportSkeleton({ stats = 5, rows = 6 }: { stats?: number; rows?: number }) {
  return <div className="rk-skeleton" role="status" aria-label="กำลังอ่านข้อมูลจาก HOSxP">
    <div className="rk-summary" style={{ gridTemplateColumns: `repeat(${stats}, minmax(0, 1fr))` }}>{Array.from({ length: stats }, (_, i) => <div key={i}><b className="sk w40"/><b className="sk h28 w70"/><b className="sk w55"/></div>)}</div>
    <section className="rk-block"><b className="sk h20 w25"/>{Array.from({ length: 4 }, (_, i) => <div key={i} className="sk-row"><b className="sk w20"/><b className="sk w45"/><b className="sk w10"/></div>)}</section>
    <section className="rk-block"><b className="sk h20 w25"/>{Array.from({ length: rows }, (_, i) => <div key={i} className="sk-row"><b className="sk w25"/><b className="sk w15"/><b className="sk w30"/><b className="sk w10"/></div>)}</section>
  </div>;
}
