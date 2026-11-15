import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  FacilityBedClass,
  FacilityGuarantor,
  FacilityUnitConfig,
  SuperuserFacilityConfigSnapshot,
} from '../domain/simrs.ts';
import { kaelApi, WorkspacePayload } from '../utils/apiClient';
import { UNIT_DESTINATION_CHOICES, UNIT_TYPE_CHOICES, masterCode, unitTypeForDestination } from '../utils/facilityMasters';
import { buildDefaultFacilityConfigSnapshot } from '../domain/platformEngine.ts';

interface FacilityMastersPanelProps {
  token: string;
  facilityCode: string;
  snapshot: SuperuserFacilityConfigSnapshot;
  onSaved: () => Promise<void>;
}

export const FacilityMastersPanel: React.FC<FacilityMastersPanelProps> = ({
  token,
  facilityCode,
  snapshot,
  onSaved,
}) => {
  const [units, setUnits] = useState<FacilityUnitConfig[]>(snapshot.units || []);
  const [guarantors, setGuarantors] = useState<FacilityGuarantor[]>(snapshot.guarantors || []);
  const [bedClasses, setBedClasses] = useState<FacilityBedClass[]>(snapshot.bedClasses || []);
  const [unitChoice, setUnitChoice] = useState('');
  const [customUnitName, setCustomUnitName] = useState('');
  const [customUnitType, setCustomUnitType] = useState<FacilityUnitConfig['unitType']>('RUANG_PRAKTIK');
  const [payerName, setPayerName] = useState('');
  const [payerBpjs, setPayerBpjs] = useState(false);
  const [className, setClassName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const addUnit = () => {
    const name = (unitChoice === 'CUSTOM' ? customUnitName : unitChoice).trim();
    if (!name) return setError(unitChoice === 'CUSTOM' ? 'Isi nama unit tujuan.' : 'Pilih unit tujuan.');
    const code = masterCode(name);
    if (!code) return setError('Nama unit tujuan tidak valid.');
    if (units.some((unit) => unit.unitCode === code || unit.unitName.toLowerCase() === name.toLowerCase())) {
      return setError('Unit tujuan itu sudah ada.');
    }
    setUnits((current) => [...current, {
      unitCode: code,
      unitName: name,
      unitType: unitChoice === 'CUSTOM' ? customUnitType : unitTypeForDestination(name),
      costCenterCode: '',
      active: true,
    }]);
    setUnitChoice('');
    setCustomUnitName('');
    setError(null);
  };
  const addPayer = () => {
    const code = masterCode(payerName);
    if (!code) return setError('Isi nama penjamin.');
    if (guarantors.some((entry) => entry.code === code)) return setError('Nama penjamin itu sudah ada.');
    setGuarantors((current) => [...current, { code, name: payerName.trim(), settlement: payerBpjs ? 'BPJS' : 'PATIENT', active: true }]);
    setPayerName('');
    setPayerBpjs(false);
    setError(null);
  };
  const addClass = () => {
    const code = masterCode(className);
    if (!code) return setError('Isi nama kelas kamar.');
    if (bedClasses.some((entry) => entry.code === code)) return setError('Nama kelas itu sudah ada.');
    setBedClasses((current) => [...current, { code, name: className.trim(), active: true }]);
    setClassName('');
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await kaelApi.superuserPublishFacilityConfig(token, facilityCode, facilityCode, {
        units,
        guarantors,
        bedClasses,
        changeNotes: 'Master unit, penjamin, dan kelas kamar diperbarui superuser.',
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Master belum tersimpan.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#E2ECE8] bg-white p-4 dark:border-[#183831] dark:bg-[#0B211D] sm:p-5">
        <h2 className="text-sm font-bold text-[#0F2922] dark:text-white">Master yang dipakai akun lain</h2>
        <p className="mt-1 text-xs leading-relaxed text-[#52736B] dark:text-[#86B5A9]">
          Tidak ada unit, penjamin, atau kelas kamar bawaan. Superuser yang membuat semuanya di sini, lalu simpan. Pendaftaran dan rawat inap hanya menampilkan daftar aktif.
        </p>
      </div>

      <section className="rounded-2xl border border-[#E2ECE8] bg-white p-4 dark:border-[#183831] dark:bg-[#0B211D] sm:p-5">
        <h3 className="text-sm font-bold">Unit Tujuan</h3>
        <p className="mt-1 text-xs text-[#52736B] dark:text-[#86B5A9]">Pilihan yang dipilih langsung menjadi nama di pendaftaran. Custom hanya untuk nama yang tidak ada di daftar, dan yang tampil tetap nama itu saja.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <select value={unitChoice} onChange={(event) => setUnitChoice(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950">
            <option value="">Pilih unit tujuan</option>
            {UNIT_DESTINATION_CHOICES.map((name) => <option key={name} value={name}>{name}</option>)}
            <option value="CUSTOM">Custom</option>
          </select>
          <button type="button" onClick={addUnit} className="inline-flex items-center justify-center gap-1 rounded-lg bg-[#00897B] px-3 py-2 text-xs font-semibold text-white"><Plus className="h-3.5 w-3.5" />Tambah</button>
        </div>
        {unitChoice === 'CUSTOM' && (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <input value={customUnitName} onChange={(event) => setCustomUnitName(event.target.value)} placeholder="Nama unit tujuan" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950" />
            <select value={customUnitType} onChange={(event) => setCustomUnitType(event.target.value as FacilityUnitConfig['unitType'])} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950">
              {UNIT_TYPE_CHOICES.map((choice) => <option key={choice.code} value={choice.code}>{choice.label}</option>)}
            </select>
          </div>
        )}
        <MasterList
          empty="Belum ada unit tujuan."
          rows={units.map((unit) => ({
            key: unit.unitCode,
            title: unit.unitName,
            meta: '',
            active: unit.active,
            onToggle: () => setUnits((current) => current.map((entry) => entry.unitCode === unit.unitCode ? { ...entry, active: !entry.active } : entry)),
            onRemove: () => setUnits((current) => current.filter((entry) => entry.unitCode !== unit.unitCode)),
          }))}
        />
      </section>

      <section className="rounded-2xl border border-[#E2ECE8] bg-white p-4 dark:border-[#183831] dark:bg-[#0B211D] sm:p-5">
        <h3 className="text-sm font-bold">Penjamin</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <input value={payerName} onChange={(event) => setPayerName(event.target.value)} placeholder="Nama penjamin, misalnya Umum atau BPJS" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950" />
          <label className="flex items-center gap-2 text-xs font-semibold">
            <input type="checkbox" checked={payerBpjs} onChange={(event) => setPayerBpjs(event.target.checked)} />
            Klaim BPJS
          </label>
          <button type="button" onClick={addPayer} className="inline-flex items-center justify-center gap-1 rounded-lg bg-[#00897B] px-3 py-2 text-xs font-semibold text-white"><Plus className="h-3.5 w-3.5" />Tambah</button>
        </div>
        <MasterList
          empty="Belum ada penjamin."
          rows={guarantors.map((entry) => ({
            key: entry.code,
            title: entry.name,
            meta: entry.settlement === 'BPJS' ? 'Klaim BPJS' : 'Dibayar pasien / pihak lain',
            active: entry.active,
            onToggle: () => setGuarantors((current) => current.map((item) => item.code === entry.code ? { ...item, active: !item.active } : item)),
            onRemove: () => setGuarantors((current) => current.filter((item) => item.code !== entry.code)),
          }))}
        />
      </section>

      <section className="rounded-2xl border border-[#E2ECE8] bg-white p-4 dark:border-[#183831] dark:bg-[#0B211D] sm:p-5">
        <h3 className="text-sm font-bold">Kelas kamar</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <input value={className} onChange={(event) => setClassName(event.target.value)} placeholder="Nama kelas, misalnya Kelas 1 atau VIP" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950" />
          <button type="button" onClick={addClass} className="inline-flex items-center justify-center gap-1 rounded-lg bg-[#00897B] px-3 py-2 text-xs font-semibold text-white"><Plus className="h-3.5 w-3.5" />Tambah</button>
        </div>
        <MasterList
          empty="Belum ada kelas kamar."
          rows={bedClasses.map((entry) => ({
            key: entry.code,
            title: entry.name,
            meta: entry.code,
            active: entry.active,
            onToggle: () => setBedClasses((current) => current.map((item) => item.code === entry.code ? { ...item, active: !item.active } : item)),
            onRemove: () => setBedClasses((current) => current.filter((item) => item.code !== entry.code)),
          }))}
        />
      </section>

      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>}
      <button type="button" disabled={saving} onClick={() => void save()} className="rounded-xl bg-[#0F2922] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
        {saving ? 'Menyimpan…' : 'Simpan master untuk akun lain'}
      </button>
    </div>
  );
};

export function FacilityMastersGate({
  token,
  facilityCode,
  workspace,
  onSaved,
}: {
  token: string;
  facilityCode: string;
  workspace: WorkspacePayload;
  onSaved: () => Promise<void>;
}) {
  const facilities = (workspace.allFacilities || []).filter((facility) => facility.active);
  const [chosen, setChosen] = useState(facilityCode || facilities[0]?.code || '');
  const facility = facilities.find((entry) => entry.code === chosen);
  const stored = (workspace.facilityConfigHistory || []).find(
    (entry) => entry.facilityCode === chosen && entry.lifecycleStage === 'ACTIVE',
  );
  const snapshot = facilityCode && workspace.activeFacilityConfig?.facilityCode === facilityCode
    ? workspace.activeFacilityConfig
    : stored || (facility ? buildDefaultFacilityConfigSnapshot(facility) : null);
  if (!facilities.length) {
    return <p className="rounded-xl border border-[#D5E3DF] bg-white p-4 text-sm dark:bg-[#0B211D]">Buat fasilitas dulu. Master unit mengikuti fasilitas, bukan akun superuser.</p>;
  }
  return (
    <div className="space-y-4">
      <label className="block text-sm font-semibold">
        Fasilitas
        <select value={chosen} onChange={(event) => setChosen(event.target.value)} className="mt-1 w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">
          {facilities.map((entry) => <option key={entry.code} value={entry.code}>{entry.name}</option>)}
        </select>
      </label>
      {snapshot && (
        <FacilityMastersPanel
          key={`${chosen}-${snapshot.configVersion}-${snapshot.publishedAt}`}
          token={token}
          facilityCode={chosen}
          snapshot={snapshot}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

function MasterList({ rows, empty }: {
  empty: string;
  rows: { key: string; title: string; meta: string; active: boolean; onToggle: () => void; onRemove: () => void }[];
}) {
  if (rows.length === 0) return <p className="mt-3 text-xs text-[#52736B] dark:text-[#86B5A9]">{empty}</p>;
  return (
    <ul className="mt-3 divide-y divide-[#E2ECE8] dark:divide-[#183831]">
      {rows.map((row) => (
        <li key={row.key} className="flex items-center gap-3 py-2 text-xs">
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-[#0F2922] dark:text-white">{row.title}</p>
            {row.meta ? <p className="truncate text-[#52736B] dark:text-[#86B5A9]">{row.meta}</p> : null}
          </div>
          <button type="button" onClick={row.onToggle} className="rounded-lg px-2 py-1 font-semibold text-[#00897B]">{row.active ? 'Aktif' : 'Nonaktif'}</button>
          <button type="button" onClick={row.onRemove} aria-label={`Hapus ${row.title}`} className="rounded-lg p-1.5 text-red-700"><Trash2 className="h-3.5 w-3.5" /></button>
        </li>
      ))}
    </ul>
  );
}
