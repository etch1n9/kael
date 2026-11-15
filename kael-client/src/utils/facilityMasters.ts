import {
  FacilityBedClass,
  FacilityGuarantor,
  FacilityUnitConfig,
  SuperuserFacilityConfigSnapshot,
} from '../domain/simrs.ts';

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
