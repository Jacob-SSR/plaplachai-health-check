import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool,rows,execute,transaction } from '../src/server/db';
import { ensure } from '../src/domain/validation';
import { audit } from '../src/server/audit';
async function main(){
 const username=process.env.RESET_USERNAME,password=process.env.RESET_PASSWORD;
 ensure(username&&password&&password.length>=12&&Buffer.byteLength(password)<=72,'Set RESET_USERNAME and RESET_PASSWORD (12+ characters, <=72 bytes)');
 const hash=await bcrypt.hash(password,12);
 await transaction(async db=>{const [u]=await rows<{id:number}>('SELECT id FROM users WHERE username=? FOR UPDATE',[username],db);ensure(u,'Account not found');await execute('UPDATE users SET password_hash=?,auth_version=auth_version+1 WHERE id=?',[hash,u.id],db);await execute('DELETE FROM user_sessions WHERE user_id=?',[u.id],db);await audit(db,null,'PASSWORD_RESET','users',u.id,{source:'server-cli'});});console.log('Password reset; all existing sessions revoked.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>pool().end());
