import { test,expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { fixture,testGuard } from '../fixture';
import { saveUser } from '../../src/server/registry';
import { closePool } from '../../src/server/db';
testGuard();test.afterAll(closePool);
test('server enforces viewer permissions, scopes, Origin and CSRF',async({request})=>{
 const f=await fixture(),password='Synthetic-password-2570!',username=`viewer_${randomUUID().slice(0,8)}`;
 await saveUser({username,password,displayName:'บัญชีทดสอบรายงาน',role:'VIEWER',departmentIds:[f.departmentId]},f.actor);
 const origin=process.env.APP_ORIGIN!;
 const publicResponse=await request.get(`/api/v1/public-calendar?year=${f.yearId}`);expect(publicResponse.status()).toBe(200);
 const calendar=await publicResponse.json();expect(calendar).toHaveProperty('slots');expect(JSON.stringify(calendar)).not.toContain('display_name');
 expect((await request.post('/api/v1/auth/login',{data:{username,password},headers:{Origin:'https://foreign.invalid'}})).status()).toBe(403);
 expect((await request.post('/api/v1/auth/login',{data:{username,password},headers:{Origin:origin}})).status()).toBe(200);
 const me=await(await request.get('/api/v1/me')).json();expect(me.roles).toEqual(['VIEWER']);
 expect((await request.get('/api/v1/employees')).status()).toBe(403);
 expect((await request.get(`/api/v1/appointments?year=${f.yearId}`)).status()).toBe(403);
 expect((await request.get(`/api/v1/exports/appointments?year=${f.yearId}`)).status()).toBe(403);
 expect((await request.get('/api/v1/notification-settings')).status()).toBe(403);
 const report=await(await request.get(`/api/v1/reports?year=${f.yearId}`)).json();expect(report.summary.eligible).toBe(4);expect(JSON.stringify(report)).not.toContain(f.people[0].employeeCode);
 expect((await request.post('/api/v1/years',{data:{year:2575},headers:{Origin:origin,'x-csrf-token':me.csrf}})).status()).toBe(403);
 expect((await request.post('/api/v1/auth/logout',{data:{},headers:{Origin:origin,'x-csrf-token':'a'.repeat(64)}})).status()).toBe(403);
 expect((await request.post('/api/v1/auth/logout',{data:{},headers:{Origin:origin,'x-csrf-token':me.csrf}})).status()).toBe(200);
 expect((await request.get('/api/v1/me')).status()).toBe(401);
});

for(const role of ['STAFF','VIEWER'] as const)test(`${role} lands on calendar and cannot administer`,async({page})=>{
 const f=await fixture(),password='Synthetic-password-2570!',username=`readonly_${randomUUID().slice(0,8)}`;
 await saveUser({username,password,displayName:'บัญชีดูปฏิทินทดสอบ',role,departmentIds:[f.departmentId]},f.actor);
 await page.goto('/login');
 await page.getByLabel('ชื่อผู้ใช้',{exact:true}).fill(username);
 await page.getByLabel('รหัสผ่าน',{exact:true}).fill(password);
 await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
 await expect(page).toHaveURL(process.env.APP_ORIGIN!+'/');
 await expect(page.getByRole('region',{name:'ปฏิทินตรวจสุขภาพ'})).toBeVisible();
 await expect(page.getByRole('link',{name:'จัดการระบบ'})).toHaveCount(0);
 await page.goto('/admin');await expect(page).toHaveURL(process.env.APP_ORIGIN!+'/');
 const statuses=await page.evaluate(async()=>{
  const me=await(await fetch('/api/v1/me')).json();const out=[];
  for(const path of ['personnel-seed','members/bulk','appointments','notifications/test'])out.push((await fetch(`/api/v1/${path}`,{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':me.csrf},body:'{}'})).status);
  out.push((await fetch('/api/v1/employees')).status);return out;
 });expect(statuses).toEqual([403,403,403,403,403]);
});
