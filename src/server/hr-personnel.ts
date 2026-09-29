import ExcelJS from 'exceljs';
import { rows, execute, transaction } from './db';
import { cidHash } from './crypto';
import { audit } from './audit';
import { ensure } from '../domain/validation';

// HR export (INFOMATION_PERSON.xlsx). Only the columns below are kept; CID is stored as HMAC only.
// Salary, phone, address and the rest of the file are never read into the database.
const COLUMNS = { cid: 'เลขบัตรประชาชน', prefix: 'คำนำหน้า (ภาษาไทย)', first: 'ชื่อ (ภาษาไทย)', last: 'นามสกุล (ภาษาไทย)',
  status: 'สถานะปัจจุบัน', position: 'ตำแหน่ง', department: 'หน่วยงาน', workGroup: 'ฝ่าย/แผนก', mission: 'กลุ่มภารกิจ' } as const;
export type HrPerson = { cid: string; prefix: string; firstName: string; lastName: string; status: string;
  position: string; department: string; workGroup: string; mission: string };
export const nameKey = (name: string) => name.replace(/\s+/g, '');
const cell = (value: ExcelJS.CellValue) => {
  if (value == null) return '';
  if (typeof value === 'object' && 'text' in value) return String(value.text).trim();
  if (typeof value === 'object' && 'result' in value) return String(value.result ?? '').trim();
  return String(value).trim();
};

export async function parseHrWorkbook(file: Buffer) {
  const book = new ExcelJS.Workbook();
  try { await book.xlsx.load(file as unknown as ArrayBuffer); } catch { ensure(false, 'ไฟล์ไม่ใช่ Excel (.xlsx)'); }
  const sheet = book.worksheets[0];
  ensure(sheet, 'ไม่พบข้อมูลในไฟล์');
  let headerRow = 0;
  for (let i = 1; i <= Math.min(10, sheet.rowCount) && !headerRow; i++)
    if ((sheet.getRow(i).values as ExcelJS.CellValue[]).some(v => cell(v) === COLUMNS.cid)) headerRow = i;
  ensure(headerRow, `ไม่พบหัวคอลัมน์ "${COLUMNS.cid}" ใช้ไฟล์ทะเบียนบุคลากรจากระบบบุคลากร`);
  const header = (sheet.getRow(headerRow).values as ExcelJS.CellValue[]).map(cell);
  const index = Object.fromEntries(Object.entries(COLUMNS).map(([key, name]) => [key, header.indexOf(name)])) as Record<keyof typeof COLUMNS, number>;
  for (const key of ['cid', 'first', 'last', 'workGroup'] as const) ensure(index[key] > 0, `ไม่พบคอลัมน์ "${COLUMNS[key]}"`);
  const people: HrPerson[] = [], seen = new Set<string>();
  for (let i = headerRow + 1; i <= sheet.rowCount; i++) {
    const values = sheet.getRow(i).values as ExcelJS.CellValue[];
    const get = (key: keyof typeof COLUMNS) => index[key] > 0 ? cell(values[index[key]]).slice(0, 255) : '';
    const cid = get('cid').replace(/\D/g, '');
    if (!cid && !get('first')) continue;
    // Some real IDs fail the checksum (e.g. non-Thai staff); 13 digits is enough for matching.
    ensure(/^\d{13}$/.test(cid), `แถว ${i}: เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก`);
    ensure(!seen.has(cid), `แถว ${i}: เลขบัตรประชาชนซ้ำในไฟล์`); seen.add(cid);
    people.push({ cid, prefix: get('prefix').slice(0, 50), firstName: get('first').slice(0, 100), lastName: get('last').slice(0, 100),
      status: get('status').slice(0, 100), position: get('position'), department: get('department'), workGroup: get('workGroup'), mission: get('mission') });
  }
  ensure(people.length > 0 && people.length <= 5000, 'ไม่พบรายชื่อบุคลากรในไฟล์');
  return people;
}

// Full snapshot: the file replaces the previous one.
export async function importHrPersonnel(file: Buffer, actorId: number | null) {
  const people = await parseHrWorkbook(file);
  return transaction(async db => {
    await execute('DELETE FROM hr_personnel', [], db);
    for (const p of people) await execute(`INSERT INTO hr_personnel(cid_hmac,name_key,prefix,first_name,last_name,position,department,work_group,mission_group,status)
      VALUES(?,?,?,?,?,?,?,?,?,?)`, [cidHash(p.cid), nameKey(p.firstName + p.lastName), p.prefix, p.firstName, p.lastName,
      p.position, p.department, p.workGroup, p.mission, p.status], db);
    await audit(db, actorId, 'HR_IMPORT', 'hr_personnel', null, { total: people.length });
    return { total: people.length, workGroups: new Set(people.map(p => p.workGroup)).size };
  });
}

export type HrInfo = { position: string; department: string; work_group: string };
// Look up by the doctor's CID (via the synced employee) first, then by name.
export async function hrLookup() {
  const list = await rows<HrInfo & { cid_hmac: string; name_key: string; code: string | null }>(`SELECT h.cid_hmac,h.name_key,h.position,h.department,h.work_group,e.hosxp_doctor_code code
    FROM hr_personnel h LEFT JOIN employees e ON e.cid_hmac=h.cid_hmac AND e.hosxp_doctor_code IS NOT NULL`);
  const byCode = new Map<string, HrInfo>(), byName = new Map<string, HrInfo>();
  for (const p of list) {
    const info = { position: p.position, department: p.department, work_group: p.work_group };
    if (p.code) byCode.set(String(p.code), info);
    if (!byName.has(p.name_key)) byName.set(p.name_key, info);
  }
  return (code: string | null | undefined, name: string): HrInfo | undefined =>
    (code ? byCode.get(String(code)) : undefined) ?? byName.get(nameKey(name));
}
