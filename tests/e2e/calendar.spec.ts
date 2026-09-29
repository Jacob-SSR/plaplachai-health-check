import { test,expect } from '@playwright/test';

// Public UI only; all appointment responses are synthetic, no DB or MOPH access.
test('empty calendar opens immediately and October changes the fiscal year automatically',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:new Date('2026-09-29T05:00:00Z')});
  await page.route('**/api/v1/public-calendar?*',route=>route.fulfill({json:{departments:[],slots:[]}}));
  await page.goto('/');
  await expect(page.getByRole('region',{name:'ปฏิทินตรวจสุขภาพ'})).toBeVisible();
  await expect(page.locator('.day-number')).toHaveCount(30);
  await expect(page.getByRole('combobox',{name:'ปีงบประมาณ',exact:true})).toHaveCount(0);
  await expect(page.getByText('ปีงบประมาณ 2569 · คำนวณอัตโนมัติ')).toBeVisible();
  await expect(page.getByText('ยังไม่มีนัดหมายในช่วงนี้', {exact:false})).toBeVisible();
  await expect(page.getByRole('combobox',{name:'ห้องบริการ'}).locator('option')).toHaveText(['ทุกห้องบริการ','กายภาพบำบัด','LAB','ทันตกรรม','แพทย์แผนไทย']);
  await page.getByRole('button',{name:'เดือนถัดไป',exact:true}).click();
  await expect(page.locator('.day-number')).toHaveCount(31);
  await expect(page.getByText('ปีงบประมาณ 2570 · คำนวณอัตโนมัติ')).toBeVisible();
  await page.screenshot({path:'test-results/calendar-empty-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/calendar-empty-mobile.png',fullPage:true});
  expect(errors).toEqual([]);
});

test('calendar remains visible when appointments cannot load',async({page})=>{
  await page.route('**/api/v1/public-calendar?*',route=>route.fulfill({status:503,json:{message:'ฐานข้อมูลยังไม่พร้อม'}}));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('ยังโหลดข้อมูลนัดหมายไม่ได้');
  await expect(page.getByRole('region',{name:'ปฏิทินตรวจสุขภาพ'})).toBeVisible();
  expect(await page.locator('.day-number').count()).toBeGreaterThanOrEqual(28);
  await expect(page.getByText('ยังไม่สามารถยืนยันจำนวนนัด',{exact:false})).toBeVisible();
  await expect(page.getByText('ยังไม่มีปีงบประมาณ',{exact:true})).toHaveCount(0);
});
