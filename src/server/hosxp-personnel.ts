import { rows, execute, transaction } from './db';
import { cidHash, encrypt, sha256 } from './crypto';
import { ensure, validCid } from '../domain/validation';

export type DoctorPerson = { code: string; name: string; cid: string | null; active: string | null };

// doctor is the hospital personnel register. No matching by name or by oapp.doctor.
// HOSxP often keeps several doctor codes for one person (same CID). Only one code may carry
// the CID for appointment matching: the first active=Y code, else the first code. The other
// codes stay listed without a CID so one messy source row never stops the whole sync.
export function normalizePersonnel(source: DoctorPerson[]) {
  const codes = new Set<string>(), owner = new Map<string, number>();
  const people = source.flatMap(row => {
    const code = String(row.code ?? '').trim(), name = String(row.name ?? '').trim();
    if (!code || code.length > 40 || !name || name.length > 255) return [];
    ensure(!codes.has(code), 'พบรหัสบุคลากรซ้ำใน doctor', 503); codes.add(code);
    const candidate = String(row.cid ?? '').trim();
    return [{ code, name, cid: validCid(candidate) ? candidate : null as string | null, active: row.active === 'Y' }];
  });
  people.forEach((person, index) => {
    if (!person.cid) return;
    const current = owner.get(person.cid);
    if (current === undefined || (person.active && !people[current].active)) owner.set(person.cid, index);
  });
  return people.map((person, index) => person.cid && owner.get(person.cid) !== index ? { ...person, cid: null } : person);
}

export async function syncDoctorPersonnel(source: DoctorPerson[]) {
  const people = normalizePersonnel(source);
  return transaction(async db => {
    await rows('SELECT id FROM hosxp_sync_state WHERE id=1 FOR UPDATE', [], db);
    const seen: number[] = [];
    for (const person of people) {
      const hash = person.cid ? cidHash(person.cid) : null;
      let [old] = await rows<{id:number;cid_hmac:string|null}>(
        'SELECT id,cid_hmac FROM employees WHERE hosxp_doctor_code=? FOR UPDATE', [person.code], db);
      // Adopt a pre-HOSxP record with the same CID instead of creating a second person.
      if (!old && hash) [old] = await rows<{id:number;cid_hmac:string|null}>(
        'SELECT id,cid_hmac FROM employees WHERE cid_hmac=? AND hosxp_doctor_code IS NULL FOR UPDATE', [hash], db);
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
      // The CID moved to this code (e.g. the old code became inactive): release it from the other record.
      if (hash) await execute(`UPDATE employees SET cid_ciphertext=NULL,cid_hmac=NULL,cid_verified_at=NULL
        WHERE cid_hmac=? AND id<>?`, [hash, employeeId], db);
      await execute(`UPDATE employees SET hosxp_doctor_code=?,hosxp_doctor_name=?,active=?,
        cid_ciphertext=?,cid_hmac=?,cid_verified_at=IF(? IS NULL,NULL,UTC_TIMESTAMP(6)) WHERE id=?`,
        [person.code, person.name, person.active, person.cid ? encrypt(person.cid) : null, hash, hash, employeeId], db);
      // A record created before HOSxP had the CID started with notifications off (nothing to send to).
      // When the CID first arrives, switch them on; the toggle could not be used without a CID before.
      if (old && !old.cid_hmac && hash) await execute('UPDATE employees SET notification_enabled=1 WHERE id=?', [employeeId], db);
      seen.push(employeeId);
    }
    // Only source-managed people are deactivated; unrelated historical records remain intact.
    await execute(`UPDATE employees SET active=0 WHERE hosxp_doctor_code IS NOT NULL
      ${seen.length ? `AND id NOT IN (${seen.map(() => '?').join(',')})` : ''}`, seen, db);
    return { total: people.length, active: people.filter(p=>p.active).length,
      missingCid: people.filter(p=>p.active && !p.cid).length };
  });
}
