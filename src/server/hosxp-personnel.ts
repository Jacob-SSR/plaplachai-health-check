import { rows, execute, transaction } from './db';
import { cidHash, encrypt, sha256 } from './crypto';
import { ensure, validCid } from '../domain/validation';

export type DoctorPerson = { code: string; name: string; cid: string | null; active: string | null };

// doctor is the hospital personnel register. No matching by name or by oapp.doctor.
export function normalizePersonnel(source: DoctorPerson[]) {
  const codes = new Set<string>(), cids = new Set<string>();
  return source.map(row => {
    const code = String(row.code).trim(), name = String(row.name ?? '').trim();
    const candidate = String(row.cid ?? '').trim();
    const cid = validCid(candidate) ? candidate : null;
    ensure(code.length > 0 && code.length <= 40 && name.length > 0 && name.length <= 255,
      'รหัสหรือชื่อบุคลากรใน doctor ไม่ถูกต้อง', 503);
    ensure(!codes.has(code), 'พบรหัสบุคลากรซ้ำใน doctor', 503); codes.add(code);
    ensure(!cid || !cids.has(cid), 'พบ CID ซ้ำใน doctor กรุณาตรวจสอบต้นทาง', 503);
    if (cid) cids.add(cid);
    return { code, name, cid, active: row.active === 'Y' };
  });
}

export async function syncDoctorPersonnel(source: DoctorPerson[]) {
  const people = normalizePersonnel(source);
  return transaction(async db => {
    await rows('SELECT id FROM hosxp_sync_state WHERE id=1 FOR UPDATE', [], db);
    const seen: number[] = [];
    for (const person of people) {
      const hash = person.cid ? cidHash(person.cid) : null;
      const existing = await rows<{id:number;hosxp_doctor_code:string|null;cid_hmac:string|null}>(
        'SELECT id,hosxp_doctor_code,cid_hmac FROM employees WHERE hosxp_doctor_code=? OR (cid_hmac IS NOT NULL AND cid_hmac=?) FOR UPDATE',
        [person.code, hash], db);
      ensure(existing.length <= 1, 'รหัส doctor กับ CID ตรงกับบุคลากรคนละรายการ กรุณาตรวจทะเบียน', 409);
      const old = existing[0];
      ensure(!old?.hosxp_doctor_code || old.hosxp_doctor_code === person.code,
        'CID นี้ผูกกับ doctor คนละรหัสอยู่แล้ว', 409);
      // Keep existing identity history and individual notification preferences.
      ensure(!old?.cid_hmac || !hash || old.cid_hmac === hash,
        'CID ของรหัส doctor เปลี่ยน กรุณาตรวจสอบก่อนส่งแจ้งเตือน', 409);
      let employeeId = old?.id;
      if (!employeeId) {
        const parts = person.name.split(/\s+/), first = parts.shift()!;
        const created = await execute(`INSERT INTO employees(employee_code,first_name,last_name,notification_enabled)
          VALUES(?,?,?,?)`, ['HOSXP-' + sha256(person.code).slice(0,24), first.slice(0,100), parts.join(' ').slice(0,100), !!person.cid], db);
        employeeId = created.insertId;
      }
      await execute(`UPDATE employees SET hosxp_doctor_code=?,hosxp_doctor_name=?,active=?,
        cid_ciphertext=?,cid_hmac=?,cid_verified_at=IF(? IS NULL,NULL,UTC_TIMESTAMP(6)) WHERE id=?`,
        [person.code, person.name, person.active, person.cid ? encrypt(person.cid) : null, hash, hash, employeeId], db);
      seen.push(employeeId);
    }
    // Only source-managed people are deactivated; unrelated historical records remain intact.
    await execute(`UPDATE employees SET active=0 WHERE hosxp_doctor_code IS NOT NULL
      ${seen.length ? `AND id NOT IN (${seen.map(() => '?').join(',')})` : ''}`, seen, db);
    return { total: people.length, active: people.filter(p=>p.active).length,
      missingCid: people.filter(p=>p.active && !p.cid).length };
  });
}
