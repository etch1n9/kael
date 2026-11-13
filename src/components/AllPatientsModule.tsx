import React, { useMemo, useState } from 'react';
import {
  Users,
  Search,
  Calendar,
  Filter,
  UserPlus,
  Edit3,
  Stethoscope,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  X,
  RotateCcw,
} from 'lucide-react';
import {
  Facility,
  ModuleKey,
  Patient,
  SoapRecord,
  UserAccount,
  VisitQueueItem,
} from '../types/simrs';
import { calculateAgeYears } from '../utils/clinicalLogic';
import { kaelApi } from '../utils/apiClient';
import { DataExportToolbar } from './DataExportToolbar';
import { ExportColumn } from '../utils/exportDocument';

interface AllPatientsModuleProps {
  token: string;
  activeFacility: Facility;
  patients: Patient[];
  visits: VisitQueueItem[];
  soapRecords: SoapRecord[];
  doctors: UserAccount[];
  onRefreshWorkspace: () => Promise<void>;
  onNavigateModule: (module: ModuleKey, visitId?: string) => void;
}

type RegDateFilter = 'SEMUA' | 'HARI_INI' | '7_HARI' | 'BULAN_INI' | 'RENTANG';
type VisitDateFilter =
  | 'SEMUA'
  | 'DATANG_HARI_INI'
  | 'DATANG_7_HARI'
  | 'DATANG_BULAN_INI'
  | 'RENTANG_KUNJUNGAN'
  | 'BELUM_PERNAH';

