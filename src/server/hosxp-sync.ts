import { randomUUID } from 'node:crypto';
import { getOapp, readPersonnelOapp, withEmployees, oappSourceState } from './hosxp';
import { rows, execute, transaction } from './db';
import { canonicalJson, sha256 } from './crypto';
import { addDays, bangkokNow } from '../domain/validation';
import type { RecordRow } from './appointments';
import { ensureFiscalYears } from './annual-services';

type SourceAppointment = Awaited<ReturnType<typeof getOapp>>['data'][number];
export function hosxpFingerprint(a: SourceAppointment) {
  // Ignore unrelated edits (notes/update_datetime); the same appointment is not sent again.
  return sha256(canonicalJson({ employee: a.employee_id, date: a.appointment_date,
    time: a.appointment_time, location: a.location, status: a.source_status_id }));
}
export function activeHosxpStatus(status: unknown) {
  // NULL and 1 are normal appointments in HOSxP. Other installations can configure their active IDs.
  // Always accepted, even when an older .env still says HOSXP_ACTIVE_STATUS_IDS=NULL.
  const accepted = ['NULL', '1', ...(process.env.HOSXP_ACTIVE_STATUS_IDS ?? '').split(',').map(s => s.trim())];
  return accepted.includes(status == null ? 'NULL' : String(status));
}
export function futureHosxpAppointment(date: string, time: string | null, now = new Date()) {
  const { day, clock } = bangkokNow(now);
  return time == null ? date >= day : `${date} ${time}` > `${day} ${clock}:00`;
}

export async function syncHosxpAppointments(now = new Date(), readSource: (params: URLSearchParams) => Promise<{data: SourceAppointment[]}> = getOapp,
  checkSource: (ids: string[]) => Promise<Map<string, { status: unknown }>> = oappSourceState) {
  const from = bangkokNow(now).day, to = addDays(from, 366);
  await ensureFiscalYears([from]);
  // Serializes the source read and snapshot across worker processes. No writes to HOSxP.
  return transaction(async db => {
    const [state] = await rows<RecordRow>('SELECT * FROM hosxp_sync_state WHERE id=1 FOR UPDATE', [], db);
    const [settings] = await rows<RecordRow>('SELECT enabled FROM notification_settings WHERE id=1', [], db);
    const { data } = await readSource(new URLSearchParams({ from, to }));
    await ensureFiscalYears(data.map(a=>a.appointment_date),db);
    const previous = await rows<RecordRow>('SELECT * FROM hosxp_appointments', [], db);
    const byId = new Map(previous.map(row => [String(row.oapp_id), row]));
    const seen = new Set<string>();
    for (const a of data) {
      seen.add(a.oapp_id);
      const old = byId.get(a.oapp_id), fingerprint = hosxpFingerprint(a);
      const active = activeHosxpStatus(a.source_status_id) && futureHosxpAppointment(a.appointment_date, a.appointment_time, now);
      // Cancelled in HOSxP: a future appointment whose status moved out of the active statuses.
      const cancelled = !!old?.active && !activeHosxpStatus(a.source_status_id) && futureHosxpAppointment(a.appointment_date, a.appointment_time, now);
      if (old && old.fingerprint === fingerprint && !!old.active === active) {
        await execute('UPDATE hosxp_appointments SET depcode=?,doctor_code=?,doctor_name=? WHERE oapp_id=?',[a.depcode,a.doctor_code,a.doctor_name,a.oapp_id],db);
        continue;
      }
      const version = Number(old?.schedule_version ?? 0) + 1;
      await execute(`INSERT INTO hosxp_appointments(oapp_id,employee_id,appointment_date,appointment_time,location,source_status_id,fingerprint,schedule_version,active)
        VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE employee_id=VALUES(employee_id),appointment_date=VALUES(appointment_date),
        appointment_time=VALUES(appointment_time),location=VALUES(location),source_status_id=VALUES(source_status_id),fingerprint=VALUES(fingerprint),schedule_version=VALUES(schedule_version),active=VALUES(active)`,
      [a.oapp_id, a.employee_id, a.appointment_date, a.appointment_time, a.location, a.source_status_id, fingerprint, version, active], db);
      await execute('UPDATE hosxp_appointments SET depcode=?,doctor_code=?,doctor_name=? WHERE oapp_id=?',[a.depcode,a.doctor_code,a.doctor_name,a.oapp_id],db);
      await execute("UPDATE notification_jobs SET status='CANCELLED',safe_error='HOSXP_APPOINTMENT_CHANGED' WHERE hosxp_oapp_id=? AND status IN ('PENDING','BLOCKED')", [a.oapp_id], db);
      // Initial connection establishes a baseline, so existing appointments are not broadcast.
      if (state.initialized && settings.enabled && active) {
        await execute(`INSERT INTO notification_jobs(id,hosxp_oapp_id,schedule_version,scheduled_at,available_at)
          VALUES(?,?,?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))`, [randomUUID(), a.oapp_id, version], db);
      }
      if (state.initialized && settings.enabled && cancelled) await queueCancelNotice(a.oapp_id, version, db);
    }
    // Deleted, moved out of the monitored range, or no longer in the personnel register.
    const gone = previous.filter(old => old.active && !seen.has(String(old.oapp_id)));
    // Only a future appointment that is really gone from HOSxP (or no longer active there) is a cancellation;
    // one that just passed, or left the personnel match, is quietly closed.
    const future = gone.filter(old => futureHosxpAppointment(String(old.appointment_date).slice(0, 10), (old.appointment_time as string | null) ?? null, now));
    const source = future.length && state.initialized && settings.enabled ? await checkSource(future.map(old => String(old.oapp_id))) : new Map();
    for (const old of gone) {
      await execute('UPDATE hosxp_appointments SET active=0,schedule_version=schedule_version+1 WHERE oapp_id=?', [old.oapp_id], db);
      await execute("UPDATE notification_jobs SET status='CANCELLED',safe_error='HOSXP_APPOINTMENT_REMOVED' WHERE hosxp_oapp_id=? AND status IN ('PENDING','BLOCKED')", [old.oapp_id], db);
      const id = String(old.oapp_id), inSource = source.get(id);
      if (future.includes(old) && state.initialized && settings.enabled && (!inSource || !activeHosxpStatus(inSource.status)))
        await queueCancelNotice(id, Number(old.schedule_version) + 1, db);
    }
    await execute('UPDATE hosxp_sync_state SET initialized=1,last_success_at=UTC_TIMESTAMP(6) WHERE id=1', [], db);
    return data.length;
  });
}

