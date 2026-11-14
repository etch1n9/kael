import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  FlaskConical,
  Pill,
  Plus,
  Printer,
  Save,
  Stethoscope,
  Trash2,
} from 'lucide-react';
import {
  ClinicalProcedureItem,
  OdontogramEntry,
  PrescriptionItem,
  SoapRecord,
  ToothCondition,
  VisitQueueItem,
  VitalSigns,
} from '../domain/simrs.ts';
import { kaelApi, WorkspacePayload } from '../utils/apiClient';
import {
  calculateBMI,
  calculateGCS,
  calculateMAP,
  checkClinicalSafetyAlerts,
  formatRupiah,
  ICD10_CATALOG,
  ICD9_PROCEDURES_CATALOG,
  LAB_PARAMETER_TEMPLATES,
} from '../domain/clinicalLogic.ts';
import { DataExportToolbar } from './DataExportToolbar';
import { blankVitals, hasCompleteVitals } from '../utils/vitalSigns';
import { VitalSignsFields } from './VitalSignsFields';
import { ExportColumn } from '../utils/exportDocument';

import { ModuleKey } from '../domain/simrs.ts';

interface DoctorRmeModuleProps {
  token: string;
  facilityCode: string;
  workspace: WorkspacePayload;
  selectedVisitId: string | null;
  initialSubView?: ModuleKey;
  onSelectVisitId: (visitId: string) => void;
  onRefreshWorkspace: () => Promise<void>;
}

const UPPER_RIGHT_TEETH = [18, 17, 16, 15, 14, 13, 12, 11];
const UPPER_LEFT_TEETH = [21, 22, 23, 24, 25, 26, 27, 28];
const LOWER_RIGHT_TEETH = [48, 47, 46, 45, 44, 43, 42, 41];
const LOWER_LEFT_TEETH = [31, 32, 33, 34, 35, 36, 37, 38];

