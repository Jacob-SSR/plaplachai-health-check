// Appointment notice sent to LINE หมอพร้อม. Plain text is always available; the Flex card is opt-in.
export type NoticeKind = 'NEW' | 'CHANGED' | 'REMINDER' | 'MANUAL';
export type Notice = { kind: NoticeKind; name: string; date: string; time: string | null; service: string; location: string; daysBefore?: number;
  /** LAB items from HOSxP (ticked note2 + LAB order form) */ tests?: string[];
  /** Preparation instructions ticked in HOSxP (note1), hospital wording */ preparation?: string[] };

export const HOSPITAL_NAME = 'โรงพยาบาลพลับพลาชัย';
const TITLES: Record<NoticeKind, string> = {
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

function prepareLines(n: Notice) {
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
    ...NOTICE_FOOTER.map(line => `• ${line}`),
  ].join('\n');
}

// What the provider sends. The MOPH Template card already shows the hospital logo (from CMS),
// the recipient name and the send time, so the card text skips those.
export type OutboundMessage = { name: string; title: string; text: string; html: string; notice?: Notice };
const escapeHtml = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function noticeCardText(n: Notice) {
  return [noticeLead(n), '', ...noticeRows(n).map(([icon, label, value]) => `${icon} ${label} : ${value}`), '', ...prepareLines(n), '', ...NOTICE_FOOTER].join('\n');
}
export function noticeHtml(n: Notice) {
  return `<div><strong>${escapeHtml(noticeTitle(n))}</strong><br/>${escapeHtml(noticeLead(n))}<br/>`
    + noticeRows(n).map(([, label, value]) => `<strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}`).join('<br/>')
    + `<br/><br/><strong>สิ่งที่ต้องนำมา:</strong> ${escapeHtml(NOTICE_PREPARE.join(', '))}`
    + (noticePreparation(n).length ? `<br/><strong>การเตรียมตัวก่อนรับการตรวจ:</strong><br/>${noticePreparation(n).map(s => '- ' + escapeHtml(s)).join('<br/>')}` : '')
    + `<br/><br/>${NOTICE_FOOTER.map(escapeHtml).join('<br/>')}</div>`;
}
export function noticeMessage(n: Notice): OutboundMessage {
  return { name: n.name, title: noticeTitle(n), text: noticeCardText(n), html: noticeHtml(n), notice: n };
}
export function plainMessage(text: string, title = 'แจ้งเตือนนัดตรวจสุขภาพ', name = ''): OutboundMessage {
  return { name, title, text, html: `<div>${escapeHtml(text).replace(/\n/g, '<br/>')}</div>` };
}

export const NOTICE_COLORS: Record<NoticeKind, string> = { NEW: '#0D5B44', MANUAL: '#0D5B44', REMINDER: '#B45309', CHANGED: '#1D4ED8' };
// Our own LINE Flex bubble (designed per LINE Developers Flex Message spec).
// logoUrl must be public HTTPS; without it the header shows text only.
export function noticeFlex(n: Notice, logoUrl?: string) {
  const color = NOTICE_COLORS[n.kind];
  const row = ([icon, label, value]: [string, string, string]) => ({ type: 'box', layout: 'horizontal', spacing: 'md', contents: [
    { type: 'text', text: `${icon} ${label}`, size: 'sm', color: '#6B7280', flex: 3, wrap: true },
    { type: 'text', text: value, size: 'sm', color: '#111827', weight: 'bold', wrap: true, flex: 6 }] });
  return {
    type: 'flex', altText: `${noticeTitle(n)} · ${thaiLongDate(n.date)}`,
    contents: { type: 'bubble', size: 'mega',
      header: { type: 'box', layout: 'horizontal', spacing: 'lg', backgroundColor: color, paddingAll: '18px', contents: [
        ...(logoUrl ? [{ type: 'box', layout: 'vertical', width: '52px', height: '52px', cornerRadius: '26px', backgroundColor: '#FFFFFF', paddingAll: '4px', flex: 0,
          contents: [{ type: 'image', url: logoUrl, size: 'full', aspectMode: 'fit', aspectRatio: '1:1' }] }] : []),
        { type: 'box', layout: 'vertical', justifyContent: 'center', contents: [
          { type: 'text', text: HOSPITAL_NAME, color: '#FFFFFFCC', size: 'xs' },
          { type: 'text', text: noticeTitle(n), color: '#FFFFFF', weight: 'bold', size: 'lg', wrap: true }] }] },
      body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '18px', contents: [
        { type: 'box', layout: 'vertical', backgroundColor: '#EEF4F1', cornerRadius: '10px', paddingAll: '12px', contents: [
          { type: 'text', text: `คุณ${n.name}`, weight: 'bold', size: 'md', align: 'center', wrap: true, color: '#0F3D2E' }] },
        { type: 'text', text: noticeLead(n), size: 'sm', color: '#374151', wrap: true },
        { type: 'separator', margin: 'md' },
        { type: 'box', layout: 'vertical', spacing: 'sm', margin: 'md', contents: noticeRows(n).map(row) },
        { type: 'box', layout: 'vertical', margin: 'lg', backgroundColor: '#FFF7E6', cornerRadius: '10px', paddingAll: '12px', spacing: 'xs', contents: [
          { type: 'text', text: '🪪 สิ่งที่ต้องนำมา', weight: 'bold', size: 'sm', color: '#92400E' },
          ...NOTICE_PREPARE.map(item => ({ type: 'text', text: `• ${item}`, size: 'sm', color: '#78350F', wrap: true })),
          ...(noticePreparation(n).length ? [{ type: 'text', text: '📝 การเตรียมตัวก่อนรับการตรวจ', weight: 'bold', size: 'sm', color: '#92400E', margin: 'md' },
            ...noticePreparation(n).map(item => ({ type: 'text', text: `• ${item}`, size: 'sm', color: '#78350F', wrap: true }))] : [])] }] },
      footer: { type: 'box', layout: 'vertical', spacing: 'xs', paddingAll: '14px', backgroundColor: '#F7F9F8', contents:
        NOTICE_FOOTER.map(text => ({ type: 'text', text: `• ${text}`, size: 'xs', color: '#6B7280', wrap: true })) },
    },
  };
}
