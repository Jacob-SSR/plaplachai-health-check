import mysql, { type RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { rows } from './db';
import { scopeSql, type Actor } from './auth';
import { addDays, bangkokNow, date, ensure, fiscalYearForDate } from '../domain/validation';
import { HOSXP_ROOMS,hosxpRoom,roomForAppointment,LAB_ROOM } from '../domain/hosxp';
import { syncDoctorPersonnel, type DoctorPerson } from './hosxp-personnel';

const globalHosxp = globalThis as unknown as { hosxpPool?: mysql.Pool };
function hosxpPool() {
  ensure(process.env.HOSXP_DB_HOST && process.env.HOSXP_DB_NAME && process.env.HOSXP_DB_USER,
    'ยังไม่ได้ตั้งค่าการอ่านฐานข้อมูล HOSxP', 503, 'HOSXP_NOT_CONFIGURED');
  if (globalHosxp.hosxpPool) return globalHosxp.hosxpPool;
  globalHosxp.hosxpPool = mysql.createPool({
    host: process.env.HOSXP_DB_HOST,
    port: z.coerce.number().int().min(1).max(65535).parse(process.env.HOSXP_DB_PORT ?? '3306'),
    database: process.env.HOSXP_DB_NAME, user: process.env.HOSXP_DB_USER,
    password: process.env.HOSXP_DB_PASSWORD,
    charset: process.env.HOSXP_DB_CHARSET || 'tis620',
    dateStrings: true, supportBigNumbers: true, bigNumberStrings: true,
    connectionLimit: 2, queueLimit: 20, connectTimeout: 10000, multipleStatements: false,
  });
  return globalHosxp.hosxpPool;
}

type SourceRow = {
  oapp_id: string | number; personnel_code: string; personnel_name: string;
  nextdate: string; nexttime: string | null; clinic: string | null;
  depcode: string | null; contact_point: string | null;
  oapp_status_id: string | number | null; update_datetime: string | null;
  doctor: string | null; doctor_name: string | null; department_name: string | null; visit_vn?: string | null; clinic_name?: string | null; has_lab?: number | string | null;
};
export type OappReader = (sql: string, values: string[]) => Promise<SourceRow[]>;
const sourceReader: OappReader = async (sql, values) => {
  const [result] = await hosxpPool().execute<RowDataPacket[]>({ sql, values, timeout: 15000 });
  return result as SourceRow[];
};

export function oappRange(params: URLSearchParams, today = bangkokNow().day) {
  const from = date.parse(params.get('from') ?? today);
  const to = date.parse(params.get('to') ?? addDays(from, 30));
  ensure(from <= to && to <= addDays(from, 366), 'ช่วงวันที่นัดต้องไม่เกิน 366 วัน');
  return { from, to };
}

// HOSxP keeps the ticked boxes of the appointment screen as lines of text in the oapp row:
// note2 / lab_list_text = LAB items (e.g. FBS, U/A, EKG), note1 / perform_text = preparation instructions.
const lines = (...values: unknown[]) => [...new Set(values.flatMap(v => typeof v === 'string' ? v.split(/\r?\n/) : [])
  .map(s => s.trim()).filter(Boolean))];
export const tickedLabs = (row: Record<string, unknown>) => lines(row.note2, row.lab_list_text);
export const preparationNotes = (row: Record<string, unknown>) => lines(row.note1, row.perform_text).filter(s => !/^อื่น\s*ๆ?$/.test(s));

export type OappFilters = { room?: string; doctor?: string; personnel?: string; oappId?: string };
// Read only. An appointment belongs to personnel when the patient is an active doctor row,
// matched by name (patient fname+lname = doctor.name, spaces ignored) or by a non-empty CID.
// One person with several doctor codes is reported once per appointment.
export async function readPersonnelOapp(range: { from: string; to: string }, filters: OappFilters = {}, read: OappReader = sourceReader) {
  oappRange(new URLSearchParams(range));
  if (filters.room) ensure(hosxpRoom(filters.room), 'เลือกได้เฉพาะกายภาพ LAB ทันตกรรม และแผนไทย');
  for (const value of [filters.doctor, filters.personnel, filters.oappId]) if (value) z.string().trim().min(1).max(40).parse(value);
  const roomCodes = filters.room ? [filters.room] : HOSXP_ROOMS.map(room => room.code);
  // LAB is ordered from any clinic (e.g. NCD): an appointment with a LAB order counts as a LAB appointment.
  const withLab = roomCodes.includes(LAB_ROOM);
  // Every staff appointment in the range is read and sorted into rooms here: the room can come from
  // depcode, the clinic name (appointments without depcode) or a LAB order from any clinic.
  const rows = await read(`SELECT o.*,o.oapp_id,s.code personnel_code,s.name personnel_name,o.nextdate,o.nexttime,
    o.clinic,o.depcode,o.contact_point,o.oapp_status_id,o.update_datetime,o.visit_vn,o.doctor,d.name doctor_name,k.department department_name,c.name clinic_name,
    EXISTS(SELECT 1 FROM lab_app_head lh WHERE lh.oapp_id=o.oapp_id) has_lab
    FROM oapp o JOIN patient p ON p.hn=o.hn
    JOIN doctor s ON s.active='Y' AND (REPLACE(s.name,' ','')=REPLACE(CONCAT(TRIM(p.fname),TRIM(p.lname)),' ','')
      OR (TRIM(s.cid)<>'' AND s.cid=p.cid))
    LEFT JOIN doctor d ON d.code=o.doctor LEFT JOIN kskdepartment k ON k.depcode=o.depcode
    LEFT JOIN clinic c ON c.clinic=o.clinic
    WHERE o.nextdate BETWEEN ? AND ?
    ${filters.doctor ? 'AND o.doctor=?' : ''} ${filters.personnel ? 'AND s.code=?' : ''} ${filters.oappId ? 'AND o.oapp_id=?' : ''}
    ORDER BY o.nextdate,o.nexttime,o.oapp_id,s.code LIMIT 3001`,
    [range.from, range.to, ...[filters.doctor, filters.personnel, filters.oappId].filter((v): v is string => !!v)]);
  ensure(rows.length <= 3000, 'ข้อมูลนัดมีจำนวนมาก กรุณาเลือกช่วงวันที่สั้นลง', 422);
  const seen = new Set<string>(), result = [];
  for (const row of rows) {
    const own = roomForAppointment(row.depcode, row.clinic_name), oappId = String(row.oapp_id), ticked = withLab ? tickedLabs(row as unknown as Record<string, unknown>) : [];
    const hasLab = Number(row.has_lab) === 1 || ticked.length > 0;
    const room = own && roomCodes.includes(own.code) ? own : hasLab && withLab ? hosxpRoom(LAB_ROOM)! : undefined;
    if (!room || seen.has(oappId)) continue;
    seen.add(oappId);
    // Explicit projection: no CID, HN, notes, diagnosis or other patient data in the response.
    result.push({
      source: 'HOSXP' as const, oapp_id: oappId,
      personnel_code: String(row.personnel_code), display_name: String(row.personnel_name ?? ''),
      appointment_date: row.nextdate, appointment_time: row.nexttime,
      clinic: row.clinic, clinic_name: row.clinic_name ?? null, depcode: room.code, location: row.contact_point ?? '',
      room_name: room.name, department_name: row.department_name ?? room.name,
      doctor_code: row.doctor, doctor_name: row.doctor_name,
      fiscal_year: fiscalYearForDate(row.nextdate),
      source_status_id: row.oapp_status_id, source_updated_at: row.update_datetime,
      // HOSxP links the visit to the appointment when the person came (visit_vn).
      visited: String(row.visit_vn ?? '').trim() !== '',
      has_lab: hasLab, lab_ticked: ticked,
      // Preparation instructions ticked in HOSxP (fixed hospital wording, no clinical notes).
      prep_notes: preparationNotes(row as unknown as Record<string, unknown>),
    });
  }
  ensure(result.length <= 1000, 'ข้อมูลนัดมีจำนวนมาก กรุณาเลือกช่วงวันที่สั้นลง', 422);
  return result;
}

// Adds the web employee id (synced from doctor) and applies department scope for non-admins.
export async function withEmployees<T extends { personnel_code: string }>(data: T[], actor?: Actor, departmentId?: number) {
  const scope = actor && !actor.roles.includes('ADMIN') ? scopeSql(actor, 'assignment.department_id') : null;
  const today = bangkokNow().day;
  const limit = [scope ? `EXISTS (SELECT 1 FROM employee_assignments assignment WHERE assignment.employee_id=e.id
      AND assignment.valid_from<=? AND (assignment.valid_to IS NULL OR assignment.valid_to>?) AND ${scope.sql})` : '',
    departmentId ? `EXISTS (SELECT 1 FROM employee_assignments m WHERE m.employee_id=e.id AND m.department_id=?
      AND m.valid_from<=? AND (m.valid_to IS NULL OR m.valid_to>?))` : ''].filter(Boolean);
  const employees = await rows<{ id: number; code: string }>(`SELECT e.id,e.hosxp_doctor_code code FROM employees e
    WHERE e.hosxp_doctor_code IS NOT NULL ${limit.map(v => 'AND ' + v).join(' ')}`,
    [...(scope ? [today, today, ...scope.params] : []), ...(departmentId ? [departmentId, today, today] : [])]);
  const byCode = new Map(employees.map(e => [String(e.code), Number(e.id)]));
  return data.flatMap(row => byCode.has(row.personnel_code) ? [{ ...row, employee_id: byCode.get(row.personnel_code)! }] : []);
}

// LAB items ordered with each appointment (LAB order form), as HOSxP shows them on the appointment screen:
// service names (lab_app_order_service) and ordered items (lab_app_order -> lab_items).
// Missing tables or a read error never block the page or the notice; the items are just left out.
const LAB_ITEM_QUERIES = [
  (marks: string) => `SELECT DISTINCT h.oapp_id,s.lab_name name FROM lab_app_head h JOIN lab_app_order_service s ON s.lab_app_order_number=h.lab_app_order_number
    WHERE h.oapp_id IN (${marks})`,
  (marks: string) => `SELECT DISTINCT h.oapp_id,i.lab_items_name name FROM lab_app_head h JOIN lab_app_order o ON o.lab_app_order_number=h.lab_app_order_number
    JOIN lab_items i ON i.lab_items_code=o.lab_items_code WHERE h.oapp_id IN (${marks})`,
];
export async function hosxpLabTests(oappIds: string[]) {
  const map = new Map<string, string[]>();
  const ids = [...new Set(oappIds.map(String))].filter(id => /^\d{1,20}$/.test(id));
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200), marks = batch.map(() => '?').join(',');
    for (const query of LAB_ITEM_QUERIES) {
      try {
        const [found] = await hosxpPool().execute<RowDataPacket[]>({ timeout: 15000, values: batch, sql: query(marks) });
        for (const row of found) {
          const name = String(row.name ?? '').trim(); if (!name) continue;
          const key = String(row.oapp_id), list = map.get(key) ?? [];
          if (!list.includes(name)) list.push(name); map.set(key, list);
        }
      } catch (error) { console.error({ code: 'HOSXP_LAB_ITEMS', message: error instanceof Error ? error.message.slice(0, 200) : '' }); }
    }
  }
  return map;
}
// Everything known about one appointment for its notice: LAB items (ticked + order form) and preparation.
export async function appointmentExtras(oappId: string, day: string) {
  const [a] = await withLabTests(await readPersonnelOapp({ from: day, to: day }, { oappId }));
  return { tests: a?.lab_tests ?? (await hosxpLabTests([oappId])).get(oappId) ?? [], preparation: a?.prep_notes ?? [] };
}
export async function withLabTests<T extends { oapp_id: string; has_lab?: boolean; lab_ticked?: string[] }>(data: T[]) {
  const lab = data.filter(a => a.has_lab);
  const tests = lab.length ? await hosxpLabTests(lab.map(a => a.oapp_id)) : new Map<string, string[]>();
  return data.map(a => ({ ...a, lab_tests: [...new Set([...(a.lab_ticked ?? []), ...(tests.get(a.oapp_id) ?? [])])] }));
}

