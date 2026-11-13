import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AccountingEventType,
  Facility,
  IdempotencyRecord,
  SoapRecord,
  UserAccount,
  VisitQueueItem,
} from '../types/simrs';
import {
  applyClinicalRecordMutationPermenkes24,
  buildDefaultFacilityConfigSnapshot,
  buildIdempotencyScopeKey,
  calculateMeowsScore,
  calculateNews2Score,
  calculatePewsScore,
  calculateVersionedHospitalMetrics,
  calculateVersionedKbkMetrics,
  computeErpCompleteFinancialAnalysis,
  createDoubleEntryJournalForEvent,
  evaluateAtsTriage,
  evaluateIdempotencyCollision,
  evaluateSubCapabilityReadiness,
  resolveFacilityNavigation,
} from './platformEngine';

const mockClinicFacility: Facility = {
  code: 'KLINIK_JAMYLA',
  name: 'Klinik Pratama & Utama Jamyla',
  type: 'KLINIK_PRATAMA',
  tenantId: 'TENANT_KAEL',
  careLevel: 'FKTP',
  bpjsContractMode: 'CAPITATION_KBK',
  maxInpatientDaysLimit: 5,
  kemenkesCode: '320411902',
  bpjsPcareCode: '0114B089',
  satusehatOrgId: '100028491-JAMYLA',
  address: 'Jl. Kesehatan Raya No. 48',
  city: 'Kab. Bandung',
  phone: '022-87304112',
  serverNodeUrl: 'https://node-jamyla.kael-health.id',
  active: true,
  createdAt: '2025-01-10T00:00:00.000Z',
};

const mockHospitalFacility: Facility = {
  code: 'RSUD_MAJALAYA',
  name: 'RSUD Majalaya Kabupaten Bandung',
  type: 'RSUD',
  tenantId: 'TENANT_KAEL',
  careLevel: 'FKRTL',
  hospitalCapabilityTier: 'PARIPURNA',
  legacyHospitalClass: 'KELAS_B',
  bpjsContractMode: 'CASEMIX_INACBG',
  grouperVersion: 'INA_CBG_5_4',
  kemenkesCode: '3204016',
  bpjsPcareCode: '1018R004',
  satusehatOrgId: '100001942-MAJALAYA',
  address: 'Jl. Cipaku No. 87, Majalaya',
  city: 'Kab. Bandung',
  phone: '022-5950035',
  serverNodeUrl: 'https://node-rsudmajalaya.kael-health.id',
  active: true,
  createdAt: '2025-01-10T00:00:00.000Z',
};

test('TC-01 & TC-02: Capability Dependency Resolution (AND & OR dependencies) & Evidence Checks', () => {
  const clinicSnap = buildDefaultFacilityConfigSnapshot(mockClinicFacility);

  // SUB_CSSD_STERILIZATION requires SUB_PATIENT_MPI AND (SUB_SURGERY_IBS OR SUB_DELIVERY_PARTOGRAPH) AND evidence
  const cssdWithoutDeps = evaluateSubCapabilityReadiness(
    'SUB_CSSD_STERILIZATION',
    clinicSnap.enabledSubCapabilities,
    [],
    '2026-11-12'
  );
  assert.equal(cssdWithoutDeps.operationalReadiness, 'BLOCKED');
  assert.ok(cssdWithoutDeps.blockingReasons.length > 0);

  // Enabling SUB_DELIVERY_PARTOGRAPH (satisfies anyOf) + Third-Party MoU Evidence (satisfies CSSD calibration/MoU alternative)
  const cssdWithMouAndDelivery = evaluateSubCapabilityReadiness(
    'SUB_CSSD_STERILIZATION',
    [...clinicSnap.enabledSubCapabilities, 'SUB_DELIVERY_PARTOGRAPH', 'SUB_CSSD_STERILIZATION'],
    [
      {
        id: 'ev-01',
        facilityCode: 'KLINIK_JAMYLA',
        evidenceType: 'MOU_PIHAK_KETIGA',
        referenceNumber: 'MOU/CSSD/2026/001',
        holderOrVendorName: 'RSUD Majalaya Sentral Sterilisasi',
        relatedSubCapabilities: ['SUB_CSSD_STERILIZATION'],
        validFrom: '2026-01-01',
        validUntil: '2027-12-31',
        verificationStatus: 'VERIFIED_ACTIVE',
        verifiedBy: 'superuser',
      },
    ],
    '2026-11-12'
  );
  assert.equal(cssdWithMouAndDelivery.operationalReadiness, 'ACTIVE');
  assert.equal(cssdWithMouAndDelivery.blockingReasons.length, 0);

  // SUB_SURGERY_IBS fails if SUB_INPATIENT_BED_MGMT is missing
  const ibsWithoutInpatient = evaluateSubCapabilityReadiness(
    'SUB_SURGERY_IBS',
    ['SUB_PATIENT_MPI', 'SUB_CSSD_STERILIZATION'],
    [],
    '2026-11-12'
  );
  assert.equal(ibsWithoutInpatient.operationalReadiness, 'BLOCKED');
  assert.ok(ibsWithoutInpatient.missingAllOf.includes('SUB_INPATIENT_BED_MGMT'));
});

