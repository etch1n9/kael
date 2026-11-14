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
  RoleDefinition,
  ServerConfig,
  SoapRecord,
  SuperuserFacilityConfigSnapshot,
  SurgicalScheduleIbs,
  UserAccount,
  UserRole,
  VisitQueueItem,
} from '../domain/simrs.ts';
import { defaultServerOrigin, normalizeServerOrigin, probeServerHealth } from './serverConnection';

const STORAGE_SESSION_KEY = 'kael_session';
const STORAGE_API_BASE_URL_KEY = 'kael_api_base_url';
const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const DEFAULT_API_BASE_URL = configuredApiBaseUrl && configuredApiBaseUrl !== '/api'
  ? configuredApiBaseUrl
  : `${defaultServerOrigin()}/api`;

// Keep the destination stable in this tab, including when another tab changes its settings.
let apiBaseUrl = (() => {
  try {
    const stored = localStorage.getItem(STORAGE_API_BASE_URL_KEY);
    return stored && !['/api', '/api/'].includes(stored) ? stored : DEFAULT_API_BASE_URL;
  } catch {
    return DEFAULT_API_BASE_URL;
  }
})();

function normalizeApiBaseUrl(value: string): string {
  return `${normalizeServerOrigin(value)}/api`;
}

export function getServerOrigin(): string {
  try {
    return normalizeServerOrigin(apiBaseUrl);
  } catch {
    return apiBaseUrl;
  }
}

export function getDefaultServerOrigin(): string {
  return normalizeServerOrigin(DEFAULT_API_BASE_URL);
}

export function getApiBaseUrl(): string {
  return apiBaseUrl;
}

function getResolvedApiBaseUrl(): string {
  return new URL(normalizeApiBaseUrl(apiBaseUrl), window.location.origin).href;
}

export function setApiBaseUrl(value: string): string {
  const normalized = normalizeApiBaseUrl(value);
  localStorage.setItem(STORAGE_API_BASE_URL_KEY, normalized);
  apiBaseUrl = normalized;
  saveStoredSession(null);
  return normalized;
}

