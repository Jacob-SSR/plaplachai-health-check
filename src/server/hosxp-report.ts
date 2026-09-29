import ExcelJS from 'exceljs';
import { z } from 'zod';
import type { Actor } from './auth';
import { readPersonnelOapp, withEmployees } from './hosxp';
import { activeHosxpStatus } from './hosxp-sync';
import { bangkokNow, date, ensure, fiscalRange, fiscalYearForDate } from '../domain/validation';
import { HOSXP_ROOMS } from '../domain/hosxp';
import { hrLookup } from './hr-personnel';

export const REPORT_STATUS = { ATTENDED: 'มาตามนัด', PENDING: 'รอตรวจ', MISSED: 'ไม่มาตามนัด' } as const;
type Status = keyof typeof REPORT_STATUS;
export function reportStatus(a: { visited: boolean; appointment_date: string }, today = bangkokNow().day): Status {
  return a.visited ? 'ATTENDED' : a.appointment_date >= today ? 'PENDING' : 'MISSED';
}

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
  const count = (list: typeof data) => ({
    appointments: list.length, people: new Set(list.map(a => a.personnel_code)).size,
    attended: list.filter(a => a.status === 'ATTENDED').length,
    pending: list.filter(a => a.status === 'PENDING').length,
    missed: list.filter(a => a.status === 'MISSED').length,
  });
  const rooms = HOSXP_ROOMS.map(room => ({ code: room.code, name: room.name, ...count(data.filter(a => a.depcode === room.code)) }));
  const hr = await hrLookup();
  const rows = data.map(a => ({ oapp_id: a.oapp_id, display_name: a.display_name,
    work_group: hr(a.personnel_code, a.display_name)?.work_group ?? '', appointment_date: a.appointment_date,
    appointment_time: a.appointment_time, room_name: a.room_name, doctor_name: a.doctor_name, location: a.location,
    fiscal_year: a.fiscal_year, status: a.status }));
  return { from, to, summary: count(data), rooms, rows };
}

export async function hosxpReportExcel(params: URLSearchParams, actor: Actor) {
  const report = await hosxpReport(params, actor), book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('นัดหมาย');
  sheet.addRow(['เลขนัด HOSxP', 'บุคลากร', 'กลุ่มงาน', 'วันที่นัด', 'เวลา', 'ปีงบประมาณ', 'ห้องบริการ', 'ผู้ให้บริการ', 'จุดติดต่อ', 'สถานะ']);
  for (const a of report.rows) sheet.addRow([a.oapp_id, a.display_name, a.work_group, a.appointment_date, a.appointment_time?.slice(0, 5) ?? '',
    a.fiscal_year, a.room_name, a.doctor_name ?? '', a.location, REPORT_STATUS[a.status]]);
  const summary = book.addWorksheet('สรุปตามห้อง');
  summary.addRow(['ห้องบริการ', 'นัดทั้งหมด', 'จำนวนคน', 'มาตามนัด', 'รอตรวจ', 'ไม่มาตามนัด']);
  for (const r of report.rooms) summary.addRow([r.name, r.appointments, r.people, r.attended, r.pending, r.missed]);
  const s = report.summary;
  summary.addRow(['รวม', s.appointments, s.people, s.attended, s.pending, s.missed]);
  for (const ws of [sheet, summary]) {
    ws.views = [{ state: 'frozen', ySplit: 1 }]; ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF18584A' } };
    ws.columns.forEach(c => c.width = 22);
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}
