// Browser presentation and previews use API-provided permissions. Operations are validated by the server.
import { canUserAccessModule, getInvoiceOutstanding } from './clinicalLogic.ts';

import type {
  AccountingEntry,
  AccountingEventType,
  AtsTriageCategory,
  ClinicalAmendmentEntry,
  DoubleEntryJournal,
  DoubleEntryJournalLine,
  EvidenceRegistryItem,
  Facility,
  IdempotencyRecord,
  InpatientBed,
  InvoiceRecord,
  MedicationInventory,
  MedicationStockMutation,
  ModuleKey,
  OperationalReadiness,
  Patient,
  PurchaseOrderPbf,
  ReferralOrchestrationRecord,
  SoapRecord,
  SubCapabilityDefinition,
  SubCapabilityKey,
  SuperuserFacilityConfigSnapshot,
  UserAccount,
  VisitQueueItem,
  VitalSigns,
} from './simrs.ts';


// ============================================================================
// 1. PREBUILT SUB-CAPABILITY CATALOG (P0-01, P0-03, P0-04)
// ============================================================================

export const SUB_CAPABILITY_CATALOG: SubCapabilityDefinition[] = [
  {
    code: 'SUB_PATIENT_MPI',
    capabilityGroup: 'FRONT_OFFICE',
    name: 'Direktori Pasien & Rekam Medis Lokal',
    mappedModule: 'SEMUA_PASIEN',
    implementationStatus: 'IMPLEMENTED',
    defaultReadiness: 'ACTIVE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: {},
    description: 'Master identitas pasien per fasilitas dengan isolasi tenant dan nomor RM lokal.',
  },
  {
    code: 'SUB_ADMISSION_OUTPATIENT',
    capabilityGroup: 'FRONT_OFFICE',
    name: 'Loket Pendaftaran Rawat Jalan',
    mappedModule: 'PENDAFTARAN',
    implementationStatus: 'IMPLEMENTED',
    defaultReadiness: 'ACTIVE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: { allOf: ['SUB_PATIENT_MPI'] },
    description: 'Registrasi kunjungan sakit dan kunjungan sehat dengan deteksi otomatis pasien terdaftar.',
  },
  {
    code: 'SUB_ADMISSION_EMERGENCY',
    capabilityGroup: 'FRONT_OFFICE',
    name: 'Admisi Gawat Darurat & Pasien Darurat',
    mappedModule: 'IGD_TRIASE_EWS',
    implementationStatus: 'IMPLEMENTED',
    defaultReadiness: 'CONFIGURABLE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: { allOf: ['SUB_IGD_TRIAGE_ATS'] },
    description: 'Registrasi cepat pasien IGD yang mengizinkan tindakan stabilisasi sebelum administrasi lengkap.',
  },
  {
    code: 'SUB_DOCTOR_SCHEDULE_BOOKING',
    capabilityGroup: 'FRONT_OFFICE',
    name: 'Jadwal Praktik & Kuota Antrean',
    mappedModule: 'JADWAL_DOKTER',
    implementationStatus: 'PARTIAL',
    defaultReadiness: 'ACTIVE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: { allOf: ['SUB_PATIENT_MPI'], requiredEvidenceTypes: ['SIP_NAKES'] },
    description: 'Pengaturan jadwal sesi praktik tenaga medis, kuota per sesi, dan perjanjian pasien.',
  },
  {
    code: 'SUB_INPATIENT_BED_MGMT',
    capabilityGroup: 'FRONT_OFFICE',
    name: 'Manajemen Bangsal & Tempat Tidur',
    mappedModule: 'RAWAT_INAP',
    implementationStatus: 'IMPLEMENTED',
    defaultReadiness: 'CONFIGURABLE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: {
      allOf: ['SUB_PATIENT_MPI'],
      requiredEvidenceTypes: ['IZIN_OPERASIONAL'],
    },
    description: 'Peta tempat tidur rawat inap, mutasi kamar, pemulangan, dan pemantauan batas hari rawat.',
  },
  {
    code: 'SUB_OUTPATIENT_SOAP_CPPT',
    capabilityGroup: 'CLINICAL_RME',
    name: 'Pemeriksaan Klinis & CPPT Multi-Profesi',
    mappedModule: 'RME_DOKTER',
    implementationStatus: 'IMPLEMENTED',
    defaultReadiness: 'ACTIVE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: {
      allOf: ['SUB_ADMISSION_OUTPATIENT'],
      requiredEvidenceTypes: ['SIP_NAKES'],
    },
    description: 'Rekam medis elektronik SOAP dan CPPT kolaboratif dengan penguncian Permenkes 24/2022 Pasal 30.',
  },
  {
    code: 'SUB_IGD_TRIAGE_ATS',
    capabilityGroup: 'CLINICAL_RME',
    name: 'Triase IGD ATS 1–5 & Protokol Darurat',
    mappedModule: 'IGD_TRIASE_EWS',
    implementationStatus: 'IMPLEMENTED',
    defaultReadiness: 'CONFIGURABLE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: { requiredEvidenceTypes: ['SIP_NAKES'] },
    description: 'Penilaian triase gawat darurat menggunakan standar Australasian Triage Scale 1–5.',
  },
  {
    code: 'SUB_CLINICAL_EWS_SCORING',
    capabilityGroup: 'CLINICAL_RME',
    name: 'Skoring Peringatan Dini NEWS2, PEWS & MEOWS',
    mappedModule: 'IGD_TRIASE_EWS',
    implementationStatus: 'IMPLEMENTED',
    defaultReadiness: 'CONFIGURABLE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: { anyOf: ['SUB_OUTPATIENT_SOAP_CPPT', 'SUB_IGD_TRIAGE_ATS'] },
    description: 'Kalkulator peringatan dini spesifik populasi dewasa, pediatrik, dan obstetri.',
  },
  {
    code: 'SUB_DENTAL_ODONTOGRAM',
    capabilityGroup: 'CLINICAL_RME',
    name: 'Pelayanan Gigi & Peta Odontogram FDI',
    mappedModule: 'GIGI_ODONTOGRAM',
    implementationStatus: 'IMPLEMENTED',
    defaultReadiness: 'CONFIGURABLE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: {
      allOf: ['SUB_OUTPATIENT_SOAP_CPPT'],
      requiredEvidenceTypes: ['SIP_NAKES'],
    },
    description: 'Pemeriksaan kedokteran gigi dengan pemetaan 32 gigi standar FDI.',
  },
  {
    code: 'SUB_ANC_BASIC',
    capabilityGroup: 'MATERNAL_CHILD',
    name: 'Pemeriksaan Kehamilan Dasar & KIA',
    mappedModule: 'KIA_IMUNISASI',
    implementationStatus: 'IMPLEMENTED',
    defaultReadiness: 'CONFIGURABLE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: { requiredEvidenceTypes: ['SIP_NAKES'] },
    description: 'Pemeriksaan antenatal care, perhitungan usia kehamilan, HPL Naegele, dan skrining risiko.',
  },
  {
    code: 'SUB_DELIVERY_PARTOGRAPH',
    capabilityGroup: 'MATERNAL_CHILD',
    name: 'Persalinan Normal, Partograf & Nifas',
    mappedModule: 'KIA_IMUNISASI',
    implementationStatus: 'PARTIAL',
    defaultReadiness: 'CONFIGURABLE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: { allOf: ['SUB_ANC_BASIC'], requiredEvidenceTypes: ['IZIN_OPERASIONAL', 'SIP_NAKES'] },
    description: 'Pemantauan persalinan aktif, pencatatan partograf, dan perawatan pascapersalinan.',
  },
  {
    code: 'SUB_HIGH_RISK_OBSTETRICS',
    capabilityGroup: 'MATERNAL_CHILD',
    name: 'Obstetri Risiko Tinggi & PONEK',
    mappedModule: 'KIA_IMUNISASI',
    implementationStatus: 'PARTIAL',
    defaultReadiness: 'CONFIGURABLE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: {
      allOf: ['SUB_DELIVERY_PARTOGRAPH', 'SUB_INPATIENT_BED_MGMT'],
      anyOf: ['SUB_BLOOD_BANK_BDRS', 'SUB_LAB_PATHOLOGY'],
      requiredEvidenceTypes: ['IZIN_OPERASIONAL', 'SIP_NAKES'],
    },
    description: 'Penanganan rujukan kehamilan risiko tinggi dan komplikasi obstetri.',
  },
  {
    code: 'SUB_IMMUNIZATION_VACCINE',
    capabilityGroup: 'MATERNAL_CHILD',
    name: 'Layanan Imunisasi & Vaksinasi',
    mappedModule: 'KIA_IMUNISASI',
    implementationStatus: 'IMPLEMENTED',
    defaultReadiness: 'CONFIGURABLE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: { allOf: ['SUB_PHARMACY_INVENTORY_OPNAME'] },
    description: 'Pencatatan jadwal imunisasi bayi, anak, dan dewasa beserta nomor batch vaksin.',
  },
  {
    code: 'SUB_CHRONIC_DISEASE_REGISTRY',
    capabilityGroup: 'CHRONIC_SPECIALIZED',
    name: 'Registri Pemantauan Penyakit Kronis',
    mappedModule: 'PROLANIS_PRB',
    implementationStatus: 'IMPLEMENTED',
    defaultReadiness: 'CONFIGURABLE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: { allOf: ['SUB_OUTPATIENT_SOAP_CPPT'] },
    description: 'Pemantauan berkala indikator klinis pasien penyakit kronis tanpa syarat wajib lab patologi penuh.',
  },
  {
    code: 'SUB_PROLANIS_CLUB',
    capabilityGroup: 'CHRONIC_SPECIALIZED',
    name: 'Manajemen Kohor Prolanis DM & Hipertensi',
    mappedModule: 'PROLANIS_PRB',
    implementationStatus: 'IMPLEMENTED',
    defaultReadiness: 'CONFIGURABLE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: { allOf: ['SUB_CHRONIC_DISEASE_REGISTRY'] },
    description: 'Evaluasi rasio peserta Prolanis terkendali untuk kohort Diabetes Melitus dan Hipertensi.',
  },
  {
    code: 'SUB_PRB_MEDICATION_CONTINUITY',
    capabilityGroup: 'CHRONIC_SPECIALIZED',
    name: 'Program Rujuk Balik & Resep Kronis',
    mappedModule: 'PROLANIS_PRB',
    implementationStatus: 'IMPLEMENTED',
    defaultReadiness: 'CONFIGURABLE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: { allOf: ['SUB_CHRONIC_DISEASE_REGISTRY', 'SUB_REFERRAL_ORCHESTRATION'] },
    description: 'Tindak lanjut pasien rujuk balik dari FKRTL dan pengelolaan terapi obat kronis bulanan.',
  },
  {
    code: 'SUB_SURGERY_IBS',
    capabilityGroup: 'CHRONIC_SPECIALIZED',
    name: 'Instalasi Bedah Sentral & Safety Checklist',
    mappedModule: 'BEDAH_IBS',
    implementationStatus: 'IMPLEMENTED',
    defaultReadiness: 'CONFIGURABLE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: {
      allOf: ['SUB_INPATIENT_BED_MGMT', 'SUB_CSSD_STERILIZATION'],
      requiredEvidenceTypes: ['IZIN_OPERASIONAL', 'SIP_NAKES', 'KALIBRASI_ALKES'],
    },
    description: 'Penjadwalan kamar operasi, daftar tilik keselamatan bedah WHO, dan pemakaian BMHP bedah.',
  },
  {
    code: 'SUB_HEMODIALYSIS_UNIT',
    capabilityGroup: 'CHRONIC_SPECIALIZED',
    name: 'Unit Hemodialisis & Pemantauan Mesin',
    mappedModule: 'BEDAH_IBS',
    implementationStatus: 'PARTIAL',
    defaultReadiness: 'CONFIGURABLE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: {
      allOf: ['SUB_OUTPATIENT_SOAP_CPPT'],
      requiredEvidenceTypes: ['IZIN_OPERASIONAL', 'SIP_NAKES', 'KALIBRASI_ALKES'],
    },
    description: 'Pelayanan dialisis ginjal dengan verifikasi kalibrasi mesin dan sertifikasi tenaga medis.',
  },
  {
    code: 'SUB_MCU_MEDICAL_CERTIFICATES',
    capabilityGroup: 'CHRONIC_SPECIALIZED',
    name: 'Medical Check-Up & Surat Keterangan Medis',
    mappedModule: 'MCU_SURAT_MEDIS',
    implementationStatus: 'IMPLEMENTED',
    defaultReadiness: 'ACTIVE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: { allOf: ['SUB_OUTPATIENT_SOAP_CPPT'] },
    description: 'Pemeriksaan paket MCU kelaikan kerja serta penerbitan Surat Sakit, Surat Sehat, dan Rujukan.',
  },
  {
    code: 'SUB_PHARMACY_DISPENSING_FEFO',
    capabilityGroup: 'PHARMACY_SUPPLY',
    name: 'Pelayanan Resep, Dispensing Parsial & Retur',
    mappedModule: 'APOTEK',
    implementationStatus: 'IMPLEMENTED',
    defaultReadiness: 'ACTIVE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: {
      allOf: ['SUB_PHARMACY_INVENTORY_OPNAME'],
      requiredEvidenceTypes: ['SIP_NAKES'],
    },
    description: 'Verifikasi resep 7 Benar, pemotongan stok FEFO ber-idempotensi, pemenuhan parsial, dan retur.',
  },
  {
    code: 'SUB_PHARMACY_INVENTORY_OPNAME',
    capabilityGroup: 'PHARMACY_SUPPLY',
    name: 'Katalog Obat KFA, Stock Opname & Kartu Stok',
    mappedModule: 'KATALOG_OPNAME',
    implementationStatus: 'IMPLEMENTED',
    defaultReadiness: 'ACTIVE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: {},
    description: 'Pengelolaan master obat KFA, stok sistem per batch, opname fisik, dan riwayat mutasi.',
  },
  {
    code: 'SUB_PROCUREMENT_PO_PBF',
    capabilityGroup: 'PHARMACY_SUPPLY',
    name: 'Pengadaan PO, Faktur PBF & Retur Pembelian',
    mappedModule: 'PENGADAAN_PBF',
    implementationStatus: 'IMPLEMENTED',
    defaultReadiness: 'ACTIVE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: { allOf: ['SUB_PHARMACY_INVENTORY_OPNAME', 'SUB_ACCOUNTING_DOUBLE_ENTRY'] },
    description: 'Siklus Purchase Order ke PBF, penerimaan batch faktur, dan pencatatan utang dagang otomatis.',
  },
  {
    code: 'SUB_LAB_PATHOLOGY',
    capabilityGroup: 'DIAGNOSTIC_SUPPORT',
    name: 'Laboratorium Patologi Klinik',
    mappedModule: 'LABORATORIUM',
    implementationStatus: 'IMPLEMENTED',
    defaultReadiness: 'ACTIVE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: { requiredEvidenceTypes: ['SIP_NAKES', 'KALIBRASI_ALKES'] },
    description: 'Order pemeriksaan laboratorium, pelacakan spesimen, deteksi nilai kritis, dan verifikasi hasil.',
  },
  {
    code: 'SUB_RADIOLOGY_IMAGING',
    capabilityGroup: 'DIAGNOSTIC_SUPPORT',
    name: 'Radiologi & Pencitraan Diagnostik',
    mappedModule: 'RADIOLOGI_RIS',
    implementationStatus: 'IMPLEMENTED',
    defaultReadiness: 'CONFIGURABLE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: { requiredEvidenceTypes: ['IZIN_OPERASIONAL', 'SIP_NAKES', 'KALIBRASI_ALKES'] },
    description: 'Pemeriksaan Rontgen, USG, CT-Scan, dan EKG beserta pembacaan ekspertise radiologi.',
  },
  {
    code: 'SUB_NUTRITION_DIETARY',
    capabilityGroup: 'DIAGNOSTIC_SUPPORT',
    name: 'Instalasi Gizi & Diet Rawat Inap',
    mappedModule: 'PENUNJANG_RS',
    implementationStatus: 'PARTIAL',
    defaultReadiness: 'CONFIGURABLE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: { allOf: ['SUB_INPATIENT_BED_MGMT'] },
    description: 'Pengelolaan pesanan diet pasien rawat inap dan evaluasi asupan nutrisi.',
  },
  {
    code: 'SUB_BLOOD_BANK_BDRS',
    capabilityGroup: 'DIAGNOSTIC_SUPPORT',
    name: 'Bank Darah & Distribusi Transfusi',
    mappedModule: 'PENUNJANG_RS',
    implementationStatus: 'PARTIAL',
    defaultReadiness: 'CONFIGURABLE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: { requiredEvidenceTypes: ['IZIN_OPERASIONAL'] },
    description: 'Manajemen persediaan kantong darah golongan A/B/AB/O dan uji silang serasi.',
  },
  {
    code: 'SUB_CSSD_STERILIZATION',
    capabilityGroup: 'DIAGNOSTIC_SUPPORT',
    name: 'Sterilisasi Instrumen CSSD / Mitra Resmi',
    mappedModule: 'PENUNJANG_RS',
    implementationStatus: 'PARTIAL',
    defaultReadiness: 'CONFIGURABLE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: {
      requiredEvidenceTypes: ['KALIBRASI_ALKES'],
    },
    description: 'Pemantauan siklus sterilisasi instrumen medis melalui CSSD internal atau mitra berizin.',
  },
  {
    code: 'SUB_IPSRS_AMBULANCE',
    capabilityGroup: 'DIAGNOSTIC_SUPPORT',
    name: 'Pemeliharaan Alkes IPSRS & Armada Ambulans',
    mappedModule: 'PENUNJANG_RS',
    implementationStatus: 'PARTIAL',
    defaultReadiness: 'CONFIGURABLE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: {},
    description: 'Jadwal kalibrasi alat kesehatan, pemeliharaan sarana gedung, dan kesiapan ambulans.',
  },
  {
    code: 'SUB_CASHIER_BILLING_DEPOSIT',
    capabilityGroup: 'FINANCE_ACCOUNTING',
    name: 'Kasir, Deposit Rawat Inap & Penagihan',
    mappedModule: 'KASIR_AKUNTANSI',
    implementationStatus: 'IMPLEMENTED',
    defaultReadiness: 'ACTIVE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: { allOf: ['SUB_ACCOUNTING_DOUBLE_ENTRY'] },
    description: 'Penyelesaian tagihan layanan, penerimaan deposit uang muka, refund, dan cetak kuitansi.',
  },
  {
    code: 'SUB_CLAIM_FKTP_KBK',
    capabilityGroup: 'FINANCE_ACCOUNTING',
    name: 'Kapitasi Berbasis Kinerja & Klaim Non-Kapitasi',
    mappedModule: 'KLAIM_BPJS_PIUTANG',
    implementationStatus: 'IMPLEMENTED',
    defaultReadiness: 'CONFIGURABLE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: { allOf: ['SUB_CASHIER_BILLING_DEPOSIT'] },
    description: 'Pemantauan Angka Kontak, RRNS, RPPT Prolanis, serta klaim non-kapitasi FKTP.',
  },
  {
    code: 'SUB_CLAIM_FKRTL_CASEMIX',
    capabilityGroup: 'FINANCE_ACCOUNTING',
    name: 'Klaim Casemix INA-CBG & Uji Coba iDRG',
    mappedModule: 'KLAIM_BPJS_PIUTANG',
    implementationStatus: 'IMPLEMENTED',
    defaultReadiness: 'CONFIGURABLE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: { allOf: ['SUB_CASHIER_BILLING_DEPOSIT'] },
    description: 'Grouping klaim FKRTL dengan pemisahan skema INA-CBG dan iDRG beserta analisis selisih tarif.',
  },
  {
    code: 'SUB_ACCOUNTING_DOUBLE_ENTRY',
    capabilityGroup: 'FINANCE_ACCOUNTING',
    name: 'Akuntansi Double-Entry, Neraca & Laba Rugi',
    mappedModule: 'KEUANGAN_OWNER',
    implementationStatus: 'IMPLEMENTED',
    defaultReadiness: 'ACTIVE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: {},
    description: 'Mesin jurnal berimbang Debit = Kredit, Buku Besar COA, Neraca, Laba Rugi, dan Cost Center.',
  },
  {
    code: 'SUB_MEDICAL_FEE_PAYROLL',
    capabilityGroup: 'FINANCE_ACCOUNTING',
    name: 'Subledger Jasa Medis, SDM & Penggajian',
    mappedModule: 'JASA_MEDIS_REMUN',
    implementationStatus: 'PARTIAL',
    defaultReadiness: 'ACTIVE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: { allOf: ['SUB_ACCOUNTING_DOUBLE_ENTRY'] },
    description: 'Perhitungan akrual jasa medis dokter/nakes, potongan PPh 21, jadwal shift, cuti, dan slip gaji.',
  },
  {
    code: 'SUB_REGULATORY_REPORTS',
    capabilityGroup: 'GOVERNANCE_INTEROP',
    name: 'Pelaporan Regulasi LB1–LB4 & SIRS RL 1–5',
    mappedModule: 'LAPORAN_REGULASI',
    implementationStatus: 'IMPLEMENTED',
    defaultReadiness: 'ACTIVE',
    integrationStatus: 'NOT_REQUIRED',
    dependencies: { allOf: ['SUB_OUTPATIENT_SOAP_CPPT'] },
    description: 'Kompilasi laporan wajib Kemenkes sesuai klasifikasi fasilitas dengan ketertelusuran transaksi.',
  },
  {
    code: 'SUB_REFERRAL_ORCHESTRATION',
    capabilityGroup: 'GOVERNANCE_INTEROP',
    name: 'Orkestrasi Rujukan, SRB & Integrasi SATUSEHAT',
    mappedModule: 'BRIDGING_SATUSEHAT',
    implementationStatus: 'IMPLEMENTED',
    defaultReadiness: 'ACTIVE',
    integrationStatus: 'NOT_CONFIGURED',
    dependencies: { allOf: ['SUB_PATIENT_MPI'] },
    description: 'State machine rujukan 7 tahap, validasi TACC, rujuk balik SRB, dan pengiriman bundel FHIR R4.',
  },
];


