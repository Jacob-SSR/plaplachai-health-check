import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseHrWorkbook } from '../src/server/hr-personnel';

async function workbook(rows: unknown[][]) {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('x');
  sheet.addRow(['ข้อมูลบุคลากรจำนวน 2 คน']);
  sheet.addRow(['ลำดับ', 'เลขบัตรประชาชน', 'คำนำหน้า (ภาษาไทย)', 'ชื่อ (ภาษาไทย)', 'นามสกุล (ภาษาไทย)', 'สถานะปัจจุบัน', 'ตำแหน่ง', 'เงินเดือน', 'หน่วยงาน', 'ฝ่าย/แผนก', 'กลุ่มภารกิจ']);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await book.xlsx.writeBuffer());
}

test('HR file keeps only name, position, department and work group; header row is found below the title', async () => {
  const people = await parseHrWorkbook(await workbook([
    [1, '1111111111111', 'นาย', 'สมมติ', 'ทดสอบ', 'ทำงานปกติ', 'พยาบาล', 99999, 'งานผู้ป่วยนอก', 'กลุ่มงานการพยาบาล', 'กลุ่มงานการพยาบาล'],
    [2, '2222222222222', 'น.ส.', 'ตัวอย่าง', 'ข้อมูล', 'ทำงานปกติ', 'นักวิชาการ', 99999, 'งานบัญชี', 'กลุ่มงานบริหารทั่วไป', ''],
  ]));
  assert.equal(people.length, 2);
  assert.deepEqual({ ...people[0], cid: '' }, { cid: '', prefix: 'นาย', firstName: 'สมมติ', lastName: 'ทดสอบ', status: 'ทำงานปกติ',
    position: 'พยาบาล', department: 'งานผู้ป่วยนอก', workGroup: 'กลุ่มงานการพยาบาล', mission: 'กลุ่มงานการพยาบาล' });
  assert.ok(!JSON.stringify(people).includes('99999'));
});

test('HR file with a bad or duplicate CID is rejected without importing part of it', async () => {
  await assert.rejects(parseHrWorkbook(await workbook([[1, '123', 'นาย', 'ก', 'ข', '', '', 0, '', 'ก', '']])), /13 หลัก/);
  await assert.rejects(parseHrWorkbook(await workbook([[1, '1111111111111', 'นาย', 'ก', 'ข', '', '', 0, '', 'ก', ''],
    [2, '1111111111111', 'นาย', 'ค', 'ง', '', '', 0, '', 'ก', '']])), /ซ้ำ/);
  await assert.rejects(parseHrWorkbook(Buffer.from('not excel')));
});

test('HR CID goes to the personnel record by CID first, else by name with at most a title in front', async () => {
  const { matchHrPeople } = await import('../src/server/hr-personnel');
  const employees = [
    { id: 1, name: 'กภ.อมรรัตน์ นิ่มผักแว่น', cidHmac: null, active: true },
    { id: 2, name: 'สุวิชัย ใจดี', cidHmac: null, active: true },
    { id: 3, name: 'นางสาว ไพลิน พลเยี่ยม', cidHmac: null, active: false },
    { id: 4, name: 'ไพลิน พลเยี่ยม', cidHmac: null, active: true },
    { id: 5, name: 'ชื่อเปลี่ยน แล้ว', cidHmac: 'h-same', active: true },
  ];
  const hr = [
    { nameKey: 'อมรรัตน์นิ่มผักแว่น', prefix: 'น.ส.', cidHmac: 'h1' },
    { nameKey: 'วิชัยใจดี', prefix: 'นาย', cidHmac: 'h2' },
    { nameKey: 'ไพลินพลเยี่ยม', prefix: 'น.ส.', cidHmac: 'h3' },
    { nameKey: 'ชื่อเดิมในทะเบียน', prefix: 'นาย', cidHmac: 'h-same' },
  ];
  const m = matchHrPeople(employees, hr);
  assert.equal(m.get(1), 0, 'title "กภ." in front of the name');
  assert.equal(m.has(2), false, '"สุวิชัย" is not "วิชัย"');
  assert.equal(m.get(4), 2, 'the active code gets the CID'); assert.equal(m.has(3), false, 'one CID, one record');
  assert.equal(m.get(5), 3, 'the same CID matches even when the name differs');
});
