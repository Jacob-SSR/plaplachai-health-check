import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublicCalendar } from '../components/public-calendar';
import { bangkokNow,fiscalYearForDate } from '../src/domain/validation';
import { HosxpPersonnel } from '../components/hosxp-registry';

test('first render already includes every day and four room filters without any API response or fiscal-year rows',()=>{
  const html=renderToStaticMarkup(createElement(PublicCalendar,{account:null}));
  const month=bangkokNow().day.slice(0,7),first=new Date(`${month}-01T00:00:00Z`);
  const days=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
  assert.equal((html.match(/class="day-number"/g)||[]).length,days);
  assert.ok(html.includes('aria-label="ปฏิทินตรวจสุขภาพ"'));
  assert.ok(!html.includes('เลือกปีงบประมาณ'));assert.ok(!html.includes('ยังไม่มีปีงบประมาณ'));
  assert.ok(html.includes(`ปีงบประมาณ ${fiscalYearForDate(`${month}-01`)} · คำนวณอัตโนมัติ`));
  for(const room of ['กายภาพบำบัด','LAB','ทันตกรรม','แพทย์แผนไทย'])assert.ok(html.includes(room));
});

test('personnel does not require manual setup or fiscal-year rows',()=>{
  const people=renderToStaticMarkup(createElement(HosxpPersonnel,{employees:[
    {id:1,hosxp_doctor_code:'D1',hosxp_doctor_name:'บุคลากรสมมติที่ยังทำงาน',active:1,has_cid:1},
    {id:2,hosxp_doctor_code:'D2',hosxp_doctor_name:'บุคลากรสมมติที่พ้นสภาพ',active:0,has_cid:1},
  ],api:async()=>({}),reload:()=>{},canManage:true}));
  assert.ok(people.includes('บุคลากรสมมติที่ยังทำงาน'));
  assert.ok(!people.includes('บุคลากรสมมติที่พ้นสภาพ'));
  assert.ok(!people.includes('เพิ่มบุคลากร'));
});
