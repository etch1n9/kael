// Browser presentation and previews use API-provided permissions. Operations are validated by the server.
import type {
  AccountingEntry,
  BillingLineItem,
  InvoiceRecord,
  MedicationBatch,
  MedicationInventory,
  ModuleKey,
  Patient,
  PrescriptionItem,
  RoleDefinition,
  TriageLevel,
  UserAccount,
  UserRole,
  VitalSigns,
} from './simrs.ts';


export function normalizeFacilityCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}


export function canUserAccessFacility(
  user: Pick<UserAccount, 'role' | 'allowedFacilities' | 'active'>,
  facilityCode: string
): boolean {
  if (!user.active) return false;
  const normalizedTarget = normalizeFacilityCode(facilityCode);
  if (!normalizedTarget) return false;
  if (user.role === 'SUPERUSER' || user.allowedFacilities.includes('*')) {
    return true;
  }
  return user.allowedFacilities
    .map((f) => normalizeFacilityCode(f))
    .includes(normalizedTarget);
}


export function canUserAccessModule(
  user: Pick<UserAccount, 'role' | 'customPrivileges' | 'active' | 'resolvedModules'>,
  moduleKey: ModuleKey
): boolean {
  if (!user.active) return false;
  if (moduleKey === 'SUPERUSER_CONTROL' && user.role !== 'SUPERUSER') return false;
  return (user.resolvedModules || user.customPrivileges || []).includes(moduleKey);
}


export function calculateBMI(weightKg: number, heightCm: number): {
  bmi: number;
  category: 'KURUS' | 'NORMAL' | 'BERLEBIH' | 'OBESITAS';
} {
  if (weightKg <= 0 || heightCm <= 0) {
    return { bmi: 0, category: 'NORMAL' };
  }
  const heightM = heightCm / 100;
  const raw = weightKg / (heightM * heightM);
  const bmi = Math.round(raw * 10) / 10;
  if (bmi < 18.5) return { bmi, category: 'KURUS' };
  if (bmi < 25.0) return { bmi, category: 'NORMAL' };
  if (bmi < 30.0) return { bmi, category: 'BERLEBIH' };
  return { bmi, category: 'OBESITAS' };
}


export function calculateMAP(systolic: number, diastolic: number): number {
  if (systolic <= 0 || diastolic <= 0) return 0;
  return Math.round((systolic + 2 * diastolic) / 3);
}


export function calculatePatientAge(birthDate: string): number {
  if (!birthDate) return 30;
  const birthYear = Number(birthDate.slice(0, 4));
  if (Number.isNaN(birthYear) || birthYear < 1900) return 30;
  const currentYear = new Date().getFullYear();
  return Math.max(0, currentYear - birthYear);
}


export const calculateAgeYears = calculatePatientAge;


export function calculateGCS(eye: number, verbal: number, motor: number): number {
  const e = Math.min(4, Math.max(1, Math.round(eye || 4)));
  const v = Math.min(5, Math.max(1, Math.round(verbal || 5)));
  const m = Math.min(6, Math.max(1, Math.round(motor || 6)));
  return e + v + m;
}


export function evaluateAutoTriage(vitals: VitalSigns): TriageLevel {
  const gcs = calculateGCS(vitals.gcsEye, vitals.gcsVerbal, vitals.gcsMotor);
  if (
    vitals.spo2 < 90 ||
    vitals.systolic > 200 ||
    vitals.systolic < 80 ||
    vitals.heartRate > 140 ||
    vitals.respiratoryRate > 30 ||
    gcs <= 8
  ) {
    return 'RESUSITASI_MERAH';
  }
  if (
    vitals.spo2 < 94 ||
    vitals.systolic >= 160 ||
    vitals.temperature >= 39.0 ||
    vitals.heartRate > 115 ||
    vitals.painScale >= 7 ||
    gcs <= 12
  ) {
    return 'EMERGENSI_KUNING';
  }
  if (vitals.temperature >= 37.8 || vitals.painScale >= 4 || vitals.systolic >= 140) {
    return 'URGENSI_HIJAU';
  }
  return 'NON_URGEN_PUTIH';
}


