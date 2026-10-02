// Appointment notice sent to LINE หมอพร้อม. Plain text is always available; the Flex card is opt-in.
export type NoticeKind = 'NEW' | 'CHANGED' | 'REMINDER' | 'MANUAL' | 'CANCELLED';
export type Notice = { kind: NoticeKind; name: string; date: string; time: string | null;
  /** false hides the logo + hospital name row on the card header (admin setting show_brand) */ showBrand?: boolean; service: string; location: string; daysBefore?: number;
  /** LAB items from HOSxP (ticked note2 + LAB order form) */ tests?: string[];
  /** Preparation instructions ticked in HOSxP (note1), hospital wording */ preparation?: string[] };

export const HOSPITAL_NAME = 'โรงพยาบาลพลับพลาชัย';
const TITLES: Record<NoticeKind, string> = {
  CANCELLED: 'แจ้งยกเลิกวันนัด',
  NEW: 'แจ้งนัดตรวจสุขภาพบุคลากร',
  CHANGED: 'แจ้งเปลี่ยนแปลงวันนัด',
  REMINDER: 'แจ้งเตือนก่อนถึงวันนัด',
  MANUAL: 'แจ้งนัดตรวจสุขภาพบุคลากร',
};
export const noticeTitle = (n: Notice) => TITLES[n.kind];
export function thaiLongDate(day: string) {
  return new Intl.DateTimeFormat('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' })
    .format(new Date(`${day}T00:00:00+07:00`));
}
export function noticeLead(n: Notice) {
  if (n.kind === 'CANCELLED') return 'นัดหมายของท่านต่อไปนี้ได้ถูกยกเลิกแล้ว';
  if (n.kind === 'REMINDER') return n.daysBefore === 0 ? 'วันนี้เป็นวันนัดของท่าน' : n.daysBefore === 1 ? 'พรุ่งนี้เป็นวันนัดของท่าน' : `อีก ${n.daysBefore ?? 2} วันจะถึงวันนัดของท่าน`;
  if (n.kind === 'CHANGED') return 'นัดหมายของท่านมีการเปลี่ยนแปลง รายละเอียดใหม่ดังนี้';
  return 'ท่านมีนัดตรวจสุขภาพ รายละเอียดดังนี้';
}
export function noticeRows(n: Notice): [string, string, string][] {
  return [
    ['📅', 'วันที่', thaiLongDate(n.date)],
    ['⏰', 'เวลา', n.time ? `${n.time.slice(0, 5)} น.` : 'โปรดติดต่อเจ้าหน้าที่เพื่อยืนยันเวลา'],
    ['🩺', 'บริการ', n.service || '-'],
    // Plain Thai categories only; staff see the item codes in the web, not in the notice.
    ...(n.tests?.length ? [['🧪', 'การตรวจ', labGroups(n.tests).map(g => `• ${g}`).join('\n')] as [string, string, string]] : []),
    ['📍', 'ติดต่อที่', n.location || HOSPITAL_NAME],
  ];
}
export const NOTICE_PREPARE = ['บัตรประจำตัวประชาชน', 'สมุดประจำตัวผู้ป่วย (ถ้ามี)'];