test('TC-03 & TC-04: 15-Domain Config Snapshot & Adaptive Navigation Separation (Clinic vs Hospital)', () => {
  const clinicConfig = buildDefaultFacilityConfigSnapshot(mockClinicFacility);
  const hospitalConfig = buildDefaultFacilityConfigSnapshot(mockHospitalFacility);

  assert.equal(clinicConfig.terminologyOverrides.outpatientUnitLabel, 'Ruang Praktik');
  assert.equal(hospitalConfig.terminologyOverrides.outpatientUnitLabel, 'Poliklinik');

  const ownerUser: Pick<UserAccount, 'role' | 'customPrivileges' | 'active' | 'facilityRoles'> = {
    role: 'OWNER',
    customPrivileges: [],
    active: true,
  };

  const clinicNav = resolveFacilityNavigation(clinicConfig, ownerUser, 'KLINIK_JAMYLA');
  const hospitalNav = resolveFacilityNavigation(hospitalConfig, ownerUser, 'RSUD_MAJALAYA');

  // Outpatient Clinic Pratama does not have Bedah Sentral or Radiologi RIS enabled by default
  assert.equal(clinicNav.some((item) => item.key === 'BEDAH_IBS'), false);
  assert.equal(clinicNav.some((item) => item.key === 'RADIOLOGI_RIS'), false);
  assert.equal(clinicNav.some((item) => item.key === 'PROLANIS_PRB'), true);

  // Hospital has Bedah IBS, Radiologi RIS, Penunjang RS, Neraca GL, Klaim BPJS Piutang, Jasa Medis Remun
  assert.equal(hospitalNav.some((item) => item.key === 'BEDAH_IBS'), true);
  assert.equal(hospitalNav.some((item) => item.key === 'RADIOLOGI_RIS'), true);
  assert.equal(hospitalNav.some((item) => item.key === 'PENUNJANG_RS'), true);
  assert.equal(hospitalNav.some((item) => item.key === 'NERACA_GL'), true);
  assert.equal(hospitalNav.some((item) => item.key === 'KLAIM_BPJS_PIUTANG'), true);
  assert.equal(hospitalNav.some((item) => item.key === 'JASA_MEDIS_REMUN'), true);
});

test('TC-05, TC-06 & TC-07: Official ATS 1-5 Triage & Population-Specific EWS (NEWS2, PEWS, MEOWS)', () => {
  const criticalVitals = {
    systolic: 70,
    diastolic: 45,
    heartRate: 148,
    respiratoryRate: 36,
    temperature: 39.4,
    spo2: 85,
    weightKg: 68,
    heightCm: 170,
    gcsEye: 2,
    gcsVerbal: 2,
    gcsMotor: 4,
    painScale: 8,
  };

  const ats = evaluateAtsTriage(criticalVitals);
  assert.equal(ats.atsCategory, 'ATS_1');
  assert.equal(ats.maxWaitMinutes, 0);
  assert.equal(ats.kemenkesColor, 'RESUSITASI_MERAH');

  const news2 = calculateNews2Score(criticalVitals);
  assert.equal(news2.protocol, 'NEWS2');
  assert.equal(news2.riskBand, 'TINGGI_KRITIS');
  assert.ok(news2.totalScore >= 7);

  const pews = calculatePewsScore(criticalVitals, 4);
  assert.equal(pews.protocol, 'PEWS');
  assert.equal(pews.riskBand, 'TINGGI_KRITIS');

  const meows = calculateMeowsScore({
    ...criticalVitals,
    systolic: 168,
    diastolic: 105,
  });
  assert.equal(meows.protocol, 'MEOWS');
  assert.equal(meows.riskBand, 'TINGGI_KRITIS');
});

