import React, { useMemo, useState } from 'react';
import {
  Activity,
  Bed,
  CalendarClock,
  CheckCircle2,
  Edit3,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Stethoscope,
  UserCheck,
  UserPlus,
  Volume2,
} from 'lucide-react';
import {
  Facility,
  InpatientBed,
  Patient,
  UserAccount,
  VisitQueueItem,
  VitalSigns,
} from '../types/simrs';
import { kaelApi } from '../utils/apiClient';
import {
  calculateBMI,
  calculateMAP,
  calculatePatientAge,
  evaluateAutoTriage,
  findMatchingPatients,
} from '../utils/clinicalLogic';
import { DataExportToolbar } from './DataExportToolbar';
import { ExportColumn } from '../utils/exportDocument';

interface RegistrationAndBedsModuleProps {
  token: string;
  activeFacility: Facility;
  patients: Patient[];
  visits: VisitQueueItem[];
  beds: InpatientBed[];
  doctors: UserAccount[];
  initialSubTab?: 'QUEUE_REG' | 'MPI' | 'SCHEDULE' | 'BEDS';
  onRefreshWorkspace: () => Promise<void>;
  onSelectVisitForRme: (visitId: string) => void;
}

export const RegistrationAndBedsModule: React.FC<RegistrationAndBedsModuleProps> = ({
  token,
  activeFacility,
  patients,
  visits,
  beds,
  doctors,
  initialSubTab = 'QUEUE_REG',
  onRefreshWorkspace,
  onSelectVisitForRme,
}) => {
  const [subTab, setSubTab] = useState<'QUEUE_REG' | 'MPI' | 'SCHEDULE' | 'BEDS'>(initialSubTab);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // ============================================================================
  // UNIFIED SMART REGISTRATION STATE (New or Existing Patient + Visit Queue)
  // ============================================================================
  const [matchedPatientId, setMatchedPatientId] = useState<string | null>(null);
  const [matchedMrNumber, setMatchedMrNumber] = useState<string | null>(null);
  const [regFullName, setRegFullName] = useState('');
  const [regNik, setRegNik] = useState('');
  const [regBpjs, setRegBpjs] = useState('');
  const [regBirthDate, setRegBirthDate] = useState('');
  const [regGender, setRegGender] = useState<'L' | 'P'>('L');
  const [regBloodType, setRegBloodType] = useState<Patient['bloodType']>('O');
  const [regRhesus, setRegRhesus] = useState<'+' | '-'>('+');
  const [regPhone, setRegPhone] = useState('');
  const [regAddress, setRegAddress] = useState('');
  const [regAllergies, setRegAllergies] = useState('');
  const [regChronic, setRegChronic] = useState('');
  const [regEmergencyName, setRegEmergencyName] = useState('');
  const [regEmergencyPhone, setRegEmergencyPhone] = useState('');

  // Visit Details
  const [polyclinic, setPolyclinic] = useState<string>('POLI_PENYAKIT_DALAM');
  const [doctorId, setDoctorId] = useState<string>(doctors[0]?.id || '');
  const [guarantor, setGuarantor] = useState<VisitQueueItem['guarantor']>('BPJS_KESEHATAN');
  const [bpjsSepOrPcareNo, setBpjsSepOrPcareNo] = useState<string>('');
  const [chiefComplaint, setChiefComplaint] = useState<string>('');
  const [vitals, setVitals] = useState<VitalSigns>({
    systolic: 120,
    diastolic: 80,
    heartRate: 80,
    respiratoryRate: 18,
    temperature: 36.6,
    spo2: 99,
    weightKg: 65,
    heightCm: 168,
    gcsEye: 4,
    gcsVerbal: 5,
    gcsMotor: 6,
    painScale: 1,
  });

  // Queue Filters (Complete & Easy to Use)
  const [queueSearch, setQueueSearch] = useState('');
  const [polyFilter, setPolyFilter] = useState<string>('ALL');
  const [guarantorFilter, setGuarantorFilter] = useState<string>('ALL');
  const [stageFilter, setStageFilter] = useState<string>('ALL');
  const [triageFilter, setTriageFilter] = useState<string>('ALL');

  // MPI Database Filters
  const [mpiSearchQuery, setMpiSearchQuery] = useState('');
  const [mpiGenderFilter, setMpiGenderFilter] = useState<'ALL' | 'L' | 'P'>('ALL');
  const [mpiBloodFilter, setMpiBloodFilter] = useState<string>('ALL');
  const [mpiAllergyFilter, setMpiAllergyFilter] = useState<'ALL' | 'HAS_ALLERGY'>('ALL');

  // MPI Patient Standalone Create / Edit Form State
  const [editingPatientId, setEditingPatientId] = useState<string | null>(null);
  const [mpiFullName, setMpiFullName] = useState('');
  const [mpiNik, setMpiNik] = useState('');
  const [mpiBpjs, setMpiBpjs] = useState('');
  const [mpiBirthDate, setMpiBirthDate] = useState('1990-05-15');
  const [mpiGender, setMpiGender] = useState<'L' | 'P'>('L');
  const [mpiBloodType, setMpiBloodType] = useState<Patient['bloodType']>('O');
  const [mpiRhesus, setMpiRhesus] = useState<'+' | '-'>('+');
  const [mpiPhone, setMpiPhone] = useState('');
  const [mpiAddress, setMpiAddress] = useState('');
  const [mpiAllergies, setMpiAllergies] = useState('');
  const [mpiChronic, setMpiChronic] = useState('');
  const [mpiEmergencyName, setMpiEmergencyName] = useState('');
  const [mpiEmergencyPhone, setMpiEmergencyPhone] = useState('');

  // Bed Assignment, Filters & Room Creation State
  const [bedSearch, setBedSearch] = useState('');
  const [bedClassFilter, setBedClassFilter] = useState<string>('ALL');
  const [bedStatusFilter, setBedStatusFilter] = useState<string>('ALL');
  const [assignBedId, setAssignBedId] = useState<string | null>(null);
  const [assignPatientId, setAssignPatientId] = useState<string>(patients[0]?.id || '');
  const [assignDoctorName, setAssignDoctorName] = useState<string>(
    doctors[0]?.fullName || 'dr. Hendra Wijaya, Sp.PD'
  );
  const [assignDiagnosis, setAssignDiagnosis] = useState<string>(
    'Observasi Klinis / Rawat Inap Terpadu'
  );
  const [cpptBedId, setCpptBedId] = useState<string | null>(null);
  const [cpptNote, setCpptNote] = useState<string>('');
  const [showAddBedForm, setShowAddBedForm] = useState(false);
  const [newBedCode, setNewBedCode] = useState('');
  const [newBedWard, setNewBedWard] = useState('Paviliun Padjadjaran Lt. 2');
  const [newBedClass, setNewBedClass] = useState<InpatientBed['bedClass']>('KELAS_1');
  const [newBedRate, setNewBedRate] = useState(450000);

  // Live Multi-Field Patient Database Auto-Matcher
  const livePatientCandidates = useMemo(() => {
    return findMatchingPatients(patients, {
      fullName: regFullName,
      nik: regNik,
      bpjsNumber: regBpjs,
      birthDate: regBirthDate,
      gender: regGender,
      phone: regPhone,
      address: regAddress,
    });
  }, [
    patients,
    regFullName,
    regNik,
    regBpjs,
    regBirthDate,
    regGender,
    regPhone,
    regAddress,
  ]);

  // Helper to populate unified registration form from an existing database patient
  const applyMatchedPatientToForm = (p: Patient) => {
    setMatchedPatientId(p.id);
    setMatchedMrNumber(p.mrNumber);
    setRegFullName(p.fullName);
    setRegNik(p.nik);
    setRegBpjs(p.bpjsNumber);
    setRegBirthDate(p.birthDate);
    setRegGender(p.gender);
    setRegBloodType(p.bloodType);
    setRegRhesus(p.rhesus);
    setRegPhone(p.phone);
    setRegAddress(p.address);
    setRegAllergies(p.allergies.join(', '));
    setRegChronic(p.chronicConditions.join(', '));
    setRegEmergencyName(p.emergencyContactName);
    setRegEmergencyPhone(p.emergencyContactPhone);
    if (p.bpjsNumber) {
      setGuarantor('BPJS_KESEHATAN');
    }
  };

  const resetUnifiedPatientForm = () => {
    setMatchedPatientId(null);
    setMatchedMrNumber(null);
    setRegFullName('');
    setRegNik('');
    setRegBpjs('');
    setRegBirthDate('');
    setRegGender('L');
    setRegBloodType('O');
    setRegRhesus('+');
    setRegPhone('');
    setRegAddress('');
    setRegAllergies('');
    setRegChronic('');
    setRegEmergencyName('');
    setRegEmergencyPhone('');
  };

  // Also check live matches in MPI standalone tab when typing Name / NIK / Address / Birthdate
  const mpiLiveDuplicates = useMemo(() => {
    if (editingPatientId) return [];
    return findMatchingPatients(patients, {
      fullName: mpiFullName,
      nik: mpiNik,
      bpjsNumber: mpiBpjs,
      birthDate: mpiBirthDate,
      gender: mpiGender,
      phone: mpiPhone,
      address: mpiAddress,
    });
  }, [
    editingPatientId,
    patients,
    mpiFullName,
    mpiNik,
    mpiBpjs,
    mpiBirthDate,
    mpiGender,
    mpiPhone,
    mpiAddress,
  ]);

  const filteredPatients = useMemo(() => {
    const q = mpiSearchQuery.trim().toLowerCase();
    return patients.filter((p) => {
      if (mpiGenderFilter !== 'ALL' && p.gender !== mpiGenderFilter) return false;
      if (mpiBloodFilter !== 'ALL' && p.bloodType !== mpiBloodFilter) return false;
      if (mpiAllergyFilter === 'HAS_ALLERGY' && p.allergies.length === 0) return false;
      if (q) {
        const hay = `${p.fullName} ${p.mrNumber} ${p.nik} ${p.bpjsNumber} ${p.address} ${p.phone}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [patients, mpiSearchQuery, mpiGenderFilter, mpiBloodFilter, mpiAllergyFilter]);

  const filteredVisits = useMemo(() => {
    const q = queueSearch.trim().toLowerCase();
    return visits.filter((v) => {
      if (polyFilter !== 'ALL' && v.polyclinic !== polyFilter) return false;
      if (guarantorFilter !== 'ALL' && v.guarantor !== guarantorFilter) return false;
      if (triageFilter !== 'ALL' && v.triageLevel !== triageFilter) return false;
      if (stageFilter !== 'ALL') {
        if (
          stageFilter === 'MENUNGGU_SKRINING' &&
          v.status !== 'MENUNGGU' &&
          v.status !== 'DIPERIKSA_PERAWAT'
        ) {
          return false;
        } else if (stageFilter !== 'MENUNGGU_SKRINING' && v.status !== stageFilter) {
          return false;
        }
      }
      if (q) {
        const hay = `${v.queueNumber} ${v.registrationNumber} ${v.patientName} ${v.mrNumber} ${v.nik} ${v.doctorName} ${v.chiefComplaint}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [visits, queueSearch, polyFilter, guarantorFilter, stageFilter, triageFilter]);

  const filteredBeds = useMemo(() => {
    const q = bedSearch.trim().toLowerCase();
    return beds.filter((b) => {
      if (bedClassFilter !== 'ALL' && b.bedClass !== bedClassFilter) return false;
      if (bedStatusFilter !== 'ALL' && b.status !== bedStatusFilter) return false;
      if (q) {
        const hay = `${b.bedCode} ${b.wardName} ${b.patientName || ''} ${b.mrNumber || ''} ${
          b.diagnosis || ''
        }`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [beds, bedSearch, bedClassFilter, bedStatusFilter]);

  const liveTriage = useMemo(() => evaluateAutoTriage(vitals), [vitals]);
  const liveBmi = useMemo(
    () => calculateBMI(vitals.weightKg, vitals.heightCm),
    [vitals.weightKg, vitals.heightCm]
  );
  const liveMap = useMemo(
    () => calculateMAP(vitals.systolic, vitals.diastolic),
    [vitals.systolic, vitals.diastolic]
  );

  const handleUnifiedRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedbackMessage(null);
    setErrorMessage(null);

    const cleanNik = regNik.replace(/\D/g, '');
    if (!regFullName.trim()) {
      setErrorMessage('Nama Lengkap Pasien wajib diisi.');
      return;
    }
    if (cleanNik.length !== 16) {
      setErrorMessage('NIK KTP wajib berisi tepat 16 digit angka.');
      return;
    }
    if (!regBirthDate) {
      setErrorMessage('Tanggal Lahir pasien wajib diisi.');
      return;
    }
    if (!chiefComplaint.trim()) {
      setErrorMessage('Keluhan utama kunjungan pasien wajib diisi.');
      return;
    }

    setIsSaving(true);
    try {
      const result = await kaelApi.unifiedRegisterVisit(token, activeFacility.code, {
        patientId: matchedPatientId || undefined,
        fullName: regFullName.trim(),
        nik: cleanNik,
        bpjsNumber: regBpjs.trim(),
        birthDate: regBirthDate,
        gender: regGender,
        bloodType: regBloodType,
        rhesus: regRhesus,
        phone: regPhone.trim(),
        address: regAddress.trim(),
        allergies: regAllergies
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        chronicConditions: regChronic
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        emergencyContactName: regEmergencyName.trim(),
        emergencyContactPhone: regEmergencyPhone.trim(),
        polyclinic,
        doctorId: doctorId || doctors[0]?.id || 'usr-doc-01',
        guarantor,
        bpjsSepOrPcareNo: bpjsSepOrPcareNo.trim() || undefined,
        chiefComplaint: chiefComplaint.trim(),
        vitals,
      });

      setChiefComplaint('');
      setBpjsSepOrPcareNo('');
      resetUnifiedPatientForm();
      await onRefreshWorkspace();
      setFeedbackMessage(
        `${
          result.isNewPatient
            ? `Pasien Baru berhasil dibuat (${result.patient.mrNumber}) & `
            : `Data Pasien Terdaftar (${result.patient.mrNumber}) diperbarui & `
        }Nomor Antrean ${result.visit.queueNumber} (${result.visit.patientName}) berhasil diterbitkan.`
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Gagal mendaftarkan kunjungan.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateVisitQueueStatus = async (
    visit: VisitQueueItem,
    nextStatus: VisitQueueItem['status']
  ) => {
    setFeedbackMessage(null);
    setErrorMessage(null);
    try {
      await kaelApi.updateVisitStatus(token, activeFacility.code, visit.id, nextStatus);
      await onRefreshWorkspace();
      setFeedbackMessage(
        `Status antrean ${visit.queueNumber} (${visit.patientName}) diperbarui menjadi ${nextStatus.replace(
          /_/g,
          ' '
        )}.`
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Gagal memperbarui status antrean.');
    }
  };

  const startEditingPatient = (p: Patient) => {
    setEditingPatientId(p.id);
    setMpiFullName(p.fullName);
    setMpiNik(p.nik);
    setMpiBpjs(p.bpjsNumber);
    setMpiBirthDate(p.birthDate);
    setMpiGender(p.gender);
    setMpiBloodType(p.bloodType);
    setMpiRhesus(p.rhesus);
    setMpiPhone(p.phone);
    setMpiAddress(p.address);
    setMpiAllergies(p.allergies.join(', '));
    setMpiChronic(p.chronicConditions.join(', '));
    setMpiEmergencyName(p.emergencyContactName);
    setMpiEmergencyPhone(p.emergencyContactPhone);
  };

  const resetMpiForm = () => {
    setEditingPatientId(null);
    setMpiFullName('');
    setMpiNik('');
    setMpiBpjs('');
    setMpiBirthDate('1990-05-15');
    setMpiGender('L');
    setMpiBloodType('O');
    setMpiRhesus('+');
    setMpiPhone('');
    setMpiAddress('');
    setMpiAllergies('');
    setMpiChronic('');
    setMpiEmergencyName('');
    setMpiEmergencyPhone('');
  };

  const handleSavePatientMpi = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedbackMessage(null);
    setErrorMessage(null);

    if (!mpiFullName.trim() || mpiNik.trim().length !== 16) {
      setErrorMessage('Nama Lengkap dan NIK (16 digit angka) wajib diisi.');
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        fullName: mpiFullName.trim(),
        nik: mpiNik.trim(),
        bpjsNumber: mpiBpjs.trim(),
        birthDate: mpiBirthDate,
        gender: mpiGender,
        bloodType: mpiBloodType,
        rhesus: mpiRhesus,
        phone: mpiPhone.trim(),
        address: mpiAddress.trim(),
        allergies: mpiAllergies
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        chronicConditions: mpiChronic
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        emergencyContactName: mpiEmergencyName.trim(),
        emergencyContactPhone: mpiEmergencyPhone.trim(),
      };

      if (editingPatientId) {
        const updated = await kaelApi.updatePatient(
          token,
          activeFacility.code,
          editingPatientId,
          payload
        );
        await onRefreshWorkspace();
        setFeedbackMessage(
          `Data rekam medis MPI ${updated.fullName} (${updated.mrNumber}) berhasil diperbarui.`
        );
        resetMpiForm();
      } else {
        const created = await kaelApi.createPatient(token, activeFacility.code, payload);
        await onRefreshWorkspace();
        setFeedbackMessage(
          `Pasien baru ${created.fullName} berhasil terdaftar di MPI dengan No. RM ${created.mrNumber}.`
        );
        resetMpiForm();
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Gagal menyimpan pasien MPI.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAssignBed = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignBedId || !assignPatientId) return;
    setFeedbackMessage(null);
    setErrorMessage(null);
    setIsSaving(true);
    try {
      const updated = await kaelApi.assignBed(token, activeFacility.code, assignBedId, {
        patientId: assignPatientId,
        attendingDoctor: assignDoctorName,
        diagnosis: assignDiagnosis,
      });
      setAssignBedId(null);
      await onRefreshWorkspace();
      setFeedbackMessage(
        `Tempat tidur ${updated.bedCode} kini ditempati oleh ${updated.patientName}.`
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Gagal mengalokasikan tempat tidur.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDischargeBed = async (bedId: string, bedCode: string) => {
    setFeedbackMessage(null);
    setErrorMessage(null);
    try {
      await kaelApi.dischargeBed(token, activeFacility.code, bedId);
      await onRefreshWorkspace();
      setFeedbackMessage(`Pasien pada bed ${bedCode} telah dipulangkan. Status bed kini TERSEDIA.`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Gagal memulangkan pasien dari bed.');
    }
  };

  const handleSaveCppt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cpptBedId) return;
    setIsSaving(true);
    try {
      await kaelApi.updateBedStatus(token, activeFacility.code, cpptBedId, {
        diagnosis: cpptNote.trim(),
      });
      setCpptBedId(null);
      await onRefreshWorkspace();
      setFeedbackMessage('Catatan Perkembangan Pasien Terintegrasi berhasil disimpan.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Gagal menyimpan CPPT rawat inap.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangeBedMaintenance = async (
    bedId: string,
    status: InpatientBed['status']
  ) => {
    try {
      await kaelApi.updateBedStatus(token, activeFacility.code, bedId, { status });
      await onRefreshWorkspace();
      setFeedbackMessage(`Status bed berhasil diubah ke ${status}.`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Gagal mengubah status bed.');
    }
  };

  const handleCreateBed = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBedCode.trim() || !newBedWard.trim()) return;
    setIsSaving(true);
    try {
      const created = await kaelApi.createBed(token, activeFacility.code, {
        bedCode: newBedCode.trim(),
        roomNumber: newBedCode.trim(),
        wardName: newBedWard.trim(),
        bedClass: newBedClass,
        dailyRate: Number(newBedRate),
      });
      setNewBedCode('');
      setShowAddBedForm(false);
      await onRefreshWorkspace();
      setFeedbackMessage(`Kamar/Bed baru ${created.bedCode} berhasil ditambahkan.`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Gagal menambah tempat tidur.');
    } finally {
      setIsSaving(false);
    }
  };

  // Stage counts for visual workflow filter
  const stageCounts = {
    all: visits.length,
    menunggu: visits.filter(
      (v) => v.status === 'MENUNGGU' || v.status === 'DIPERIKSA_PERAWAT'
    ).length,
    dokter: visits.filter((v) => v.status === 'DIPERIKSA_DOKTER').length,
    farmasiLab: visits.filter((v) => v.status === 'FARMASI_LAB').length,
    kasir: visits.filter((v) => v.status === 'KASIR').length,
    selesai: visits.filter((v) => v.status === 'SELESAI').length,
  };

  const regExportColumns: ExportColumn<Record<string, unknown>>[] =
    subTab === 'BEDS'
      ? [
          { key: 'bedCode', header: 'Kode Bed' },
          { key: 'wardName', header: 'Bangsal / Paviliun' },
          { key: 'bedClass', header: 'Kelas Kamar' },
          { key: 'status', header: 'Status' },
          { key: 'patientName', header: 'Nama Pasien', format: (r) => String(r.patientName || '-') },
          { key: 'dailyRate', header: 'Tarif Harian' },
        ]
      : subTab === 'MPI'
      ? [
          { key: 'mrNumber', header: 'No. RM' },
          { key: 'fullName', header: 'Nama Pasien' },
          { key: 'nik', header: 'NIK' },
          { key: 'birthDate', header: 'Tgl Lahir' },
          { key: 'gender', header: 'JK' },
          { key: 'phone', header: 'Telepon' },
          { key: 'address', header: 'Alamat' },
        ]
      : [
          { key: 'queueNumber', header: 'No. Antrean' },
          { key: 'patientName', header: 'Nama Pasien' },
          { key: 'mrNumber', header: 'No. RM' },
          { key: 'polyclinic', header: 'Poliklinik' },
          { key: 'doctorName', header: 'Dokter Pemeriksa' },
          { key: 'guarantor', header: 'Penjamin' },
          { key: 'chiefComplaint', header: 'Keluhan Utama' },
          { key: 'status', header: 'Status' },
        ];

  const regExportRows = (
    subTab === 'BEDS' ? filteredBeds : subTab === 'MPI' ? filteredPatients : filteredVisits
  ) as unknown as Record<string, unknown>[];

  return (
    <div className="space-y-5">
      {/* Top Sub-Navigation Banner with Modern Jade Green Palette & Multi-Format Export */}
      <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[#52736B] dark:text-[#86B5A9]">
              LOKET PENDAFTARAN TERPADU &amp; MANAJEMEN KAMAR • {activeFacility.name}
            </div>
            <h2 className="text-xl font-bold text-[#0F2922] dark:text-white mt-0.5 tracking-tight">
              Pendaftaran pasien, antrean &amp; kapasitas tempat tidur
            </h2>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => setSubTab('QUEUE_REG')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-xl transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0 ${
              subTab === 'QUEUE_REG'
                ? 'bg-[#00897B] text-white'
                : 'bg-[#F3F8F6] dark:bg-[#081916] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            1. Pendaftaran &amp; Antrean ({visits.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('MPI')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-xl transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0 ${
              subTab === 'MPI'
                ? 'bg-[#00897B] text-white'
                : 'bg-[#F3F8F6] dark:bg-[#081916] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            2. Database Pasien ({patients.length} RM)
          </button>
          <button
            type="button"
            onClick={() => setSubTab('SCHEDULE')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-xl transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0 ${
              subTab === 'SCHEDULE'
                ? 'bg-[#00897B] text-white'
                : 'bg-[#F3F8F6] dark:bg-[#081916] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
            }`}
          >
            <CalendarClock className="w-3.5 h-3.5" />
            3. Jadwal Praktik ({doctors.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('BEDS')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-xl transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0 ${
              subTab === 'BEDS'
                ? 'bg-[#00897B] text-white'
                : 'bg-[#F3F8F6] dark:bg-[#081916] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
            }`}
          >
            <Bed className="w-3.5 h-3.5" />
            4. Kapasitas Tempat Tidur &amp; Rawat Inap (
            {beds.filter((b) => b.status === 'TERSEDIA').length}/{beds.length} Tersedia)
          </button>
        </div>
      </div>

      {feedbackMessage && (
        <div className="p-3.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-200 flex items-center justify-between">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
            <span>{feedbackMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackMessage(null)}
            className="text-xs underline ml-4"
          >
            Tutup
          </button>
        </div>
      )}

      {errorMessage && (
        <div className="p-3.5 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 font-medium">
          {errorMessage}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 1: PENDAFTARAN PASIEN TERPADU (AUTO-DETECT) & ANTREAN KUNJUNGAN  */}
      {/* ===================================================================== */}
      {subTab === 'QUEUE_REG' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left 5 Cols: Smart Unified Patient + Visit Registration Form */}
          <form
            onSubmit={handleUnifiedRegisterSubmit}
            className="lg:col-span-5 bg-white dark:bg-slate-900 border border-emerald-200 dark:border-slate-800 rounded-xl overflow-hidden"
          >
            {/* Form Header with Auto-Detected Status */}
            <div className="px-5 py-3.5 bg-emerald-50/80 dark:bg-emerald-950/30 border-b border-emerald-200/80 dark:border-slate-800 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">
                  Formulir Pendaftaran Pasien &amp; Antrean Poli/IGD
                </h3>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Ketik Nama, NIK, Tgl Lahir, atau Alamat — sistem otomatis mengecek database.
                </p>
              </div>
              {(regFullName || regNik || matchedPatientId) && (
                <button
                  type="button"
                  onClick={resetUnifiedPatientForm}
                  className="px-2.5 py-1 text-[11px] font-semibold rounded border border-emerald-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-50 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset Form
                </button>
              )}
            </div>

            <div className="p-5 space-y-4">
              {/* Mode Indicator: Existing Matched Patient vs New Patient */}
              <div
                className={`p-3 rounded-lg border text-xs flex items-center justify-between gap-2 ${
                  matchedPatientId
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                    : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                <div>
                  <div className="font-bold">
                    {matchedPatientId
                      ? `Pasien Lama Terdeteksi: ${matchedMrNumber}`
                      : 'Mode: Pasien Baru / Ketik Identitas untuk Cek Database'}
                  </div>
                  <div className="text-[11px] opacity-85 mt-0.5">
                    {matchedPatientId
                      ? 'Seluruh kolom identitas telah terisi otomatis dari Rekam Medis.'
                      : 'Jika data belum ada di database, sistem otomatis membuat No. RM baru.'}
                  </div>
                </div>
                {matchedPatientId && (
                  <button
                    type="button"
                    onClick={() => {
                      setMatchedPatientId(null);
                      setMatchedMrNumber(null);
                    }}
                    className="px-2.5 py-1 text-[11px] font-semibold rounded bg-white dark:bg-slate-900 border border-emerald-400 text-emerald-800 dark:text-emerald-300 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Jadikan Pasien Baru
                  </button>
                )}
              </div>

              {/* STEP 1: IDENTITAS PASIEN (With Live Multi-Field Database Lookup) */}
              <div className="space-y-3">
                <div className="text-xs font-bold text-emerald-800 dark:text-emerald-400 border-b border-slate-100 dark:border-slate-800 pb-1">
                  Langkah 1 — Identitas Pasien
                </div>

                <div>
                  <label
                    htmlFor="reg-fullname-input"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Nama Lengkap Pasien <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="reg-fullname-input"
                    type="text"
                    value={regFullName}
                    onChange={(e) => setRegFullName(e.target.value)}
                    placeholder="Ketik nama pasien, NIK, atau No. RM..."
                    required
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="reg-nik-input"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                    >
                      NIK KTP <span className="text-red-600">*</span>
                    </label>
                    <input
                      id="reg-nik-input"
                      type="text"
                      maxLength={16}
                      value={regNik}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '');
                        setRegNik(val);
                        if (val.length === 16) {
                          const exact = patients.find((p) => p.nik === val);
                          if (exact) {
                            applyMatchedPatientToForm(exact);
                          }
                        }
                      }}
                      placeholder="Ketik 16 digit NIK..."
                      required
                      className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="reg-bpjs-input"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                    >
                      No. Kartu BPJS Kesehatan
                    </label>
                    <input
                      id="reg-bpjs-input"
                      type="text"
                      value={regBpjs}
                      onChange={(e) => {
                        const val = e.target.value;
                        setRegBpjs(val);
                        if (val.trim().length >= 8) {
                          const exactBpjs = patients.find(
                            (p) => p.bpjsNumber && p.bpjsNumber === val.trim()
                          );
                          if (exactBpjs) {
                            applyMatchedPatientToForm(exactBpjs);
                          }
                        }
                      }}
                      placeholder="000182934..."
                      className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="col-span-2">
                    <label
                      htmlFor="reg-birthdate-input"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Tanggal Lahir <span className="text-red-600">*</span>
                    </label>
                    <input
                      id="reg-birthdate-input"
                      type="date"
                      value={regBirthDate}
                      onChange={(e) => setRegBirthDate(e.target.value)}
                      required
                      className="w-full px-2.5 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="reg-gender-select"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Jenis Kelamin
                    </label>
                    <select
                      id="reg-gender-select"
                      value={regGender}
                      onChange={(e) => setRegGender(e.target.value as 'L' | 'P')}
                      className="w-full px-2 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                      <option value="L">Laki-laki</option>
                      <option value="P">Perempuan</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Gol. Darah
                    </label>
                    <div className="flex gap-1">
                      <select
                        aria-label="Golongan Darah"
                        value={regBloodType}
                        onChange={(e) =>
                          setRegBloodType(e.target.value as Patient['bloodType'])
                        }
                        className="w-full px-1.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                      >
                        <option value="O">O</option>
                        <option value="A">A</option>
                        <option value="B">B</option>
                        <option value="AB">AB</option>
                      </select>
                      <select
                        aria-label="Rhesus Darah"
                        value={regRhesus}
                        onChange={(e) => setRegRhesus(e.target.value as '+' | '-')}
                        className="w-11 px-1 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                      >
                        <option value="+">+</option>
                        <option value="-">-</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="reg-phone-input"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                    >
                      No. Telepon / WhatsApp
                    </label>
                    <input
                      id="reg-phone-input"
                      type="text"
                      value={regPhone}
                      onChange={(e) => setRegPhone(e.target.value)}
                      placeholder="0812..."
                      className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="reg-address-input"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Alamat Domisili
                    </label>
                    <input
                      id="reg-address-input"
                      type="text"
                      value={regAddress}
                      onChange={(e) => setRegAddress(e.target.value)}
                      placeholder="Ketik jalan / komplek / desa..."
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="reg-allergy-input"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Alergi Obat / Makanan
                    </label>
                    <input
                      id="reg-allergy-input"
                      type="text"
                      value={regAllergies}
                      onChange={(e) => setRegAllergies(e.target.value)}
                      placeholder="Kosongkan jika tidak ada"
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="reg-chronic-input"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Riwayat Penyakit Kronis
                    </label>
                    <input
                      id="reg-chronic-input"
                      type="text"
                      value={regChronic}
                      onChange={(e) => setRegChronic(e.target.value)}
                      placeholder="Misal: Hipertensi, Diabetes"
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                </div>

                {/* LIVE AUTO-MATCH SUGGESTIONS PANEL */}
                {livePatientCandidates.length > 0 && (
                  <div className="p-3.5 rounded-xl bg-emerald-50/90 dark:bg-emerald-950/60 border border-emerald-400 dark:border-emerald-700 space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold text-emerald-900 dark:text-emerald-200">
                      <span className="flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                        Ditemukan {livePatientCandidates.length} Pasien Cocok di Database ({activeFacility.code})
                      </span>
                      <span className="text-[11px] font-normal text-emerald-700 dark:text-emerald-300">
                        Klik untuk isi otomatis
                      </span>
                    </div>

                    <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
                      {livePatientCandidates.slice(0, 5).map((cand) => {
                        const isCurrentlySelected = matchedPatientId === cand.patient.id;
                        return (
                          <div
                            key={cand.patient.id}
                            className={`p-2.5 rounded-lg border text-xs flex items-center justify-between gap-2 transition-colors ${
                              isCurrentlySelected
                                ? 'bg-emerald-700 text-white border-emerald-800'
                                : 'bg-white dark:bg-slate-900 border-emerald-200 dark:border-slate-700 hover:border-emerald-500'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="font-bold truncate">
                                {cand.patient.fullName} ({cand.patient.gender}) ·{' '}
                                <span className="font-mono">{cand.patient.mrNumber}</span>
                              </div>
                              <div
                                className={`text-[11px] font-mono truncate ${
                                  isCurrentlySelected
                                    ? 'text-emerald-100'
                                    : 'text-slate-500 dark:text-slate-400'
                                }`}
                              >
                                NIK: {cand.patient.nik} · Lahir: {cand.patient.birthDate} ·{' '}
                                {cand.patient.address}
                              </div>
                              <div
                                className={`text-[10px] font-semibold mt-0.5 ${
                                  isCurrentlySelected
                                    ? 'text-amber-300'
                                    : 'text-emerald-700 dark:text-emerald-400'
                                }`}
                              >
                                Cocok pada kolom: {cand.matchedFields.join(', ')}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => applyMatchedPatientToForm(cand.patient)}
                              className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer ${
                                isCurrentlySelected
                                  ? 'bg-amber-400 text-slate-950'
                                  : 'bg-emerald-700 hover:bg-emerald-800 text-white'
                              }`}
                            >
                              {isCurrentlySelected ? 'Terpilih' : 'Gunakan Data Ini'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* STEP 2: TUJUAN POLIKLINIK & PENJAMIN */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
                <div className="text-xs font-bold text-emerald-800 dark:text-emerald-400">
                  Langkah 2 — Unit Poliklinik, Dokter &amp; Keluhan Kunjungan
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="visit-polyclinic-select"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Unit / Poliklinik Tujuan
                    </label>
                    <select
                      id="visit-polyclinic-select"
                      value={polyclinic}
                      onChange={(e) => setPolyclinic(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                      <option value="POLI_PENYAKIT_DALAM">Poli Penyakit Dalam</option>
                      <option value="POLI_GIGI">Poli Gigi &amp; Mulut</option>
                      <option value="IGD">IGD 24 Jam &amp; Triase Darurat</option>
                      <option value="POLI_ANAK">Poli Kesehatan Anak</option>
                      <option value="POLI_UMUM">Poli Umum Pratama</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="visit-doctor-select"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Dokter Pemeriksa
                    </label>
                    <select
                      id="visit-doctor-select"
                      value={doctorId}
                      onChange={(e) => setDoctorId(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                      {doctors.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.fullName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="visit-guarantor-select"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Penjamin Biaya
                    </label>
                    <select
                      id="visit-guarantor-select"
                      value={guarantor}
                      onChange={(e) =>
                        setGuarantor(e.target.value as VisitQueueItem['guarantor'])
                      }
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                      <option value="BPJS_KESEHATAN">BPJS Kesehatan</option>
                      <option value="UMUM">Pasien Umum / Mandiri</option>
                      <option value="ASURANSI_SWASTA">Asuransi Swasta Rekanan</option>
                      <option value="KORPORASI">Jaminan Perusahaan / Korporasi</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="visit-sep-input"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                    >
                      No. SEP / Kunjungan P-Care
                    </label>
                    <input
                      id="visit-sep-input"
                      type="text"
                      value={bpjsSepOrPcareNo}
                      onChange={(e) => setBpjsSepOrPcareNo(e.target.value)}
                      placeholder="Kosongkan untuk auto-generate SEP"
                      className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="visit-complaint-input"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Keluhan Utama <span className="text-red-600">*</span>
                  </label>
                  <textarea
                    id="visit-complaint-input"
                    rows={2}
                    value={chiefComplaint}
                    onChange={(e) => setChiefComplaint(e.target.value)}
                    placeholder="Contoh: Demam tinggi 3 hari disertai nyeri kepala dan mual..."
                    required
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
              </div>

              {/* STEP 3: TANDA VITAL & TRIASE OTOMATIS */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-emerald-800 dark:text-emerald-400">
                    Langkah 3 — Tanda Vital &amp; Triase
                  </span>
                  <span className="text-xs font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                    Triase: {liveTriage.replace(/_/g, ' ')}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-0.5">Sistolik mmHg</label>
                    <input
                      type="number"
                      value={vitals.systolic}
                      onChange={(e) =>
                        setVitals({ ...vitals, systolic: Number(e.target.value) || 0 })
                      }
                      className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-0.5">Diastolik mmHg</label>
                    <input
                      type="number"
                      value={vitals.diastolic}
                      onChange={(e) =>
                        setVitals({ ...vitals, diastolic: Number(e.target.value) || 0 })
                      }
                      className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-0.5">Nadi bpm</label>
                    <input
                      type="number"
                      value={vitals.heartRate}
                      onChange={(e) =>
                        setVitals({ ...vitals, heartRate: Number(e.target.value) || 0 })
                      }
                      className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-0.5">SpO2 %</label>
                    <input
                      type="number"
                      value={vitals.spo2}
                      onChange={(e) =>
                        setVitals({ ...vitals, spo2: Number(e.target.value) || 0 })
                      }
                      className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-0.5">Suhu °C</label>
                    <input
                      type="number"
                      step="0.1"
                      value={vitals.temperature}
                      onChange={(e) =>
                        setVitals({ ...vitals, temperature: Number(e.target.value) || 0 })
                      }
                      className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-0.5">Napas /mnt</label>
                    <input
                      type="number"
                      value={vitals.respiratoryRate}
                      onChange={(e) =>
                        setVitals({ ...vitals, respiratoryRate: Number(e.target.value) || 0 })
                      }
                      className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-0.5">Berat kg</label>
                    <input
                      type="number"
                      value={vitals.weightKg}
                      onChange={(e) =>
                        setVitals({ ...vitals, weightKg: Number(e.target.value) || 0 })
                      }
                      className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-0.5">Tinggi cm</label>
                    <input
                      type="number"
                      value={vitals.heightCm}
                      onChange={(e) =>
                        setVitals({ ...vitals, heightCm: Number(e.target.value) || 0 })
                      }
                      className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                </div>

                <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums flex flex-wrap gap-3">
                  <span>MAP: {liveMap} mmHg</span>
                  <span>·</span>
                  <span>
                    IMT: {liveBmi.bmi} ({liveBmi.category})
                  </span>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSaving}
                className="w-full py-2.5 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                {isSaving
                  ? 'Memproses Pendaftaran...'
                  : matchedPatientId
                  ? `Daftarkan Antrean untuk ${matchedMrNumber}`
                  : 'Simpan Pasien Baru & Terbitkan Nomor Antrean'}
              </button>
            </div>
          </form>

          {/* Right 7 Cols: Active Visit Queue with Visual Workflow Stage Filter & Complete Filters */}
          <div className="lg:col-span-7 space-y-4">
            {/* Interactive 5-Stage Patient Flow Filter */}
            <div className="bg-white dark:bg-slate-900 border border-emerald-200/80 dark:border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Filter Tahap Layanan Pasien Hari Ini
                </span>
                {stageFilter !== 'ALL' && (
                  <button
                    type="button"
                    onClick={() => setStageFilter('ALL')}
                    className="text-xs text-emerald-700 dark:text-emerald-400 underline cursor-pointer"
                  >
                    Tampilkan Semua ({stageCounts.all})
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                <button
                  type="button"
                  onClick={() => setStageFilter('ALL')}
                  className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                    stageFilter === 'ALL'
                      ? 'bg-emerald-700 text-white border-emerald-800'
                      : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:bg-emerald-50'
                  }`}
                >
                  <div className="text-[11px] opacity-80">Semua Tahap</div>
                  <div className="text-base font-bold font-mono tabular-nums">
                    {stageCounts.all}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setStageFilter('MENUNGGU_SKRINING')}
                  className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                    stageFilter === 'MENUNGGU_SKRINING'
                      ? 'bg-emerald-700 text-white border-emerald-800'
                      : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:bg-emerald-50'
                  }`}
                >
                  <div className="text-[11px] opacity-80">1. Menunggu</div>
                  <div className="text-base font-bold font-mono tabular-nums">
                    {stageCounts.menunggu}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setStageFilter('DIPERIKSA_DOKTER')}
                  className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                    stageFilter === 'DIPERIKSA_DOKTER'
                      ? 'bg-emerald-700 text-white border-emerald-800'
                      : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:bg-emerald-50'
                  }`}
                >
                  <div className="text-[11px] opacity-80">2. Di Dokter</div>
                  <div className="text-base font-bold font-mono tabular-nums">
                    {stageCounts.dokter}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setStageFilter('FARMASI_LAB')}
                  className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                    stageFilter === 'FARMASI_LAB'
                      ? 'bg-emerald-700 text-white border-emerald-800'
                      : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:bg-emerald-50'
                  }`}
                >
                  <div className="text-[11px] opacity-80">3. Obat / Lab</div>
                  <div className="text-base font-bold font-mono tabular-nums">
                    {stageCounts.farmasiLab}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setStageFilter('KASIR')}
                  className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                    stageFilter === 'KASIR'
                      ? 'bg-emerald-700 text-white border-emerald-800'
                      : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:bg-emerald-50'
                  }`}
                >
                  <div className="text-[11px] opacity-80">4. Kasir</div>
                  <div className="text-base font-bold font-mono tabular-nums">
                    {stageCounts.kasir}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setStageFilter('SELESAI')}
                  className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                    stageFilter === 'SELESAI'
                      ? 'bg-emerald-700 text-white border-emerald-800'
                      : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:bg-emerald-50'
                  }`}
                >
                  <div className="text-[11px] opacity-80">5. Selesai</div>
                  <div className="text-base font-bold font-mono tabular-nums">
                    {stageCounts.selesai}
                  </div>
                </button>
              </div>
            </div>

            {/* Queue Table Card with Multi-Filter Bar */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-emerald-50/40 dark:bg-slate-800/40 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">
                      Daftar Antrean Kunjungan Aktif ({filteredVisits.length})
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Panggil pasien ke ruang periksa atau klik RME untuk mengisi rekam medis dokter.
                    </p>
                  </div>
                  <DataExportToolbar
                    title="Daftar Antrean Kunjungan Pasien"
                    filenameBase={`KAEL_Antrean_${activeFacility.code}`}
                    facilityName={activeFacility.name}
                    facilityCode={activeFacility.code}
                    columns={regExportColumns}
                    rows={regExportRows}
                    compact
                    contextLabel="Ekspor Antrean"
                  />
                </div>

                {/* Complete Filter Controls */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 text-xs">
                  <div className="sm:col-span-4 relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={queueSearch}
                      onChange={(e) => setQueueSearch(e.target.value)}
                      placeholder="Cari Nama, No. Antrean, RM, NIK..."
                      className="w-full pl-8 pr-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <select
                      aria-label="Filter Poliklinik"
                      value={polyFilter}
                      onChange={(e) => setPolyFilter(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                      <option value="ALL">Semua Unit / Poli</option>
                      <option value="POLI_PENYAKIT_DALAM">Poli Penyakit Dalam</option>
                      <option value="POLI_GIGI">Poli Gigi &amp; Mulut</option>
                      <option value="IGD">IGD 24 Jam</option>
                      <option value="POLI_ANAK">Poli Anak</option>
                      <option value="POLI_UMUM">Poli Umum</option>
                    </select>
                  </div>

                  <div className="sm:col-span-3">
                    <select
                      aria-label="Filter Penjamin"
                      value={guarantorFilter}
                      onChange={(e) => setGuarantorFilter(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                      <option value="ALL">Semua Penjamin</option>
                      <option value="BPJS_KESEHATAN">BPJS Kesehatan</option>
                      <option value="UMUM">Pasien Umum</option>
                      <option value="ASURANSI_SWASTA">Asuransi Swasta</option>
                      <option value="KORPORASI">Korporasi</option>
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <select
                      aria-label="Filter Triase"
                      value={triageFilter}
                      onChange={(e) => setTriageFilter(e.target.value)}
                      className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                      <option value="ALL">Semua Triase</option>
                      <option value="RESUSITASI_MERAH">Merah — Resusitasi</option>
                      <option value="EMERGENSI_KUNING">Kuning — Emergensi</option>
                      <option value="URGENSI_HIJAU">Hijau — Urgensi</option>
                      <option value="NON_URGEN_PUTIH">Putih — Non-Urgen</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-800/50">
                      <th className="py-2.5 px-2.5">Antrean</th>
                      <th className="py-2.5 px-2.5">Pasien &amp; RM</th>
                      <th className="py-2.5 px-2.5">Poli &amp; Dokter</th>
                      <th className="py-2.5 px-2.5">Triase &amp; TTV</th>
                      <th className="py-2.5 px-2.5">Tahap</th>
                      <th className="py-2.5 px-2.5 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                    {filteredVisits.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-500">
                          Tidak ada antrean yang cocok dengan filter yang dipilih.
                        </td>
                      </tr>
                    ) : (
                      filteredVisits.map((v) => (
                        <tr
                          key={v.id}
                          className="hover:bg-emerald-50/40 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="py-3 px-2.5 font-mono font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            <div className="text-emerald-800 dark:text-emerald-300">
                              {v.queueNumber}
                            </div>
                            <div className="text-[10px] font-normal text-slate-500">
                              {v.guarantor.replace(/_/g, ' ')}
                            </div>
                          </td>
                          <td className="py-3 px-2.5">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {v.patientName}
                            </div>
                            <div className="text-[10px] font-mono text-slate-500">
                              {v.mrNumber} · {calculatePatientAge(v.birthDate)} thn ({v.gender})
                            </div>
                          </td>
                          <td className="py-3 px-2.5">
                            <div className="font-medium text-slate-800 dark:text-slate-200">
                              {v.polyclinic.replace(/_/g, ' ')}
                            </div>
                            <div className="text-[10px] text-slate-500">{v.doctorName}</div>
                          </td>
                          <td className="py-3 px-2.5 font-mono tabular-nums whitespace-nowrap">
                            <div
                              className={`text-[11px] font-semibold ${
                                v.triageLevel.includes('MERAH')
                                  ? 'text-red-600 dark:text-red-400'
                                  : v.triageLevel.includes('KUNING')
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-emerald-700 dark:text-emerald-400'
                              }`}
                            >
                              {v.triageLevel.replace(/_/g, ' ')}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              TD {v.vitals.systolic}/{v.vitals.diastolic} · SpO2 {v.vitals.spo2}%
                            </div>
                          </td>
                          <td className="py-3 px-2.5 font-mono text-[11px]">
                            <select
                              aria-label={`Ubah status ${v.queueNumber}`}
                              value={v.status}
                              onChange={(e) =>
                                handleUpdateVisitQueueStatus(
                                  v,
                                  e.target.value as VisitQueueItem['status']
                                )
                              }
                              className="px-1.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-[10px] font-semibold"
                            >
                              <option value="MENUNGGU">MENUNGGU</option>
                              <option value="DIPERIKSA_PERAWAT">SKRINING</option>
                              <option value="DIPERIKSA_DOKTER">DI DOKTER</option>
                              <option value="FARMASI_LAB">OBAT / LAB</option>
                              <option value="KASIR">KASIR</option>
                              <option value="SELESAI">SELESAI</option>
                              <option value="BATAL">BATAL</option>
                            </select>
                          </td>
                          <td className="py-3 px-2.5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  handleUpdateVisitQueueStatus(v, 'DIPERIKSA_DOKTER')
                                }
                                title="Panggil Pasien ke Ruang Periksa"
                                className="px-2 py-1 text-[11px] font-medium rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Volume2 className="w-3 h-3" />
                                Panggil
                              </button>
                              <button
                                type="button"
                                onClick={() => onSelectVisitForRme(v.id)}
                                className="px-2.5 py-1 text-[11px] font-semibold rounded bg-emerald-700 hover:bg-emerald-800 text-white transition-colors inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Stethoscope className="w-3 h-3" />
                                RME
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 2: DATABASE PASIEN (MPI) — CREATE, EDIT & FILTER                  */}
      {/* ===================================================================== */}
      {subTab === 'MPI' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Form Registrasi / Edit Pasien MPI */}
          <form
            onSubmit={handleSavePatientMpi}
            className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-3.5"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">
                {editingPatientId
                  ? 'Edit Data Rekam Medis Pasien'
                  : 'Tambah Pasien Baru ke Database MPI'}
              </h3>
              {editingPatientId && (
                <button
                  type="button"
                  onClick={resetMpiForm}
                  className="text-xs text-slate-500 hover:text-slate-800 underline cursor-pointer"
                >
                  Batal Edit
                </button>
              )}
            </div>

            {mpiLiveDuplicates.length > 0 && !editingPatientId && (
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 text-xs space-y-1.5">
                <div className="font-bold text-amber-900 dark:text-amber-200">
                  Data Serupa Sudah Ada di Database ({mpiLiveDuplicates.length} Pasien):
                </div>
                {mpiLiveDuplicates.slice(0, 2).map((dup) => (
                  <div
                    key={dup.patient.id}
                    className="flex items-center justify-between gap-2 bg-white dark:bg-slate-900 p-2 rounded border border-amber-200 dark:border-slate-700"
                  >
                    <div className="truncate">
                      <strong>{dup.patient.fullName}</strong> ({dup.patient.mrNumber}) · Cocok:{' '}
                      {dup.matchedFields.join(', ')}
                    </div>
                    <button
                      type="button"
                      onClick={() => startEditingPatient(dup.patient)}
                      className="px-2 py-1 text-[11px] font-semibold rounded bg-emerald-700 text-white shrink-0 cursor-pointer"
                    >
                      Gunakan / Edit
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Nama Lengkap Pasien
              </label>
              <input
                type="text"
                value={mpiFullName}
                onChange={(e) => setMpiFullName(e.target.value)}
                placeholder="Contoh: Ny. Ratna Sari Dewi"
                required
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  NIK KTP
                </label>
                <input
                  type="text"
                  maxLength={16}
                  value={mpiNik}
                  onChange={(e) => setMpiNik(e.target.value.replace(/\D/g, ''))}
                  placeholder="3204123456780001"
                  required
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nomor Kartu BPJS Kesehatan
                </label>
                <input
                  type="text"
                  value={mpiBpjs}
                  onChange={(e) => setMpiBpjs(e.target.value)}
                  placeholder="0001234567890"
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Tanggal Lahir
                </label>
                <input
                  type="date"
                  value={mpiBirthDate}
                  onChange={(e) => setMpiBirthDate(e.target.value)}
                  required
                  className="w-full px-2.5 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Gender
                </label>
                <select
                  value={mpiGender}
                  onChange={(e) => setMpiGender(e.target.value as 'L' | 'P')}
                  className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="L">Laki-laki</option>
                  <option value="P">Perempuan</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Gol. Darah
                </label>
                <div className="flex gap-1">
                  <select
                    value={mpiBloodType}
                    onChange={(e) =>
                      setMpiBloodType(e.target.value as 'A' | 'B' | 'AB' | 'O')
                    }
                    className="w-full px-2 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    <option value="O">O</option>
                    <option value="A">A</option>
                    <option value="B">B</option>
                    <option value="AB">AB</option>
                  </select>
                  <select
                    value={mpiRhesus}
                    onChange={(e) => setMpiRhesus(e.target.value as '+' | '-')}
                    className="w-12 px-1 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    <option value="+">+</option>
                    <option value="-">-</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nomor Telepon / WhatsApp
                </label>
                <input
                  type="text"
                  value={mpiPhone}
                  onChange={(e) => setMpiPhone(e.target.value)}
                  placeholder="0812..."
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Alamat Domisili
                </label>
                <input
                  type="text"
                  value={mpiAddress}
                  onChange={(e) => setMpiAddress(e.target.value)}
                  placeholder="Jl. Raya..."
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Riwayat Alergi Obat / Makanan
                </label>
                <input
                  type="text"
                  value={mpiAllergies}
                  onChange={(e) => setMpiAllergies(e.target.value)}
                  placeholder="Contoh: Penisilin, Aspirin"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Penyakit Kronis / Komorbid
                </label>
                <input
                  type="text"
                  value={mpiChronic}
                  onChange={(e) => setMpiChronic(e.target.value)}
                  placeholder="Contoh: Hipertensi, Diabetes"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Kontak Darurat
                </label>
                <input
                  type="text"
                  value={mpiEmergencyName}
                  onChange={(e) => setMpiEmergencyName(e.target.value)}
                  placeholder="Nama penanggung jawab"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Telepon Kontak Darurat
                </label>
                <input
                  type="text"
                  value={mpiEmergencyPhone}
                  onChange={(e) => setMpiEmergencyPhone(e.target.value)}
                  placeholder="0813..."
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSaving}
              className="w-full py-2.5 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              {isSaving
                ? 'Menyimpan ke Server...'
                : editingPatientId
                ? 'Simpan Perubahan Data Pasien MPI'
                : 'Simpan Pasien & Terbitkan Nomor RM'}
            </button>
          </form>

          {/* Right: Daftar Master Patient Index with Filters */}
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-emerald-50/40 dark:bg-slate-800/40 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">
                  Database Rekam Medis Pasien ({filteredPatients.length} dari {patients.length})
                </h3>
                <DataExportToolbar
                  title="Data Indeks Pasien"
                  filenameBase={`KAEL_MPI_${activeFacility.code}`}
                  facilityName={activeFacility.name}
                  facilityCode={activeFacility.code}
                  columns={regExportColumns}
                  rows={regExportRows}
                  compact
                  contextLabel="Ekspor Tabel MPI"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 text-xs">
                <div className="sm:col-span-5 relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={mpiSearchQuery}
                    onChange={(e) => setMpiSearchQuery(e.target.value)}
                    placeholder="Cari Nama, No. RM, NIK, BPJS, Alamat..."
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div className="sm:col-span-2">
                  <select
                    value={mpiGenderFilter}
                    onChange={(e) =>
                      setMpiGenderFilter(e.target.value as 'ALL' | 'L' | 'P')
                    }
                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    <option value="ALL">Semua Gender</option>
                    <option value="L">Laki-laki</option>
                    <option value="P">Perempuan</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <select
                    value={mpiBloodFilter}
                    onChange={(e) => setMpiBloodFilter(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    <option value="ALL">Semua Gol. Darah</option>
                    <option value="O">Gol. O</option>
                    <option value="A">Gol. A</option>
                    <option value="B">Gol. B</option>
                    <option value="AB">Gol. AB</option>
                  </select>
                </div>
                <div className="sm:col-span-3">
                  <select
                    value={mpiAllergyFilter}
                    onChange={(e) =>
                      setMpiAllergyFilter(e.target.value as 'ALL' | 'HAS_ALLERGY')
                    }
                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    <option value="ALL">Semua Status Alergi</option>
                    <option value="HAS_ALLERGY">Ada Alergi Obat</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 bg-slate-50/70 dark:bg-slate-800/50">
                    <th className="py-3 px-4">No. RM &amp; IHS</th>
                    <th className="py-3 px-4">Identitas Pasien</th>
                    <th className="py-3 px-4">NIK &amp; BPJS</th>
                    <th className="py-3 px-4">Alergi &amp; Komorbid</th>
                    <th className="py-3 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                  {filteredPatients.map((p) => (
                    <tr
                      key={p.id}
                      className="hover:bg-emerald-50/30 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3.5 px-4 font-mono">
                        <div className="font-bold text-emerald-800 dark:text-emerald-300">
                          {p.mrNumber}
                        </div>
                        <div className="text-[11px] text-slate-500">IHS: {p.ihsNumber}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {p.fullName}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {calculatePatientAge(p.birthDate)} thn · Gol. {p.bloodType}
                          {p.rhesus} · {p.address}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px]">
                        <div>NIK: {p.nik}</div>
                        <div className="text-slate-500">BPJS: {p.bpjsNumber || '-'}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        {p.allergies.length > 0 ? (
                          <div className="text-red-600 dark:text-red-400 font-semibold text-[11px]">
                            Alergi: {p.allergies.join(', ')}
                          </div>
                        ) : (
                          <div className="text-slate-400 text-[11px]">Tidak ada alergi obat</div>
                        )}
                        {p.chronicConditions.length > 0 && (
                          <div className="text-[11px] text-slate-500">
                            Kronis: {p.chronicConditions.join(', ')}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => startEditingPatient(p)}
                            className="px-2.5 py-1.5 text-xs font-medium rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Edit3 className="w-3 h-3" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              applyMatchedPatientToForm(p);
                              setSubTab('QUEUE_REG');
                            }}
                            className="px-2.5 py-1.5 text-xs font-semibold rounded bg-emerald-700 text-white hover:bg-emerald-800 cursor-pointer"
                          >
                            Daftarkan Poli
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 3: JADWAL PRAKTIK DOKTER & KUOTA POLIKLINIK                       */}
      {/* ===================================================================== */}
      {subTab === 'SCHEDULE' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">
                Jadwal Praktik Dokter &amp; Kapasitas Kuota Harian ({activeFacility.name})
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Integrasi Antrean JKN Mobile &amp; Kuota Poliklinik Spesialis / Umum
              </p>
            </div>
          </div>

          <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {doctors.map((doc) => {
              const docVisits = visits.filter((v) => v.doctorId === doc.id);
              const completedCount = docVisits.filter((v) => v.status === 'SELESAI').length;
              const dailyQuota = 30;
              return (
                <div
                  key={doc.id}
                  className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex flex-col justify-between space-y-4"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                          {doc.fullName}
                        </div>
                        <div className="text-xs text-emerald-700 dark:text-emerald-400 font-medium mt-0.5">
                          {doc.specialization || 'Dokter Spesialis / Umum'}
                        </div>
                      </div>
                      <UserCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                    </div>

                    <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs space-y-1 font-mono text-slate-600 dark:text-slate-300">
                      <div>SIP: {doc.nipOrSip}</div>
                      <div>Poliklinik: {(doc.polyclinic || 'POLI_UMUM').replace(/_/g, ' ')}</div>
                      <div>Jam Praktik: Senin - Sabtu · 08:00 - 16:00 WIB</div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                      <span className="text-slate-500">Kuota Terpakai Hari Ini:</span>
                      <span className="font-bold text-slate-900 dark:text-slate-100">
                        {docVisits.length} / {dailyQuota} Pasien ({completedCount} Selesai)
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-600"
                        style={{
                          width: `${Math.min(100, Math.round((docVisits.length / dailyQuota) * 100))}%`,
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setDoctorId(doc.id);
                        if (doc.polyclinic) setPolyclinic(doc.polyclinic);
                        setSubTab('QUEUE_REG');
                      }}
                      className="w-full mt-2 py-2 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Daftarkan Pasien ke Dokter Ini
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 4: MANAJEMEN KAMAR RAWAT INAP, BED & CPPT (WITH FILTERS)          */}
      {/* ===================================================================== */}
      {subTab === 'BEDS' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px] text-xs">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={bedSearch}
                  onChange={(e) => setBedSearch(e.target.value)}
                  placeholder="Cari Kode Bed, Bangsal, atau Nama Pasien..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>

              <select
                value={bedClassFilter}
                onChange={(e) => setBedClassFilter(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="ALL">Semua Kelas Kamar</option>
                <option value="VIP">VIP</option>
                <option value="KELAS_1">Kelas 1</option>
                <option value="KELAS_2">Kelas 2</option>
                <option value="KELAS_3">Kelas 3</option>
                <option value="ICU">ICU / HCU</option>
                <option value="ISOLASI">Isolasi</option>
              </select>

              <select
                value={bedStatusFilter}
                onChange={(e) => setBedStatusFilter(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="ALL">Semua Status Bed</option>
                <option value="TERSEDIA">Tersedia</option>
                <option value="TERISI">Terisi Pasien</option>
                <option value="DIBERSIHKAN">Sedang Sterilisasi</option>
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <DataExportToolbar
                title="Laporan Kapasitas Tempat Tidur & Rawat Inap"
                filenameBase={`KAEL_Beds_${activeFacility.code}`}
                facilityName={activeFacility.name}
                facilityCode={activeFacility.code}
                columns={regExportColumns}
                rows={regExportRows}
                compact
                contextLabel="Ekspor Data Bed"
              />
              <button
                type="button"
                onClick={() => setShowAddBedForm((prev) => !prev)}
                className="px-3.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Tambah Kamar / Bed Baru
              </button>
            </div>
          </div>

          {showAddBedForm && (
            <form
              onSubmit={handleCreateBed}
              className="bg-white dark:bg-slate-900 border border-emerald-600 rounded-xl p-5 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end"
            >
              <div>
                <label className="block text-xs font-semibold mb-1">Kode Bed</label>
                <input
                  type="text"
                  value={newBedCode}
                  onChange={(e) => setNewBedCode(e.target.value.toUpperCase())}
                  placeholder="VIP-A02"
                  required
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Nama Bangsal / Paviliun</label>
                <input
                  type="text"
                  value={newBedWard}
                  onChange={(e) => setNewBedWard(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Kelas Kamar</label>
                <select
                  value={newBedClass}
                  onChange={(e) =>
                    setNewBedClass(e.target.value as InpatientBed['bedClass'])
                  }
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="VIP">VIP</option>
                  <option value="KELAS_1">KELAS 1</option>
                  <option value="KELAS_2">KELAS 2</option>
                  <option value="KELAS_3">KELAS 3</option>
                  <option value="ICU">ICU / HCU</option>
                  <option value="ISOLASI">ISOLASI</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Tarif / Hari</label>
                <input
                  type="number"
                  value={newBedRate}
                  onChange={(e) => setNewBedRate(Number(e.target.value) || 0)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <button
                type="submit"
                disabled={isSaving}
                className="py-2 px-4 rounded-lg bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 cursor-pointer"
              >
                Simpan Bed
              </button>
            </form>
          )}

          {assignBedId && (
            <form
              onSubmit={handleAssignBed}
              className="bg-white dark:bg-slate-900 border border-emerald-600 rounded-xl p-6 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">
                  Admisi Pasien ke Tempat Tidur Rawat Inap
                </h3>
                <button
                  type="button"
                  onClick={() => setAssignBedId(null)}
                  className="text-xs text-slate-500 hover:underline"
                >
                  Batal
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold mb-1">Pilih Pasien</label>
                  <select
                    value={assignPatientId}
                    onChange={(e) => setAssignPatientId(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    {patients.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.mrNumber} — {p.fullName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">DPJP Rawat Inap</label>
                  <input
                    type="text"
                    value={assignDoctorName}
                    onChange={(e) => setAssignDoctorName(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">
                    Diagnosis Masuk &amp; Instruksi CPPT Awal
                  </label>
                  <input
                    type="text"
                    value={assignDiagnosis}
                    onChange={(e) => setAssignDiagnosis(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={isSaving}
                className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 cursor-pointer"
              >
                Konfirmasi Masuk Rawat Inap
              </button>
            </form>
          )}

          {cpptBedId && (
            <form
              onSubmit={handleSaveCppt}
              className="bg-white dark:bg-slate-900 border border-emerald-600 rounded-xl p-5 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  Catatan Perkembangan Pasien Terintegrasi &amp; Diagnosis Rawat Inap
                </h4>
                <button
                  type="button"
                  onClick={() => setCpptBedId(null)}
                  className="text-xs text-slate-500 underline"
                >
                  Tutup
                </button>
              </div>
              <textarea
                rows={2}
                value={cpptNote}
                onChange={(e) => setCpptNote(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                placeholder="Tuliskan evaluasi visite dokter / instruksi keperawatan terbaru..."
              />
              <button
                type="submit"
                disabled={isSaving}
                className="px-4 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 cursor-pointer"
              >
                Simpan CPPT
              </button>
            </form>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredBeds.map((bed) => (
              <div
                key={bed.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-base font-bold text-slate-900 dark:text-slate-100">
                      {bed.bedCode}
                    </span>
                    <span
                      className={`text-xs font-mono font-semibold ${
                        bed.status === 'TERSEDIA'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : bed.status === 'TERISI'
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-slate-500'
                      }`}
                    >
                      {bed.status}
                    </span>
                  </div>
                  <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mt-1">
                    {bed.wardName} · Kelas {bed.bedClass.replace(/_/g, ' ')}
                  </div>
                  <div className="text-xs font-mono text-slate-500 mt-0.5 tabular-nums">
                    Tarif Kamar: Rp {bed.dailyRate.toLocaleString('id-ID')} / hari
                  </div>

                  {bed.status === 'TERISI' ? (
                    <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs space-y-1">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        Pasien: {bed.patientName} ({bed.mrNumber})
                      </div>
                      <div className="text-slate-600 dark:text-slate-400">
                        DPJP: {bed.attendingDoctor}
                      </div>
                      <div className="text-slate-600 dark:text-slate-400">
                        Diagnosis / CPPT: {bed.diagnosis}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                      Kamar siap menerima pasien rawat inap atau observasi IGD.
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between gap-2">
                  {bed.status === 'TERSEDIA' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setAssignBedId(bed.id)}
                        className="flex-1 py-2 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition-colors cursor-pointer"
                      >
                        Alokasikan Pasien
                      </button>
                      <button
                        type="button"
                        onClick={() => handleChangeBedMaintenance(bed.id, 'DIBERSIHKAN')}
                        className="py-2 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300 hover:bg-slate-100 cursor-pointer"
                      >
                        Sterilisasi
                      </button>
                    </>
                  ) : bed.status === 'TERISI' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setCpptBedId(bed.id);
                          setCpptNote(bed.diagnosis || '');
                        }}
                        className="py-2 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        CPPT
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDischargeBed(bed.id, bed.bedCode)}
                        className="flex-1 py-2 px-3 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
                      >
                        Pulangkan Pasien
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleChangeBedMaintenance(bed.id, 'TERSEDIA')}
                      className="w-full py-2 px-3 rounded-lg bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 cursor-pointer"
                    >
                      Tandai Selesai Sterilisasi
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
