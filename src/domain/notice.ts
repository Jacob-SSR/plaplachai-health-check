// Appointment notice sent to LINE หมอพร้อม. Plain text is always available; the Flex card is opt-in.
export type NoticeKind = 'NEW' | 'CHANGED' | 'REMINDER' | 'MANUAL';
export type Notice = { kind: NoticeKind; name: string; date: string; time: string | null; service: string; location: string; daysBefore?: number };

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
  if (n.kind === 'REMINDER') return `อีก ${n.daysBefore ?? 2} วันจะถึงวันนัดของท่าน`;
  if (n.kind === 'CHANGED') return 'นัดหมายของท่านมีการเปลี่ยนแปลง รายละเอียดใหม่ดังนี้';
  return 'ท่านมีนัดตรวจสุขภาพ รายละเอียดดังนี้';
}
export function noticeRows(n: Notice): [string, string, string][] {
  return [
    ['📅', 'วันที่', thaiLongDate(n.date)],
    ['⏰', 'เวลา', n.time ? `${n.time.slice(0, 5)} น.` : 'โปรดติดต่อเจ้าหน้าที่เพื่อยืนยันเวลา'],
    ['🩺', 'บริการ', n.service || '-'],
    ['📍', 'ติดต่อที่', n.location || HOSPITAL_NAME],
  ];
}
export const NOTICE_PREPARE = ['บัตรประจำตัวประชาชน'];
export const NOTICE_FOOTER = ['กรุณามาก่อนเวลานัด 15 นาที', 'หากไม่สะดวกหรือต้องการเลื่อนนัด โปรดติดต่อเจ้าหน้าที่'];

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
    `🪪 สิ่งที่ต้องนำมา : ${NOTICE_PREPARE.join(', ')}`,
    '',
    ...NOTICE_FOOTER.map(line => `• ${line}`),
  ].join('\n');
}

// What the provider sends. The MOPH Template card already shows the hospital logo (from CMS),
// the recipient name and the send time, so the card text skips those.
export type OutboundMessage = { name: string; title: string; text: string; html: string; notice?: Notice };
const escapeHtml = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function noticeCardText(n: Notice) {
  return [noticeLead(n), '', ...noticeRows(n).map(([icon, label, value]) => `${icon} ${label} : ${value}`), '', `🪪 สิ่งที่ต้องนำมา : ${NOTICE_PREPARE.join(', ')}`, '', ...NOTICE_FOOTER].join('\n');
}
export function noticeHtml(n: Notice) {
  return `<div><strong>${escapeHtml(noticeTitle(n))}</strong><br/>${escapeHtml(noticeLead(n))}<br/>`
    + noticeRows(n).map(([, label, value]) => `<strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}`).join('<br/>')
    + `<br/><br/><strong>สิ่งที่ต้องนำมา:</strong> ${escapeHtml(NOTICE_PREPARE.join(', '))}`
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
    { type: 'text', text: `${icon} ${label}`, size: 'sm', color: '#6B7280', flex: 3 },
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
          ...NOTICE_PREPARE.map(item => ({ type: 'text', text: `• ${item}`, size: 'sm', color: '#78350F', wrap: true }))] }] },
      footer: { type: 'box', layout: 'vertical', spacing: 'xs', paddingAll: '14px', backgroundColor: '#F7F9F8', contents:
        NOTICE_FOOTER.map(text => ({ type: 'text', text: `• ${text}`, size: 'xs', color: '#6B7280', wrap: true })) },
    },
  };
}