export function resetApiBaseUrl(): string {
  localStorage.removeItem(STORAGE_API_BASE_URL_KEY);
  apiBaseUrl = DEFAULT_API_BASE_URL;
  saveStoredSession(null);
  return apiBaseUrl;
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export interface StoredSession {
  token: string;
  user: UserAccount;
  activeFacility: Facility | null;
  accessibleFacilities: Facility[];
  expiresAt?: number;
  rememberMe?: boolean;
  apiBaseUrl?: string;
}

export interface WorkspacePayload {
  dataAccess?: Record<string, boolean>;
  user: UserAccount;
  activeFacility: Facility | null;
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
  deletedUsers?: UserAccount[];
  allFacilities: Facility[];
  roles: RoleDefinition[];
  serverConfig: ServerConfig;
  multiFacilityFinance?: {
    accountingEntries: AccountingEntry[];
    invoices: InvoiceRecord[];
    visits: VisitQueueItem[];
  };
}

export function loadStoredSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_SESSION_KEY) || localStorage.getItem(STORAGE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    const currentApiBaseUrl = getResolvedApiBaseUrl();
    const sessionApiBaseUrl = parsed.apiBaseUrl || new URL('/api', window.location.origin).href;
    if (
      !parsed.token || !parsed.expiresAt || Date.now() >= parsed.expiresAt ||
      sessionApiBaseUrl !== currentApiBaseUrl
    ) {
      saveStoredSession(null);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveStoredSession(session: StoredSession | null): void {
  localStorage.removeItem(STORAGE_SESSION_KEY);
  sessionStorage.removeItem(STORAGE_SESSION_KEY);
  if (session) {
    const storage = session.rememberMe ? localStorage : sessionStorage;
    storage.setItem(STORAGE_SESSION_KEY, JSON.stringify({ ...session, apiBaseUrl: getResolvedApiBaseUrl() }));
  }
}

async function requestJson<T>(
  endpoint: string,
  options: RequestInit = {},
  token?: string,
  facilityCode?: string
): Promise<T> {
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

  const baseUrl = normalizeApiBaseUrl(apiBaseUrl);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${endpoint}`, {
      ...options,
      headers,
      credentials: 'omit',
      redirect: 'error',
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error('Server KAEL belum merespons setelah 30 detik. Periksa koneksi, lalu coba lagi.');
    }
    throw new Error('Server KAEL tidak dapat dihubungi. Periksa alamat dan jaringan, izin akses lokal browser, HTTPS, serta pengaturan origin client pada server.');
  }

  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const serverMessage = typeof data?.error === 'string' && data.error.trim() ? data.error : null;
    const fallback = response.status >= 500
      ? 'Server KAEL belum dapat melayani permintaan. Periksa alamat dan layanan server, lalu coba lagi.'
      : response.status === 404
        ? 'API KAEL tidak ditemukan pada alamat ini. Periksa alamat server yang digunakan.'
        : `Permintaan ke server KAEL gagal (HTTP ${response.status}). Coba lagi atau hubungi pengelola.`;
    throw new ApiError(serverMessage || fallback, response.status);
  }
  if (!data) throw new Error('Alamat ini tidak memberikan respons API KAEL yang valid. Periksa alamat server yang digunakan.');
  return data as T;
}

export const kaelApi = {
  logout: (token: string) => requestJson<void>('/auth/logout', { method: 'POST' }, token),

  fetchHealth: (signal?: AbortSignal) => probeServerHealth(getServerOrigin(), signal),

  login: (payload: {
    username: string;
    password: string;
    facilityCode?: string;
    rememberMe?: boolean;
  }) =>
    requestJson<StoredSession>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  switchFacility: (token: string, facilityCode: string) =>
    requestJson<{ activeFacility: Facility | null; accessibleFacilities: Facility[] }>(
      '/auth/switch-facility',
      {
        method: 'POST',
        body: JSON.stringify({ facilityCode }),
      },
      token,
      facilityCode
    ),

  fetchWorkspace: (token: string, facilityCode: string, signal?: AbortSignal) =>
    requestJson<WorkspacePayload>('/workspace', { method: 'GET', signal }, token, facilityCode),

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
    > & { correctionReason?: string }
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
      tariffs?: Record<string, number>;
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
      parameters: {
        code: string;
        value: number;
        refMin?: number | null;
        refMax?: number | null;
        referenceVerified?: boolean;
        referenceSource?: string;
        methodPopulation?: string;
      }[];
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

  updateInvoicePricing: (
    token: string,
    facilityCode: string,
    invoiceId: string,
    payload: { items: { category: InvoiceRecord['items'][number]['category']; description: string; quantity: number; unitPrice: number }[] }
  ) => requestJson<InvoiceRecord>(`/invoices/${encodeURIComponent(invoiceId)}/pricing`, {
    method: 'PUT', body: JSON.stringify(payload),
  }, token, facilityCode),

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

  reconcileFinanceClaim: (token: string, facilityCode: string, invoiceId: string, payload: { receivedAmount: number; paymentReference: string }) =>
    requestJson<{ invoice: InvoiceRecord; entry: AccountingEntry }>(
      '/finance/reconcile-claim',
      {
        method: 'POST',
        body: JSON.stringify({ invoiceId, ...payload }),
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
      isPractitioner?: boolean;
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

  superuserDeleteUser: (token: string, facilityCode: string, userId: string) =>
    requestJson<void>(`/superuser/users/${encodeURIComponent(userId)}`, { method: 'DELETE' }, token, facilityCode),

  superuserRestoreUser: (token: string, facilityCode: string, userId: string) =>
    requestJson<UserAccount>(`/superuser/users/${encodeURIComponent(userId)}/restore`, { method: 'POST' }, token, facilityCode),

  superuserCreateRole: (
    token: string,
    facilityCode: string,
    payload: { id?: string; name: string; modules: ModuleKey[]; active?: boolean }
  ) => requestJson<RoleDefinition>('/superuser/roles', {
    method: 'POST', body: JSON.stringify(payload),
  }, token, facilityCode),

  superuserUpdateRole: (
    token: string,
    facilityCode: string,
    roleId: string,
    payload: { name: string; modules?: ModuleKey[]; active?: boolean }
  ) => requestJson<RoleDefinition>(`/superuser/roles/${encodeURIComponent(roleId)}`, {
    method: 'PUT', body: JSON.stringify(payload),
  }, token, facilityCode),

  superuserDeleteRole: (token: string, facilityCode: string, roleId: string) =>
    requestJson<void>(`/superuser/roles/${encodeURIComponent(roleId)}`, { method: 'DELETE' }, token, facilityCode),

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

  superuserDeleteFacility: (token: string, facilityCode: string, targetFacilityCode: string) =>
    requestJson<void>(`/superuser/facilities/${encodeURIComponent(targetFacilityCode)}`, { method: 'DELETE' }, token, facilityCode),

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
      vatRatePct: number;
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
    payload: Partial<RadiologyOrderRis> & { tariff?: number }
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
