import { randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { rows, execute, transaction, type DB } from './db';
import { sha256 } from './crypto';
import { ensure, AppError } from '../domain/validation';
import { audit } from './audit';

export type Actor = {id:number; username:string; displayName:string; roles:string[]; permissions:string[]; departments:number[]; csrf:string};
export const cookieName='ppc_session';
export function originCheck(req:Request) {
  const configured=process.env.APP_ORIGIN; ensure(configured,'ยังไม่ได้ตั้ง APP_ORIGIN',503);
  ensure(req.headers.get('origin')===new URL(configured).origin,'คำขอไม่ได้มาจากเว็บไซต์นี้',403,'CSRF');
}
export function requirePermission(actor:Actor,permission:string) {
  ensure(actor.permissions.includes(permission),'ไม่มีสิทธิ์ดำเนินการนี้',403,'FORBIDDEN');
}
export function hasScope(actor:Actor,department:number) { return actor.roles.includes('ADMIN') || actor.departments.includes(department); }
export function scopeSql(actor:Actor,column='m.department_id') {
  if(actor.roles.includes('ADMIN')) return {sql:'1=1',params:[] as unknown[]};
  if(!actor.departments.length) return {sql:'1=0',params:[] as unknown[]};
  return {sql:`${column} IN (${actor.departments.map(()=>'?').join(',')})`,params:actor.departments as unknown[]};
}
export async function actorFromToken(token:string|undefined):Promise<Actor> {
  ensure(token && token.length===64,'กรุณาเข้าสู่ระบบ',401,'UNAUTHENTICATED');
  const [session]=await rows<{id:number;username:string;display_name:string;csrf_token:string}>(
    `SELECT u.id,u.username,u.display_name,s.csrf_token FROM user_sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token_hash=? AND u.active=1 AND s.auth_version=u.auth_version
     AND s.expires_at>UTC_TIMESTAMP() AND s.last_seen_at>DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 MINUTE)`,[sha256(token)]);
  ensure(session,'กรุณาเข้าสู่ระบบอีกครั้ง',401,'UNAUTHENTICATED');
  const roles=await rows<{code:string}>('SELECT r.code FROM roles r JOIN user_roles ur ON ur.role_id=r.id WHERE ur.user_id=?',[session.id]);
  const permissions=await rows<{code:string}>(`SELECT DISTINCT p.code FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id JOIN user_roles ur ON ur.role_id=rp.role_id WHERE ur.user_id=?`,[session.id]);
  const departments=await rows<{department_id:number}>('SELECT department_id FROM user_department_scopes WHERE user_id=?',[session.id]);
  await execute('UPDATE user_sessions SET last_seen_at=UTC_TIMESTAMP(6) WHERE token_hash=?',[sha256(token)]);
  return {id:session.id,username:session.username,displayName:session.display_name,roles:roles.map(r=>r.code),permissions:permissions.map(p=>p.code),departments:departments.map(d=>d.department_id),csrf:session.csrf_token};
}
export async function authenticate(req:NextRequest) {
  const actor=await actorFromToken(req.cookies.get(cookieName)?.value);
  if(!['GET','HEAD'].includes(req.method)) {
    originCheck(req);
    const supplied=req.headers.get('x-csrf-token')??'';
    ensure(Buffer.byteLength(supplied)===Buffer.byteLength(actor.csrf) && timingSafeEqual(Buffer.from(supplied),Buffer.from(actor.csrf)),'CSRF token ไม่ถูกต้อง',403,'CSRF');
  }
  return actor;
}
async function takeLoginLimit(key:string,limit:number,db:DB) {
  const bucket=sha256(key);
  await execute(`INSERT INTO login_limits(bucket,attempts,reset_at) VALUES(?,1,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE))
   ON DUPLICATE KEY UPDATE attempts=IF(reset_at<=UTC_TIMESTAMP(),1,attempts+1),reset_at=IF(reset_at<=UTC_TIMESTAMP(),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE),reset_at)`,[bucket],db);
  const [r]=await rows<{attempts:number}>('SELECT attempts FROM login_limits WHERE bucket=?',[bucket],db);
  return r.attempts<=limit;
}
export async function login(req:NextRequest,username:string,password:string) {
  originCheck(req);
  const allowed=await transaction(async db=>{
    const one=await takeLoginLimit(`login-user:${username.toLowerCase()}`,10,db);
    const all=await takeLoginLimit('login-global',300,db);
    return one && all;
  });
  ensure(allowed,'เข้าสู่ระบบผิดบ่อยเกินไป กรุณารอ 15 นาที',429,'RATE_LIMIT');
  const [user]=await rows<{id:number;password_hash:string;active:number;auth_version:number}>('SELECT id,password_hash,active,auth_version FROM users WHERE username=?',[username]);
  // Constant work for unknown usernames; the dummy hash is not a usable account credential.
  const valid=await bcrypt.compare(password,user?.password_hash ?? '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxH5T9MKbmxziDyNgjjyW.kXSlW');
  if(!user?.active || !valid) throw new AppError(401,'INVALID_LOGIN','ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
  await transaction(async db=>{
    await execute('INSERT INTO user_sessions(token_hash,user_id,csrf_token,auth_version,expires_at) VALUES(?,?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR))',[sha256(token),user.id,csrf,user.auth_version],db);
    await audit(db,user.id,'LOGIN','users',user.id);
  });
  const response=NextResponse.json({ok:true});
  response.cookies.set(cookieName,token,{httpOnly:true,secure:new URL(process.env.APP_ORIGIN!).protocol==='https:',sameSite:'lax',path:'/',maxAge:28800});
  response.headers.set('Cache-Control','no-store'); return response;
}
export async function logout(req:NextRequest,actor:Actor) {
  const token=req.cookies.get(cookieName)?.value;
  await transaction(async db=>{if(token) await execute('DELETE FROM user_sessions WHERE token_hash=?',[sha256(token)],db);await audit(db,actor.id,'LOGOUT','users',actor.id);});
  const response=NextResponse.json({ok:true});response.cookies.set(cookieName,'',{maxAge:0,path:'/'});return response;
}