export function evaluateLabFlag(
  value: number,
  refMin: number | null,
  refMax: number | null,
  criticalMin?: number | null,
  criticalMax?: number | null,
  referenceVerified = false
): 'UNASSESSED' | 'NORMAL' | 'LOW' | 'HIGH' | 'CRITICAL_LOW' | 'CRITICAL_HIGH' {
  if (!referenceVerified || !Number.isFinite(value)
    || typeof refMin !== 'number' || typeof refMax !== 'number'
    || !Number.isFinite(refMin) || !Number.isFinite(refMax) || refMin > refMax) return 'UNASSESSED';
  if (typeof criticalMin === 'number' && Number.isFinite(criticalMin) && value <= criticalMin) return 'CRITICAL_LOW';
  if (typeof criticalMax === 'number' && Number.isFinite(criticalMax) && value >= criticalMax) return 'CRITICAL_HIGH';
  if (value < refMin) return 'LOW';
  if (value > refMax) return 'HIGH';
  return 'NORMAL';
}


export function allocateFEFOStock(
  batches: MedicationBatch[],
  requestedQty: number
): {
  success: boolean;
  allocations: { batchNumber: string; quantity: number }[];
  updatedBatches: MedicationBatch[];
  shortfall: number;
} {
  if (requestedQty <= 0) {
    return { success: true, allocations: [], updatedBatches: [...batches], shortfall: 0 };
  }
  const sorted = [...batches]
    .map((b) => ({ ...b }))
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

  let remaining = requestedQty;
  const allocations: { batchNumber: string; quantity: number }[] = [];

  for (const batch of sorted) {
    if (remaining <= 0) break;
    if (batch.stock <= 0) continue;
    const take = Math.min(batch.stock, remaining);
    batch.stock -= take;
    remaining -= take;
    allocations.push({ batchNumber: batch.batchNumber, quantity: take });
  }

  return {
    success: remaining === 0,
    allocations,
    updatedBatches: sorted,
    shortfall: remaining,
  };
}


export function checkClinicalSafetyAlerts(
  prescriptions: PrescriptionItem[],
  inventoryList: MedicationInventory[],
  patientAllergies: string[]
): {
  allergyConflicts: string[];
  drugInteractions: string[];
  stockShortfalls: string[];
} {
  const allergyConflicts: string[] = [];
  const drugInteractions: string[] = [];
  const stockShortfalls: string[] = [];

  const normalizedAllergies = patientAllergies.map((a) => a.toLowerCase().trim());
  const selectedMeds: MedicationInventory[] = [];

  for (const item of prescriptions) {
    const med = inventoryList.find(
      (m) => m.id === item.medicationId || m.code === item.medicationCode
    );
    if (!med) continue;
    selectedMeds.push(med);

    const totalStock = med.batches.reduce((sum, b) => sum + b.stock, 0);
    if (item.quantity > totalStock) {
      stockShortfalls.push(
        `${med.name}: diminta ${item.quantity} ${med.unit}, stok tersedia ${totalStock} ${med.unit}`
      );
    }

    const keywords = [
      med.name.toLowerCase(),
      med.genericName.toLowerCase(),
      ...med.contraindications.map((c) => c.toLowerCase()),
    ];
    for (const allergy of normalizedAllergies) {
      if (
        allergy &&
        keywords.some((kw) => kw.includes(allergy) || allergy.includes(kw))
      ) {
        allergyConflicts.push(
          `Peringatan Alergi: Pasien alergi "${allergy}" — kontraindikasi dengan ${med.name} (${med.genericName})`
        );
      }
    }
  }

  for (let i = 0; i < selectedMeds.length; i++) {
    for (let j = i + 1; j < selectedMeds.length; j++) {
      const medA = selectedMeds[i];
      const medB = selectedMeds[j];
      const aInteractsWithB = medA.interactions.some(
        (inter) =>
          medB.genericName.toLowerCase().includes(inter.toLowerCase()) ||
          medB.name.toLowerCase().includes(inter.toLowerCase())
      );
      const bInteractsWithA = medB.interactions.some(
        (inter) =>
          medA.genericName.toLowerCase().includes(inter.toLowerCase()) ||
          medA.name.toLowerCase().includes(inter.toLowerCase())
      );
      if (aInteractsWithB || bInteractsWithA) {
        drugInteractions.push(
          `Interaksi Obat: ${medA.name} (${medA.genericName}) berinteraksi dengan ${medB.name} (${medB.genericName})`
        );
      }
    }
  }

  return { allergyConflicts, drugInteractions, stockShortfalls };
}


