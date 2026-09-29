import { randomUUID } from 'node:crypto';
import { getOapp, readOappForRecipients } from './hosxp';
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
  // The supplied oapp export uses NULL. Other installations must configure their active IDs.
  const accepted = (process.env.HOSXP_ACTIVE_STATUS_IDS ?? 'NULL').split(',').map(s => s.trim());
  return accepted.includes(status == null ? 'NULL' : String(status));
}
export function futureHosxpAppointment(date: string, time: string | null, now = new Date()) {
  const { day, clock } = bangkokNow(now);
  return time == null ? date >= day : `${date} ${time}` > `${day} ${clock}:00`;
}

export async function syncHosxpAppointments(now = new Date(), readSource: (params: URLSearchParams) => Promise<{data: SourceAppointment[]}> = getOapp) {
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
    }
    // Deleted, moved out of the monitored range, or no longer in the personnel register.
    for (const old of previous) if (old.active && !seen.has(String(old.oapp_id))) {
      await execute('UPDATE hosxp_appointments SET active=0,schedule_version=schedule_version+1 WHERE oapp_id=?', [old.oapp_id], db);
      await execute("UPDATE notification_jobs SET status='CANCELLED',safe_error='HOSXP_APPOINTMENT_REMOVED' WHERE hosxp_oapp_id=? AND status IN ('PENDING','BLOCKED')", [old.oapp_id], db);
    }
    await execute('UPDATE hosxp_sync_state SET initialized=1,last_success_at=UTC_TIMESTAMP(6) WHERE id=1', [], db);
    return data.length;
  });
}

export async function hosxpAppointmentStillCurrent(a: RecordRow, cid: string) {
  const date = String(a.appointment_date);
  const current = await readOappForRecipients([{ id: Number(a.employee_id), display_name: '', cid }], { from: date, to: date });
  const source = current.find(row => row.oapp_id === String(a.oapp_id));
  return !!source && activeHosxpStatus(source.source_status_id) && hosxpFingerprint(source) === a.fingerprint;
}
