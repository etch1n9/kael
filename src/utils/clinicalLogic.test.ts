import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateFEFOStock,
  calculateBMI,
  calculateFinancialSummary,
  calculateGCS,
  calculateInvoiceTotals,
  calculateMAP,
  calculateSparklineMetrics,
  canUserAccessFacility,
  canUserAccessModule,
  checkClinicalSafetyAlerts,
  evaluateAutoTriage,
  evaluateLabFlag,
  findMatchingPatients,
  normalizeFacilityCode,
} from './clinicalLogic';
import { MedicationInventory, Patient, VitalSigns } from '../types/simrs';
import { buildPdfBinaryFromJpegDataUrls } from './exportDocument';

test('normalizeFacilityCode standardizes clinic and hospital codes', () => {
  assert.equal(normalizeFacilityCode(' klinik jamyla '), 'KLINIK_JAMYLA');
  assert.equal(normalizeFacilityCode('rsud-majalaya'), 'RSUD_MAJALAYA');
});

test('canUserAccessFacility enforces SUPERUSER full access and OWNER multi-facility access', () => {
  const superuser = {
    role: 'SUPERUSER' as const,
    allowedFacilities: ['*'],
    active: true,
  };
  assert.equal(canUserAccessFacility(superuser, 'KLINIK_JAMYLA'), true);
  assert.equal(canUserAccessFacility(superuser, 'RSUD_MAJALAYA'), true);
  assert.equal(canUserAccessFacility(superuser, 'RS_BARU_APAPUN'), true);

  const owner = {
    role: 'OWNER' as const,
    allowedFacilities: ['KLINIK_JAMYLA', 'RSUD_MAJALAYA'],
    active: true,
  };
  assert.equal(canUserAccessFacility(owner, 'KLINIK_JAMYLA'), true);
  assert.equal(canUserAccessFacility(owner, 'RSUD_MAJALAYA'), true);
  assert.equal(canUserAccessFacility(owner, 'KLINIK_LAIN'), false);
});

test('canUserAccessModule restricts SUPERUSER_CONTROL to SUPERUSER, KEUANGAN_OWNER to OWNER/SUPERUSER/MANAJER_KLINIK, and supports PERAWAT/BIDAN/HRD_SDM', () => {
  assert.equal(
    canUserAccessModule(
      { role: 'SUPERUSER', customPrivileges: [], active: true },
      'SUPERUSER_CONTROL'
    ),
    true
  );
  assert.equal(
    canUserAccessModule(
      { role: 'OWNER', customPrivileges: ['SUPERUSER_CONTROL'], active: true },
      'SUPERUSER_CONTROL'
    ),
    false
  );
  assert.equal(
    canUserAccessModule(
      { role: 'SUPERUSER', customPrivileges: [], active: true },
      'KEUANGAN_OWNER'
    ),
    true
  );
  assert.equal(
    canUserAccessModule(
      { role: 'OWNER', customPrivileges: [], active: true },
      'KEUANGAN_OWNER'
    ),
    true
  );
  assert.equal(
    canUserAccessModule(
      { role: 'MANAJER_KLINIK', customPrivileges: [], active: true },
      'KEUANGAN_OWNER'
    ),
    true
  );
  assert.equal(
    canUserAccessModule(
      { role: 'PERAWAT', customPrivileges: [], active: true },
      'RME_DOKTER'
    ),
    true
  );
  assert.equal(
    canUserAccessModule(
      { role: 'BIDAN', customPrivileges: [], active: true },
      'SEMUA_PASIEN'
    ),
    true
  );
  assert.equal(
    canUserAccessModule(
      { role: 'HRD_SDM', customPrivileges: [], active: true },
      'SDM_ERP'
    ),
    true
  );
  assert.equal(
    canUserAccessModule(
      { role: 'KASIR', customPrivileges: [], active: true },
      'KEUANGAN_OWNER'
    ),
    false
  );
  assert.equal(
    canUserAccessModule(
      { role: 'DOKTER', customPrivileges: [], active: true },
      'KEUANGAN_OWNER'
    ),
    false
  );
});

test('calculateBMI and calculateMAP compute accurate clinical indices', () => {
  const res = calculateBMI(70, 170);
  assert.equal(res.bmi, 24.2);
  assert.equal(res.category, 'NORMAL');

  const map = calculateMAP(120, 80);
  assert.equal(map, 93);
  assert.equal(calculateGCS(4, 5, 6), 15);
});

