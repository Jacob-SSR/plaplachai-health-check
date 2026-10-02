import ExcelJS from 'exceljs';
import { z } from 'zod';
import type { Actor } from './auth';
import { readPersonnelOapp, visitCharges, withEmployees } from './hosxp';
import { activeHosxpStatus } from './hosxp-sync';
import { bangkokNow, date, ensure, fiscalRange, fiscalYearForDate } from '../domain/validation';
import { HOSXP_ROOMS } from '../domain/hosxp';
import { hrLookup } from './hr-personnel';

import { APPOINTMENT_STATUS, appointmentStatus } from '../domain/appointment-status';
export const REPORT_STATUS = APPOINTMENT_STATUS;
export const reportStatus = (a: { visited: boolean; appointment_date: string }, today = bangkokNow().day) => appointmentStatus(a, today);

// Report straight from HOSxP oapp. Default period is the current fiscal year (1 Oct - 30 Sep).
export async function hosxpReport(params: URLSearchParams, actor: Actor) {
  const year = fiscalRange(fiscalYearForDate(bangkokNow().day));
  const from = date.parse(params.get('from') || year.start), to = date.parse(params.get('to') || year.end);
  const status = params.get('status') ? z.enum(['ATTENDED', 'PENDING', 'MISSED']).parse(params.get('status')) : undefined;
  const q = z.string().trim().max(100).parse(params.get('q') ?? '').replace(/\s+/g, '');
  ensure(from <= to, 'วันที่เริ่มต้องไม่หลังวันที่สิ้นสุด');
  const source = (await readPersonnelOapp({ from, to }, { room: params.get('room') || undefined }))
    .filter(a => activeHosxpStatus(a.source_status_id));
  const today = bangkokNow().day;
  const data = (await withEmployees(source, actor))
    .map(a => ({ ...a, status: reportStatus(a, today) }))
    .filter(a => (!status || a.status === status) && (!q || a.display_name.replace(/\s+/g, '').includes(q)));
  // Money per visit (procedures billed in HOSxP) for every appointment the person came to.
  const charges = await visitCharges(data.filter(a => a.status === 'ATTENDED').map(a => a.visit_vn));
  const charged = data.map(a => ({ ...a, charge: a.visit_vn ? charges.get(a.visit_vn) : undefined }));
  const count = (list: typeof charged) => ({
    appointments: list.length, people: new Set(list.map(a => a.personnel_code)).size,
    attended: list.filter(a => a.status === 'ATTENDED').length,
    pending: list.filter(a => a.status === 'PENDING').length,
    missed: list.filter(a => a.status === 'MISSED').length,
    // One visit can serve several appointments on the same day: count its money once.
    amount: [...new Map(list.filter(a => a.charge).map(a => [a.visit_vn, a.charge!.amount])).values()].reduce((t, v) => Math.round((t + v) * 100) / 100, 0),
  });
  const rooms = HOSXP_ROOMS.map(room => ({ code: room.code, name: room.name, ...count(charged.filter(a => a.depcode === room.code)) }));
  const byProcedure = new Map<string, { name: string; visits: number; qty: number; amount: number }>();
  for (const charge of new Map(charged.filter(a => a.charge).map(a => [a.visit_vn, a.charge!])).values())
    for (const p of charge.procedures) {
      const total = byProcedure.get(p.name) ?? byProcedure.set(p.name, { name: p.name, visits: 0, qty: 0, amount: 0 }).get(p.name)!;
      total.visits++; total.qty += p.qty; total.amount = Math.round((total.amount + p.amount) * 100) / 100;
    }
  const procedures = [...byProcedure.values()].sort((a, b) => b.amount - a.amount);
  // Money per principal diagnosis (first ICD-10 of the visit), each visit counted once.
  const byIcd10 = new Map<string, { code: string; name: string; visits: number; amount: number }>();
  for (const charge of new Map(charged.filter(a => a.charge).map(a => [a.visit_vn, a.charge!])).values()) {
    const main = charge.icd10[0]; if (!main) continue;
    const total = byIcd10.get(main.code) ?? byIcd10.set(main.code, { ...main, visits: 0, amount: 0 }).get(main.code)!;
    total.visits++; total.amount = Math.round((total.amount + charge.amount) * 100) / 100;
  }
  const icd10 = [...byIcd10.values()].sort((a, b) => b.amount - a.amount || b.visits - a.visits);
  const hr = await hrLookup();
  const rows = charged.map(a => ({ oapp_id: a.oapp_id, display_name: a.display_name,
    work_group: hr(a.personnel_code, a.display_name)?.work_group ?? '', appointment_date: a.appointment_date,
    appointment_time: a.appointment_time, room_name: a.room_name, doctor_name: a.doctor_name, location: a.location,
    fiscal_year: a.fiscal_year, status: a.status,
    amount: a.charge?.amount ?? null, procedures: a.charge?.procedures ?? [], icd10: a.charge?.icd10 ?? [] }));
  return { from, to, summary: count(charged), rooms, procedures, icd10, rows };
}

