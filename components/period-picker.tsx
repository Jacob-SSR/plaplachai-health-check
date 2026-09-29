'use client';
import { Field } from './ui';
import { bangkokNow, fiscalRange, fiscalYearForDate } from '@/src/domain/validation';

// Fiscal year (1 Oct - 30 Sep) by default; "กำหนดเอง" shows the two date fields.
export const currentFiscalYear = () => fiscalYearForDate(bangkokNow().day);
export function fiscalPeriod(year: number) { const r = fiscalRange(year); return { from: r.start, to: r.end }; }
export function PeriodPicker({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const now = currentFiscalYear(), years = [now - 1, now, now + 1];
  const selected = years.find(y => { const p = fiscalPeriod(y); return p.from === from && p.to === to; });
  const custom = selected === undefined;
  return <>
    <label>ช่วงวันนัด<select aria-label="ช่วงวันนัด" value={custom ? 'custom' : String(selected)} onChange={e => {
      if (e.target.value === 'custom') onChange(from, from); else { const p = fiscalPeriod(Number(e.target.value)); onChange(p.from, p.to); }
    }}>{years.map(y => <option key={y} value={y}>ปีงบประมาณ {y}{y === now ? ' (ปัจจุบัน)' : ''}</option>)}<option value="custom">กำหนดเอง</option></select></label>
    {custom && <><Field label="ตั้งแต่วันที่นัด" type="date" value={from} onChange={e => onChange(e.target.value, to)}/>
      <Field label="ถึงวันที่นัด" type="date" value={to} onChange={e => onChange(from, e.target.value)}/></>}
  </>;
}
