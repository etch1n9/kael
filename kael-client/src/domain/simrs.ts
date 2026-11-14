// Public API data shapes used by the browser client. Keep compatible with the server API.
export type UserRole = string;

export interface RoleDefinition {
  id: string;
  name: string;
  modules: ModuleKey[];
  active: boolean;
  system?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export type ModuleKey =
  | 'DASHBOARD'
  | 'SEMUA_PASIEN'
  | 'PENDAFTARAN'
  | 'JADWAL_DOKTER'
  | 'RAWAT_INAP'
  | 'RME_DOKTER'
  | 'IGD_TRIASE_EWS'
  | 'GIGI_ODONTOGRAM'
  | 'KIA_IMUNISASI'
  | 'PROLANIS_PRB'
  | 'BEDAH_IBS'
  | 'MCU_SURAT_MEDIS'
  | 'APOTEK'
  | 'KATALOG_OPNAME'
  | 'MUTASI_STOK'
  | 'PENGADAAN_PBF'
  | 'LABORATORIUM'
  | 'RADIOLOGI_RIS'
  | 'PENUNJANG_RS'
  | 'KEUANGAN_OWNER'
  | 'NERACA_GL'
  | 'KASIR_AKUNTANSI'
  | 'KLAIM_BPJS_PIUTANG'
  | 'JASA_MEDIS_REMUN'
  | 'SDM_JADWAL'
  | 'SDM_ERP'
  | 'LAPORAN_REGULASI'
  | 'BRIDGING_SATUSEHAT'
  | 'SUPERUSER_CONTROL';

export type SubCapabilityKey =
  | 'SUB_PATIENT_MPI'
  | 'SUB_ADMISSION_OUTPATIENT'
  | 'SUB_ADMISSION_EMERGENCY'
  | 'SUB_DOCTOR_SCHEDULE_BOOKING'
  | 'SUB_INPATIENT_BED_MGMT'
  | 'SUB_OUTPATIENT_SOAP_CPPT'
  | 'SUB_IGD_TRIAGE_ATS'
  | 'SUB_CLINICAL_EWS_SCORING'
  | 'SUB_DENTAL_ODONTOGRAM'
  | 'SUB_ANC_BASIC'
  | 'SUB_DELIVERY_PARTOGRAPH'
  | 'SUB_HIGH_RISK_OBSTETRICS'
  | 'SUB_IMMUNIZATION_VACCINE'
  | 'SUB_CHRONIC_DISEASE_REGISTRY'
  | 'SUB_PROLANIS_CLUB'
  | 'SUB_PRB_MEDICATION_CONTINUITY'
  | 'SUB_SURGERY_IBS'
  | 'SUB_HEMODIALYSIS_UNIT'
  | 'SUB_MCU_MEDICAL_CERTIFICATES'
  | 'SUB_PHARMACY_DISPENSING_FEFO'
  | 'SUB_PHARMACY_INVENTORY_OPNAME'
  | 'SUB_PROCUREMENT_PO_PBF'
  | 'SUB_LAB_PATHOLOGY'
  | 'SUB_RADIOLOGY_IMAGING'
  | 'SUB_NUTRITION_DIETARY'
  | 'SUB_BLOOD_BANK_BDRS'
  | 'SUB_CSSD_STERILIZATION'
  | 'SUB_IPSRS_AMBULANCE'
  | 'SUB_CASHIER_BILLING_DEPOSIT'
  | 'SUB_CLAIM_FKTP_KBK'
  | 'SUB_CLAIM_FKRTL_CASEMIX'
  | 'SUB_ACCOUNTING_DOUBLE_ENTRY'
  | 'SUB_MEDICAL_FEE_PAYROLL'
  | 'SUB_REGULATORY_REPORTS'
  | 'SUB_REFERRAL_ORCHESTRATION';

export type ImplementationStatus = 'NOT_IMPLEMENTED' | 'PARTIAL' | 'IMPLEMENTED' | 'VERIFIED';
export type OperationalReadiness = 'BLOCKED' | 'CONFIGURABLE' | 'READY' | 'ACTIVE';
export type IntegrationStatus =
  | 'NOT_REQUIRED'
  | 'NOT_CONFIGURED'
  | 'TESTED'
  | 'CONNECTED'
  | 'DEGRADED';

export interface CapabilityDependencyExpression {
  allOf?: SubCapabilityKey[];
  anyOf?: SubCapabilityKey[];
  requiredEvidenceTypes?: ('IZIN_OPERASIONAL' | 'SIP_NAKES' | 'KALIBRASI_ALKES' | 'MOU_PIHAK_KETIGA')[];
}

export interface SubCapabilityDefinition {
  code: SubCapabilityKey;
  key?: SubCapabilityKey;
  capabilityGroup:
    | 'FRONT_OFFICE'
    | 'CLINICAL_RME'
    | 'MATERNAL_CHILD'
    | 'CHRONIC_SPECIALIZED'
    | 'PHARMACY_SUPPLY'
    | 'DIAGNOSTIC_SUPPORT'
    | 'FINANCE_ACCOUNTING'
    | 'GOVERNANCE_INTEROP';
  name: string;
  title?: string;
  mappedModule: ModuleKey;
  moduleKey?: ModuleKey;
  implementationStatus: ImplementationStatus;
  defaultReadiness: OperationalReadiness;
  operationalReadiness?: OperationalReadiness;
  integrationStatus: IntegrationStatus;
  dependencies: CapabilityDependencyExpression;
  description: string;
}

// Permenkes No. 6 Tahun 2026 Pasal 12 & Permenkes No. 11 Tahun 2025
export type HospitalCapabilityClass = 'PARIPURNA' | 'UTAMA' | 'MADYA' | 'DASAR';
export type LegacyHospitalClass = 'KELAS_A' | 'KELAS_B' | 'KELAS_C' | 'KELAS_D' | 'NON_RS';
export type ClinicClassType = 'PRATAMA' | 'UTAMA' | 'NON_KLINIK';

export interface InpatientStayPolicy {
  enabled: boolean;
  statutoryMaxDays: number | null; // 5 for Klinik Pratama, 7 for Klinik Utama (PMK 11/2025), null for RS
  clinicalReviewMilestoneDays: number;
  utilizationAlertThresholdDays: number;
}

// Kepmenkes HK.01.07/Menkes/177/2026 decoupled payer & grouper contract
export interface FacilityPayerContractConfig {
  contractId: string;
  payerType: 'BPJS_KESEHATAN' | 'ASURANSI_SWASTA' | 'KORPORASI' | 'UMUM';
  claimChannel: 'PCARE_REST' | 'VCLAIM_EKLAIM' | 'PRIVATE_EDI' | 'DIRECT_CASHIER';
  reimbursementModel:
    | 'CAPITATION_KBK'
    | 'NON_CAPITATION_FFS'
    | 'CASEMIX_INACBG'
    | 'CASEMIX_IDRG'
    | 'FEE_FOR_SERVICE';
  grouperVersion: 'INA_CBG_5_4' | 'IDRG_PILOT_1_0' | null;
  tariffScheduleVersion: string;
  effectiveFrom: string;
  effectiveTo?: string;
  rolloutStatus: 'NOT_ENROLLED' | 'PILOT_TRIAL' | 'PARALLEL_RUN' | 'LIVE_OPERATIONAL';
  registeredJknParticipants?: number; // Populasi peserta terdaftar untuk KBK
}

export interface EvidenceRegistryItem {
  id: string;
  facilityCode: string;
  evidenceType:
    | 'IZIN_OPERASIONAL'
    | 'SIP_NAKES'
    | 'SIP_STR_NAKES'
    | 'SIPA_APOTEKER'
    | 'IZIN_BAPETEN_RADIOLOGI'
    | 'KALIBRASI_ALKES'
    | 'MOU_PIHAK_KETIGA';
  subjectName?: string;
  holderOrVendorName?: string;
  documentNumber?: string;
  referenceNumber?: string;
  issuedBy?: string;
  validFrom?: string;
  validUntil: string;
  verificationStatus: 'UNVERIFIED' | 'VERIFIED_ACTIVE' | 'EXPIRED' | 'REVOKED';
  verifiedBy: string;
  relatedSubCapabilities?: SubCapabilityKey[];
}

export interface DynamicFormFieldSchema {
  fieldKey: string;
  label: string;
  fieldType: 'TEXT' | 'NUMBER' | 'SELECT' | 'BOOLEAN' | 'TEXTAREA';
  required: boolean;
  isCoreLocked: boolean; // P1-12: Core clinical fields cannot be deleted
  options?: string[];
  unit?: string;
}

export interface DynamicFormSchemaVersion {
  formCode: string;
  formName: string;
  schemaVersion: number;
  targetModule: ModuleKey;
  effectiveDate: string;
  fields: DynamicFormFieldSchema[];
}

export interface FacilityUnitConfig {
  unitCode: string;
  unitName: string;
  unitType:
    | 'RUANG_PRAKTIK'
    | 'POLIKLINIK_SPESIALIS'
    | 'IGD'
    | 'BANGSAL_RANAP'
    | 'KAMAR_OPERASI'
    | 'HEMODIALISIS'
    | 'LABORATORIUM'
    | 'RADIOLOGI'
    | 'DEPO_FARMASI'
    | 'INSTALASI_PENDUKUNG';
  costCenterCode: string;
  active: boolean;
}

export interface SuperuserFacilityConfigSnapshot {
  configId: string;
  tenantId: string;
  facilityCode: string;
  configVersion: number;
  lifecycleStage:
    | 'DEFINITION'
    | 'VALIDATED'
    | 'DRAFT'
    | 'PREVIEWED'
    | 'APPROVED'
    | 'PUBLISHED'
    | 'ACTIVE'
    | 'SUPERSEDED';
  effectiveDate: string;
  publishedBy: string;
  publishedAt: string;
  changeNotes: string;
  previousVersion?: number;
  supersededFromVersion?: number;
  lifecycleState?: string;
  regulatoryRuleParameterSet?: {
    ruleSetId: string;
    kbkTargetAngkaKontakPerMil: number;
    kbkMaxRrnsPercent: number;
    kbkMinRpptPercent: number;
  };
  domains?: Record<string, any>;

