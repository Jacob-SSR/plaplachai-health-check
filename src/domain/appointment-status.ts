// Status from HOSxP: visit_vn set = came; otherwise by date relative to today (Bangkok).
export const APPOINTMENT_STATUS = { ATTENDED: 'มาตามนัด', PENDING: 'รอตรวจ', MISSED: 'ไม่มาตามนัด' } as const;
export type AppointmentStatus = keyof typeof APPOINTMENT_STATUS;
export function appointmentStatus(a: { visited: boolean; appointment_date: string }, today: string): AppointmentStatus {
  return a.visited ? 'ATTENDED' : a.appointment_date >= today ? 'PENDING' : 'MISSED';
}
