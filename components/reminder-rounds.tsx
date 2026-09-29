'use client';
import { useState } from 'react';
import { n, type Item } from './ui';

// Up to 3 reminders before the appointment. Each round has an on/off switch and its own day count.
const DEFAULTS = [7, 3, 1];
export function ReminderRounds({ rules }: { rules: Item[] }) {
  const active = rules.filter(r => r.active).map(r => n(r.days_before)).sort((a, b) => b - a).slice(0, 3);
  const [rounds, setRounds] = useState(() => DEFAULTS.map((d, i) => ({ on: i < active.length, days: active[i] ?? (active.length ? d : i === 0 ? 2 : d) })));
  const update = (i: number, patch: Partial<{ on: boolean; days: number }>) => setRounds(v => v.map((r, j) => j === i ? { ...r, ...patch } : r));
  return <fieldset className="reminder-rounds span-all"><legend>แจ้งเตือนก่อนวันนัด</legend>
    <p className="helper">แจ้งทันทีเมื่อลงนัด/เลื่อนนัดเสมอ และแจ้งซ้ำก่อนวันนัดได้สูงสุด 3 ครั้ง ปิดครั้งที่ไม่ต้องการได้</p>
    {rounds.map((r, i) => <div key={i} className={`reminder-round ${r.on ? 'on' : ''}`}>
      <button type="button" role="switch" aria-checked={r.on} className="switch" onClick={() => update(i, { on: !r.on })}><span/></button>
      <strong>ครั้งที่ {i + 1}</strong>
      <label>ก่อนวันนัด<input type="number" min={0} max={30} value={r.days} disabled={!r.on} onChange={e => update(i, { days: Number(e.target.value) })} aria-label={`ครั้งที่ ${i + 1} ก่อนวันนัดกี่วัน`}/>วัน</label>
      <small>{!r.on ? 'ปิด' : r.days === 0 ? 'แจ้งในวันนัด' : r.days === 1 ? 'แจ้งวันก่อนนัด' : `แจ้งก่อน ${r.days} วัน`}</small>
      {r.on && <input type="hidden" name="days" value={r.days}/>}
    </div>)}
  </fieldset>;
}