export function calculateInvoiceTotals(
  items: BillingLineItem[],
  guarantor: 'UMUM' | 'BPJS_KESEHATAN' | 'ASURANSI_SWASTA' | 'KORPORASI',
  discountAmount = 0
): {
  subtotal: number;
  discountAmount: number;
  bpjsCoveredAmount: number;
  patientPayableAmount: number;
} {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const clampedDiscount = Math.max(0, Math.min(subtotal, discountAmount));
  const netAfterDiscount = subtotal - clampedDiscount;

  if (guarantor === 'BPJS_KESEHATAN') {
    return {
      subtotal,
      discountAmount: clampedDiscount,
      bpjsCoveredAmount: netAfterDiscount,
      patientPayableAmount: 0,
    };
  }

  return {
    subtotal,
    discountAmount: clampedDiscount,
    bpjsCoveredAmount: 0,
    patientPayableAmount: netAfterDiscount,
  };
}


export const ICD10_CATALOG: { code: string; name: string; category: string }[] = [
  { code: 'J06.9', name: 'Infeksi Saluran Pernapasan Akut Atas (ISPA), tidak spesifik', category: 'Respirasi' },
  { code: 'I10', name: 'Hipertensi Esensial (Primer)', category: 'Kardiovaskular' },
  { code: 'E11.9', name: 'Diabetes Melitus Tipe 2 tanpa komplikasi', category: 'Endokrin & Metabolik' },
  { code: 'K29.7', name: 'Gastritis, tidak spesifik (Dispepsia / Maag Akut)', category: 'Gastrointestinal' },
  { code: 'A09', name: 'Gastroenteritis dan Kolitis Infeksi (Diare Akut)', category: 'Infeksi' },
  { code: 'A90', name: 'Demam Dengue Klasik (DF)', category: 'Infeksi Tropis' },
  { code: 'A91', name: 'Demam Berdarah Dengue (DBD / DHF)', category: 'Infeksi Tropis' },
  { code: 'J45.9', name: 'Asma Bronkial, tidak spesifik', category: 'Respirasi' },
  { code: 'K02.1', name: 'Karies Dentin (Gigi Berlubang Mencapai Dentin)', category: 'Gigi & Mulut' },
  { code: 'K04.0', name: 'Pulpitis (Radang Pulpa Gigi)', category: 'Gigi & Mulut' },
  { code: 'K05.0', name: 'Gingivitis Akut', category: 'Gigi & Mulut' },
  { code: 'M54.5', name: 'Low Back Pain (Nyeri Punggung Bawah)', category: 'Muskuloskeletal' },
  { code: 'R51', name: 'Cephalgia / Nyeri Kepala Akut', category: 'Neurologi' },
  { code: 'N39.0', name: 'Infeksi Saluran Kemih (ISK), lokasi tidak spesifik', category: 'Urologi' },
  { code: 'L20.9', name: 'Dermatitis Atopik', category: 'Kulit' },
  { code: 'H10.9', name: 'Konjungtivitis Akut', category: 'Mata' },
  { code: 'O80.0', name: 'Persalinan Tunggal Spontan Presentasi Belakang Kepala', category: 'Obstetri' },
  { code: 'I20.9', name: 'Angina Pektoris, tidak spesifik', category: 'Kardiovaskular' },
];


// Labels follow the procedure meanings in the CMS ICD-9-CM v32 full code titles.
// https://www.cms.gov/medicare/coding-billing/icd-10-codes/icd-9-cm-diagnosis-procedure-codes-abbreviated-and-full-code-titles
export const ICD9_PROCEDURES_CATALOG: { code: string; name: string }[] = [
  { code: '89.03', name: 'Wawancara dan evaluasi komprehensif' },
  { code: '89.52', name: 'Elektrokardiogram (EKG)' },
  { code: '93.94', name: 'Pemberian obat pernapasan melalui nebulizer' },
  { code: '99.18', name: 'Injeksi atau infus elektrolit' },
  { code: '86.59', name: 'Penutupan kulit dan jaringan subkutan pada lokasi lain' },
  { code: '23.09', name: 'Ekstraksi gigi lainnya' },
  { code: '23.2', name: 'Restorasi gigi dengan penambalan' },
  { code: '96.54', name: 'Skeling, pemolesan, dan debridemen gigi' },
  { code: '90.59', name: 'Pemeriksaan mikroskopis darah lainnya' },
  { code: '88.78', name: 'Ultrasonografi diagnostik uterus hamil' },
];


