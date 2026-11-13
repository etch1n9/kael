import React, { useState } from 'react';
import {
  Building2,
  CheckCircle2,
  KeyRound,
  Lock,
  Server,
  ShieldCheck,
  UserCog,
  UserPlus,
} from 'lucide-react';
import {
  Facility,
  ModuleKey,
  SubCapabilityKey,
  UserAccount,
  UserRole,
} from '../types/simrs';
import { kaelApi, WorkspacePayload } from '../utils/apiClient';
import { normalizeFacilityCode, ROLE_DEFAULT_MODULES, ROLE_LABELS } from '../utils/clinicalLogic';
import {
  buildDefaultFacilityConfigSnapshot,
  evaluateSubCapabilityReadiness,
  resolveFacilityNavigation,
  SUB_CAPABILITY_CATALOG,
} from '../utils/platformEngine';
import { DataExportToolbar } from './DataExportToolbar';
import { ExportColumn } from '../utils/exportDocument';

interface SuperuserControlModuleProps {
  token: string;
  facilityCode: string;
  workspace: WorkspacePayload;
  onRefreshWorkspace: () => Promise<void>;
}

const ALL_MODULE_KEYS: { key: ModuleKey; label: string }[] = [
  { key: 'DASHBOARD', label: 'Ringkasan Eksekutif' },
  { key: 'SEMUA_PASIEN', label: 'Direktori Pasien MPI' },
  { key: 'PENDAFTARAN', label: 'Loket Pendaftaran & Antrean' },
  { key: 'JADWAL_DOKTER', label: 'Jadwal Praktik & Kuota Poli' },
  { key: 'RAWAT_INAP', label: 'Manajemen Tempat Tidur & Ranap' },
  { key: 'RME_DOKTER', label: 'Pemeriksaan Poliklinik & SOAP' },
  { key: 'IGD_TRIASE_EWS', label: 'IGD, Triase ATS 1-5 & Skor EWS' },
  { key: 'GIGI_ODONTOGRAM', label: 'Poli Gigi & Odontogram FDI' },
  { key: 'KIA_IMUNISASI', label: 'Kesehatan Ibu Anak, ANC & Imunisasi' },
  { key: 'PROLANIS_PRB', label: 'Penyakit Kronis, Prolanis & PRB' },
  { key: 'BEDAH_IBS', label: 'Instalasi Bedah Sentral & OK' },
  { key: 'MCU_SURAT_MEDIS', label: 'Medical Check-Up & Surat Medis' },
  { key: 'APOTEK', label: 'Antrean E-Resep & Dispensasi FEFO' },
  { key: 'KATALOG_OPNAME', label: 'Katalog Obat KFA & Stock Opname' },
  { key: 'MUTASI_STOK', label: 'Kartu Stok, Obat Masuk & Keluar' },
  { key: 'PENGADAAN_PBF', label: 'Pengadaan PO, Faktur PBF & Hutang' },
  { key: 'LABORATORIUM', label: 'Laboratorium Patologi Klinik' },
  { key: 'RADIOLOGI_RIS', label: 'Radiologi & Pencitraan RIS' },
  { key: 'PENUNJANG_RS', label: 'Gizi, Bank Darah, CSSD & IPSRS' },
  { key: 'KASIR_AKUNTANSI', label: 'Kasir, Tagihan & Split Bill' },
  { key: 'KEUANGAN_OWNER', label: 'Arus Kas, HPP & Laba Rugi' },
  { key: 'NERACA_GL', label: 'Neraca & Buku Besar Umum' },
  { key: 'KLAIM_BPJS_PIUTANG', label: 'Klaim BPJS, Casemix & Piutang' },
  { key: 'JASA_MEDIS_REMUN', label: 'Jasa Medis & Remunerasi Dokter' },
  { key: 'SDM_JADWAL', label: 'Jadwal Shift, SIP/STR & Kredensial' },
  { key: 'SDM_ERP', label: 'Absensi, Cuti & Penggajian SDM' },
  { key: 'LAPORAN_REGULASI', label: 'Laporan Kemenkes SIRS RL & LB' },
  { key: 'BRIDGING_SATUSEHAT', label: 'Integrasi SATUSEHAT, BPJS & TTE' },
  { key: 'SUPERUSER_CONTROL', label: 'Superuser & Konfigurasi Platform' },
];