test('TC-08, TC-09, TC-10 & TC-11: Permenkes No. 24 Tahun 2022 Pasal 30 Sign-Off, 48h Amendment & Addendum Rules, and SIP Expiry', () => {
  const signedAt = '2026-11-10T08:00:00.000Z';
  const baseSoap: SoapRecord = {
    id: 'soap-test-01',
    visitId: 'vis-01',
    facilityCode: 'KLINIK_JAMYLA',
    patientId: 'pat-01',
    doctorId: 'usr-doc-01',
    doctorName: 'dr. Hendra Wijaya, Sp.PD',
    recordedAt: signedAt,
    recordStatus: 'SIGNED_LOCKED',
    signedAt,
    signedBy: 'dr. Hendra Wijaya, Sp.PD',
    subjective: {
      chiefComplaint: 'Demam 3 hari',
      historyOfPresentIllness: 'Demam naik turun',
      pastMedicalHistory: 'Tidak ada',
      reviewOfSystems: 'Normal',
    },
    objective: {
      physicalExamGeneral: 'Compos Mentis',
      headToToeNotes: 'Normal',
      vitals: {
        systolic: 120,
        diastolic: 80,
        heartRate: 80,
        respiratoryRate: 18,
        temperature: 37.8,
        spo2: 99,
        weightKg: 65,
        heightCm: 170,
        gcsEye: 4,
        gcsVerbal: 5,
        gcsMotor: 6,
        painScale: 2,
      },
      odontogram: [],
    },
    assessment: {
      primaryIcd10Code: 'A90',
      primaryIcd10Name: 'Demam Dengue',
      secondaryIcd10: [],
      clinicalImpression: 'Observasi febris',
      prognosis: 'BONAM',
    },
    plan: {
      therapyNotes: 'Paracetamol 3x500mg',
      educationNotes: 'Minum air putih cukup',
      disposition: 'PULANG',
      sickLeaveDays: 2,
      procedures: [],
      prescriptions: [],
      labRequestedParams: [],
    },
    satusehatEncounterId: 'ENC-01',
    syncedToSatusehat: true,
    amendments: [],
  };

  const validActor = {
    id: 'usr-doc-01',
    fullName: 'dr. Hendra Wijaya, Sp.PD',
    role: 'DOKTER' as const,
    sipValidUntil: '2028-12-31',
  };

  // TC-08: Direct silent overwrite of SIGNED_LOCKED record without correctionReason is rejected (409)
  const silentEdit = applyClinicalRecordMutationPermenkes24({
    existingRecord: baseSoap,
    incomingPayload: {
      ...baseSoap,
      assessment: { ...baseSoap.assessment, primaryIcd10Code: 'A91' },
    },
    actor: validActor,
    nowIso: '2026-11-10T12:00:00.000Z',
  });
  assert.equal(silentEdit.allowed, false);
  assert.equal(silentEdit.errorStatus, 409);

  // TC-09: Amendment within 48 hours (+12h) with reason is allowed and preserves snapshot in amendments[]
  const validAmendment = applyClinicalRecordMutationPermenkes24({
    existingRecord: baseSoap,
    incomingPayload: {
      ...baseSoap,
      assessment: { ...baseSoap.assessment, primaryIcd10Code: 'A91', primaryIcd10Name: 'DBD Grade I' },
    },
    actor: validActor,
    correctionReason: 'Koreksi hasil trombosit laboratorium susulan',
    nowIso: '2026-11-10T20:00:00.000Z',
  });
  assert.equal(validAmendment.allowed, true);
  assert.equal(validAmendment.updatedRecord?.recordStatus, 'AMENDED_WITHIN_48H');
  assert.equal(validAmendment.updatedRecord?.amendments?.length, 1);

  // TC-10: Past 48 hours (+74h), mutation without supervisor co-sign is rejected (403); with co-sign it appends Addendum without overwriting original assessment
  const lateWithoutCoSign = applyClinicalRecordMutationPermenkes24({
    existingRecord: baseSoap,
    incomingPayload: {
      ...baseSoap,
      assessment: { ...baseSoap.assessment, primaryIcd10Code: 'A91' },
    },
    actor: validActor,
    correctionReason: 'Perubahan setelah 3 hari',
    nowIso: '2026-11-13T10:00:00.000Z',
  });
  assert.equal(lateWithoutCoSign.allowed, false);
  assert.equal(lateWithoutCoSign.errorStatus, 403);

  const validAddendum = applyClinicalRecordMutationPermenkes24({
    existingRecord: baseSoap,
    incomingPayload: {
      ...baseSoap,
      assessment: { ...baseSoap.assessment, primaryIcd10Code: 'A91' },
    },
    actor: validActor,
    correctionReason: 'Addendum hasil kultur darah hari ke-4 steril',
    coSignedBySupervisor: 'dr. Raka Pradipta, MARS (Komite Medik)',
    nowIso: '2026-11-13T10:00:00.000Z',
  });
  assert.equal(validAddendum.allowed, true);
  assert.equal(validAddendum.updatedRecord?.recordStatus, 'ADDENDUM_APPENDED');
  // Original primaryIcd10Code ('A90') remains intact while addendum is recorded
  assert.equal(validAddendum.updatedRecord?.assessment.primaryIcd10Code, 'A90');
  assert.equal(validAddendum.updatedRecord?.amendments?.[0]?.amendmentType, 'CO_SIGNED_ADDENDUM');

  // TC-11: Expired SIP is rejected with 403
  const expiredSipAttempt = applyClinicalRecordMutationPermenkes24({
    existingRecord: null,
    incomingPayload: baseSoap,
    actor: {
      ...validActor,
      sipValidUntil: '2024-05-01',
    },
    nowIso: '2026-11-11T08:00:00.000Z',
  });
  assert.equal(expiredSipAttempt.allowed, false);
  assert.equal(expiredSipAttempt.errorStatus, 403);
});