const TOOTH_CONDITION_LABELS: Record<ToothCondition, { short: string; label: string; colorClass: string }> = {
  NORMAL: { short: 'N', label: 'Normal / Sehat', colorClass: 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300' },
  CARIES: { short: 'K', label: 'Karies / Berlubang', colorClass: 'border-red-600 bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 font-bold' },
  FILLING_COMPOSITE: { short: 'TK', label: 'Tambalan Komposit', colorClass: 'border-teal-600 bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300 font-bold' },
  FILLING_AMALGAM: { short: 'TA', label: 'Tambalan Amalgam', colorClass: 'border-slate-600 bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100 font-bold' },
  ROOT_CANAL: { short: 'PSA', label: 'Perawatan Saluran Akar', colorClass: 'border-amber-600 bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-bold' },
  CROWN: { short: 'CR', label: 'Mahkota Tiruan / Crown', colorClass: 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-bold' },
  MISSING: { short: 'M', label: 'Hilang / Dicabut', colorClass: 'border-slate-400 bg-slate-100 dark:bg-slate-800 text-slate-400 line-through' },
  IMPACTED: { short: 'IMP', label: 'Impaksi / Tidak Erupsi', colorClass: 'border-orange-600 bg-orange-50 dark:bg-orange-950/60 text-orange-800 dark:text-orange-300 font-bold' },
  FRACTURE: { short: 'FR', label: 'Fraktur Mahkota/Akar', colorClass: 'border-rose-600 bg-rose-50 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 font-bold' },
};

export const DoctorRmeModule: React.FC<DoctorRmeModuleProps> = ({
  token,
  facilityCode,
  workspace,
  selectedVisitId,
  initialSubView = 'RME_DOKTER',
  onSelectVisitId,
  onRefreshWorkspace,
}) => {
  const activeVisit: VisitQueueItem | undefined = useMemo(() => {
    if (selectedVisitId) {
      const found = workspace.visits.find((v) => v.id === selectedVisitId);
      if (found) return found;
    }
    return workspace.visits[0];
  }, [workspace.visits, selectedVisitId]);

  const activePatient = useMemo(() => {
    if (!activeVisit) return undefined;
    return workspace.patients.find((p) => p.id === activeVisit.patientId);
  }, [workspace.patients, activeVisit]);

  const existingSoap = useMemo(() => {
    if (!activeVisit) return undefined;
    return workspace.soapRecords.find((s) => s.visitId === activeVisit.id);
  }, [workspace.soapRecords, activeVisit]);

  // SOAP Form State
  const [correctionReason, setCorrectionReason] = useState('');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [historyPresent, setHistoryPresent] = useState('');
  const [pastMedicalHistory, setPastMedicalHistory] = useState('');
  const [reviewOfSystems, setReviewOfSystems] = useState('');

  const [physicalExamGeneral, setPhysicalExamGeneral] = useState('');
  const [headToToeNotes, setHeadToToeNotes] = useState('');
  const [vitals, setVitals] = useState<VitalSigns>(blankVitals);

  // Odontogram State
  const [showOdontogram, setShowOdontogram] = useState(false);
  const [odontogram, setOdontogram] = useState<OdontogramEntry[]>([]);
  const [selectedTooth, setSelectedTooth] = useState<number | ''>('');
  const [selectedToothCondition, setSelectedToothCondition] = useState<ToothCondition | ''>('');
  const [selectedToothSurface, setSelectedToothSurface] = useState<OdontogramEntry['surface'] | ''>('');
  const [selectedToothNotes, setSelectedToothNotes] = useState('');

  // Assessment ICD-10 State
  const [icd10Search, setIcd10Search] = useState('');
  const [primaryIcd10Code, setPrimaryIcd10Code] = useState('');
  const [primaryIcd10Name, setPrimaryIcd10Name] = useState('');
  const [secondaryIcd10, setSecondaryIcd10] = useState<{ code: string; name: string }[]>([]);
  const [clinicalImpression, setClinicalImpression] = useState('');
  const [prognosis, setPrognosis] = useState<SoapRecord['assessment']['prognosis'] | ''>('');

  // Plan State
  const [therapyNotes, setTherapyNotes] = useState('');
  const [educationNotes, setEducationNotes] = useState('');
  const [disposition, setDisposition] = useState<SoapRecord['plan']['disposition'] | ''>('');
  const [sickLeaveDays, setSickLeaveDays] = useState(0);
  const [procedures, setProcedures] = useState<ClinicalProcedureItem[]>([]);
  const [prescriptions, setPrescriptions] = useState<PrescriptionItem[]>([]);
  const [labRequestedParams, setLabRequestedParams] = useState<string[]>([]);

  // Prescription Builder Inputs
  const [selectedMedId, setSelectedMedId] = useState('');
  const [rxDosage, setRxDosage] = useState('');
  const [rxSigna, setRxSigna] = useState('');
  const [rxQuantity, setRxQuantity] = useState(1);

  // Procedure Builder Input
  const [selectedIcd9Code, setSelectedIcd9Code] = useState('');
  const [procedureTariff, setProcedureTariff] = useState<number | ''>('');

  // UI Status
  const [isSaving, setIsSaving] = useState(false);
  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [showPrintCertificate, setShowPrintCertificate] = useState(false);
  const [printDocType, setPrintDocType] = useState<
    'SURAT_SAKIT' | 'SURAT_SEHAT' | 'SURAT_RUJUKAN' | 'INFORMED_CONSENT' | 'SALINAN_RESEP'
  >('SURAT_SAKIT');
  const [showPatientHistory, setShowPatientHistory] = useState(false);

  // Sync form when activeVisit or initialSubView changes
  useEffect(() => {
    if (!activeVisit) return;
    setCorrectionReason('');
    setSelectedMedId(''); setRxDosage(''); setRxSigna(''); setRxQuantity(1);
    setSelectedIcd9Code(''); setProcedureTariff('');
    setSelectedTooth(''); setSelectedToothCondition(''); setSelectedToothSurface(''); setSelectedToothNotes('');
    setShowOdontogram(
      initialSubView === 'GIGI_ODONTOGRAM' || activeVisit.polyclinic === 'POLI_GIGI'
    );
    if (initialSubView === 'MCU_SURAT_MEDIS') {
      setShowPrintCertificate(true);
    }
    if (existingSoap) {
      setChiefComplaint(existingSoap.subjective.chiefComplaint);
      setHistoryPresent(existingSoap.subjective.historyOfPresentIllness);
      setPastMedicalHistory(existingSoap.subjective.pastMedicalHistory);
      setReviewOfSystems(existingSoap.subjective.reviewOfSystems);
      setPhysicalExamGeneral(existingSoap.objective.physicalExamGeneral);
      setHeadToToeNotes(existingSoap.objective.headToToeNotes);
      setVitals(existingSoap.objective.vitals);
      setOdontogram(existingSoap.objective.odontogram || []);
      setPrimaryIcd10Code(existingSoap.assessment.primaryIcd10Code);
      setPrimaryIcd10Name(existingSoap.assessment.primaryIcd10Name);
      setSecondaryIcd10(existingSoap.assessment.secondaryIcd10 || []);
      setClinicalImpression(existingSoap.assessment.clinicalImpression);
      setPrognosis(existingSoap.assessment.prognosis);
      setTherapyNotes(existingSoap.plan.therapyNotes);
      setEducationNotes(existingSoap.plan.educationNotes);
      setDisposition(existingSoap.plan.disposition);
      setSickLeaveDays(existingSoap.plan.sickLeaveDays);
      setProcedures(existingSoap.plan.procedures);
      setPrescriptions(existingSoap.plan.prescriptions);
      setLabRequestedParams(existingSoap.plan.labRequestedParams);
    } else {
      setChiefComplaint(activeVisit.chiefComplaint);
      setHistoryPresent('');
      setPastMedicalHistory(activePatient?.chronicConditions.join(', ') || '');
      setReviewOfSystems('');
      setPhysicalExamGeneral('');
      setHeadToToeNotes('');
      setVitals(activeVisit.vitals);
      setOdontogram([]);
      setPrimaryIcd10Code('');
      setPrimaryIcd10Name('');
      setSecondaryIcd10([]);
      setClinicalImpression('');
      setProcedures([]);
      setTherapyNotes('');
      setEducationNotes('');
      setPrognosis('');
      setDisposition('');
      setSickLeaveDays(0);
      setPrescriptions([]);
      setLabRequestedParams([]);
    }
  }, [activeVisit?.id, existingSoap?.id]);

  const bmiData = [vitals.weightKg, vitals.heightCm].every((value) => Number.isFinite(value) && value > 0)
    ? calculateBMI(vitals.weightKg, vitals.heightCm) : null;
  const mapValue = [vitals.systolic, vitals.diastolic].every((value) => Number.isFinite(value) && value > 0)
    ? calculateMAP(vitals.systolic, vitals.diastolic) : null;
  const gcsTotal = [vitals.gcsEye, vitals.gcsVerbal, vitals.gcsMotor].every((value, index) => Number.isInteger(value) && value >= 1 && value <= [4, 5, 6][index])
    ? calculateGCS(vitals.gcsEye, vitals.gcsVerbal, vitals.gcsMotor) : null;

  const subViewHeaderMap: Record<string, { title: string; subtitle: string }> = {
    RME_DOKTER: {
      title: `Pemeriksaan Poliklinik & SOAP — ${activePatient?.fullName || ''}`,
      subtitle: 'Anamnesis, pemeriksaan fisik, diagnosis ICD-10, prosedur ICD-9-CM, dan peresepan terintegrasi.',
    },
    IGD_TRIASE_EWS: {
      title: `Pencatatan Pemeriksaan IGD — ${activePatient?.fullName || ''}`,
      subtitle: 'Dokumentasi keluhan, tanda vital, pemeriksaan, dan rencana penanganan pada kunjungan IGD.',
    },
    GIGI_ODONTOGRAM: {
      title: `Poli Gigi & Odontogram FDI — ${activePatient?.fullName || ''}`,
      subtitle: 'Peta gigi dua digit standar FDI 11-48, status karies, tambalan, dan tindakan kedokteran gigi.',
    },
    KIA_IMUNISASI: {
      title: `Kesehatan Ibu Anak, ANC & Imunisasi — ${activePatient?.fullName || ''}`,
      subtitle: 'Pencatatan SOAP. Formulir ANC, pemantauan kehamilan, dan riwayat imunisasi terstruktur belum tersedia.',
    },
    PROLANIS_PRB: {
      title: `Penyakit Kronis, Prolanis & PRB — ${activePatient?.fullName || ''}`,
      subtitle: 'Pencatatan SOAP penyakit kronis. Pelaporan kohort dan pengiriman Prolanis/PRB belum tersedia.',
    },
    BEDAH_IBS: {
      title: `Instalasi Bedah Sentral & OK — ${activePatient?.fullName || ''}`,
      subtitle: 'Pencatatan SOAP dan jadwal operasi yang tersimpan. Kelengkapan keselamatan operasi harus diperiksa oleh tim klinis.',
    },
    MCU_SURAT_MEDIS: {
      title: `Medical Check-Up & Surat Medis — ${activePatient?.fullName || ''}`,
      subtitle: 'Dokumentasi pemeriksaan serta salinan resep. Formulir kelaikan kerja dan persetujuan tindakan belum tersedia.',
    },
  };
  const currentSubHeader = subViewHeaderMap[initialSubView] || subViewHeaderMap.RME_DOKTER;

  const safetyAlerts = useMemo(
    () =>
      checkClinicalSafetyAlerts(
        prescriptions,
        workspace.medications,
        activePatient?.allergies || []
      ),
    [prescriptions, workspace.medications, activePatient?.allergies]
  );

  const filteredIcd10 = useMemo(() => {
    const q = icd10Search.toLowerCase().trim();
    if (!q) return ICD10_CATALOG;
    return ICD10_CATALOG.filter(
      (item) =>
        item.code.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
    );
  }, [icd10Search]);

  const handleSaveOdontogramEntry = () => {
    if (selectedTooth === '' || !selectedToothCondition || !selectedToothSurface) { setStatusBanner({ type: 'error', text: 'Pilih elemen gigi, kondisi klinis, dan permukaan yang diperiksa.' }); return; }
    setOdontogram((prev) => {
      const filtered = prev.filter((o) => o.toothNumber !== selectedTooth);
      return [
        ...filtered,
        {
          toothNumber: selectedTooth,
          condition: selectedToothCondition,
          surface: selectedToothSurface,
          notes: selectedToothNotes.trim() || TOOTH_CONDITION_LABELS[selectedToothCondition].label,
        },
      ];
    });
    setSelectedToothNotes('');
  };

  const handleAddPrescription = () => {
    const med = workspace.medications.find((m) => m.id === selectedMedId);
    if (!med || !Number.isFinite(rxQuantity) || rxQuantity <= 0 || !rxDosage.trim() || !rxSigna.trim()) {
      setStatusBanner({ type: 'error', text: 'Pilih obat lalu isi dosis, aturan pakai, dan jumlah sesuai keputusan pemeriksa.' });
      return;
    }

    setPrescriptions((prev) => [
      ...prev,
      {
        medicationId: med.id,
        medicationCode: med.code,
        medicationName: med.name,
        dosage: rxDosage.trim(),
        signa: rxSigna.trim(),
        quantity: Number(rxQuantity),
        unit: med.unit,
        unitPrice: med.sellPrice,
      },
    ]);
  };

  const handleAddProcedure = () => {
    const proc = ICD9_PROCEDURES_CATALOG.find((p) => p.code === selectedIcd9Code);
    if (!proc || (procedureTariff !== '' && (!Number.isFinite(procedureTariff) || procedureTariff < 0))) {
      setStatusBanner({ type: 'error', text: 'Pilih tindakan. Tarif yang diisi harus angka tidak negatif; kosong berarti belum ditetapkan.' });
      return;
    }
    if (procedures.some((p) => p.icd9Code === proc.code)) return;
    setProcedures((prev) => [
      ...prev,
      {
        icd9Code: proc.code,
        name: proc.name,
        ...(procedureTariff === '' ? {} : { tariff: procedureTariff }),
      },
    ]);
  };

  const toggleLabParam = (code: string) => {
    setLabRequestedParams((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const handleSaveSoap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeVisit || !activePatient) return;
    setStatusBanner(null);
    if (existingSoap && !correctionReason.trim()) { setStatusBanner({ type: 'error', text: 'Isi alasan perubahan rekam medis yang sebenarnya.' }); return; }
    if (!hasCompleteVitals(vitals) || !primaryIcd10Code || !primaryIcd10Name || !prognosis || !disposition) {
      setStatusBanner({ type: 'error', text: 'Lengkapi tanda vital, diagnosis, prognosis, dan disposisi sebelum menyimpan.' });
      return;
    }
    setIsSaving(true);

    try {
      const result = await kaelApi.saveSoapRecord(token, facilityCode, {
        ...(existingSoap ? { correctionReason: correctionReason.trim() } : {}),
        visitId: activeVisit.id,
        patientId: activePatient.id,
        doctorId: activeVisit.doctorId,
        doctorName: activeVisit.doctorName,
        subjective: {
          chiefComplaint,
          historyOfPresentIllness: historyPresent,
          pastMedicalHistory,
          reviewOfSystems,
        },
        objective: {
          physicalExamGeneral,
          headToToeNotes,
          vitals,
          odontogram,
        },
        assessment: {
          primaryIcd10Code,
          primaryIcd10Name,
          secondaryIcd10,
          clinicalImpression,
          prognosis,
        },
        plan: {
          therapyNotes,
          educationNotes,
          disposition,
          sickLeaveDays: Number(sickLeaveDays) || 0,
          procedures,
          prescriptions,
          labRequestedParams,
        },
      });
      await onRefreshWorkspace();
      setStatusBanner({
        type: 'success',
        text: result.soapRecord.recordStatus === 'ADDENDUM_APPENDED'
          ? 'Addendum rekam medis berhasil disimpan. Pengiriman ke SATUSEHAT belum dikonfirmasi.'
          : `RME SOAP berhasil disimpan. Permintaan SATUSEHAT dicatat dalam antrean lokal; pengiriman ke provider belum dikonfirmasi.${result.invoice ? ` Tagihan ${result.invoice.invoiceNumber} tersedia di kasir.` : ''}`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal menyimpan RME SOAP.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const rmeExportColumns: ExportColumn<SoapRecord>[] = [
    {
      key: 'recordedAt',
      header: 'Waktu Pemeriksaan',
      format: (r) => r.recordedAt.slice(0, 16).replace('T', ' '),
    },
    { key: 'doctorName', header: 'Dokter / Nakes Pemeriksa' },
    {
      key: 'icd10',
      header: 'Diagnosis ICD-10',
      format: (r) =>
        `${r.assessment?.primaryIcd10Code || '-'} - ${
          r.assessment?.primaryIcd10Name || '-'
        }`,
    },
    {
      key: 'subjective',
      header: 'Subjektif / Keluhan',
      format: (r) => r.subjective?.chiefComplaint || '-',
    },
    {
      key: 'plan',
      header: 'Rencana Terapi & Tindakan',
      format: (r) => r.plan?.therapyNotes || '-',
    },
    { key: 'satusehatEncounterId', header: 'SATUSEHAT Encounter ID' },
  ];

  if (!activeVisit || !activePatient) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Pilih kunjungan dari antrean untuk membuka rekam medis pasien.
        </p>
      </div>
    );
  }

  return (
    <div className="grid min-w-0 grid-cols-1 lg:grid-cols-12 gap-4 items-start [&>*]:min-w-0">
      {/* Left 3 Columns: Active Queue Selector & Patient Clinical Profile */}
      <aside className="min-w-0 lg:col-span-3 space-y-3">
        <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-4">
          <h2 className="text-xs font-bold text-[#0F2922] dark:text-white mb-2.5">
            Daftar Antrean Pasien ({workspace.visits.length})
          </h2>
          <div className="space-y-1.5 max-h-[40dvb] overflow-y-auto pr-1">
            {workspace.visits.map((v) => {
              const isSelected = v.id === activeVisit.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onSelectVisitId(v.id)}
                  className={`w-full text-left p-2.5 rounded-xl border transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-[#00897B] bg-[#E6F4F1] dark:bg-[#0F3D35]'
                      : 'border-[#E2ECE8] dark:border-[#183831] hover:bg-[#F3F8F6] dark:hover:bg-[#0F2B25]'
                  }`}
                >
                  <div className="flex items-center justify-between text-caption font-mono">
                    <span className="font-bold text-[#00897B]">
                      {v.queueNumber}
                    </span>
                    <span className="text-[#52736B]">{v.status.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="text-xs font-semibold text-[#0F2922] dark:text-white mt-0.5 truncate">
                    {v.patientName} ({v.gender})
                  </div>
                  <div className="text-caption font-mono text-[#52736B] truncate">
                    {v.mrNumber} · {v.polyclinic.replace('POLI_', '')}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Patient Medical Summary Card */}
        <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-4 space-y-3 text-xs">
          <div>
            <div className="font-mono text-caption text-[#00897B] font-semibold">
              {activePatient.mrNumber} · IHS {activePatient.ihsNumber}
            </div>
            <h3 className="text-sm font-bold text-[#0F2922] dark:text-white mt-0.5">
              {activePatient.fullName} ({activePatient.gender})
            </h3>
            <div className="text-caption text-[#52736B] font-mono mt-0.5">
              Lahir: {activePatient.birthDate} · Gol. Darah: {activePatient.bloodType}{activePatient.rhesus}
            </div>
          </div>

          {activePatient.allergies.length > 0 && (
            <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300">
              <div className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                ALERGI OBAT TERCATAT:
              </div>
              <div className="mt-0.5 font-semibold">{activePatient.allergies.join(', ')}</div>
            </div>
          )}

          <div className="pt-2 border-t border-[#E2ECE8] dark:border-[#183831] space-y-1 text-caption text-[#52736B]">
            <div>
              <span className="font-semibold text-[#0F2922] dark:text-white">NIK:</span>{' '}
              <span className="font-mono">{activePatient.nik}</span>
            </div>
            <div>
              <span className="font-semibold text-[#0F2922] dark:text-white">No. BPJS:</span>{' '}
              <span className="font-mono">{activePatient.bpjsNumber || 'Umum'}</span>
            </div>
            <div>
              <span className="font-semibold text-[#0F2922] dark:text-white">Komorbid:</span>{' '}
              {activePatient.chronicConditions.join(', ') || 'Belum dicatat'}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowPatientHistory((prev) => !prev)}
            className="w-full py-2 px-3 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1] dark:hover:bg-[#133830] text-xs font-semibold text-[#0F2922] dark:text-white cursor-pointer"
          >
            {showPatientHistory
              ? 'Sembunyikan Riwayat Rekam Medis'
              : `Riwayat Kunjungan Longitudinal (${
                  workspace.soapRecords.filter((s) => s.patientId === activePatient.id).length
                })`}
          </button>

          {showPatientHistory && (
            <div className="pt-2 border-t border-[#E2ECE8] dark:border-[#183831] space-y-2 max-h-60 overflow-y-auto">
              {workspace.soapRecords
                .filter((s) => s.patientId === activePatient.id)
                .map((s) => (
                  <div
                    key={s.id}
                    className="p-2.5 rounded-xl border border-[#E2ECE8] dark:border-[#183831] bg-[#F8FBFA] dark:bg-[#081916] text-caption space-y-1"
                  >
                    <div className="font-mono font-bold text-[#00897B]">
                      {s.recordedAt.slice(0, 10)} · {s.assessment.primaryIcd10Code}
                    </div>
                    <div className="font-semibold text-[#0F2922] dark:text-white">
                      {s.assessment.primaryIcd10Name}
                    </div>
                    <div className="text-[#52736B]">DPJP: {s.doctorName}</div>
                    <div className="text-[#0F2922] dark:text-white">
                      Terapi: {s.plan.therapyNotes}
                    </div>
                  </div>
                ))}
              {workspace.soapRecords.filter((s) => s.patientId === activePatient.id).length ===
                0 && (
                <div className="text-caption text-[#52736B]">
                  Belum ada riwayat SOAP tersimpan untuk pasien ini.
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Main 9 Columns: Comprehensive RME SOAP + Odontogram + Perawat/Bidan + E-Resep Workstation */}
      <form onSubmit={handleSaveSoap} className="min-w-0 lg:col-span-9 space-y-4">
        {/* Top Action, Export & Clinical Template Bar */}
        <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-5 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs font-mono text-[#00897B] font-semibold">
                No. Registrasi: {activeVisit.registrationNumber} · DPJP: {activeVisit.doctorName} · Peran Aktif: {workspace.user.roleName || workspace.user.role}
                {existingSoap?.recordStatus && (
                  <span className="ml-2 px-2 py-0.5 rounded bg-[#E6F4F1] dark:bg-[#0F3D35] text-[#00695C] dark:text-[#80CBC4]">
                    Status RME: {existingSoap.recordStatus}
                  </span>
                )}
              </div>
              <h2 className="text-lg font-bold text-[#0F2922] dark:text-white mt-0.5 tracking-tight">
                {currentSubHeader.title}
              </h2>
              <p className="text-xs text-[#52736B] dark:text-[#86B5A9] mt-0.5">
                {currentSubHeader.subtitle}
              </p>
            </div>

            <DataExportToolbar
              title={`Rekam Medis Elektronik - ${activePatient.fullName}`}
              subtitle={`No. RM: ${activePatient.mrNumber} • Poli: ${activeVisit.polyclinic}`}
              filenameBase={`KAEL_RME_${activePatient.mrNumber}`}
              facilityName={workspace.activeFacility.name}
              facilityCode={facilityCode}
              columns={rmeExportColumns}
              rows={workspace.soapRecords}
              compact
            />
          </div>

          {initialSubView === 'IGD_TRIASE_EWS' && (
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 space-y-2">
              <p>Penilaian triase dan respons klinis dilakukan oleh petugas sesuai protokol fasilitas. Kategori kunjungan yang tersimpan: <strong>{activeVisit.triageLevel?.replace(/_/g, ' ') || 'Belum dicatat'}</strong>.</p>
              <p>Skor ATS, NEWS2, PEWS, dan MEOWS belum tersedia sebagai penilaian tervalidasi di aplikasi ini. Data tanda vital yang ada belum mencakup seluruh observasi dan konteks populasi yang diperlukan.</p>
              <a className="underline text-teal-700 dark:text-teal-400" href="https://rcp.ac.uk/resources/national-early-warning-score-news-2/" target="_blank" rel="noreferrer">Panduan NEWS2 dari Royal College of Physicians</a>
            </div>
          )}

          {initialSubView === 'BEDAH_IBS' && (
            <div className="pt-3 border-t border-[#E2ECE8] dark:border-[#183831] space-y-2 text-xs">
              <div className="font-bold text-[#0F2922] dark:text-white">
                Jadwal Operasi &amp; Status Checklist Tercatat ({(workspace.surgicalSchedules || []).length})
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {(workspace.surgicalSchedules || []).map((ibs) => (
                  <div
                    key={ibs.id}
                    className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex items-center justify-between gap-2"
                  >
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {ibs.procedureName} ({ibs.icd9CmCode})
                      </div>
                      <div className="text-caption text-slate-500 font-mono">
                        {ibs.operatingRoomCode} · Pasien: {ibs.patientName} · Bedah: {ibs.surgeonName}
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-teal-100 dark:bg-teal-950 text-teal-800 dark:text-teal-300 font-mono text-caption font-bold">
                      Sign-in: {ibs.whoSignInCompleted === true ? 'tercatat selesai' : 'belum terverifikasi'} · Time-out: {ibs.whoTimeOutCompleted === true ? 'tercatat selesai' : 'belum terverifikasi'} · Sign-out: {ibs.whoSignOutCompleted === true ? 'tercatat selesai' : 'belum terverifikasi'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {statusBanner && (
          <div
            role="status"
            className={`p-4 rounded-xl border text-xs font-medium flex items-center justify-between ${
              statusBanner.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                : 'bg-red-50 dark:bg-red-950/60 border-red-200 dark:border-red-800 text-red-900 dark:text-red-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{statusBanner.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              className="underline ml-4 whitespace-nowrap"
            >
              Tutup
            </button>
          </div>
        )}

        {/* 1. SUBJECTIVE (ANAMNESIS) */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            01. Subjective — Anamnesis &amp; Riwayat Perjalanan Penyakit
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="soap-chief-complaint"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                Keluhan Utama
              </label>
              <textarea
                id="soap-chief-complaint"
                rows={2}
                value={chiefComplaint}
                onChange={(e) => setChiefComplaint(e.target.value)}
                required
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label
                htmlFor="soap-rps"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                Riwayat Penyakit Sekarang
              </label>
              <textarea
                id="soap-rps"
                rows={2}
                value={historyPresent}
                onChange={(e) => setHistoryPresent(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label
                htmlFor="soap-rpd"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                Riwayat Penyakit Dahulu &amp; Alergi
              </label>
              <input
                id="soap-rpd"
                type="text"
                value={pastMedicalHistory}
                onChange={(e) => setPastMedicalHistory(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label
                htmlFor="soap-ros"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                Anamnesis Sistem
              </label>
              <input
                id="soap-ros"
                type="text"
                value={reviewOfSystems}
                onChange={(e) => setReviewOfSystems(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
          </div>
        </section>

        {/* 2. OBJECTIVE (VITAL SIGNS + CLINICAL CALCULATORS + ODONTOGRAM) */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              02. Objective — Pemeriksaan Fisik, Tanda Vital &amp; Kalkulator Medis
            </h3>
            <div className="flex items-center gap-3 text-xs font-mono tabular-nums text-slate-700 dark:text-slate-300">
              <span>MAP: <strong>{mapValue === null ? 'Belum lengkap' : `${mapValue} mmHg`}</strong></span>
              <span aria-hidden="true">·</span>
              <span>IMT/BMI: <strong>{bmiData ? bmiData.bmi : 'Belum lengkap'}</strong></span>
              <span aria-hidden="true">·</span>
              <span>GCS: <strong>{gcsTotal === null ? 'Belum lengkap' : `${gcsTotal}/15`}</strong></span>
              <span aria-hidden="true">·</span>
              <span>Triase tercatat: <strong>{activeVisit.triageLevel?.replace(/_/g, ' ') || 'Belum dicatat'}</strong></span>
            </div>
          </div>

          <VitalSignsFields value={vitals} onChange={setVitals} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Keadaan Umum &amp; Kesadaran
              </label>
              <input
                type="text"
                value={physicalExamGeneral}
                onChange={(e) => setPhysicalExamGeneral(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Pemeriksaan Fisik Thorax, Cor, Abdomen &amp; Ekstremitas
              </label>
              <input
                type="text"
                value={headToToeNotes}
                onChange={(e) => setHeadToToeNotes(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
          </div>

          {/* Interactive FDI 32-Tooth Odontogram Toggle & Chart */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowOdontogram((prev) => !prev)}
                className="text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
              >
                {showOdontogram
                  ? 'Sembunyikan Peta Odontogram FDI'
                  : `Tampilkan Peta Odontogram Gigi FDI (${odontogram.length} temuan tercatat)`}
              </button>
              <span className="text-caption text-slate-500">
                Standar Rekam Medis Kedokteran Gigi Kemenkes RI
              </span>
            </div>

            {showOdontogram && (
              <div className="mt-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-4">
                <div className="overflow-x-auto">
                  <div className="space-y-2.5">
                    {/* Upper Arch */}
                    <div className="flex items-center justify-center gap-2">
                      <div className="flex gap-1 pr-2 border-r-2 border-slate-300 dark:border-slate-700">
                        {UPPER_RIGHT_TEETH.map((tNum) => {
                          const entry = odontogram.find((o) => o.toothNumber === tNum);
                          const style = entry ? TOOTH_CONDITION_LABELS[entry.condition] : { short: '?', label: 'Belum dicatat', colorClass: 'border-dashed border-slate-300 dark:border-slate-700 text-slate-400' };
                          return (
                            <button
                              key={tNum}
                              type="button"
                              onClick={() => setSelectedTooth(tNum)}
                              className={`w-8 h-11 rounded border text-center flex flex-col items-center justify-center transition-all cursor-pointer ${
                                style.colorClass
                              } ${selectedTooth === tNum ? 'ring-2 ring-teal-600' : ''}`}
                            >
                              <span className="text-caption font-mono">{tNum}</span>
                              <span className="text-caption font-mono">{style.short}</span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex gap-1">
                        {UPPER_LEFT_TEETH.map((tNum) => {
                          const entry = odontogram.find((o) => o.toothNumber === tNum);
                          const style = entry ? TOOTH_CONDITION_LABELS[entry.condition] : { short: '?', label: 'Belum dicatat', colorClass: 'border-dashed border-slate-300 dark:border-slate-700 text-slate-400' };
                          return (
                            <button
                              key={tNum}
                              type="button"
                              onClick={() => setSelectedTooth(tNum)}
                              className={`w-8 h-11 rounded border text-center flex flex-col items-center justify-center transition-all cursor-pointer ${
                                style.colorClass
                              } ${selectedTooth === tNum ? 'ring-2 ring-teal-600' : ''}`}
                            >
                              <span className="text-caption font-mono">{tNum}</span>
                              <span className="text-caption font-mono">{style.short}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Lower Arch */}
                    <div className="flex items-center justify-center gap-2">
                      <div className="flex gap-1 pr-2 border-r-2 border-slate-300 dark:border-slate-700">
                        {LOWER_RIGHT_TEETH.map((tNum) => {
                          const entry = odontogram.find((o) => o.toothNumber === tNum);
                          const style = entry ? TOOTH_CONDITION_LABELS[entry.condition] : { short: '?', label: 'Belum dicatat', colorClass: 'border-dashed border-slate-300 dark:border-slate-700 text-slate-400' };
                          return (
                            <button
                              key={tNum}
                              type="button"
                              onClick={() => setSelectedTooth(tNum)}
                              className={`w-8 h-11 rounded border text-center flex flex-col items-center justify-center transition-all cursor-pointer ${
                                style.colorClass
                              } ${selectedTooth === tNum ? 'ring-2 ring-teal-600' : ''}`}
                            >
                              <span className="text-caption font-mono">{style.short}</span>
                              <span className="text-caption font-mono">{tNum}</span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex gap-1">
                        {LOWER_LEFT_TEETH.map((tNum) => {
                          const entry = odontogram.find((o) => o.toothNumber === tNum);
                          const style = entry ? TOOTH_CONDITION_LABELS[entry.condition] : { short: '?', label: 'Belum dicatat', colorClass: 'border-dashed border-slate-300 dark:border-slate-700 text-slate-400' };
                          return (
                            <button
                              key={tNum}
                              type="button"
                              onClick={() => setSelectedTooth(tNum)}
                              className={`w-8 h-11 rounded border text-center flex flex-col items-center justify-center transition-all cursor-pointer ${
                                style.colorClass
                              } ${selectedTooth === tNum ? 'ring-2 ring-teal-600' : ''}`}
                            >
                              <span className="text-caption font-mono">{style.short}</span>
                              <span className="text-caption font-mono">{tNum}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Selected Tooth Editor */}
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5 items-end pt-2 border-t border-slate-200 dark:border-slate-800">
                  <div>
                    <label className="block text-caption font-semibold text-slate-600 dark:text-slate-400">
                      Elemen Gigi FDI
                    </label>
                    <input
                      type="number"
                      value={selectedTooth}
                      readOnly
                      className="w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-caption font-semibold text-slate-600 dark:text-slate-400">
                      Kondisi Klinis Gigi
                    </label>
                    <select
                      value={selectedToothCondition}
                      onChange={(e) => setSelectedToothCondition(e.target.value as ToothCondition | '')}
                      className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    >
                      <option value="">Pilih kondisi yang diperiksa</option>
                      {Object.entries(TOOTH_CONDITION_LABELS).map(([k, val]) => (
                        <option key={k} value={k}>
                          {val.short} - {val.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-caption font-semibold text-slate-600 dark:text-slate-400">
                      Permukaan
                    </label>
                    <select
                      value={selectedToothSurface}
                      onChange={(e) =>
                        setSelectedToothSurface(e.target.value as OdontogramEntry['surface'] | '')
                      }
                      className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    >
                      <option value="">Pilih permukaan</option>
                      <option value="O">O — Oklusal</option>
                      <option value="M">M — Mesial</option>
                      <option value="D">D — Distal</option>
                      <option value="B">B — Bukal / Labial</option>
                      <option value="L">L — Lingual / Palatal</option>
                      <option value="ALL">Seluruh Elemen</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-caption font-semibold text-slate-600 dark:text-slate-400">
                      Catatan Keterangan
                    </label>
                    <input
                      type="text"
                      value={selectedToothNotes}
                      onChange={(e) => setSelectedToothNotes(e.target.value)}
                      placeholder="Kavitas mencapai dentin..."
                      className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveOdontogramEntry}
                    className="py-1.5 px-3 text-xs font-semibold rounded bg-teal-700 hover:bg-teal-800 text-white cursor-pointer"
                  >
                    Simpan Gigi {selectedTooth}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* 3. ASSESSMENT (DIAGNOSIS ICD-10) */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            03. Assessment — Penegakan Diagnosis Standar ICD-10 WHO &amp; Prognosis
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-5">
              <label
                htmlFor="icd10-search-input"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                Cari Katalog ICD-10
              </label>
              <input
                id="icd10-search-input"
                type="search"
                value={icd10Search}
                onChange={(e) => setIcd10Search(e.target.value)}
                placeholder="Ketik I10, J06, K02, Diabetes, Demam..."
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 mb-2"
              />
              <div className="max-h-36 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-100 dark:divide-slate-800">
                {filteredIcd10.map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => {
                      setPrimaryIcd10Code(item.code);
                      setPrimaryIcd10Name(item.name);
                      if (!clinicalImpression) setClinicalImpression(item.name);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer ${
                      primaryIcd10Code === item.code
                        ? 'bg-teal-50/70 dark:bg-teal-950/50 font-semibold text-teal-800 dark:text-teal-300'
                        : ''
                    }`}
                  >
                    <span className="truncate pr-2">
                      <strong className="font-mono">{item.code}</strong> — {item.name}
                    </span>
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!secondaryIcd10.some((sec) => sec.code === item.code)) {
                          setSecondaryIcd10((prev) => [
                            ...prev,
                            { code: item.code, name: item.name },
                          ]);
                        }
                      }}
                      className="text-caption font-mono px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-teal-700 hover:text-white shrink-0"
                    >
                      + Sekunder
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="md:col-span-7 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Kode ICD-10 Primer
                  </label>
                  <input
                    type="text"
                    value={primaryIcd10Code}
                    onChange={(e) => setPrimaryIcd10Code(e.target.value.toUpperCase())}
                    required
                    className="w-full px-3 py-2 text-xs font-mono font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Deskripsi Diagnosis ICD-10 Primer
                  </label>
                  <input
                    type="text"
                    value={primaryIcd10Name}
                    onChange={(e) => setPrimaryIcd10Name(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
              </div>

              {/* Secondary Diagnoses List */}
              <div>
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Diagnosis Sekunder / Komorbid ICD-10 ({secondaryIcd10.length})
                </div>
                {secondaryIcd10.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {secondaryIcd10.map((sec) => (
                      <div
                        key={sec.code}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                      >
                        <span className="font-mono font-bold">{sec.code}</span>
                        <span>{sec.name}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setSecondaryIcd10((prev) =>
                              prev.filter((item) => item.code !== sec.code)
                            )
                          }
                          className="text-red-600 hover:text-red-800 font-bold ml-1 cursor-pointer"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-caption text-slate-500">
                    Klik tombol &ldquo;+ Sekunder&rdquo; pada daftar katalog ICD-10 di samping untuk menambahkan diagnosis penyerta.
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Diagnosis Kerja / Kesan Klinis Dokter
                  </label>
                  <input
                    type="text"
                    value={clinicalImpression}
                    onChange={(e) => setClinicalImpression(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Prognosis
                  </label>
                  <select
                    value={prognosis}
                    onChange={(e) =>
                      setPrognosis(e.target.value as SoapRecord['assessment']['prognosis'])
                    }
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    <option value="" disabled>Pilih prognosis</option>
                    <option value="BONAM">Ad Bonam — Baik</option>
                    <option value="SANAM">Ad Sanam — Sembuh</option>
                    <option value="DUBIA_AD_BONAM">Dubia ad Bonam</option>
                    <option value="DUBIA_AD_MALAM">Dubia ad Malam</option>
                    <option value="MALAM">Ad Malam — Buruk</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 4. PLAN (TINDAKAN ICD-9, E-RESEP TERINTEGRASI APOTEK, ORDER LAB) */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-5">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            04. Plan — Tindakan Medis ICD-9-CM, E-Resep Farmasi &amp; Laboratorium
          </h3>

          {/* Clinical Safety Alerts (Drug Allergy, Drug Interactions, Stock Check) */}
          {(safetyAlerts.allergyConflicts.length > 0 ||
            safetyAlerts.drugInteractions.length > 0 ||
            safetyAlerts.stockShortfalls.length > 0) && (
            <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-900 space-y-1 text-xs text-red-800 dark:text-red-200">
              <div className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Peringatan berdasarkan data obat dan alergi yang tercatat:
              </div>
              {safetyAlerts.allergyConflicts.map((msg, i) => (
                <div key={`alg-${i}`} className="font-semibold">• {msg}</div>
              ))}
              {safetyAlerts.drugInteractions.map((msg, i) => (
                <div key={`int-${i}`}>• {msg}</div>
              ))}
              {safetyAlerts.stockShortfalls.map((msg, i) => (
                <div key={`stk-${i}`}>• {msg}</div>
              ))}
            </div>
          )}

          {/* E-Prescription Builder */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <Pill className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                E-Resep Farmasi
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
              <div className="sm:col-span-5">
                <label className="block text-caption text-slate-500 mb-1">
                  Pilih Obat / Alkes dari Inventaris Aktif
                </label>
                <select
                  value={selectedMedId}
                  onChange={(e) => setSelectedMedId(e.target.value)}
                  aria-label="Pilih Obat E-Resep"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="">Pilih obat</option>
                  {workspace.medications.map((m) => {
                    const stock = m.batches.reduce((s, b) => s + b.stock, 0);
                    return (
                      <option key={m.id} value={m.id}>
                        {m.name} · Stok {stock} {m.unit} · {formatRupiah(m.sellPrice)}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-caption text-slate-500 mb-1">Dosis</label>
                <input
                  type="text"
                  value={rxDosage}
                  onChange={(e) => setRxDosage(e.target.value)}
                  placeholder="Dosis yang ditetapkan"
                  className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block text-caption text-slate-500 mb-1">Signa / Aturan Pakai</label>
                <input
                  type="text"
                  value={rxSigna}
                  onChange={(e) => setRxSigna(e.target.value)}
                  placeholder="Aturan pakai yang ditetapkan"
                  className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div className="sm:col-span-1">
                <label className="block text-caption text-slate-500 mb-1">Jml</label>
                <input
                  type="number"
                  min={1}
                  value={rxQuantity}
                  onChange={(e) => setRxQuantity(Number(e.target.value))}
                  className="w-full px-2 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div className="sm:col-span-1">
                <button
                  type="button"
                  onClick={handleAddPrescription}
                  aria-label="Tambah Obat ke E-Resep"
                  className="w-full py-2 px-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold flex items-center justify-center cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {prescriptions.length > 0 && (
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/50 text-caption text-slate-500 border-b border-slate-200 dark:border-slate-800">
                      <th className="py-2 px-3">Nama Obat</th>
                      <th className="py-2 px-3">Dosis &amp; Signa</th>
                      <th className="py-2 px-3 text-right">Jumlah</th>
                      <th className="py-2 px-3 text-right">Subtotal</th>
                      <th className="py-2 px-3 text-right">Hapus</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {prescriptions.map((rx, idx) => (
                      <tr key={`${rx.medicationCode}-${idx}`}>
                        <td className="py-2 px-3 font-semibold">{rx.medicationName}</td>
                        <td className="py-2 px-3 font-mono text-caption">
                          {rx.dosage} · {rx.signa}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {rx.quantity} {rx.unit}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {formatRupiah(rx.quantity * rx.unitPrice)}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <button
                            type="button"
                            onClick={() =>
                              setPrescriptions((prev) => prev.filter((_, i) => i !== idx))
                            }
                            aria-label={`Hapus ${rx.medicationName}`}
                            className="text-red-600 hover:text-red-800 p-1 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Procedures ICD-9-CM & Lab Request Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-3 border-t border-slate-200 dark:border-slate-800">
            {/* Left: Procedures ICD-9-CM */}
            <div className="space-y-2.5">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <Stethoscope className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                Tindakan Medis ICD-9-CM
              </span>
              <div className="flex gap-2">
                <select
                  value={selectedIcd9Code}
                  onChange={(e) => setSelectedIcd9Code(e.target.value)}
                  aria-label="Pilih Tindakan Medis ICD-9"
                  className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="">Pilih tindakan</option>
                  {ICD9_PROCEDURES_CATALOG.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.code} - {p.name}
                    </option>
                  ))}
                </select>
                <input type="number" min={0} step="any" value={procedureTariff} onChange={(event) => setProcedureTariff(event.target.value === '' ? '' : Number(event.target.value))} aria-label="Tarif tindakan fasilitas" placeholder="Tarif (opsional)" className="w-32 px-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
                <button
                  type="button"
                  onClick={handleAddProcedure}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  + Tindakan
                </button>
              </div>
              <div className="space-y-1.5">
                {procedures.map((proc, idx) => (
                  <div
                    key={proc.icd9Code}
                    className="flex items-center justify-between text-xs py-1.5 px-3 rounded border border-slate-200 dark:border-slate-800"
                  >
                    <span className="truncate pr-2">
                      <strong className="font-mono">{proc.icd9Code}</strong> — {proc.name}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono tabular-nums">
                        {typeof proc.tariff === 'number' ? formatRupiah(proc.tariff) : 'Tarif belum ditetapkan'}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setProcedures((prev) => prev.filter((_, i) => i !== idx))
                        }
                        aria-label={`Hapus tindakan ${proc.name}`}
                        className="text-red-600 hover:text-red-800"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Lab Parameters Request */}
            <div className="space-y-2.5">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <FlaskConical className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                Permintaan Pemeriksaan Laboratorium ({labRequestedParams.length} dipilih)
              </span>
              <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto p-2 rounded-lg border border-slate-200 dark:border-slate-800">
                {LAB_PARAMETER_TEMPLATES.map((tpl) => {
                  const checked = labRequestedParams.includes(tpl.code);
                  return (
                    <label
                      key={tpl.code}
                      className="flex items-center gap-2 text-xs p-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleLabParam(tpl.code)}
                        className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                      />
                      <span className="truncate">
                        <strong className="font-mono">{tpl.code}</strong> · {tpl.name}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Disposition, Sick Leave & Therapy Notes */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Instruksi Terapi &amp; Edukasi Pasien
              </label>
              <input
                type="text"
                value={therapyNotes}
                onChange={(e) => setTherapyNotes(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Status Akhir / Disposisi
              </label>
              <select
                value={disposition}
                onChange={(e) =>
                  setDisposition(e.target.value as SoapRecord['plan']['disposition'])
                }
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="" disabled>Pilih disposisi</option>
                <option value="PULANG">Pulang &amp; Rawat Jalan</option>
                <option value="KONTROL_ULANG">Kontrol Poliklinik</option>
                <option value="RAWAT_INAP">Admisi Rawat Inap</option>
                <option value="RUJUK_FKTL">Rujuk ke RS / FKTL</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Istirahat / Surat Sakit · Hari
              </label>
              <input
                type="number"
                min={0}
                max={30}
                value={sickLeaveDays}
                onChange={(e) => setSickLeaveDays(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
          </div>

          {existingSoap && <label className="block text-xs font-semibold">Alasan perubahan rekam medis<textarea required value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="Jelaskan data yang diperbaiki dan alasannya" className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" /></label>}
          {/* Submit & Print Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowPrintCertificate((prev) => !prev)}
                className="px-4 py-2.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 cursor-pointer"
              >
                <FileText className="w-4 h-4" />
                {showPrintCertificate
                  ? 'Tutup Pratinjau Dokumen'
                  : 'Pratinjau Draf Dokumen'}
              </button>
            </div>

            <button
              type="submit"
              disabled={isSaving}
              className="px-6 py-2.5 text-xs font-semibold rounded-lg bg-teal-700 hover:bg-teal-800 text-white flex items-center gap-2 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              {isSaving
                ? 'Menyimpan rekam medis...'
                : 'Simpan & Finalisasi RME SOAP'}
            </button>
          </div>
        </section>

        {/* Multi-Document Printable Medical Certificate & Clinical Generator */}
        {showPrintCertificate && (
          <section className="bg-white text-slate-900 border-2 border-slate-800 rounded-xl p-6 space-y-4">
            <div className="no-print flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200">
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { key: 'SURAT_SAKIT', label: 'Surat Keterangan Sakit', unavailable: false },
                  { key: 'SURAT_SEHAT', label: 'Surat Keterangan Sehat', unavailable: true },
                  { key: 'SURAT_RUJUKAN', label: 'Surat Rujukan FKTL', unavailable: false },
                  { key: 'INFORMED_CONSENT', label: 'Informed Consent Tindakan', unavailable: true },
                  { key: 'SALINAN_RESEP', label: 'Salinan Resep', unavailable: false },
                ].map((doc) => (
                  <button
                    key={doc.key}
                    type="button"
                    disabled={doc.unavailable}
                    title={doc.unavailable ? 'Pengesahan pemeriksaan dan persetujuan yang tersimpan belum tersedia.' : undefined}
                    onClick={() =>
                      !doc.unavailable && setPrintDocType(doc.key as typeof printDocType)
                    }
                    className={`px-3 py-1.5 text-xs font-semibold rounded cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
                      printDocType === doc.key
                        ? 'bg-teal-700 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {doc.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                disabled={printDocType === 'SURAT_SEHAT' || printDocType === 'INFORMED_CONSENT'}
                onClick={() => {
                  if (printDocType !== 'SURAT_SEHAT' && printDocType !== 'INFORMED_CONSENT') window.print();
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded bg-slate-900 text-white flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Printer className="w-3.5 h-3.5" />
                Cetak Dokumen Ini
              </button>
            </div>

            <p className="no-print text-xs text-slate-500">
              Pratinjau ini menggunakan isian pemeriksaan saat ini dan belum menjadi dokumen yang diterbitkan atau disahkan. Surat sehat dan informed consent belum tersedia.
            </p>

            <div className="flex items-start justify-between border-b-2 border-slate-900 pb-4">
              <div>
                <h4 className="text-base font-bold uppercase">
                  {workspace.activeFacility.name}
                </h4>
                <p className="text-xs text-slate-600">
                  {workspace.activeFacility.address}, {workspace.activeFacility.city} · Telp: {workspace.activeFacility.phone}
                </p>
                <p className="text-caption font-mono text-slate-500">
                  Kode Kemenkes: {workspace.activeFacility.kemenkesCode} · SATUSEHAT Org: {workspace.activeFacility.satusehatOrgId}
                </p>
              </div>
            </div>

            <div className="text-center py-2">
              <h5 className="text-sm font-bold underline">
                {printDocType === 'SURAT_SAKIT' && 'SURAT KETERANGAN ISTIRAHAT SAKIT'}
                {printDocType === 'SURAT_SEHAT' && 'SURAT KETERANGAN SEHAT DOKTER'}
                {printDocType === 'SURAT_RUJUKAN' && 'SURAT RUJUKAN PELAYANAN KESEHATAN LANJUTAN'}
                {printDocType === 'INFORMED_CONSENT' && 'PERSETUJUAN TINDAKAN KEDOKTERAN'}
                {printDocType === 'SALINAN_RESEP' && 'SALINAN RESEP OBAT'}
              </h5>
              <p className="text-xs font-mono">DRAF BELUM DISAHKAN · Kunjungan: {activeVisit.registrationNumber}</p>
            </div>

            <div className="text-xs space-y-2 leading-relaxed">
              <p>
                Draf catatan pemeriksaan pada{' '}
                <strong>{workspace.activeFacility.name}</strong> untuk pasien:
              </p>
              <div className="pl-4 font-mono space-y-1">
                <div>Nama Lengkap : {activePatient.fullName} ({activePatient.gender})</div>
                <div>Nomor RM / NIK: {activePatient.mrNumber} / {activePatient.nik}</div>
                <div>Tanggal Lahir: {activePatient.birthDate}</div>
                <div>Diagnosis    : {primaryIcd10Code} — {primaryIcd10Name}</div>
                <div>
                  Tanda Vital  : TD {vitals.systolic}/{vitals.diastolic} mmHg, Nadi {vitals.heartRate}x/mnt, Suhu {vitals.temperature}°C, BB {vitals.weightKg} kg, TB {vitals.heightCm} cm (IMT {bmiData?.bmi ?? 'belum lengkap'})
                </div>
              </div>

              {printDocType === 'SURAT_SAKIT' && (
                <p>
                  Berdasarkan hasil pemeriksaan fisik dan medis, pasien tersebut memerlukan istirahat sakit selama{' '}
                  <strong>{sickLeaveDays} ({sickLeaveDays > 0 ? 'hari' : 'Nol'}) hari</strong> terhitung mulai tanggal pemeriksaan ini.
                </p>
              )}

              {printDocType === 'SURAT_SEHAT' && (
                <p>
                  Penerbitan surat sehat belum tersedia. Dokumen memerlukan pengesahan pemeriksaan yang tersimpan.
                </p>
              )}

              {printDocType === 'SURAT_RUJUKAN' && (
                <p>
                  Mohon pemeriksaan dan penanganan medis lebih lanjut di Fasilitas Kesehatan Rujukan Tingkat Lanjut bagian Spesialis terkait. Terapi awal yang telah diberikan: {therapyNotes}.
                </p>
              )}

              {printDocType === 'INFORMED_CONSENT' && (
                <p>
                  Penerbitan informed consent belum tersedia. Persetujuan pasien atau keluarga harus dicatat dan disahkan terlebih dahulu.
                </p>
              )}

              {printDocType === 'SALINAN_RESEP' && (
                <div className="pl-4 font-mono space-y-1 pt-2">
                  <div className="font-bold">Daftar Obat R/:</div>
                  {prescriptions.map((rx, idx) => (
                    <div key={idx}>
                      R/ {rx.medicationName} No. {rx.quantity} ({rx.unit}) — S {rx.signa} ({rx.dosage})
                    </div>
                  ))}
                  {prescriptions.length === 0 && <div>Belum ada item resep pada kunjungan ini.</div>}
                </div>
              )}
            </div>

            <div className="flex justify-end pt-4 text-xs">
              <div className="text-center">
                <div>Dicetak: {new Date().toLocaleDateString('id-ID')} · Pemeriksaan tersimpan: {existingSoap?.recordedAt ? new Date(existingSoap.recordedAt).toLocaleDateString('id-ID') : 'Belum disimpan'}</div>
                <div className="font-semibold mt-12 underline">{activeVisit.doctorName}</div>
                <div className="text-caption font-mono text-slate-500">Pemeriksa pada kunjungan · Pengesahan dokumen belum tersedia</div>
              </div>
            </div>
          </section>
        )}
      </form>
    </div>
  );
};
