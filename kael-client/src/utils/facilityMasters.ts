import {
  FacilityBedClass,
  FacilityGuarantor,
  FacilityUnitConfig,
  SuperuserFacilityConfigSnapshot,
} from '../domain/simrs.ts';

export function snapshotForFacility<T extends { facilityCode: string; lifecycleStage?: string }>(
  history: T[] | undefined,
  active: T | null | undefined,
  facilityCode: string,
): T | undefined {
  return (
    history?.find((entry) => entry.facilityCode === facilityCode && entry.lifecycleStage === 'ACTIVE')
    || (active && active.facilityCode === facilityCode ? active : undefined)
  );
}

export const VISIT_UNIT_TYPES = ['RUANG_PRAKTIK', 'POLIKLINIK_SPESIALIS', 'IGD'] as const;

export const UNIT_DESTINATION_CHOICES = [
  'Poli Umum',
  'Poli Gigi',
  'KIA',
  'IGD',
  'Poli Anak',
  'Poli Kandungan',
  'Laboratorium',
] as const;

export const UNIT_TYPE_CHOICES: { code: FacilityUnitConfig['unitType']; label: string }[] = [
  { code: 'RUANG_PRAKTIK', label: 'Ruang praktik / poli' },
  { code: 'POLIKLINIK_SPESIALIS', label: 'Poliklinik spesialis' },
  { code: 'IGD', label: 'IGD' },
  { code: 'LABORATORIUM', label: 'Laboratorium' },
  { code: 'RADIOLOGI', label: 'Radiologi' },
  { code: 'BANGSAL_RANAP', label: 'Bangsal rawat inap' },
  { code: 'KAMAR_OPERASI', label: 'Kamar operasi' },
  { code: 'HEMODIALISIS', label: 'Hemodialisis' },
  { code: 'DEPO_FARMASI', label: 'Depo farmasi' },
  { code: 'INSTALASI_PENDUKUNG', label: 'Instalasi pendukung' },
];

export function unitTypeForDestination(name: string): FacilityUnitConfig['unitType'] {
  const normalized = name.trim().toLowerCase();
  if (normalized === 'igd') return 'IGD';
  if (normalized === 'laboratorium') return 'LABORATORIUM';
  if (normalized === 'poli umum' || normalized === 'kia') return 'RUANG_PRAKTIK';
  return 'POLIKLINIK_SPESIALIS';
}

export function masterCode(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
}

export function visitUnits(config?: Pick<SuperuserFacilityConfigSnapshot, 'units'> | null): FacilityUnitConfig[] {
  return (config?.units || []).filter(
    (unit) => unit.active && (VISIT_UNIT_TYPES as readonly string[]).includes(unit.unitType),
  );
}

export function activeGuarantors(config?: { guarantors?: FacilityGuarantor[] } | null): FacilityGuarantor[] {
  return (config?.guarantors || []).filter((entry) => entry.active);
}

export function activeBedClasses(config?: { bedClasses?: FacilityBedClass[] } | null): FacilityBedClass[] {
  return (config?.bedClasses || []).filter((entry) => entry.active);
}

export function unitLabel(units: FacilityUnitConfig[] | undefined, code: string): string {
  return units?.find((unit) => unit.unitCode === code)?.unitName || code.replace(/_/g, ' ');
}

export function guarantorLabel(payers: FacilityGuarantor[] | undefined, code: string): string {
  return payers?.find((entry) => entry.code === code)?.name || code.replace(/_/g, ' ');
}

export function bedClassLabel(classes: FacilityBedClass[] | undefined, code: string): string {
  return classes?.find((entry) => entry.code === code)?.name || code.replace(/_/g, ' ');
}