test('TC-12 & TC-13: Composite Idempotency Key (tenantId:operationType:clientRequestId) & Payload Conflict 409', () => {
  const scopeKey = buildIdempotencyScopeKey('TENANT_KAEL', 'CASHIER_PAY', 'req-12345');
  assert.equal(scopeKey, 'TENANT_KAEL:CASHIER_PAY:req-12345');

  const existingRecord: IdempotencyRecord = {
    scopeKey,
    tenantId: 'TENANT_KAEL',
    facilityCode: 'KLINIK_JAMYLA',
    operationType: 'CASHIER_PAY',
    clientRequestId: 'req-12345',
    requestPayloadSha256: 'sha256-payload-a',
    httpStatus: 200,
    responseSnapshot: { status: 'LUNAS' },
    createdAt: '2026-11-11T08:00:00.000Z',
  };

  // Identical payload replays cached response
  const replay = evaluateIdempotencyCollision(existingRecord, 'sha256-payload-a');
  assert.equal(replay.decision, 'RETURN_CACHED_RESPONSE');
  assert.equal(replay.httpStatus, 200);

  // Mutated payload with same clientRequestId returns REJECT_CONFLICT (HTTP 409)
  const conflict = evaluateIdempotencyCollision(existingRecord, 'sha256-payload-b');
  assert.equal(conflict.decision, 'REJECT_CONFLICT');
  assert.equal(conflict.httpStatus, 409);
});

test('TC-15 to TC-21: 10-Event Double-Entry Accounting Engine (Total Debit === Total Credit)', () => {
  const events: { eventType: AccountingEventType; amount: number; secondaryAmount?: number; vatCreditable?: boolean }[] = [
    { eventType: 'DEPOSIT_RECEIVED', amount: 1_500_000 },
    { eventType: 'SERVICE_COMPLETED_INVOICE_ISSUED', amount: 450_000 },
    { eventType: 'MEDICAL_FEE_ACCRUED', amount: 180_000, secondaryAmount: 9_000 },
    { eventType: 'MEDICATION_DISPENSED_COGS', amount: 85_000 },
    { eventType: 'INVENTORY_RECEIVED_PBF', amount: 2_000_000, secondaryAmount: 220_000, vatCreditable: false },
    { eventType: 'PAYMENT_RECEIVED_CASH', amount: 450_000 },
    { eventType: 'CLAIM_APPROVED_SETTLED', amount: 3_200_000, secondaryAmount: 3_450_000 },
    { eventType: 'CLAIM_REJECTED_WRITEOFF', amount: 275_000 },
    { eventType: 'REFUND_APPROVED', amount: 150_000 },
    { eventType: 'INVENTORY_RETURNED', amount: 60_000 },
  ];

  for (const evt of events) {
    const journal = createDoubleEntryJournalForEvent({
      tenantId: 'TENANT_KAEL',
      facilityCode: 'RSUD_MAJALAYA',
      eventType: evt.eventType,
      sourceTransactionId: `TX-${evt.eventType}`,
      description: `Jurnal uji ${evt.eventType}`,
      amount: evt.amount,
      secondaryAmount: evt.secondaryAmount,
      vatCreditable: evt.vatCreditable,
      costCenterCode: 'CC-RJ-PD',
      actorName: 'Budi Santoso, S.E.',
    });
    assert.equal(
      journal.isBalanced,
      true,
      `Event ${evt.eventType} must be balanced: debit=${journal.totalDebit} credit=${journal.totalCredit}`
    );
    assert.equal(journal.totalDebit, journal.totalCredit);
    assert.ok(journal.totalDebit > 0);
  }
});

