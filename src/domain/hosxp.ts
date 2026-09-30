// HOSxP depcodes verified against the supplied kskdepartment export.
export const HOSXP_ROOMS = [
  { code: '033', name: 'กายภาพบำบัด' },
  { code: '006', name: 'LAB' },
  { code: '019', name: 'ทันตกรรม' },
  { code: '023', name: 'แพทย์แผนไทย' },
] as const;
export const LAB_ROOM = '006';
export function hosxpRoom(code: unknown) {
  return HOSXP_ROOMS.find(room => room.code === code);
}
// Many appointments (especially older ones) have no depcode, only a clinic (e.g. 027 กายภาพบำบัด,
// 041 IMC กายภาพ, 026 แพทย์แผนไทย). Map them to the same room by clinic name.
const CLINIC_ROOMS: [RegExp, string][] = [[/กายภาพ/, '033'], [/แผนไทย|แพทย์แผน/, '023'], [/ทันต/, '019']];
export function roomForAppointment(depcode: unknown, clinicName: unknown) {
  const byDepcode = hosxpRoom(depcode);
  if (byDepcode) return byDepcode;
  const name = typeof clinicName === 'string' ? clinicName : '';
  const match = CLINIC_ROOMS.find(([re]) => re.test(name));
  return match ? hosxpRoom(match[1]) : undefined;
}
