import { z } from 'zod';

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function ensure(condition: unknown, message: string, status = 422, code = 'VALIDATION') : asserts condition {
  if (!condition) throw new AppError(status, code, message);
}
export const id = z.coerce.number().int().positive();
export const code = z.string().trim().regex(/^[A-Za-z0-9_-]{1,40}$/, 'ใช้รหัสอักษรอังกฤษ ตัวเลข - หรือ _');
export const text = (max = 255) => z.string().trim().min(1, 'กรุณากรอกข้อมูล').max(max);
export function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export const date = z.string().refine(isDate, 'วันที่ต้องเป็น ค.ศ. YYYY-MM-DD และมีอยู่จริง');
export const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'เวลา HH:mm');
export const statuses = ['SCHEDULED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] as const;
export const statusLabels: Record<string, string> = {SCHEDULED:'รอตรวจ',CHECKED_IN:'เข้ารับบริการ',COMPLETED:'ตรวจแล้ว',NO_SHOW:'ขาดนัด',CANCELLED:'ยกเลิก'};
export const appointmentInput = z.object({
  memberId:id, planId:id, groupId:id, roundNo:id.max(100), attemptNo:id.max(100).default(1),
  date, time, location:text(), queueLabel:z.string().trim().max(50).default(''),
  serviceIds:z.array(id).min(1).max(50).refine(a=>new Set(a).size===a.length,'รายการตรวจซ้ำ'),
  note:z.string().trim().max(1000).default(''),
});
export type AppointmentInput = z.infer<typeof appointmentInput>;
export function fiscalRange(year: number) {
  ensure(Number.isInteger(year) && year >= 2500 && year <= 2800, 'ปีงบประมาณไม่ถูกต้อง');
  return { start:`${year-544}-10-01`, end:`${year-543}-09-30` };
}
export function inRange(day:string,start:string,end:string) { return isDate(day) && day>=start && day<=end; }
export function bangkokNow(now = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const clock = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hour12:false}).format(now);
  return {day,clock};
}
export function addDays(day:string,n:number) { return new Date(new Date(day+'T00:00:00Z').getTime()+n*86400000).toISOString().slice(0,10); }
export function validCid(cid:string) {
  return /^\d{13}$/.test(cid) && (11-[...cid.slice(0,12)].reduce((sum,d,i)=>sum+Number(d)*(13-i),0)%11)%10===Number(cid[12]);
}