// Whether appointments still exist in HOSxP and their status, to tell a real cancellation (row deleted or
// status changed) from an appointment that only left the personnel match. A read error throws, so no
// cancellation notice is ever sent on uncertain data.
export async function oappSourceState(oappIds: string[]) {
  const map = new Map<string, { status: unknown }>();
  const ids = [...new Set(oappIds.map(String))].filter(id => /^\d{1,20}$/.test(id));
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const [found] = await hosxpPool().execute<RowDataPacket[]>({ timeout: 15000, values: batch,
      sql: `SELECT oapp_id,oapp_status_id FROM oapp WHERE oapp_id IN (${batch.map(() => '?').join(',')})` });
    for (const row of found) map.set(String(row.oapp_id), { status: row.oapp_status_id });
  }
  return map;
}

export async function getOapp(params: URLSearchParams, actor?: Actor) {
  const range = oappRange(params);
  const source = await readPersonnelOapp(range, { room: params.get('room') || undefined,
    doctor: params.get('doctor') || undefined, personnel: params.get('personnel') || undefined });
  const data = await withEmployees(source, actor);
  return { source: 'HOSXP', ...range, data, total: data.length };
}
export async function getOappWithLab(params: URLSearchParams, actor?: Actor) {
  const result = await getOapp(params, actor);
  return { ...result, data: await withLabTests(result.data) };
}

export async function syncHosxpPersonnel() {
  const [people] = await hosxpPool().execute<RowDataPacket[]>({
    sql:'SELECT code,name,cid,active FROM doctor ORDER BY code', timeout:15000,
  });
  return syncDoctorPersonnel(people as DoctorPerson[]);
}

export async function hosxpOptions(actor: Actor) {
  const scope = scopeSql(actor, 'assignment.department_id');
  const people = await rows<{code:string;name:string}>(`SELECT e.hosxp_doctor_code code,e.hosxp_doctor_name name
    FROM employees e WHERE e.hosxp_doctor_code IS NOT NULL AND e.active=1
    ${actor.roles.includes('ADMIN') ? '' : `AND EXISTS (SELECT 1 FROM employee_assignments assignment
      WHERE assignment.employee_id=e.id AND assignment.valid_to IS NULL AND ${scope.sql})`}
    ORDER BY e.hosxp_doctor_name`, actor.roles.includes('ADMIN') ? [] : scope.params);
  return {rooms:HOSXP_ROOMS,personnel:people};
}

export async function closeHosxpPool() {
  const active = globalHosxp.hosxpPool;
  globalHosxp.hosxpPool = undefined;
  if (active) await active.end();
}
