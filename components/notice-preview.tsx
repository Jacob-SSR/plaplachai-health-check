'use client';
import { useState } from 'react';
import { HOSPITAL_NAME, noticeFooter, showsPreparation, NOTICE_PREPARE, noticePreparation, noticeLead, noticeRows, noticeTitle, thaiLongDate, type Notice, type NoticeKind } from '@/src/domain/notice';

const SAMPLE: Omit<Notice, 'kind'> = { name: 'ตัวอย่าง บุคลากร', date: '2027-01-29', time: '08:30:00', service: 'แพทย์แผนไทย', location: 'ห้องบัตร', daysBefore: 2 };
const LAB_SAMPLE: Omit<Notice, 'kind'> = { ...SAMPLE, service: 'LAB', location: 'ห้องปฏิบัติการ', tests: ['CBC', 'FBS', 'Cholesterol', 'Triglyceride', 'Creatinine', 'UA'] };
const KINDS: [NoticeKind, string][] = [['NEW', 'ลงนัดครั้งแรก'], ['REMINDER', 'ก่อนวันนัด 2 วัน'], ['CHANGED', 'เลื่อนนัด'], ['MANUAL', 'กดส่งเอง'], ['CANCELLED', 'ยกเลิกนัด']];

// Same layout as noticeFlex(): photo header fading into the notice colour, date box, detail rows, notes.
const datePart = (day: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('th-TH', { ...options, timeZone: 'Asia/Bangkok' }).format(new Date(`${day}T00:00:00+07:00`));
export function NoticeCard({ notice }: { notice: Notice }) {
  const steps = noticePreparation(notice), cancelled = notice.kind === 'CANCELLED';
  return <div className={`notice-card kind-${notice.kind.toLowerCase()}`}>
    <div className="nc-head"><div className="nc-head-text">
      {notice.showBrand !== false && <span className="nc-org"><img src="/hospital-logo.png" alt="" width={28} height={28}/* eslint-disable-line @next/next/no-img-element */ />{HOSPITAL_NAME}</span>}
      <strong>{noticeTitle(notice)}</strong></div></div>
    <div className="nc-body">
      <p className="nc-greet">เรียน คุณ{notice.name}</p>
      <p className="nc-lead">{noticeLead(notice)}</p>
      <div className={`nc-when${cancelled ? ' struck' : ''}`}><span className="nc-tile"><b>{datePart(notice.date, { day: 'numeric' })}</b>{datePart(notice.date, { month: 'short', year: '2-digit' })}</span>
        <span><span className="nc-date">{thaiLongDate(notice.date)}</span><span className="nc-time">{notice.time ? `${notice.time.slice(0, 5)} น.` : 'โปรดติดต่อเจ้าหน้าที่เพื่อยืนยันเวลา'}</span></span></div>
      <dl className="nc-rows">{noticeRows(notice).slice(2).map(([, label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {showsPreparation(notice) && <div className="nc-prepare"><p><strong>สิ่งที่ต้องนำมา:</strong> {NOTICE_PREPARE.join(', ')}</p>
        {steps.length > 0 && <><strong>การเตรียมตัวก่อนรับการตรวจ</strong><ul>{steps.map(item => <li key={item}>{item}</li>)}</ul></>}</div>}
    </div>
    <p className="nc-foot">{noticeFooter(notice).join(' · ')}</p>
  </div>;
}

export function NoticePreview({ showBrand = true }: { showBrand?: boolean }) {
  const [kind, setKind] = useState<NoticeKind>('NEW'), [lab, setLab] = useState(false);
  return <section className="surface padded" aria-label="ตัวอย่างข้อความแจ้งเตือน"><div className="section-head"><div>
    <h3>ตัวอย่างข้อความที่บุคลากรได้รับใน LINE หมอพร้อม</h3>
    <p className="helper">การ์ด LINE Flex ที่ออกแบบเอง ส่งผ่าน MOPH Alert · ถ้า MOPH ไม่รับการ์ดนี้ ระบบจะส่งเป็นการ์ดมาตรฐานของ MOPH แทน</p></div></div>
    <div className="subnav">{KINDS.map(([k, label]) => <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</button>)}<button aria-pressed={lab} onClick={() => setLab(v => !v)}>ตัวอย่างนัด LAB</button></div>
    <div className="notice-preview"><NoticeCard notice={{ ...(lab ? LAB_SAMPLE : SAMPLE), kind, showBrand }}/>
      <div className="notice-when"><h4>ส่งเมื่อไหร่</h4><ul>
        <li><strong>ลงนัดครั้งแรก</strong> ส่งทันทีเมื่อ worker พบนัดใหม่ใน HOSxP</li>
        <li><strong>เลื่อนนัด</strong> ส่งทันทีเมื่อวัน เวลา หรือจุดติดต่อเปลี่ยน</li>
        <li><strong>ก่อนวันนัด 2 วัน</strong> ส่งตามเวลาที่ตั้ง (ค่าเริ่มต้น 08:00 น.)</li>
        <li><strong>ยกเลิกนัด</strong> ส่งทันทีเมื่อนัดที่ยังไม่ถึงวันถูกลบหรือเปลี่ยนเป็นสถานะยกเลิกใน HOSxP</li>
        <li><strong>กดส่งเอง</strong> กดในเว็บนี้ ไม่ต้องทำใน HOSxP: ปุ่ม “ส่งแจ้งเตือน” ท้ายแถวในเมนูนัดหมายจาก HOSxP หรือในรายละเอียดนัดบนปฏิทิน ส่งทันที</li>
      </ul></div></div>
  </section>;
}