// LAB items grouped for a formal summary; preparation advice only for tests that need it.
const URINE = /urine|\bUA\b|U\/A|ปัสสาวะ|microalbumin|UACR/i;
const EKG = /\bEKG\b|\bECG\b|คลื่นไฟฟ้าหัวใจ/i;
const SPUTUM = /sputum|\bAFB\b|เสมหะ/i;
const OTHER_ITEM = /^อื่น/;
const XRAY = /x-?ray|\bCXR\b|chest film|เอกซเรย์|เอ็กซเรย์|ภาพรังสี/i;
const STOOL = /stool|อุจจาระ|occult|FOBT|FIT\b/i;
const FASTING = /FBS|FPG|glucose|น้ำตาล|chol|triglyceride|\bTG\b|HDL|LDL|lipid|ไขมัน/i;
export function labGroups(tests: string[] = []) {
  const groups: string[] = [];
  // Only three plain groups: blood, urine, and everything else (EKG, sputum, stool, X-ray).
  const other = [STOOL, EKG, SPUTUM, XRAY, OTHER_ITEM];
  if (tests.some(t => !URINE.test(t) && !other.some(re => re.test(t)))) groups.push('การตรวจเลือด');
  if (tests.some(t => URINE.test(t))) groups.push('การตรวจปัสสาวะ');
  if (tests.some(t => other.some(re => re.test(t)))) groups.push('การตรวจอื่นๆ');
  return groups;
}
export const thaiList = (items: string[]) => items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} และ${items[items.length - 1]}`;
export function noticePreparation(n: Notice) {
  // The hospital's own instructions from HOSxP win; the generic advice is only a fallback.
  if (n.preparation?.length) return n.preparation;
  const tests = n.tests ?? [], steps: string[] = [];
  if (tests.some(t => FASTING.test(t))) steps.push('งดอาหารและเครื่องดื่มทุกชนิด ยกเว้นน้ำเปล่า อย่างน้อย 8 ชั่วโมงก่อนการเจาะเลือด');
  if (tests.some(t => URINE.test(t))) steps.push('เก็บตัวอย่างปัสสาวะช่วงกลางของการถ่ายปัสสาวะ ตามคำแนะนำของเจ้าหน้าที่ห้องปฏิบัติการ');
  if (tests.some(t => SPUTUM.test(t))) steps.push('เก็บเสมหะในช่วงเช้าหลังตื่นนอน โดยบ้วนปากด้วยน้ำเปล่าก่อน ตามคำแนะนำของเจ้าหน้าที่');
  if (tests.some(t => STOOL.test(t))) steps.push('รับภาชนะเก็บตัวอย่างอุจจาระและคำแนะนำจากเจ้าหน้าที่ห้องปฏิบัติการ');
  return steps;
}
export const NOTICE_FOOTER = ['กรุณามาก่อนเวลานัด 15 นาที', 'หากไม่สะดวกหรือต้องการเลื่อนนัด โปรดติดต่อเจ้าหน้าที่'];
export const CANCEL_FOOTER = ['ไม่ต้องมารับบริการตามวันและเวลาดังกล่าว', 'หากต้องการนัดใหม่ หรือไม่ได้ขอยกเลิก โปรดติดต่อเจ้าหน้าที่'];
export const noticeFooter = (n: Notice) => n.kind === 'CANCELLED' ? CANCEL_FOOTER : NOTICE_FOOTER;
// A cancelled appointment needs nothing brought or prepared.
export const showsPreparation = (n: Notice) => n.kind !== 'CANCELLED';

function prepareLines(n: Notice) {
  if (!showsPreparation(n)) return [];
  const steps = noticePreparation(n);
  return [`🪪 สิ่งที่ต้องนำมา : ${NOTICE_PREPARE.join(', ')}`, ...(steps.length ? ['📝 การเตรียมตัวก่อนรับการตรวจ', ...steps.map(s => `   - ${s}`)] : [])];
}
export function noticeText(n: Notice) {
  return [
    `🏥 ${HOSPITAL_NAME}`,
    `━━━━━━━━━━━━━━`,
    `${n.kind === 'REMINDER' ? '🔔' : n.kind === 'CHANGED' ? '🔄' : '📋'} ${noticeTitle(n)}`,
    '',
    `เรียน คุณ${n.name}`,
    noticeLead(n),
    '',
    ...noticeRows(n).map(([icon, label, value]) => `${icon} ${label} : ${value}`),
    '',
    ...prepareLines(n),
    '',
    ...noticeFooter(n).map(line => `• ${line}`),
  ].join('\n');
}

// What the provider sends. The MOPH Template card already shows the hospital logo (from CMS),
// the recipient name and the send time, so the card text skips those.
export type OutboundMessage = { name: string; title: string; text: string; html: string; notice?: Notice };
const escapeHtml = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function noticeCardText(n: Notice) {
  return [noticeLead(n), '', ...noticeRows(n).map(([icon, label, value]) => `${icon} ${label} : ${value}`), '', ...prepareLines(n), '', ...noticeFooter(n)].join('\n');
}
export function noticeHtml(n: Notice) {
  return `<div><strong>${escapeHtml(noticeTitle(n))}</strong><br/>${escapeHtml(noticeLead(n))}<br/>`
    + noticeRows(n).map(([, label, value]) => `<strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}`).join('<br/>')
    + (showsPreparation(n) ? `<br/><br/><strong>สิ่งที่ต้องนำมา:</strong> ${escapeHtml(NOTICE_PREPARE.join(', '))}` : '')
    + (showsPreparation(n) && noticePreparation(n).length ? `<br/><strong>การเตรียมตัวก่อนรับการตรวจ:</strong><br/>${noticePreparation(n).map(s => '- ' + escapeHtml(s)).join('<br/>')}` : '')
    + `<br/><br/>${noticeFooter(n).map(escapeHtml).join('<br/>')}</div>`;
}
export function noticeMessage(n: Notice): OutboundMessage {
  return { name: n.name, title: noticeTitle(n), text: noticeCardText(n), html: noticeHtml(n), notice: n };
}
export function plainMessage(text: string, title = 'แจ้งเตือนนัดตรวจสุขภาพ', name = ''): OutboundMessage {
  return { name, title, text, html: `<div>${escapeHtml(text).replace(/\n/g, '<br/>')}</div>` };
}

export const NOTICE_COLORS: Record<NoticeKind, string> = { NEW: '#0D5B44', MANUAL: '#0D5B44', REMINDER: '#B45309', CHANGED: '#1D4ED8', CANCELLED: '#B91C1C' };
export const NOTICE_TINTS: Record<NoticeKind, string> = { NEW: '#EAF4EF', MANUAL: '#EAF4EF', REMINDER: '#FDF3E7', CHANGED: '#EAF0FD', CANCELLED: '#FDECEC' };
const datePart = (day: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('th-TH', { ...options, timeZone: 'Asia/Bangkok' }).format(new Date(`${day}T00:00:00+07:00`));
const FILL = { position: 'absolute', offsetStart: '0px', offsetEnd: '0px' };

// Header: hospital name with the logo, then the title in large type. With a photo (public https URL) the
// photo fills the header and fades from clear at the top to the notice colour at the bottom, behind the text.
// Flex boxes cannot take a background image, so photo, gradient and text are stacked with absolute positioning.
function flexHeader(n: Notice, color: string, logoUrl?: string, photoUrl?: string) {
  const content = { type: 'box', layout: 'vertical', spacing: 'xs', contents: [
    ...(n.showBrand === false ? [] : [{ type: 'box', layout: 'horizontal', spacing: 'sm', alignItems: 'center', contents: [
      ...(logoUrl ? [{ type: 'box', layout: 'vertical', width: '28px', height: '28px', cornerRadius: '14px', backgroundColor: '#FFFFFF', flex: 0,
        contents: [{ type: 'image', url: logoUrl, size: 'full', aspectMode: 'cover', aspectRatio: '1:1' }] }] : []),
      { type: 'text', text: HOSPITAL_NAME, color: '#FFFFFF', size: 'xs', weight: 'bold', gravity: 'center' }] }]),
    { type: 'text', text: noticeTitle(n), color: '#FFFFFF', size: 'lg', weight: 'bold', wrap: true }] };
  if (!photoUrl) return { type: 'box', layout: 'vertical', backgroundColor: color, paddingAll: '16px', contents: [content] };
  return { type: 'box', layout: 'vertical', paddingAll: '0px', contents: [
    { type: 'image', url: photoUrl, size: 'full', aspectMode: 'cover', aspectRatio: '2:1' },
    { type: 'box', layout: 'vertical', ...FILL, offsetTop: '0px', offsetBottom: '0px', contents: [],
      background: { type: 'linearGradient', angle: '0deg', startColor: color, centerColor: `${color}CC`, centerPosition: '50%', endColor: `${color}00` } },
    { type: 'box', layout: 'vertical', ...FILL, offsetBottom: '0px', paddingStart: '16px', paddingEnd: '16px', paddingBottom: '12px', contents: [content] }] };
}

// Our own LINE Flex bubble (LINE Developers Flex Message spec). logoUrl and photoUrl must be public HTTPS.
// Kept short for a phone screen: date and time first in a tinted box, details as compact label/value rows,
// what to bring on one line, preparation steps only when there are any, notes in one footer line.
export function noticeFlex(n: Notice, logoUrl?: string, photoUrl?: string) {
  const color = NOTICE_COLORS[n.kind], steps = noticePreparation(n);
  const strike = n.kind === 'CANCELLED' ? { decoration: 'line-through' } : {};
  const when = { type: 'box', layout: 'horizontal', spacing: 'md', margin: 'md', backgroundColor: NOTICE_TINTS[n.kind], cornerRadius: '10px', paddingAll: '10px', alignItems: 'center', contents: [
    { type: 'box', layout: 'vertical', width: '48px', flex: 0, backgroundColor: color, cornerRadius: '8px', paddingTop: '4px', paddingBottom: '4px', contents: [
      { type: 'text', text: datePart(n.date, { day: 'numeric' }), size: 'xl', weight: 'bold', color: '#FFFFFF', align: 'center' },
      { type: 'text', text: datePart(n.date, { month: 'short', year: '2-digit' }), size: 'xxs', color: '#FFFFFF', align: 'center' }] },
    { type: 'box', layout: 'vertical', contents: [
      { type: 'text', text: thaiLongDate(n.date), size: 'sm', weight: 'bold', color: '#111827', wrap: true, ...strike },
      { type: 'text', text: n.time ? `${n.time.slice(0, 5)} น.` : 'โปรดติดต่อเจ้าหน้าที่เพื่อยืนยันเวลา', size: n.time ? 'lg' : 'xs', weight: 'bold', color, wrap: true, ...strike }] }] };
  // noticeRows starts with the date and time, which the box above already shows.
  const details = noticeRows(n).slice(2).map(([, label, value]) => ({ type: 'box', layout: 'horizontal', spacing: 'md', contents: [
    { type: 'text', text: label, size: 'xs', color: '#6B7280', flex: 2, wrap: true },
    { type: 'text', text: value, size: 'sm', color: '#111827', weight: 'bold', flex: 5, wrap: true }] }));
  const prepare = { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#FFF8EB', cornerRadius: '10px', paddingAll: '10px', spacing: 'xs', contents: [
    { type: 'text', wrap: true, size: 'xs', color: '#78350F', contents: [
      { type: 'span', text: 'สิ่งที่ต้องนำมา: ', weight: 'bold', color: '#92400E' }, { type: 'span', text: NOTICE_PREPARE.join(', ') }] },
    ...(steps.length ? [{ type: 'text', text: 'การเตรียมตัวก่อนรับการตรวจ', weight: 'bold', size: 'xs', color: '#92400E', margin: 'sm' },
      ...steps.map(text => ({ type: 'text', text: `• ${text}`, size: 'xs', color: '#78350F', wrap: true }))] : [])] };
  return {
    type: 'flex', altText: `${noticeTitle(n)} · ${thaiLongDate(n.date)}`,
    contents: { type: 'bubble', size: 'mega',
      header: flexHeader(n, color, logoUrl, photoUrl),
      body: { type: 'box', layout: 'vertical', paddingAll: '16px', contents: [
        { type: 'text', text: `เรียน คุณ${n.name}`, weight: 'bold', size: 'md', color: '#111827', wrap: true },
        { type: 'text', text: noticeLead(n), size: 'xs', color: '#6B7280', wrap: true },
        when,
        { type: 'box', layout: 'vertical', margin: 'md', spacing: 'sm', contents: details },
        ...(showsPreparation(n) ? [prepare] : [])] },
      footer: { type: 'box', layout: 'vertical', paddingAll: '10px', paddingStart: '16px', paddingEnd: '16px', backgroundColor: '#F7F9F8', contents: [
        { type: 'text', text: noticeFooter(n).join(' · '), size: 'xxs', color: '#6B7280', wrap: true }] },
      styles: { footer: { separator: true, separatorColor: '#EEF0F2' } },
    },
  };
}
