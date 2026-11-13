import {
  AccountingEntry,
  AuditLogEntry,
  BridgingLog,
  DoubleEntryJournal,
  EvidenceRegistryItem,
  Facility,
  InpatientBed,
  InvoiceRecord,
  LabOrder,
  MedicationInventory,
  MedicationStockMutation,
  ModuleKey,
  Patient,
  PharmacyOrder,
  PurchaseOrderPbf,
  RadiologyOrderRis,
  ReferralOrchestrationRecord,
  ServerConfig,
  SoapRecord,
  SuperuserFacilityConfigSnapshot,
  SurgicalScheduleIbs,
  UserAccount,
  UserRole,
  VisitQueueItem,
} from '../types/simrs';

const STORAGE_SERVER_URL_KEY = 'kael_desktop_server_api_url';
const STORAGE_SESSION_KEY = 'kael_desktop_active_session';

export interface StoredSession {
  token: string;
  user: UserAccount;
  activeFacility: Facility;
  accessibleFacilities: Facility[];
  expiresAt?: number;
  rememberMe?: boolean;
}

export interface WorkspacePayload {
  user: UserAccount;
  activeFacility: Facility;
  activeFacilityConfig?: SuperuserFacilityConfigSnapshot;
  facilityConfigHistory?: SuperuserFacilityConfigSnapshot[];
  evidenceRegistry?: EvidenceRegistryItem[];
  accessibleFacilities: Facility[];
  doctors: UserAccount[];
  patients: Patient[];
  visits: VisitQueueItem[];
  soapRecords: SoapRecord[];
  beds: InpatientBed[];
  medications: MedicationInventory[];
  medicationMutations?: MedicationStockMutation[];
  pharmacyOrders: PharmacyOrder[];
  purchaseOrders?: PurchaseOrderPbf[];
  labOrders: LabOrder[];
  radiologyOrders?: RadiologyOrderRis[];
  surgicalSchedules?: SurgicalScheduleIbs[];
  referrals?: ReferralOrchestrationRecord[];
  invoices: InvoiceRecord[];
  accountingEntries: AccountingEntry[];
  doubleEntryJournals?: DoubleEntryJournal[];
  bridgingLogs: BridgingLog[];
  auditLogs: AuditLogEntry[];
  allUsers: UserAccount[];
  allFacilities: Facility[];
  serverConfig: ServerConfig;
  multiFacilityFinance?: {
    accountingEntries: AccountingEntry[];
    invoices: InvoiceRecord[];
    visits: VisitQueueItem[];
  };
}

export function getConfiguredApiBaseUrl(): string {
  const saved = localStorage.getItem(STORAGE_SERVER_URL_KEY);
  if (saved && saved.trim()) {
    return saved.trim().replace(/\/+$/, '');
  }
  return (import.meta.env.VITE_DEFAULT_SERVER_URL || '/api').replace(/\/+$/, '');
}

export function setConfiguredApiBaseUrl(url: string): void {
  const clean = url.trim().replace(/\/+$/, '');
  localStorage.setItem(STORAGE_SERVER_URL_KEY, clean || '/api');
}

export function loadStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
      localStorage.removeItem(STORAGE_SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveStoredSession(session: StoredSession | null): void {
  if (!session) {
    localStorage.removeItem(STORAGE_SESSION_KEY);
    return;
  }
  const ttlMs = session.rememberMe ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const enriched: StoredSession = {
    ...session,
    expiresAt: session.expiresAt || Date.now() + ttlMs,
    rememberMe: Boolean(session.rememberMe),
  };
  localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(enriched));
}

