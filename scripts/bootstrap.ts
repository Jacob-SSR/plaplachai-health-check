import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool, rows, execute, transaction } from '../src/server/db';
import { ensure } from '../src/domain/validation';

const grants:Record<string,string[]>={
 ADMIN:['master.read','master.write','year.write','employee.read','employee.write','roster.write','plan.write','appointment.read','appointment.write','attendance.write','import.execute','export.execute','report.read','notification.read','notification.manage','audit.read','user.manage'],
 STAFF:['master.read','employee.read','appointment.read','appointment.write','attendance.write','report.read'],
 VIEWER:['master.read','report.read'],
};
async function main() {
  const username=process.env.ADMIN_USERNAME?.trim(),password=process.env.ADMIN_PASSWORD;
  ensure(username && /^[A-Za-z0-9_.-]{3,100}$/.test(username),'ตั้ง ADMIN_USERNAME ให้ถูกต้อง');
  ensure(password && password.length>=12 && Buffer.byteLength(password)<=72,'ตั้ง ADMIN_PASSWORD อย่างน้อย 12 อักขระ ไม่เกิน 72 bytes');
  const hash=await bcrypt.hash(password,12);
  await transaction(async db=>{
    await execute("INSERT IGNORE INTO hospitals(code,name) VALUES('10667','โรงพยาบาลพลับพลาชัย')",[],db);
    for(const [role,permissions] of Object.entries(grants)) {
      await execute('INSERT IGNORE INTO roles(code) VALUES(?)',[role],db);
      for(const permission of permissions) {
        await execute('INSERT IGNORE INTO permissions(code) VALUES(?)',[permission],db);
        await execute('INSERT IGNORE INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r,permissions p WHERE r.code=? AND p.code=?',[role,permission],db);
      }
    }
    const existing=await rows('SELECT id FROM users WHERE username=?',[username],db);
    if(!existing.length) {
      const result=await execute('INSERT INTO users(username,display_name,password_hash) VALUES(?,?,?)',[username,'ผู้ดูแลระบบ',hash],db);
      await execute("INSERT INTO user_roles(user_id,role_id) SELECT ?,id FROM roles WHERE code='ADMIN'",[result.insertId],db);
    }
    await execute("INSERT IGNORE INTO notification_settings(id) VALUES(1)",[],db);
    for(const day of [7,3,1]) await execute('INSERT IGNORE INTO notification_rules(days_before) VALUES(?)',[day],db);
  });
  console.log('Bootstrap completed. Existing passwords and roles were not overwritten.');
}
main().then(()=>pool().end()).catch(e=>{console.error(e.message);process.exitCode=1;void pool().end();});