  // 15 Configuration Domains
  enabledSubCapabilities: SubCapabilityKey[];
  activeServices: string[];
  units: FacilityUnitConfig[];
  terminologyOverrides: {
    outpatientUnitLabel: 'Ruang Praktik' | 'Poliklinik';
    triageProtocol: 'ATS_1_5' | 'KEMENKES_4_COLOR';
  };
  formSchemas: DynamicFormSchemaVersion[];
  workflowPolicies: {
    requirePaymentBeforeDispenseOutpatientUmum: boolean;
    allowEmergencyOrderBeforeFullRegistration: boolean;
    rmeCorrectionWindowHours: number; // Default 48 (2x24h per Permenkes 24/2022 Pasal 30)
  };
  tariffMultiplier: number;
  billingPolicy: {
    minInpatientDepositRp: number | null;
    maxCashierDiscountPct: number | null;
    allowSplitPayment: boolean;
  };
  pharmacyPolicy: {
    allocationMethod: 'FEFO' | 'FIFO';
    vatRatePct: number | null;
    vatTreatment: 'CAPITALIZE_TO_INVENTORY' | 'CREDITABLE_INPUT_VAT';
    nearExpiryThresholdDays?: number;
  };
  documentTemplateHeader: {
    institutionHeaderLine1: string;
    institutionHeaderLine2: string;
    citySignatureLabel: string;
    enableQrValidation: boolean;
  };
  dashboardTargets: {
    kbkTargetAngkaKontakPerMil?: number;
    kbkMaxRrnsPct?: number;
    kbkMinRpptPct?: number;
    rsTargetBorMinPct?: number;
    rsTargetBorMaxPct?: number;
    rsTargetAlosMaxDays?: number;
    formulaVersion?: string;
  };
  externalConnectors: {
    satusehatMode: 'DISABLED' | 'SANDBOX_SIMULATION' | 'LIVE_GATEWAY';
    bpjsMode: 'DISABLED' | 'SANDBOX_SIMULATION' | 'LIVE_GATEWAY';
    timeoutMs: number;
    maxRetryAttempts: number;
  };
  accountingPolicy: {
    fiscalPeriodStatus: 'OPEN' | 'SOFT_CLOSED' | 'HARD_CLOSED';
    defaultDoctorFeeSharePct: number | null;
    doctorTaxPph21Pct: number | null;
  };
  crossFacilitySharingPolicy: {
    allowSameTenantReferralLookup: boolean;
    requireExplicitConsentOrReferralToken: boolean;
  };
}

export interface Facility {
  code: string;
  tenantId?: string;
  legalEntityId?: string;
  name: string;
  type: 'KLINIK_PRATAMA' | 'KLINIK_UTAMA' | 'RSUD' | 'RS_SWASTA';
  careLevel?: 'FKTP' | 'FKRTL';
  clinicClass?: ClinicClassType;
  serviceCapabilityClassification?: HospitalCapabilityClass; // Permenkes 6/2026 Pasal 12
  hospitalCapabilityTier?: HospitalCapabilityClass | string;
  permenkes6_2026Class?: HospitalCapabilityClass | string;
  legacyHospitalClass?: LegacyHospitalClass;
  classificationEffectiveDate?: string;
  inpatientStayPolicy?: InpatientStayPolicy;
  maxInpatientDaysLimit?: number | null;
  bpjsContractMode?: string;
  grouperVersion?: string | null;
  payerContract?: FacilityPayerContractConfig;
  activeConfigVersion?: number;
  kemenkesCode: string;
  bpjsPcareCode: string;
  satusehatOrgId: string;
  address: string;
  city: string;
  phone: string;
  serverNodeUrl: string;
  polyclinics?: string[];
  active: boolean;
  createdAt: string;
}

export interface UserAccount {
  id: string;
  tenantId?: string;
  username: string;
  fullName: string;
  nipOrSip: string; // NIP / Nomor SIP Dokter / STR
  sipValidUntil?: string;
  email: string;
  role: UserRole;
  facilityRoles?: Record<string, UserRole>; // Per-facility role overrides
  allowedFacilities: string[]; // Explicit facility codes, or wildcard for the system administrator.
  customPrivileges: ModuleKey[];
  resolvedModules?: ModuleKey[];
  roleName?: string;
  specialization?: string;
  polyclinic?: string;
  isPractitioner?: boolean;
  active: boolean;
  lastLoginAt?: string;
  deletedAt?: string;
  createdBy: string;
  createdAt: string;
}

export interface Patient {
  id: string;
  tenantId?: string;
  facilityCode: string;
  mrNumber: string; // Facility-local Nomor Rekam Medis (No. RM)
  nik: string; // 16 digit NIK
  nikBlindIndex?: string; // HMAC-SHA256 keyed by tenant
  bpjsNumber: string;
  ihsNumber: string; // SATUSEHAT IHS ID
  fullName: string;
  birthDate: string;
  gender: 'L' | 'P';
  bloodType: 'A' | 'B' | 'AB' | 'O' | 'TIDAK_DIKETAHUI';
  rhesus: '+' | '-';
  phone: string;
  address: string;
  allergies: string[];
  chronicConditions: string[];
  isProlanisParticipant?: boolean;
  prolanisControlled?: boolean;
  isPrbActive?: boolean;
  emergencyContactName: string;
  emergencyContactPhone: string;
  consentCrossFacilityShare?: boolean;
  createdAt: string;
}

export interface VitalSigns {
  systolic: number; // mmHg
  diastolic: number; // mmHg
  heartRate: number; // bpm
  respiratoryRate: number; // x/min
  temperature: number; // Celsius
  spo2: number; // %
  supplementalO2?: boolean;
  weightKg: number;
  heightCm: number;
  gcsEye: number; // 1-4
  gcsVerbal: number; // 1-5
  gcsMotor: number; // 1-6
  avpu?: 'A' | 'V' | 'P' | 'U';
  painScale: number; // 0-10 NRS
}

export type AtsTriageCategory = 'ATS_1' | 'ATS_2' | 'ATS_3' | 'ATS_4' | 'ATS_5';

export type ToothCondition =
  | 'NORMAL'
  | 'CARIES'
  | 'FILLING_AMALGAM'
  | 'FILLING_COMPOSITE'
  | 'CROWN'
  | 'MISSING'
  | 'ROOT_CANAL'
  | 'IMPACTED'
  | 'FRACTURE';

export interface OdontogramEntry {
  toothNumber: number; // FDI 11-18, 21-28, 31-38, 41-48
  condition: ToothCondition;
  surface: 'M' | 'O' | 'D' | 'B' | 'L' | 'ALL';
  notes: string;
}

export interface PrescriptionItem {
  medicationId: string;
  medicationCode: string;
  medicationName: string;
  dosage: string;
  signa: string;
  quantity: number;
  dispensedQuantity?: number;
  unit: string;
  unitPrice: number;
  notes?: string;
}

export interface ClinicalProcedureItem {
  icd9Code: string;
  name: string;
  tariff?: number | null;
  notes?: string;
}

export interface ClinicalAmendmentEntry {
  id: string;
  amendedAt: string;
  amendedBy: string;
  authorRole: UserRole;
  amendmentType: 'CORRECTION_WITHIN_48H' | 'CO_SIGNED_ADDENDUM';
  reason: string;
  previousAssessmentSummary: string;
  newAssessmentSummary: string;
  coSignedBySupervisor?: string;
}

export interface CpptCollaborativeEntry {
  id: string;
  visitId: string;
  facilityCode: string;
  recordedAt: string;
  authorId: string;
  authorName: string;
  profession: 'DOKTER' | 'PERAWAT' | 'BIDAN' | 'APOTEKER' | 'AHLI_GIZI';
  subjective: string;
  objective: string;
  assessment: string;
  planAndInstruction: string;
  status: 'DRAFT' | 'SIGNED_LOCKED';
  signedAt?: string;
}

export interface SoapRecord {
  id: string;
  tenantId?: string;
  visitId: string;
  facilityCode: string;
  patientId: string;
  doctorId: string;
  doctorName: string;
  recordedAt: string;
  configVersion?: number;
  recordStatus?: 'DRAFT' | 'SIGNED_LOCKED' | 'AMENDED_WITHIN_48H' | 'ADDENDUM_APPENDED';
  signedAt?: string;
  signedBy?: string;
  amendments?: ClinicalAmendmentEntry[];
  cpptEntries?: CpptCollaborativeEntry[];
  subjective: {
    chiefComplaint: string;
    historyOfPresentIllness: string;
    pastMedicalHistory: string;
    reviewOfSystems: string;
  };
  objective: {
    physicalExamGeneral: string;
    headToToeNotes: string;
    vitals: VitalSigns;
    odontogram: OdontogramEntry[];
  };
  assessment: {
    primaryIcd10Code: string;
    primaryIcd10Name: string;
    isSkdi4aCompetency?: boolean;
    secondaryIcd10: { code: string; name: string }[];
    clinicalImpression: string;
    prognosis: 'SANAM' | 'BONAM' | 'MALAM' | 'DUBIA_AD_BONAM' | 'DUBIA_AD_MALAM';
  };
  plan: {
    therapyNotes: string;
    educationNotes: string;
    disposition: 'PULANG' | 'RAWAT_INAP' | 'RUJUK_FKTL' | 'OBSERVASI_IGD' | 'KONTROL_ULANG' | 'RUJUK_BALIK_PRB';
    taccJustification?: {
      hasTacc: boolean;
      category?: 'TIME' | 'AGE' | 'COMPLICATION' | 'COMORBIDITY';
      clinicalReason?: string;
    };
    sickLeaveDays: number;
    referralHospital?: string;
    procedures: ClinicalProcedureItem[];
    prescriptions: PrescriptionItem[];
    labRequestedParams: string[];
  };
  satusehatEncounterId?: string;
  syncedToSatusehat: boolean;
}

export type TriageLevel = 'RESUSITASI_MERAH' | 'EMERGENSI_KUNING' | 'URGENSI_HIJAU' | 'NON_URGEN_PUTIH';

export interface VisitQueueItem {
  id: string;
  tenantId?: string;
  facilityCode: string;
  configVersion?: number;
  queueNumber: string;
  registrationNumber: string;
  patientId: string;
  patientName: string;
  mrNumber: string;
  nik: string;
  gender: 'L' | 'P';
  birthDate: string;
  polyclinic: string;
  doctorId: string;
  doctorName: string;
  guarantor: 'UMUM' | 'BPJS_KESEHATAN' | 'ASURANSI_SWASTA' | 'KORPORASI';
  bpjsSepOrPcareNo?: string;
  visitType?: 'KUNJUNGAN_SAKIT' | 'KUNJUNGAN_SEHAT' | 'IGD_DARURAT' | 'RAWAT_INAP';
  triageLevel: TriageLevel;
  atsCategory?: AtsTriageCategory;
  ewsScore?: number;
  ewsProtocol?: 'NEWS2' | 'MEWS' | 'PEWS' | 'MEOWS';
  status: 'MENUNGGU' | 'DIPERIKSA_PERAWAT' | 'DIPERIKSA_DOKTER' | 'FARMASI_LAB' | 'KASIR' | 'SELESAI' | 'BATAL';
  vitals: VitalSigns;
  chiefComplaint: string;
  soapId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InpatientBed {
  id: string;
  tenantId?: string;
  facilityCode: string;
  wardName: string;
  roomNumber: string;
  bedCode: string;
  bedClass: 'VVIP' | 'VIP' | 'KELAS_1' | 'KELAS_2' | 'KELAS_3' | 'ICU' | 'ISOLASI' | 'IGD_OBS';
  dailyRate: number;
  status: 'TERSEDIA' | 'TERISI' | 'DIBERSIHKAN' | 'MAINTENANCE';
  patientId?: string;
  patientName?: string;
  mrNumber?: string;
  visitId?: string;
  admittedAt?: string;
  stayDaysCount?: number;
  attendingDoctor?: string;
  diagnosis?: string;
}

export interface MedicationBatch {
  batchNumber: string;
  expiryDate: string; // YYYY-MM-DD
  stock: number;
  depotCode?: string;
}

export interface MedicationInventory {
  id: string;
  tenantId?: string;
  facilityCode: string;
  code: string;
  kfaCode: string;
  name: string;
  genericName: string;
  category: 'OBAT_KERAS' | 'OBAT_BEBAS_TERBATAS' | 'OBAT_BEBAS' | 'NARKOTIKA_PSIKOTROPIKA' | 'ALKES_BMHP';
  form: 'TABLET' | 'KAPSUL' | 'SIRUP' | 'INJEKSI' | 'SALEP' | 'INFUS' | 'ALKES';
  unit: string;
  minStock: number;
  buyPrice: number; // HNA
  vatPercent?: number;
  discountPercent?: number;
  sellPrice: number; // HJA
  isFornasFktp?: boolean;
  isPrbDrug?: boolean;
  contraindications: string[];
  interactions: string[];
  batches: MedicationBatch[];
}

export interface PharmacyOrder {
  id: string;
  tenantId?: string;
  facilityCode: string;
  visitId: string;
  patientId: string;
  patientName: string;
  mrNumber: string;
  doctorName: string;
  allergies: string[];
  items: PrescriptionItem[];
  status: 'ANTRIAN_RESEP' | 'DIRACIK' | 'DISERAHKAN_PARSIAL' | 'DISERAHKAN' | 'DIRETUR';
  dispenseSequenceCount?: number;
  dispensedBatches: {
    medicationCode: string;
    batchNumber: string;
    quantity: number;
    sequenceNo?: number;
    depotCode?: string;
  }[];
  pharmacistNotes?: string;
  dispensedBy?: string;
  dispensedAt?: string;
  createdAt: string;
}

export type MedicationMutationType =
  | 'STOK_AWAL'
  | 'MASUK_PBF'
  | 'KELUAR_RESEP'
  | 'PENYESUAIAN_OPNAME'
  | 'RETUR_PASIEN'
  | 'RETUR_PBF'
  | 'TRANSFER_DEPO';

export interface MedicationStockMutation {
  id: string;
  tenantId?: string;
  facilityCode: string;
  timestamp: string;
  medicationId: string;
  medicationCode: string;
  medicationName: string;
  batchNumber: string;
  depotCode?: string;
  unit: string;
  type: MedicationMutationType;
  quantityChange: number;
  stockBefore: number;
  stockAfter: number;
  unitPrice: number;
  totalValue: number;
  referenceId: string;
  dispenseSequenceNo?: number;
  counterpartyOrPatient: string;
  actorName: string;
  notes: string;
}

export interface PurchaseOrderPbf {
  id: string;
  tenantId?: string;
  facilityCode: string;
  poNumber: string;
  supplierName?: string;
  supplierPbfName?: string;
  supplierInvoiceNo?: string;
  orderDate: string;
  dueDate: string;
  status: 'DRAFT_PO' | 'ORDERED' | 'RECEIVED_PARTIAL' | 'RECEIVED_FULL' | 'PAID_SETTLED';
  items: {
    medicationId?: string;
    medicationCode: string;
    medicationName: string;
    orderedQty?: number;
    receivedQty?: number;
    quantity?: number;
    unit?: string;
    hnaPrice?: number;
    hnaUnitPrice?: number;
    unitCostHna?: number;
    batchNumber?: string;
    expiryDate?: string;
    discountPct?: number;
    vatPct?: number;
    subtotalRp?: number;
    subtotalHna?: number;
  }[];
  subtotalHna: number;
  totalDiscount?: number;
  discountTotal?: number;
  totalVat?: number;
  ppnAmount?: number;
  grandTotalPayable?: number;
  totalAmount?: number;
  invoiceNumberPbf?: string;
  invoicePbfNumber?: string;
  receivedAt?: string;
  createdBy?: string;
  notes?: string;
}

export interface LabParameterResult {
  code: string;
  name: string;
  category: 'HEMATOLOGI' | 'KIMIA_DARAH' | 'URINALISA' | 'IMUNOSEROLOGI' | 'MIKROBIOLOGI';
  value: number | null;
  unit: string;
  refMin: number | null;
  refMax: number | null;
  referenceVerified?: boolean;
  referenceSource?: string;
  methodPopulation?: string;
  criticalMin?: number;
  criticalMax?: number;
  flag: 'PENDING' | 'UNASSESSED' | 'NORMAL' | 'LOW' | 'HIGH' | 'CRITICAL_LOW' | 'CRITICAL_HIGH';
  tariff?: number | null;
}

export interface LabOrder {
  id: string;
  tenantId?: string;
  facilityCode: string;
  visitId: string;
  patientId: string;
  patientName: string;
  mrNumber: string;
  gender: 'L' | 'P';
  doctorName: string;
  specimenCode: string;
  clinicalNotes: string;
  status: 'PERMINTAAN_BARU' | 'SAMPEL_DIAMBIL' | 'SELESAI_VERIFIKASI';
  parameters: LabParameterResult[];
  verifiedBy?: string;
  verifiedAt?: string;
  createdAt: string;
}

export interface RadiologyOrderRis {
  id: string;
  tenantId?: string;
  facilityCode: string;
  visitId: string;
  patientId: string;
  patientName: string;
  mrNumber: string;
  accessionNumber?: string;
  modality:
    | 'RONTGEN_THORAX'
    | 'USG_ABDOMEN_OBGYN'
    | 'USG_ABDOMEN'
    | 'CT_SCAN_HEAD'
    | 'EKG_12_LEAD'
    | 'XRAY'
    | 'USG'
    | 'CT'
    | 'MRI';
  examName: string;
  priority?: 'ROUTINE' | 'URGENT' | 'CITO' | 'CITO_STAT';
  clinicalIndication: string;
  requestingDoctor?: string;
  radiologistName: string;
  status: 'ORDERED' | 'IN_IMAGING' | 'EXPERTISE_VERIFIED';
  findings?: string;
  findingsText?: string;
  impression?: string;
  impressionConclusion?: string;
  tariff: number | null;
  createdAt: string;
  verifiedAt?: string;
}

export interface SurgicalScheduleIbs {
  id: string;
  tenantId?: string;
  facilityCode: string;
  visitId?: string;
  patientId: string;
  patientName: string;
  mrNumber: string;
  operatingRoom?: string;
  operatingRoomCode?: string;
  procedureName: string;
  icd9CmCode?: string;
  procedureIcd9Code?: string;
  surgeonName: string;
  anesthesiologistName: string;
  scheduledStart: string;
  scheduledEnd?: string;
  anesthesiaType?: string;
  asaScore?: string;
  status:
    | 'SCHEDULED'
    | 'IN_PROGRESS'
    | 'SIGN_IN_VERIFIED'
    | 'TIME_OUT_INCISION'
    | 'SIGN_OUT_RECOVERY'
    | 'COMPLETED';
  whoSafetyChecklist?: Record<string, boolean>;
  whoChecklist?: {
    signInIdentityAndConsentConfirmed: boolean;
    signInSiteMarked: boolean;
    signInPulseOximeterAndAllergyChecked: boolean;
    timeOutTeamIntroducedAndAntibioticGiven: boolean;
    timeOutImagingDisplayed: boolean;
    signOutInstrumentSpongeNeedleCountCorrect: boolean;
    signOutSpecimenLabeled: boolean;
  };
  estimatedTariff?: number;
  tariffEstimate?: number;
  whoSignInCompleted?: boolean;
  whoTimeOutCompleted?: boolean;
  whoSignOutCompleted?: boolean;
  postOpNotes?: string;
}

export interface BillingLineItem {
  id: string;
  category:
    | 'PENDAFTARAN'
    | 'KONSULTASI'
    | 'TINDAKAN'
    | 'FARMASI'
    | 'LABORATORIUM'
    | 'RADIOLOGI'
    | 'KAMAR_INAP'
    | 'BEDAH_IBS'
    | 'MCU';
  description: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  costCenterCode?: string;
}

export interface InvoiceRecord {
  id: string;
  tenantId?: string;
  facilityCode: string;
  invoiceNumber: string;
  visitId: string;
  patientId: string;
  patientName: string;
  mrNumber: string;
  guarantor: 'UMUM' | 'BPJS_KESEHATAN' | 'ASURANSI_SWASTA' | 'KORPORASI';
  items: BillingLineItem[];
  pricingStatus?: 'PENDING' | 'COMPLETE';
  unpricedItems?: { key: string; category: BillingLineItem['category']; description: string; quantity: number }[];
  subtotal: number;
  discountAmount: number;
  depositAppliedAmount?: number;
  bpjsCoveredAmount: number;
  claimRequestedAmount?: number;
  totalReceivedAmount?: number;
  claimSubmittedAt?: string;
  claimReceipts?: { amount: number; paymentReference: string; receivedAt: string; receivedBy: string }[];
  inacbgOrIdrgTariffAmount?: number;
  tariffVarianceAmount?: number; // Klaim Disetujui - Tarif Riil RS
  grouperCode?: string;
  grouperScheme?: 'INA_CBG_5_4' | 'IDRG_PILOT_1_0';
  patientPayableAmount: number;
  paymentMethod: 'TUNAI' | 'QRIS' | 'DEBIT_KREDIT' | 'KLAIM_BPJS' | 'PIUTANG_ASURANSI';
  status: 'BELUM_LUNAS' | 'LUNAS' | 'KLAIM_DIAJUKAN' | 'KLAIM_DISETUJUI' | 'KLAIM_PENDING_DISPUTE' | 'KLAIM_DITOLAK';
  cashierName?: string;
  paidAt?: string;
  dueDate?: string;
  createdAt: string;
}

export type AccountingEventType =
  | 'DEPOSIT_RECEIVED'
  | 'SERVICE_COMPLETED_INVOICE_ISSUED'
  | 'MEDICAL_FEE_ACCRUED'
  | 'MEDICATION_DISPENSED_COGS'
  | 'INVENTORY_RECEIVED_PBF'
  | 'PAYMENT_RECEIVED_CASH'
  | 'CLAIM_APPROVED_SETTLED'
  | 'CLAIM_REJECTED_WRITEOFF'
  | 'REFUND_APPROVED'
  | 'INVENTORY_RETURNED';

export interface DoubleEntryJournalLine {
  accountCode: string;
  accountName: string;
  accountCategory: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'COGS_HPP' | 'EXPENSE';
  debit: number;
  credit: number;
  costCenterCode?: string;
  subledgerRef?: string;
}

export interface DoubleEntryJournal {
  id: string;
  tenantId: string;
  facilityCode: string;
  journalNumber: string;
  timestamp: string;
  eventType: AccountingEventType;
  sourceTransactionId: string;
  description: string;
  lines: DoubleEntryJournalLine[];
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
  status: 'POSTED_IMMUTABLE' | 'REVERSED';
  reversedByJournalId?: string;
  actorName: string;
}

export interface AccountingEntry {
  id: string;
  tenantId?: string;
  facilityCode: string;
  entryNumber: string;
  timestamp: string;
  accountCode: string;
  accountName: string;
  type: 'PENDAPATAN' | 'PENGELUARAN';
  category:
    | 'LAYANAN_MEDIS'
    | 'FARMASI'
    | 'KLAIM_BPJS'
    | 'PENGADAAN_OBAT'
    | 'OPERASIONAL'
    | 'JASA_MEDIS'
    | 'GAJI_SDM';
  description: string;
  amount: number;
  referenceId: string;
  costCenterCode?: string;
}

export interface ReferralOrchestrationRecord {
  id: string;
  tenantId?: string;
  facilityCode?: string;
  visitId?: string;
  referralNumber: string;
  direction?: 'VERTICAL_TO_FKRTL' | 'PRB_BACK_TO_FKTP' | 'HORIZONTAL_INTER_FACILITY';
  referralType?: string;
  sourceFacilityCode?: string;
  originFacilityCode?: string;
  originFacilityName?: string;
  targetFacilityCode?: string;
  destinationFacilityCode?: string;
  destinationFacilityName?: string;
  destinationPolyclinicOrUnit?: string;
  patientId: string;
  patientName: string;
  mrNumber?: string;
  nik?: string;
  bpjsNumber?: string;
  icd10Code?: string;
  primaryIcd10Code?: string;
  icd10Name?: string;
  primaryIcd10Name?: string;
  isSkdi4aDiagnosis?: boolean;
  hasTaccException?: boolean;
  taccCategory?: string;
  taccReason?: string;
  taccJustification?: string;
  clinicalSummary?: string;
  clinicalReason?: string;
  stabilizationProvided?: string;
  prbCarePlanNotes?: string;
  state?:
    | 'CREATED'
    | 'VALIDATED'
    | 'SUBMITTED'
    | 'SENT_DISPATCHED'
    | 'ACKNOWLEDGED'
    | 'ACCEPTED'
    | 'ACCEPTED_BY_DESTINATION'
    | 'REJECTED'
    | 'SCHEDULED'
    | 'COMPLETED';
  status?: string;
  externalRefId?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IdempotencyRecord {
  scopeKey: string; // tenantId:operationType:clientRequestId
  tenantId: string;
  facilityCode: string;
  operationType: string;
  clientRequestId: string;
  requestPayloadSha256: string;
  status?: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  httpStatus: number;
  responseSnapshot: unknown;
  referenceEntityId?: string;
  createdAt: string;
}

export interface BridgingLog {
  id: string;
  tenantId?: string;
  facilityCode: string;
  targetSystem: 'SATUSEHAT_FHIR_R4' | 'BPJS_PCARE' | 'BPJS_VCLAIM' | 'IOMT_GATEWAY';
  resourceType: string;
  referenceId: string;
  patientName: string;
  status: 'TERKIRIM_200' | 'ANTRIAN_RETRY' | 'VALIDATED' | 'QUEUED_LOCAL' | 'DEGRADED_TIMEOUT';
  externalId: string;
  latencyMs: number;
  payloadPreview: Record<string, unknown>;
  timestamp: string;
}

export interface AuditLogEntry {
  id: string;
  tenantId?: string;
  timestamp: string;
  facilityCode: string;
  actorUsername: string;
  actorRole: UserRole;
  action: string;
  targetResource: string;
  details: string;
}

export interface ServerConfig {
  nodeName: string;
  environment: 'PRODUCTION' | 'STAGING';
  storagePath: string;
  satusehatBaseUrl: string;
  bpjsBaseUrl: string;
  iomtListenPort: number;
  sessionTimeoutMinutes: number;
}
