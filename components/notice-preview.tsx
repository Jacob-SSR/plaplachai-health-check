'use client';
import { useState } from 'react';
import { HOSPITAL_NAME, NOTICE_FOOTER, noticeLead, noticeRows, noticeTitle, type Notice, type NoticeKind } from '@/src/domain/notice';

const SAMPLE: Omit<Notice, 'kind'> = { name: 'ตัวอย่าง บุคลากร', date: '2027-01-29', time: '08:30:00', service: 'แพทย์แผนไทย', location: 'ห้องบัตร', daysBefore: 2 };
const KINDS: [NoticeKind, string][] = [['NEW', 'ลงนัดครั้งแรก'], ['REMINDER', 'ก่อนวันนัด 2 วัน'], ['CHANGED', 'เลื่อนนัด'], ['MANUAL', 'กดส่งเอง']];

// Same layout as noticeFlex(): header with hospital logo, name box, details, notes.
export function NoticeCard({ notice }: { notice: Notice }) {
  return <div className={`notice-card kind-${notice.kind.toLowerCase()}`}>
    <div className="notice-card-head"><span className="notice-card-logo"><img src="/hospital-logo.png" alt="" width={44} height={44}/* eslint-disable-line @next/next/no-img-element *//></span>
      <div><small>{HOSPITAL_NAME}</small><strong>{noticeTitle(notice)}</strong></div></div>
    <div className="notice-card-body">
      <div className="notice-card-name">คุณ{notice.name}</div>
      <p className="notice-card-lead">{noticeLead(notice)}</p>
      <dl>{noticeRows(notice).map(([icon, label, value]) => <div key={label}><dt>{icon} {label}</dt><dd>{value}</dd></div>)}</dl>
    </div>
    <ul className="notice-card-foot">{NOTICE_FOOTER.map(line => <li key={line}>{line}</li>)}</ul>
  </div>;
}

export function NoticePreview() {
  const [kind, setKind] = useState<NoticeKind>('NEW');
  return <section className="surface padded" aria-label="ตัวอย่างข้อความแจ้งเตือน"><div className="section-head"><div>
    <h3>ตัวอย่างข้อความที่บุคลากรได้รับใน LINE หมอพร้อม</h3>
    <p className="helper">การ์ด LINE Flex ที่ออกแบบเอง ส่งผ่าน MOPH Alert · ถ้า MOPH ไม่รับการ์ดนี้ ระบบจะส่งเป็นการ์ดมาตรฐานของ MOPH แทน</p></div></div>
    <div className="subnav">{KINDS.map(([k, label]) => <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</button>)}</div>
    <div className="notice-preview"><NoticeCard notice={{ ...SAMPLE, kind }}/>
      <div className="notice-when"><h4>ส่งเมื่อไหร่</h4><ul>
        <li><strong>ลงนัดครั้งแรก</strong> ส่งทันทีเมื่อ worker พบนัดใหม่ใน HOSxP</li>
        <li><strong>เลื่อนนัด</strong> ส่งทันทีเมื่อวัน เวลา หรือจุดติดต่อเปลี่ยน</li>
        <li><strong>ก่อนวันนัด 2 วัน</strong> ส่งตามเวลาที่ตั้ง (ค่าเริ่มต้น 08:00 น.)</li>
        <li><strong>กดส่งเอง</strong> กดในเว็บนี้ ไม่ต้องทำใน HOSxP: ปุ่ม “ส่งแจ้งเตือน” ท้ายแถวในเมนูนัดหมายจาก HOSxP หรือในรายละเอียดนัดบนปฏิทิน ส่งทันที</li>
      </ul></div></div>
  </section>;
}