// ============================================================================
// 2. CAPABILITY DEPENDENCY & SERVICE ACTIVATION VALIDATOR (P0-03, P0-04, P1-12)
// ============================================================================

export interface CapabilityEvaluationResult {
  subCapability: SubCapabilityKey;
  operationalReadiness: OperationalReadiness;
  canActivate: boolean;
  missingReasons: string[];
  missingAllOf: SubCapabilityKey[];
  missingAnyOf: SubCapabilityKey[];
  missingEvidenceTypes: string[];
  blockingReasons: string[];
}


export function evaluateSubCapabilityReadiness(
  subCapCode: SubCapabilityKey,
  enabledInput: Set<SubCapabilityKey> | SubCapabilityKey[],
  evidenceList: EvidenceRegistryItem[],
  referenceDateStr = new Date().toISOString().slice(0, 10)
): CapabilityEvaluationResult {
  const enabledSet = enabledInput instanceof Set ? enabledInput : new Set(enabledInput);
  const def = SUB_CAPABILITY_CATALOG.find((c) => c.code === subCapCode);
  if (!def) {
    return {
      subCapability: subCapCode,
      operationalReadiness: 'BLOCKED',
      canActivate: false,
      missingReasons: [`Definisi kapabilitas ${subCapCode} tidak ditemukan.`],
      missingAllOf: [],
      missingAnyOf: [],
      missingEvidenceTypes: [],
      blockingReasons: [`Definisi kapabilitas ${subCapCode} tidak ditemukan.`],
    };
  }

  const missingAllOf: SubCapabilityKey[] = [];
  const missingAnyOf: SubCapabilityKey[] = [];
  const missingEvidenceTypes: string[] = [];
  const blockingReasons: string[] = [];

  if (def.dependencies.allOf) {
    for (const reqCap of def.dependencies.allOf) {
      if (!enabledSet.has(reqCap)) {
        missingAllOf.push(reqCap);
        blockingReasons.push(`Membutuhkan sub-kapabilitas wajib: ${reqCap}`);
      }
    }
  }

  if (def.dependencies.anyOf && def.dependencies.anyOf.length > 0) {
    const hasAtLeastOne = def.dependencies.anyOf.some((c) => enabledSet.has(c));
    if (!hasAtLeastOne) {
      missingAnyOf.push(...def.dependencies.anyOf);
      blockingReasons.push(
        `Membutuhkan minimal salah satu dari: ${def.dependencies.anyOf.join(' ATAU ')}`
      );
    }
  }

  if (def.dependencies.requiredEvidenceTypes) {
    for (const reqEv of def.dependencies.requiredEvidenceTypes) {
      const validEv = evidenceList.find(
        (ev) =>
          ev.verificationStatus === 'VERIFIED_ACTIVE' &&
          ev.validUntil >= referenceDateStr &&
          (ev.evidenceType === reqEv ||
            (reqEv === 'SIP_NAKES' &&
              (ev.evidenceType === 'SIP_STR_NAKES' || ev.evidenceType === 'SIPA_APOTEKER')) ||
            (reqEv === 'KALIBRASI_ALKES' &&
              (ev.evidenceType === 'MOU_PIHAK_KETIGA' ||
                ev.evidenceType === 'IZIN_BAPETEN_RADIOLOGI'))) &&
          (!ev.relatedSubCapabilities || ev.relatedSubCapabilities.includes(subCapCode))
      );
      if (!validEv) {
        missingEvidenceTypes.push(reqEv);
        blockingReasons.push(`Bukti terverifikasi belum lengkap atau kedaluwarsa: ${reqEv}`);
      }
    }
  }

  const isEnabled = enabledSet.has(subCapCode);
  let operationalReadiness: OperationalReadiness = 'CONFIGURABLE';
  if (blockingReasons.length > 0) {
    operationalReadiness = 'BLOCKED';
  } else if (isEnabled) {
    operationalReadiness = 'ACTIVE';
  } else {
    operationalReadiness = 'READY';
  }

  return {
    subCapability: subCapCode,
    operationalReadiness,
    canActivate: blockingReasons.length === 0,
    missingReasons: blockingReasons,
    missingAllOf,
    missingAnyOf,
    missingEvidenceTypes,
    blockingReasons,
  };
}


