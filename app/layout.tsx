import type { Metadata } from 'next';
import '@fontsource/sarabun/400.css';
import '@fontsource/sarabun/600.css';
import '@fontsource/noto-sans-thai/500.css';
import '@fontsource/noto-sans-thai/600.css';
import './globals.css';
export const metadata: Metadata = { title:'ตารางตรวจสุขภาพ · โรงพยาบาลพลับพลาชัย',description:'ระบบจัดการนัดตรวจสุขภาพบุคลากร',robots:{index:false,follow:false},icons:{icon:'/hospital-logo.png',apple:'/hospital-logo.png'} };
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="th"><body>{children}</body></html>;}