async function requestJson<T>(
  endpoint: string,
  options: RequestInit = {},
  token?: string,
  facilityCode?: string
): Promise<T> {
  const baseUrl = getConfiguredApiBaseUrl();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (facilityCode) {
    headers['X-Kael-Facility'] = facilityCode;
  }

  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP Error ${response.status}`);
  }
  return data as T;
}

export const kaelApi = {
  fetchPublicFacilities: () =>
    requestJson<{
      serverNode: string;
      environment: string;
      serverTime: string;
      facilities: {
        code: string;
        name: string;
        type: Facility['type'];
        city: string;
        kemenkesCode: string;
        bpjsPcareCode: string;
      }[];
    }>('/public/facilities'),

  login: (payload: {
    username: string;
    password: string;
    facilityCode: string;
    rememberMe?: boolean;
  }) =>
    requestJson<StoredSession>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  switchFacility: (token: string, facilityCode: string) =>
    requestJson<{ activeFacility: Facility; accessibleFacilities: Facility[] }>(
      '/auth/switch-facility',
      {
        method: 'POST',
        body: JSON.stringify({ facilityCode }),
      },
      token,
      facilityCode
    ),

  fetchWorkspace: (token: string, facilityCode: string) =>
    requestJson<WorkspacePayload>('/workspace', { method: 'GET' }, token, facilityCode),

  createPatient: (token: string, facilityCode: string, payload: Partial<Patient>) =>
    requestJson<Patient>(
      '/patients',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
      facilityCode
    ),

  updatePatient: (
    token: string,
    facilityCode: string,
    patientId: string,
    payload: Partial<Patient>
  ) =>
    requestJson<Patient>(
      `/patients/${patientId}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      token,
      facilityCode
    ),

  createVisit: (
    token: string,
    facilityCode: string,
    payload: {
      patientId: string;
      polyclinic: string;
      doctorId: string;
      guarantor: VisitQueueItem['guarantor'];
      bpjsSepOrPcareNo?: string;
      chiefComplaint: string;
      vitals: VisitQueueItem['vitals'];
    }
  ) =>
    requestJson<VisitQueueItem>(
      '/visits',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
      facilityCode
    ),

  unifiedRegisterVisit: (
    token: string,
    facilityCode: string,
    payload: {
      patientId?: string;
      fullName: string;
      nik: string;
      bpjsNumber?: string;
      birthDate: string;
      gender: 'L' | 'P';
      bloodType?: Patient['bloodType'];
      rhesus?: '+' | '-';
      phone?: string;
      address?: string;
      allergies?: string[];
      chronicConditions?: string[];
      emergencyContactName?: string;
      emergencyContactPhone?: string;
      polyclinic: string;
      doctorId: string;
      guarantor: VisitQueueItem['guarantor'];
      bpjsSepOrPcareNo?: string;
      chiefComplaint: string;
      vitals: VisitQueueItem['vitals'];
    }
  ) =>
    requestJson<{ patient: Patient; visit: VisitQueueItem; isNewPatient: boolean }>(
      '/visits/unified-register',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
      facilityCode
    ),

  updateVisitStatus: (
    token: string,
    facilityCode: string,
    visitId: string,
    status: VisitQueueItem['status']
  ) =>
    requestJson<VisitQueueItem>(
      `/visits/${visitId}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      },
      token,
      facilityCode
    ),

  saveSoapRecord: (
    token: string,
    facilityCode: string,
    payload: Omit<
      SoapRecord,
      'id' | 'facilityCode' | 'recordedAt' | 'satusehatEncounterId' | 'syncedToSatusehat'
    >
  ) =>
    requestJson<{ soapRecord: SoapRecord; visit: VisitQueueItem; invoice: InvoiceRecord }>(
      '/soap',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
      facilityCode
    ),

  dispensePharmacyOrder: (
    token: string,
    facilityCode: string,
    orderId: string,
    pharmacistNotes?: string
  ) =>
    requestJson<PharmacyOrder>(
      `/pharmacy/${orderId}/dispense`,
      {
        method: 'POST',
        body: JSON.stringify({ pharmacistNotes }),
      },
      token,
      facilityCode
    ),

  restockMedication: (
    token: string,
    facilityCode: string,
    medicationId: string,
    payload: {
      batchNumber: string;
      expiryDate: string;
      quantity: number;
      supplierName?: string;
    }
  ) =>
    requestJson<MedicationInventory>(
      `/medications/${medicationId}/restock`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
      facilityCode
    ),

  stockOpnameMedication: (
    token: string,
    facilityCode: string,
    medicationId: string,
    payload: {
      batchNumber: string;
      actualStock: number;
      reason: string;
    }
  ) =>
    requestJson<MedicationInventory>(
      `/medications/${medicationId}/opname`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
      facilityCode
    ),

  batchStockOpname: (
    token: string,
    facilityCode: string,
    payload: {
      reason: string;
      items: { medicationId: string; batchNumber: string; actualStock: number }[];
    }
  ) =>
    requestJson<{ updatedCount: number; mutationsCreated: number }>(
      '/medications/batch-opname',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
      facilityCode
    ),

  directDispenseMedication: (
    token: string,
    facilityCode: string,
    medicationId: string,
    payload: {
      quantity: number;
      patientOrUnitName: string;
      notes?: string;
    }
  ) =>
    requestJson<MedicationInventory>(
      `/medications/${medicationId}/dispense-direct`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
      facilityCode
    ),

  createMedication: (
    token: string,
    facilityCode: string,
    payload: Partial<MedicationInventory> & {
      initialBatchNumber?: string;
      initialExpiryDate?: string;
      initialStock?: number;
    }
  ) =>
    requestJson<MedicationInventory>(
      '/medications',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
      facilityCode
    ),

  createLabOrder: (
    token: string,
    facilityCode: string,
    payload: {
      visitId: string;
      panelCodes: string[];
      clinicalNotes?: string;
    }
  ) =>
    requestJson<LabOrder>(
      '/lab',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
      facilityCode
    ),

  verifyLabOrder: (
    token: string,
    facilityCode: string,
    orderId: string,
    payload: {
      parameters: { code: string; value: number }[];
      clinicalNotes?: string;
    }
  ) =>
    requestJson<LabOrder>(
      `/lab/${orderId}/verify`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
      facilityCode
    ),

  payInvoice: (
    token: string,
    facilityCode: string,
    invoiceId: string,
    payload: {
      paymentMethod: InvoiceRecord['paymentMethod'];
      discountAmount?: number;
    }
  ) =>
    requestJson<InvoiceRecord>(
      `/invoices/${invoiceId}/pay`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
      facilityCode
    ),

  addInvoiceItem: (
    token: string,
    facilityCode: string,
    invoiceId: string,
    payload: {
      category: 'PENDAFTARAN' | 'KONSULTASI' | 'TINDAKAN' | 'FARMASI' | 'LABORATORIUM' | 'KAMAR_INAP';
      description: string;
      quantity: number;
      unitPrice: number;
    }
  ) =>
    requestJson<InvoiceRecord>(
      `/invoices/${invoiceId}/items`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
      facilityCode
    ),

  createAccountingEntry: (
    token: string,
    facilityCode: string,
    payload: {
      accountCode: string;
      accountName: string;
      type: 'PENDAPATAN' | 'PENGELUARAN';
      category: AccountingEntry['category'];
      description: string;
      amount: number;
      referenceId?: string;
    }
  ) =>
    requestJson<AccountingEntry>(
      '/accounting',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
      facilityCode
    ),

  reconcileFinanceClaim: (token: string, facilityCode: string, invoiceId: string) =>
    requestJson<{ invoice: InvoiceRecord; entry: AccountingEntry }>(
      '/finance/reconcile-claim',
      {
        method: 'POST',
        body: JSON.stringify({ invoiceId }),
      },
      token,
      facilityCode
    ),

  createBed: (token: string, facilityCode: string, payload: Partial<InpatientBed>) =>
    requestJson<InpatientBed>(
      '/beds',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
      facilityCode
    ),

  updateBedStatus: (
    token: string,
    facilityCode: string,
    bedId: string,
    payload: {
      status?: InpatientBed['status'];
      diagnosis?: string;
      attendingDoctor?: string;
    }
  ) =>
    requestJson<InpatientBed>(
      `/beds/${bedId}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      },
      token,
      facilityCode
    ),

  assignBed: (
    token: string,
    facilityCode: string,
    bedId: string,
    payload: {
      patientId: string;
      attendingDoctor: string;
      diagnosis: string;
    }
  ) =>
    requestJson<InpatientBed>(
      `/beds/${bedId}/assign`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
      facilityCode
    ),

  dischargeBed: (token: string, facilityCode: string, bedId: string) =>
    requestJson<InpatientBed>(
      `/beds/${bedId}/discharge`,
      {
        method: 'POST',
      },
      token,
      facilityCode
    ),

  triggerBridgingSync: (
    token: string,
    facilityCode: string,
    payload: {
      targetSystem: BridgingLog['targetSystem'];
      resourceType: string;
      patientName: string;
      payloadPreview?: Record<string, unknown>;
    }
  ) =>
    requestJson<BridgingLog>(
      '/bridging/sync',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
      facilityCode
    ),

  // Superuser Exclusive APIs
  superuserCreateUser: (
    token: string,
    facilityCode: string,
    payload: {
      username: string;
      password?: string;
      fullName: string;
      nipOrSip: string;
      email: string;
      role: UserRole;
      allowedFacilities: string[];
      customPrivileges?: ModuleKey[];
      specialization?: string;
      polyclinic?: string;
    }
  ) =>
    requestJson<UserAccount>(
      '/superuser/users',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
      facilityCode
    ),

  superuserUpdateUser: (
    token: string,
    facilityCode: string,
    userId: string,
    payload: Partial<UserAccount> & { newPassword?: string }
  ) =>
    requestJson<UserAccount>(
      `/superuser/users/${userId}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      token,
      facilityCode
    ),

  superuserSaveFacility: (token: string, facilityCode: string, payload: Partial<Facility>) =>
    requestJson<Facility>(
      '/superuser/facilities',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
      facilityCode
    ),

  superuserUpdateServerConfig: (
    token: string,
    facilityCode: string,
    payload: Partial<ServerConfig>
  ) =>
    requestJson<ServerConfig>(
      '/superuser/server-config',
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      token,
      facilityCode
    ),

  superuserPublishFacilityConfig: (
    token: string,
    facilityCode: string,
    targetFacilityCode: string,
    payload: Partial<SuperuserFacilityConfigSnapshot>
  ) =>
    requestJson<{
      activeConfig: SuperuserFacilityConfigSnapshot;
      history: SuperuserFacilityConfigSnapshot[];
    }>(
      `/superuser/facility-config/${targetFacilityCode}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      token,
      facilityCode
    ),

  superuserRollbackFacilityConfig: (
    token: string,
    facilityCode: string,
    targetFacilityCode: string,
    payload: { targetVersion: number; reason?: string }
  ) =>
    requestJson<{
      activeConfig: SuperuserFacilityConfigSnapshot;
      history: SuperuserFacilityConfigSnapshot[];
    }>(
      `/superuser/facility-config/${targetFacilityCode}/rollback`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
      facilityCode
    ),

  createPurchaseOrder: (
    token: string,
    facilityCode: string,
    payload: {
      supplierPbfName?: string;
      supplierName?: string;
      supplierInvoiceNo?: string;
      receiveImmediately?: boolean;
      dueDate?: string;
      invoicePbfNumber?: string;
      items: PurchaseOrderPbf['items'];
    }
  ) =>
    requestJson<{ purchaseOrder: PurchaseOrderPbf; journal: DoubleEntryJournal }>(
      '/procurement/po',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
      facilityCode
    ),

  createRadiologyOrder: (
    token: string,
    facilityCode: string,
    payload: Partial<RadiologyOrderRis>
  ) =>
    requestJson<RadiologyOrderRis>(
      '/radiology',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
      facilityCode
    ),

  createReferral: (
    token: string,
    facilityCode: string,
    payload: Partial<ReferralOrchestrationRecord>
  ) =>
    requestJson<ReferralOrchestrationRecord>(
      '/referrals',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
      facilityCode
    ),
};
