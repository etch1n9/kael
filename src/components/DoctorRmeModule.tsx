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
} from '../types/simrs';
import { kaelApi, WorkspacePayload } from '../utils/apiClient';
import {
  calculateBMI,
  calculateGCS,
  calculateMAP,
  checkClinicalSafetyAlerts,
  evaluateAutoTriage,
  formatRupiah,
  ICD10_CATALOG,
  ICD9_PROCEDURES_CATALOG,
  LAB_PARAMETER_TEMPLATES,
  ROLE_LABELS,
} from '../utils/clinicalLogic';
import { DataExportToolbar } from './DataExportToolbar';
import { ExportColumn } from '../utils/exportDocument';

import {
  calculateMeowsScore,
  calculateNews2Score,
  calculatePewsScore,
  evaluateAtsTriage,
} from '../utils/platformEngine';
import { ModuleKey } from '../types/simrs';

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
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [historyPresent, setHistoryPresent] = useState('');
  const [pastMedicalHistory, setPastMedicalHistory] = useState('');
  const [reviewOfSystems, setReviewOfSystems] = useState('');

  const [physicalExamGeneral, setPhysicalExamGeneral] = useState(
    'Keadaan umum tampak sakit ringan, kesadaran Compos Mentis.'
  );
  const [headToToeNotes, setHeadToToeNotes] = useState(
    'Konjungtiva anemis (-/-), sklera ikterik (-/-), thorax cor/pulmo dalam batas normal, abdomen supel.'
  );
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

  // Odontogram State
  const [showOdontogram, setShowOdontogram] = useState(false);
  const [odontogram, setOdontogram] = useState<OdontogramEntry[]>([]);
  const [selectedTooth, setSelectedTooth] = useState<number>(46);
  const [selectedToothCondition, setSelectedToothCondition] = useState<ToothCondition>('CARIES');
  const [selectedToothSurface, setSelectedToothSurface] = useState<OdontogramEntry['surface']>('O');
  const [selectedToothNotes, setSelectedToothNotes] = useState('');

  // Assessment ICD-10 State
  const [icd10Search, setIcd10Search] = useState('');
  const [primaryIcd10Code, setPrimaryIcd10Code] = useState('I10');
  const [primaryIcd10Name, setPrimaryIcd10Name] = useState('Hipertensi Esensial');
  const [secondaryIcd10, setSecondaryIcd10] = useState<{ code: string; name: string }[]>([]);
  const [clinicalImpression, setClinicalImpression] = useState('');
  const [prognosis, setPrognosis] = useState<SoapRecord['assessment']['prognosis']>('BONAM');

  // Plan State
  const [therapyNotes, setTherapyNotes] = useState('');
  const [educationNotes, setEducationNotes] = useState('');
  const [disposition, setDisposition] = useState<SoapRecord['plan']['disposition']>('PULANG');
  const [sickLeaveDays, setSickLeaveDays] = useState(0);
  const [procedures, setProcedures] = useState<ClinicalProcedureItem[]>([
    {
      icd9Code: '89.03',
      name: 'Konsultasi & Pemeriksaan Fisik Komprehensif Dokter',
      tariff: 65000,
    },
  ]);
  const [prescriptions, setPrescriptions] = useState<PrescriptionItem[]>([]);
  const [labRequestedParams, setLabRequestedParams] = useState<string[]>([]);

  // Prescription Builder Inputs
  const [selectedMedId, setSelectedMedId] = useState(workspace.medications[0]?.id || '');
  const [rxDosage, setRxDosage] = useState('1 Tablet');
  const [rxSigna, setRxSigna] = useState('3 x 1 tablet sesudah makan');
  const [rxQuantity, setRxQuantity] = useState(10);

  // Procedure Builder Input
  const [selectedIcd9Code, setSelectedIcd9Code] = useState('89.03');

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
      setHistoryPresent(
        `Pasien datang ke ${activeVisit.polyclinic.replace(/_/g, ' ')} dengan keluhan ${activeVisit.chiefComplaint}.`
      );
      setPastMedicalHistory(
        activePatient?.chronicConditions.length
          ? `Riwayat Komorbid: ${activePatient.chronicConditions.join(', ')}.`
          : 'Tidak ada riwayat penyakit kronis sebelumnya.'
      );
      setReviewOfSystems('Respirasi, Kardiovaskular, dan Gastrointestinal dievaluasi.');
      setPhysicalExamGeneral('Keadaan umum tampak sakit sedang, kesadaran Compos Mentis.');
      setHeadToToeNotes(
        'Thorax: Suara napas vesikuler (+/+), ronkhi (-/-). Cor: S1-S2 reguler. Abdomen: supel, bising usus (+) normal.'
      );
      setVitals(activeVisit.vitals);
      setOdontogram([]);
      setSecondaryIcd10([]);
      if (activeVisit.polyclinic === 'POLI_GIGI') {
        setPrimaryIcd10Code('K02.1');
        setPrimaryIcd10Name('Karies Dentin');
        setClinicalImpression('Karies Dentin Profunda Gigi 46');
        setProcedures([
          {
            icd9Code: '23.2',
            name: 'Restorasi Komposit Sinar',
            tariff: 250000,
          },
        ]);
      } else {
        setPrimaryIcd10Code('I10');
        setPrimaryIcd10Name('Hipertensi Esensial');
        setClinicalImpression('Observasi Klinis sesuai anamnesis dan tanda vital');
        setProcedures([
          {
            icd9Code: '89.03',
            name: 'Konsultasi & Pemeriksaan Fisik Komprehensif Dokter',
            tariff: 65000,
          },
        ]);
      }
      setTherapyNotes('Terapi medikamentosa sesuai E-Resep dan pemantauan tanda vital.');
      setEducationNotes('Minum obat teratur sesuai anjuran, segera ke IGD bila muncul tanda bahaya.');
      setDisposition('PULANG');
      setSickLeaveDays(1);
      setPrescriptions([]);
      setLabRequestedParams([]);
    }
  }, [activeVisit?.id, existingSoap?.id]);

  useEffect(() => {
    if (workspace.medications.length > 0 && !selectedMedId) {
      setSelectedMedId(workspace.medications[0].id);
    }
  }, [workspace.medications, selectedMedId]);

  const bmiData = calculateBMI(vitals.weightKg, vitals.heightCm);
  const mapValue = calculateMAP(vitals.systolic, vitals.diastolic);
  const gcsTotal = calculateGCS(vitals.gcsEye, vitals.gcsVerbal, vitals.gcsMotor);
  const autoTriage = evaluateAutoTriage(vitals);
  const atsTriage = evaluateAtsTriage(vitals);
  const news2Result = calculateNews2Score(vitals);
  const pewsResult = calculatePewsScore(vitals);
  const meowsResult = calculateMeowsScore(vitals);

  const subViewHeaderMap: Record<string, { title: string; subtitle: string }> = {
    RME_DOKTER: {
      title: `Pemeriksaan Poliklinik & SOAP — ${activePatient?.fullName || ''}`,
      subtitle: 'Anamnesis, pemeriksaan fisik, diagnosis ICD-10, prosedur ICD-9-CM, dan peresepan terintegrasi.',
    },
    IGD_TRIASE_EWS: {
      title: `IGD, Triase ATS 1-5 & Skor EWS — ${activePatient?.fullName || ''}`,
      subtitle: 'Penilaian kegawatdaruratan Australasian Triage Scale 1-5 dan Early Warning Score spesifik populasi.',
    },
    GIGI_ODONTOGRAM: {
      title: `Poli Gigi & Odontogram FDI — ${activePatient?.fullName || ''}`,
      subtitle: 'Peta gigi dua digit standar FDI 11-48, status karies, tambalan, dan tindakan kedokteran gigi.',
    },
    KIA_IMUNISASI: {
      title: `Kesehatan Ibu Anak, ANC & Imunisasi — ${activePatient?.fullName || ''}`,
      subtitle: 'Asuhan kebidanan, Antenatal Care 10T, pemantauan kehamilan risiko tinggi, dan imunisasi dasar.',
    },
    PROLANIS_PRB: {
      title: `Penyakit Kronis, Prolanis & PRB — ${activePatient?.fullName || ''}`,
      subtitle: 'Pemantauan kohort Diabetes Melitus Tipe 2 & Hipertensi untuk kendali Rasio Peserta Prolanis Terkendali.',
    },
    BEDAH_IBS: {
      title: `Instalasi Bedah Sentral & OK — ${activePatient?.fullName || ''}`,
      subtitle: 'Jadwal kamar operasi, WHO Surgical Safety Checklist, dan laporan pembedahan terintegrasi.',
    },
    MCU_SURAT_MEDIS: {
      title: `Medical Check-Up & Surat Medis — ${activePatient?.fullName || ''}`,
      subtitle: 'Penerbitan surat keterangan sakit, surat sehat kelaikan kerja, informed consent, dan rujukan.',
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
    setOdontogram((prev) => {
      const filtered = prev.filter((o) => o.toothNumber !== selectedTooth);
      if (selectedToothCondition === 'NORMAL' && !selectedToothNotes.trim()) {
        return filtered;
      }
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
    if (!med || rxQuantity <= 0) return;

    setPrescriptions((prev) => [
      ...prev,
      {
        medicationId: med.id,
        medicationCode: med.code,
        medicationName: med.name,
        dosage: rxDosage.trim() || `1 ${med.unit}`,
        signa: rxSigna.trim() || '3 x 1 sesudah makan',
        quantity: Number(rxQuantity),
        unit: med.unit,
        unitPrice: med.sellPrice,
      },
    ]);
  };

  const handleAddProcedure = () => {
    const proc = ICD9_PROCEDURES_CATALOG.find((p) => p.code === selectedIcd9Code);
    if (!proc) return;
    if (procedures.some((p) => p.icd9Code === proc.code)) return;
    setProcedures((prev) => [
      ...prev,
      {
        icd9Code: proc.code,
        name: proc.name,
        tariff: proc.defaultTariff,
      },
    ]);
  };

  const toggleLabParam = (code: string) => {
    setLabRequestedParams((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const applyClinicalTemplate = (
    templateKey: 'ISPA' | 'HIPERTENSI' | 'DBD' | 'KARIES' | 'ASUHAN_PERAWAT' | 'ANC_BIDAN'
  ) => {
    if (templateKey === 'ISPA') {
      setChiefComplaint('Batuk berdahak disertai demam ringan dan nyeri tenggorokan sejak 3 hari.');
      setHistoryPresent('Pasien mengeluhkan batuk produktif, rhinorrhea (+), odynophagia (+), sesak napas (-).');
      setHeadToToeNotes('Faring hiperemis (+), tonsil T1-T1 tenang, rhonki (-/-), wheezing (-/-).');
      setPrimaryIcd10Code('J06.9');
      setPrimaryIcd10Name('Infeksi Saluran Pernapasan Akut Atas');
      setClinicalImpression('ISPA / Faringitis Akut Viral-Bakterial');
      setTherapyNotes('Terapi simtomatik antipiretik Paracetamol 500mg 3x1, istirahat cukup, hidrasi hangat.');
      setSickLeaveDays(2);
    } else if (templateKey === 'HIPERTENSI') {
      setChiefComplaint('Nyeri kepala bagian tengkuk disertai ulu hati perih dan mual.');
      setHistoryPresent('Tekanan darah meningkat sejak 3 hari terakhir disertai sindrom dispepsia.');
      setPrimaryIcd10Code('I10');
      setPrimaryIcd10Name('Hipertensi Esensial');
      setClinicalImpression('Hipertensi Stage 1 + Sindrom Dispepsia Akut');
      setTherapyNotes('Amlodipine 10mg 1x1 malam, Omeprazole 20mg 2x1 sebelum makan.');
      setSickLeaveDays(2);
    } else if (templateKey === 'DBD') {
      setChiefComplaint('Demam tinggi mendadak hari ke-4, nyeri retro-orbital, mialgia, bintik merah di kulit.');
      setHistoryPresent('Demam naik turun, uji tourniquet (+), tanda perdarahan mukosa minimal.');
      setPrimaryIcd10Code('A91');
      setPrimaryIcd10Name('Demam Berdarah Dengue');
      setClinicalImpression('Demam Berdarah Dengue Derajat II Fase Kritis');
      setTherapyNotes('Rehidrasi cairan kristaloid Ringer Laktat, antipiretik Paracetamol, pantau serial Hematokrit & Trombosit.');
      setLabRequestedParams(['HGB', 'HCT', 'PLT', 'WBC', 'NS1']);
      setDisposition('RAWAT_INAP');
      setSickLeaveDays(5);
    } else if (templateKey === 'KARIES') {
      setShowOdontogram(true);
      setChiefComplaint('Gigi geraham kanan bawah 46 terasa ngilu tajam saat minum dingin dan makan manis.');
      setHistoryPresent('Kavitas mencapai dentin pada permukaan oklusal gigi 46, nyeri spontan malam hari (-).');
      setPrimaryIcd10Code('K02.1');
      setPrimaryIcd10Name('Karies Dentin');
      setClinicalImpression('Pulpitis Reversibel / Karies Dentin Gigi 46');
      setOdontogram([
        {
          toothNumber: 46,
          condition: 'CARIES',
          surface: 'O',
          notes: 'Karies dentin kavitas oklusal, tes vitalitas (+), perkusi (-)',
        },
      ]);
      setProcedures([
        {
          icd9Code: '23.2',
          name: 'Restorasi Komposit Sinar',
          tariff: 250000,
        },
      ]);
    } else if (templateKey === 'ASUHAN_PERAWAT') {
      setChiefComplaint('Pengkajian keperawatan awal: observasi tanda vital, skala nyeri, dan risiko jatuh.');
      setHistoryPresent('Pengkajian keperawatan: jalan napas bersih, hemodinamik stabil, risiko jatuh rendah Skor Morse 15.');
      setHeadToToeNotes('Akral hangat, CRT < 2 detik, turgor kulit elastis, edukasi manajemen nyeri non-farmakologis diberikan.');
      setClinicalImpression('Asuhan Keperawatan Klinis Terpadu — Siap Pemeriksaan DPJP');
      setTherapyNotes('Observasi TTV berkala tiap 4 jam, manajemen nyeri relaksasi napas dalam, kolaborasi pemberian terapi medis.');
    } else if (templateKey === 'ANC_BIDAN') {
      setChiefComplaint('Kontrol kehamilan rutin Trimester II ANC Terpadu KIA.');
      setHistoryPresent('Gravida G2P1A0 usia kehamilan 24 minggu, gerakan janin aktif (+), mual muntah (-), perdarahan pervaginam (-).');
      setHeadToToeNotes('Pemeriksaan Kebidanan: TFU 22 cm, Leopold I bokong di fundus, Leopold II punggung kiri, DJJ 144x/menit reguler, LILA 25.5 cm.');
      setPrimaryIcd10Code('Z34.8');
      setPrimaryIcd10Name('Supervisi Kehamilan Normal ANC KIA');
      setClinicalImpression('G2P1A0 Hamil 24 Minggu Janin Tunggal Hidup Intrauterin · ANC 10T');
      setTherapyNotes('Suplementasi Tablet Tambah Darah Fe 1x1, Kalsium Laktat 500mg 1x1, konseling gizi ibu hamil & persiapan persalinan.');
    }
  };

  const handleSaveSoap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeVisit || !activePatient) return;
    setStatusBanner(null);
    setIsSaving(true);

    try {
      const result = await kaelApi.saveSoapRecord(token, facilityCode, {
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
        text: `RME SOAP berhasil disimpan & disinkronkan ke SATUSEHAT (${result.soapRecord.satusehatEncounterId}). Order Farmasi, Lab, dan Tagihan Kasir (${result.invoice.invoiceNumber}) telah diterbitkan otomatis.`,
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
          Belum ada pasien dalam antrean aktif di fasilitas {facilityCode}. Silakan daftarkan kunjungan baru terlebih dahulu.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left 3 Columns: Active Queue Selector & Patient Clinical Profile */}
      <aside className="lg:col-span-3 space-y-4">
        <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-4">
          <h2 className="text-xs font-bold text-[#0F2922] dark:text-white mb-2.5">
            Daftar Antrean Pasien ({workspace.visits.length})
          </h2>
          <div className="space-y-1.5 max-h-[340px] overflow-y-auto pr-1">
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
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span className="font-bold text-[#00897B]">
                      {v.queueNumber}
                    </span>
                    <span className="text-[#52736B]">{v.status.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="text-xs font-semibold text-[#0F2922] dark:text-white mt-0.5 truncate">
                    {v.patientName} ({v.gender})
                  </div>
                  <div className="text-[11px] font-mono text-[#52736B] truncate">
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
            <div className="font-mono text-[11px] text-[#00897B] font-semibold">
              {activePatient.mrNumber} · IHS {activePatient.ihsNumber}
            </div>
            <h3 className="text-sm font-bold text-[#0F2922] dark:text-white mt-0.5">
              {activePatient.fullName} ({activePatient.gender})
            </h3>
            <div className="text-[11px] text-[#52736B] font-mono mt-0.5">
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

          <div className="pt-2 border-t border-[#E2ECE8] dark:border-[#183831] space-y-1 text-[11px] text-[#52736B]">
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
              {activePatient.chronicConditions.join(', ') || 'Tidak ada'}
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
                    className="p-2.5 rounded-xl border border-[#E2ECE8] dark:border-[#183831] bg-[#F8FBFA] dark:bg-[#081916] text-[11px] space-y-1"
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
                <div className="text-[11px] text-[#52736B]">
                  Belum ada riwayat SOAP tersimpan untuk pasien ini.
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Main 9 Columns: Comprehensive RME SOAP + Odontogram + Perawat/Bidan + E-Resep Workstation */}
      <form onSubmit={handleSaveSoap} className="lg:col-span-9 space-y-5">
        {/* Top Action, Export & Clinical Template Bar */}
        <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-5 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs font-mono text-[#00897B] font-semibold">
                No. Registrasi: {activeVisit.registrationNumber} · DPJP: {activeVisit.doctorName} · Peran Aktif: {ROLE_LABELS[workspace.user.role] || workspace.user.role}
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

          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-[#E2ECE8] dark:border-[#183831]">
            <span className="text-[11px] font-semibold text-[#52736B] mr-1">
              Template Klinis Profesi:
            </span>
            <button
              type="button"
              onClick={() => applyClinicalTemplate('ASUHAN_PERAWAT')}
              className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-[#00897B] bg-[#E6F4F1] dark:bg-[#0F3D35] text-[#00695C] dark:text-[#80CBC4] hover:bg-[#00897B] hover:text-white transition-colors cursor-pointer"
            >
              Perawat: Asuhan SDKI/SIKI
            </button>
            <button
              type="button"
              onClick={() => applyClinicalTemplate('ANC_BIDAN')}
              className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-[#00897B] bg-[#E6F4F1] dark:bg-[#0F3D35] text-[#00695C] dark:text-[#80CBC4] hover:bg-[#00897B] hover:text-white transition-colors cursor-pointer"
            >
              Bidan: KIA &amp; ANC Kehamilan
            </button>
            <button
              type="button"
              onClick={() => applyClinicalTemplate('HIPERTENSI')}
              className="px-2.5 py-1 text-xs font-medium rounded-lg border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1] dark:hover:bg-[#133830] cursor-pointer"
            >
              Dokter: Hipertensi + Dispepsia
            </button>
            <button
              type="button"
              onClick={() => applyClinicalTemplate('ISPA')}
              className="px-2.5 py-1 text-xs font-medium rounded-lg border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1] dark:hover:bg-[#133830] cursor-pointer"
            >
              Dokter: ISPA Akut
            </button>
            <button
              type="button"
              onClick={() => applyClinicalTemplate('DBD')}
              className="px-2.5 py-1 text-xs font-medium rounded-lg border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1] dark:hover:bg-[#133830] cursor-pointer"
            >
              IGD: DBD / DHF
            </button>
            <button
              type="button"
              onClick={() => applyClinicalTemplate('KARIES')}
              className="px-2.5 py-1 text-xs font-medium rounded-lg border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1] dark:hover:bg-[#133830] cursor-pointer"
            >
              Dokter Gigi: Odontogram Karies
            </button>
          </div>

          {/* Dedicated Sub-Capability Clinical Panel (ATS 1-5 + NEWS2/PEWS/MEOWS or Surgical IBS) */}
          {initialSubView === 'IGD_TRIASE_EWS' && (
            <div className="pt-3 border-t border-[#E2ECE8] dark:border-[#183831] grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="text-[11px] font-semibold text-slate-500">Triase ATS 1-5 Resmi</div>
                <div className="text-sm font-bold text-[#0F2922] dark:text-white mt-0.5">
                  {atsTriage.category} — {atsTriage.label}
                </div>
                <div className="text-[11px] text-teal-700 dark:text-teal-400 font-mono mt-0.5">
                  Target Respons: {atsTriage.maxWaitMinutes === 0 ? 'Segera' : `≤ ${atsTriage.maxWaitMinutes} menit`}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="text-[11px] font-semibold text-slate-500">Skor NEWS2 Dewasa</div>
                <div className="text-sm font-bold font-mono text-[#0F2922] dark:text-white mt-0.5">
                  Skor {news2Result.totalScore} · Risiko {news2Result.clinicalRisk}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                  {news2Result.recommendedResponse}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="text-[11px] font-semibold text-slate-500">PEWS Pediatrik</div>
                <div className="text-sm font-bold font-mono text-[#0F2922] dark:text-white mt-0.5">
                  Skor {pewsResult.totalScore} · Risiko {pewsResult.clinicalRisk}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                  {pewsResult.recommendedResponse}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="text-[11px] font-semibold text-slate-500">MEOWS Obstetri</div>
                <div className="text-sm font-bold font-mono text-[#0F2922] dark:text-white mt-0.5">
                  Red {meowsResult.redTriggers} / Amber {meowsResult.amberTriggers}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                  Risiko {meowsResult.clinicalRisk}
                </div>
              </div>
            </div>
          )}

          {initialSubView === 'BEDAH_IBS' && (
            <div className="pt-3 border-t border-[#E2ECE8] dark:border-[#183831] space-y-2 text-xs">
              <div className="font-bold text-[#0F2922] dark:text-white">
                Jadwal Kamar Operasi &amp; WHO Surgical Safety Checklist ({(workspace.surgicalSchedules || []).length})
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
                      <div className="text-[11px] text-slate-500 font-mono">
                        {ibs.operatingRoomCode} · Pasien: {ibs.patientName} · Bedah: {ibs.surgeonName}
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-teal-100 dark:bg-teal-950 text-teal-800 dark:text-teal-300 font-mono text-[10px] font-bold">
                      WHO Sign-In/Time-Out/Sign-Out ✓
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
              <span>MAP: <strong>{mapValue} mmHg</strong></span>
              <span aria-hidden="true">·</span>
              <span>IMT/BMI: <strong>{bmiData.bmi} ({bmiData.category})</strong></span>
              <span aria-hidden="true">·</span>
              <span>GCS: <strong>{gcsTotal}/15</strong></span>
              <span aria-hidden="true">·</span>
              <span>Triase: <strong>{autoTriage.replace(/_/g, ' ')}</strong></span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
            <div>
              <label className="block text-[11px] text-slate-500">TD Sistolik</label>
              <input
                type="number"
                value={vitals.systolic}
                onChange={(e) => setVitals({ ...vitals, systolic: Number(e.target.value) })}
                className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500">TD Diastolik</label>
              <input
                type="number"
                value={vitals.diastolic}
                onChange={(e) => setVitals({ ...vitals, diastolic: Number(e.target.value) })}
                className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500">Nadi bpm</label>
              <input
                type="number"
                value={vitals.heartRate}
                onChange={(e) => setVitals({ ...vitals, heartRate: Number(e.target.value) })}
                className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500">Respirasi</label>
              <input
                type="number"
                value={vitals.respiratoryRate}
                onChange={(e) =>
                  setVitals({ ...vitals, respiratoryRate: Number(e.target.value) })
                }
                className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500">Suhu °C</label>
              <input
                type="number"
                step="0.1"
                value={vitals.temperature}
                onChange={(e) => setVitals({ ...vitals, temperature: Number(e.target.value) })}
                className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500">SpO2 %</label>
              <input
                type="number"
                value={vitals.spo2}
                onChange={(e) => setVitals({ ...vitals, spo2: Number(e.target.value) })}
                className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500">Berat kg</label>
              <input
                type="number"
                value={vitals.weightKg}
                onChange={(e) => setVitals({ ...vitals, weightKg: Number(e.target.value) })}
                className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500">Tinggi cm</label>
              <input
                type="number"
                value={vitals.heightCm}
                onChange={(e) => setVitals({ ...vitals, heightCm: Number(e.target.value) })}
                className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
          </div>

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
              <span className="text-[11px] text-slate-500">
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
                          const cond = entry ? entry.condition : 'NORMAL';
                          const style = TOOTH_CONDITION_LABELS[cond];
                          return (
                            <button
                              key={tNum}
                              type="button"
                              onClick={() => setSelectedTooth(tNum)}
                              className={`w-8 h-11 rounded border text-center flex flex-col items-center justify-center transition-all cursor-pointer ${
                                style.colorClass
                              } ${selectedTooth === tNum ? 'ring-2 ring-teal-600' : ''}`}
                            >
                              <span className="text-[10px] font-mono">{tNum}</span>
                              <span className="text-[11px] font-mono">{style.short}</span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex gap-1">
                        {UPPER_LEFT_TEETH.map((tNum) => {
                          const entry = odontogram.find((o) => o.toothNumber === tNum);
                          const cond = entry ? entry.condition : 'NORMAL';
                          const style = TOOTH_CONDITION_LABELS[cond];
                          return (
                            <button
                              key={tNum}
                              type="button"
                              onClick={() => setSelectedTooth(tNum)}
                              className={`w-8 h-11 rounded border text-center flex flex-col items-center justify-center transition-all cursor-pointer ${
                                style.colorClass
                              } ${selectedTooth === tNum ? 'ring-2 ring-teal-600' : ''}`}
                            >
                              <span className="text-[10px] font-mono">{tNum}</span>
                              <span className="text-[11px] font-mono">{style.short}</span>
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
                          const cond = entry ? entry.condition : 'NORMAL';
                          const style = TOOTH_CONDITION_LABELS[cond];
                          return (
                            <button
                              key={tNum}
                              type="button"
                              onClick={() => setSelectedTooth(tNum)}
                              className={`w-8 h-11 rounded border text-center flex flex-col items-center justify-center transition-all cursor-pointer ${
                                style.colorClass
                              } ${selectedTooth === tNum ? 'ring-2 ring-teal-600' : ''}`}
                            >
                              <span className="text-[11px] font-mono">{style.short}</span>
                              <span className="text-[10px] font-mono">{tNum}</span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex gap-1">
                        {LOWER_LEFT_TEETH.map((tNum) => {
                          const entry = odontogram.find((o) => o.toothNumber === tNum);
                          const cond = entry ? entry.condition : 'NORMAL';
                          const style = TOOTH_CONDITION_LABELS[cond];
                          return (
                            <button
                              key={tNum}
                              type="button"
                              onClick={() => setSelectedTooth(tNum)}
                              className={`w-8 h-11 rounded border text-center flex flex-col items-center justify-center transition-all cursor-pointer ${
                                style.colorClass
                              } ${selectedTooth === tNum ? 'ring-2 ring-teal-600' : ''}`}
                            >
                              <span className="text-[11px] font-mono">{style.short}</span>
                              <span className="text-[10px] font-mono">{tNum}</span>
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
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
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
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                      Kondisi Klinis Gigi
                    </label>
                    <select
                      value={selectedToothCondition}
                      onChange={(e) => setSelectedToothCondition(e.target.value as ToothCondition)}
                      className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    >
                      {Object.entries(TOOTH_CONDITION_LABELS).map(([k, val]) => (
                        <option key={k} value={k}>
                          {val.short} - {val.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                      Permukaan
                    </label>
                    <select
                      value={selectedToothSurface}
                      onChange={(e) =>
                        setSelectedToothSurface(e.target.value as OdontogramEntry['surface'])
                      }
                      className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    >
                      <option value="O">O — Oklusal</option>
                      <option value="M">M — Mesial</option>
                      <option value="D">D — Distal</option>
                      <option value="B">B — Bukal / Labial</option>
                      <option value="L">L — Lingual / Palatal</option>
                      <option value="ALL">Seluruh Elemen</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
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
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-teal-700 hover:text-white shrink-0"
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
                  <div className="text-[11px] text-slate-500">
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
                Peringatan Keamanan Resep Klinis:
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
                <label className="block text-[11px] text-slate-500 mb-1">
                  Pilih Obat / Alkes dari Inventaris Aktif
                </label>
                <select
                  value={selectedMedId}
                  onChange={(e) => setSelectedMedId(e.target.value)}
                  aria-label="Pilih Obat E-Resep"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
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
                <label className="block text-[11px] text-slate-500 mb-1">Dosis</label>
                <input
                  type="text"
                  value={rxDosage}
                  onChange={(e) => setRxDosage(e.target.value)}
                  placeholder="500 mg"
                  className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block text-[11px] text-slate-500 mb-1">Signa / Aturan Pakai</label>
                <input
                  type="text"
                  value={rxSigna}
                  onChange={(e) => setRxSigna(e.target.value)}
                  placeholder="3 x 1 sesudah makan"
                  className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div className="sm:col-span-1">
                <label className="block text-[11px] text-slate-500 mb-1">Jml</label>
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
                    <tr className="bg-slate-50 dark:bg-slate-800/50 text-[11px] text-slate-500 border-b border-slate-200 dark:border-slate-800">
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
                        <td className="py-2 px-3 font-mono text-[11px]">
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
                  {ICD9_PROCEDURES_CATALOG.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.code} - {p.name} · {formatRupiah(p.defaultTariff)}
                    </option>
                  ))}
                </select>
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
                        {formatRupiah(proc.tariff)}
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
                  ? 'Tutup Generator Dokumen Medis'
                  : 'Cetak Surat Medis & Dokumen Resmi'}
              </button>
            </div>

            <button
              type="submit"
              disabled={isSaving}
              className="px-6 py-2.5 text-xs font-semibold rounded-lg bg-teal-700 hover:bg-teal-800 text-white flex items-center gap-2 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              {isSaving
                ? 'Menyimpan & Mengirim ke SATUSEHAT / Apotek / Kasir...'
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
                  { key: 'SURAT_SAKIT', label: 'Surat Keterangan Sakit' },
                  { key: 'SURAT_SEHAT', label: 'Surat Keterangan Sehat' },
                  { key: 'SURAT_RUJUKAN', label: 'Surat Rujukan FKTL' },
                  { key: 'INFORMED_CONSENT', label: 'Informed Consent Tindakan' },
                  { key: 'SALINAN_RESEP', label: 'Salinan Resep' },
                ].map((doc) => (
                  <button
                    key={doc.key}
                    type="button"
                    onClick={() =>
                      setPrintDocType(doc.key as typeof printDocType)
                    }
                    className={`px-3 py-1.5 text-xs font-semibold rounded cursor-pointer ${
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
                onClick={() => window.print()}
                className="px-3 py-1.5 text-xs font-semibold rounded bg-slate-900 text-white flex items-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                Cetak Dokumen Ini
              </button>
            </div>

            <div className="flex items-start justify-between border-b-2 border-slate-900 pb-4">
              <div>
                <h4 className="text-base font-bold uppercase">
                  {workspace.activeFacility.name}
                </h4>
                <p className="text-xs text-slate-600">
                  {workspace.activeFacility.address}, {workspace.activeFacility.city} · Telp: {workspace.activeFacility.phone}
                </p>
                <p className="text-[11px] font-mono text-slate-500">
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
              <p className="text-xs font-mono">Nomor: DOC/{printDocType}/{activeVisit.registrationNumber}</p>
            </div>

            <div className="text-xs space-y-2 leading-relaxed">
              <p>
                Yang bertanda tangan di bawah ini, Dokter Pemeriksa pada{' '}
                <strong>{workspace.activeFacility.name}</strong>, menerangkan bahwa pasien:
              </p>
              <div className="pl-4 font-mono space-y-1">
                <div>Nama Lengkap : {activePatient.fullName} ({activePatient.gender})</div>
                <div>Nomor RM / NIK: {activePatient.mrNumber} / {activePatient.nik}</div>
                <div>Tanggal Lahir: {activePatient.birthDate}</div>
                <div>Diagnosis    : {primaryIcd10Code} — {primaryIcd10Name}</div>
                <div>
                  Tanda Vital  : TD {vitals.systolic}/{vitals.diastolic} mmHg, Nadi {vitals.heartRate}x/mnt, Suhu {vitals.temperature}°C, BB {vitals.weightKg} kg, TB {vitals.heightCm} cm (IMT {bmiData.bmi})
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
                  Berdasarkan pemeriksaan fisik dan tanda vital pada saat ini, pasien dinyatakan dalam kondisi{' '}
                  <strong>SEHAT FISIK</strong> untuk keperluan administrasi / pekerjaan / pendidikan.
                </p>
              )}

              {printDocType === 'SURAT_RUJUKAN' && (
                <p>
                  Mohon pemeriksaan dan penanganan medis lebih lanjut di Fasilitas Kesehatan Rujukan Tingkat Lanjut bagian Spesialis terkait. Terapi awal yang telah diberikan: {therapyNotes}.
                </p>
              )}

              {printDocType === 'INFORMED_CONSENT' && (
                <p>
                  Pasien / keluarga telah mendapatkan penjelasan lengkap mengenai tujuan, risiko, dan prosedur tindakan medis ({procedures.map((p) => `${p.icd9Code} ${p.name}`).join(', ')}) serta menyatakan <strong>SETUJU</strong> untuk dilakukan tindakan tersebut.
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
                <div>{workspace.activeFacility.city}, {new Date().toLocaleDateString('id-ID')}</div>
                <div className="font-semibold mt-12 underline">{activeVisit.doctorName}</div>
                <div className="text-[11px] font-mono text-slate-500">DPJP / Dokter Pemeriksa</div>
              </div>
            </div>
          </section>
        )}
      </form>
    </div>
  );
};