export const SuperuserControlModule: React.FC<SuperuserControlModuleProps> = ({
  token,
  facilityCode,
  workspace,
  onRefreshWorkspace,
}) => {
  const [subTab, setSubTab] = useState<
    'USERS' | 'FACILITIES' | 'CAPABILITY_CONFIG' | 'SERVER_AUDIT'
  >('USERS');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const currentSnapshot =
    workspace.activeFacilityConfig ||
    buildDefaultFacilityConfigSnapshot(workspace.activeFacility);

  const [draftSubCaps, setDraftSubCaps] = useState<SubCapabilityKey[]>(
    currentSnapshot.enabledSubCapabilities
  );
  const [draftNotes, setDraftNotes] = useState(
    'Publikasi konfigurasi sub-kapabilitas, topologi layanan, dan parameter regulasi faskes'
  );
  const [isPublishingConfig, setIsPublishingConfig] = useState(false);

  // User Creation State
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('kael2026');
  const [fullName, setFullName] = useState('');
  const [nipOrSip, setNipOrSip] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('OWNER');
  const [specialization, setSpecialization] = useState('Manajemen Multi-Fasilitas');
  const [polyclinic, setPolyclinic] = useState('POLI_PENYAKIT_DALAM');
  const [selectedFacilities, setSelectedFacilities] = useState<string[]>([
    'KLINIK_JAMYLA',
    'RSUD_MAJALAYA',
  ]);
  const [selectedPrivileges, setSelectedPrivileges] = useState<ModuleKey[]>(
    ROLE_DEFAULT_MODULES.OWNER
  );
  const [isCreatingUser, setIsCreatingUser] = useState(false);

  // Password Reset / Edit Existing User State
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [editingAccessUser, setEditingAccessUser] = useState<UserAccount | null>(null);
  const [editUserRole, setEditUserRole] = useState<UserRole>('OWNER');
  const [editUserFacilities, setEditUserFacilities] = useState<string[]>([]);

  // Facility Creation State
  const [facCode, setFacCode] = useState('');
  const [facName, setFacName] = useState('');
  const [facType, setFacType] = useState<Facility['type']>('KLINIK_UTAMA');
  const [facKemenkes, setFacKemenkes] = useState('');
  const [facBpjs, setFacBpjs] = useState('');
  const [facSatusehat, setFacSatusehat] = useState('');
  const [facAddress, setFacAddress] = useState('');
  const [facCity, setFacCity] = useState('Kab. Bandung');
  const [facPhone, setFacPhone] = useState('');
  const [facNodeUrl, setFacNodeUrl] = useState('');
  const [isSavingFacility, setIsSavingFacility] = useState(false);

  // Server Config State
  const [nodeName, setNodeName] = useState(workspace.serverConfig.nodeName);
  const [satusehatBaseUrl, setSatusehatBaseUrl] = useState(
    workspace.serverConfig.satusehatBaseUrl
  );
  const [bpjsBaseUrl, setBpjsBaseUrl] = useState(workspace.serverConfig.bpjsBaseUrl);
  const [iomtPort, setIomtPort] = useState(workspace.serverConfig.iomtListenPort);
  const [sessionTimeout, setSessionTimeout] = useState(
    workspace.serverConfig.sessionTimeoutMinutes
  );

  if (workspace.user.role !== 'SUPERUSER') {
    return (
      <div className="bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900 rounded-xl p-8 text-center">
        <Lock className="w-8 h-8 text-red-600 mx-auto mb-2" />
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
          Akses Terbatas Khusus SUPERUSER
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Hanya role SUPERUSER yang memiliki hak akses penuh untuk mendaftarkan akun pengguna baru, mengatur multi-fasilitas, dan memodifikasi parameter inti server.
        </p>
      </div>
    );
  }

  const handleRoleChange = (newRole: UserRole) => {
    setRole(newRole);
    setSelectedPrivileges([...ROLE_DEFAULT_MODULES[newRole]]);
    if (newRole === 'SUPERUSER') {
      setSelectedFacilities(['*']);
    } else if (selectedFacilities.includes('*')) {
      setSelectedFacilities(['KLINIK_JAMYLA', 'RSUD_MAJALAYA']);
    }
  };

  const toggleFacilityForNewUser = (code: string) => {
    setSelectedFacilities((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const togglePrivilegeForNewUser = (mod: ModuleKey) => {
    setSelectedPrivileges((prev) =>
      prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod]
    );
  };

  const handleCreateUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (!username.trim() || !fullName.trim()) {
      setFeedback({ type: 'error', text: 'Username dan Nama Lengkap wajib diisi.' });
      return;
    }
    if (role !== 'SUPERUSER' && selectedFacilities.length === 0) {
      setFeedback({
        type: 'error',
        text: 'Pilih minimal 1 kode FASILITAS untuk akun ini.',
      });
      return;
    }
    setIsCreatingUser(true);
    try {
      const created = await kaelApi.superuserCreateUser(token, facilityCode, {
        username: username.trim(),
        password,
        fullName: fullName.trim(),
        nipOrSip: nipOrSip.trim(),
        email: email.trim(),
        role,
        allowedFacilities: role === 'SUPERUSER' ? ['*'] : selectedFacilities,
        customPrivileges: selectedPrivileges,
        specialization,
        polyclinic,
      });
      setUsername('');
      setFullName('');
      setNipOrSip('');
      setEmail('');
      await onRefreshWorkspace();
      setFeedback({
        type: 'success',
        text: `Akun pengguna baru @${created.username} (${created.fullName}) dengan role ${created.role} berhasil didaftarkan oleh Superuser.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal mendaftarkan pengguna baru.',
      });
    } finally {
      setIsCreatingUser(false);
    }
  };

  const handleToggleUserActive = async (target: UserAccount) => {
    setFeedback(null);
    try {
      const updated = await kaelApi.superuserUpdateUser(token, facilityCode, target.id, {
        active: !target.active,
      });
      await onRefreshWorkspace();
      setFeedback({
        type: 'success',
        text: `Status akun @${updated.username} diperbarui menjadi ${
          updated.active ? 'AKTIF' : 'DINONAKTIFKAN'
        }.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal memperbarui status pengguna.',
      });
    }
  };

  const handleResetUserPassword = async (target: UserAccount) => {
    if (!resetPasswordValue.trim()) return;
    setFeedback(null);
    try {
      await kaelApi.superuserUpdateUser(token, facilityCode, target.id, {
        newPassword: resetPasswordValue.trim(),
      });
      setEditingUserId(null);
      setResetPasswordValue('');
      await onRefreshWorkspace();
      setFeedback({
        type: 'success',
        text: `Kata sandi untuk @${target.username} berhasil direset oleh Superuser.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal mereset kata sandi.',
      });
    }
  };

  const handleSaveUserAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAccessUser) return;
    setFeedback(null);
    try {
      const updated = await kaelApi.superuserUpdateUser(
        token,
        facilityCode,
        editingAccessUser.id,
        {
          role: editUserRole,
          allowedFacilities: editUserRole === 'SUPERUSER' ? ['*'] : editUserFacilities,
          customPrivileges: ROLE_DEFAULT_MODULES[editUserRole],
        }
      );
      setEditingAccessUser(null);
      await onRefreshWorkspace();
      setFeedback({
        type: 'success',
        text: `Otorisasi akun @${updated.username} berhasil diperbarui.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal memperbarui otorisasi fasilitas akun.',
      });
    }
  };

  const handleExportFullBackupJson = () => {
    const payload = JSON.stringify(workspace, null, 2);
    const blob = new Blob([payload], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute(
      'download',
      `kael-simrs-backup-${facilityCode.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleSaveFacilitySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const cleanCode = normalizeFacilityCode(facCode);
    if (!cleanCode || !facName.trim()) {
      setFeedback({
        type: 'error',
        text: 'Kode Fasilitas dan Nama Fasilitas wajib diisi.',
      });
      return;
    }
    setIsSavingFacility(true);
    try {
      const saved = await kaelApi.superuserSaveFacility(token, facilityCode, {
        code: cleanCode,
        name: facName.trim(),
        type: facType,
        kemenkesCode: facKemenkes.trim(),
        bpjsPcareCode: facBpjs.trim(),
        satusehatOrgId: facSatusehat.trim(),
        address: facAddress.trim(),
        city: facCity.trim(),
        phone: facPhone.trim(),
        serverNodeUrl: facNodeUrl.trim(),
      });
      setFacCode('');
      setFacName('');
      await onRefreshWorkspace();
      setFeedback({
        type: 'success',
        text: `Fasilitas kesehatan ${saved.name} (${saved.code}) berhasil disimpan di registri server.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal menyimpan fasilitas.',
      });
    } finally {
      setIsSavingFacility(false);
    }
  };

  const handleSaveServerConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      await kaelApi.superuserUpdateServerConfig(token, facilityCode, {
        nodeName,
        satusehatBaseUrl,
        bpjsBaseUrl,
        iomtListenPort: Number(iomtPort),
        sessionTimeoutMinutes: Number(sessionTimeout),
      });
      await onRefreshWorkspace();
      setFeedback({
        type: 'success',
        text: 'Konfigurasi node server & endpoint integrasi nasional berhasil diperbarui.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal memperbarui konfigurasi server.',
      });
    }
  };

  const toggleSubCap = (code: SubCapabilityKey) => {
    setDraftSubCaps((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const handlePublishCapabilityConfig = async () => {
    setFeedback(null);
    setIsPublishingConfig(true);
    try {
      const res = await kaelApi.superuserPublishFacilityConfig(
        token,
        facilityCode,
        facilityCode,
        {
          enabledSubCapabilities: draftSubCaps,
          changeNotes: draftNotes,
        }
      );
      const published = res.activeConfig;
      await onRefreshWorkspace();
      setFeedback({
        type: 'success',
        text: `Snapshot Konfigurasi v${published.configVersion} berhasil dipublikasikan untuk ${facilityCode} (${published.enabledSubCapabilities.length} sub-kapabilitas aktif).`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Gagal mempublikasikan snapshot konfigurasi fasilitas.',
      });
    } finally {
      setIsPublishingConfig(false);
    }
  };

  const handleRollbackCapabilityConfig = async (targetVersion: number) => {
    setFeedback(null);
    setIsPublishingConfig(true);
    try {
      const res = await kaelApi.superuserRollbackFacilityConfig(
        token,
        facilityCode,
        facilityCode,
        {
          targetVersion,
          reason: `Rollback non-destruktif ke snapshot v${targetVersion}`,
        }
      );
      const rolled = res.activeConfig;
      setDraftSubCaps(rolled.enabledSubCapabilities);
      await onRefreshWorkspace();
      setFeedback({
        type: 'success',
        text: `Berhasil melakukan rollback non-destruktif ke revisi baru v${rolled.configVersion} berdasarkan snapshot v${targetVersion}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal melakukan rollback konfigurasi.',
      });
    } finally {
      setIsPublishingConfig(false);
    }
  };

  const previewNavItems = resolveFacilityNavigation(
    {
      ...currentSnapshot,
      enabledSubCapabilities: draftSubCaps,
    },
    workspace.user,
    facilityCode
  );

  const suExportColumns: ExportColumn<Record<string, unknown>>[] =
    subTab === 'FACILITIES'
      ? [
          { key: 'code', header: 'Kode Fasilitas' },
          { key: 'name', header: 'Nama Fasilitas' },
          { key: 'type', header: 'Tipe' },
          { key: 'city', header: 'Kota / Kab' },
          { key: 'kemenkesCode', header: 'Kode Kemenkes' },
          { key: 'bpjsPcareCode', header: 'Kode BPJS' },
        ]
      : subTab === 'SERVER_AUDIT'
      ? [
          { key: 'timestamp', header: 'Waktu' },
          { key: 'actorName', header: 'Pengguna' },
          { key: 'actorRole', header: 'Role' },
          { key: 'facilityCode', header: 'Fasilitas' },
          { key: 'action', header: 'Aksi' },
          { key: 'detail', header: 'Detail Audit' },
        ]
      : [
          { key: 'username', header: 'Username' },
          { key: 'fullName', header: 'Nama Lengkap & Gelar' },
          { key: 'role', header: 'Role Otorisasi', format: (r) => ROLE_LABELS[r.role as UserRole] || String(r.role) },
          { key: 'nipOrSip', header: 'NIP / SIP / STR' },
          {
            key: 'allowedFacilities',
            header: 'Fasilitas Diizinkan',
            format: (r) =>
              Array.isArray(r.allowedFacilities) ? r.allowedFacilities.join(', ') : '*',
          },
          { key: 'active', header: 'Status', format: (r) => (r.active ? 'AKTIF' : 'NONAKTIF') },
        ];

  const suExportRows = (
    subTab === 'FACILITIES'
      ? workspace.allFacilities
      : subTab === 'SERVER_AUDIT'
      ? workspace.auditLogs
      : workspace.allUsers
  ) as unknown as Record<string, unknown>[];

  return (
    <div className="space-y-5">
      {/* Superuser Header & Sub-Tabs */}
      <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[#00897B] flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4" />
              OTORITAS PENUH SUPERUSER • KONFIGURASI KAPABILITAS &amp; MULTI-FASILITAS
            </div>
            <h1 className="text-xl font-bold text-[#0F2922] dark:text-white mt-0.5 tracking-tight">
              Superuser 15-domain configuration engine, katalog kapabilitas &amp; hak akses
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => setSubTab('USERS')}
            className={`px-4 py-2 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
              subTab === 'USERS'
                ? 'bg-[#00897B] text-white'
                : 'bg-[#F3F8F6] dark:bg-[#081916] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
            }`}
          >
            <UserCog className="w-3.5 h-3.5" />
            1. Pendaftaran &amp; Hak Akses Akun ({workspace.allUsers.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('CAPABILITY_CONFIG')}
            className={`px-4 py-2 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
              subTab === 'CAPABILITY_CONFIG'
                ? 'bg-[#00897B] text-white'
                : 'bg-[#F3F8F6] dark:bg-[#081916] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            2. Katalog Sub-Kapabilitas &amp; 15-Domain Engine (v{currentSnapshot.configVersion})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('FACILITIES')}
            className={`px-4 py-2 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
              subTab === 'FACILITIES'
                ? 'bg-[#00897B] text-white'
                : 'bg-[#F3F8F6] dark:bg-[#081916] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            3. Master Fasilitas Klinik &amp; RS ({workspace.allFacilities.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('SERVER_AUDIT')}
            className={`px-4 py-2 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
              subTab === 'SERVER_AUDIT'
                ? 'bg-[#00897B] text-white'
                : 'bg-[#F3F8F6] dark:bg-[#081916] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            4. Konfigurasi Server &amp; Audit ({workspace.auditLogs.length})
          </button>
        </div>
      </div>

      {feedback && (
        <div
          role="status"
          className={`p-3.5 rounded-xl border text-xs font-medium flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
              : 'bg-red-50 dark:bg-red-950/60 border-red-200 dark:border-red-800 text-red-900 dark:text-red-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="underline ml-4 whitespace-nowrap"
          >
            Tutup
          </button>
        </div>
      )}

      {/* SUB-TAB 1: PROVISIONING & PENGATURAN USER (NO PUBLIC REGISTRATION) */}
      {subTab === 'USERS' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left 5 Cols: Register New User Account with Multi-Facility & Granular Privileges */}
          <form
            onSubmit={handleCreateUserSubmit}
            className="lg:col-span-5 bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-5 space-y-4"
          >
            <div>
              <h2 className="text-sm font-bold text-[#0F2922] dark:text-white flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-[#00897B]" />
                Pendaftaran Akun Pekerja / Nakes / Owner Baru
              </h2>
              <p className="text-xs text-[#52736B] mt-0.5">
                Kelola akun tenaga medis dan staf fasilitas beserta hak akses modul.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="su-username"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Username Login
                </label>
                <input
                  id="su-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="misal: bidan.fitri atau perawat.siti"
                  required
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label
                  htmlFor="su-password"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Kata Sandi Awal
                </label>
                <input
                  id="su-password"
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="su-fullname"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                Nama Lengkap &amp; Gelar Profesi
              </label>
              <input
                id="su-fullname"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Ns. Siti Rahmawati, S.Kep / Bdn. Fitri, S.Tr.Keb"
                required
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="su-role"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Jenis Akun / Role Profesi
                </label>
                <select
                  id="su-role"
                  value={role}
                  onChange={(e) => handleRoleChange(e.target.value as UserRole)}
                  className="w-full px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="OWNER">OWNER — Pemilik Fasilitas</option>
                  <option value="MANAJER_KLINIK">MANAJER_KLINIK — Kepala Faskes</option>
                  <option value="DOKTER">DOKTER — Dokter Umum / Spesialis</option>
                  <option value="DOKTER_GIGI">DOKTER_GIGI — Dokter Gigi</option>
                  <option value="PERAWAT">PERAWAT — Keperawatan &amp; Triase</option>
                  <option value="BIDAN">BIDAN — Kebidanan &amp; KIA</option>
                  <option value="APOTEKER">APOTEKER — Instalasi Farmasi</option>
                  <option value="ANALIS_LAB">ANALIS_LAB — Laboratorium Patologi</option>
                  <option value="RADIOLOG">RADIOLOG — Radiologi &amp; Diagnostik</option>
                  <option value="KASIR">KASIR — Kasir &amp; Klaim</option>
                  <option value="ADM_PENDAFTARAN">ADM_PENDAFTARAN — Loket Admisi</option>
                  <option value="HRD_SDM">HRD_SDM — Kepegawaian &amp; SDM</option>
                  <option value="SUPERUSER">SUPERUSER — Otoritas Penuh</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="su-nip"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Nomor NIP / SIP / STR
                </label>
                <input
                  id="su-nip"
                  type="text"
                  value={nipOrSip}
                  onChange={(e) => setNipOrSip(e.target.value)}
                  placeholder="SIP.3204/2026/0091"
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>

            {/* Multi-Facility Assignment Checkboxes */}
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
              <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200 mb-1.5">
                Otorisasi Fasilitas Kesehatan
              </label>
              {role === 'SUPERUSER' ? (
                <div className="p-2.5 rounded-lg bg-teal-50/70 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 text-xs font-mono text-teal-800 dark:text-teal-300">
                  Role SUPERUSER mendapatkan akses penuh ke seluruh fasilitas.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {workspace.allFacilities.map((fac) => {
                    const checked = selectedFacilities.includes(fac.code);
                    return (
                      <label
                        key={fac.code}
                        className="flex items-center justify-between p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-xs cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleFacilityForNewUser(fac.code)}
                            className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                          />
                          <span className="font-mono font-bold text-teal-800 dark:text-teal-300">
                            {fac.code}
                          </span>
                          <span className="text-slate-600 dark:text-slate-400 truncate">
                            — {fac.name}
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Granular Module Privileges */}
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
              <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200 mb-1.5">
                Hak Akses Modul
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {ALL_MODULE_KEYS.filter((m) => m.key !== 'SUPERUSER_CONTROL').map((mod) => (
                  <label
                    key={mod.key}
                    className="flex items-center gap-2 text-xs p-1.5 rounded border border-slate-200 dark:border-slate-800 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={
                        role === 'SUPERUSER' || selectedPrivileges.includes(mod.key)
                      }
                      disabled={role === 'SUPERUSER'}
                      onChange={() => togglePrivilegeForNewUser(mod.key)}
                      className="rounded border-slate-300 text-teal-700"
                    />
                    <span className="truncate">{mod.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={isCreatingUser}
              className="w-full py-2.5 px-4 rounded-xl bg-[#00897B] hover:bg-[#00796B] text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              {isCreatingUser
                ? 'Mendaftarkan Akun...'
                : 'Daftarkan Akun & Aktifkan Hak Akses'}
            </button>
          </form>

          {/* Right 7 Cols: All Registered Users Directory & Privilege Editor */}
          <div className="lg:col-span-7 bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Daftar Seluruh Akun Terdaftar di Server ({workspace.allUsers.length})
              </h2>
              <DataExportToolbar
                title="Daftar Seluruh Akun Pekerja & Otorisasi Role"
                filenameBase={`KAEL_Superuser_Users_${facilityCode}`}
                facilityName={workspace.activeFacility.name}
                facilityCode={facilityCode}
                columns={suExportColumns}
                rows={suExportRows}
                compact
                contextLabel="Ekspor Akun"
              />
            </div>

            {editingAccessUser && (
              <form
                onSubmit={handleSaveUserAccess}
                className="m-4 p-4 rounded-xl border border-[#00897B] bg-slate-50 dark:bg-slate-800/60 space-y-3 text-xs"
              >
                <div className="flex items-center justify-between">
                  <div className="font-bold text-slate-900 dark:text-slate-100">
                    Edit Role &amp; Otorisasi Fasilitas — @{editingAccessUser.username} (
                    {editingAccessUser.fullName})
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingAccessUser(null)}
                    className="text-slate-500 underline"
                  >
                    Tutup
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold mb-1">Role Sistem</label>
                    <select
                      value={editUserRole}
                      onChange={(e) => setEditUserRole(e.target.value as UserRole)}
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    >
                      <option value="SUPERUSER">SUPERUSER</option>
                      <option value="OWNER">OWNER</option>
                      <option value="MANAJER_KLINIK">MANAJER KLINIK / RS</option>
                      <option value="DOKTER">DOKTER UMUM / SPESIALIS</option>
                      <option value="DOKTER_GIGI">DOKTER GIGI</option>
                      <option value="PERAWAT">PERAWAT</option>
                      <option value="BIDAN">BIDAN KIA &amp; ANC</option>
                      <option value="APOTEKER">APOTEKER FARMASI</option>
                      <option value="ANALIS_LAB">ANALIS LABORATORIUM</option>
                      <option value="RADIOLOG">RADIOLOG DIAGNOSTIK</option>
                      <option value="KASIR">KASIR &amp; KLAIM</option>
                      <option value="ADM_PENDAFTARAN">ADMISI &amp; PENDAFTARAN</option>
                      <option value="HRD_SDM">HRD &amp; KEPEGAWAIAN SDM</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">
                      Otorisasi Kode Fasilitas
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {workspace.allFacilities.map((f) => {
                        const checked =
                          editUserRole === 'SUPERUSER' ||
                          editUserFacilities.includes(f.code);
                        return (
                          <label
                            key={f.code}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-[11px]"
                          >
                            <input
                              type="checkbox"
                              disabled={editUserRole === 'SUPERUSER'}
                              checked={checked}
                              onChange={() =>
                                setEditUserFacilities((prev) =>
                                  prev.includes(f.code)
                                    ? prev.filter((c) => c !== f.code)
                                    : [...prev, f.code]
                                )
                              }
                            />
                            <span>{f.code}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded bg-teal-700 text-white font-semibold cursor-pointer"
                  >
                    Simpan Perubahan Akses
                  </button>
                </div>
              </form>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 bg-slate-50/70 dark:bg-slate-800/50">
                    <th className="py-2.5 px-3">Username &amp; Nama</th>
                    <th className="py-2.5 px-2.5">Role &amp; Status</th>
                    <th className="py-2.5 px-2.5">Fasilitas Diizinkan</th>
                    <th className="py-2.5 px-3 text-right">Kendali Superuser</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {workspace.allUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-3">
                        <div className="font-mono font-bold text-slate-900 dark:text-slate-100">
                          @{u.username}
                        </div>
                        <div className="text-xs text-slate-700 dark:text-slate-300 leading-snug">
                          {u.fullName}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500">
                          {u.nipOrSip}
                        </div>
                      </td>
                      <td className="py-2.5 px-2.5 font-mono whitespace-nowrap">
                        <div className="font-semibold text-teal-800 dark:text-teal-300">
                          {u.role}
                        </div>
                        <div
                          className={`text-[11px] font-semibold ${
                            u.active
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {u.active ? 'AKTIF' : 'NONAKTIF'}
                        </div>
                      </td>
                      <td className="py-2.5 px-2.5 font-mono text-[11px] text-slate-700 dark:text-slate-300 max-w-[190px]">
                        {u.allowedFacilities.includes('*')
                          ? 'SEMUA FASILITAS'
                          : u.allowedFacilities.join(', ')}
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        {editingUserId === u.id ? (
                          <div className="inline-flex items-center gap-1">
                            <input
                              type="text"
                              value={resetPasswordValue}
                              onChange={(e) => setResetPasswordValue(e.target.value)}
                              placeholder="Sandi baru..."
                              className="w-24 px-2 py-1 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                            />
                            <button
                              type="button"
                              onClick={() => handleResetUserPassword(u)}
                              className="px-2 py-1 text-[11px] font-semibold rounded bg-teal-700 text-white cursor-pointer"
                            >
                              Simpan
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingUserId(null)}
                              className="px-2 py-1 text-[11px] rounded border border-slate-300 dark:border-slate-700"
                            >
                              Batal
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingAccessUser(u);
                                setEditUserRole(u.role);
                                setEditUserFacilities(
                                  u.allowedFacilities.includes('*')
                                    ? workspace.allFacilities.map((f) => f.code)
                                    : [...u.allowedFacilities]
                                );
                              }}
                              className="px-2 py-1 text-[11px] font-medium rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            >
                              Edit Akses
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingUserId(u.id);
                                setResetPasswordValue('');
                              }}
                              className="px-2 py-1 text-[11px] font-medium rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1 cursor-pointer"
                            >
                              <KeyRound className="w-3 h-3" />
                              Reset Sandi
                            </button>
                            {u.username !== 'superuser' && (
                              <button
                                type="button"
                                onClick={() => handleToggleUserActive(u)}
                                className="px-2 py-1 text-[11px] font-medium rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                              >
                                {u.active ? 'Nonaktifkan' : 'Aktifkan'}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: KATALOG SUB-KAPABILITAS & 15-DOMAIN CONFIGURATION ENGINE (P0-01 to P0-04) */}
      {subTab === 'CAPABILITY_CONFIG' && (
        <div className="space-y-5">
          {/* Top Snapshot Header & Transactional Publish / Non-Destructive Rollback */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                <span className="px-2 py-0.5 rounded bg-teal-100 dark:bg-teal-950 text-teal-800 dark:text-teal-300 font-bold">
                  Versi Aktif v{currentSnapshot.configVersion}
                </span>
                <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  Status: {currentSnapshot.lifecycleStage}
                </span>
                <span className="text-slate-500">
                  Tenant: {currentSnapshot.tenantId} · Faskes: {facilityCode}
                </span>
              </div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 mt-1">
                Katalog 27 Sub-Kapabilitas Independen &amp; 15-Domain Superuser Engine
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Aktivasi transaksional dan riwayat revisi konfigurasi fasilitas.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  handleRollbackCapabilityConfig(Math.max(1, currentSnapshot.configVersion - 1))
                }
                className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 hover:bg-amber-100 cursor-pointer"
              >
                Rollback ke Snapshot Sebelumnya
              </button>
              <button
                type="button"
                disabled={isPublishingConfig}
                onClick={handlePublishCapabilityConfig}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-teal-700 hover:bg-teal-800 text-white cursor-pointer"
              >
                {isPublishingConfig
                  ? 'Memvalidasi & Mempublikasikan...'
                  : `Publikasi Snapshot v${currentSnapshot.configVersion + 1}`}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Left 8 Cols: 3-Dimensional Sub-Capability Matrix */}
            <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Matriks Sub-Kapabilitas 3-Dimensi ({draftSubCaps.length} dari {SUB_CAPABILITY_CATALOG.length} Aktif)
                </span>
                <span className="text-[11px] font-mono text-slate-500">
                  Implementation · Operational Readiness · Integration
                </span>
              </div>
              <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 bg-slate-50 dark:bg-slate-800/60">
                      <th className="py-2.5 px-3">Aktif</th>
                      <th className="py-2.5 px-3">Sub-Kapabilitas &amp; Modul</th>
                      <th className="py-2.5 px-3">Implementation</th>
                      <th className="py-2.5 px-3">Operational Readiness</th>
                      <th className="py-2.5 px-3">Integration</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {SUB_CAPABILITY_CATALOG.map((cap) => {
                      const isEnabled = draftSubCaps.includes(cap.code);
                      const readiness = evaluateSubCapabilityReadiness(
                        cap.code,
                        draftSubCaps,
                        workspace.evidenceRegistry || []
                      );
                      return (
                        <tr key={cap.code} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 px-3">
                            <input
                              type="checkbox"
                              checked={isEnabled}
                              onChange={() => toggleSubCap(cap.code)}
                              aria-label={`Aktifkan ${cap.name}`}
                              className="rounded border-slate-300 text-teal-700 focus:ring-teal-600 cursor-pointer"
                            />
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {cap.name}
                            </div>
                            <div className="font-mono text-[10px] text-slate-500">
                              {cap.code} → {cap.mappedModule}
                            </div>
                            {!readiness.canActivate && (
                              <div className="text-[10px] text-amber-700 dark:text-amber-400 font-medium mt-0.5">
                                Prasyarat: {readiness.missingReasons.join('; ')}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px]">
                            <span className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-semibold">
                              {cap.implementationStatus}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px]">
                            <span
                              className={`px-2 py-0.5 rounded font-semibold ${
                                isEnabled
                                  ? 'bg-teal-100 dark:bg-teal-950 text-teal-800 dark:text-teal-300'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                              }`}
                            >
                              {isEnabled ? 'ACTIVE' : cap.defaultReadiness}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                            {cap.integrationStatus}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right 4 Cols: 15-Domain Summary & Live Navigation Preview */}
            <div className="lg:col-span-4 space-y-4">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3 text-xs">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Preview Menu Adaptif ({previewNavItems.length} Sub-Menu)
                </h3>
                <p className="text-[11px] text-slate-500">
                  Daftar menu sidebar yang akan tampil di {facilityCode} setelah snapshot dipublikasikan:
                </p>
                <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                  {previewNavItems.map((nav) => (
                    <div
                      key={nav.key}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between"
                    >
                      <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {nav.label}
                      </span>
                      <span className="font-mono text-[10px] text-teal-700 dark:text-teal-400 ml-2 shrink-0">
                        {nav.category}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2.5 text-xs">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Ringkasan 15 Domain Konfigurasi Faskes
                </h3>
                <div className="space-y-1.5 text-[11px] text-slate-600 dark:text-slate-300 font-mono">
                  <div>
                    1. Klasifikasi Permenkes 6/2026:{' '}
                    <strong>{workspace.activeFacility.serviceCapabilityClassification || 'MADYA'}</strong>
                  </div>
                  <div>
                    2. Batas Ranap Permenkes 11/2025:{' '}
                    <strong>
                      {workspace.activeFacility.inpatientStayPolicy?.statutoryMaxDays ?? 'RS Umum'} Hari
                    </strong>
                  </div>
                  <div>
                    3. Kontrak Klaim &amp; Grouper:{' '}
                    <strong>
                      {workspace.activeFacility.payerContract?.reimbursementModel || 'CAPITATION_KBK'} ({workspace.activeFacility.payerContract?.grouperVersion || 'FKTP'})
                    </strong>
                  </div>
                  <div>
                    4. Metode Persediaan &amp; PPN:{' '}
                    <strong>
                      {currentSnapshot.pharmacyPolicy.allocationMethod} · PPN {currentSnapshot.pharmacyPolicy.vatRatePct}%
                    </strong>
                  </div>
                  <div>
                    5. Akses Lintas Faskes:{' '}
                    <strong>
                      {currentSnapshot.crossFacilitySharingPolicy.allowSameTenantReferralLookup ? 'AKTIF TERKENDALI' : 'TERISOLASI'}
                    </strong>
                  </div>
                </div>
                <div className="pt-2">
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Catatan Publikasi Audit
                  </label>
                  <input
                    type="text"
                    value={draftNotes}
                    onChange={(e) => setDraftNotes(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: MASTER FASILITAS KLINIK & RUMAH SAKIT */}
      {subTab === 'FACILITIES' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left 5 Cols: Add or Update Facility */}
          <form
            onSubmit={handleSaveFacilitySubmit}
            className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3.5"
          >
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Tambah / Perbarui Fasilitas Kesehatan
              </h2>
              <p className="text-xs text-slate-500">
                Registrasi identitas fasilitas kesehatan dalam jaringan.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="fac-code-input"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Kode FASILITAS
                </label>
                <input
                  id="fac-code-input"
                  type="text"
                  value={facCode}
                  onChange={(e) => setFacCode(e.target.value.toUpperCase())}
                  placeholder="RS_HARAPAN_BUNDA"
                  required
                  className="w-full px-3 py-2 text-xs font-mono font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label
                  htmlFor="fac-type-select"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Tipe Faskes
                </label>
                <select
                  id="fac-type-select"
                  value={facType}
                  onChange={(e) => setFacType(e.target.value as Facility['type'])}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="KLINIK_PRATAMA">Klinik Pratama</option>
                  <option value="KLINIK_UTAMA">Klinik Utama</option>
                  <option value="RSUD">Rumah Sakit Umum Daerah</option>
                  <option value="RS_SWASTA">Rumah Sakit Swasta</option>
                </select>
              </div>
            </div>

            <div>
              <label
                htmlFor="fac-name-input"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                Nama Resmi Klinik / Rumah Sakit
              </label>
              <input
                id="fac-name-input"
                type="text"
                value={facName}
                onChange={(e) => setFacName(e.target.value)}
                placeholder="RS Harapan Bunda Bandung"
                required
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Kode Kemenkes</label>
                <input
                  type="text"
                  value={facKemenkes}
                  onChange={(e) => setFacKemenkes(e.target.value)}
                  placeholder="3204991"
                  className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Kode BPJS</label>
                <input
                  type="text"
                  value={facBpjs}
                  onChange={(e) => setFacBpjs(e.target.value)}
                  placeholder="0114B999"
                  className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">SATUSEHAT Org</label>
                <input
                  type="text"
                  value={facSatusehat}
                  onChange={(e) => setFacSatusehat(e.target.value)}
                  placeholder="100099123"
                  className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Alamat Fasilitas
                </label>
                <input
                  type="text"
                  value={facAddress}
                  onChange={(e) => setFacAddress(e.target.value)}
                  placeholder="Jl. Raya Majalaya No. 12"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Kota / Kabupaten
                </label>
                <input
                  type="text"
                  value={facCity}
                  onChange={(e) => setFacCity(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Telepon Faskes
                </label>
                <input
                  type="text"
                  value={facPhone}
                  onChange={(e) => setFacPhone(e.target.value)}
                  placeholder="022-8901234"
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Node Server URL
                </label>
                <input
                  type="text"
                  value={facNodeUrl}
                  onChange={(e) => setFacNodeUrl(e.target.value)}
                  placeholder="https://node-faskes.kael-health.id"
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSavingFacility}
              className="w-full py-2.5 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold cursor-pointer"
            >
              {isSavingFacility ? 'Menyimpan...' : 'Simpan Fasilitas ke Server'}
            </button>
          </form>

          {/* Right 7 Cols: All Facilities Table */}
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Registri Multi-Fasilitas Aktif ({workspace.allFacilities.length})
              </h2>
              <DataExportToolbar
                title="Registri Master Fasilitas Kesehatan"
                filenameBase={`KAEL_Superuser_Facilities_${facilityCode}`}
                facilityName={workspace.activeFacility.name}
                facilityCode={facilityCode}
                columns={suExportColumns}
                rows={suExportRows}
                compact
                contextLabel="Ekspor Faskes"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 bg-slate-50/70 dark:bg-slate-800/50">
                    <th className="py-2.5 px-4">Kode FASILITAS</th>
                    <th className="py-2.5 px-4">Nama &amp; Lokasi</th>
                    <th className="py-2.5 px-4">Kode Regulasi Nasional</th>
                    <th className="py-2.5 px-4">Server Node</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {workspace.allFacilities.map((f) => (
                    <tr key={f.code}>
                      <td className="py-3 px-4 font-mono font-bold text-teal-800 dark:text-teal-300 whitespace-nowrap">
                        {f.code}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {f.name}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {f.type.replace(/_/g, ' ')} · {f.address}, {f.city}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] whitespace-nowrap">
                        <div>Kemenkes: {f.kemenkesCode}</div>
                        <div className="text-slate-500">
                          BPJS: {f.bpjsPcareCode} · SS: {f.satusehatOrgId}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-500">
                        {f.serverNodeUrl}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: SERVER CONFIG & AUDIT TRAIL */}
      {subTab === 'SERVER_AUDIT' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleSaveServerConfig}
            className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3.5"
          >
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Konfigurasi Inti Node Server Linux &amp; Endpoint Nasional
            </h2>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Hostname Node Server
              </label>
              <input
                type="text"
                value={nodeName}
                onChange={(e) => setNodeName(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Path Penyimpanan Persisten Server
              </label>
              <input
                type="text"
                value={workspace.serverConfig.storagePath}
                readOnly
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Endpoint SATUSEHAT FHIR R4 Kemenkes
              </label>
              <input
                type="text"
                value={satusehatBaseUrl}
                onChange={(e) => setSatusehatBaseUrl(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Endpoint Bridging BPJS Kesehatan
              </label>
              <input
                type="text"
                value={bpjsBaseUrl}
                onChange={(e) => setBpjsBaseUrl(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Port IoMT Hub
                </label>
                <input
                  type="number"
                  value={iomtPort}
                  onChange={(e) => setIomtPort(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Batas Sesi Menit
                </label>
                <input
                  type="number"
                  value={sessionTimeout}
                  onChange={(e) => setSessionTimeout(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>
            <button
              type="submit"
              className="w-full py-2.5 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold cursor-pointer"
            >
              Simpan Parameter Server
            </button>
          </form>

          {/* Right 7 Cols: Security Audit Log & Database Backup */}
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Log Audit Keamanan &amp; Jejak Aktivitas Lintas Fasilitas
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <DataExportToolbar
                  title="Log Audit Keamanan Server KAEL"
                  filenameBase={`KAEL_Superuser_Audit_${facilityCode}`}
                  facilityName={workspace.activeFacility.name}
                  facilityCode={facilityCode}
                  columns={suExportColumns}
                  rows={suExportRows}
                  compact
                  contextLabel="Ekspor Log Audit"
                />
                <button
                  type="button"
                  onClick={handleExportFullBackupJson}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Backup JSON Server
                </button>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 bg-slate-50/70 dark:bg-slate-800/50">
                    <th className="py-2.5 px-4">Waktu</th>
                    <th className="py-2.5 px-4">Fasilitas &amp; Aktor</th>
                    <th className="py-2.5 px-4">Aksi &amp; Rincian</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {workspace.auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-[11px] text-slate-500 whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleTimeString('id-ID')}
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <div className="font-mono font-bold text-teal-800 dark:text-teal-300">
                          {log.facilityCode}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500">
                          @{log.actorUsername} ({log.actorRole})
                        </div>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="font-mono text-[11px] font-semibold text-slate-900 dark:text-slate-100">
                          {log.action} · {log.targetResource}
                        </div>
                        <div className="text-xs text-slate-600 dark:text-slate-400">
                          {log.details}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