// Reference intervals and critical limits require verification for the laboratory method and patient population.
export const LAB_PARAMETER_TEMPLATES: {
  code: string;
  name: string;
  category: 'HEMATOLOGI' | 'KIMIA_DARAH' | 'URINALISA' | 'IMUNOSEROLOGI';
  unit: string;
  refMin: number | null;
  refMax: number | null;
  criticalMin?: number;
  criticalMax?: number;
}[] = [
  {
    code: 'HGB',
    name: 'Hemoglobin (Hb)',
    category: 'HEMATOLOGI',
    unit: 'g/dL',
    refMin: null,
    refMax: null,
  },
  {
    code: 'WBC',
    name: 'Leukosit (Sel Darah Putih)',
    category: 'HEMATOLOGI',
    unit: '10^3/uL',
    refMin: null,
    refMax: null,
  },
  {
    code: 'PLT',
    name: 'Trombosit (Platelet)',
    category: 'HEMATOLOGI',
    unit: '10^3/uL',
    refMin: null,
    refMax: null,
  },
  {
    code: 'HCT',
    name: 'Hematokrit (Ht)',
    category: 'HEMATOLOGI',
    unit: '%',
    refMin: null,
    refMax: null,
  },
  {
    code: 'GDS',
    name: 'Glukosa Darah Sewaktu (GDS)',
    category: 'KIMIA_DARAH',
    unit: 'mg/dL',
    refMin: null,
    refMax: null,
  },
  {
    code: 'GDP',
    name: 'Glukosa Darah Puasa (GDP)',
    category: 'KIMIA_DARAH',
    unit: 'mg/dL',
    refMin: null,
    refMax: null,
  },
  {
    code: 'CHOL',
    name: 'Kolesterol Total',
    category: 'KIMIA_DARAH',
    unit: 'mg/dL',
    refMin: null,
    refMax: null,
  },
  {
    code: 'UA',
    name: 'Asam Urat (Uric Acid)',
    category: 'KIMIA_DARAH',
    unit: 'mg/dL',
    refMin: null,
    refMax: null,
  },
  {
    code: 'CREAT',
    name: 'Kreatinin Serum',
    category: 'KIMIA_DARAH',
    unit: 'mg/dL',
    refMin: null,
    refMax: null,
  },
  {
    code: 'NS1',
    name: 'Antigen Dengue NS1 Rapid',
    category: 'IMUNOSEROLOGI',
    unit: 'Index',
    refMin: null,
    refMax: null,
  },
];


export function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount || 0);
}


export interface PatientLookupCriteria {
  fullName?: string;
  nik?: string;
  bpjsNumber?: string;
  birthDate?: string;
  gender?: 'L' | 'P' | '';
  phone?: string;
  address?: string;
  mrNumber?: string;
}


export interface PatientMatchCandidate {
  patient: Patient;
  matchedFields: string[];
  score: number;
  exactIdentityMatch: boolean;
}


