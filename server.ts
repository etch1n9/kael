import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import express, { NextFunction, Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import {
  createInitialDatabase,
  hashPassword,
  KaelDatabaseSchema,
} from './src/server/seedDatabase';
import {
  AccountingEntry,
  BillingLineItem,
  Facility,
  InpatientBed,
  InvoiceRecord,
  LabOrder,
  LabParameterResult,
  MedicationInventory,
  ModuleKey,
  Patient,
  PharmacyOrder,
  PurchaseOrderPbf,
  RadiologyOrderRis,
  ReferralOrchestrationRecord,
  SoapRecord,
  SuperuserFacilityConfigSnapshot,
  SurgicalScheduleIbs,
  UserAccount,
  UserRole,
  VisitQueueItem,
} from './src/types/simrs';
import {
  allocateFEFOStock,
  calculateInvoiceTotals,
  canUserAccessFacility,
  evaluateAutoTriage,
  evaluateLabFlag,
  LAB_PARAMETER_TEMPLATES,
  normalizeFacilityCode,
  ROLE_DEFAULT_MODULES,
} from './src/utils/clinicalLogic';
import {
  applyClinicalRecordMutationPermenkes24,
  buildDefaultFacilityConfigSnapshot,
  createDoubleEntryJournalForEvent,
  evaluateSubCapabilityReadiness,
  SKDI_4A_COMPETENCY_CODES,
} from './src/utils/platformEngine';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const DATA_FILE_PATH = path.resolve(
  process.cwd(),
  process.env.KAEL_DATA_FILE || './data/kael-storage.json'
);

function loadOrInitializeDatabase(): KaelDatabaseSchema {
  const freshSeed = createInitialDatabase(DATA_FILE_PATH);
  try {
    const dir = path.dirname(DATA_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(DATA_FILE_PATH)) {
      const raw = fs.readFileSync(DATA_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as KaelDatabaseSchema;
      if (parsed && Array.isArray(parsed.users) && Array.isArray(parsed.facilities)) {
        let modified = false;
        // Backfill regulatory fields on existing facilities
        for (const seedFac of freshSeed.facilities) {
          const existingFac = parsed.facilities.find((f) => f.code === seedFac.code);
          if (existingFac && !existingFac.careLevel) {
            Object.assign(existingFac, {
              tenantId: seedFac.tenantId,
              careLevel: seedFac.careLevel,
              hospitalCapabilityTier: seedFac.hospitalCapabilityTier,
              legacyHospitalClass: seedFac.legacyHospitalClass,
              bpjsContractMode: seedFac.bpjsContractMode,
              grouperVersion: seedFac.grouperVersion,
              maxInpatientDaysLimit: seedFac.maxInpatientDaysLimit,
              activeConfigVersion: existingFac.activeConfigVersion || 1,
            });
            modified = true;
          }
        }
        // Merge any new default users (e.g. perawat, bidan, manajer, radiolog, hrd)
        for (const seedUser of freshSeed.users) {
          const existing = parsed.users.find((u) => u.username === seedUser.username);
          if (!existing) {
            parsed.users.push(seedUser);
            modified = true;
          } else {
            if (seedUser.username === 'drg.nabila' && existing.role === 'DOKTER') {
              existing.role = 'DOKTER_GIGI';
              existing.customPrivileges = [...ROLE_DEFAULT_MODULES.DOKTER_GIGI];
              modified = true;
            }
            // Ensure expanded ROLE_DEFAULT_MODULES are merged into existing users
            const expandedDefaults = ROLE_DEFAULT_MODULES[existing.role] || [];
            const currentPrivs = new Set(existing.customPrivileges || []);
            let privAdded = false;
            for (const modKey of expandedDefaults) {
              if (!currentPrivs.has(modKey)) {
                currentPrivs.add(modKey);
                privAdded = true;
              }
            }
            if (privAdded) {
              existing.customPrivileges = Array.from(currentPrivs);
              modified = true;
            }
          }
        }
        // Merge 12-day historical cashflow entries if not present yet
        for (const seedAcc of freshSeed.accountingEntries) {
          const existingAcc = parsed.accountingEntries.find((a) => a.id === seedAcc.id);
          if (!existingAcc) {
            parsed.accountingEntries.push(seedAcc);
            modified = true;
          } else if (
            (seedAcc.id === 'acc-jm-01' || seedAcc.id === 'acc-jm-02') &&
            existingAcc.amount !== seedAcc.amount
          ) {
            existingAcc.amount = seedAcc.amount;
            existingAcc.description = seedAcc.description;
            modified = true;
          }
        }
        if (!Array.isArray(parsed.medicationMutations)) {
          parsed.medicationMutations = [...freshSeed.medicationMutations];
          modified = true;
        } else {
          for (const seedMut of freshSeed.medicationMutations) {
            if (!parsed.medicationMutations.some((m) => m.id === seedMut.id)) {
              parsed.medicationMutations.push(seedMut);
              modified = true;
            }
          }
        }
        if (!Array.isArray(parsed.facilityConfigs) || parsed.facilityConfigs.length === 0) {
          parsed.facilityConfigs = parsed.facilities.map((f) => buildDefaultFacilityConfigSnapshot(f));
          modified = true;
        }
        if (!Array.isArray(parsed.evidenceRegistry)) {
          parsed.evidenceRegistry = [...freshSeed.evidenceRegistry];
          modified = true;
        }
        if (!Array.isArray(parsed.purchaseOrders)) {
          parsed.purchaseOrders = [...freshSeed.purchaseOrders];
          modified = true;
        }
        if (!Array.isArray(parsed.radiologyOrders)) {
          parsed.radiologyOrders = [...freshSeed.radiologyOrders];
          modified = true;
        }
        if (!Array.isArray(parsed.surgicalSchedules)) {
          parsed.surgicalSchedules = [...freshSeed.surgicalSchedules];
          modified = true;
        }
        if (!Array.isArray(parsed.referrals)) {
          parsed.referrals = [...freshSeed.referrals];
          modified = true;
        }
        if (!Array.isArray(parsed.doubleEntryJournals)) {
          parsed.doubleEntryJournals = [...freshSeed.doubleEntryJournals];
          modified = true;
        }
        if (!Array.isArray(parsed.idempotencyRecords)) {
          parsed.idempotencyRecords = [];
          modified = true;
        }
        if (modified) {
          saveDatabase(parsed);
        }
        return parsed;
      }
    }
  } catch (err) {
    console.error('Failed to read existing KAEL storage file, initializing fresh DB:', err);
  }
  saveDatabase(freshSeed);
  return freshSeed;
}

function saveDatabase(db: KaelDatabaseSchema): void {
  try {
    const dir = path.dirname(DATA_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tempPath = `${DATA_FILE_PATH}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(db, null, 2), 'utf-8');
    fs.renameSync(tempPath, DATA_FILE_PATH);
  } catch (err) {
    console.error('Failed to persist KAEL database:', err);
  }
}

const db: KaelDatabaseSchema = loadOrInitializeDatabase();

const SESSION_HMAC_SECRET =
  process.env.KAEL_SESSION_SECRET || 'kael_simrs_enterprise_hmac_secret_2026';

interface ActiveSession {
  token: string;
  userId: string;
  username: string;
  role: UserRole;
  facilityCode: string;
  createdAt: number;
  expiresAt: number;
  rememberMe: boolean;
}

const sessions = new Map<string, ActiveSession>();

function createSignedSessionToken(payload: Omit<ActiveSession, 'token'>): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_HMAC_SECRET)
    .update(encoded)
    .digest('base64url');
  return `kael_v2.${encoded}.${sig}`;
}

function verifySignedSessionToken(token: string): ActiveSession | null {
  if (!token.startsWith('kael_v2.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_HMAC_SECRET)
    .update(encoded)
    .digest('base64url');
  if (sig !== expectedSig) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf-8')
    ) as Omit<ActiveSession, 'token'>;
    if (!parsed.expiresAt || Date.now() > parsed.expiresAt) {
      return null;
    }
    return { ...parsed, token };
  } catch {
    return null;
  }
}

function sanitizeUser(u: UserAccount & { passwordHash?: string }): UserAccount {
  const { passwordHash: _ignored, ...clean } = u;
  return clean;
}

function recordAudit(
  facilityCode: string,
  actorUsername: string,
  actorRole: UserRole,
  action: string,
  targetResource: string,
  details: string
) {
  db.auditLogs.unshift({
    id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    facilityCode,
    actorUsername,
    actorRole,
    action,
    targetResource,
    details,
  });
  if (db.auditLogs.length > 300) {
    db.auditLogs.length = 300;
  }
}

interface AuthenticatedRequest extends Request {
  sessionData?: ActiveSession;
  currentUser?: UserAccount & { passwordHash: string };
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'Sesi tidak valid atau telah berakhir. Silakan login kembali.' });
    return;
  }

  let session = sessions.get(token) || null;
  if (session && Date.now() > session.expiresAt) {
    sessions.delete(token);
    session = null;
  }
  if (!session) {
    const verified = verifySignedSessionToken(token);
    if (verified) {
      sessions.set(token, verified);
      session = verified;
    }
  }

  if (!session) {
    res.status(401).json({ error: 'Sesi tidak valid atau telah berakhir. Silakan login kembali.' });
    return;
  }

  const user = db.users.find((u) => u.id === session!.userId && u.active);
  if (!user) {
    sessions.delete(token);
    res.status(401).json({ error: 'Akun pengguna tidak aktif atau telah dicabut oleh Superuser.' });
    return;
  }
  const requestedFacility = req.headers['x-kael-facility']
    ? normalizeFacilityCode(String(req.headers['x-kael-facility']))
    : session.facilityCode;

  if (!canUserAccessFacility(user, requestedFacility)) {
    res.status(403).json({
      error: `Akses ditolak: Akun ${user.username} tidak memiliki otorisasi untuk fasilitas ${requestedFacility}.`,
    });
    return;
  }
  session.facilityCode = requestedFacility;
  req.sessionData = session;
  req.currentUser = user;
  next();
}

function requireSuperuser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.currentUser || req.currentUser.role !== 'SUPERUSER') {
    res.status(403).json({
      error: 'Akses ditolak: Operasi ini hanya diizinkan untuk role SUPERUSER (Full Privilege).',
    });
    return;
  }
  next();
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // 1. Public Server Handshake & Active Facility Discovery (Used by Linux Desktop Login window)
  app.get('/api/public/facilities', (_req: Request, res: Response) => {
    const activeFacilities = db.facilities.filter((f) => f.active);
    res.json({
      serverNode: db.serverConfig.nodeName,
      environment: db.serverConfig.environment,
      serverTime: new Date().toISOString(),
      facilities: activeFacilities.map((f) => ({
        code: f.code,
        name: f.name,
        type: f.type,
        city: f.city,
        kemenkesCode: f.kemenkesCode,
        bpjsPcareCode: f.bpjsPcareCode,
      })),
    });
  });

  // 2. Enterprise Multi-Facility Login (NO public sign-up allowed, 1-Day Default / 7-Day Remember Me)
  app.post('/api/auth/login', (req: Request, res: Response) => {
    const { username, password, facilityCode, rememberMe } = req.body as {
      username?: string;
      password?: string;
      facilityCode?: string;
      rememberMe?: boolean;
    };

    if (!username || !password || !facilityCode) {
      res.status(400).json({
        error: 'Username, Password, dan kode FASILITAS wajib diisi.',
      });
      return;
    }

    const normalizedFacility = normalizeFacilityCode(facilityCode);
    const facility = db.facilities.find((f) => f.code === normalizedFacility);
    if (!facility || !facility.active) {
      res.status(404).json({
        error: `Fasilitas "${normalizedFacility}" tidak ditemukan atau sedang dinonaktifkan di server.`,
      });
      return;
    }

    const user = db.users.find(
      (u) =>
        u.username.toLowerCase() === username.trim().toLowerCase() ||
        u.nipOrSip.toLowerCase() === username.trim().toLowerCase()
    );

    if (!user || !user.active) {
      res.status(401).json({
        error: 'Akun tidak ditemukan atau telah dinonaktifkan. Hubungi SUPERUSER untuk pendaftaran akun.',
      });
      return;
    }

    const hashedInput = hashPassword(password);
    if (user.passwordHash !== hashedInput) {
      res.status(401).json({
        error: 'Kredensial kata sandi tidak sesuai.',
      });
      return;
    }

    if (!canUserAccessFacility(user, normalizedFacility)) {
      res.status(403).json({
        error: `Akun "${user.username}" (${user.role}) tidak memiliki hak akses ke fasilitas ${normalizedFacility}. Fasilitas yang diizinkan: ${user.allowedFacilities.join(', ')}`,
      });
      return;
    }

    const isRememberMe = Boolean(rememberMe);
    const createdAt = Date.now();
    const sessionDurationMs = isRememberMe
      ? 7 * 24 * 60 * 60 * 1000 // 7 days when Remember Me is checked
      : 1 * 24 * 60 * 60 * 1000; // 1 day default
    const expiresAt = createdAt + sessionDurationMs;

    const sessionPayload = {
      userId: user.id,
      username: user.username,
      role: user.role,
      facilityCode: normalizedFacility,
      createdAt,
      expiresAt,
      rememberMe: isRememberMe,
    };

    const token = createSignedSessionToken(sessionPayload);
    user.lastLoginAt = new Date().toISOString();

    sessions.set(token, {
      token,
      ...sessionPayload,
    });

    recordAudit(
      normalizedFacility,
      user.username,
      user.role,
      'AUTH_LOGIN_SUCCESS',
      `FASILITAS:${normalizedFacility}`,
      `Login berhasil ke ${facility.name} (${normalizedFacility}) sebagai ${user.role} (Sesi: ${
        isRememberMe ? '7 Hari' : '1 Hari'
      }).`
    );
    saveDatabase(db);

    const accessibleFacilities = db.facilities.filter(
      (f) => f.active && canUserAccessFacility(user, f.code)
    );

    res.json({
      token,
      user: sanitizeUser(user),
      activeFacility: facility,
      accessibleFacilities,
      expiresAt,
      rememberMe: isRememberMe,
    });
  });

  // 3. Switch Active Facility for Multi-Facility Accounts (OWNER / SUPERUSER / Multi-Clinic Staff)
  app.post('/api/auth/switch-facility', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const { facilityCode } = req.body as { facilityCode?: string };
    const user = req.currentUser!;
    const targetCode = normalizeFacilityCode(facilityCode || '');
    const facility = db.facilities.find((f) => f.code === targetCode && f.active);

    if (!facility) {
      res.status(404).json({ error: `Fasilitas ${targetCode} tidak ditemukan.` });
      return;
    }
    if (!canUserAccessFacility(user, targetCode)) {
      res.status(403).json({
        error: `Anda tidak memiliki otorisasi untuk beralih ke fasilitas ${targetCode}.`,
      });
      return;
    }

    req.sessionData!.facilityCode = targetCode;
    recordAudit(
      targetCode,
      user.username,
      user.role,
      'SWITCH_FACILITY',
      `FASILITAS:${targetCode}`,
      `Beralih sesi kerja aktif ke fasilitas ${facility.name} (${targetCode}).`
    );
    saveDatabase(db);

    res.json({
      activeFacility: facility,
      accessibleFacilities: db.facilities.filter(
        (f) => f.active && canUserAccessFacility(user, f.code)
      ),
    });
  });

  // 4. Fetch Complete Scoped Workspace State for Active Facility
  app.get('/api/workspace', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = req.currentUser!;
    const fCode = req.sessionData!.facilityCode;
    const activeFacility = db.facilities.find((f) => f.code === fCode)!;
    const accessibleFacilities = db.facilities.filter(
      (f) => f.active && canUserAccessFacility(user, f.code)
    );

    const doctorsInFacility = db.users
      .filter(
        (u) =>
          u.active &&
          (u.role === 'DOKTER' || u.role === 'DOKTER_GIGI' || u.role === 'BIDAN') &&
          canUserAccessFacility(u, fCode)
      )
      .map((u) => sanitizeUser(u));

    const canViewMultiFinance =
      user.role === 'SUPERUSER' ||
      user.role === 'OWNER' ||
      user.role === 'MANAJER_KLINIK' ||
      user.role === 'HRD_SDM';
    const allowedCodes = new Set(accessibleFacilities.map((f) => f.code));

    // Active facility configuration snapshot (or build default if missing)
    const facilityHistoryConfigs = (db.facilityConfigs || []).filter(
      (cfg) => cfg.facilityCode === fCode
    );
    let activeFacilityConfig =
      facilityHistoryConfigs.find((cfg) => cfg.lifecycleStage === 'ACTIVE') ||
      facilityHistoryConfigs[0];
    if (!activeFacilityConfig) {
      activeFacilityConfig = buildDefaultFacilityConfigSnapshot(activeFacility);
      db.facilityConfigs = db.facilityConfigs || [];
      db.facilityConfigs.push(activeFacilityConfig);
      saveDatabase(db);
    }

    // Tenant/Facility-scoped users (P0-10 / AUD-04 fix: non-Superusers only see users in their accessible facilities)
    const scopedUsers =
      user.role === 'SUPERUSER'
        ? db.users.map(sanitizeUser)
        : db.users
            .filter((u) =>
              Array.from(allowedCodes).some((code) => canUserAccessFacility(u, code))
            )
            .map(sanitizeUser);

    res.json({
      user: sanitizeUser(user),
      activeFacility,
      activeFacilityConfig,
      facilityConfigHistory: facilityHistoryConfigs,
      evidenceRegistry: (db.evidenceRegistry || []).filter((ev) => ev.facilityCode === fCode),
      accessibleFacilities,
      doctors: doctorsInFacility,
      patients: db.patients.filter((p) => p.facilityCode === fCode),
      visits: db.visits.filter((v) => v.facilityCode === fCode),
      soapRecords: db.soapRecords.filter((s) => s.facilityCode === fCode),
      beds: db.beds.filter((b) => b.facilityCode === fCode),
      medications: db.medications.filter((m) => m.facilityCode === fCode),
      medicationMutations: (db.medicationMutations || []).filter(
        (mm) => mm.facilityCode === fCode
      ),
      pharmacyOrders: db.pharmacyOrders.filter((po) => po.facilityCode === fCode),
      purchaseOrders: (db.purchaseOrders || []).filter((po) => po.facilityCode === fCode),
      labOrders: db.labOrders.filter((lo) => lo.facilityCode === fCode),
      radiologyOrders: (db.radiologyOrders || []).filter((ro) => ro.facilityCode === fCode),
      surgicalSchedules: (db.surgicalSchedules || []).filter((ss) => ss.facilityCode === fCode),
      referrals: (db.referrals || []).filter(
        (r) => r.originFacilityCode === fCode || r.destinationFacilityCode === fCode
      ),
      invoices: db.invoices.filter((inv) => inv.facilityCode === fCode),
      accountingEntries: db.accountingEntries.filter((acc) => acc.facilityCode === fCode),
      doubleEntryJournals: (db.doubleEntryJournals || []).filter(
        (gl) => gl.facilityCode === fCode
      ),
      bridgingLogs: db.bridgingLogs.filter((bl) => bl.facilityCode === fCode),
      auditLogs:
        user.role === 'SUPERUSER'
          ? db.auditLogs
          : db.auditLogs.filter((al) => al.facilityCode === fCode),
      allUsers: scopedUsers,
      allFacilities: user.role === 'SUPERUSER' ? db.facilities : accessibleFacilities,
      serverConfig: db.serverConfig,
      multiFacilityFinance: canViewMultiFinance
        ? {
            accountingEntries: db.accountingEntries.filter((a) =>
              allowedCodes.has(a.facilityCode)
            ),
            invoices: db.invoices.filter((i) => allowedCodes.has(i.facilityCode)),
            visits: db.visits.filter((v) => allowedCodes.has(v.facilityCode)),
          }
        : undefined,
    });
  });

  // 5. Register or Update Patient in Master Patient Index (MPI)
  app.post('/api/patients', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const fCode = req.sessionData!.facilityCode;
    const user = req.currentUser!;
    const body = req.body as Partial<Patient>;

    if (!body.fullName || !body.nik || body.nik.trim().length < 16 || !body.birthDate) {
      res.status(400).json({
        error: 'Nama Lengkap, NIK (16 digit), dan Tanggal Lahir wajib diisi dengan benar.',
      });
      return;
    }

    const existingNik = db.patients.find(
      (p) => p.facilityCode === fCode && p.nik === body.nik!.trim()
    );
    if (existingNik) {
      res.status(409).json({
        error: `Pasien dengan NIK ${body.nik} sudah terdaftar di ${fCode} dengan No. RM ${existingNik.mrNumber}.`,
      });
      return;
    }

    const prefix = fCode.split('_').map((w) => w[0]).join('');
    const count = db.patients.filter((p) => p.facilityCode === fCode).length + 1045;
    const mrNumber = body.mrNumber?.trim() || `RM-${prefix}-${String(count).padStart(6, '0')}`;

    const newPatient: Patient = {
      id: `pat-${Date.now()}`,
      facilityCode: fCode,
      mrNumber,
      nik: body.nik.trim(),
      bpjsNumber: (body.bpjsNumber || '').trim(),
      ihsNumber: body.ihsNumber?.trim() || `P100${Math.floor(10000000 + Math.random() * 89999999)}`,
      fullName: body.fullName.trim(),
      birthDate: body.birthDate,
      gender: body.gender === 'P' ? 'P' : 'L',
      bloodType: body.bloodType || 'O',
      rhesus: body.rhesus === '-' ? '-' : '+',
      phone: (body.phone || '').trim(),
      address: (body.address || '').trim(),
      allergies: Array.isArray(body.allergies) ? body.allergies.filter(Boolean) : [],
      chronicConditions: Array.isArray(body.chronicConditions)
        ? body.chronicConditions.filter(Boolean)
        : [],
      emergencyContactName: (body.emergencyContactName || '').trim(),
      emergencyContactPhone: (body.emergencyContactPhone || '').trim(),
      createdAt: new Date().toISOString(),
    };

    db.patients.unshift(newPatient);
    recordAudit(
      fCode,
      user.username,
      user.role,
      'MPI_PATIENT_CREATE',
      newPatient.mrNumber,
      `Registrasi pasien baru ${newPatient.fullName} (NIK: ${newPatient.nik}).`
    );
    saveDatabase(db);
    res.status(201).json(newPatient);
  });

  // 5b. Update Existing Patient in Master Patient Index (MPI)
  app.put('/api/patients/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const fCode = req.sessionData!.facilityCode;
    const user = req.currentUser!;
    const patient = db.patients.find((p) => p.id === req.params.id && p.facilityCode === fCode);
    if (!patient) {
      res.status(404).json({ error: 'Data pasien tidak ditemukan di fasilitas ini.' });
      return;
    }

    const body = req.body as Partial<Patient>;
    if (body.fullName) patient.fullName = body.fullName.trim();
    if (body.nik && body.nik.trim().length === 16) patient.nik = body.nik.trim();
    if (body.bpjsNumber !== undefined) patient.bpjsNumber = body.bpjsNumber.trim();
    if (body.birthDate) patient.birthDate = body.birthDate;
    if (body.gender) patient.gender = body.gender;
    if (body.bloodType) patient.bloodType = body.bloodType;
    if (body.rhesus) patient.rhesus = body.rhesus;
    if (body.phone !== undefined) patient.phone = body.phone.trim();
    if (body.address !== undefined) patient.address = body.address.trim();
    if (Array.isArray(body.allergies)) patient.allergies = body.allergies.filter(Boolean);
    if (Array.isArray(body.chronicConditions)) {
      patient.chronicConditions = body.chronicConditions.filter(Boolean);
    }
    if (body.emergencyContactName !== undefined) {
      patient.emergencyContactName = body.emergencyContactName.trim();
    }
    if (body.emergencyContactPhone !== undefined) {
      patient.emergencyContactPhone = body.emergencyContactPhone.trim();
    }

    recordAudit(
      fCode,
      user.username,
      user.role,
      'MPI_PATIENT_UPDATE',
      patient.mrNumber,
      `Pembaruan data MPI pasien ${patient.fullName} (${patient.mrNumber}).`
    );
    saveDatabase(db);
    res.json(patient);
  });

  // 6. Register New Polyclinic / IGD Visit Queue
  app.post('/api/visits', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const fCode = req.sessionData!.facilityCode;
    const user = req.currentUser!;
    const body = req.body as {
      patientId: string;
      polyclinic: string;
      doctorId: string;
      guarantor: 'UMUM' | 'BPJS_KESEHATAN' | 'ASURANSI_SWASTA' | 'KORPORASI';
      bpjsSepOrPcareNo?: string;
      chiefComplaint: string;
      vitals: VisitQueueItem['vitals'];
    };

    const patient = db.patients.find((p) => p.id === body.patientId && p.facilityCode === fCode);
    if (!patient) {
      res.status(404).json({ error: 'Data pasien tidak ditemukan di fasilitas ini.' });
      return;
    }
    if (!body.chiefComplaint || !body.polyclinic) {
      res.status(400).json({ error: 'Poliklinik tujuan dan Keluhan Utama wajib diisi.' });
      return;
    }

    const doctor =
      db.users.find((u) => u.id === body.doctorId) ||
      db.users.find((u) => u.role === 'DOKTER' && canUserAccessFacility(u, fCode));

    const poliPrefix =
      body.polyclinic === 'IGD'
        ? 'IGD'
        : body.polyclinic === 'POLI_GIGI'
        ? 'GIGI'
        : body.polyclinic === 'POLI_ANAK'
        ? 'ANK'
        : 'PD';
    const seq = db.visits.filter((v) => v.facilityCode === fCode).length + 1;
    const queueNumber = `${poliPrefix}-${String(seq).padStart(3, '0')}`;
    const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const registrationNumber = `REG/${fCode.slice(0, 4)}/${dateStamp}/${String(seq).padStart(3, '0')}`;

    const vitals = body.vitals || {
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
    };

    const triageLevel = evaluateAutoTriage(vitals);
    const now = new Date().toISOString();

    const newVisit: VisitQueueItem = {
      id: `vis-${Date.now()}`,
      facilityCode: fCode,
      queueNumber,
      registrationNumber,
      patientId: patient.id,
      patientName: patient.fullName,
      mrNumber: patient.mrNumber,
      nik: patient.nik,
      gender: patient.gender,
      birthDate: patient.birthDate,
      polyclinic: body.polyclinic,
      doctorId: doctor ? doctor.id : 'usr-doc-01',
      doctorName: doctor ? doctor.fullName : 'dr. Hendra Wijaya, Sp.PD',
      guarantor: body.guarantor || 'UMUM',
      bpjsSepOrPcareNo:
        body.guarantor === 'BPJS_KESEHATAN'
          ? body.bpjsSepOrPcareNo?.trim() || `0114B${Date.now().toString().slice(-8)}`
          : undefined,
      triageLevel,
      status: 'MENUNGGU',
      vitals,
      chiefComplaint: body.chiefComplaint.trim(),
      createdAt: now,
      updatedAt: now,
    };

    db.visits.unshift(newVisit);

    if (newVisit.guarantor === 'BPJS_KESEHATAN') {
      db.bridgingLogs.unshift({
        id: `brg-${Date.now()}`,
        facilityCode: fCode,
        targetSystem: body.polyclinic === 'IGD' ? 'BPJS_VCLAIM' : 'BPJS_PCARE',
        resourceType:
          body.polyclinic === 'IGD'
            ? 'Penerbitan SEP IGD V-Claim Otomatis'
            : 'Pendaftaran Kunjungan Peserta P-Care',
        referenceId: newVisit.id,
        patientName: `${patient.fullName} (BPJS: ${patient.bpjsNumber || 'Aktif'})`,
        status: 'VALIDATED',
        externalId: newVisit.bpjsSepOrPcareNo || `SEP-${Date.now()}`,
        latencyMs: 138,
        payloadPreview: {
          registrationNumber: newVisit.registrationNumber,
          noKartu: patient.bpjsNumber,
          polyclinic: newVisit.polyclinic,
          keluhan: newVisit.chiefComplaint,
          triage: newVisit.triageLevel,
        },
        timestamp: now,
      });
    }

    recordAudit(
      fCode,
      user.username,
      user.role,
      'VISIT_QUEUE_REGISTER',
      newVisit.registrationNumber,
      `Pendaftaran antrean ${newVisit.queueNumber} untuk ${patient.fullName} di ${newVisit.polyclinic}.`
    );
    saveDatabase(db);
    res.status(201).json(newVisit);
  });

  // 6b. Unified Smart Patient + Visit Registration (Auto-Detect Existing or Create New Patient + Queue)
  app.post(
    '/api/visits/unified-register',
    requireAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const fCode = req.sessionData!.facilityCode;
      const user = req.currentUser!;
      const body = req.body as {
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
      };

      const cleanName = (body.fullName || '').trim();
      const cleanNik = (body.nik || '').replace(/\D/g, '');
      if (!cleanName || cleanNik.length < 16 || !body.birthDate) {
        res.status(400).json({
          error:
            'Identitas pasien (Nama Lengkap, NIK 16 Digit, dan Tanggal Lahir) wajib diisi lengkap.',
        });
        return;
      }
      if (!body.chiefComplaint || !body.chiefComplaint.trim() || !body.polyclinic) {
        res.status(400).json({
          error: 'Poliklinik tujuan dan Keluhan Utama wajib diisi.',
        });
        return;
      }

      // 1. Check if patient exists by ID or by NIK in this facility
      let patient = db.patients.find(
        (p) =>
          p.facilityCode === fCode &&
          ((body.patientId && p.id === body.patientId) || p.nik === cleanNik)
      );
      let isNewPatient = false;

      if (patient) {
        // Update existing patient's latest details seamlessly
        patient.fullName = cleanName;
        patient.nik = cleanNik;
        if (body.bpjsNumber !== undefined) patient.bpjsNumber = body.bpjsNumber.trim();
        patient.birthDate = body.birthDate;
        patient.gender = body.gender === 'P' ? 'P' : 'L';
        if (body.bloodType) patient.bloodType = body.bloodType;
        if (body.rhesus) patient.rhesus = body.rhesus;
        if (body.phone !== undefined) patient.phone = body.phone.trim();
        if (body.address !== undefined) patient.address = body.address.trim();
        if (Array.isArray(body.allergies)) {
          patient.allergies = body.allergies.filter(Boolean);
        }
        if (Array.isArray(body.chronicConditions)) {
          patient.chronicConditions = body.chronicConditions.filter(Boolean);
        }
        if (body.emergencyContactName !== undefined) {
          patient.emergencyContactName = body.emergencyContactName.trim();
        }
        if (body.emergencyContactPhone !== undefined) {
          patient.emergencyContactPhone = body.emergencyContactPhone.trim();
        }
      } else {
        isNewPatient = true;
        const prefix = fCode
          .split('_')
          .map((w) => w[0])
          .join('');
        const count = db.patients.filter((p) => p.facilityCode === fCode).length + 1045;
        const mrNumber = `RM-${prefix}-${String(count).padStart(6, '0')}`;

        patient = {
          id: `pat-${Date.now()}`,
          facilityCode: fCode,
          mrNumber,
          nik: cleanNik,
          bpjsNumber: (body.bpjsNumber || '').trim(),
          ihsNumber: `P100${Math.floor(10000000 + Math.random() * 89999999)}`,
          fullName: cleanName,
          birthDate: body.birthDate,
          gender: body.gender === 'P' ? 'P' : 'L',
          bloodType: body.bloodType || 'O',
          rhesus: body.rhesus === '-' ? '-' : '+',
          phone: (body.phone || '').trim(),
          address: (body.address || '').trim(),
          allergies: Array.isArray(body.allergies) ? body.allergies.filter(Boolean) : [],
          chronicConditions: Array.isArray(body.chronicConditions)
            ? body.chronicConditions.filter(Boolean)
            : [],
          emergencyContactName: (body.emergencyContactName || '').trim(),
          emergencyContactPhone: (body.emergencyContactPhone || '').trim(),
          createdAt: new Date().toISOString(),
        };
        db.patients.unshift(patient);
      }

      const doctor =
        db.users.find((u) => u.id === body.doctorId) ||
        db.users.find((u) => u.role === 'DOKTER' && canUserAccessFacility(u, fCode));

      const poliPrefix =
        body.polyclinic === 'IGD'
          ? 'IGD'
          : body.polyclinic === 'POLI_GIGI'
          ? 'GIGI'
          : body.polyclinic === 'POLI_ANAK'
          ? 'ANK'
          : 'PD';
      const seq = db.visits.filter((v) => v.facilityCode === fCode).length + 1;
      const queueNumber = `${poliPrefix}-${String(seq).padStart(3, '0')}`;
      const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const registrationNumber = `REG/${fCode.slice(0, 4)}/${dateStamp}/${String(seq).padStart(
        3,
        '0'
      )}`;

      const vitals = body.vitals || {
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
      };

      const triageLevel = evaluateAutoTriage(vitals);
      const now = new Date().toISOString();

      const newVisit: VisitQueueItem = {
        id: `vis-${Date.now()}`,
        facilityCode: fCode,
        queueNumber,
        registrationNumber,
        patientId: patient.id,
        patientName: patient.fullName,
        mrNumber: patient.mrNumber,
        nik: patient.nik,
        gender: patient.gender,
        birthDate: patient.birthDate,
        polyclinic: body.polyclinic,
        doctorId: doctor ? doctor.id : 'usr-doc-01',
        doctorName: doctor ? doctor.fullName : 'dr. Hendra Wijaya, Sp.PD',
        guarantor: body.guarantor || 'UMUM',
        bpjsSepOrPcareNo:
          body.guarantor === 'BPJS_KESEHATAN'
            ? body.bpjsSepOrPcareNo?.trim() || `0114B${Date.now().toString().slice(-8)}`
            : undefined,
        triageLevel,
        status: 'MENUNGGU',
        vitals,
        chiefComplaint: body.chiefComplaint.trim(),
        createdAt: now,
        updatedAt: now,
      };

      db.visits.unshift(newVisit);

      if (newVisit.guarantor === 'BPJS_KESEHATAN') {
        db.bridgingLogs.unshift({
          id: `brg-${Date.now()}`,
          facilityCode: fCode,
          targetSystem: body.polyclinic === 'IGD' ? 'BPJS_VCLAIM' : 'BPJS_PCARE',
          resourceType:
            body.polyclinic === 'IGD'
              ? 'Penerbitan SEP IGD V-Claim Otomatis'
              : 'Pendaftaran Kunjungan Peserta P-Care',
          referenceId: newVisit.id,
          patientName: `${patient.fullName} (BPJS: ${patient.bpjsNumber || 'Aktif'})`,
          status: 'VALIDATED',
          externalId: newVisit.bpjsSepOrPcareNo || `SEP-${Date.now()}`,
          latencyMs: 132,
          payloadPreview: {
            registrationNumber: newVisit.registrationNumber,
            noKartu: patient.bpjsNumber,
            polyclinic: newVisit.polyclinic,
            keluhan: newVisit.chiefComplaint,
            triage: newVisit.triageLevel,
          },
          timestamp: now,
        });
      }

      recordAudit(
        fCode,
        user.username,
        user.role,
        isNewPatient ? 'UNIFIED_NEW_PATIENT_AND_VISIT' : 'UNIFIED_EXISTING_PATIENT_VISIT',
        newVisit.registrationNumber,
        `Pendaftaran terpadu (${isNewPatient ? 'Pasien Baru' : 'Pasien Terdaftar'} ${
          patient.mrNumber
        }) antrean ${newVisit.queueNumber} untuk ${patient.fullName}.`
      );
      saveDatabase(db);
      res.status(201).json({
        patient,
        visit: newVisit,
        isNewPatient,
      });
    }
  );

  // 7. Update Visit Status
  app.patch('/api/visits/:id/status', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const fCode = req.sessionData!.facilityCode;
    const visit = db.visits.find((v) => v.id === req.params.id && v.facilityCode === fCode);
    if (!visit) {
      res.status(404).json({ error: 'Kunjungan tidak ditemukan.' });
      return;
    }
    const { status } = req.body as { status: VisitQueueItem['status'] };
    if (status) {
      visit.status = status;
      visit.updatedAt = new Date().toISOString();
      saveDatabase(db);
    }
    res.json(visit);
  });

  // 8. Save Complete RME SOAP + Odontogram + Prescriptions + Lab Request + Auto-Billing + SATUSEHAT
  app.post('/api/soap', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const fCode = req.sessionData!.facilityCode;
    const user = req.currentUser!;
    const payload = req.body as Omit<
      SoapRecord,
      'id' | 'facilityCode' | 'recordedAt' | 'satusehatEncounterId' | 'syncedToSatusehat'
    >;

    const visit = db.visits.find((v) => v.id === payload.visitId && v.facilityCode === fCode);
    if (!visit) {
      res.status(404).json({ error: 'Data kunjungan pasien tidak ditemukan.' });
      return;
    }
    const patient = db.patients.find((p) => p.id === visit.patientId && p.facilityCode === fCode);
    if (!patient) {
      res.status(404).json({ error: 'Data rekam medis pasien tidak ditemukan.' });
      return;
    }

    if (!payload.assessment?.primaryIcd10Code || !payload.subjective?.chiefComplaint) {
      res.status(400).json({
        error: 'Keluhan Utama (Subjective) dan Diagnosis Primer ICD-10 (Assessment) wajib diisi.',
      });
      return;
    }

    const now = new Date().toISOString();
    const existingIndex = db.soapRecords.findIndex(
      (s) => s.visitId === visit.id && s.facilityCode === fCode
    );
    const existingRecord = existingIndex >= 0 ? db.soapRecords[existingIndex] : null;

    const satusehatEncounterId = `ENC-SS-${fCode.slice(0, 4)}-${Date.now().toString().slice(-6)}`;
    const incomingCandidate: SoapRecord = {
      id: existingRecord ? existingRecord.id : `soap-${Date.now()}`,
      visitId: visit.id,
      facilityCode: fCode,
      patientId: patient.id,
      doctorId: payload.doctorId || user.id,
      doctorName: payload.doctorName || user.fullName,
      recordedAt: existingRecord ? existingRecord.recordedAt : now,
      subjective: payload.subjective,
      objective: payload.objective,
      assessment: payload.assessment,
      plan: payload.plan,
      satusehatEncounterId: existingRecord?.satusehatEncounterId || satusehatEncounterId,
      syncedToSatusehat: true,
    };

    const bodyExtra = req.body as {
      correctionReason?: string;
      coSignedBySupervisor?: string;
    };

    // Enforce Permenkes No. 24 Tahun 2022 Pasal 30 sign-off & 2x24h amendment/addendum rules
    const permenkesCheck = applyClinicalRecordMutationPermenkes24({
      existingRecord,
      incomingPayload: incomingCandidate,
      actor: user,
      correctionReason: bodyExtra.correctionReason || 'Pembaruan asesmen klinis lanjutan oleh DPJP',
      coSignedBySupervisor: bodyExtra.coSignedBySupervisor,
      nowIso: now,
    });

    if (!permenkesCheck.allowed || !permenkesCheck.updatedRecord) {
      res.status(permenkesCheck.errorStatus || 409).json({
        error: permenkesCheck.errorMessage || 'Perubahan rekam medis ditolak sesuai Permenkes 24/2022 Pasal 30.',
      });
      return;
    }

    const soapRecord = permenkesCheck.updatedRecord;

    if (existingIndex >= 0) {
      db.soapRecords[existingIndex] = soapRecord;
    } else {
      db.soapRecords.unshift(soapRecord);
    }

    visit.vitals = payload.objective.vitals;
    visit.soapId = soapRecord.id;
    visit.triageLevel = evaluateAutoTriage(payload.objective.vitals);

    const hasPrescriptions =
      Array.isArray(payload.plan.prescriptions) && payload.plan.prescriptions.length > 0;
    const hasLabs =
      Array.isArray(payload.plan.labRequestedParams) && payload.plan.labRequestedParams.length > 0;

    visit.status = hasPrescriptions || hasLabs ? 'FARMASI_LAB' : 'KASIR';
    visit.updatedAt = now;

    // Create or update Pharmacy Order
    if (hasPrescriptions) {
      const existingPho = db.pharmacyOrders.find(
        (po) => po.visitId === visit.id && po.facilityCode === fCode
      );
      if (existingPho && existingPho.status === 'ANTRIAN_RESEP') {
        existingPho.items = payload.plan.prescriptions;
      } else if (!existingPho) {
        const newPho: PharmacyOrder = {
          id: `pho-${Date.now()}`,
          facilityCode: fCode,
          visitId: visit.id,
          patientId: patient.id,
          patientName: patient.fullName,
          mrNumber: patient.mrNumber,
          doctorName: soapRecord.doctorName,
          allergies: patient.allergies,
          items: payload.plan.prescriptions,
          status: 'ANTRIAN_RESEP',
          dispensedBatches: [],
          createdAt: now,
        };
        db.pharmacyOrders.unshift(newPho);
      }
    }

    // Create or update Lab Order
    let labTariffItems: BillingLineItem[] = [];
    if (hasLabs) {
      const existingLab = db.labOrders.find(
        (lo) => lo.visitId === visit.id && lo.facilityCode === fCode
      );
      const paramResults: LabParameterResult[] = payload.plan.labRequestedParams
        .map((code) => {
          const tpl = LAB_PARAMETER_TEMPLATES.find((t) => t.code === code);
          if (!tpl) return null;
          const defaultVal = Number(((tpl.refMin + tpl.refMax) / 2).toFixed(1));
          return {
            code: tpl.code,
            name: tpl.name,
            category: tpl.category,
            value: defaultVal,
            unit: tpl.unit,
            refMin: tpl.refMin,
            refMax: tpl.refMax,
            criticalMin: tpl.criticalMin,
            criticalMax: tpl.criticalMax,
            flag: 'NORMAL' as const,
            tariff: tpl.tariff,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      labTariffItems = paramResults.map((pr, idx) => ({
        id: `bli-lab-${idx}-${Date.now()}`,
        category: 'LABORATORIUM',
        description: `Pemeriksaan Lab: ${pr.name}`,
        quantity: 1,
        unitPrice: pr.tariff,
        subtotal: pr.tariff,
      }));

      if (!existingLab) {
        const newLab: LabOrder = {
          id: `lab-${Date.now()}`,
          facilityCode: fCode,
          visitId: visit.id,
          patientId: patient.id,
          patientName: patient.fullName,
          mrNumber: patient.mrNumber,
          gender: patient.gender,
          doctorName: soapRecord.doctorName,
          specimenCode: `SPEC-${fCode.slice(0, 3)}-${Date.now().toString().slice(-5)}`,
          clinicalNotes: `${payload.assessment.primaryIcd10Code} - ${payload.assessment.primaryIcd10Name}`,
          status: 'PERMINTAAN_BARU',
          parameters: paramResults,
          createdAt: now,
        };
        db.labOrders.unshift(newLab);
      }
    }

    // Build / Update Integrated Invoice in Cashier
    const billingItems: BillingLineItem[] = [
      {
        id: `bli-reg-${Date.now()}`,
        category: 'PENDAFTARAN',
        description: 'Administrasi Rekam Medis Elektronik & Fasilitas',
        quantity: 1,
        unitPrice: 20000,
        subtotal: 20000,
      },
      ...(payload.plan.procedures || []).map((proc, idx) => ({
        id: `bli-proc-${idx}-${Date.now()}`,
        category: 'TINDAKAN' as const,
        description: `${proc.icd9Code} - ${proc.name}`,
        quantity: 1,
        unitPrice: proc.tariff,
        subtotal: proc.tariff,
      })),
      ...(payload.plan.prescriptions || []).map((rx, idx) => ({
        id: `bli-rx-${idx}-${Date.now()}`,
        category: 'FARMASI' as const,
        description: `${rx.medicationName} (${rx.quantity} ${rx.unit})`,
        quantity: rx.quantity,
        unitPrice: rx.unitPrice,
        subtotal: rx.quantity * rx.unitPrice,
      })),
      ...labTariffItems,
    ];

    const totals = calculateInvoiceTotals(billingItems, visit.guarantor, 0);
    const existingInvIndex = db.invoices.findIndex(
      (inv) => inv.visitId === visit.id && inv.facilityCode === fCode
    );

    const invoiceRecord: InvoiceRecord = {
      id: existingInvIndex >= 0 ? db.invoices[existingInvIndex].id : `inv-${Date.now()}`,
      facilityCode: fCode,
      invoiceNumber:
        existingInvIndex >= 0
          ? db.invoices[existingInvIndex].invoiceNumber
          : `INV/${fCode.slice(0, 4)}/${now.slice(0, 10).replace(/-/g, '')}/${String(
              db.invoices.length + 1
            ).padStart(3, '0')}`,
      visitId: visit.id,
      patientId: patient.id,
      patientName: patient.fullName,
      mrNumber: patient.mrNumber,
      guarantor: visit.guarantor,
      items: billingItems,
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      bpjsCoveredAmount: totals.bpjsCoveredAmount,
      patientPayableAmount: totals.patientPayableAmount,
      paymentMethod: visit.guarantor === 'BPJS_KESEHATAN' ? 'KLAIM_BPJS' : 'TUNAI',
      status: 'BELUM_LUNAS',
      createdAt: now,
    };

    if (existingInvIndex >= 0) {
      db.invoices[existingInvIndex] = invoiceRecord;
    } else {
      db.invoices.unshift(invoiceRecord);
    }

    // SATUSEHAT Kemenkes FHIR R4 Encounter + Condition + Observation + MedicationRequest Bundle
    db.bridgingLogs.unshift({
      id: `brg-ss-${Date.now()}`,
      facilityCode: fCode,
      targetSystem: 'SATUSEHAT_FHIR_R4',
      resourceType: 'Bundle (Encounter, Condition ICD-10, Observation Vitals, MedicationRequest)',
      referenceId: visit.id,
      patientName: `${patient.fullName} (IHS: ${patient.ihsNumber})`,
      status: 'TERKIRIM_200',
      externalId: satusehatEncounterId,
      latencyMs: 124,
      payloadPreview: {
        resourceType: 'Bundle',
        type: 'transaction',
        encounterId: satusehatEncounterId,
        patientIhs: patient.ihsNumber,
        practitionerName: soapRecord.doctorName,
        icd10Primary: payload.assessment.primaryIcd10Code,
        icd10Display: payload.assessment.primaryIcd10Name,
        vitals: {
          bp: `${payload.objective.vitals.systolic}/${payload.objective.vitals.diastolic} mmHg`,
          hr: `${payload.objective.vitals.heartRate} bpm`,
          temp: `${payload.objective.vitals.temperature} C`,
        },
        prescriptionCount: payload.plan.prescriptions.length,
      },
      timestamp: now,
    });

    recordAudit(
      fCode,
      user.username,
      user.role,
      'RME_SOAP_FINALIZE',
      visit.registrationNumber,
      `Finalisasi RME SOAP pasien ${patient.fullName} dengan diagnosis ${payload.assessment.primaryIcd10Code}.`
    );
    saveDatabase(db);

    res.status(201).json({
      soapRecord,
      visit,
      invoice: invoiceRecord,
    });
  });

  // 9. Dispense Pharmacy Order using FEFO (First Expired, First Out) + Automatic Stock Deduction & Mutation Ledger
  app.post(
    '/api/pharmacy/:orderId/dispense',
    requireAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const fCode = req.sessionData!.facilityCode;
      const user = req.currentUser!;
      const order = db.pharmacyOrders.find(
        (po) => po.id === req.params.orderId && po.facilityCode === fCode
      );
      if (!order) {
        res.status(404).json({ error: 'Order resep farmasi tidak ditemukan.' });
        return;
      }
      if (order.status === 'DISERAHKAN') {
        res.status(400).json({ error: 'Resep ini sudah diserahkan sebelumnya.' });
        return;
      }

      const dispensedBatches: {
        medicationCode: string;
        batchNumber: string;
        quantity: number;
      }[] = [];

      const now = new Date().toISOString();
      if (!Array.isArray(db.medicationMutations)) {
        db.medicationMutations = [];
      }

      for (const item of order.items) {
        const med = db.medications.find(
          (m) =>
            m.facilityCode === fCode &&
            (m.id === item.medicationId || m.code === item.medicationCode)
        );
        if (!med) continue;

        // Snapshot stock per batch before FEFO deduction
        const batchStockBeforeMap = new Map<string, number>();
        for (const b of med.batches) {
          batchStockBeforeMap.set(b.batchNumber, b.stock);
        }

        const fefo = allocateFEFOStock(med.batches, item.quantity);
        if (!fefo.success) {
          res.status(400).json({
            error: `Stok ${med.name} tidak mencukupi (kurang ${fefo.shortfall} ${med.unit}). Silakan tambah batch stok terlebih dahulu.`,
          });
          return;
        }
        med.batches = fefo.updatedBatches;

        const effectiveSellPrice = item.unitPrice || med.sellPrice;

        for (const alloc of fefo.allocations) {
          dispensedBatches.push({
            medicationCode: med.code,
            batchNumber: alloc.batchNumber,
            quantity: alloc.quantity,
          });

          const beforeStock = batchStockBeforeMap.get(alloc.batchNumber) ?? alloc.quantity;
          const afterBatch = med.batches.find((b) => b.batchNumber === alloc.batchNumber);
          const afterStock = afterBatch ? afterBatch.stock : Math.max(0, beforeStock - alloc.quantity);

          db.medicationMutations.unshift({
            id: `mut-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            facilityCode: fCode,
            timestamp: now,
            medicationId: med.id,
            medicationCode: med.code,
            medicationName: med.name,
            batchNumber: alloc.batchNumber,
            unit: med.unit,
            type: 'KELUAR_RESEP',
            quantityChange: -alloc.quantity,
            stockBefore: beforeStock,
            stockAfter: afterStock,
            unitPrice: effectiveSellPrice,
            totalValue: alloc.quantity * effectiveSellPrice,
            referenceId: order.id,
            counterpartyOrPatient: `Pasien: ${order.patientName} (${order.mrNumber})`,
            actorName: user.fullName,
            notes: `Penyerahan E-Resep FEFO (${item.dosage} • ${item.signa}) dr. ${order.doctorName}`,
          });
        }
      }

      order.status = 'DISERAHKAN';
      order.dispensedBatches = dispensedBatches;
      order.dispensedBy = user.fullName;
      order.dispensedAt = now;
      order.pharmacistNotes =
        (req.body as { pharmacistNotes?: string })?.pharmacistNotes ||
        'Telaah resep 7 benar terpenuhi, edukasi aturan pakai telah disampaikan.';

      const visit = db.visits.find((v) => v.id === order.visitId && v.facilityCode === fCode);
      const pendingLab = db.labOrders.find(
        (lo) =>
          lo.visitId === order.visitId &&
          lo.facilityCode === fCode &&
          lo.status !== 'SELESAI_VERIFIKASI'
      );
      if (visit && !pendingLab && visit.status === 'FARMASI_LAB') {
        visit.status = 'KASIR';
        visit.updatedAt = now;
      }

      recordAudit(
        fCode,
        user.username,
        user.role,
        'PHARMACY_FEFO_DISPENSE',
        order.id,
        `Penyerahan obat FEFO otomatis memotong stok untuk ${order.patientName} (${dispensedBatches
          .map((b) => `${b.medicationCode}:${b.batchNumber}(-${b.quantity})`)
          .join(', ')}).`
      );
      saveDatabase(db);
      res.json(order);
    }
  );

  // 10. Receive New Medication Batch / Restock Inventory (Automatic Stock Addition & Mutation Ledger)
  app.post(
    '/api/medications/:id/restock',
    requireAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const fCode = req.sessionData!.facilityCode;
      const user = req.currentUser!;
      const med = db.medications.find(
        (m) => m.id === req.params.id && m.facilityCode === fCode
      );
      if (!med) {
        res.status(404).json({ error: 'Data obat/alkes tidak ditemukan.' });
        return;
      }

      const { batchNumber, expiryDate, quantity, supplierName } = req.body as {
        batchNumber: string;
        expiryDate: string;
        quantity: number;
        supplierName?: string;
      };

      const qtyNum = Number(quantity);
      if (!batchNumber || !expiryDate || !qtyNum || qtyNum <= 0) {
        res.status(400).json({
          error: 'Nomor Batch, Tanggal Kedaluwarsa, dan Jumlah Stok Masuk (> 0) wajib diisi.',
        });
        return;
      }

      const cleanBatchNo = batchNumber.trim().toUpperCase();
      const existingBatch = med.batches.find(
        (b) => b.batchNumber.toUpperCase() === cleanBatchNo
      );
      const stockBefore = existingBatch ? existingBatch.stock : 0;

      if (existingBatch) {
        existingBatch.stock += qtyNum;
        existingBatch.expiryDate = expiryDate;
      } else {
        med.batches.push({
          batchNumber: cleanBatchNo,
          expiryDate,
          stock: qtyNum,
        });
      }

      const stockAfter = stockBefore + qtyNum;
      const totalPurchase = qtyNum * med.buyPrice;
      const now = new Date().toISOString();

      if (!Array.isArray(db.medicationMutations)) {
        db.medicationMutations = [];
      }
      db.medicationMutations.unshift({
        id: `mut-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        facilityCode: fCode,
        timestamp: now,
        medicationId: med.id,
        medicationCode: med.code,
        medicationName: med.name,
        batchNumber: cleanBatchNo,
        unit: med.unit,
        type: 'MASUK_PBF',
        quantityChange: qtyNum,
        stockBefore,
        stockAfter,
        unitPrice: med.buyPrice,
        totalValue: totalPurchase,
        referenceId: `PBF-${cleanBatchNo}`,
        counterpartyOrPatient: supplierName || 'Distributor PBF Resmi',
        actorName: user.fullName,
        notes: `Penerimaan stok masuk Batch ${cleanBatchNo} (ED ${expiryDate}) dari ${
          supplierName || 'PBF Resmi'
        }`,
      });

      db.accountingEntries.unshift({
        id: `acc-${Date.now()}`,
        facilityCode: fCode,
        entryNumber: `JRN/${fCode.slice(0, 4)}/${now.slice(0, 10).replace(/-/g, '')}/${
          db.accountingEntries.length + 1
        }`,
        timestamp: now,
        accountCode: '5-2010',
        accountName: 'Beban Pengadaan Obat & Alkes Farmasi',
        type: 'PENGELUARAN',
        category: 'PENGADAAN_OBAT',
        description: `Penerimaan Stok ${med.name} (+${qtyNum} ${med.unit}) Batch ${cleanBatchNo} dari ${
          supplierName || 'PBF Resmi'
        }`,
        amount: totalPurchase,
        referenceId: cleanBatchNo,
      });

      recordAudit(
        fCode,
        user.username,
        user.role,
        'INVENTORY_BATCH_RESTOCK',
        med.code,
        `Penerimaan batch ${cleanBatchNo} sebanyak +${qtyNum} ${med.unit} untuk ${med.name}.`
      );
      saveDatabase(db);
      res.json(med);
    }
  );

  // 10b. Direct Outgoing Medication Dispensing (Obat Keluar Langsung / Unit / Pasien)
  app.post(
    '/api/medications/:id/dispense-direct',
    requireAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const fCode = req.sessionData!.facilityCode;
      const user = req.currentUser!;
      const med = db.medications.find(
        (m) => m.id === req.params.id && m.facilityCode === fCode
      );
      if (!med) {
        res.status(404).json({ error: 'Data obat/alkes tidak ditemukan.' });
        return;
      }

      const { quantity, patientOrUnitName, notes } = req.body as {
        quantity: number;
        patientOrUnitName: string;
        notes?: string;
      };

      const qtyNum = Number(quantity);
      if (!qtyNum || qtyNum <= 0 || !patientOrUnitName?.trim()) {
        res.status(400).json({
          error: 'Jumlah Obat Keluar (> 0) dan Nama Pasien / Unit Tujuan wajib diisi.',
        });
        return;
      }

      const batchStockBeforeMap = new Map<string, number>();
      for (const b of med.batches) {
        batchStockBeforeMap.set(b.batchNumber, b.stock);
      }

      const fefo = allocateFEFOStock(med.batches, qtyNum);
      if (!fefo.success) {
        res.status(400).json({
          error: `Stok ${med.name} tidak mencukupi (kurang ${fefo.shortfall} ${med.unit}).`,
        });
        return;
      }
      med.batches = fefo.updatedBatches;

      const now = new Date().toISOString();
      if (!Array.isArray(db.medicationMutations)) {
        db.medicationMutations = [];
      }

      for (const alloc of fefo.allocations) {
        const beforeStock = batchStockBeforeMap.get(alloc.batchNumber) ?? alloc.quantity;
        const afterBatch = med.batches.find((b) => b.batchNumber === alloc.batchNumber);
        const afterStock = afterBatch
          ? afterBatch.stock
          : Math.max(0, beforeStock - alloc.quantity);

        db.medicationMutations.unshift({
          id: `mut-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          facilityCode: fCode,
          timestamp: now,
          medicationId: med.id,
          medicationCode: med.code,
          medicationName: med.name,
          batchNumber: alloc.batchNumber,
          unit: med.unit,
          type: 'KELUAR_RESEP',
          quantityChange: -alloc.quantity,
          stockBefore: beforeStock,
          stockAfter: afterStock,
          unitPrice: med.sellPrice,
          totalValue: alloc.quantity * med.sellPrice,
          referenceId: `DSP-${Date.now().toString().slice(-5)}`,
          counterpartyOrPatient: patientOrUnitName.trim(),
          actorName: user.fullName,
          notes: notes?.trim() || 'Pengeluaran obat langsung / penyerahan farmasi FEFO',
        });
      }

      // Record pharmacy revenue in accounting ledger
      const totalSale = qtyNum * med.sellPrice;
      db.accountingEntries.unshift({
        id: `acc-${Date.now()}`,
        facilityCode: fCode,
        entryNumber: `JRN/${fCode.slice(0, 4)}/${now.slice(0, 10).replace(/-/g, '')}/${
          db.accountingEntries.length + 1
        }`,
        timestamp: now,
        accountCode: '4-1025',
        accountName: 'Pendapatan Penjualan Obat & Farmasi',
        type: 'PENDAPATAN',
        category: 'FARMASI',
        description: `Pengeluaran Obat ${med.name} (-${qtyNum} ${med.unit}) untuk ${patientOrUnitName.trim()}`,
        amount: totalSale,
        referenceId: med.code,
      });

      recordAudit(
        fCode,
        user.username,
        user.role,
        'PHARMACY_DIRECT_DISPENSE',
        med.code,
        `Pengeluaran obat langsung ${med.name} sebanyak -${qtyNum} ${med.unit} kepada ${patientOrUnitName.trim()}.`
      );
      saveDatabase(db);
      res.json(med);
    }
  );

  // 11. Add New Master Medication Item
  app.post('/api/medications', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const fCode = req.sessionData!.facilityCode;
    const user = req.currentUser!;
    const body = req.body as Partial<MedicationInventory> & {
      initialBatchNumber?: string;
      initialExpiryDate?: string;
      initialStock?: number;
    };

    if (!body.code || !body.name || !body.genericName) {
      res.status(400).json({ error: 'Kode Obat, Nama Dagang, dan Nama Generik wajib diisi.' });
      return;
    }

    const initBatch = (body.initialBatchNumber || 'BATCH-INIT-01').toUpperCase();
    const initStock = Number(body.initialStock) || 100;
    const buyPrice = Number(body.buyPrice) || 1000;

    const newMed: MedicationInventory = {
      id: `med-${Date.now()}`,
      facilityCode: fCode,
      code: body.code.trim().toUpperCase(),
      kfaCode: body.kfaCode?.trim() || `9300${Math.floor(1000 + Math.random() * 8999)}`,
      name: body.name.trim(),
      genericName: body.genericName.trim(),
      category: body.category || 'OBAT_KERAS',
      form: body.form || 'TABLET',
      unit: body.unit || 'Tablet',
      minStock: Number(body.minStock) || 50,
      buyPrice,
      sellPrice: Number(body.sellPrice) || 2000,
      contraindications: Array.isArray(body.contraindications) ? body.contraindications : [],
      interactions: Array.isArray(body.interactions) ? body.interactions : [],
      batches: [
        {
          batchNumber: initBatch,
          expiryDate: body.initialExpiryDate || '2027-12-31',
          stock: initStock,
        },
      ],
    };

    db.medications.unshift(newMed);

    if (!Array.isArray(db.medicationMutations)) {
      db.medicationMutations = [];
    }
    db.medicationMutations.unshift({
      id: `mut-${Date.now()}`,
      facilityCode: fCode,
      timestamp: new Date().toISOString(),
      medicationId: newMed.id,
      medicationCode: newMed.code,
      medicationName: newMed.name,
      batchNumber: initBatch,
      unit: newMed.unit,
      type: 'STOK_AWAL',
      quantityChange: initStock,
      stockBefore: 0,
      stockAfter: initStock,
      unitPrice: buyPrice,
      totalValue: initStock * buyPrice,
      referenceId: `INIT-${newMed.code}`,
      counterpartyOrPatient: 'Registrasi Master SKU Baru',
      actorName: user.fullName,
      notes: `Saldo stok awal master obat ${newMed.name}`,
    });

    recordAudit(
      fCode,
      user.username,
      user.role,
      'MEDICATION_MASTER_CREATE',
      newMed.code,
      `Penambahan master obat baru ${newMed.name} (KFA: ${newMed.kfaCode}) dengan stok awal ${initStock}.`
    );
    saveDatabase(db);
    res.status(201).json(newMed);
  });

  // 11a. Batch Stock Opname Adjustment (Save full table opname adjustments in one click)
  app.post(
    '/api/medications/batch-opname',
    requireAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const fCode = req.sessionData!.facilityCode;
      const user = req.currentUser!;
      const { reason, items } = req.body as {
        reason?: string;
        items: { medicationId: string; batchNumber: string; actualStock: number }[];
      };

      if (!Array.isArray(items) || items.length === 0) {
        res.status(400).json({ error: 'Daftar item stok opname kosong.' });
        return;
      }

      if (!Array.isArray(db.medicationMutations)) {
        db.medicationMutations = [];
      }

      const now = new Date().toISOString();
      let updatedCount = 0;
      let mutationsCreated = 0;

      for (const item of items) {
        const med = db.medications.find(
          (m) => m.id === item.medicationId && m.facilityCode === fCode
        );
        if (!med) continue;
        const batch = med.batches.find(
          (b) => b.batchNumber.toUpperCase() === (item.batchNumber || '').trim().toUpperCase()
        );
        if (!batch) continue;

        const previousStock = batch.stock;
        const newStock = Math.max(0, Number(item.actualStock));
        const diff = newStock - previousStock;
        if (diff === 0) continue;

        batch.stock = newStock;
        updatedCount++;
        mutationsCreated++;

        db.medicationMutations.unshift({
          id: `mut-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          facilityCode: fCode,
          timestamp: now,
          medicationId: med.id,
          medicationCode: med.code,
          medicationName: med.name,
          batchNumber: batch.batchNumber,
          unit: med.unit,
          type: 'PENYESUAIAN_OPNAME',
          quantityChange: diff,
          stockBefore: previousStock,
          stockAfter: newStock,
          unitPrice: med.buyPrice,
          totalValue: Math.abs(diff) * med.buyPrice,
          referenceId: `SO-${now.slice(0, 10).replace(/-/g, '')}`,
          counterpartyOrPatient: 'Audit Stok Opname Fisik',
          actorName: user.fullName,
          notes: reason?.trim() || 'Penyesuaian tabel Stock Opname fisik berkala',
        });
      }

      recordAudit(
        fCode,
        user.username,
        user.role,
        'PHARMACY_BATCH_STOCK_OPNAME',
        `OPNAME_ITEMS:${updatedCount}`,
        `Penyesuaian massal Stock Opname untuk ${updatedCount} batch obat. Alasan: ${
          reason || 'Audit fisik'
        }`
      );
      saveDatabase(db);
      res.json({ updatedCount, mutationsCreated });
    }
  );

  // 11b. Single Stock Opname / Physical Batch Stock Adjustment
  app.post('/api/medications/:id/opname', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const fCode = req.sessionData!.facilityCode;
    const user = req.currentUser!;
    const med = db.medications.find((m) => m.id === req.params.id && m.facilityCode === fCode);
    if (!med) {
      res.status(404).json({ error: 'Data obat/alkes tidak ditemukan.' });
      return;
    }

    const { batchNumber, actualStock, reason } = req.body as {
      batchNumber: string;
      actualStock: number;
      reason: string;
    };

    const batch = med.batches.find(
      (b) => b.batchNumber.toUpperCase() === (batchNumber || '').trim().toUpperCase()
    );
    if (!batch) {
      res.status(404).json({ error: `Batch ${batchNumber} tidak ditemukan pada item ${med.name}.` });
      return;
    }

    const previousStock = batch.stock;
    const newStock = Math.max(0, Number(actualStock));
    const diff = newStock - previousStock;
    batch.stock = newStock;

    if (!Array.isArray(db.medicationMutations)) {
      db.medicationMutations = [];
    }
    const now = new Date().toISOString();
    db.medicationMutations.unshift({
      id: `mut-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      facilityCode: fCode,
      timestamp: now,
      medicationId: med.id,
      medicationCode: med.code,
      medicationName: med.name,
      batchNumber: batch.batchNumber,
      unit: med.unit,
      type: 'PENYESUAIAN_OPNAME',
      quantityChange: diff,
      stockBefore: previousStock,
      stockAfter: newStock,
      unitPrice: med.buyPrice,
      totalValue: Math.abs(diff) * med.buyPrice,
      referenceId: `SO-${med.code}-${now.slice(0, 10).replace(/-/g, '')}`,
      counterpartyOrPatient: 'Audit Stok Opname Fisik',
      actorName: user.fullName,
      notes: reason?.trim() || 'Penyesuaian fisik berkala',
    });

    recordAudit(
      fCode,
      user.username,
      user.role,
      'PHARMACY_STOCK_OPNAME',
      `${med.code}:${batch.batchNumber}`,
      `Stok Opname ${med.name} Batch ${batch.batchNumber}: ${previousStock} -> ${newStock} (${
        diff >= 0 ? `+${diff}` : diff
      } ${med.unit}). Alasan: ${reason || 'Penyesuaian fisik berkala'}.`
    );
    saveDatabase(db);
    res.json(med);
  });

  // 11c. Create Direct Lab Order for Visit
  app.post('/api/lab', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const fCode = req.sessionData!.facilityCode;
    const user = req.currentUser!;
    const { visitId, panelCodes, clinicalNotes } = req.body as {
      visitId: string;
      panelCodes: string[];
      clinicalNotes?: string;
    };

    const visit = db.visits.find((v) => v.id === visitId && v.facilityCode === fCode);
    if (!visit) {
      res.status(404).json({ error: 'Kunjungan pasien tidak ditemukan.' });
      return;
    }

    const templateParams = [
      {
        code: 'HGB',
        name: 'Hemoglobin (Hb)',
        value: 13.8,
        unit: 'g/dL',
        refMin: 12.0,
        refMax: 16.0,
        criticalMin: 7.0,
        criticalMax: 20.0,
      },
      {
        code: 'WBC',
        name: 'Leukosit (WBC)',
        value: 8.4,
        unit: '10^3/uL',
        refMin: 4.5,
        refMax: 11.0,
        criticalMin: 2.0,
        criticalMax: 30.0,
      },
      {
        code: 'PLT',
        name: 'Trombosit (PLT)',
        value: 245,
        unit: '10^3/uL',
        refMin: 150,
        refMax: 450,
        criticalMin: 50,
        criticalMax: 1000,
      },
      {
        code: 'GDS',
        name: 'Glukosa Darah Sewaktu (GDS)',
        value: 118,
        unit: 'mg/dL',
        refMin: 70,
        refMax: 140,
        criticalMin: 45,
        criticalMax: 400,
      },
      {
        code: 'CHOL',
        name: 'Kolesterol Total',
        value: 192,
        unit: 'mg/dL',
        refMin: 100,
        refMax: 200,
        criticalMin: 50,
        criticalMax: 400,
      },
      {
        code: 'UA',
        name: 'Asam Urat (Uric Acid)',
        value: 5.8,
        unit: 'mg/dL',
        refMin: 3.4,
        refMax: 7.0,
        criticalMin: 1.5,
        criticalMax: 13.0,
      },
      {
        code: 'CREAT',
        name: 'Kreatinin Serum',
        value: 0.9,
        unit: 'mg/dL',
        refMin: 0.6,
        refMax: 1.2,
        criticalMin: 0.2,
        criticalMax: 5.0,
      },
      {
        code: 'SGOT',
        name: 'SGOT (AST)',
        value: 26,
        unit: 'U/L',
        refMin: 5,
        refMax: 40,
        criticalMin: 2,
        criticalMax: 500,
      },
    ];

    const selected =
      Array.isArray(panelCodes) && panelCodes.length > 0
        ? panelCodes
        : ['HGB', 'WBC', 'PLT', 'GDS'];
    const parameters: LabParameterResult[] = templateParams
      .filter((tp) => selected.includes(tp.code))
      .map((tp) => ({
        ...tp,
        category:
          tp.code === 'HGB' || tp.code === 'WBC' || tp.code === 'PLT'
            ? 'HEMATOLOGI'
            : 'KIMIA_DARAH',
        tariff: 45000,
        flag: evaluateLabFlag(tp.value, tp.refMin, tp.refMax, tp.criticalMin, tp.criticalMax),
      }));

    const now = new Date().toISOString();
    const newLabOrder: LabOrder = {
      id: `lab-${Date.now()}`,
      visitId: visit.id,
      facilityCode: fCode,
      patientId: visit.patientId,
      patientName: visit.patientName,
      mrNumber: visit.mrNumber,
      gender: visit.gender,
      doctorName: visit.doctorName,
      specimenCode: `SPC-${fCode.slice(0, 3)}-${Date.now().toString().slice(-6)}`,
      status: 'SAMPEL_DIAMBIL',
      parameters,
      clinicalNotes: clinicalNotes || visit.chiefComplaint,
      createdAt: now,
    };

    db.labOrders.unshift(newLabOrder);
    recordAudit(
      fCode,
      user.username,
      user.role,
      'LAB_ORDER_CREATED',
      newLabOrder.specimenCode,
      `Permintaan pemeriksaan laboratorium baru (${selected.join(', ')}) untuk pasien ${visit.patientName}.`
    );
    saveDatabase(db);
    res.status(201).json(newLabOrder);
  });

  // 12. Verify Laboratory Order Results
  app.post('/api/lab/:orderId/verify', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const fCode = req.sessionData!.facilityCode;
    const user = req.currentUser!;
    const labOrder = db.labOrders.find(
      (lo) => lo.id === req.params.orderId && lo.facilityCode === fCode
    );
    if (!labOrder) {
      res.status(404).json({ error: 'Order laboratorium tidak ditemukan.' });
      return;
    }

    const { parameters, clinicalNotes } = req.body as {
      parameters: { code: string; value: number }[];
      clinicalNotes?: string;
    };

    if (Array.isArray(parameters)) {
      labOrder.parameters = labOrder.parameters.map((param) => {
        const incoming = parameters.find((p) => p.code === param.code);
        const val = incoming !== undefined ? Number(incoming.value) : param.value;
        return {
          ...param,
          value: val,
          flag: evaluateLabFlag(
            val,
            param.refMin,
            param.refMax,
            param.criticalMin,
            param.criticalMax
          ),
        };
      });
    }

    if (clinicalNotes !== undefined) {
      labOrder.clinicalNotes = clinicalNotes;
    }
    const now = new Date().toISOString();
    labOrder.status = 'SELESAI_VERIFIKASI';
    labOrder.verifiedBy = user.fullName;
    labOrder.verifiedAt = now;

    const visit = db.visits.find((v) => v.id === labOrder.visitId && v.facilityCode === fCode);
    const pendingPho = db.pharmacyOrders.find(
      (po) =>
        po.visitId === labOrder.visitId &&
        po.facilityCode === fCode &&
        po.status !== 'DISERAHKAN'
    );
    if (visit && !pendingPho && visit.status === 'FARMASI_LAB') {
      visit.status = 'KASIR';
      visit.updatedAt = now;
    }

    recordAudit(
      fCode,
      user.username,
      user.role,
      'LAB_RESULT_VERIFIED',
      labOrder.specimenCode,
      `Verifikasi hasil laboratorium spesimen ${labOrder.specimenCode} untuk pasien ${labOrder.patientName}.`
    );
    saveDatabase(db);
    res.json(labOrder);
  });

  // 13. Settle Invoice at Cashier & Post Accounting Journal Entry
  app.post('/api/invoices/:id/pay', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const fCode = req.sessionData!.facilityCode;
    const user = req.currentUser!;
    const invoice = db.invoices.find(
      (inv) => inv.id === req.params.id && inv.facilityCode === fCode
    );
    if (!invoice) {
      res.status(404).json({ error: 'Tagihan kasir tidak ditemukan.' });
      return;
    }

    const { paymentMethod, discountAmount } = req.body as {
      paymentMethod?: InvoiceRecord['paymentMethod'];
      discountAmount?: number;
    };

    const recalculated = calculateInvoiceTotals(
      invoice.items,
      invoice.guarantor,
      discountAmount !== undefined ? Number(discountAmount) : invoice.discountAmount
    );

    invoice.subtotal = recalculated.subtotal;
    invoice.discountAmount = recalculated.discountAmount;
    invoice.bpjsCoveredAmount = recalculated.bpjsCoveredAmount;
    invoice.patientPayableAmount = recalculated.patientPayableAmount;
    invoice.paymentMethod =
      paymentMethod ||
      (invoice.guarantor === 'BPJS_KESEHATAN' ? 'KLAIM_BPJS' : 'TUNAI');
    invoice.status =
      invoice.guarantor === 'BPJS_KESEHATAN' ? 'KLAIM_DIAJUKAN' : 'LUNAS';
    invoice.cashierName = user.fullName;
    invoice.paidAt = new Date().toISOString();

    const visit = db.visits.find((v) => v.id === invoice.visitId && v.facilityCode === fCode);
    if (visit) {
      visit.status = 'SELESAI';
      visit.updatedAt = invoice.paidAt;
    }

    const effectiveRevenue =
      invoice.guarantor === 'BPJS_KESEHATAN'
        ? invoice.bpjsCoveredAmount
        : invoice.patientPayableAmount;

    db.accountingEntries.unshift({
      id: `acc-${Date.now()}`,
      facilityCode: fCode,
      entryNumber: `JRN/${fCode.slice(0, 4)}/${invoice.paidAt.slice(0, 10).replace(/-/g, '')}/${
        db.accountingEntries.length + 1
      }`,
      timestamp: invoice.paidAt,
      accountCode: invoice.guarantor === 'BPJS_KESEHATAN' ? '4-1010' : '4-1000',
      accountName:
        invoice.guarantor === 'BPJS_KESEHATAN'
          ? 'Piutang / Pendapatan Klaim BPJS Kesehatan'
          : `Pendapatan Layanan Pasien (${invoice.paymentMethod})`,
      type: 'PENDAPATAN',
      category: invoice.guarantor === 'BPJS_KESEHATAN' ? 'KLAIM_BPJS' : 'LAYANAN_MEDIS',
      description: `Pelunasan Tagihan ${invoice.invoiceNumber} - ${invoice.patientName} (${invoice.mrNumber})`,
      amount: effectiveRevenue,
      referenceId: invoice.invoiceNumber,
    });

    recordAudit(
      fCode,
      user.username,
      user.role,
      'CASHIER_INVOICE_SETTLED',
      invoice.invoiceNumber,
      `Penyelesaian pembayaran ${invoice.invoiceNumber} sebesar Rp ${effectiveRevenue.toLocaleString(
        'id-ID'
      )} melalui ${invoice.paymentMethod}.`
    );
    saveDatabase(db);
    res.json(invoice);
  });

  // 14. Inpatient / Observation Bed Assignment & Discharge
  app.post('/api/beds/:id/assign', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const fCode = req.sessionData!.facilityCode;
    const user = req.currentUser!;
    const bed = db.beds.find((b) => b.id === req.params.id && b.facilityCode === fCode);
    if (!bed) {
      res.status(404).json({ error: 'Tempat tidur tidak ditemukan.' });
      return;
    }
    const { patientId, attendingDoctor, diagnosis } = req.body as {
      patientId: string;
      attendingDoctor: string;
      diagnosis: string;
    };
    const patient = db.patients.find((p) => p.id === patientId && p.facilityCode === fCode);
    if (!patient) {
      res.status(404).json({ error: 'Pasien tidak ditemukan.' });
      return;
    }

    bed.status = 'TERISI';
    bed.patientId = patient.id;
    bed.patientName = patient.fullName;
    bed.mrNumber = patient.mrNumber;
    bed.admittedAt = new Date().toISOString();
    bed.attendingDoctor = attendingDoctor || user.fullName;
    bed.diagnosis = diagnosis || 'Observasi Rawat Inap';

    recordAudit(
      fCode,
      user.username,
      user.role,
      'BED_ADMISSION',
      bed.bedCode,
      `Pasien ${patient.fullName} (${patient.mrNumber}) masuk ke bed ${bed.bedCode} (${bed.wardName}).`
    );
    saveDatabase(db);
    res.json(bed);
  });

  app.post('/api/beds/:id/discharge', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const fCode = req.sessionData!.facilityCode;
    const user = req.currentUser!;
    const bed = db.beds.find((b) => b.id === req.params.id && b.facilityCode === fCode);
    if (!bed) {
      res.status(404).json({ error: 'Tempat tidur tidak ditemukan.' });
      return;
    }
    const dischargedPatient = bed.patientName || 'Pasien';
    bed.status = 'TERSEDIA';
    bed.patientId = undefined;
    bed.patientName = undefined;
    bed.mrNumber = undefined;
    bed.admittedAt = undefined;
    bed.attendingDoctor = undefined;
    bed.diagnosis = undefined;

    recordAudit(
      fCode,
      user.username,
      user.role,
      'BED_DISCHARGE',
      bed.bedCode,
      `Pemulangan pasien ${dischargedPatient} dari bed ${bed.bedCode}. Status bed kini TERSEDIA.`
    );
    saveDatabase(db);
    res.json(bed);
  });

  // 14b. Add New Inpatient Bed / Room or Update Bed Status / CPPT
  app.post('/api/beds', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const fCode = req.sessionData!.facilityCode;
    const user = req.currentUser!;
    const body = req.body as Partial<InpatientBed>;
    if (!body.bedCode || !body.wardName) {
      res.status(400).json({ error: 'Kode Bed dan Nama Ruangan/Bangsal wajib diisi.' });
      return;
    }

    const newBed: InpatientBed = {
      id: `bed-${Date.now()}`,
      facilityCode: fCode,
      wardName: body.wardName.trim(),
      roomNumber: body.roomNumber || body.bedCode.trim().toUpperCase(),
      bedClass: body.bedClass || 'KELAS_1',
      bedCode: body.bedCode.trim().toUpperCase(),
      dailyRate: Number(body.dailyRate) || 350000,
      status: 'TERSEDIA',
    };

    db.beds.push(newBed);
    recordAudit(
      fCode,
      user.username,
      user.role,
      'BED_MASTER_CREATE',
      newBed.bedCode,
      `Penambahan tempat tidur rawat inap baru ${newBed.bedCode} (${newBed.wardName}).`
    );
    saveDatabase(db);
    res.status(201).json(newBed);
  });

  app.patch('/api/beds/:id/status', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const fCode = req.sessionData!.facilityCode;
    const user = req.currentUser!;
    const bed = db.beds.find((b) => b.id === req.params.id && b.facilityCode === fCode);
    if (!bed) {
      res.status(404).json({ error: 'Tempat tidur tidak ditemukan.' });
      return;
    }

    const { status, diagnosis, attendingDoctor } = req.body as {
      status?: InpatientBed['status'];
      diagnosis?: string;
      attendingDoctor?: string;
    };

    if (status && status !== 'TERISI') {
      bed.status = status;
      bed.patientId = undefined;
      bed.patientName = undefined;
      bed.mrNumber = undefined;
      bed.admittedAt = undefined;
      bed.attendingDoctor = undefined;
      bed.diagnosis = undefined;
    }
    if (diagnosis !== undefined && bed.status === 'TERISI') {
      bed.diagnosis = diagnosis;
    }
    if (attendingDoctor !== undefined && bed.status === 'TERISI') {
      bed.attendingDoctor = attendingDoctor;
    }

    recordAudit(
      fCode,
      user.username,
      user.role,
      'BED_STATUS_UPDATE',
      bed.bedCode,
      `Pembaruan status/CPPT bed ${bed.bedCode} (${bed.status}).`
    );
    saveDatabase(db);
    res.json(bed);
  });

  // 14c. Add Custom Billing Item to Invoice
  app.post('/api/invoices/:id/items', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const fCode = req.sessionData!.facilityCode;
    const user = req.currentUser!;
    const invoice = db.invoices.find((inv) => inv.id === req.params.id && inv.facilityCode === fCode);
    if (!invoice) {
      res.status(404).json({ error: 'Tagihan kasir tidak ditemukan.' });
      return;
    }

    const { category, description, quantity, unitPrice } = req.body as {
      category: BillingLineItem['category'];
      description: string;
      quantity: number;
      unitPrice: number;
    };

    if (!description || !quantity || quantity <= 0 || unitPrice === undefined) {
      res.status(400).json({ error: 'Deskripsi, Kuantitas (>0), dan Tarif Satuan wajib diisi.' });
      return;
    }

    const newItem: BillingLineItem = {
      id: `item-${Date.now()}`,
      category: category || 'TINDAKAN',
      description: description.trim(),
      quantity: Number(quantity),
      unitPrice: Number(unitPrice),
      subtotal: Number(quantity) * Number(unitPrice),
    };

    invoice.items.push(newItem);
    const recalculated = calculateInvoiceTotals(
      invoice.items,
      invoice.guarantor,
      invoice.discountAmount
    );
    invoice.subtotal = recalculated.subtotal;
    invoice.bpjsCoveredAmount = recalculated.bpjsCoveredAmount;
    invoice.patientPayableAmount = recalculated.patientPayableAmount;

    recordAudit(
      fCode,
      user.username,
      user.role,
      'CASHIER_ADD_BILLING_ITEM',
      invoice.invoiceNumber,
      `Penambahan item biaya "${newItem.description}" (Rp ${newItem.subtotal.toLocaleString('id-ID')}) pada tagihan ${invoice.invoiceNumber}.`
    );
    saveDatabase(db);
    res.json(invoice);
  });

  // 14d. Create Manual Operational Accounting Journal Entry
  app.post('/api/accounting', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const fCode = req.sessionData!.facilityCode;
    const user = req.currentUser!;
    const { accountCode, accountName, type, category, description, amount, referenceId } = req.body as {
      accountCode: string;
      accountName: string;
      type: 'PENDAPATAN' | 'PENGELUARAN';
      category: AccountingEntry['category'];
      description: string;
      amount: number;
      referenceId?: string;
    };

    if (!description || !amount || Number(amount) <= 0) {
      res.status(400).json({ error: 'Deskripsi jurnal dan Nominal (> 0) wajib diisi.' });
      return;
    }

    const now = new Date().toISOString();
    const newEntry: AccountingEntry = {
      id: `acc-${Date.now()}`,
      facilityCode: fCode,
      entryNumber: `JRN/${fCode.slice(0, 4)}/${now.slice(0, 10).replace(/-/g, '')}/${
        db.accountingEntries.length + 1
      }`,
      timestamp: now,
      accountCode: accountCode || (type === 'PENDAPATAN' ? '4-1090' : '5-3010'),
      accountName: accountName || (type === 'PENDAPATAN' ? 'Pendapatan Operasional Lainnya' : 'Beban Operasional Faskes'),
      type: type || 'PENGELUARAN',
      category: category || 'OPERASIONAL',
      description: description.trim(),
      amount: Number(amount),
      referenceId: referenceId?.trim() || `MAN-${Date.now().toString().slice(-5)}`,
    };

    db.accountingEntries.unshift(newEntry);
    recordAudit(
      fCode,
      user.username,
      user.role,
      'ACCOUNTING_JOURNAL_POST',
      newEntry.entryNumber,
      `Pencatatan jurnal ${newEntry.type} sebesar Rp ${newEntry.amount.toLocaleString('id-ID')}: ${newEntry.description}.`
    );
    saveDatabase(db);
    res.status(201).json(newEntry);
  });

  // 14e. Owner / Superuser Exclusive: Reconcile BPJS Claim or Settle Receivable into Cash Ledger
  app.post(
    '/api/finance/reconcile-claim',
    requireAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const fCode = req.sessionData!.facilityCode;
      const user = req.currentUser!;
      if (user.role !== 'OWNER' && user.role !== 'SUPERUSER') {
        res.status(403).json({
          error: 'Akses ditolak: Hanya role OWNER atau SUPERUSER yang dapat melakukan rekonsiliasi keuangan.',
        });
        return;
      }

      const { invoiceId } = req.body as { invoiceId: string };
      const invoice = db.invoices.find(
        (inv) => inv.id === invoiceId && inv.facilityCode === fCode
      );
      if (!invoice) {
        res.status(404).json({ error: 'Data invoice/klaim tidak ditemukan.' });
        return;
      }

      const now = new Date().toISOString();
      invoice.status = 'LUNAS';
      invoice.paidAt = now;
      invoice.cashierName = `${user.fullName} (Otorisasi Keuangan)`;

      const claimAmount =
        invoice.guarantor === 'BPJS_KESEHATAN'
          ? invoice.bpjsCoveredAmount
          : invoice.patientPayableAmount || invoice.subtotal;

      const entry: AccountingEntry = {
        id: `acc-${Date.now()}`,
        facilityCode: fCode,
        entryNumber: `JRN/${fCode.slice(0, 4)}/${now.slice(0, 10).replace(/-/g, '')}/${
          db.accountingEntries.length + 1
        }`,
        timestamp: now,
        accountCode: '4-1015',
        accountName: 'Pencairan Klaim JKN BPJS / Piutang Korporasi',
        type: 'PENDAPATAN',
        category: invoice.guarantor === 'BPJS_KESEHATAN' ? 'KLAIM_BPJS' : 'LAYANAN_MEDIS',
        description: `Pencairan & Rekonsiliasi Klaim ${invoice.invoiceNumber} — ${invoice.patientName} (${invoice.guarantor})`,
        amount: claimAmount,
        referenceId: invoice.invoiceNumber,
      };

      db.accountingEntries.unshift(entry);
      recordAudit(
        fCode,
        user.username,
        user.role,
        'FINANCE_CLAIM_RECONCILED',
        invoice.invoiceNumber,
        `Pencairan klaim/piutang ${invoice.invoiceNumber} sebesar Rp ${claimAmount.toLocaleString(
          'id-ID'
        )} oleh ${user.username}.`
      );
      saveDatabase(db);
      res.json({ invoice, entry });
    }
  );

  // 15. SATUSEHAT / BPJS / IoMT Manual Sync & Telemetry Dispatch
  app.post('/api/bridging/sync', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const fCode = req.sessionData!.facilityCode;
    const user = req.currentUser!;
    const { targetSystem, resourceType, patientName, payloadPreview } = req.body as {
      targetSystem: 'SATUSEHAT_FHIR_R4' | 'BPJS_PCARE' | 'BPJS_VCLAIM' | 'IOMT_GATEWAY';
      resourceType: string;
      patientName: string;
      payloadPreview?: Record<string, unknown>;
    };

    const now = new Date().toISOString();
    const logEntry = {
      id: `brg-${Date.now()}`,
      facilityCode: fCode,
      targetSystem: targetSystem || 'SATUSEHAT_FHIR_R4',
      resourceType: resourceType || 'FHIR R4 Encounter & Observation Sync',
      referenceId: `SYNC-${Date.now().toString().slice(-6)}`,
      patientName: patientName || 'Sinkronisasi Kolektif Fasilitas',
      status: 'TERKIRIM_200' as const,
      externalId: `urn:uuid:${crypto.randomUUID()}`,
      latencyMs: Math.floor(95 + Math.random() * 85),
      payloadPreview: payloadPreview || {
        facilityCode: fCode,
        timestamp: now,
        status: 'HTTP 200 OK - Validated by National Health Gateway',
      },
      timestamp: now,
    };

    db.bridgingLogs.unshift(logEntry);
    recordAudit(
      fCode,
      user.username,
      user.role,
      'BRIDGING_MANUAL_SYNC',
      logEntry.targetSystem,
      `Sinkronisasi ${logEntry.resourceType} berhasil (ID: ${logEntry.externalId}).`
    );
    saveDatabase(db);
    res.status(201).json(logEntry);
  });

  // ============================================================================
  // SUPERUSER EXCLUSIVE ROUTES (Full Privilege over Users, Facilities, & System)
  // ============================================================================

  // 16. Superuser: Register New User Account (No public registration exists)
  app.post(
    '/api/superuser/users',
    requireAuth,
    requireSuperuser,
    (req: AuthenticatedRequest, res: Response) => {
      const actor = req.currentUser!;
      const body = req.body as {
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
      };

      if (!body.username || !body.fullName || !body.role) {
        res.status(400).json({
          error: 'Username, Nama Lengkap, dan Role wajib diisi oleh Superuser.',
        });
        return;
      }

      const normalizedUsername = body.username.trim().toLowerCase();
      if (db.users.some((u) => u.username.toLowerCase() === normalizedUsername)) {
        res.status(409).json({
          error: `Username "${normalizedUsername}" sudah terdaftar di sistem.`,
        });
        return;
      }

      const facilities =
        body.role === 'SUPERUSER'
          ? ['*']
          : Array.isArray(body.allowedFacilities) && body.allowedFacilities.length > 0
          ? body.allowedFacilities.map((f) => normalizeFacilityCode(f))
          : [req.sessionData!.facilityCode];

      const privileges =
        Array.isArray(body.customPrivileges) && body.customPrivileges.length > 0
          ? body.customPrivileges
          : [...ROLE_DEFAULT_MODULES[body.role]];

      const newUser: UserAccount & { passwordHash: string } = {
        id: `usr-${Date.now()}`,
        username: normalizedUsername,
        fullName: body.fullName.trim(),
        nipOrSip: (body.nipOrSip || `NIP-${Date.now().toString().slice(-6)}`).trim(),
        email: (body.email || `${normalizedUsername}@kael-simrs.id`).trim(),
        role: body.role,
        allowedFacilities: facilities,
        customPrivileges: privileges,
        specialization: body.specialization?.trim() || '',
        polyclinic: body.polyclinic?.trim() || 'UMUM',
        active: true,
        createdBy: actor.username,
        createdAt: new Date().toISOString(),
        passwordHash: hashPassword(body.password || 'kael2026'),
      };

      db.users.push(newUser);
      recordAudit(
        req.sessionData!.facilityCode,
        actor.username,
        actor.role,
        'SUPERUSER_PROVISION_USER',
        newUser.username,
        `Superuser mendaftarkan pengguna baru ${newUser.fullName} (@${newUser.username}) dengan role ${
          newUser.role
        } dan akses fasilitas [${newUser.allowedFacilities.join(', ')}].`
      );
      saveDatabase(db);
      res.status(201).json(sanitizeUser(newUser));
    }
  );

  // 17. Superuser: Update Existing User (Role, Allowed Facilities, Active Status, Password Reset)
  app.put(
    '/api/superuser/users/:id',
    requireAuth,
    requireSuperuser,
    (req: AuthenticatedRequest, res: Response) => {
      const actor = req.currentUser!;
      const targetUser = db.users.find((u) => u.id === req.params.id);
      if (!targetUser) {
        res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
        return;
      }

      const body = req.body as Partial<UserAccount> & { newPassword?: string };
      if (body.fullName) targetUser.fullName = body.fullName.trim();
      if (body.nipOrSip) targetUser.nipOrSip = body.nipOrSip.trim();
      if (body.email) targetUser.email = body.email.trim();
      if (body.role) {
        targetUser.role = body.role;
        if (body.role === 'SUPERUSER') {
          targetUser.allowedFacilities = ['*'];
        }
      }
      if (Array.isArray(body.allowedFacilities) && targetUser.role !== 'SUPERUSER') {
        targetUser.allowedFacilities = body.allowedFacilities.map((f) =>
          normalizeFacilityCode(f)
        );
      }
      if (Array.isArray(body.customPrivileges)) {
        targetUser.customPrivileges = body.customPrivileges;
      }
      if (body.specialization !== undefined) targetUser.specialization = body.specialization;
      if (body.polyclinic !== undefined) targetUser.polyclinic = body.polyclinic;
      if (typeof body.active === 'boolean') targetUser.active = body.active;
      if (body.newPassword && body.newPassword.trim().length >= 4) {
        targetUser.passwordHash = hashPassword(body.newPassword.trim());
      }

      recordAudit(
        req.sessionData!.facilityCode,
        actor.username,
        actor.role,
        'SUPERUSER_UPDATE_USER',
        targetUser.username,
        `Superuser memperbarui konfigurasi akun @${targetUser.username} (Role: ${
          targetUser.role
        }, Fasilitas: ${targetUser.allowedFacilities.join(', ')}, Aktif: ${targetUser.active}).`
      );
      saveDatabase(db);
      res.json(sanitizeUser(targetUser));
    }
  );

  // 18. Superuser: Create or Update Facility (e.g. KLINIK_JAMYLA, RSUD_MAJALAYA, etc.)
  app.post(
    '/api/superuser/facilities',
    requireAuth,
    requireSuperuser,
    (req: AuthenticatedRequest, res: Response) => {
      const actor = req.currentUser!;
      const body = req.body as Partial<Facility>;
      const code = normalizeFacilityCode(body.code || '');
      if (!code || !body.name) {
        res.status(400).json({
          error: 'Kode Fasilitas (misal: KLINIK_JAMYLA / RSUD_MAJALAYA) dan Nama Fasilitas wajib diisi.',
        });
        return;
      }

      const existing = db.facilities.find((f) => f.code === code);
      if (existing) {
        existing.name = body.name.trim();
        existing.type = body.type || existing.type;
        existing.kemenkesCode = body.kemenkesCode?.trim() || existing.kemenkesCode;
        existing.bpjsPcareCode = body.bpjsPcareCode?.trim() || existing.bpjsPcareCode;
        existing.satusehatOrgId = body.satusehatOrgId?.trim() || existing.satusehatOrgId;
        existing.address = body.address?.trim() || existing.address;
        existing.city = body.city?.trim() || existing.city;
        existing.phone = body.phone?.trim() || existing.phone;
        existing.serverNodeUrl = body.serverNodeUrl?.trim() || existing.serverNodeUrl;
        if (typeof body.active === 'boolean') existing.active = body.active;

        recordAudit(
          req.sessionData!.facilityCode,
          actor.username,
          actor.role,
          'SUPERUSER_FACILITY_UPDATE',
          code,
          `Superuser memperbarui konfigurasi fasilitas ${existing.name} (${code}).`
        );
        saveDatabase(db);
        res.json(existing);
        return;
      }

      const newFacility: Facility = {
        code,
        name: body.name.trim(),
        type: body.type || 'KLINIK_PRATAMA',
        kemenkesCode: body.kemenkesCode?.trim() || `3204${Math.floor(10000 + Math.random() * 89999)}`,
        bpjsPcareCode: body.bpjsPcareCode?.trim() || `0114B${Math.floor(100 + Math.random() * 899)}`,
        satusehatOrgId: body.satusehatOrgId?.trim() || `1000${Math.floor(10000 + Math.random() * 89999)}-${code}`,
        address: body.address?.trim() || 'Jl. Kesehatan Nasional No. 1',
        city: body.city?.trim() || 'Kab. Bandung',
        phone: body.phone?.trim() || '022-8000111',
        serverNodeUrl:
          body.serverNodeUrl?.trim() ||
          `https://node-${code.toLowerCase().replace(/_/g, '-')}.kael-health.id`,
        active: true,
        createdAt: new Date().toISOString(),
      };

      db.facilities.push(newFacility);
      recordAudit(
        req.sessionData!.facilityCode,
        actor.username,
        actor.role,
        'SUPERUSER_FACILITY_CREATE',
        newFacility.code,
        `Superuser menambahkan fasilitas kesehatan baru ${newFacility.name} (${newFacility.code}).`
      );
      saveDatabase(db);
      res.status(201).json(newFacility);
    }
  );

  // 19. Superuser: Update Server & National Gateway Configuration
  app.put(
    '/api/superuser/server-config',
    requireAuth,
    requireSuperuser,
    (req: AuthenticatedRequest, res: Response) => {
      const actor = req.currentUser!;
      const body = req.body as Partial<typeof db.serverConfig>;
      if (body.nodeName) db.serverConfig.nodeName = body.nodeName.trim();
      if (body.environment) db.serverConfig.environment = body.environment;
      if (body.satusehatBaseUrl) db.serverConfig.satusehatBaseUrl = body.satusehatBaseUrl.trim();
      if (body.bpjsBaseUrl) db.serverConfig.bpjsBaseUrl = body.bpjsBaseUrl.trim();
      if (body.iomtListenPort) db.serverConfig.iomtListenPort = Number(body.iomtListenPort);
      if (body.sessionTimeoutMinutes) {
        db.serverConfig.sessionTimeoutMinutes = Number(body.sessionTimeoutMinutes);
      }

      recordAudit(
        req.sessionData!.facilityCode,
        actor.username,
        actor.role,
        'SUPERUSER_SERVER_CONFIG',
        db.serverConfig.nodeName,
        `Superuser memperbarui konfigurasi node server & endpoint bridging nasional.`
      );
      saveDatabase(db);
      res.json(db.serverConfig);
    }
  );

  // 20. Superuser 15-Domain Configuration Engine: Publish New Versioned Snapshot
  app.put(
    '/api/superuser/facility-config/:facilityCode',
    requireAuth,
    requireSuperuser,
    (req: AuthenticatedRequest, res: Response) => {
      const actor = req.currentUser!;
      const targetCode = normalizeFacilityCode(req.params.facilityCode);
      const facility = db.facilities.find((f) => f.code === targetCode);
      if (!facility) {
        res.status(404).json({ error: `Fasilitas ${targetCode} tidak ditemukan.` });
        return;
      }

      const incoming = req.body as Partial<SuperuserFacilityConfigSnapshot>;
      const existingHistory = (db.facilityConfigs || []).filter(
        (c) => c.facilityCode === targetCode
      );
      const currentActive =
        existingHistory.find((c) => c.lifecycleStage === 'ACTIVE') ||
        buildDefaultFacilityConfigSnapshot(facility);

      const candidateCaps = Array.isArray(incoming.enabledSubCapabilities)
        ? incoming.enabledSubCapabilities
        : currentActive.enabledSubCapabilities;

      const evidenceList = (db.evidenceRegistry || []).filter(
        (ev) => ev.facilityCode === targetCode
      );

      // Validate that no newly requested critical capability has missing mandatory allOf dependencies
      const blockingErrors: string[] = [];
      for (const cap of candidateCaps) {
        const evalRes = evaluateSubCapabilityReadiness(cap, candidateCaps, evidenceList);
        if (evalRes.missingAllOf.length > 0) {
          blockingErrors.push(
            `${cap}: membutuhkan dependensi wajib [${evalRes.missingAllOf.join(', ')}]`
          );
        }
      }
      if (blockingErrors.length > 0) {
        res.status(400).json({
          error: `Validasi ServiceActivationManifest gagal: ${blockingErrors.join(' | ')}`,
        });
        return;
      }

      // Mark previous active configs as SUPERSEDED (immutable history)
      const nextVersion =
        Math.max(0, ...existingHistory.map((c) => c.configVersion || 1)) + 1;
      for (const oldCfg of existingHistory) {
        if (oldCfg.lifecycleStage === 'ACTIVE') {
          oldCfg.lifecycleStage = 'SUPERSEDED';
        }
      }

      const now = new Date().toISOString();
      const newSnapshot: SuperuserFacilityConfigSnapshot = {
        ...currentActive,
        ...incoming,
        configId: `cfg-${targetCode}-v${nextVersion}`,
        facilityCode: targetCode,
        configVersion: nextVersion,
        lifecycleStage: 'ACTIVE',
        publishedBy: actor.username,
        publishedAt: now,
        effectiveDate: incoming.effectiveDate || now.slice(0, 10),
        changeNotes:
          incoming.changeNotes?.trim() ||
          `Publikasi revisi konfigurasi v${nextVersion} oleh ${actor.username}`,
        enabledSubCapabilities: candidateCaps,
      };

      db.facilityConfigs = db.facilityConfigs || [];
      db.facilityConfigs.unshift(newSnapshot);
      facility.activeConfigVersion = nextVersion;

      recordAudit(
        targetCode,
        actor.username,
        actor.role,
        'SUPERUSER_CONFIG_PUBLISH',
        `CONFIG:${targetCode}:v${nextVersion}`,
        `Publikasi konfigurasi fasilitas ${targetCode} versi v${nextVersion} (${candidateCaps.length} sub-kapabilitas aktif). Catatan: ${newSnapshot.changeNotes}`
      );
      saveDatabase(db);
      res.json({
        activeConfig: newSnapshot,
        history: db.facilityConfigs.filter((c) => c.facilityCode === targetCode),
      });
    }
  );

  // 21. Superuser 15-Domain Configuration Engine: Non-Destructive Rollback to Previous Snapshot
  app.post(
    '/api/superuser/facility-config/:facilityCode/rollback',
    requireAuth,
    requireSuperuser,
    (req: AuthenticatedRequest, res: Response) => {
      const actor = req.currentUser!;
      const targetCode = normalizeFacilityCode(req.params.facilityCode);
      const facility = db.facilities.find((f) => f.code === targetCode);
      if (!facility) {
        res.status(404).json({ error: `Fasilitas ${targetCode} tidak ditemukan.` });
        return;
      }

      const { targetVersion, reason } = req.body as {
        targetVersion: number;
        reason?: string;
      };
      const existingHistory = (db.facilityConfigs || []).filter(
        (c) => c.facilityCode === targetCode
      );
      const sourceSnapshot = existingHistory.find(
        (c) => c.configVersion === Number(targetVersion)
      );
      if (!sourceSnapshot) {
        res.status(404).json({
          error: `Snapshot konfigurasi versi v${targetVersion} tidak ditemukan untuk ${targetCode}.`,
        });
        return;
      }

      const nextVersion =
        Math.max(0, ...existingHistory.map((c) => c.configVersion || 1)) + 1;
      for (const oldCfg of existingHistory) {
        if (oldCfg.lifecycleStage === 'ACTIVE') {
          oldCfg.lifecycleStage = 'SUPERSEDED';
        }
      }

      const now = new Date().toISOString();
      const rolledBackSnapshot: SuperuserFacilityConfigSnapshot = {
        ...sourceSnapshot,
        configId: `cfg-${targetCode}-v${nextVersion}`,
        configVersion: nextVersion,
        lifecycleStage: 'ACTIVE',
        publishedBy: actor.username,
        publishedAt: now,
        supersededFromVersion: sourceSnapshot.configVersion,
        changeNotes:
          reason?.trim() ||
          `Rollback non-destruktif ke snapshot v${sourceSnapshot.configVersion}`,
      };

      db.facilityConfigs.unshift(rolledBackSnapshot);
      facility.activeConfigVersion = nextVersion;

      recordAudit(
        targetCode,
        actor.username,
        actor.role,
        'SUPERUSER_CONFIG_ROLLBACK',
        `CONFIG:${targetCode}:v${nextVersion}`,
        `Rollback non-destruktif ${targetCode} ke konfigurasi v${sourceSnapshot.configVersion} sebagai revisi baru v${nextVersion}.`
      );
      saveDatabase(db);
      res.json({
        activeConfig: rolledBackSnapshot,
        history: db.facilityConfigs.filter((c) => c.facilityCode === targetCode),
      });
    }
  );

  // 22. Procurement: Create Purchase Order (PO) to PBF & Post Double-Entry Accrual Journal
  app.post('/api/procurement/po', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const fCode = req.sessionData!.facilityCode;
    const user = req.currentUser!;
    const body = req.body as {
      supplierPbfName: string;
      dueDate: string;
      invoicePbfNumber?: string;
      items: PurchaseOrderPbf['items'];
    };

    if (!body.supplierPbfName || !Array.isArray(body.items) || body.items.length === 0) {
      res.status(400).json({ error: 'Nama Distributor PBF dan daftar item pesanan wajib diisi.' });
      return;
    }

    const subtotalHna = body.items.reduce(
      (s, it) => s + Number(it.orderedQty) * Number(it.hnaUnitPrice),
      0
    );
    const discountTotal = body.items.reduce(
      (s, it) =>
        s +
        Math.round(
          Number(it.orderedQty) * Number(it.hnaUnitPrice) * ((Number(it.discountPct) || 0) / 100)
        ),
      0
    );
    const netHna = Math.max(0, subtotalHna - discountTotal);
    const ppnAmount = Math.round(netHna * 0.11);
    const grandTotalPayable = netHna + ppnAmount;
    const now = new Date().toISOString();

    const newPo: PurchaseOrderPbf = {
      id: `po-${Date.now()}`,
      facilityCode: fCode,
      poNumber: `PO/${fCode.slice(0, 4)}/${now.slice(0, 7).replace('-', '')}/${String(
        (db.purchaseOrders || []).length + 1
      ).padStart(3, '0')}`,
      supplierPbfName: body.supplierPbfName.trim(),
      orderDate: now.slice(0, 10),
      dueDate: body.dueDate || now.slice(0, 10),
      status: 'RECEIVED_FULL',
      items: body.items,
      subtotalHna,
      discountTotal,
      ppnAmount,
      grandTotalPayable,
      invoicePbfNumber: body.invoicePbfNumber?.trim() || `FAK-${Date.now().toString().slice(-6)}`,
      createdBy: user.fullName,
    };

    db.purchaseOrders = db.purchaseOrders || [];
    db.purchaseOrders.unshift(newPo);

    // Post balanced Double-Entry Journal for PBF inventory receipt & AP accrual
    const glEntry = createDoubleEntryJournalForEvent({
      tenantId: 'TENANT_KAEL_NUSANTARA',
      facilityCode: fCode,
      eventType: 'INVENTORY_RECEIVED_PBF',
      sourceTransactionId: newPo.poNumber,
      description: `Penerimaan Faktur PBF ${newPo.supplierPbfName} (${newPo.invoicePbfNumber})`,
      amount: netHna,
      secondaryAmount: ppnAmount,
      vatCreditable: false,
      costCenterCode: 'CC-FAR',
      actorName: user.fullName,
      timestamp: now,
    });
    db.doubleEntryJournals = db.doubleEntryJournals || [];
    db.doubleEntryJournals.unshift(glEntry);

    recordAudit(
      fCode,
      user.username,
      user.role,
      'PROCUREMENT_PO_CREATED',
      newPo.poNumber,
      `Penerbitan & penerimaan PO PBF ${newPo.poNumber} (${newPo.supplierPbfName}) senilai Rp ${grandTotalPayable.toLocaleString('id-ID')}.`
    );
    saveDatabase(db);
    res.status(201).json({ purchaseOrder: newPo, journal: glEntry });
  });

  // 23. Radiology RIS: Create or Verify Radiology Imaging Order
  app.post('/api/radiology', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const fCode = req.sessionData!.facilityCode;
    const user = req.currentUser!;
    const body = req.body as Partial<RadiologyOrderRis>;
    if (!body.patientName || !body.examName) {
      res.status(400).json({ error: 'Nama Pasien dan Jenis Pemeriksaan Radiologi wajib diisi.' });
      return;
    }
    const now = new Date().toISOString();
    const newRad: RadiologyOrderRis = {
      id: `rad-${Date.now()}`,
      facilityCode: fCode,
      visitId: body.visitId || `vis-${Date.now()}`,
      patientId: body.patientId || 'pat-01',
      patientName: body.patientName.trim(),
      mrNumber: body.mrNumber || 'RM-001',
      modality: body.modality || 'RONTGEN_THORAX',
      examName: body.examName.trim(),
      clinicalIndication: body.clinicalIndication?.trim() || 'Evaluasi diagnostik klinis',
      priority: body.priority || 'ROUTINE',
      status: body.findingsText ? 'EXPERTISE_VERIFIED' : 'ORDERED',
      accessionNumber: `ACC-${fCode.slice(0, 3)}-${Date.now().toString().slice(-5)}`,
      findingsText: body.findingsText?.trim() || 'Pemeriksaan pencitraan sedang diproses.',
      impressionConclusion:
        body.impressionConclusion?.trim() || 'Menunggu verifikasi ekspertise radiolog.',
      radiologistName: user.fullName,
      tariff: Number(body.tariff) || 185000,
      createdAt: now,
      verifiedAt: body.findingsText ? now : undefined,
    };
    db.radiologyOrders = db.radiologyOrders || [];
    db.radiologyOrders.unshift(newRad);
    saveDatabase(db);
    res.status(201).json(newRad);
  });

  // 24. Inter-Facility 7-State Referral Orchestration
  app.post('/api/referrals', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const fCode = req.sessionData!.facilityCode;
    const user = req.currentUser!;
    const activeFacility = db.facilities.find((f) => f.code === fCode)!;
    const body = req.body as Partial<ReferralOrchestrationRecord>;
    if (!body.patientName || !body.destinationFacilityName || !body.primaryIcd10Code) {
      res.status(400).json({
        error: 'Nama Pasien, Faskes Tujuan Rujukan, dan Kode ICD-10 wajib diisi.',
      });
      return;
    }

    const now = new Date().toISOString();
    const isSkdi4a = SKDI_4A_COMPETENCY_CODES.has(body.primaryIcd10Code.trim().toUpperCase());
    const newRef: ReferralOrchestrationRecord = {
      id: `ref-${Date.now()}`,
      referralNumber: `RUJ/${fCode.slice(0, 4)}/${now.slice(0, 10).replace(/-/g, '')}/${String(
        (db.referrals || []).length + 1
      ).padStart(3, '0')}`,
      patientId: body.patientId || 'pat-01',
      patientName: body.patientName.trim(),
      nik: body.nik || '-',
      bpjsNumber: body.bpjsNumber || '-',
      originFacilityCode: fCode,
      originFacilityName: activeFacility.name,
      destinationFacilityCode: body.destinationFacilityCode || 'RSUD_MAJALAYA',
      destinationFacilityName: body.destinationFacilityName.trim(),
      direction: body.direction || 'VERTICAL_TO_FKRTL',
      state: body.state || 'SENT_DISPATCHED',
      primaryIcd10Code: body.primaryIcd10Code.trim().toUpperCase(),
      primaryIcd10Name: body.primaryIcd10Name || body.primaryIcd10Code,
      isSkdi4aDiagnosis: isSkdi4a,
      hasTaccException: Boolean(body.hasTaccException),
      taccCategory: body.taccCategory,
      taccJustification: body.taccJustification,
      clinicalSummary: body.clinicalSummary || 'Pasien membutuhkan tatalaksana spesialistik lanjutan.',
      stabilizationProvided: body.stabilizationProvided || 'Tanda vital telah distabilkan sebelum pengiriman.',
      prbCarePlanNotes: body.prbCarePlanNotes,
      createdAt: now,
      updatedAt: now,
    };

    db.referrals = db.referrals || [];
    db.referrals.unshift(newRef);
    recordAudit(
      fCode,
      user.username,
      user.role,
      'REFERRAL_ORCHESTRATION_CREATE',
      newRef.referralNumber,
      `Rujukan ${newRef.direction} nomor ${newRef.referralNumber} untuk ${newRef.patientName} ke ${newRef.destinationFacilityName} (Status: ${newRef.state}).`
    );
    saveDatabase(db);
    res.status(201).json(newRef);
  });

  // Vite dev middleware or production static assets
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`KAEL SIMRS Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
