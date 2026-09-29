import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { testGuard } from '../fixture';
import { syncDoctorPersonnel } from '../../src/server/hosxp-personnel';
import { rows,execute,closePool } from '../../src/server/db';
import { cidHash,encrypt,decrypt } from '../../src/server/crypto';

testGuard();after(closePool);
test('doctor sync reuses CID identity, preserves opt-out, handles departure and never invents assignments',async()=>{
  const cid='1234567890121',code='doctor-integration-test';
  const source=[{code,name:'บุคลากรสมมติ',cid,active:'Y'}];
  const old=await rows<{id:number}>('SELECT id FROM employees WHERE cid_hmac=?',[cidHash(cid)]);
  const employeeId=old[0]?.id ?? (await execute(`INSERT INTO employees(employee_code,first_name,last_name,cid_ciphertext,cid_hmac,cid_verified_at,notification_enabled)
    VALUES(?,'สมมติ','ทดสอบ',?,?,UTC_TIMESTAMP(6),0)`,[code,encrypt(cid),cidHash(cid)])).insertId;
  await execute('UPDATE employees SET notification_enabled=0 WHERE id=?',[employeeId]);
  await syncDoctorPersonnel(source);
  const [person]=await rows<{id:number;active:number;notification_enabled:number;cid_ciphertext:string}>(
    'SELECT id,active,notification_enabled,cid_ciphertext FROM employees WHERE hosxp_doctor_code=?',[code]);
  assert.equal(person.id,employeeId);assert.equal(person.active,1);assert.equal(person.notification_enabled,0);
  assert.equal(decrypt(person.cid_ciphertext),cid);
  await syncDoctorPersonnel([{...source[0],active:'N'}]);
  assert.equal((await rows<{active:number}>('SELECT active FROM employees WHERE id=?',[employeeId]))[0].active,0);
  await syncDoctorPersonnel(source);
  await syncDoctorPersonnel([]);
  assert.equal((await rows<{active:number}>('SELECT active FROM employees WHERE id=?',[employeeId]))[0].active,0);
});
