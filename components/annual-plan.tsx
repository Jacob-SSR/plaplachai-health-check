import { Select,s,type Item } from './ui';
export const serviceTone=(name:string,index:number)=>({'ทันตกรรม':'service-dental','แผนไทย':'service-thai','กายภาพ':'service-physical','ตรวจเลือด':'service-blood'}[name]??`tone-${index%4}`);

export function AnnualPlan({plans,value,onChange,name,disabled=false}:{plans:Item[];value:string;onChange:(value:string)=>void;name?:string;disabled?:boolean}){
  if(plans.length===1)return <label>ปีที่จัดตารางตรวจ<input readOnly value={s(plans[0].name)}/>{name&&<input type="hidden" name={name} value={value}/>}</label>;
  if(!plans.length)return <p className="helper" role="status">ยังไม่มีบริการประจำปี กรุณาอัปเดตฐานข้อมูลด้วย db:migrate แล้วโหลดหน้านี้ใหม่</p>;
  return <Select label="ชุดตรวจประจำปี" name={name} options={plans} value={value} onChange={e=>onChange(e.target.value)} required disabled={disabled}/>;
}

export function ServiceLegend(){return <div className="service-legend" aria-label="บริการประจำทั้ง 4 รายการ"><span className="service-dental">ทันตกรรม</span><span className="service-thai">แผนไทย</span><span className="service-physical">กายภาพ</span><span className="service-blood">ตรวจเลือด</span></div>;}