export function findMatchingPatients(
  patients: Patient[],
  criteria: PatientLookupCriteria
): PatientMatchCandidate[] {
  const nameQ = (criteria.fullName || '').trim().toLowerCase();
  const nikQ = (criteria.nik || '').replace(/\D/g, '');
  const bpjsQ = (criteria.bpjsNumber || '').trim().toLowerCase();
  const birthQ = (criteria.birthDate || '').trim();
  const genderQ = criteria.gender || '';
  const phoneQ = (criteria.phone || '').replace(/\D/g, '');
  const addressQ = (criteria.address || '').trim().toLowerCase();
  const mrQ = (criteria.mrNumber || '').trim().toLowerCase();

  const hasActiveQuery =
    nameQ.length >= 2 ||
    nikQ.length >= 3 ||
    bpjsQ.length >= 3 ||
    birthQ.length === 10 ||
    phoneQ.length >= 4 ||
    addressQ.length >= 3 ||
    mrQ.length >= 2;

  if (!hasActiveQuery) {
    return [];
  }

  const results: PatientMatchCandidate[] = [];

  for (const p of patients) {
    let score = 0;
    const matchedFields: string[] = [];
    let exactIdentityMatch = false;

    if (nikQ.length >= 3 && p.nik.includes(nikQ)) {
      if (p.nik === nikQ) {
        score += 100;
        exactIdentityMatch = true;
        matchedFields.push('NIK KTP (100% Sama)');
      } else {
        score += 45;
        matchedFields.push('NIK KTP');
      }
    }

    if (mrQ.length >= 2 && p.mrNumber.toLowerCase().includes(mrQ)) {
      if (p.mrNumber.toLowerCase() === mrQ) {
        score += 95;
        exactIdentityMatch = true;
        matchedFields.push('No. RM');
      } else {
        score += 40;
        matchedFields.push('No. RM');
      }
    }

    if (bpjsQ.length >= 3 && p.bpjsNumber.toLowerCase().includes(bpjsQ)) {
      if (p.bpjsNumber.toLowerCase() === bpjsQ) {
        score += 85;
        exactIdentityMatch = true;
        matchedFields.push('No. BPJS');
      } else {
        score += 35;
        matchedFields.push('No. BPJS');
      }
    }

    if (nameQ.length >= 2) {
      const pName = p.fullName.toLowerCase();
      if (pName === nameQ) {
        score += 70;
        matchedFields.push('Nama Lengkap');
      } else if (pName.includes(nameQ)) {
        score += 40;
        matchedFields.push('Nama');
      } else {
        const tokens = nameQ.split(/\s+/).filter((t) => t.length >= 2);
        const tokenHits = tokens.filter((t) => pName.includes(t));
        if (tokenHits.length > 0) {
          score += tokenHits.length * 18;
          matchedFields.push('Nama');
        }
      }
    }

    if (birthQ.length === 10 && p.birthDate === birthQ) {
      score += 35;
      matchedFields.push('Tgl Lahir');
    }

    if (phoneQ.length >= 4 && p.phone.replace(/\D/g, '').includes(phoneQ)) {
      score += 35;
      matchedFields.push('No. Telepon');
    }

    if (addressQ.length >= 3 && p.address.toLowerCase().includes(addressQ)) {
      score += 25;
      matchedFields.push('Alamat');
    }

    // Gender acts as a tie-breaker / confirmation bonus when other fields match
    if (score > 0 && genderQ && p.gender === genderQ) {
      score += 10;
      matchedFields.push(`Gender (${genderQ})`);
    }

    if (score > 0) {
      results.push({
        patient: p,
        matchedFields,
        score,
        exactIdentityMatch,
      });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}


export function getInvoiceOutstanding(invoice: InvoiceRecord): number {
  if (invoice.pricingStatus === 'PENDING' || invoice.status === 'LUNAS') return 0;
  const net = Math.max(0, invoice.subtotal - invoice.discountAmount - (invoice.depositAppliedAmount || 0));
  const billed = invoice.guarantor === 'BPJS_KESEHATAN'
    ? invoice.claimRequestedAmount ?? net
    : invoice.patientPayableAmount;
  return Number.isFinite(billed) ? Math.max(0, billed - (invoice.totalReceivedAmount || 0)) : 0;
}

export function calculateFinancialSummary(
  accountingEntries: AccountingEntry[],
  invoices: InvoiceRecord[]
): {
  totalRevenue: number;
  totalExpense: number;
  netProfit: number;
  profitMarginPercent: number;
  pendingBpjsClaims: number;
  unpaidPatientReceivables: number;
  revenueByCategory: Record<string, number>;
  expenseByCategory: Record<string, number>;
} {
  let totalRevenue = 0;
  let totalExpense = 0;
  const revenueByCategory: Record<string, number> = {};
  const expenseByCategory: Record<string, number> = {};

  for (const entry of accountingEntries) {
    if (entry.type === 'PENDAPATAN') {
      totalRevenue += entry.amount;
      revenueByCategory[entry.category] =
        (revenueByCategory[entry.category] || 0) + entry.amount;
    } else {
      totalExpense += entry.amount;
      expenseByCategory[entry.category] =
        (expenseByCategory[entry.category] || 0) + entry.amount;
    }
  }

  const netProfit = totalRevenue - totalExpense;
  const profitMarginPercent =
    totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 1000) / 10 : 0;

  const pendingBpjsClaims = invoices
    .filter((inv) => inv.status === 'KLAIM_DIAJUKAN' && inv.pricingStatus !== 'PENDING')
    .reduce((sum, inv) => sum + getInvoiceOutstanding(inv), 0);

  const unpaidPatientReceivables = invoices
    .filter((inv) => inv.status === 'BELUM_LUNAS' && inv.pricingStatus !== 'PENDING')
    .reduce(
      (sum, inv) =>
        sum +
        getInvoiceOutstanding(inv),
      0
    );

  return {
    totalRevenue,
    totalExpense,
    netProfit,
    profitMarginPercent,
    pendingBpjsClaims,
    unpaidPatientReceivables,
    revenueByCategory,
    expenseByCategory,
  };
}


export interface CashflowChartPoint {
  dateKey: string; // YYYY-MM-DD
  label: string; // MM-DD
  inflow: number;
  outflow: number;
  net: number;
  masuk: number;
  keluar: number;
  neto: number;
  masukDeltaPct: number;
  keluarDeltaPct: number;
  netoDeltaPct: number;
}


export function computePercentDelta(current: number, previous: number): number {
  if (previous === 0) {
    return current > 0 ? 100 : current < 0 ? -100 : 0;
  }
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}


export function formatPercentBadge(pct: number): string {
  const rounded = Math.round(pct * 10) / 10;
  const clean = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  if (rounded > 0) return `+${clean}%`;
  return `${clean}%`;
}


export interface SparklineMetrics {
  firstValue: number;
  latestValue: number;
  previousValue: number;
  minValue: number;
  maxValue: number;
  periodChangePercent: number;
  dailyChangePercent: number;
  pointDeltas: number[];
  formattedPeriodBadge: string;
  formattedDailyBadge: string;
  trend: 'UP' | 'DOWN' | 'FLAT';
}


export function calculateSparklineMetrics(values: number[]): SparklineMetrics {
  if (!values || values.length === 0) {
    return {
      firstValue: 0,
      latestValue: 0,
      previousValue: 0,
      minValue: 0,
      maxValue: 0,
      periodChangePercent: 0,
      dailyChangePercent: 0,
      pointDeltas: [],
      formattedPeriodBadge: '0%',
      formattedDailyBadge: '0%',
      trend: 'FLAT',
    };
  }

  const firstNonZero = values.find((v) => v !== 0) ?? values[0];
  const latestValue = values[values.length - 1];
  const previousValue = values.length >= 2 ? values[values.length - 2] : firstNonZero;
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);

  const periodChangePercent = computePercentDelta(latestValue, firstNonZero);
  const dailyChangePercent = computePercentDelta(latestValue, previousValue);

  const pointDeltas = values.map((val, idx) => {
    if (idx === 0) return 0;
    return computePercentDelta(val, values[idx - 1]);
  });

  const trend: 'UP' | 'DOWN' | 'FLAT' =
    periodChangePercent > 0.2 ? 'UP' : periodChangePercent < -0.2 ? 'DOWN' : 'FLAT';

  return {
    firstValue: firstNonZero,
    latestValue,
    previousValue,
    minValue,
    maxValue,
    periodChangePercent,
    dailyChangePercent,
    pointDeltas,
    formattedPeriodBadge: formatPercentBadge(periodChangePercent),
    formattedDailyBadge: formatPercentBadge(dailyChangePercent),
    trend,
  };
}


