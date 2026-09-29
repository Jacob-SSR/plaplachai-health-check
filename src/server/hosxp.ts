import mysql, { type RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { rows } from './db';
import { decrypt, cidHash } from './crypto';
import { scopeSql, type Actor } from './auth';
import { addDays, bangkokNow, date, ensure, validCid, fiscalYearForDate } from '../domain/validation';
import { HOSXP_ROOMS,hosxpRoom } from '../domain/hosxp';

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
  oapp_id: string | number; recipient_cid: string;
  nextdate: string; nexttime: string | null; clinic: string | null;
  depcode: string | null; contact_point: string | null;
  oapp_status_id: string | number | null; update_datetime: string | null;
  doctor: string | null; doctor_name: string | null; department_name: string | null;
};
export type OappRecipient = { id: number; display_name: string; cid: string };
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

// Read only. Match against the existing personnel register; never import hospital patients.
// patient(hn,cid) supplies the CID because oapp itself contains only hn.
export async function readOappForRecipients(
  recipients: OappRecipient[], range: { from: string; to: string }, read: OappReader = sourceReader,
  filters: {room?:string;doctor?:string} = {},
) {
  oappRange(new URLSearchParams(range));
  if(filters.room)ensure(hosxpRoom(filters.room),'เลือกได้เฉพาะกายภาพ LAB ทันตกรรม และแผนไทย');
  if(filters.doctor)z.string().trim().min(1).max(40).parse(filters.doctor);
  const roomCodes=filters.room?[filters.room]:HOSXP_ROOMS.map(room=>room.code);
  const byCid = new Map<string, OappRecipient>();
  for (const recipient of recipients) {
    ensure(validCid(recipient.cid), 'ข้อมูล CID ในทะเบียนบุคลากรไม่ถูกต้อง', 503);
    ensure(!byCid.has(recipient.cid), 'พบ CID ซ้ำในทะเบียนบุคลากร', 503);
    byCid.set(recipient.cid, recipient);
  }
  const cids = [...byCid.keys()];
  const result = [];
  for (let offset = 0; offset < cids.length; offset += 100) {
    const batch = cids.slice(offset, offset + 100);
    const appointments = await read(`SELECT o.oapp_id,p.cid recipient_cid,o.nextdate,o.nexttime,
      o.clinic,o.depcode,o.contact_point,o.oapp_status_id,o.update_datetime,o.doctor,d.name doctor_name,k.department department_name
      FROM oapp o JOIN patient p ON p.hn=o.hn
      LEFT JOIN doctor d ON d.code=o.doctor LEFT JOIN kskdepartment k ON k.depcode=o.depcode
      WHERE p.cid IN (${batch.map(() => '?').join(',')}) AND o.nextdate BETWEEN ? AND ?
      AND o.depcode IN (${roomCodes.map(()=>'?').join(',')}) ${filters.doctor?'AND o.doctor=?':''}
      ORDER BY o.nextdate,o.nexttime,o.oapp_id LIMIT 1001`, [...batch, range.from, range.to,...roomCodes,...(filters.doctor?[filters.doctor]:[])]);
    ensure(appointments.length <= 1000, 'ข้อมูลนัดมีจำนวนมาก กรุณาเลือกช่วงวันที่สั้นลง', 422);
    for (const row of appointments) {
      const employee = byCid.get(String(row.recipient_cid).trim());
      const room=hosxpRoom(row.depcode);
      if (!employee||!room||!roomCodes.includes(room.code)||(filters.doctor&&row.doctor!==filters.doctor)) continue;
      // Explicit projection: no CID, HN, notes, diagnosis or other patient data in the response.
      result.push({
        source: 'HOSXP' as const, oapp_id: String(row.oapp_id),
        employee_id: employee.id, display_name: employee.display_name,
        appointment_date: row.nextdate, appointment_time: row.nexttime,
        clinic: row.clinic, depcode: row.depcode, location: row.contact_point ?? '',
        room_name:room.name,department_name:row.department_name??room.name,
        doctor_code:row.doctor,doctor_name:row.doctor_name,
        fiscal_year:fiscalYearForDate(row.nextdate),
        source_status_id: row.oapp_status_id, source_updated_at: row.update_datetime,
      });
    }
    ensure(result.length <= 1000, 'ข้อมูลนัดมีจำนวนมาก กรุณาเลือกช่วงวันที่สั้นลง', 422);
  }
  return result.sort((a, b) => `${a.appointment_date} ${a.appointment_time ?? ''} ${a.oapp_id}`
    .localeCompare(`${b.appointment_date} ${b.appointment_time ?? ''} ${b.oapp_id}`));
}

export async function getOapp(params: URLSearchParams, actor?: Actor) {
  const range = oappRange(params);
  const scope = actor ? scopeSql(actor, 'assignment.department_id') : { sql: '1=1', params: [] };
  const employees = await rows<{ id: number; display_name: string; cid_ciphertext: string; cid_hmac: string }>(`
    SELECT e.id,CONCAT(e.prefix,e.first_name,' ',e.last_name) display_name,e.cid_ciphertext,e.cid_hmac
    FROM employees e WHERE e.active=1 AND e.cid_verified_at IS NOT NULL AND e.cid_ciphertext IS NOT NULL
    AND EXISTS (SELECT 1 FROM employee_assignments assignment WHERE assignment.employee_id=e.id
      AND assignment.valid_from<=? AND (assignment.valid_to IS NULL OR assignment.valid_to>?)
      AND ${scope.sql})`, [bangkokNow().day, bangkokNow().day, ...scope.params]);
  const recipients = employees.map(employee => {
    const cid = decrypt(employee.cid_ciphertext);
    ensure(cidHash(cid) === employee.cid_hmac, 'ข้อมูล CID ในทะเบียนบุคลากรไม่ตรงกัน', 503);
    return { id: employee.id, display_name: employee.display_name, cid };
  });
  if (!recipients.length) {
    // Still validate the source connection/schema; an unconfigured source is not a successful sync.
    await sourceReader('SELECT o.oapp_id,p.cid recipient_cid,d.name doctor_name,k.department department_name FROM oapp o JOIN patient p ON p.hn=o.hn LEFT JOIN doctor d ON d.code=o.doctor LEFT JOIN kskdepartment k ON k.depcode=o.depcode WHERE 1=0', []);
  }
  const data = await readOappForRecipients(recipients, range,sourceReader,{room:params.get('room')||undefined,doctor:params.get('doctor')||undefined});
  return { source: 'HOSXP', ...range, data, total: data.length };
}

export async function hosxpOptions() {
  // Only the provider code/name are exposed; doctor CID, dates of birth and tokens stay in HOSxP.
  const [doctors]=await hosxpPool().execute<RowDataPacket[]>({sql:"SELECT code,name FROM doctor WHERE active='Y' ORDER BY name",timeout:15000});
  return {rooms:HOSXP_ROOMS,doctors:doctors.map(row=>({code:String(row.code),name:String(row.name)}))};
}

export async function closeHosxpPool() {
  const active = globalHosxp.hosxpPool;
  globalHosxp.hosxpPool = undefined;
  if (active) await active.end();
}