async function queueCancelNotice(oappId: string, version: number, db: Parameters<typeof execute>[2]) {
  await execute(`INSERT IGNORE INTO notification_jobs(id,hosxp_oapp_id,schedule_version,kind,dedupe_key,scheduled_at,available_at)
    VALUES(?,?,?,'CANCELLED','cancel',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))`, [randomUUID(), oappId, version], db);
}

export async function hosxpAppointmentStillCurrent(a: RecordRow) {
  const date = String(a.appointment_date);
  const [employee] = await rows<{code:string|null}>('SELECT hosxp_doctor_code code FROM employees WHERE id=?', [a.employee_id]);
  if (!employee?.code) return false;
  const [source] = await readPersonnelOapp({ from: date, to: date }, { personnel: employee.code, oappId: String(a.oapp_id) });
  return !!source && activeHosxpStatus(source.source_status_id)
    && hosxpFingerprint({ ...source, employee_id: Number(a.employee_id) }) === a.fingerprint;
}

// One appointment, read live from HOSxP (used by the manual send button). Stores it like the worker
// would, but never queues the automatic notice: the person pressing the button is sending one now.
export async function refreshHosxpAppointment(oappId: string, now = new Date()) {
  const from = bangkokNow(now).day;
  const [a] = await withEmployees(await readPersonnelOapp({ from, to: addDays(from, 366) }, { oappId }));
  if (!a) return null;
  const fingerprint = hosxpFingerprint(a);
  const active = activeHosxpStatus(a.source_status_id) && futureHosxpAppointment(a.appointment_date, a.appointment_time, now);
  await transaction(async db => {
    const [old] = await rows<RecordRow>('SELECT fingerprint,schedule_version,active FROM hosxp_appointments WHERE oapp_id=? FOR UPDATE', [a.oapp_id], db);
    if (old && old.fingerprint === fingerprint && !!old.active === active) return;
    const version = Number(old?.schedule_version ?? 0) + 1;
    await execute(`INSERT INTO hosxp_appointments(oapp_id,employee_id,appointment_date,appointment_time,location,source_status_id,fingerprint,schedule_version,active,depcode,doctor_code,doctor_name)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE employee_id=VALUES(employee_id),appointment_date=VALUES(appointment_date),appointment_time=VALUES(appointment_time),
      location=VALUES(location),source_status_id=VALUES(source_status_id),fingerprint=VALUES(fingerprint),schedule_version=VALUES(schedule_version),active=VALUES(active),
      depcode=VALUES(depcode),doctor_code=VALUES(doctor_code),doctor_name=VALUES(doctor_name)`,
      [a.oapp_id, a.employee_id, a.appointment_date, a.appointment_time, a.location, a.source_status_id, fingerprint, version, active, a.depcode, a.doctor_code, a.doctor_name], db);
    if (old) await execute("UPDATE notification_jobs SET status='CANCELLED',safe_error='HOSXP_APPOINTMENT_CHANGED' WHERE hosxp_oapp_id=? AND status IN ('PENDING','BLOCKED')", [a.oapp_id], db);
  });
  return a;
}