test('evaluateAutoTriage classifies emergency red and normal white accurately', () => {
  const criticalVitals: VitalSigns = {
    systolic: 210,
    diastolic: 120,
    heartRate: 145,
    respiratoryRate: 32,
    temperature: 38.5,
    spo2: 88,
    weightKg: 68,
    heightCm: 168,
    gcsEye: 3,
    gcsVerbal: 4,
    gcsMotor: 5,
    painScale: 8,
  };
  assert.equal(evaluateAutoTriage(criticalVitals), 'RESUSITASI_MERAH');

  const normalVitals: VitalSigns = {
    systolic: 118,
    diastolic: 76,
    heartRate: 74,
    respiratoryRate: 18,
    temperature: 36.6,
    spo2: 99,
    weightKg: 65,
    heightCm: 170,
    gcsEye: 4,
    gcsVerbal: 5,
    gcsMotor: 6,
    painScale: 0,
  };
  assert.equal(evaluateAutoTriage(normalVitals), 'NON_URGEN_PUTIH');
});

test('allocateFEFOStock deducts from earliest expiring batch first', () => {
  const batches = [
    { batchNumber: 'BATCH-LATE', expiryDate: '2027-12-01', stock: 50 },
    { batchNumber: 'BATCH-SOON', expiryDate: '2026-12-15', stock: 10 },
  ];
  const result = allocateFEFOStock(batches, 15);
  assert.equal(result.success, true);
  assert.equal(result.allocations.length, 2);
  assert.deepEqual(result.allocations[0], { batchNumber: 'BATCH-SOON', quantity: 10 });
  assert.deepEqual(result.allocations[1], { batchNumber: 'BATCH-LATE', quantity: 5 });
});

test('checkClinicalSafetyAlerts detects allergy and drug-drug interactions', () => {
  const inventory: MedicationInventory[] = [
    {
      id: 'med-1',
      facilityCode: 'KLINIK_JAMYLA',
      code: 'AMX-500',
      kfaCode: '9300101',
      name: 'Amoxicillin 500mg',
      genericName: 'Amoxicillin Trihydrate',
      category: 'OBAT_KERAS',
      form: 'KAPLET' as 'TABLET',
      unit: 'Kaplet',
      minStock: 50,
      buyPrice: 800,
      sellPrice: 1500,
      contraindications: ['penisilin', 'amoxicillin', 'beta-laktam'],
      interactions: ['methotrexate', 'warfarin'],
      batches: [{ batchNumber: 'B1', expiryDate: '2027-05-01', stock: 100 }],
    },
    {
      id: 'med-2',
      facilityCode: 'KLINIK_JAMYLA',
      code: 'WRF-2',
      kfaCode: '9300202',
      name: 'Warfarin 2mg',
      genericName: 'Warfarin Sodium',
      category: 'OBAT_KERAS',
      form: 'TABLET',
      unit: 'Tablet',
      minStock: 20,
      buyPrice: 2000,
      sellPrice: 3500,
      contraindications: ['perdarahan aktif'],
      interactions: ['amoxicillin', 'aspirin'],
      batches: [{ batchNumber: 'B2', expiryDate: '2027-08-01', stock: 40 }],
    },
  ];

  const safety = checkClinicalSafetyAlerts(
    [
      {
        medicationId: 'med-1',
        medicationCode: 'AMX-500',
        medicationName: 'Amoxicillin 500mg',
        dosage: '500mg',
        signa: '3x1',
        quantity: 10,
        unit: 'Kaplet',
        unitPrice: 1500,
      },
      {
        medicationId: 'med-2',
        medicationCode: 'WRF-2',
        medicationName: 'Warfarin 2mg',
        dosage: '2mg',
        signa: '1x1',
        quantity: 10,
        unit: 'Tablet',
        unitPrice: 3500,
      },
    ],
    inventory,
    ['Penisilin']
  );

  assert.equal(safety.allergyConflicts.length, 1);
  assert.equal(safety.drugInteractions.length, 1);
  assert.equal(safety.stockShortfalls.length, 0);
});

test('evaluateLabFlag and calculateInvoiceTotals handle BPJS and Umum accurately', () => {
  assert.equal(evaluateLabFlag(6.2, 12.5, 16.5, 7.0, 20.0), 'CRITICAL_LOW');
  assert.equal(evaluateLabFlag(14.0, 12.5, 16.5, 7.0, 20.0), 'NORMAL');

  const bpjsInvoice = calculateInvoiceTotals(
    [{ id: '1', category: 'KONSULTASI', description: 'Konsultasi', quantity: 1, unitPrice: 75000, subtotal: 75000 }],
    'BPJS_KESEHATAN'
  );
  assert.equal(bpjsInvoice.bpjsCoveredAmount, 75000);
  assert.equal(bpjsInvoice.patientPayableAmount, 0);
});

