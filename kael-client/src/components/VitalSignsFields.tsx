import React, { useId } from 'react';
import type { VitalSigns } from '../domain/simrs.ts';

const fields = [
  { key: 'systolic', label: 'Sistolik mmHg', step: '1' },
  { key: 'diastolic', label: 'Diastolik mmHg', step: '1' },
  { key: 'heartRate', label: 'Nadi bpm', step: '1' },
  { key: 'respiratoryRate', label: 'Napas per menit', step: '1' },
  { key: 'temperature', label: 'Suhu °C', step: '0.1' },
  { key: 'spo2', label: 'SpO2 %', step: '1' },
  { key: 'weightKg', label: 'Berat kg', step: '0.1' },
  { key: 'heightCm', label: 'Tinggi cm', step: '0.1' },
  { key: 'gcsEye', label: 'GCS mata (1–4)', step: '1' },
  { key: 'gcsVerbal', label: 'GCS verbal (1–5)', step: '1' },
  { key: 'gcsMotor', label: 'GCS motorik (1–6)', step: '1' },
  { key: 'painScale', label: 'Skala nyeri (0–10)', step: '1' },
] as const;

export function VitalSignsFields({ value, onChange }: { value: VitalSigns; onChange: (value: VitalSigns) => void }) {
  const prefix = useId();
  return (
    <div className="grid min-w-0 [&>*]:min-w-0 grid-cols-2 sm:grid-cols-4 gap-2.5">
      {fields.map((field) => (
        <div key={field.key}>
          <label htmlFor={`${prefix}-${field.key}`} className="block text-caption text-slate-500 mb-0.5">{field.label}</label>
          <input
            id={`${prefix}-${field.key}`}
            type="number"
            step={field.step}
            required
            value={Number.isFinite(value[field.key]) ? value[field.key] : ''}
            onChange={(event) => onChange({ ...value, [field.key]: event.target.value === '' ? Number.NaN : Number(event.target.value) })}
            className="min-w-0 w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
          />
        </div>
      ))}
    </div>
  );
}