export function AllPatientsModule({
  token,
  activeFacility,
  patients,
  visits,
  soapRecords,
  doctors,
  onRefreshWorkspace,
  onNavigateModule,
}: AllPatientsModuleProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [regFilter, setRegFilter] = useState<RegDateFilter>('SEMUA');
  const [regStartDate, setRegStartDate] = useState('');
  const [regEndDate, setRegEndDate] = useState('');

  const [visitFilter, setVisitFilter] = useState<VisitDateFilter>('SEMUA');
  const [visitStartDate, setVisitStartDate] = useState('');
  const [visitEndDate, setVisitEndDate] = useState('');

  const [genderFilter, setGenderFilter] = useState<'ALL' | 'L' | 'P'>('ALL');
  const [guarantorFilter, setGuarantorFilter] = useState<string>('ALL');
  const [polyFilter, setPolyFilter] = useState<string>('ALL');
  const [clinicalFlagFilter, setClinicalFlagFilter] = useState<
    'ALL' | 'WITH_ALLERGY' | 'WITH_CHRONIC'
  >('ALL');

  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [quickQueuePatient, setQuickQueuePatient] = useState<Patient | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );
  const [submitting, setSubmitting] = useState(false);

  // Form state for Create/Edit Patient
  const [formFullName, setFormFullName] = useState('');
  const [formNik, setFormNik] = useState('');
  const [formBpjs, setFormBpjs] = useState('');
  const [formBirthDate, setFormBirthDate] = useState('1990-01-01');
  const [formGender, setFormGender] = useState<'L' | 'P'>('L');
  const [formBloodType, setFormBloodType] = useState<Patient['bloodType']>('O');
  const [formPhone, setFormPhone] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formAllergies, setFormAllergies] = useState('');
  const [formChronic, setFormChronic] = useState('');

  const facilityPolyclinics = activeFacility.polyclinics || [
    'POLI_UMUM',
    'POLI_GIGI',
    'POLI_KIA_KB',
    'POLI_ANAK',
    'POLI_PENYAKIT_DALAM',
    'IGD',
    'RAWAT_INAP',
  ];

  // Quick Queue Form State
  const [queuePoly, setQueuePoly] = useState(
    facilityPolyclinics[0] || 'POLI_UMUM'
  );
  const [queueDoctorId, setQueueDoctorId] = useState(doctors[0]?.id || '');
  const [queueGuarantor, setQueueGuarantor] = useState<VisitQueueItem['guarantor']>('BPJS_KESEHATAN');
  const [queueComplaint, setQueueComplaint] = useState('');

  // Determine Reference Today Date (handles both real today and demo seed date 2026-11-11)
  const latestDataDate = useMemo(() => {
    const allDates: string[] = [];
    patients.forEach((p) => {
      if (p.createdAt) allDates.push(p.createdAt.slice(0, 10));
    });
    visits.forEach((v) => {
      if (v.createdAt) allDates.push(v.createdAt.slice(0, 10));
    });
    allDates.sort();
    return allDates[allDates.length - 1] || new Date().toISOString().slice(0, 10);
  }, [patients, visits]);

  const patientStatsMap = useMemo(() => {
    const map = new Map<
      string,
      {
        visitCount: number;
        lastVisitDate: string | null;
        lastPoly: string | null;
        lastGuarantor: string | null;
        lastStatus: VisitQueueItem['status'] | null;
        visitDates: string[];
        polyclinics: Set<string>;
        guarantors: Set<string>;
      }
    >();

    patients.forEach((p) => {
      map.set(p.id, {
        visitCount: 0,
        lastVisitDate: null,
        lastPoly: null,
        lastGuarantor: null,
        lastStatus: null,
        visitDates: [],
        polyclinics: new Set(),
        guarantors: new Set(),
      });
    });

    const sortedVisits = [...visits].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );

    sortedVisits.forEach((v) => {
      const entry = map.get(v.patientId);
      if (!entry) return;
      entry.visitCount += 1;
      const vDate = v.createdAt.slice(0, 10);
      entry.visitDates.push(vDate);
      entry.polyclinics.add(v.polyclinic);
      entry.guarantors.add(v.guarantor);
      if (!entry.lastVisitDate) {
        entry.lastVisitDate = v.createdAt;
        entry.lastPoly = v.polyclinic;
        entry.lastGuarantor = v.guarantor;
        entry.lastStatus = v.status;
      }
    });

    return map;
  }, [patients, visits]);

  const filteredPatients = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const realToday = new Date().toISOString().slice(0, 10);

    const isDateWithinDays = (targetIsoDate: string, days: number) => {
      const targetMs = new Date(targetIsoDate).getTime();
      const refRealMs = new Date(realToday).getTime();
      const refLatestMs = new Date(latestDataDate).getTime();
      const diffReal = (refRealMs - targetMs) / (1000 * 60 * 60 * 24);
      const diffLatest = (refLatestMs - targetMs) / (1000 * 60 * 60 * 24);
      return (diffReal >= 0 && diffReal <= days) || (diffLatest >= 0 && diffLatest <= days);
    };

    const isSameMonth = (targetIsoDate: string) => {
      const ym = targetIsoDate.slice(0, 7);
      return ym === realToday.slice(0, 7) || ym === latestDataDate.slice(0, 7);
    };

    return patients.filter((p) => {
      const stat = patientStatsMap.get(p.id);
      const regDate = (p.createdAt || '').slice(0, 10);

      if (q) {
        const hay = [
          p.fullName,
          p.mrNumber,
          p.nik,
          p.bpjsNumber || '',
          p.phone,
          p.address,
          ...p.allergies,
          ...p.chronicConditions,
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      if (genderFilter !== 'ALL' && p.gender !== genderFilter) return false;

      if (clinicalFlagFilter === 'WITH_ALLERGY' && p.allergies.length === 0) return false;
      if (clinicalFlagFilter === 'WITH_CHRONIC' && p.chronicConditions.length === 0) return false;

      if (guarantorFilter !== 'ALL') {
        if (guarantorFilter === 'BPJS_TERDAFTAR') {
          if (!p.bpjsNumber) return false;
        } else if (!stat?.guarantors.has(guarantorFilter)) {
          return false;
        }
      }

      if (polyFilter !== 'ALL' && !stat?.polyclinics.has(polyFilter)) {
        return false;
      }

      // Registration date filter
      if (regFilter === 'HARI_INI') {
        if (regDate !== realToday && regDate !== latestDataDate) return false;
      } else if (regFilter === '7_HARI') {
        if (!regDate || !isDateWithinDays(regDate, 7)) return false;
      } else if (regFilter === 'BULAN_INI') {
        if (!regDate || !isSameMonth(regDate)) return false;
      } else if (regFilter === 'RENTANG') {
        if (regStartDate && regDate < regStartDate) return false;
        if (regEndDate && regDate > regEndDate) return false;
      }

      // Visit / arrival date filter
      const visitDates = stat?.visitDates || [];
      if (visitFilter === 'DATANG_HARI_INI') {
        const cameToday = visitDates.some((d) => d === realToday || d === latestDataDate);
        if (!cameToday) return false;
      } else if (visitFilter === 'DATANG_7_HARI') {
        const came7d = visitDates.some((d) => isDateWithinDays(d, 7));
        if (!came7d) return false;
      } else if (visitFilter === 'DATANG_BULAN_INI') {
        const cameMonth = visitDates.some((d) => isSameMonth(d));
        if (!cameMonth) return false;
      } else if (visitFilter === 'RENTANG_KUNJUNGAN') {
        const cameInRange = visitDates.some((d) => {
          if (visitStartDate && d < visitStartDate) return false;
          if (visitEndDate && d > visitEndDate) return false;
          return true;
        });
        if (!cameInRange) return false;
      } else if (visitFilter === 'BELUM_PERNAH') {
        if (visitDates.length > 0) return false;
      }

      return true;
    });
  }, [
    patients,
    patientStatsMap,
    searchQuery,
    genderFilter,
    clinicalFlagFilter,
    guarantorFilter,
    polyFilter,
    regFilter,
    regStartDate,
    regEndDate,
    visitFilter,
    visitStartDate,
    visitEndDate,
    latestDataDate,
  ]);

  const exportColumns: ExportColumn<Patient>[] = useMemo(
    () => [
      { key: 'mrNumber', header: 'No. RM' },
      { key: 'fullName', header: 'Nama Lengkap Pasien' },
      { key: 'nik', header: 'NIK KTP' },
      { key: 'bpjsNumber', header: 'No. BPJS', format: (r) => r.bpjsNumber || '-' },
      {
        key: 'gender',
        header: 'JK / Usia',
        format: (r) => `${r.gender} · ${calculateAgeYears(r.birthDate)} thn`,
      },
      { key: 'birthDate', header: 'Tgl Lahir' },
      { key: 'phone', header: 'No. Telepon' },
      { key: 'address', header: 'Alamat Domisili' },
      {
        key: 'allergies',
        header: 'Alergi & Kronis',
        format: (r) =>
          [...r.allergies, ...r.chronicConditions].filter(Boolean).join(', ') || 'Tidak ada',
      },
      {
        key: 'createdAt',
        header: 'Tgl Terdaftar',
        format: (r) => (r.createdAt ? r.createdAt.slice(0, 10) : '-'),
      },
      {
        key: 'lastVisit',
        header: 'Kunjungan Terakhir',
        format: (r) => {
          const st = patientStatsMap.get(r.id);
          return st?.lastVisitDate
            ? `${st.lastVisitDate.slice(0, 10)} · ${st.lastPoly || '-'}`
            : 'Belum pernah';
        },
      },
    ],
    [patientStatsMap]
  );

  const openCreateModal = () => {
    setEditingPatient(null);
    setFormFullName('');
    setFormNik('');
    setFormBpjs('');
    setFormBirthDate('1990-01-01');
    setFormGender('L');
    setFormBloodType('O');
    setFormPhone('');
    setFormAddress('');
    setFormAllergies('');
    setFormChronic('');
    setShowAddModal(true);
  };

  const openEditModal = (patient: Patient) => {
    setEditingPatient(patient);
    setFormFullName(patient.fullName);
    setFormNik(patient.nik);
    setFormBpjs(patient.bpjsNumber || '');
    setFormBirthDate(patient.birthDate);
    setFormGender(patient.gender);
    setFormBloodType(patient.bloodType);
    setFormPhone(patient.phone);
    setFormAddress(patient.address);
    setFormAllergies(patient.allergies.join(', '));
    setFormChronic(patient.chronicConditions.join(', '));
    setShowAddModal(true);
  };

  const handleSavePatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formFullName.trim() || formNik.trim().length < 8) {
      setFeedback({
        type: 'error',
        message: 'Nama lengkap dan NIK pasien wajib diisi dengan benar.',
      });
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const payload: Partial<Patient> = {
        fullName: formFullName.trim(),
        nik: formNik.trim(),
        bpjsNumber: formBpjs.trim() || undefined,
        birthDate: formBirthDate,
        gender: formGender,
        bloodType: formBloodType,
        phone: formPhone.trim(),
        address: formAddress.trim(),
        allergies: formAllergies
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        chronicConditions: formChronic
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      };

      if (editingPatient) {
        await kaelApi.updatePatient(token, activeFacility.code, editingPatient.id, payload);
        setFeedback({
          type: 'success',
          message: `Data pasien ${formFullName} (${editingPatient.mrNumber}) berhasil diperbarui.`,
        });
      } else {
        const created = await kaelApi.createPatient(token, activeFacility.code, payload);
        setFeedback({
          type: 'success',
          message: `Pasien baru ${created.fullName} (${created.mrNumber}) berhasil didaftarkan ke Master Indeks Pasien.`,
        });
      }
      setShowAddModal(false);
      await onRefreshWorkspace();
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Gagal menyimpan data pasien.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickQueueSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickQueuePatient) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const visit = await kaelApi.createVisit(token, activeFacility.code, {
        patientId: quickQueuePatient.id,
        polyclinic: queuePoly,
        doctorId: queueDoctorId || doctors[0]?.id || '',
        guarantor: queueGuarantor,
        chiefComplaint: queueComplaint.trim() || 'Kunjungan pemeriksaan klinik terjadwal',
        vitals: {
          systolic: 120,
          diastolic: 80,
          heartRate: 78,
          respiratoryRate: 18,
          temperature: 36.6,
          spo2: 99,
          weightKg: 62,
          heightCm: 165,
          gcsEye: 4,
          gcsVerbal: 5,
          gcsMotor: 6,
          painScale: 0,
        },
      });
      setQuickQueuePatient(null);
      setQueueComplaint('');
      setFeedback({
        type: 'success',
        message: `Pasien ${quickQueuePatient.fullName} berhasil masuk antrean ${visit.queueNumber} (${visit.polyclinic}).`,
      });
      await onRefreshWorkspace();
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Gagal mendaftarkan ke antrean.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const resetAllFilters = () => {
    setSearchQuery('');
    setRegFilter('SEMUA');
    setRegStartDate('');
    setRegEndDate('');
    setVisitFilter('SEMUA');
    setVisitStartDate('');
    setVisitEndDate('');
    setGenderFilter('ALL');
    setGuarantorFilter('ALL');
    setPolyFilter('ALL');
    setClinicalFlagFilter('ALL');
  };

  const cameTodayCount = useMemo(() => {
    const realToday = new Date().toISOString().slice(0, 10);
    let count = 0;
    patients.forEach((p) => {
      const st = patientStatsMap.get(p.id);
      if (st?.visitDates.some((d) => d === realToday || d === latestDataDate)) {
        count += 1;
      }
    });
    return count;
  }, [patients, patientStatsMap, latestDataDate]);

  const regTodayCount = useMemo(() => {
    const realToday = new Date().toISOString().slice(0, 10);
    return patients.filter((p) => {
      const d = (p.createdAt || '').slice(0, 10);
      return d === realToday || d === latestDataDate;
    }).length;
  }, [patients, latestDataDate]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#52736B] dark:text-[#86B5A9]">
            MASTER INDEKS PASIEN TERPADU • {activeFacility.name}
          </p>
          <h1 className="text-2xl font-bold text-[#0F2922] dark:text-white tracking-tight mt-0.5">
            Semua pasien terdaftar
          </h1>
          <p className="text-xs text-[#52736B] dark:text-[#86B5A9] mt-0.5">
            Filter pasien yang mendaftar hari ini/kapanpun, pasien yang datang berkunjung hari ini/kapanpun, riwayat medis, serta ekspor dokumen lengkap.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#00897B] hover:bg-[#00796B] text-white text-xs font-semibold shadow-xs transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            <span>Tambah Pasien Baru</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between text-xs font-medium ${
            feedback.type === 'success'
              ? 'bg-[#E6F4F1] dark:bg-[#0F3D35] border-[#B2DFDB] dark:border-[#1E564B] text-[#00695C] dark:text-[#80CBC4]'
              : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
          }`}
        >
          <span>{feedback.message}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-current opacity-75 hover:opacity-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Quick Filter Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <button
          type="button"
          onClick={() => {
            setRegFilter('SEMUA');
            setVisitFilter('SEMUA');
          }}
          className={`text-left p-4 rounded-2xl border transition-all ${
            regFilter === 'SEMUA' && visitFilter === 'SEMUA'
              ? 'bg-[#0F3D35] text-white border-[#0F3D35] shadow-sm'
              : 'bg-white dark:bg-[#0B211D] border-[#E2ECE8] dark:border-[#183831] text-[#0F2922] dark:text-white hover:border-[#00897B]'
          }`}
        >
          <p
            className={`text-xs ${
              regFilter === 'SEMUA' && visitFilter === 'SEMUA'
                ? 'text-[#A7CEC4]'
                : 'text-[#52736B] dark:text-[#86B5A9]'
            }`}
          >
            Total semua pasien terdaftar
          </p>
          <p className="text-2xl font-bold mt-1 font-mono">{patients.length}</p>
          <p
            className={`text-[11px] mt-1 ${
              regFilter === 'SEMUA' && visitFilter === 'SEMUA'
                ? 'text-[#E5B85B]'
                : 'text-[#52736B] dark:text-[#86B5A9]'
            }`}
          >
            Klik untuk tampilkan seluruh waktu
          </p>
        </button>

        <button
          type="button"
          onClick={() => {
            setRegFilter('HARI_INI');
            setVisitFilter('SEMUA');
          }}
          className={`text-left p-4 rounded-2xl border transition-all ${
            regFilter === 'HARI_INI'
              ? 'bg-[#00897B] text-white border-[#00897B] shadow-sm'
              : 'bg-white dark:bg-[#0B211D] border-[#E2ECE8] dark:border-[#183831] text-[#0F2922] dark:text-white hover:border-[#00897B]'
          }`}
        >
          <p
            className={`text-xs ${
              regFilter === 'HARI_INI'
                ? 'text-white/85'
                : 'text-[#52736B] dark:text-[#86B5A9]'
            }`}
          >
            Pasien mendaftar hari ini
          </p>
          <p className="text-2xl font-bold mt-1 font-mono">{regTodayCount}</p>
          <p
            className={`text-[11px] mt-1 ${
              regFilter === 'HARI_INI'
                ? 'text-white/90'
                : 'text-[#52736B] dark:text-[#86B5A9]'
            }`}
          >
            Rekam medis baru dibuat hari ini
          </p>
        </button>

        <button
          type="button"
          onClick={() => {
            setRegFilter('SEMUA');
            setVisitFilter('DATANG_HARI_INI');
          }}
          className={`text-left p-4 rounded-2xl border transition-all ${
            visitFilter === 'DATANG_HARI_INI'
              ? 'bg-[#00897B] text-white border-[#00897B] shadow-sm'
              : 'bg-white dark:bg-[#0B211D] border-[#E2ECE8] dark:border-[#183831] text-[#0F2922] dark:text-white hover:border-[#00897B]'
          }`}
        >
          <p
            className={`text-xs ${
              visitFilter === 'DATANG_HARI_INI'
                ? 'text-white/85'
                : 'text-[#52736B] dark:text-[#86B5A9]'
            }`}
          >
            Pasien datang berkunjung hari ini
          </p>
          <p className="text-2xl font-bold mt-1 font-mono">{cameTodayCount}</p>
          <p
            className={`text-[11px] mt-1 ${
              visitFilter === 'DATANG_HARI_INI'
                ? 'text-white/90'
                : 'text-[#52736B] dark:text-[#86B5A9]'
            }`}
          >
            Memiliki antrean / poli hari ini
          </p>
        </button>

        <div className="p-4 rounded-2xl bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831]">
          <p className="text-xs text-[#52736B] dark:text-[#86B5A9]">
            Hasil filter ditampilkan
          </p>
          <p className="text-2xl font-bold text-[#00897B] mt-1 font-mono">
            {filteredPatients.length}{' '}
            <span className="text-xs font-normal text-[#52736B]">/ {patients.length} pasien</span>
          </p>
          <p className="text-[11px] text-[#52736B] dark:text-[#86B5A9] mt-1">
            Siap diekspor ke PDF, XLSX, CSV, DOCS
          </p>
        </div>
      </div>

      {/* Comprehensive Filter Bar */}
      <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-4 space-y-3.5">
        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#52736B] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama pasien, No. RM, NIK KTP, No. BPJS, nomor telepon, alamat, atau riwayat alergi..."
              className="w-full pl-10 pr-4 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714] text-xs text-[#0F2922] dark:text-white focus:outline-hidden focus:border-[#00897B]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={resetAllFilters}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] text-xs font-medium text-[#52736B] dark:text-[#86B5A9] hover:text-[#0F2922] dark:hover:text-white hover:bg-[#F3F8F6] dark:hover:bg-[#112E28]"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Semua Filter</span>
            </button>

            <DataExportToolbar
              title="Master Data Semua Pasien Terdaftar"
              subtitle={`Filter aktif: Pendaftaran (${regFilter}) • Kunjungan (${visitFilter})`}
              filenameBase={`KAEL_Semua_Pasien_${activeFacility.code}`}
              facilityName={activeFacility.name}
              facilityCode={activeFacility.code}
              columns={exportColumns}
              rows={filteredPatients}
              compact
              contextLabel="Ekspor Tabel Pasien"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 pt-1">
          {/* Filter Waktu Pendaftaran */}
          <div>
            <label className="block text-[11px] font-semibold text-[#52736B] dark:text-[#86B5A9] mb-1">
              Waktu Pendaftaran Pasien
            </label>
            <select
              aria-label="Filter Waktu Pendaftaran Pasien"
              value={regFilter}
              onChange={(e) => setRegFilter(e.target.value as RegDateFilter)}
              className="w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714] text-xs text-[#0F2922] dark:text-white"
            >
              <option value="SEMUA">Semua Waktu</option>
              <option value="HARI_INI">Mendaftar Hari Ini</option>
              <option value="7_HARI">Mendaftar 7 Hari Terakhir</option>
              <option value="BULAN_INI">Mendaftar Bulan Ini</option>
              <option value="RENTANG">Rentang Tanggal Pendaftaran...</option>
            </select>
          </div>

          {/* Filter Waktu Kunjungan / Kedatangan */}
          <div>
            <label className="block text-[11px] font-semibold text-[#52736B] dark:text-[#86B5A9] mb-1">
              Waktu Kedatangan / Kunjungan
            </label>
            <select
              aria-label="Filter Waktu Kedatangan Kunjungan"
              value={visitFilter}
              onChange={(e) => setVisitFilter(e.target.value as VisitDateFilter)}
              className="w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714] text-xs text-[#0F2922] dark:text-white"
            >
              <option value="SEMUA">Semua Kunjungan</option>
              <option value="DATANG_HARI_INI">Datang Berkunjung Hari Ini</option>
              <option value="DATANG_7_HARI">Datang 7 Hari Terakhir</option>
              <option value="DATANG_BULAN_INI">Datang Bulan Ini</option>
              <option value="RENTANG_KUNJUNGAN">Rentang Tanggal Kunjungan...</option>
              <option value="BELUM_PERNAH">Belum Pernah Kunjungan Poli</option>
            </select>
          </div>

          {/* Filter Poliklinik */}
          <div>
            <label className="block text-[11px] font-semibold text-[#52736B] dark:text-[#86B5A9] mb-1">
              Poliklinik / Unit Layanan
            </label>
            <select
              aria-label="Filter Poliklinik"
              value={polyFilter}
              onChange={(e) => setPolyFilter(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714] text-xs text-[#0F2922] dark:text-white"
            >
              <option value="ALL">Semua Poliklinik</option>
              {facilityPolyclinics.map((poly: string) => (
                <option key={poly} value={poly}>
                  {poly}
                </option>
              ))}
            </select>
          </div>

          {/* Filter Penjamin */}
          <div>
            <label className="block text-[11px] font-semibold text-[#52736B] dark:text-[#86B5A9] mb-1">
              Penjamin / Kepesertaan
            </label>
            <select
              aria-label="Filter Penjamin"
              value={guarantorFilter}
              onChange={(e) => setGuarantorFilter(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714] text-xs text-[#0F2922] dark:text-white"
            >
              <option value="ALL">Semua Penjamin</option>
              <option value="BPJS_TERDAFTAR">Memiliki Nomor BPJS Aktif</option>
              <option value="BPJS_KESEHATAN">Kunjungan BPJS Kesehatan</option>
              <option value="UMUM_MANDIRI">Pasien Umum / Mandiri</option>
              <option value="ASURANSI_SWASTA">Asuransi Swasta / Korporat</option>
            </select>
          </div>

          {/* Filter Jenis Kelamin & Risiko Klinis */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-semibold text-[#52736B] dark:text-[#86B5A9] mb-1">
                Gender
              </label>
              <select
                aria-label="Filter Jenis Kelamin"
                value={genderFilter}
                onChange={(e) => setGenderFilter(e.target.value as 'ALL' | 'L' | 'P')}
                className="w-full px-2.5 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714] text-xs text-[#0F2922] dark:text-white"
              >
                <option value="ALL">Semua</option>
                <option value="L">Laki-laki (L)</option>
                <option value="P">Perempuan (P)</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#52736B] dark:text-[#86B5A9] mb-1">
                Atribut Klinis
              </label>
              <select
                aria-label="Filter Atribut Klinis"
                value={clinicalFlagFilter}
                onChange={(e) =>
                  setClinicalFlagFilter(
                    e.target.value as 'ALL' | 'WITH_ALLERGY' | 'WITH_CHRONIC'
                  )
                }
                className="w-full px-2.5 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714] text-xs text-[#0F2922] dark:text-white"
              >
                <option value="ALL">Semua</option>
                <option value="WITH_ALLERGY">Ada Alergi</option>
                <option value="WITH_CHRONIC">Komedis Kronis</option>
              </select>
            </div>
          </div>
        </div>

        {/* Custom Date Range Pickers when RENTANG selected */}
        {(regFilter === 'RENTANG' || visitFilter === 'RENTANG_KUNJUNGAN') && (
          <div className="pt-2 border-t border-[#E2ECE8] dark:border-[#183831] flex flex-wrap items-center gap-4">
            {regFilter === 'RENTANG' && (
              <div className="flex items-center gap-2 text-xs">
                <Calendar className="w-4 h-4 text-[#00897B]" />
                <span className="font-semibold text-[#0F2922] dark:text-white">
                  Rentang Tgl Pendaftaran:
                </span>
                <input
                  type="date"
                  value={regStartDate}
                  onChange={(e) => setRegStartDate(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                />
                <span>s/d</span>
                <input
                  type="date"
                  value={regEndDate}
                  onChange={(e) => setRegEndDate(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                />
              </div>
            )}

            {visitFilter === 'RENTANG_KUNJUNGAN' && (
              <div className="flex items-center gap-2 text-xs">
                <Calendar className="w-4 h-4 text-[#00897B]" />
                <span className="font-semibold text-[#0F2922] dark:text-white">
                  Rentang Tgl Kunjungan:
                </span>
                <input
                  type="date"
                  value={visitStartDate}
                  onChange={(e) => setVisitStartDate(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                />
                <span>s/d</span>
                <input
                  type="date"
                  value={visitEndDate}
                  onChange={(e) => setVisitEndDate(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Master Patients Table */}
      <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#EAF3F0] dark:bg-[#0F2D27] text-[#52736B] dark:text-[#86B5A9] border-b border-[#E2ECE8] dark:border-[#183831]">
                <th className="py-3 px-4 font-semibold">No. RM &amp; Pasien</th>
                <th className="py-3 px-4 font-semibold">NIK &amp; Kepesertaan BPJS</th>
                <th className="py-3 px-4 font-semibold">Usia / Gol. Darah</th>
                <th className="py-3 px-4 font-semibold">Kontak &amp; Domisili</th>
                <th className="py-3 px-4 font-semibold">Peringatan Klinis</th>
                <th className="py-3 px-4 font-semibold">Terdaftar &amp; Kunjungan</th>
                <th className="py-3 px-4 font-semibold text-right">Tindakan Cepat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2ECE8] dark:divide-[#183831]">
              {filteredPatients.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-[#52736B] dark:text-[#86B5A9]">
                    Tidak ditemukan data pasien yang sesuai dengan kriteria filter waktu/pencarian.
                  </td>
                </tr>
              ) : (
                filteredPatients.map((patient) => {
                  const st = patientStatsMap.get(patient.id);
                  const age = calculateAgeYears(patient.birthDate);
                  return (
                    <tr
                      key={patient.id}
                      className="hover:bg-[#F3F8F6] dark:hover:bg-[#0F2B25] transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="font-mono text-[11px] font-semibold text-[#00897B]">
                          {patient.mrNumber}
                        </div>
                        <div className="font-bold text-[#0F2922] dark:text-white text-sm mt-0.5">
                          {patient.fullName}
                        </div>
                      </td>

                      <td className="py-3 px-4 font-mono">
                        <div className="text-[#0F2922] dark:text-white">NIK: {patient.nik}</div>
                        <div className="text-[11px] text-[#52736B] dark:text-[#86B5A9] mt-0.5">
                          BPJS: {patient.bpjsNumber || 'Umum / Non-BPJS'}
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="font-medium text-[#0F2922] dark:text-white">
                          {patient.gender === 'L' ? 'Laki-laki' : 'Perempuan'} • {age} thn
                        </div>
                        <div className="text-[11px] text-[#52736B] dark:text-[#86B5A9] mt-0.5">
                          Lahir: {patient.birthDate} • Gol: {patient.bloodType}
                          {patient.rhesus}
                        </div>
                      </td>

                      <td className="py-3 px-4 max-w-xs">
                        <div className="font-mono text-[#0F2922] dark:text-white">
                          {patient.phone || '-'}
                        </div>
                        <div className="text-[11px] text-[#52736B] dark:text-[#86B5A9] truncate mt-0.5">
                          {patient.address || '-'}
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1">
                          {patient.allergies.length === 0 &&
                          patient.chronicConditions.length === 0 ? (
                            <span className="text-[11px] text-[#52736B] dark:text-[#86B5A9]">
                              Tidak ada alergi
                            </span>
                          ) : (
                            <>
                              {patient.allergies.map((al) => (
                                <span
                                  key={al}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 text-[10px] font-semibold"
                                >
                                  <AlertTriangle className="w-3 h-3" />
                                  Alergi: {al}
                                </span>
                              ))}
                              {patient.chronicConditions.map((ch) => (
                                <span
                                  key={ch}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#E6F4F1] dark:bg-[#133830] text-[#00796B] dark:text-[#4DB6AC] text-[10px] font-semibold"
                                >
                                  {ch}
                                </span>
                              ))}
                            </>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="text-[11px] text-[#52736B] dark:text-[#86B5A9]">
                          Daftar:{' '}
                          <span className="font-mono text-[#0F2922] dark:text-white">
                            {patient.createdAt ? patient.createdAt.slice(0, 10) : '-'}
                          </span>
                        </div>
                        {st?.lastVisitDate ? (
                          <div className="text-[11px] text-[#00897B] font-medium mt-0.5">
                            Datang: {st.lastVisitDate.slice(0, 10)} · {st.visitCount}x
                          </div>
                        ) : (
                          <div className="text-[11px] text-[#52736B] mt-0.5">
                            Belum ada kunjungan poli
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setQuickQueuePatient(patient);
                              setQueueGuarantor(
                                patient.bpjsNumber ? 'BPJS_KESEHATAN' : 'UMUM'
                              );
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-[#00897B] hover:bg-[#00796B] text-white text-[11px] font-semibold transition-colors"
                          >
                            + Antrean
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedPatient(patient)}
                            className="px-2.5 py-1.5 rounded-lg border border-[#D5E3DF] dark:border-[#1E473F] bg-white dark:bg-[#0C2621] hover:bg-[#EBF4F1] text-[#0F2922] dark:text-white text-[11px] font-medium"
                          >
                            Riwayat RME
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(patient)}
                            aria-label={`Edit pasien ${patient.fullName}`}
                            className="p-1.5 rounded-lg border border-[#D5E3DF] dark:border-[#1E473F] text-[#52736B] hover:text-[#0F2922] dark:hover:text-white"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-[#E2ECE8] dark:border-[#183831] bg-[#F8FBFA] dark:bg-[#081916] flex items-center justify-between text-xs text-[#52736B] dark:text-[#86B5A9]">
          <span>
            Menampilkan <strong>{filteredPatients.length}</strong> dari total{' '}
            <strong>{patients.length}</strong> pasien terdaftar di {activeFacility.name}
          </span>
          <span className="font-mono text-[11px]">
            Indeks sinkron real-time • SATUSEHAT FHIR Patient Ready
          </span>
        </div>
      </div>

      {/* Modal Riwayat Kunjungan & RME Pasien */}
      {selectedPatient && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Riwayat Rekam Medis ${selectedPatient.fullName}`}
        >
          <div className="bg-white dark:bg-[#0B211D] border border-[#D5E3DF] dark:border-[#1E473F] rounded-2xl max-w-3xl w-full max-h-[88vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-[#E2ECE8] dark:border-[#183831] flex items-center justify-between bg-[#F3F8F6] dark:bg-[#081A17]">
              <div>
                <p className="text-[11px] font-mono font-semibold text-[#00897B]">
                  {selectedPatient.mrNumber} • NIK {selectedPatient.nik}
                </p>
                <h3 className="text-base font-bold text-[#0F2922] dark:text-white">
                  Riwayat Kunjungan &amp; Rekam Medis — {selectedPatient.fullName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPatient(null)}
                className="p-1.5 rounded-lg border border-[#D5E3DF] text-[#52736B] hover:text-[#0F2922]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              {visits.filter((v) => v.patientId === selectedPatient.id).length === 0 ? (
                <p className="text-xs text-[#52736B] py-6 text-center">
                  Pasien ini belum memiliki riwayat kunjungan poliklinik.
                </p>
              ) : (
                visits
                  .filter((v) => v.patientId === selectedPatient.id)
                  .map((v) => {
                    const soap = soapRecords.find((s) => s.visitId === v.id);
                    return (
                      <div
                        key={v.id}
                        className="p-4 rounded-xl border border-[#E2ECE8] dark:border-[#183831] bg-[#F8FBFA] dark:bg-[#081916] space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs font-bold text-[#00897B]">
                            {v.queueNumber} • {v.polyclinic}
                          </span>
                          <span className="text-[11px] font-mono text-[#52736B]">
                            {v.createdAt.slice(0, 16).replace('T', ' ')} • {v.status}
                          </span>
                        </div>
                        <p className="text-xs text-[#0F2922] dark:text-white">
                          <strong>Dokter Pemeriksa:</strong> {v.doctorName} •{' '}
                          <strong>Keluhan:</strong> {v.chiefComplaint}
                        </p>
                        {soap && (
                          <div className="pt-2 border-t border-[#E2ECE8] dark:border-[#183831] text-xs space-y-1">
                            <p className="text-[#00796B] dark:text-[#4DB6AC] font-semibold">
                              Diagnosis ICD-10: {soap.assessment.primaryIcd10Code} —{' '}
                              {soap.assessment.primaryIcd10Name}
                            </p>
                            <p className="text-[#52736B] dark:text-[#86B5A9]">
                              <strong>Plan / Terapi:</strong> {soap.plan.therapyNotes}
                            </p>
                          </div>
                        )}
                        <div className="pt-1 flex justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedPatient(null);
                              onNavigateModule('RME_DOKTER', v.id);
                            }}
                            className="text-xs font-semibold text-[#00897B] hover:underline"
                          >
                            Buka di RME Klinis &rarr;
                          </button>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Tambah / Edit Pasien */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={editingPatient ? 'Edit Data Pasien' : 'Tambah Pasien Baru'}
        >
          <form
            onSubmit={handleSavePatient}
            className="bg-white dark:bg-[#0B211D] border border-[#D5E3DF] dark:border-[#1E473F] rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl"
          >
            <div className="px-6 py-4 border-b border-[#E2ECE8] dark:border-[#183831] flex items-center justify-between bg-[#F3F8F6] dark:bg-[#081A17]">
              <h3 className="text-base font-bold text-[#0F2922] dark:text-white">
                {editingPatient
                  ? `Perbarui Data Pasien (${editingPatient.mrNumber})`
                  : 'Registrasi Master Pasien Baru'}
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1.5 rounded-lg border border-[#D5E3DF] text-[#52736B]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block font-semibold mb-1">Nama Lengkap Pasien *</label>
                <input
                  type="text"
                  required
                  value={formFullName}
                  onChange={(e) => setFormFullName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">NIK KTP *</label>
                <input
                  type="text"
                  required
                  value={formNik}
                  onChange={(e) => setFormNik(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714] font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Nomor Kartu BPJS</label>
                <input
                  type="text"
                  value={formBpjs}
                  onChange={(e) => setFormBpjs(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714] font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Tanggal Lahir *</label>
                <input
                  type="date"
                  required
                  value={formBirthDate}
                  onChange={(e) => setFormBirthDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Jenis Kelamin</label>
                <select
                  value={formGender}
                  onChange={(e) => setFormGender(e.target.value as 'L' | 'P')}
                  className="w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                >
                  <option value="L">Laki-laki (L)</option>
                  <option value="P">Perempuan (P)</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Nomor Telepon / WhatsApp</label>
                <input
                  type="text"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714] font-mono"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold mb-1">Alamat Lengkap Domisili</label>
                <input
                  type="text"
                  value={formAddress}
                  onChange={(e) => setFormAddress(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">
                  Riwayat Alergi Obat / Makanan
                </label>
                <input
                  type="text"
                  value={formAllergies}
                  onChange={(e) => setFormAllergies(e.target.value)}
                  placeholder="Mis: Penisilin, Seafood"
                  className="w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">
                  Penyakit Kronis / Komorbid
                </label>
                <input
                  type="text"
                  value={formChronic}
                  onChange={(e) => setFormChronic(e.target.value)}
                  placeholder="Mis: Hipertensi, DM Tipe 2"
                  className="w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-[#E2ECE8] dark:border-[#183831] bg-[#F8FBFA] dark:bg-[#081916] flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 rounded-xl border border-[#D5E3DF] text-xs font-medium"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 rounded-xl bg-[#00897B] hover:bg-[#00796B] text-white text-xs font-semibold"
              >
                {submitting ? 'Menyimpan...' : 'Simpan Data Pasien'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Daftarkan Cepat ke Antrean */}
      {quickQueuePatient && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Daftarkan ${quickQueuePatient.fullName} ke Antrean`}
        >
          <form
            onSubmit={handleQuickQueueSubmit}
            className="bg-white dark:bg-[#0B211D] border border-[#D5E3DF] dark:border-[#1E473F] rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl"
          >
            <div className="px-6 py-4 border-b border-[#E2ECE8] dark:border-[#183831] flex items-center justify-between bg-[#F3F8F6] dark:bg-[#081A17]">
              <div>
                <p className="text-[11px] font-mono text-[#00897B]">
                  {quickQueuePatient.mrNumber}
                </p>
                <h3 className="text-base font-bold text-[#0F2922] dark:text-white">
                  Daftarkan ke Antrean Poli — {quickQueuePatient.fullName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setQuickQueuePatient(null)}
                className="p-1.5 rounded-lg border border-[#D5E3DF] text-[#52736B]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-semibold mb-1">Poliklinik Tujuan</label>
                <select
                  value={queuePoly}
                  onChange={(e) => setQueuePoly(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                >
                  {facilityPolyclinics.map((p: string) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Dokter / Tenaga Medis Pemeriksa</label>
                <select
                  value={queueDoctorId}
                  onChange={(e) => setQueueDoctorId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                >
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.fullName} ({d.specialization || d.role})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Penjamin Biaya</label>
                <select
                  value={queueGuarantor}
                  onChange={(e) =>
                    setQueueGuarantor(e.target.value as VisitQueueItem['guarantor'])
                  }
                  className="w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                >
                  <option value="BPJS_KESEHATAN">BPJS Kesehatan</option>
                  <option value="UMUM">Umum / Mandiri</option>
                  <option value="ASURANSI_SWASTA">Asuransi Swasta</option>
                  <option value="KORPORASI">Jaminan Perusahaan / Korporasi</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Keluhan Utama Kedatangan</label>
                <input
                  type="text"
                  required
                  value={queueComplaint}
                  onChange={(e) => setQueueComplaint(e.target.value)}
                  placeholder="Contoh: Kontrol hipertensi / demam hari ke-2"
                  className="w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-[#E2ECE8] dark:border-[#183831] bg-[#F8FBFA] dark:bg-[#081916] flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setQuickQueuePatient(null)}
                className="px-4 py-2 rounded-xl border border-[#D5E3DF] text-xs font-medium"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 rounded-xl bg-[#00897B] hover:bg-[#00796B] text-white text-xs font-semibold"
              >
                {submitting ? 'Memproses...' : 'Masukkan ke Antrean'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
