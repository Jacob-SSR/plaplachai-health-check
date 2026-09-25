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

test('MOPH rejection messages identify documented causes without exposing response data',()=>{
 const cases=[['client-key or secret-key incorrect','Client_ID หรือ Secret ไม่ถูกต้อง'],['No Cid','ไม่พบ CID'],['Hospital Logo is empty','ยังไม่มีรูปโรงพยาบาล']];
 for(const [message,expected] of cases){const result=classifyResponse(200,{message_code:401,message});assert.equal(result.outcome,'REJECTED');assert.ok(result.safeError?.includes(expected));assert.equal(result.providerCode,'401');}
 const ambiguous=classifyResponse(200,{message_code:404,message:'Error template'});assert.ok(ambiguous.safeError?.includes('หลายสาเหตุ'));
 for(const message of ['secret: SENSITIVE CID 1234567890121','No Cid 1234567890121',{cid:'1234567890121'}]){
  const result=JSON.stringify(classifyResponse(200,{message_code:401,message}));assert.ok(!result.includes('SENSITIVE'));assert.ok(!result.includes('1234567890121'));
 }
 assert.equal(classifyResponse(503,{message_code:401,message:'client-key or secret-key incorrect'}).outcome,'UNKNOWN');
 assert.equal(classifyResponse(401,null).outcome,'REJECTED');
});

test('Free Form transport uses CMS headers and preserves safe error details',async()=>{
 const keys=['MOPH_LIVE_ENABLED','MOPH_CLIENT_KEY','MOPH_SECRET_KEY','MOPH_BEARER_TOKEN'],saved=keys.map(k=>process.env[k]);
 try{
  process.env.MOPH_LIVE_ENABLED='true';process.env.MOPH_CLIENT_KEY=' client-test ';process.env.MOPH_SECRET_KEY=' secret-test ';delete process.env.MOPH_BEARER_TOKEN;
  const provider=new MophAlertProvider(async(url,options)=>{
   assert.equal(url,'https://morpromt2c.moph.go.th/alert/v3.1/messages');
   const headers=options!.headers as Record<string,string>;assert.equal(headers['client-key'],'client-test');assert.equal(headers['secret-key'],'secret-test');assert.equal(headers.Authorization,undefined);
   const payload=JSON.parse(String(options!.body));assert.deepEqual(payload.cid,['synthetic']);
   return new Response(JSON.stringify({message_code:401,message:'No Cid'}),{status:200});
  });assert.ok((await provider.send('synthetic','test')).safeError?.includes('ไม่พบ CID'));
  const html=new MophAlertProvider(async()=>new Response('<p>secret-test</p>',{status:403}));const result=await html.send('synthetic','test');assert.equal(result.outcome,'REJECTED');assert.ok(!JSON.stringify(result).includes('secret-test'));
 }finally{keys.forEach((key,i)=>{if(saved[i]===undefined)delete process.env[key];else process.env[key]=saved[i];});}
});
test('provider is off by default and handles timeout without leaking response',async()=>{
 const env={enabled:process.env.MOPH_LIVE_ENABLED,client:process.env.MOPH_CLIENT_KEY,secret:process.env.MOPH_SECRET_KEY};let calls=0;
 try{process.env.MOPH_LIVE_ENABLED='false';const p=new MophAlertProvider(async()=>{calls++;throw Error('SECRET CID');});
 assert.equal((await p.send('synthetic','test')).outcome,'NOT_SENT');assert.equal(calls,0);
 process.env.MOPH_LIVE_ENABLED='true';process.env.MOPH_CLIENT_KEY='fake';process.env.MOPH_SECRET_KEY='fake';
 const r=await p.send('synthetic','test');assert.equal(r.outcome,'UNKNOWN');assert.equal(calls,1);assert.ok(!JSON.stringify(r).includes('SECRET'));
 }finally{for(const [k,v] of [['MOPH_LIVE_ENABLED',env.enabled],['MOPH_CLIENT_KEY',env.client],['MOPH_SECRET_KEY',env.secret]]){if(v===undefined)delete process.env[k!];else process.env[k!]=v;}}
});