test('findMatchingPatients matches across name, NIK, address, birthDate, and gender', () => {
  const samplePatients: Patient[] = [
    {
      id: 'pat-1',
      facilityCode: 'KLINIK_JAMYLA',
      mrNumber: 'RM-KJ-001041',
      nik: '3204125403880001',
      bpjsNumber: '0001829340112',
      ihsNumber: 'P10029381920',
      fullName: 'Ny. Siti Aminah Putri',
      birthDate: '1988-03-14',
      gender: 'P',
      bloodType: 'O',
      rhesus: '+',
      phone: '081223344556',
      address: 'Jl. Raya Laswi No. 48, Majalaya',
      allergies: ['Penisilin'],
      chronicConditions: ['Hipertensi'],
      emergencyContactName: 'Bpk. Ridwan',
      emergencyContactPhone: '081223344557',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'pat-2',
      facilityCode: 'KLINIK_JAMYLA',
      mrNumber: 'RM-KJ-001042',
      nik: '3204120911790004',
      bpjsNumber: '0001829340998',
      ihsNumber: 'P10029381929',
      fullName: 'Bpk. Ahmad Suryadi',
      birthDate: '1979-11-09',
      gender: 'L',
      bloodType: 'A',
      rhesus: '+',
      phone: '081399887766',
      address: 'Komp. Baleendah Permai Blok C2',
      allergies: [],
      chronicConditions: [],
      emergencyContactName: 'Ny. Dewi',
      emergencyContactPhone: '081399887700',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  const byName = findMatchingPatients(samplePatients, { fullName: 'Siti Aminah' });
  assert.equal(byName.length, 1);
  assert.equal(byName[0].patient.id, 'pat-1');

  const byAddressAndBirth = findMatchingPatients(samplePatients, {
    address: 'Baleendah',
    birthDate: '1979-11-09',
    gender: 'L',
  });
  assert.equal(byAddressAndBirth.length, 1);
  assert.equal(byAddressAndBirth[0].patient.id, 'pat-2');
  assert.equal(byAddressAndBirth[0].matchedFields.includes('Alamat'), true);
  assert.equal(byAddressAndBirth[0].matchedFields.includes('Tgl Lahir'), true);
});

test('calculateFinancialSummary aggregates revenue, expense, margin, and pending claims', () => {
  const summary = calculateFinancialSummary(
    [
      {
        id: 'acc-1',
        facilityCode: 'KLINIK_JAMYLA',
        entryNumber: 'JRN-1',
        timestamp: '2026-11-11T08:00:00Z',
        accountCode: '4-1000',
        accountName: 'Pendapatan Medis',
        type: 'PENDAPATAN',
        category: 'LAYANAN_MEDIS',
        description: 'Tagihan Pasien',
        amount: 1000000,
        referenceId: 'INV-1',
      },
      {
        id: 'acc-2',
        facilityCode: 'KLINIK_JAMYLA',
        entryNumber: 'JRN-2',
        timestamp: '2026-11-11T09:00:00Z',
        accountCode: '5-2010',
        accountName: 'Beban Obat',
        type: 'PENGELUARAN',
        category: 'PENGADAAN_OBAT',
        description: 'Beli Obat PBF',
        amount: 400000,
        referenceId: 'BATCH-1',
      },
    ],
    [
      {
        id: 'inv-1',
        facilityCode: 'KLINIK_JAMYLA',
        invoiceNumber: 'INV/001',
        visitId: 'vis-1',
        patientId: 'pat-1',
        patientName: 'Siti',
        mrNumber: 'RM-1',
        guarantor: 'BPJS_KESEHATAN',
        items: [],
        subtotal: 250000,
        discountAmount: 0,
        bpjsCoveredAmount: 250000,
        patientPayableAmount: 0,
        paymentMethod: 'KLAIM_BPJS',
        status: 'KLAIM_DIAJUKAN',
        createdAt: '2026-11-11T08:00:00Z',
      },
    ]
  );

  assert.equal(summary.totalRevenue, 1000000);
  assert.equal(summary.totalExpense, 400000);
  assert.equal(summary.netProfit, 600000);
  assert.equal(summary.profitMarginPercent, 60);
  assert.equal(summary.pendingBpjsClaims, 250000);
});

test('calculateSparklineMetrics computes period and daily percentage badges accurately', () => {
  const metrics = calculateSparklineMetrics([1000000, 1200000, 1500000]);
  assert.equal(metrics.periodChangePercent, 50);
  assert.equal(metrics.dailyChangePercent, 25);
  assert.equal(metrics.formattedPeriodBadge, '+50%');
  assert.equal(metrics.formattedDailyBadge, '+25%');
  assert.equal(metrics.trend, 'UP');
  assert.deepEqual(metrics.pointDeltas, [0, 20, 25]);
});

test('buildPdfBinaryFromJpegDataUrls generates a valid PDF-1.4 binary with xref and EOF', () => {
  const sampleJpegDataUrl =
    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  const pdfBytes = buildPdfBinaryFromJpegDataUrls([
    { dataUrl: sampleJpegDataUrl, widthPx: 1684, heightPx: 1190 },
  ]);
  const text = new TextDecoder('latin1').decode(pdfBytes);
  assert.equal(text.startsWith('%PDF-1.4'), true);
  assert.equal(text.includes('/Subtype /Image /Width 1684 /Height 1190'), true);
  assert.equal(text.includes('/Filter /DCTDecode'), true);
  assert.equal(text.trimEnd().endsWith('%%EOF'), true);
});


