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
