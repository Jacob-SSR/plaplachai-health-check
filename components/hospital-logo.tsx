import Image from 'next/image';

export function HospitalLogo() {
  return <Image className="hospital-logo" src="/hospital-logo.png" alt="ตราโรงพยาบาลพลับพลาชัย" width={44} height={44} sizes="44px" loading="eager" />;
}