export function buildCashflowTimeSeries(
  accountingEntries: AccountingEntry[],
  daysCount = 12
): CashflowChartPoint[] {
  const byDate = new Map<string, { inflow: number; outflow: number }>();

  for (const entry of accountingEntries) {
    if (!entry.timestamp || !Number.isFinite(Date.parse(entry.timestamp))) continue;
    const dateKey = new Date(entry.timestamp).toISOString().slice(0, 10);
    const prev = byDate.get(dateKey) || { inflow: 0, outflow: 0 };
    if (entry.type === 'PENDAPATAN') {
      prev.inflow += entry.amount;
    } else {
      prev.outflow += entry.amount;
    }
    byDate.set(dateKey, prev);
  }

  const anchorStr = new Date().toISOString().slice(0, 10);
  const anchorDate = new Date(`${anchorStr}T00:00:00.000Z`);

  const points: CashflowChartPoint[] = [];
  for (let i = daysCount - 1; i >= 0; i--) {
    const d = new Date(anchorDate.getTime() - i * 24 * 60 * 60 * 1000);
    const dateKey = d.toISOString().slice(0, 10);
    const label = dateKey.slice(5); // MM-DD
    const bucket = byDate.get(dateKey) || { inflow: 0, outflow: 0 };
    const netVal = bucket.inflow - bucket.outflow;
    const prevPt = points.length > 0 ? points[points.length - 1] : null;

    points.push({
      dateKey,
      label,
      inflow: bucket.inflow,
      outflow: bucket.outflow,
      net: netVal,
      masuk: bucket.inflow,
      keluar: bucket.outflow,
      neto: netVal,
      masukDeltaPct: prevPt ? computePercentDelta(bucket.inflow, prevPt.masuk) : 0,
      keluarDeltaPct: prevPt ? computePercentDelta(bucket.outflow, prevPt.keluar) : 0,
      netoDeltaPct: prevPt ? computePercentDelta(netVal, prevPt.neto) : 0,
    });
  }

  return points;
}


export function formatRupiahDecimals(amount: number): string {
  const formatted = new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount || 0);
  return `Rp ${formatted}`;
}