// ============================================================================
// 3. ADAPTIVE NAVIGATION RESOLVER (NO PARENTHETICAL CLUTTER, CLEAR HIERARCHY)
// ============================================================================

export type NavGroupCategoryKey =
  | 'PENDAFTARAN_ADMISI'
  | 'PELAYANAN_MEDIS'
  | 'FARMASI_LOGISTIK'
  | 'PENUNJANG_INSTALASI'
  | 'KEUANGAN_AKUNTANSI'
  | 'SDM_KEPEGAWAIAN'
  | 'PELAPORAN_OTORITAS'
  | 'INTEGRASI_LAYANAN'
  | 'ADMINISTRASI';


export type NavGroupKey = NavGroupCategoryKey;


export interface ResolvedNavigationItem {
  key: ModuleKey;
  moduleKey: ModuleKey;
  label: string;
  subtitle: string;
  category: 'TOP' | NavGroupCategoryKey;
  group: 'TOP' | NavGroupCategoryKey;
  shortKey: string;
  requiredSubCapabilities: SubCapabilityKey[];
}


export const NAV_GROUP_TITLES: Record<NavGroupCategoryKey, string> = {
  PENDAFTARAN_ADMISI: 'PENDAFTARAN & ADMISI',
  PELAYANAN_MEDIS: 'PELAYANAN MEDIS & RME',
  FARMASI_LOGISTIK: 'FARMASI & RANTAI PASOK',
  PENUNJANG_INSTALASI: 'PENUNJANG & INSTALASI',
  KEUANGAN_AKUNTANSI: 'KEUANGAN & KLAIM',
  SDM_KEPEGAWAIAN: 'SDM & KEPEGAWAIAN',
  PELAPORAN_OTORITAS: 'PELAPORAN',
  INTEGRASI_LAYANAN: 'INTEGRASI LAYANAN',
  ADMINISTRASI: 'ADMINISTRASI',
};