test('TC-22, TC-23 & TC-25: Versioned KBK FKTP Metrics, Hospital Barber-Johnson Metrics, and Balanced Sheet (Neraca)', () => {
  const sampleVisits: VisitQueueItem[] = [
    {
      id: 'v1',
      facilityCode: 'KLINIK_JAMYLA',
      queueNumber: 'PD-001',
      registrationNumber: 'REG-001',
      patientId: 'p1',
      patientName: 'Pasien 1',
      mrNumber: 'RM-01',
      nik: '3204000000000001',
      gender: 'L',
      birthDate: '1980-01-01',
      polyclinic: 'POLI_PENYAKIT_DALAM',
      doctorId: 'd1',
      doctorName: 'dr. Hendra',
      guarantor: 'BPJS_KESEHATAN',
      triageLevel: 'URGENSI_HIJAU',
      status: 'SELESAI',
      vitals: {
        systolic: 125,
        diastolic: 80,
        heartRate: 78,
        respiratoryRate: 18,
        temperature: 36.6,
        spo2: 99,
        weightKg: 65,
        heightCm: 168,
        gcsEye: 4,
        gcsVerbal: 5,
        gcsMotor: 6,
        painScale: 1,
      },
      chiefComplaint: 'Kontrol Hipertensi Terkendali',
      createdAt: '2026-11-11T08:00:00.000Z',
      updatedAt: '2026-11-11T08:30:00.000Z',
    },
  ];

  const kbk = calculateVersionedKbkMetrics({
    patients: [],
    visits: sampleVisits,
    soapRecords: [],
    referrals: [],
    registeredParticipants: 1000,
  });
  assert.equal(kbk.formulaVersion, 'KEMENKES_BPJS_2026_V1');
  assert.equal(kbk.rrnsPercent, 0);

  const hospMetrics = calculateVersionedHospitalMetrics({
    beds: [
      {
        id: 'b1',
        facilityCode: 'RSUD_MAJALAYA',
        wardName: 'Cempaka',
        roomNumber: '101',
        bedCode: 'B1',
        bedClass: 'KELAS_1',
        dailyRate: 350000,
        status: 'TERISI',
      },
      {
        id: 'b2',
        facilityCode: 'RSUD_MAJALAYA',
        wardName: 'Cempaka',
        roomNumber: '102',
        bedCode: 'B2',
        bedClass: 'KELAS_1',
        dailyRate: 350000,
        status: 'TERSEDIA',
      },
      {
        id: 'b3',
        facilityCode: 'RSUD_MAJALAYA',
        wardName: 'IGD Observasi',
        roomNumber: 'OBS-1',
        bedCode: 'OBS1',
        bedClass: 'IGD_OBS',
        dailyRate: 150000,
        status: 'TERISI',
      },
    ],
    visits: sampleVisits,
    periodDays: 30,
  });
  assert.equal(hospMetrics.formulaVersion, 'SIRS_KEMENKES_2026_V1');
  // IGD_OBS bed must be excluded from inpatient BOR denominator
  assert.equal(hospMetrics.availableBeds, 2);
  assert.equal(hospMetrics.excludedObservationBeds, 1);
  assert.ok(hospMetrics.borPercent > 0 && hospMetrics.borPercent <= 100);

  const erpAnalysis = computeErpCompleteFinancialAnalysis({
    accountingEntries: [
      {
        id: 'acc-1',
        facilityCode: 'RSUD_MAJALAYA',
        entryNumber: 'JRN-01',
        timestamp: '2026-11-11T08:00:00.000Z',
        accountCode: '4-1000',
        accountName: 'Pendapatan Layanan',
        type: 'PENDAPATAN',
        category: 'LAYANAN_MEDIS',
        description: 'Pendapatan Rawat Jalan',
        amount: 5000000,
        referenceId: 'INV-01',
      },
    ],
    invoices: [],
    medications: [],
    medicationMutations: [],
    purchaseOrders: [],
  });
  assert.equal(erpAnalysis.balanceSheet.isBalanced, true);
  assert.equal(
    erpAnalysis.balanceSheet.totalAssets,
    erpAnalysis.balanceSheet.totalLiabilities + erpAnalysis.balanceSheet.totalEquity
  );
});
