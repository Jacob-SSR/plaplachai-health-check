import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePersonnel } from '../src/server/hosxp-personnel';

test('doctor Y is employed, N/null are inactive; invalid CID does not hide a person',()=>{
  const people=normalizePersonnel([
    {code:'A',name:'บุคลากรสมมติ ก',cid:'1234567890121',active:'Y'},
    {code:'B',name:'บุคลากรสมมติ ข',cid:null,active:'N'},
    {code:'C',name:'บุคลากรสมมติ ค',cid:'0000000000000',active:'Y'},
    {code:'D',name:'บุคลากรสมมติ ง',cid:null,active:null},
  ]);
  assert.deepEqual(people.map(p=>p.active),[true,false,true,false]);
  assert.equal(people[0].cid,'1234567890121');
  assert.equal(people[2].cid,null);
  assert.equal(people.length,4);
});

test('one person with several doctor codes keeps the CID on the active code and does not stop the sync',()=>{
  const cid='1234567890121';
  const people=normalizePersonnel([
    {code:'A',name:'บุคลากรสมมติ',cid,active:'N'},
    {code:'B',name:'บุคลากรสมมติ',cid,active:'Y'},
    {code:'C',name:'บุคลากรสมมติ',cid,active:'Y'},
    {code:'D',name:'',cid:null,active:'Y'},
  ]);
  assert.deepEqual(people.map(p=>[p.code,p.cid]),[['A',null],['B',cid],['C',null]]);
});

test('duplicate doctor code still stops synchronization without revealing CID',()=>{
  const person={code:'A',name:'บุคลากรสมมติ',cid:'1234567890121',active:'Y'};
  assert.throws(()=>normalizePersonnel([person,{...person,cid:null}]), error=>{
    assert.ok(error instanceof Error);assert.ok(!error.message.includes(person.cid));return true;
  });
});