export function resolveFacilityNavigation(
  config: SuperuserFacilityConfigSnapshot,
  user: Pick<UserAccount, 'role' | 'customPrivileges' | 'active' | 'facilityRoles' | 'resolvedModules'>,
  facilityCode: string
): ResolvedNavigationItem[] {
  if (!user.active) return [];
  const effectiveRole = user.role === 'SUPERUSER' ? user.role : user.facilityRoles?.[facilityCode] || user.role;
  const enabledCaps = new Set<SubCapabilityKey>(config.enabledSubCapabilities);
  const unitLabel = config.terminologyOverrides?.outpatientUnitLabel || 'Poliklinik';

  const rawItems: Omit<ResolvedNavigationItem, 'moduleKey' | 'group'>[] = [
    {
      key: 'DASHBOARD',
      label: 'Ringkasan operasional',
      subtitle: 'Antrean, kapasitas saat ini, dan penerimaan tercatat',
      category: 'TOP',
      shortKey: 'Alt+1',
      requiredSubCapabilities: [],
    },
    // 01. PENDAFTARAN & ADMISI
    {
      key: 'SEMUA_PASIEN',
      label: 'Direktori Pasien',
      subtitle: 'Master nomor RM lokal & riwayat kunjungan',
      category: 'PENDAFTARAN_ADMISI',
      shortKey: 'Alt+2',
      requiredSubCapabilities: ['SUB_PATIENT_MPI'],
    },
    {
      key: 'PENDAFTARAN',
      label: 'Loket Pendaftaran',
      subtitle: `Registrasi pasien & antrean ${unitLabel.toLowerCase()}`,
      category: 'PENDAFTARAN_ADMISI',
      shortKey: 'Alt+3',
      requiredSubCapabilities: ['SUB_ADMISSION_OUTPATIENT'],
    },
    {
      key: 'JADWAL_DOKTER',
      label: 'Direktori tenaga pemeriksa',
      subtitle: 'Profil pemeriksa; jadwal dan kuota belum tersedia',
      category: 'PENDAFTARAN_ADMISI',
      shortKey: 'Alt+J',
      requiredSubCapabilities: ['SUB_DOCTOR_SCHEDULE_BOOKING'],
    },
    {
      key: 'RAWAT_INAP',
      label: 'Bangsal & Tempat Tidur',
      subtitle: 'Peta kamar, admisi rawat inap & okupansi',
      category: 'PENDAFTARAN_ADMISI',
      shortKey: 'Alt+5',
      requiredSubCapabilities: ['SUB_INPATIENT_BED_MGMT'],
    },
    // 02. PELAYANAN MEDIS & RME
    {
      key: 'RME_DOKTER',
      label: 'Rekam medis rawat jalan',
      subtitle: 'Catatan pemeriksaan SOAP dan peresepan',
      category: 'PELAYANAN_MEDIS',
      shortKey: 'Alt+4',
      requiredSubCapabilities: ['SUB_OUTPATIENT_SOAP_CPPT'],
    },
    {
      key: 'IGD_TRIASE_EWS',
      label: 'Catatan IGD dan triase',
      subtitle: 'Observasi dan catatan kegawatdaruratan',
      category: 'PELAYANAN_MEDIS',
      shortKey: 'Alt+I',
      requiredSubCapabilities: ['SUB_IGD_TRIAGE_ATS'],
    },
    {
      key: 'GIGI_ODONTOGRAM',
      label: 'Kedokteran Gigi & Odontogram',
      subtitle: 'Peta 32 gigi FDI & tindakan dental',
      category: 'PELAYANAN_MEDIS',
      shortKey: 'Alt+G',
      requiredSubCapabilities: ['SUB_DENTAL_ODONTOGRAM'],
    },
    {
      key: 'KIA_IMUNISASI',
      label: 'Catatan KIA',
      subtitle: 'Catatan pemeriksaan kesehatan ibu dan anak',
      category: 'PELAYANAN_MEDIS',
      shortKey: 'Alt+K',
      requiredSubCapabilities: ['SUB_ANC_BASIC'],
    },
    {
      key: 'PROLANIS_PRB',
      label: 'Catatan penyakit kronis',
      subtitle: 'Riwayat pemeriksaan dan pengobatan penyakit kronis',
      category: 'PELAYANAN_MEDIS',
      shortKey: 'Alt+P',
      requiredSubCapabilities: ['SUB_CHRONIC_DISEASE_REGISTRY'],
    },
    {
      key: 'BEDAH_IBS',
      label: 'Catatan bedah',
      subtitle: 'Pencatatan klinis dan jadwal tindakan yang tersedia',
      category: 'PELAYANAN_MEDIS',
      shortKey: 'Alt+O',
      requiredSubCapabilities: ['SUB_SURGERY_IBS'],
    },
    {
      key: 'MCU_SURAT_MEDIS',
      label: 'Dokumen medis',
      subtitle: 'Dokumen berdasarkan catatan pemeriksaan',
      category: 'PELAYANAN_MEDIS',
      shortKey: 'Alt+M',
      requiredSubCapabilities: ['SUB_MCU_MEDICAL_CERTIFICATES'],
    },
    // 03. FARMASI & RANTAI PASOK
    {
      key: 'APOTEK',
      label: 'Pelayanan Resep',
      subtitle: 'Telaah farmasi klinis & penyerahan obat FEFO',
      category: 'FARMASI_LOGISTIK',
      shortKey: 'Alt+6',
      requiredSubCapabilities: ['SUB_PHARMACY_DISPENSING_FEFO'],
    },
    {
      key: 'KATALOG_OPNAME',
      label: 'Persediaan obat',
      subtitle: 'Katalog, perhitungan stok fisik, dan kartu mutasi',
      category: 'FARMASI_LOGISTIK',
      shortKey: 'Alt+O',
      requiredSubCapabilities: ['SUB_PHARMACY_INVENTORY_OPNAME'],
    },
    {
      key: 'MUTASI_STOK',
      label: 'Kartu mutasi obat',
      subtitle: 'Riwayat keluar dan masuk persediaan',
      category: 'FARMASI_LOGISTIK',
      shortKey: 'Alt+U',
      requiredSubCapabilities: ['SUB_PHARMACY_INVENTORY_OPNAME'],
    },
    {
      key: 'PENGADAAN_PBF',
      label: 'Pengadaan PO & Faktur PBF',
      subtitle: 'Pesanan pembelian PBF, penerimaan batch & retur',
      category: 'FARMASI_LOGISTIK',
      shortKey: 'Alt+F',
      requiredSubCapabilities: ['SUB_PROCUREMENT_PO_PBF'],
    },
    // 04. PENUNJANG & INSTALASI
    {
      key: 'LABORATORIUM',
      label: 'Laboratorium Patologi',
      subtitle: 'Spesimen, kimia klinik, hematologi & nilai kritis',
      category: 'PENUNJANG_INSTALASI',
      shortKey: 'Alt+7',
      requiredSubCapabilities: ['SUB_LAB_PATHOLOGY'],
    },
    {
      key: 'RADIOLOGI_RIS',
      label: 'Radiologi & Pencitraan',
      subtitle: 'Pemeriksaan Rontgen, USG, CT-Scan & ekspertise',
      category: 'PENUNJANG_INSTALASI',
      shortKey: 'Alt+R',
      requiredSubCapabilities: ['SUB_RADIOLOGY_IMAGING'],
    },
    {
      key: 'PENUNJANG_RS',
      label: 'Layanan instalasi',
      subtitle: 'Status ketersediaan alur gizi, darah, sterilisasi dan sarana',
      category: 'PENUNJANG_INSTALASI',
      shortKey: 'Alt+N',
      requiredSubCapabilities: ['SUB_IPSRS_AMBULANCE'],
    },
    // 05. KEUANGAN & KLAIM
    {
      key: 'KEUANGAN_OWNER',
      label: 'Transaksi keuangan',
      subtitle: 'Pemasukan, pengeluaran, dan catatan transaksi',
      category: 'KEUANGAN_AKUNTANSI',
      shortKey: 'Alt+8',
      requiredSubCapabilities: ['SUB_ACCOUNTING_DOUBLE_ENTRY'],
    },
    {
      key: 'NERACA_GL',
      label: 'Catatan transaksi',
      subtitle: 'Jurnal tercatat; neraca memerlukan saldo dan subledger lengkap',
      category: 'KEUANGAN_AKUNTANSI',
      shortKey: 'Alt+N',
      requiredSubCapabilities: ['SUB_ACCOUNTING_DOUBLE_ENTRY'],
    },
    {
      key: 'KASIR_AKUNTANSI',
      label: 'Kasir & Penagihan Pasien',
      subtitle: 'Pembayaran tagihan, deposit rawat inap & kuitansi',
      category: 'KEUANGAN_AKUNTANSI',
      shortKey: 'Alt+9',
      requiredSubCapabilities: ['SUB_CASHIER_BILLING_DEPOSIT'],
    },
    {
      key: 'KLAIM_BPJS_PIUTANG',
      label: 'Klaim Penjamin & Umur Piutang',
      subtitle: 'Tagihan penjamin dan umur piutang tercatat',
      category: 'KEUANGAN_AKUNTANSI',
      shortKey: 'Alt+C',
      requiredSubCapabilities: ['SUB_CASHIER_BILLING_DEPOSIT'],
    },
    {
      key: 'JASA_MEDIS_REMUN',
      label: 'Rekap tagihan pemeriksa',
      subtitle: 'Komponen tagihan menurut tenaga pemeriksa',
      category: 'KEUANGAN_AKUNTANSI',
      shortKey: 'Alt+D',
      requiredSubCapabilities: ['SUB_MEDICAL_FEE_PAYROLL'],
    },
    // 06. SDM & KEPEGAWAIAN
    {
      key: 'SDM_JADWAL',
      label: 'Kepegawaian',
      subtitle: 'Status ketersediaan pencatatan kepegawaian',
      category: 'SDM_KEPEGAWAIAN',
      shortKey: 'Alt+H',
      requiredSubCapabilities: ['SUB_MEDICAL_FEE_PAYROLL'],
    },
    {
      key: 'SDM_ERP',
      label: 'Kepegawaian',
      subtitle: 'Status ketersediaan presensi, cuti, dan penggajian',
      category: 'SDM_KEPEGAWAIAN',
      shortKey: 'Alt+S',
      requiredSubCapabilities: ['SUB_MEDICAL_FEE_PAYROLL'],
    },
    // 07. PELAPORAN & OTORITAS
    {
      key: 'LAPORAN_REGULASI',
      label: 'Pelaporan dan indikator layanan',
      subtitle: 'Data pelaporan, definisi indikator, dan sumber acuan',
      category: 'PELAPORAN_OTORITAS',
      shortKey: 'Alt+L',
      requiredSubCapabilities: ['SUB_REGULATORY_REPORTS'],
    },
    {
      key: 'BRIDGING_SATUSEHAT',
      label: 'Antrean integrasi',
      subtitle: 'Permintaan lokal dan status koneksi provider',
      category: 'INTEGRASI_LAYANAN',
      shortKey: 'Alt+B',
      requiredSubCapabilities: ['SUB_REFERRAL_ORCHESTRATION'],
    },
    {
      key: 'SUPERUSER_CONTROL',
      label: 'Pengelolaan platform',
      subtitle: 'Akun, peran, fasilitas, konfigurasi dan riwayat perubahan',
      category: 'ADMINISTRASI',
      shortKey: 'Alt+0',
      requiredSubCapabilities: [],
    },
  ];

  const allItems: ResolvedNavigationItem[] = rawItems.map((it) => ({
    ...it,
    moduleKey: it.key,
    group: it.category,
  }));

  const visibleItems = allItems.filter((item) => {
    if (item.key === 'SUPERUSER_CONTROL') {
      return user.role === 'SUPERUSER';
    }
    // Check if required sub-capabilities are enabled on this facility
    const capAllowed =
      item.requiredSubCapabilities.length === 0 ||
      item.requiredSubCapabilities.some((req) => enabledCaps.has(req));
    if (!capAllowed) return false;

    return canUserAccessModule({ ...user, role: effectiveRole }, item.key);
  });

  const keys = new Set(visibleItems.map((item) => item.key));
  return visibleItems.filter((item) => {
    if (item.key === 'MUTASI_STOK' && keys.has('KATALOG_OPNAME')) return false;
    if (['NERACA_GL', 'JASA_MEDIS_REMUN'].includes(item.key) && keys.has('KEUANGAN_OWNER')) return false;
    if (item.key === 'SDM_ERP' && keys.has('SDM_JADWAL')) return false;
    return true;
  });
}


