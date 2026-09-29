// HOSxP depcodes verified against the supplied kskdepartment export.
export const HOSXP_ROOMS = [
  { code: '033', name: 'กายภาพบำบัด' },
  { code: '006', name: 'LAB' },
  { code: '019', name: 'ทันตกรรม' },
  { code: '023', name: 'แพทย์แผนไทย' },
] as const;
export function hosxpRoom(code: unknown) {
  return HOSXP_ROOMS.find(room => room.code === code);
}