export async function hosxpReportExcel(params: URLSearchParams, actor: Actor) {
  const report = await hosxpReport(params, actor), book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('นัดหมาย');
  sheet.addRow(['เลขนัด HOSxP', 'บุคลากร', 'กลุ่มงาน', 'วันที่นัด', 'เวลา', 'ปีงบประมาณ', 'ห้องบริการ', 'ผู้ให้บริการ', 'จุดติดต่อ', 'สถานะ',
    'ICD-10', 'หัตถการ', 'ค่าบริการ (บาท)']);
  for (const a of report.rows) sheet.addRow([a.oapp_id, a.display_name, a.work_group, a.appointment_date, a.appointment_time?.slice(0, 5) ?? '',
    a.fiscal_year, a.room_name, a.doctor_name ?? '', a.location, REPORT_STATUS[a.status],
    a.icd10.map(c => c.name ? `${c.code} ${c.name}` : c.code).join('\n'),
    a.procedures.map(p => `${p.name} x${p.qty} = ${p.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`).join('\n'), a.amount ?? '']);
  const summary = book.addWorksheet('สรุปตามห้อง');
  summary.addRow(['ห้องบริการ', 'นัดทั้งหมด', 'จำนวนคน', 'มาตามนัด', 'รอตรวจ', 'ไม่มาตามนัด', 'ค่าบริการ (บาท)']);
  for (const r of report.rooms) summary.addRow([r.name, r.appointments, r.people, r.attended, r.pending, r.missed, r.amount]);
  const s = report.summary;
  summary.addRow(['รวม', s.appointments, s.people, s.attended, s.pending, s.missed, s.amount]);
  const byProcedure = book.addWorksheet('สรุปตามหัตถการ');
  byProcedure.addRow(['หัตถการ', 'จำนวนครั้งที่มารับบริการ', 'จำนวน', 'ค่าบริการ (บาท)']);
  for (const p of report.procedures) byProcedure.addRow([p.name, p.visits, p.qty, p.amount]);
  byProcedure.addRow(['รวม', '', '', s.amount]);
  const byIcd10 = book.addWorksheet('สรุปตาม ICD-10');
  byIcd10.addRow(['ICD-10', 'ชื่อโรค', 'จำนวนครั้งที่มารับบริการ', 'ค่าบริการ (บาท)']);
  for (const c of report.icd10) byIcd10.addRow([c.code, c.name, c.visits, c.amount]);
  for (const ws of [sheet, summary, byProcedure, byIcd10]) {
    ws.views = [{ state: 'frozen', ySplit: 1 }]; ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF18584A' } };
    ws.columns.forEach(c => c.width = 22);
  }
  sheet.getColumn(11).width = sheet.getColumn(12).width = 45;
  for (const col of [11, 12]) sheet.getColumn(col).alignment = { wrapText: true, vertical: 'top' };
  for (const [ws, col] of [[sheet, 13], [summary, 7], [byProcedure, 4], [byIcd10, 4]] as const) ws.getColumn(col).numFmt = '#,##0.00';
  return Buffer.from(await book.xlsx.writeBuffer());
}