// ============================================================================
// 4. DEFAULT FACILITY CONFIGURATION SNAPSHOTS (4-TIER INHERITANCE BASELINE)
// ============================================================================

export function buildDefaultFacilityConfigSnapshot(
  facility: Facility,
  publishedBy = 'SYSTEM'
): SuperuserFacilityConfigSnapshot {
  const createdAt = facility.createdAt || new Date().toISOString();
  const isHospital = facility.type === 'RSUD' || facility.type === 'RS_SWASTA';
  const isKlinikUtama = facility.type === 'KLINIK_UTAMA';

  const clinicPratamaCaps: SubCapabilityKey[] = [
    'SUB_PATIENT_MPI',
    'SUB_ADMISSION_OUTPATIENT',
    'SUB_DOCTOR_SCHEDULE_BOOKING',
    'SUB_OUTPATIENT_SOAP_CPPT',
    'SUB_DENTAL_ODONTOGRAM',
    'SUB_ANC_BASIC',
    'SUB_IMMUNIZATION_VACCINE',
    'SUB_CHRONIC_DISEASE_REGISTRY',
    'SUB_PROLANIS_CLUB',
    'SUB_PRB_MEDICATION_CONTINUITY',
    'SUB_MCU_MEDICAL_CERTIFICATES',
    'SUB_PHARMACY_DISPENSING_FEFO',
    'SUB_PHARMACY_INVENTORY_OPNAME',
    'SUB_PROCUREMENT_PO_PBF',
    'SUB_LAB_PATHOLOGY',
    'SUB_CASHIER_BILLING_DEPOSIT',
    'SUB_CLAIM_FKTP_KBK',
    'SUB_ACCOUNTING_DOUBLE_ENTRY',
    'SUB_MEDICAL_FEE_PAYROLL',
    'SUB_REGULATORY_REPORTS',
    'SUB_REFERRAL_ORCHESTRATION',
  ];

  const klinikUtamaAdditionalCaps: SubCapabilityKey[] = [
    'SUB_INPATIENT_BED_MGMT',
    'SUB_IGD_TRIAGE_ATS',
    'SUB_CLINICAL_EWS_SCORING',
    'SUB_DELIVERY_PARTOGRAPH',
    'SUB_RADIOLOGY_IMAGING',
    'SUB_CLAIM_FKRTL_CASEMIX',
  ];

  const hospitalFullCaps: SubCapabilityKey[] = [
    ...clinicPratamaCaps.filter(
      (c) => c !== 'SUB_CLAIM_FKTP_KBK' && c !== 'SUB_PROLANIS_CLUB'
    ),
    ...klinikUtamaAdditionalCaps,
    'SUB_ADMISSION_EMERGENCY',
    'SUB_HIGH_RISK_OBSTETRICS',
    'SUB_SURGERY_IBS',
    'SUB_HEMODIALYSIS_UNIT',
    'SUB_NUTRITION_DIETARY',
    'SUB_BLOOD_BANK_BDRS',
    'SUB_CSSD_STERILIZATION',
    'SUB_IPSRS_AMBULANCE',
  ];

  const enabledSubCapabilities = isHospital
    ? hospitalFullCaps
    : isKlinikUtama
    ? Array.from(new Set([...clinicPratamaCaps, ...klinikUtamaAdditionalCaps]))
    : clinicPratamaCaps;

  return {
    configId: `cfg-${facility.code}-v1`,
    tenantId: facility.tenantId || facility.code,
    facilityCode: facility.code,
    configVersion: facility.activeConfigVersion || 1,
    lifecycleStage: 'ACTIVE',
    effectiveDate: createdAt.slice(0, 10),
    publishedBy,
    publishedAt: createdAt,
    changeNotes: 'Baseline konfigurasi kapabilitas awal fasilitas',
    enabledSubCapabilities,
    activeServices: isHospital
      ? ['RAWAT_JALAN_SPESIALIS', 'IGD_24_JAM', 'RAWAT_INAP', 'BEDAH_IBS', 'HEMODIALISIS', 'LAB_PATOLOGI', 'RADIOLOGI']
      : isKlinikUtama
      ? ['PRAKTIK_UMUM', 'POLIKLINIK_SPESIALIS', 'RAWAT_INAP_7_HARI', 'GIGI', 'KIA', 'LAB_DIAGNOSTIK']
      : ['PRAKTIK_UMUM', 'PRAKTIK_GIGI', 'KIA_KB_IMUNISASI', 'PROLANIS_PRB', 'FARMASI_FKTP'],
    units: isHospital
      ? [
          { unitCode: 'POLI_PD', unitName: 'Poliklinik Penyakit Dalam', unitType: 'POLIKLINIK_SPESIALIS', costCenterCode: 'CC-RJ-PD', active: true },
          { unitCode: 'POLI_ANAK', unitName: 'Poliklinik Kesehatan Anak', unitType: 'POLIKLINIK_SPESIALIS', costCenterCode: 'CC-RJ-ANK', active: true },
          { unitCode: 'POLI_BEDAH', unitName: 'Poliklinik Bedah Umum', unitType: 'POLIKLINIK_SPESIALIS', costCenterCode: 'CC-RJ-BDH', active: true },
          { unitCode: 'IGD_24', unitName: 'Instalasi Gawat Darurat 24 Jam', unitType: 'IGD', costCenterCode: 'CC-IGD', active: true },
          { unitCode: 'RANAP_UTAMA', unitName: 'Bangsal Rawat Inap Terpadu', unitType: 'BANGSAL_RANAP', costCenterCode: 'CC-RANAP', active: true },
          { unitCode: 'IBS_OK', unitName: 'Instalasi Bedah Sentral', unitType: 'KAMAR_OPERASI', costCenterCode: 'CC-IBS', active: true },
          { unitCode: 'DEPO_UTAMA', unitName: 'Instalasi Farmasi Sentral', unitType: 'DEPO_FARMASI', costCenterCode: 'CC-FAR', active: true },
        ]
      : [
          { unitCode: 'PRAKTIK_UMUM', unitName: 'Ruang Praktik Dokter Umum', unitType: 'RUANG_PRAKTIK', costCenterCode: 'CC-KL-UMUM', active: true },
          { unitCode: 'PRAKTIK_GIGI', unitName: 'Ruang Praktik Dokter Gigi', unitType: 'RUANG_PRAKTIK', costCenterCode: 'CC-KL-GIGI', active: true },
          { unitCode: 'RUANG_KIA', unitName: 'Ruang KIA, KB & Imunisasi', unitType: 'RUANG_PRAKTIK', costCenterCode: 'CC-KL-KIA', active: true },
          { unitCode: 'APOTEK_KLINIK', unitName: 'Apotek Klinik', unitType: 'DEPO_FARMASI', costCenterCode: 'CC-KL-FAR', active: true },
        ],
    terminologyOverrides: {
      outpatientUnitLabel: isHospital ? 'Poliklinik' : 'Ruang Praktik',
      triageProtocol: 'ATS_1_5',
    },
    formSchemas: [
      {
        formCode: 'FRM_SOAP_STANDARD',
        formName: 'Formulir Rekam Medis SOAP & CPPT',
        schemaVersion: 1,
        targetModule: 'RME_DOKTER',
        effectiveDate: createdAt.slice(0, 10),
        fields: [
          { fieldKey: 'chiefComplaint', label: 'Keluhan Utama', fieldType: 'TEXT', required: true, isCoreLocked: true },
          { fieldKey: 'vitals', label: 'Tanda Vital Lengkap', fieldType: 'TEXT', required: true, isCoreLocked: true },
          { fieldKey: 'primaryIcd10Code', label: 'Diagnosis Primer ICD-10', fieldType: 'TEXT', required: true, isCoreLocked: true },
          { fieldKey: 'nutritionalStatus', label: 'Skrining Nutrisi MST', fieldType: 'SELECT', required: false, isCoreLocked: false, options: ['Risiko Rendah', 'Risiko Sedang', 'Risiko Tinggi'] },
          { fieldKey: 'fallRiskAssessment', label: 'Risiko Jatuh Morse/Humpty Dumpty', fieldType: 'SELECT', required: false, isCoreLocked: false, options: ['Tidak Berisiko', 'Risiko Rendah', 'Risiko Tinggi'] },
        ],
      },
    ],
    workflowPolicies: {
      requirePaymentBeforeDispenseOutpatientUmum: false,
      allowEmergencyOrderBeforeFullRegistration: true,
      rmeCorrectionWindowHours: 48, // Permenkes 24/2022 Pasal 30 (2x24 jam)
    },
    tariffMultiplier: 1,
    billingPolicy: {
      minInpatientDepositRp: null,
      maxCashierDiscountPct: null,
      allowSplitPayment: true,
    },
    pharmacyPolicy: {
      allocationMethod: 'FEFO',
      vatRatePct: null,
      vatTreatment: 'CAPITALIZE_TO_INVENTORY',
    },
    documentTemplateHeader: {
      institutionHeaderLine1: facility.name.toUpperCase(),
      institutionHeaderLine2: `${facility.address}, ${facility.city} • Telp: ${facility.phone}`,
      citySignatureLabel: facility.city,
      enableQrValidation: true,
    },
    dashboardTargets: {},
    externalConnectors: {
      satusehatMode: 'DISABLED',
      bpjsMode: 'DISABLED',
      timeoutMs: 8000,
      maxRetryAttempts: 3,
    },
    accountingPolicy: {
      fiscalPeriodStatus: 'OPEN',
      defaultDoctorFeeSharePct: null,
      doctorTaxPph21Pct: null,
    },
    crossFacilitySharingPolicy: {
      allowSameTenantReferralLookup: true,
      requireExplicitConsentOrReferralToken: true,
    },
  };
}


