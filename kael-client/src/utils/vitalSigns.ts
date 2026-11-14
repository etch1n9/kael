import type { VitalSigns } from '../domain/simrs.ts';

export const VITAL_KEYS = [
  'systolic', 'diastolic', 'heartRate', 'respiratoryRate', 'temperature', 'spo2',
  'weightKg', 'heightCm', 'gcsEye', 'gcsVerbal', 'gcsMotor', 'painScale',
] as const;

export function blankVitals(): VitalSigns {
  return Object.fromEntries(VITAL_KEYS.map((key) => [key, Number.NaN])) as unknown as VitalSigns;
}

export function hasCompleteVitals(vitals: VitalSigns): boolean {
  return VITAL_KEYS.every((key) => Number.isFinite(vitals[key]))
    && VITAL_KEYS.filter((key) => key !== 'painScale').every((key) => vitals[key] > 0)
    && [vitals.gcsEye, vitals.gcsVerbal, vitals.gcsMotor, vitals.painScale].every(Number.isInteger)
    && vitals.gcsEye <= 4 && vitals.gcsVerbal <= 5 && vitals.gcsMotor <= 6
    && vitals.painScale >= 0 && vitals.painScale <= 10;
}
