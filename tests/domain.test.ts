import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fiscalRange,isDate,bangkokNow,addDays,validCid,appointmentInput } from '../src/domain/validation';
import { classifyResponse,MophAlertProvider } from '../src/providers/moph-alert';
import { canonicalJson } from '../src/server/crypto';
test('Thai fiscal boundary, leap days and Bangkok midnight',()=>{
 assert.deepEqual(fiscalRange(2570),{start:'2026-10-01',end:'2027-09-30'});
 assert.equal(isDate('2027-02-29'),false);assert.equal(isDate('2028-02-29'),true);
 assert.deepEqual(bangkokNow(new Date('2026-09-30T17:05:00Z')),{day:'2026-10-01',clock:'00:05'});
 assert.equal(addDays('2026-12-31',1),'2027-01-01');assert.throws(()=>fiscalRange(2027));
});
test('identifier and appointment validation rejects ambiguous input',()=>{
 assert.equal(validCid('123'),false);assert.equal(validCid('1234567890121'),true);
 assert.equal(appointmentInput.safeParse({memberId:1,planId:1,groupId:1,roundNo:1,date:'2027-02-29',time:'25:10',location:'A',serviceIds:[1,1]}).success,false);
});
test('canonical digest is stable after MySQL JSON key ordering and omission',()=>{
 assert.equal(canonicalJson({b:2,a:{z:3,c:4},u:undefined}),canonicalJson({a:{c:4,z:3},b:2}));
});
test('provider acceptance never implies delivery; uncertain response is not retryable automatically',()=>{
 assert.equal(classifyResponse(200,{message_code:200}).outcome,'ACCEPTED');
 assert.equal(classifyResponse(200,{message_code:401}).outcome,'REJECTED');
 assert.equal(classifyResponse(500,{message_code:200}).outcome,'UNKNOWN');
 assert.equal(classifyResponse(200,{}).outcome,'UNKNOWN');
});
test('provider is off by default and handles timeout without leaking response',async()=>{
 const env={enabled:process.env.MOPH_LIVE_ENABLED,client:process.env.MOPH_CLIENT_KEY,secret:process.env.MOPH_SECRET_KEY};let calls=0;
 try{process.env.MOPH_LIVE_ENABLED='false';const p=new MophAlertProvider(async()=>{calls++;throw Error('SECRET CID');});
 assert.equal((await p.send('synthetic','test')).outcome,'NOT_SENT');assert.equal(calls,0);
 process.env.MOPH_LIVE_ENABLED='true';process.env.MOPH_CLIENT_KEY='fake';process.env.MOPH_SECRET_KEY='fake';
 const r=await p.send('synthetic','test');assert.equal(r.outcome,'UNKNOWN');assert.equal(calls,1);assert.ok(!JSON.stringify(r).includes('SECRET'));
 }finally{for(const [k,v] of [['MOPH_LIVE_ENABLED',env.enabled],['MOPH_CLIENT_KEY',env.client],['MOPH_SECRET_KEY',env.secret]]){if(v===undefined)delete process.env[k!];else process.env[k!]=v;}}
});