// ============================================================================
// 5. ATS 1-5 TRIAGE & POPULATION-SPECIFIC CLINICAL SCORING (P0-07 / Review #7)
// ============================================================================

function recordedNonnegative(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function recordedRatio(numerator: number | null, denominator: number | null, multiplier = 100): number | null {
  return numerator !== null && denominator !== null && denominator > 0
    ? Math.round((numerator / denominator) * multiplier * 10) / 10
    : null;
}

export interface ErpCompleteFinancialAnalysis {
  availability: {
    balanceSheet: boolean;
    claimPackageComparison: boolean;
    inventoryTurnover: boolean;
    recordedTaxes: boolean;
    recordedDoctorTaxes: boolean;
    completeProfit: boolean;
  };
  totalRevenue: number;
  grossRevenue: number;
  netRevenue: number;
  hppPharmacyCogs: number | null;
  cogsPharmacy: number | null;
  hppMedicalFeeDirect: number;
  directDoctorFeeExpense: number;
  totalHpp: number | null;
  grossProfit: number | null;
  grossMarginPct: number | null;
  grossMarginPercent: number | null;
  operatingExpenses: number;
  ebitda: number | null;
  estimatedTaxExpense: number | null;
  estimatedCorporateTax: number | null;
  estimatedDoctorTaxPph21: number | null;
  netOperatingProfit: number | null;
  netProfit: number | null;
  netMarginPct: number | null;
  netMarginPercent: number | null;
  balanceSheet: {
    cashAndBank: number | null;
    accountsReceivablePatientsAndJkn: number;
    accountsReceivable: number;
    inventoryMedicationAssetHna: number;
    inventoryAssetHna: number;
    medicalEquipmentFixedAssets: number | null;
    totalAssets: number | null;
    accountsPayablePbf: number;
    medicalFeePayable: number | null;
    doctorFeePayable: number | null;
    patientDepositsLiability: number | null;
    taxPayable: number | null;
    totalLiabilities: number | null;
    paidInCapitalEquity: number | null;
    retainedEarningsAndCurrentProfit: number | null;
    retainedEarningsAndEquity: number | null;
    totalEquity: number | null;
    isBalanced: boolean | null;
  };
  receivableAging: {
    bucket0to30: number;
    bucket31to60: number;
    bucket61to90: number;
    bucketOver90: number;
    estimatedDsoDays: number | null;
  };
  payablePbfAging: {
    bucket0to30: number;
    bucket31to60: number;
    bucketOver60: number;
    totalPayablePbf: number;
  };
  payableAgingPbf: {
    bucket0to30: number;
    bucket31to60: number;
    bucket61to90: number;
    bucketOver90: number;
    bucketOver60: number;
    totalPayablePbf: number;
    total: number;
  };
  claimAnalytics: {
    totalClaimsCount: number;
    approvedClaimsCount: number;
    pendingDisputeClaimsCount: number;
    rejectedClaimsCount: number;
    approvalRatePct: number | null;
    approvedRatePercent: number | null;
    pendingRatePercent: number | null;
    rejectedRatePercent: number | null;
    totalRealHospitalTariffRp: number;
    totalRealCostRp: number | null;
    totalInacbgOrIdrgTariffRp: number | null;
    totalPackageTariffRp: number | null;
    totalTariffVarianceRp: number | null;
    costRecoveryRatioPct: number | null;
  };
  pharmacyAnalytics: {
    totalAssetHnaRp: number;
    totalPotentialSalesHjaRp: number;
    potentialMarginPct: number | null;
    potentialMarginPercent: number | null;
    inventoryTurnoverRatioItr: number | null;
    inventoryTurnoverRatio: number | null;
    daysSalesOfInventoryDsi: number | null;
    daysSalesOfInventory: number | null;
    nearExpiryBatchesCount: number;
    nearExpiryBatchCount: number;
    nearExpiryAtRiskValueRp: number;
    deadStockItemsCount: number | null;
    deadStockItemCount: number | null;
    deadStockValueRp: number | null;
  };
}

export function computeErpCompleteFinancialAnalysis(params: {
  accountingEntries: AccountingEntry[];
  invoices: InvoiceRecord[];
  medications: MedicationInventory[];
  medicationMutations?: MedicationStockMutation[];
  mutations?: MedicationStockMutation[];
  purchaseOrders?: PurchaseOrderPbf[];
  visits?: VisitQueueItem[];
  doctorSharePercent?: number;
  nearExpiryThresholdDays?: number;
  referenceDateStr?: string;
}): ErpCompleteFinancialAnalysis {
  const referenceDate = params.referenceDateStr || new Date().toISOString().slice(0, 10);
  const referenceMs = Date.parse(`${referenceDate}T00:00:00.000Z`);
  const recordedEntries = params.accountingEntries.filter((entry) => Number.isFinite(entry.amount));
  const totalRevenue = recordedEntries.filter((entry) => entry.type === 'PENDAPATAN').reduce((sum, entry) => sum + entry.amount, 0);
  const recordedMedicalFees = recordedEntries.filter((entry) => entry.type === 'PENGELUARAN' && entry.category === 'JASA_MEDIS').reduce((sum, entry) => sum + entry.amount, 0);
  const operatingExpenses = recordedEntries.filter((entry) => entry.type === 'PENGELUARAN' && !['PENGADAAN_OBAT', 'JASA_MEDIS'].includes(entry.category)).reduce((sum, entry) => sum + entry.amount, 0);
  let totalAssetHnaRp = 0;
  let totalPotentialSalesHjaRp = 0;
  let nearExpiryBatchesCount = 0;
  let nearExpiryAtRiskValueRp = 0;
  const nearExpiryThreshold = recordedNonnegative(params.nearExpiryThresholdDays);
  for (const medication of params.medications) {
    for (const batch of medication.batches) {
      if (!Number.isFinite(batch.stock) || batch.stock <= 0) continue;
      const buyPrice = recordedNonnegative(medication.buyPrice);
      const sellPrice = recordedNonnegative(medication.sellPrice);
      if (buyPrice !== null) totalAssetHnaRp += batch.stock * buyPrice;
      if (sellPrice !== null) totalPotentialSalesHjaRp += batch.stock * sellPrice;
      const expiry = Date.parse(`${batch.expiryDate}T00:00:00.000Z`);
      if (nearExpiryThreshold !== null && Number.isFinite(expiry) && Number.isFinite(referenceMs) && (expiry - referenceMs) / 86_400_000 <= nearExpiryThreshold) {
        nearExpiryBatchesCount++;
        if (buyPrice !== null) nearExpiryAtRiskValueRp += batch.stock * buyPrice;
      }
    }
  }
  const potentialMarginPct = recordedRatio(totalPotentialSalesHjaRp - totalAssetHnaRp, totalPotentialSalesHjaRp);
  const ageOf = (date: string): number | null => {
    const timestamp = Date.parse(date);
    return Number.isFinite(timestamp) && Number.isFinite(referenceMs) ? Math.max(0, Math.floor((referenceMs - timestamp) / 86_400_000)) : null;
  };
  const receivableBuckets = [0, 0, 0, 0];
  for (const invoice of params.invoices) {
    if (invoice.pricingStatus === 'PENDING') continue;
    if (!['BELUM_LUNAS', 'KLAIM_DIAJUKAN', 'KLAIM_PENDING_DISPUTE', 'KLAIM_DISETUJUI'].includes(invoice.status)) continue;
    const amount = recordedNonnegative(getInvoiceOutstanding(invoice));
    const age = ageOf(invoice.createdAt);
    if (amount !== null && age !== null) receivableBuckets[age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3] += amount;
  }
  const payableBuckets = [0, 0, 0, 0];
  for (const order of params.purchaseOrders || []) {
    if (!['RECEIVED_PARTIAL', 'RECEIVED_FULL'].includes(order.status)) continue;
    const amount = recordedNonnegative(order.grandTotalPayable ?? order.totalAmount);
    const age = ageOf(order.dueDate);
    if (amount !== null && age !== null) payableBuckets[age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3] += amount;
  }
  const totalReceivables = receivableBuckets.reduce((sum, value) => sum + value, 0);
  const totalPayablePbf = payableBuckets.reduce((sum, value) => sum + value, 0);
  const claims = params.invoices.filter((invoice) => invoice.guarantor === 'BPJS_KESEHATAN' && invoice.pricingStatus !== 'PENDING');
  const approvedClaimsCount = claims.filter((invoice) => invoice.status === 'KLAIM_DISETUJUI').length;
  const pendingDisputeClaimsCount = claims.filter((invoice) => invoice.status === 'KLAIM_PENDING_DISPUTE').length;
  const rejectedClaimsCount = claims.filter((invoice) => invoice.status === 'KLAIM_DITOLAK').length;
  const hasPackageValues = claims.length > 0 && claims.every((invoice) => recordedNonnegative(invoice.inacbgOrIdrgTariffAmount) !== null);
  const totalRealHospitalTariffRp = claims.reduce((sum, invoice) => sum + (recordedNonnegative(invoice.subtotal) ?? 0), 0);
  const totalPackageTariffRp = hasPackageValues ? claims.reduce((sum, invoice) => sum + invoice.inacbgOrIdrgTariffAmount!, 0) : null;
  return {
    availability: { balanceSheet: false, claimPackageComparison: hasPackageValues, inventoryTurnover: false, recordedTaxes: false, recordedDoctorTaxes: false, completeProfit: false },
    totalRevenue, grossRevenue: totalRevenue, netRevenue: totalRevenue,
    hppPharmacyCogs: null, cogsPharmacy: null, hppMedicalFeeDirect: recordedMedicalFees, directDoctorFeeExpense: recordedMedicalFees,
    totalHpp: null, grossProfit: null, grossMarginPct: null, grossMarginPercent: null, operatingExpenses,
    ebitda: null, estimatedTaxExpense: null, estimatedCorporateTax: null, estimatedDoctorTaxPph21: null,
    netOperatingProfit: null, netProfit: null, netMarginPct: null, netMarginPercent: null,
    balanceSheet: {
      cashAndBank: null, accountsReceivablePatientsAndJkn: totalReceivables, accountsReceivable: totalReceivables,
      inventoryMedicationAssetHna: totalAssetHnaRp, inventoryAssetHna: totalAssetHnaRp, medicalEquipmentFixedAssets: null, totalAssets: null,
      accountsPayablePbf: totalPayablePbf, medicalFeePayable: null, doctorFeePayable: null, patientDepositsLiability: null, taxPayable: null,
      totalLiabilities: null, paidInCapitalEquity: null, retainedEarningsAndCurrentProfit: null, retainedEarningsAndEquity: null,
      totalEquity: null, isBalanced: null,
    },
    receivableAging: { bucket0to30: receivableBuckets[0], bucket31to60: receivableBuckets[1], bucket61to90: receivableBuckets[2], bucketOver90: receivableBuckets[3], estimatedDsoDays: null },
    payablePbfAging: { bucket0to30: payableBuckets[0], bucket31to60: payableBuckets[1], bucketOver60: payableBuckets[2] + payableBuckets[3], totalPayablePbf },
    payableAgingPbf: { bucket0to30: payableBuckets[0], bucket31to60: payableBuckets[1], bucket61to90: payableBuckets[2], bucketOver90: payableBuckets[3], bucketOver60: payableBuckets[2] + payableBuckets[3], totalPayablePbf, total: totalPayablePbf },
    claimAnalytics: {
      totalClaimsCount: claims.length, approvedClaimsCount, pendingDisputeClaimsCount, rejectedClaimsCount,
      approvalRatePct: recordedRatio(approvedClaimsCount, claims.length), approvedRatePercent: recordedRatio(approvedClaimsCount, claims.length),
      pendingRatePercent: recordedRatio(pendingDisputeClaimsCount, claims.length), rejectedRatePercent: recordedRatio(rejectedClaimsCount, claims.length),
      totalRealHospitalTariffRp, totalRealCostRp: null, totalInacbgOrIdrgTariffRp: totalPackageTariffRp, totalPackageTariffRp,
      totalTariffVarianceRp: totalPackageTariffRp !== null ? totalPackageTariffRp - totalRealHospitalTariffRp : null, costRecoveryRatioPct: null,
    },
    pharmacyAnalytics: {
      totalAssetHnaRp, totalPotentialSalesHjaRp, potentialMarginPct, potentialMarginPercent: potentialMarginPct,
      inventoryTurnoverRatioItr: null, inventoryTurnoverRatio: null, daysSalesOfInventoryDsi: null, daysSalesOfInventory: null,
      nearExpiryBatchesCount, nearExpiryBatchCount: nearExpiryBatchesCount, nearExpiryAtRiskValueRp,
      deadStockItemsCount: null, deadStockItemCount: null, deadStockValueRp: null,
    },
  };
}
