import { rows } from './db';
import { type Actor,scopeSql } from './auth';
import { appointmentFilter } from './appointments';

export async function reports(params:URLSearchParams,actor:Actor) {
  const year=Number(params.get('year')),scope=scopeSql(actor),dept=params.get('department');
  const rosterWhere=`m.fiscal_year_id=? AND ${scope.sql}${dept?' AND m.department_id=?':''}`;
  const values:unknown[]=[year,...scope.params,...(dept?[dept]:[])];
  const [roster]=await rows(`SELECT COUNT(*) eligible FROM fiscal_year_members m WHERE ${rosterWhere} AND m.eligibility_status='ELIGIBLE'`,values);
  const filter=appointmentFilter(params,actor);
  const joins='FROM health_check_appointments a JOIN fiscal_year_members m ON m.id=a.member_id JOIN employees e ON e.id=m.employee_id';
  const [appointments]=await rows(`SELECT COUNT(*) appointments,COUNT(DISTINCT CASE WHEN a.status<>'CANCELLED' THEN a.member_id END) scheduled_people,
   SUM(a.status='COMPLETED') completed,SUM(a.status='SCHEDULED') pending,SUM(a.status='NO_SHOW') no_show,SUM(a.status='CANCELLED') cancelled
   ${joins} WHERE ${filter.where}`,filter.values);
  const [completion]=await rows(`SELECT SUM(EXISTS(SELECT 1 FROM member_service_requirements r WHERE r.member_id=m.id AND r.status='REQUIRED')) assigned,
   SUM(EXISTS(SELECT 1 FROM member_service_requirements r WHERE r.member_id=m.id AND r.status='REQUIRED')
   AND NOT EXISTS(SELECT 1 FROM member_service_requirements r WHERE r.member_id=m.id AND r.status='REQUIRED'
     AND NOT EXISTS(SELECT 1 FROM appointment_services s WHERE s.requirement_id=r.id AND s.status='DONE'))) fully_complete
   FROM fiscal_year_members m WHERE ${rosterWhere} AND m.eligibility_status='ELIGIBLE'`,values);
  const departments=await rows(`SELECT m.department_name,COUNT(*) appointments,COUNT(DISTINCT a.member_id) people,SUM(a.status='COMPLETED') completed,SUM(a.status='NO_SHOW') no_show,SUM(a.status='SCHEDULED') pending ${joins} WHERE ${filter.where} GROUP BY m.department_name ORDER BY appointments DESC`,filter.values);
  const daily=await rows(`SELECT a.appointment_date,COUNT(*) appointments,COUNT(DISTINCT a.member_id) people,SUM(a.status='COMPLETED') completed,SUM(a.status='NO_SHOW') no_show,SUM(a.status='SCHEDULED') pending ${joins} WHERE ${filter.where} GROUP BY a.appointment_date ORDER BY a.appointment_date`,filter.values);
  const services=await rows(`SELECT g.name,COUNT(*) appointments FROM health_check_appointments a JOIN fiscal_year_members m ON m.id=a.member_id JOIN employees e ON e.id=m.employee_id JOIN service_groups g ON g.id=a.service_group_id WHERE ${filter.where} GROUP BY g.id,g.name`,filter.values);
  return {summary:{...roster,...appointments,...completion},departments,daily,services,definitions:{eligible:'ทะเบียนผู้มีสิทธิ์รายปี ตามหน่วยงานในทะเบียน',fully_complete:'ตรวจครบรายการ REQUIRED ทุกรอบในทะเบียนทั้งปี',appointments:'จำนวนครั้งนัดตามตัวกรอง',completionScope:'ร้อยละตรวจครบคิดตามปีและหน่วยงาน ไม่เปลี่ยนตามสถานะ/บริการ/ช่วงวันของตารางนัด'}};
}
