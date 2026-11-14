import React, { useEffect, useRef, useState } from 'react';
import { ModalDialog } from './ModalDialog';
import {
  Building2,
  CheckCircle2,
  KeyRound,
  Lock,
  Pencil,
  Plus,
  Server,
  ShieldCheck,
  Trash2,
  UserCog,
  UserPlus,
} from 'lucide-react';
import {
  Facility,
  ModuleKey,
  RoleDefinition,
  SubCapabilityKey,
  UserAccount,
  UserRole,
} from '../domain/simrs.ts';
import { kaelApi, WorkspacePayload } from '../utils/apiClient';
import { normalizeFacilityCode } from '../domain/clinicalLogic.ts';
import {
  buildDefaultFacilityConfigSnapshot,
  evaluateSubCapabilityReadiness,
  resolveFacilityNavigation,
  SUB_CAPABILITY_CATALOG,
} from '../domain/platformEngine.ts';
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
  { key: 'JADWAL_DOKTER', label: 'Direktori Praktisi (Jadwal Belum Tersedia)' },
  { key: 'RAWAT_INAP', label: 'Manajemen Tempat Tidur & Ranap' },
  { key: 'RME_DOKTER', label: 'Pemeriksaan Poliklinik & SOAP' },
  { key: 'IGD_TRIASE_EWS', label: 'Pencatatan Pemeriksaan IGD' },
  { key: 'GIGI_ODONTOGRAM', label: 'Poli Gigi & Odontogram FDI' },
  { key: 'KIA_IMUNISASI', label: 'SOAP Kesehatan Ibu dan Anak' },
  { key: 'PROLANIS_PRB', label: 'SOAP Penyakit Kronis' },
  { key: 'BEDAH_IBS', label: 'SOAP dan Catatan Operasi' },
  { key: 'MCU_SURAT_MEDIS', label: 'Pemeriksaan dan Dokumen Medis' },
  { key: 'APOTEK', label: 'Antrean E-Resep & Dispensasi FEFO' },
  { key: 'KATALOG_OPNAME', label: 'Katalog Obat KFA & Stock Opname' },
  { key: 'MUTASI_STOK', label: 'Kartu Stok, Obat Masuk & Keluar' },
  { key: 'PENGADAAN_PBF', label: 'Pengadaan PO, Faktur PBF & Hutang' },
  { key: 'LABORATORIUM', label: 'Laboratorium Patologi Klinik' },
  { key: 'RADIOLOGI_RIS', label: 'Radiologi & Pencitraan RIS' },
  { key: 'PENUNJANG_RS', label: 'Gizi, Bank Darah, CSSD & IPSRS' },
  { key: 'KASIR_AKUNTANSI', label: 'Kasir dan Tagihan Pasien' },
  { key: 'KEUANGAN_OWNER', label: 'Ringkasan Transaksi Keuangan' },
  { key: 'NERACA_GL', label: 'Buku Besar dan Komponen Neraca' },
  { key: 'KLAIM_BPJS_PIUTANG', label: 'Catatan Klaim dan Piutang' },
  { key: 'JASA_MEDIS_REMUN', label: 'Ringkasan Layanan Dokter' },
  { key: 'SDM_JADWAL', label: 'Identitas SDM (Jadwal Belum Tersedia)' },
  { key: 'SDM_ERP', label: 'SDM (Absensi dan Penggajian Belum Tersedia)' },
  { key: 'LAPORAN_REGULASI', label: 'Indikator dan pelaporan' },
  { key: 'BRIDGING_SATUSEHAT', label: 'Antrean Integrasi Lokal' },
  { key: 'SUPERUSER_CONTROL', label: 'Superuser & Konfigurasi Platform' },
];

export const SuperuserControlModule: React.FC<SuperuserControlModuleProps> = ({
  token,
  facilityCode,
  workspace,
  onRefreshWorkspace,
}) => {
  const [subTab, setSubTab] = useState<
    'USERS' | 'ROLES' | 'FACILITIES' | 'CAPABILITY_CONFIG' | 'SERVER_AUDIT'
  >('USERS');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  const feedbackRef = useRef<HTMLDivElement | null>(null);
  const userFormRef = useRef<HTMLDetailsElement>(null);
  const roleFormRef = useRef<HTMLDetailsElement>(null);
  const facilityFormRef = useRef<HTMLDetailsElement>(null);
  const serverFormRef = useRef<HTMLDetailsElement>(null);

  const [inlineFormLayout, setInlineFormLayout] = useState(false);

  useEffect(() => {
    const panels = [userFormRef, roleFormRef, facilityFormRef, serverFormRef]
      .map((ref) => ref.current).filter((panel): panel is HTMLDetailsElement => panel !== null);
    const grid = panels[0]?.parentElement;
    if (!grid) { setInlineFormLayout(false); return; }
    let previousLayout: boolean | undefined;
    const syncForms = () => {
      const columns = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/);
      const inline = columns.length > 1;
      if (inline === previousLayout) return;
      previousLayout = inline;
      setInlineFormLayout(inline);
      panels.forEach((panel) => { panel.open = inline; });
    };
    syncForms();
    const observer = new ResizeObserver(syncForms);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [subTab]);


  const roles = workspace.roles || [];
  const activeRoles = roles.filter((entry) => entry.active);
  const roleLabel = (id: string) => roles.find((entry) => entry.id === id)?.name || id;
  const currentSnapshot = workspace.activeFacility
    ? workspace.activeFacilityConfig || buildDefaultFacilityConfigSnapshot(workspace.activeFacility)
    : null;

  const [draftSubCaps, setDraftSubCaps] = useState<SubCapabilityKey[]>(
    currentSnapshot?.enabledSubCapabilities || []
  );
  const [draftNotes, setDraftNotes] = useState(
    ''
  );
  const [isPublishingConfig, setIsPublishingConfig] = useState(false);

  // User Creation State
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [nipOrSip, setNipOrSip] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('');
  const [specialization, setSpecialization] = useState('');
  const [polyclinic, setPolyclinic] = useState('');
  const [isPractitioner, setIsPractitioner] = useState(false);
  const [selectedFacilities, setSelectedFacilities] = useState<string[]>([]);
  const [isCreatingUser, setIsCreatingUser] = useState(false);

  // Password Reset / Edit Existing User State
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [editingAccessUser, setEditingAccessUser] = useState<UserAccount | null>(null);
  const [editUserRole, setEditUserRole] = useState<UserRole>('');
  const [editUserFacilities, setEditUserFacilities] = useState<string[]>([]);
  const [editUsername, setEditUsername] = useState('');
  const [editFullName, setEditFullName] = useState('');
  const [editNipOrSip, setEditNipOrSip] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editIsPractitioner, setEditIsPractitioner] = useState(false);
  const [isSavingUser, setIsSavingUser] = useState(false);
  const [restoringUserId, setRestoringUserId] = useState<string | null>(null);

  const [editingRole, setEditingRole] = useState<RoleDefinition | null>(null);
  const [roleId, setRoleId] = useState('');
  const [roleName, setRoleName] = useState('');
  const [roleModules, setRoleModules] = useState<ModuleKey[]>([]);
  const [roleActive, setRoleActive] = useState(true);
  const [isSavingRole, setIsSavingRole] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'user' | 'role' | 'facility'; id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Facility Creation State
  const [facCode, setFacCode] = useState('');
  const [facName, setFacName] = useState('');
  const [facType, setFacType] = useState<Facility['type'] | ''>('');
  const [facKemenkes, setFacKemenkes] = useState('');
  const [facBpjs, setFacBpjs] = useState('');
  const [facSatusehat, setFacSatusehat] = useState('');
  const [facAddress, setFacAddress] = useState('');
  const [facCity, setFacCity] = useState('');
  const [facPhone, setFacPhone] = useState('');
  const [facNodeUrl, setFacNodeUrl] = useState('');
  const [facActive, setFacActive] = useState(true);
  const [editingFacilityCode, setEditingFacilityCode] = useState<string | null>(null);
  const [isSavingFacility, setIsSavingFacility] = useState(false);

  useEffect(() => {
    const panel = subTab === 'ROLES' && editingRole ? roleFormRef.current
      : subTab === 'FACILITIES' && editingFacilityCode ? facilityFormRef.current : null;
    if (panel) { panel.open = true; panel.scrollIntoView({ block: 'start' }); }
  }, [subTab, editingRole, editingFacilityCode]);

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

  useEffect(() => {
    if (!roles.some((entry) => entry.id === role && entry.active)) {
      setRole('');
    }
  }, [workspace.roles, role]);

  useEffect(() => {
    setDraftSubCaps(currentSnapshot?.enabledSubCapabilities || []);
  }, [workspace.activeFacility?.code, workspace.activeFacilityConfig?.configVersion]);

  useEffect(() => {
    if (feedback) feedbackRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [feedback]);

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
    if (newRole === 'SUPERUSER') {
      setSelectedFacilities(['*']);
    } else if (selectedFacilities.includes('*')) {
      setSelectedFacilities([]);
    }
  };

  const toggleFacilityForNewUser = (code: string) => {
    setSelectedFacilities((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const handleCreateUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (!username.trim() || !fullName.trim()) {
      setFeedback({ type: 'error', text: 'Username dan Nama Lengkap wajib diisi.' });
      return;
    }
    if (!activeRoles.some((entry) => entry.id === role)) {
      setFeedback({ type: 'error', text: 'Pilih role aktif yang terdaftar di server.' });
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
        specialization,
        polyclinic,
        isPractitioner,
      });
      setUsername('');
      setPassword('');
      setFullName('');
      setNipOrSip('');
      setEmail('');
      setIsPractitioner(false);
      await onRefreshWorkspace();
      setFeedback({
        type: 'success',
        text: `Akun @${created.username} (${created.fullName}) dengan role ${roleLabel(created.role)} berhasil disimpan.`,
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
    if (resetPasswordValue.length < 8) {
      setFeedback({ type: 'error', text: 'Kata sandi minimal 8 karakter.' });
      return;
    }
    setFeedback(null);
    try {
      await kaelApi.superuserUpdateUser(token, facilityCode, target.id, {
        newPassword: resetPasswordValue,
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
    if (editUserRole !== 'SUPERUSER' && editUserFacilities.length === 0) {
      setFeedback({ type: 'error', text: 'Pilih minimal satu fasilitas untuk akun ini.' });
      return;
    }
    setIsSavingUser(true);
    try {
      const updated = await kaelApi.superuserUpdateUser(
        token,
        facilityCode,
        editingAccessUser.id,
        {
          username: editUsername.trim(),
          fullName: editFullName.trim(),
          nipOrSip: editNipOrSip.trim(),
          email: editEmail.trim(),
          isPractitioner: editIsPractitioner,
          role: editUserRole,
          allowedFacilities: editUserRole === 'SUPERUSER' ? ['*'] : editUserFacilities,
        }
      );
      setEditingAccessUser(null);
      await onRefreshWorkspace();
      setFeedback({
        type: 'success',
        text: `Akun @${updated.username} dan otorisasinya berhasil diperbarui.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal memperbarui otorisasi fasilitas akun.',
      });
    } finally {
      setIsSavingUser(false);
    }
  };

  const resetRoleForm = () => {
    setEditingRole(null);
    setRoleId('');
    setRoleName('');
    setRoleModules([]);
    setRoleActive(true);
  };

  const handleSaveRole = async (event: React.FormEvent) => {
    event.preventDefault();
    setFeedback(null);
    if (editingRole?.id !== 'SUPERUSER' && roleModules.length === 0) {
      setFeedback({ type: 'error', text: 'Pilih minimal satu modul untuk role ini.' });
      return;
    }
    setIsSavingRole(true);
    try {
      const saved = editingRole
        ? await kaelApi.superuserUpdateRole(token, facilityCode, editingRole.id, {
            name: roleName.trim(),
            ...(editingRole.id === 'SUPERUSER' ? {} : { modules: roleModules, active: roleActive }),
          })
        : await kaelApi.superuserCreateRole(token, facilityCode, {
            ...(roleId.trim() ? { id: roleId.trim() } : {}),
            name: roleName.trim(), modules: roleModules, active: roleActive,
          });
      resetRoleForm();
      await onRefreshWorkspace();
      setFeedback({ type: 'success', text: `Role ${saved.name} berhasil disimpan.` });
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Role tidak dapat disimpan.' });
    } finally {
      setIsSavingRole(false);
    }
  };

  const resetFacilityForm = () => {
    setEditingFacilityCode(null);
    setFacCode(''); setFacName(''); setFacType('');
    setFacKemenkes(''); setFacBpjs(''); setFacSatusehat('');
    setFacAddress(''); setFacCity(''); setFacPhone(''); setFacNodeUrl(''); setFacActive(true);
  };

  const editFacility = (facility: Facility) => {
    setEditingFacilityCode(facility.code);
    setFacCode(facility.code); setFacName(facility.name); setFacType(facility.type);
    setFacKemenkes(facility.kemenkesCode); setFacBpjs(facility.bpjsPcareCode); setFacSatusehat(facility.satusehatOrgId);
    setFacAddress(facility.address); setFacCity(facility.city); setFacPhone(facility.phone); setFacNodeUrl(facility.serverNodeUrl); setFacActive(facility.active);
  };

  const handleDelete = async () => {
    if (!deleteTarget || isDeleting) return;
    setIsDeleting(true);
    setFeedback(null);
    try {
      if (deleteTarget.kind === 'user') await kaelApi.superuserDeleteUser(token, facilityCode, deleteTarget.id);
      if (deleteTarget.kind === 'role') await kaelApi.superuserDeleteRole(token, facilityCode, deleteTarget.id);
      if (deleteTarget.kind === 'facility') await kaelApi.superuserDeleteFacility(token, facilityCode, deleteTarget.id);
      if (editingAccessUser?.id === deleteTarget.id && deleteTarget.kind === 'user') setEditingAccessUser(null);
      if (editingRole?.id === deleteTarget.id && deleteTarget.kind === 'role') resetRoleForm();
      if (editingFacilityCode === deleteTarget.id && deleteTarget.kind === 'facility') resetFacilityForm();
      const deletedName = deleteTarget.name;
      const deletedUser = deleteTarget.kind === 'user';
      setDeleteTarget(null);
      await onRefreshWorkspace();
      setFeedback({ type: 'success', text: deletedUser ? `${deletedName} dipindahkan ke Akun Terhapus dan tidak dapat login.` : `${deletedName} berhasil dihapus dari server.` });
    } catch (error) {
      setDeleteTarget(null);
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Data tidak dapat dihapus.' });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRestoreUser = async (user: UserAccount) => {
    if (restoringUserId) return;
    setRestoringUserId(user.id);
    setFeedback(null);
    try {
      await kaelApi.superuserRestoreUser(token, facilityCode, user.id);
      await onRefreshWorkspace();
      setFeedback({ type: 'success', text: `Akun @${user.username} berhasil dipulihkan dalam keadaan nonaktif. Pilih Aktifkan untuk mengizinkan login kembali.` });
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Akun tidak dapat dipulihkan.' });
    } finally {
      setRestoringUserId(null);
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
    if (!cleanCode || !facName.trim() || !facType) {
      setFeedback({
        type: 'error',
        text: 'Kode, nama, dan tipe fasilitas wajib diisi secara eksplisit.',
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
        active: facActive,
      });
      resetFacilityForm();
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
        text: `Revisi konfigurasi ${published.configVersion} tersimpan untuk ${facilityCode} (${published.enabledSubCapabilities.length} layanan aktif).`,
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

  const previewNavItems = currentSnapshot ? resolveFacilityNavigation(
    {
      ...currentSnapshot,
      enabledSubCapabilities: draftSubCaps,
    },
    workspace.user,
    facilityCode
  ) : [];

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
          { key: 'role', header: 'Role Otorisasi', format: (r) => roleLabel(String(r.role)) },
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
    <div className="min-w-0 space-y-4">
      {deleteTarget && (
        <ModalDialog onClose={() => setDeleteTarget(null)} labelledBy="delete-item-title" closeDisabled={isDeleting}>
          <div
            className="w-full min-w-0 break-words max-w-[min(100%,var(--kael-confirmation-inline-size))] max-h-full overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B211D] p-4 sm:p-5 shadow-xl"
          >
            <h2 id="delete-item-title" className="text-base font-bold">Hapus {deleteTarget.name}?</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {deleteTarget.kind === 'role' ? 'Role yang masih digunakan akun, termasuk akun terhapus, tidak dapat dihapus.' : deleteTarget.kind === 'facility' ? 'Fasilitas yang masih memiliki data terkait tidak dapat dihapus.' : 'Akun akan dipindahkan ke Akun Terhapus dan sesinya akan dicabut. Identitas pada riwayat layanan tetap tersimpan. Akun dapat dipulihkan oleh superuser.'}
            </p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button autoFocus type="button" disabled={isDeleting} onClick={() => setDeleteTarget(null)} className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-semibold disabled:opacity-60">Batal</button>
              <button type="button" disabled={isDeleting} onClick={handleDelete} className="rounded-lg bg-red-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60">{isDeleting ? 'Menghapus…' : deleteTarget.kind === 'user' ? 'Hapus Akun' : 'Hapus Permanen'}</button>
            </div>
          </div>
        </ModalDialog>
      )}
      {/* Superuser Header & Sub-Tabs */}
      <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-4 sm:p-5 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[#0F2922] dark:text-white mt-0.5 tracking-tight">
              <span className="sm:hidden">Administrasi</span><span className="hidden sm:inline">Administrasi akun, role, dan fasilitas</span>
            </h1>
          </div>
        </div>

        <label className="block sm:hidden">
          <span className="sr-only">Bagian administrasi</span>
          <select aria-label="Bagian administrasi" value={subTab} onChange={(event) => setSubTab(event.target.value as typeof subTab)} className="w-full rounded-xl border border-[#D5E3DF] bg-[#F3F8F6] px-3 py-2 text-sm dark:border-[#1E473F] dark:bg-[#081916]">
            <option value="USERS">Akun pengguna ({workspace.allUsers.length})</option>
            <option value="ROLES">Peran dan hak akses ({roles.length})</option>
            <option value="CAPABILITY_CONFIG" disabled={!currentSnapshot}>Layanan fasilitas{currentSnapshot ? '' : ' (pilih fasilitas)'}</option>
            <option value="FACILITIES">Fasilitas ({workspace.allFacilities.length})</option>
            <option value="SERVER_AUDIT">Server dan riwayat ({workspace.auditLogs.length})</option>
          </select>
        </label>
        <div className="hidden sm:flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => setSubTab('USERS')}
            className={`px-4 py-2 text-xs font-semibold rounded-xl transition-colors whitespace-normal text-left max-w-full shrink-0 flex items-center gap-1.5 cursor-pointer ${
              subTab === 'USERS'
                ? 'bg-[#00897B] text-white'
                : 'bg-[#F3F8F6] dark:bg-[#081916] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
            }`}
          >
            <UserCog className="w-3.5 h-3.5" />
            Akun pengguna ({workspace.allUsers.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('ROLES')}
            className={`px-4 py-2 text-xs font-semibold rounded-xl transition-colors whitespace-normal text-left max-w-full shrink-0 flex items-center gap-1.5 cursor-pointer ${subTab === 'ROLES' ? 'bg-[#00897B] text-white' : 'bg-[#F3F8F6] dark:bg-[#081916] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'}`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Peran dan hak akses ({roles.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('CAPABILITY_CONFIG')}
            disabled={!currentSnapshot}
            className={`px-4 py-2 text-xs font-semibold rounded-xl transition-colors whitespace-normal text-left max-w-full shrink-0 flex items-center gap-1.5 cursor-pointer ${
              subTab === 'CAPABILITY_CONFIG'
                ? 'bg-[#00897B] text-white'
                : 'bg-[#F3F8F6] dark:bg-[#081916] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Layanan fasilitas {currentSnapshot ? `(revisi ${currentSnapshot.configVersion})` : '(pilih fasilitas)'}
          </button>
          <button
            type="button"
            onClick={() => setSubTab('FACILITIES')}
            className={`px-4 py-2 text-xs font-semibold rounded-xl transition-colors whitespace-normal text-left max-w-full shrink-0 flex items-center gap-1.5 cursor-pointer ${
              subTab === 'FACILITIES'
                ? 'bg-[#00897B] text-white'
                : 'bg-[#F3F8F6] dark:bg-[#081916] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            Fasilitas ({workspace.allFacilities.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('SERVER_AUDIT')}
            className={`px-4 py-2 text-xs font-semibold rounded-xl transition-colors whitespace-normal text-left max-w-full shrink-0 flex items-center gap-1.5 cursor-pointer ${
              subTab === 'SERVER_AUDIT'
                ? 'bg-[#00897B] text-white'
                : 'bg-[#F3F8F6] dark:bg-[#081916] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            Server dan riwayat ({workspace.auditLogs.length})
          </button>
        </div>
      </div>

      {feedback && (
        <div
          ref={feedbackRef}
          role={feedback.type === 'error' ? 'alert' : 'status'}
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

      {subTab === 'ROLES' && (
        <div className="grid min-w-0 [&>*]:min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-form-min-inline-size)),1fr))] gap-4 items-start">
          <details ref={roleFormRef} className="group min-w-0">
            <summary className={`${inlineFormLayout ? 'hidden' : 'flex'} mb-2 cursor-pointer list-none items-center justify-between gap-3 rounded-xl border border-[#D5E3DF] bg-white px-4 py-3 text-sm font-semibold text-[#00897B] dark:border-[#1E473F] dark:bg-[#0B211D] [&::-webkit-details-marker]:hidden`}>
              <span className="flex items-center gap-2"><Plus className="h-4 w-4 shrink-0" />{editingRole ? `Edit Role ${editingRole.name}` : 'Tambah Role'}</span><span className="text-xs group-open:hidden">Buka form</span><span className="hidden text-xs group-open:inline">Tutup</span>
            </summary>
          <form onSubmit={handleSaveRole} className="min-w-0 rounded-2xl border border-[#E2ECE8] dark:border-[#183831] bg-white dark:bg-[#0B211D] p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-bold">{editingRole ? `Edit Role ${editingRole.name}` : 'Tambah Role'}</h2>
              {editingRole && <button type="button" onClick={resetRoleForm} className="shrink-0 text-xs font-semibold text-[#00897B]">Batal edit</button>}
            </div>
            <p className="text-xs text-slate-500">Tentukan nama dan modul yang dapat digunakan akun dengan role ini.</p>
            <label className="block text-xs font-semibold">Nama role
              <input required maxLength={120} value={roleName} onChange={(event) => setRoleName(event.target.value)} placeholder="Nama jabatan atau kelompok akses" className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2" />
            </label>
            <label className="block text-xs font-semibold">Kode role {editingRole ? '' : '(opsional)'}
              <input value={roleId} disabled={Boolean(editingRole)} onChange={(event) => setRoleId(event.target.value.toUpperCase())} placeholder="Dibuat otomatis jika dikosongkan" className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono disabled:opacity-60" />
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={roleActive} disabled={editingRole?.id === 'SUPERUSER'} onChange={(event) => setRoleActive(event.target.checked)} />Role aktif</label>
            <fieldset disabled={editingRole?.id === 'SUPERUSER'} className="grid min-w-0 [&>*]:min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-field-min-inline-size)),1fr))] gap-2">
              <legend className="text-xs font-semibold mb-2">Hak akses modul ({roleModules.length})</legend>
              {ALL_MODULE_KEYS.filter((entry) => entry.key !== 'SUPERUSER_CONTROL' || editingRole?.id === 'SUPERUSER').map((entry) => (
                <label key={entry.key} className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 px-2.5 py-2 text-xs">
                  <input type="checkbox" checked={roleModules.includes(entry.key)} onChange={() => setRoleModules((current) => current.includes(entry.key) ? current.filter((key) => key !== entry.key) : [...current, entry.key])} />
                  {entry.label}
                </label>
              ))}
            </fieldset>
            {editingRole?.id === 'SUPERUSER' && <p className="text-xs text-slate-500">Akses administrasi superuser selalu aktif.</p>}
            <button type="submit" disabled={isSavingRole} className="w-full rounded-xl bg-[#00897B] px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-60">{isSavingRole ? 'Menyimpan…' : editingRole ? 'Simpan Perubahan Role' : 'Simpan Role Baru'}</button>
          </form>
          </details>
          <section className="min-w-0 rounded-2xl border border-[#E2ECE8] dark:border-[#183831] bg-white dark:bg-[#0B211D] overflow-hidden">
            <div className="border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-bold">Role Terdaftar ({roles.length})</h2>
              <button type="button" onClick={() => { resetRoleForm(); if (roleFormRef.current) { roleFormRef.current.open = true; roleFormRef.current.scrollIntoView({ block: 'start' }); } }} className="inline-flex items-center gap-1 text-xs font-semibold text-[#00897B]"><Plus className="h-3.5 w-3.5" />Tambah Role</button>
            </div>
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {roles.map((entry) => (
                <div key={entry.id} className="p-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold">{entry.name}</h3>
                      <p className="mt-0.5 text-caption text-slate-500 font-mono">{entry.id} · {entry.active ? 'AKTIF' : 'NONAKTIF'} · {[...workspace.allUsers, ...(workspace.deletedUsers || [])].filter((user) => user.role === entry.id || Object.values(user.facilityRoles || {}).includes(entry.id)).length} akun (termasuk terhapus)</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => { setEditingRole(entry); setRoleId(entry.id); setRoleName(entry.name); setRoleModules([...entry.modules]); setRoleActive(entry.active); }} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-xs"><Pencil className="h-3 w-3" />Edit Role</button>
                      {entry.id !== 'SUPERUSER' && <button type="button" onClick={() => setDeleteTarget({ kind: 'role', id: entry.id, name: `Role ${entry.name}` })} className="inline-flex items-center gap-1 rounded-lg border border-red-200 dark:border-red-900 px-2.5 py-1.5 text-xs text-red-700 dark:text-red-300"><Trash2 className="h-3 w-3" />Hapus Role</button>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">{entry.modules.map((module) => <span key={module} className="rounded bg-[#F3F8F6] dark:bg-[#071714] px-2 py-1 text-caption text-[#52736B] dark:text-[#86B5A9]">{ALL_MODULE_KEYS.find((item) => item.key === module)?.label || module}</span>)}</div>
                </div>
              ))}
              {roles.length === 0 && <p className="p-5 text-xs text-slate-500">Belum ada role terdaftar.</p>}
            </div>
          </section>
        </div>
      )}

      {/* SUB-TAB 1: PROVISIONING & PENGATURAN USER (NO PUBLIC REGISTRATION) */}
      {subTab === 'USERS' && (
        <div className="grid min-w-0 [&>*]:min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-form-min-inline-size)),1fr))] gap-4 items-start">
          {/* Left 5 Cols: Register New User Account with Multi-Facility & Granular Privileges */}
          <details ref={userFormRef} className="group min-w-0">
            <summary className={`${inlineFormLayout ? 'hidden' : 'flex'} mb-2 cursor-pointer list-none items-center justify-between gap-3 rounded-xl border border-[#D5E3DF] bg-white px-4 py-3 text-sm font-semibold text-[#00897B] dark:border-[#1E473F] dark:bg-[#0B211D] [&::-webkit-details-marker]:hidden`}>
              <span className="flex items-center gap-2"><Plus className="h-4 w-4 shrink-0" />Tambah Akun Pengguna</span><span className="text-xs group-open:hidden">Buka form</span><span className="hidden text-xs group-open:inline">Tutup</span>
            </summary>
          <form
            onSubmit={handleCreateUserSubmit}
            className="min-w-0 bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-4 sm:p-5 space-y-3"
          >
            <div>
              <h2 className="text-sm font-bold text-[#0F2922] dark:text-white flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-[#00897B]" />
                Tambah Akun Pengguna
              </h2>
              <p className="text-xs text-[#52736B] mt-0.5">
                Kelola akun tenaga medis dan staf fasilitas beserta hak akses modul.
              </p>
            </div>

            <div className="grid min-w-0 [&>*]:min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-field-min-inline-size)),1fr))] gap-3">
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
                  placeholder="Nama pengguna untuk login"
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
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  required
                  minLength={8}
                  maxLength={512}
                  onChange={(e) => setPassword(e.target.value)}
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
                placeholder="Nama lengkap pengguna"
                required
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>

            <div className="grid min-w-0 [&>*]:min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-field-min-inline-size)),1fr))] gap-3">
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
                  required
                  className="w-full px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="" disabled>Pilih role terdaftar</option>
                  {activeRoles.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
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
                  placeholder="Nomor identitas profesi (opsional)"
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>

            <div className="grid min-w-0 [&>*]:min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-field-min-inline-size)),1fr))] gap-3">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 col-span-full">Email (opsional)
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Alamat email pengguna" className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs" />
              </label>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Spesialisasi (opsional)
                <input value={specialization} onChange={(event) => setSpecialization(event.target.value)} placeholder="Bidang layanan atau profesi" className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs" />
              </label>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Poliklinik (opsional)
                <input value={polyclinic} onChange={(event) => setPolyclinic(event.target.value)} placeholder="Kode poliklinik" className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs" />
              </label>
            </div>

            <div>
              <label className="flex items-center gap-2 text-xs font-semibold">
                <input type="checkbox" checked={isPractitioner} onChange={(event) => setIsPractitioner(event.target.checked)} />
                Tenaga pemeriksa klinis
              </label>
              <p className="mt-1 text-caption text-slate-500">Akun dapat dipilih sebagai pemeriksa pada antrean jika juga memiliki akses modul RME di fasilitas terkait.</p>
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
                          <span className="font-mono font-bold text-teal-800 dark:text-teal-300 break-all">
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

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
              <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200 mb-1.5">
                Hak Akses dari Role
              </label>
              <p className="text-caption text-slate-500 mb-2">Hak akses mengikuti role yang tersimpan di server. Ubah melalui tab Peran dan hak akses.</p>
              <div className="flex flex-wrap gap-1.5">
                {(roles.find((entry) => entry.id === role)?.modules || []).map((module) => (
                  <span key={module} className="rounded border border-slate-200 dark:border-slate-800 px-2 py-1 text-caption">{ALL_MODULE_KEYS.find((entry) => entry.key === module)?.label || module}</span>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={isCreatingUser || !role}
              className="w-full py-2.5 px-4 rounded-xl bg-[#00897B] hover:bg-[#00796B] text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              {isCreatingUser
                ? 'Mendaftarkan Akun...'
                : 'Daftarkan Akun & Aktifkan Hak Akses'}
            </button>
          </form>
          </details>

          {/* Right 7 Cols: All Registered Users Directory & Privilege Editor */}
          <div className="min-w-0 bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Daftar Seluruh Akun Terdaftar di Server ({workspace.allUsers.length})
              </h2>
              <DataExportToolbar
                title="Daftar Seluruh Akun Pekerja & Otorisasi Role"
                filenameBase={`KAEL_Superuser_Users_${facilityCode}`}
                facilityName={workspace.activeFacility?.name || 'Administrasi KAEL'}
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-bold text-slate-900 dark:text-slate-100">
                    Edit Akun &amp; Otorisasi — @{editingAccessUser.username} (
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
                <div className="grid min-w-0 [&>*]:min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-field-min-inline-size)),1fr))] gap-3">
                  <label className="block font-semibold">Username
                    <input required value={editUsername} onChange={(event) => setEditUsername(event.target.value)} className="mt-1 w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900" />
                  </label>
                  <label className="block font-semibold">Nama lengkap
                    <input required value={editFullName} onChange={(event) => setEditFullName(event.target.value)} className="mt-1 w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900" />
                  </label>
                  <label className="block font-semibold">NIP / SIP / STR
                    <input value={editNipOrSip} onChange={(event) => setEditNipOrSip(event.target.value)} className="mt-1 w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900" />
                  </label>
                  <label className="block font-semibold">Email
                    <input type="email" value={editEmail} onChange={(event) => setEditEmail(event.target.value)} className="mt-1 w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900" />
                  </label>
                </div>
                <div>
                  <label className="flex items-center gap-2 font-semibold">
                    <input type="checkbox" checked={editIsPractitioner} onChange={(event) => setEditIsPractitioner(event.target.checked)} />
                    Tenaga pemeriksa klinis
                  </label>
                  <p className="mt-1 text-caption text-slate-500">Akun dapat dipilih sebagai pemeriksa pada antrean jika juga memiliki akses modul RME di fasilitas terkait.</p>
                </div>
                <div className="grid min-w-0 [&>*]:min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-field-min-inline-size)),1fr))] gap-3">
                  <div>
                    <label htmlFor="su-edit-role" className="block font-semibold mb-1">Role Sistem</label>
                    <select
                      id="su-edit-role"
                      value={editUserRole}
                      onChange={(e) => setEditUserRole(e.target.value as UserRole)}
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    >
                      {roles.filter((entry) => entry.active || entry.id === editUserRole).map((entry) => <option key={entry.id} value={entry.id} disabled={!entry.active}>{entry.name}{entry.active ? '' : ' (nonaktif)'}</option>)}
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
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-caption"
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
                    disabled={isSavingUser}
                    className="px-4 py-1.5 rounded bg-teal-700 text-white font-semibold disabled:opacity-60 cursor-pointer"
                  >
                    {isSavingUser ? 'Menyimpan…' : 'Simpan Perubahan Akun'}
                  </button>
                </div>
              </form>
            )}

            <div className="w-full min-w-0 overflow-x-auto overscroll-x-contain">
              <table className="w-full min-w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-caption text-slate-500 bg-slate-50/70 dark:bg-slate-800/50">
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
                        <div className="text-caption font-mono text-slate-500">
                          {u.nipOrSip}
                        </div>
                      </td>
                      <td className="py-2.5 px-2.5 font-mono whitespace-nowrap">
                        <div className="font-semibold text-teal-800 dark:text-teal-300">
                          {roleLabel(u.role)}
                        </div>
                        <div
                          className={`text-caption font-semibold ${
                            u.active
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {u.active ? 'AKTIF' : 'NONAKTIF'}
                        </div>
                      </td>
                      <td className="py-2.5 px-2.5 font-mono text-caption text-slate-700 dark:text-slate-300 max-w-[var(--kael-text-column-inline-size)] break-words">
                        {u.allowedFacilities.includes('*')
                          ? 'SEMUA FASILITAS'
                          : u.allowedFacilities.join(', ')}
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        {editingUserId === u.id ? (
                          <div className="inline-flex items-center gap-1">
                            <input
                              type="password"
                              autoComplete="new-password"
                              value={resetPasswordValue}
                              minLength={8}
                              maxLength={512}
                              onChange={(e) => setResetPasswordValue(e.target.value)}
                              placeholder="Sandi baru..."
                              className="w-24 px-2 py-1 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                            />
                            <button
                              type="button"
                              onClick={() => handleResetUserPassword(u)}
                              className="px-2 py-1 text-caption font-semibold rounded bg-teal-700 text-white cursor-pointer"
                            >
                              Simpan
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingUserId(null)}
                              className="px-2 py-1 text-caption rounded border border-slate-300 dark:border-slate-700"
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
                                setEditUsername(u.username);
                                setEditFullName(u.fullName);
                                setEditNipOrSip(u.nipOrSip);
                                setEditEmail(u.email);
                                setEditIsPractitioner(u.isPractitioner === true);
                                setEditUserRole(u.role);
                                setEditUserFacilities(
                                  u.allowedFacilities.includes('*')
                                    ? workspace.allFacilities.map((f) => f.code)
                                    : [...u.allowedFacilities]
                                );
                              }}
                              className="px-2 py-1 text-caption font-medium rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            >
                              Edit Akun
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingUserId(u.id);
                                setResetPasswordValue('');
                              }}
                              className="px-2 py-1 text-caption font-medium rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1 cursor-pointer"
                            >
                              <KeyRound className="w-3 h-3" />
                              Reset Sandi
                            </button>
                            {u.id !== workspace.user.id && (
                              <>
                              <button
                                type="button"
                                onClick={() => handleToggleUserActive(u)}
                                className="px-2 py-1 text-caption font-medium rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                              >
                                {u.active ? 'Nonaktifkan' : 'Aktifkan'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget({ kind: 'user', id: u.id, name: `Akun @${u.username}` })}
                                className="px-2 py-1 text-caption font-medium rounded border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/50 cursor-pointer"
                              >
                                Hapus Akun
                              </button>
                              </>
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

      {subTab === 'USERS' && (
        <section className="rounded-2xl border border-[#E2ECE8] dark:border-[#183831] bg-white dark:bg-[#0B211D] overflow-hidden">
          <div className="border-b border-slate-200 dark:border-slate-800 px-5 py-4">
            <h2 className="text-sm font-bold">Akun Terhapus ({workspace.deletedUsers?.length || 0})</h2>
            <p className="mt-1 text-xs text-slate-500">Akun terhapus tidak dapat login. Pemulihan mempertahankan identitas dan riwayat, lalu akun dapat diaktifkan kembali.</p>
          </div>
          {(workspace.deletedUsers?.length || 0) > 0 ? (
            <div className="w-full min-w-0 overflow-x-auto overscroll-x-contain">
              <table className="w-full min-w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-caption text-slate-500"><tr><th className="px-5 py-3">Akun</th><th className="px-5 py-3">Role</th><th className="px-5 py-3">Dihapus</th><th className="px-5 py-3 text-right">Tindakan</th></tr></thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {workspace.deletedUsers?.map((user) => (
                    <tr key={user.id}>
                      <td className="px-5 py-3"><div className="font-semibold">@{user.username}</div><div className="mt-0.5 text-slate-500">{user.fullName}</div></td>
                      <td className="px-5 py-3">{roleLabel(user.role)}</td>
                      <td className="px-5 py-3 text-slate-500">{user.deletedAt ? new Date(user.deletedAt).toLocaleString('id-ID') : '—'}</td>
                      <td className="px-5 py-3 text-right"><button type="button" disabled={Boolean(restoringUserId)} onClick={() => handleRestoreUser(user)} className="rounded-lg border border-[#00897B] px-3 py-1.5 text-xs font-semibold text-[#00897B] disabled:opacity-60">{restoringUserId === user.id ? 'Memulihkan…' : 'Pulihkan akun'}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="px-5 py-4 text-xs text-slate-500">Tidak ada akun terhapus.</p>}
        </section>
      )}

      {/* SUB-TAB 2: KATALOG SUB-KAPABILITAS & 15-DOMAIN CONFIGURATION ENGINE (P0-01 to P0-04) */}
      {subTab === 'CAPABILITY_CONFIG' && currentSnapshot && workspace.activeFacility && (
        <div className="min-w-0 space-y-4">
          {/* Top Snapshot Header & Transactional Publish / Non-Destructive Rollback */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                <span className="px-2 py-0.5 rounded bg-teal-100 dark:bg-teal-950 text-teal-800 dark:text-teal-300 font-bold">
                  Revisi aktif {currentSnapshot.configVersion}
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
                Pulihkan konfigurasi sebelumnya
              </button>
              <button
                type="button"
                disabled={isPublishingConfig}
                onClick={handlePublishCapabilityConfig}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-teal-700 hover:bg-teal-800 text-white cursor-pointer"
              >
                {isPublishingConfig
                  ? 'Memvalidasi & Mempublikasikan...'
                  : `Simpan revisi ${currentSnapshot.configVersion + 1}`}
              </button>
            </div>
          </div>

          <div className="grid min-w-0 [&>*]:min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-form-min-inline-size)),1fr))] gap-5 items-start">
            {/* Left 8 Cols: 3-Dimensional Sub-Capability Matrix */}
            <div className="min-w-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Layanan yang diaktifkan ({draftSubCaps.length} dari {SUB_CAPABILITY_CATALOG.length} Aktif)
                </span>
                <span className="text-caption font-mono text-slate-500">
                  Implementation · Operational Readiness · Integration
                </span>
              </div>
              <div className="w-full min-w-0 overflow-x-auto overscroll-x-contain">
                <table className="w-full min-w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-caption text-slate-500 bg-slate-50 dark:bg-slate-800/60">
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
                            <div className="font-mono text-caption text-slate-500">
                              {cap.code} → {cap.mappedModule}
                            </div>
                            {!readiness.canActivate && (
                              <div className="text-caption text-amber-700 dark:text-amber-400 font-medium mt-0.5">
                                Prasyarat: {readiness.missingReasons.join('; ')}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-caption">
                            <span className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-semibold">
                              {cap.implementationStatus}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-caption">
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
                          <td className="py-2.5 px-3 font-mono text-caption text-slate-600 dark:text-slate-400">
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
            <div className="min-w-0 space-y-4">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3 text-xs">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Preview Menu Adaptif ({previewNavItems.length} Sub-Menu)
                </h3>
                <p className="text-caption text-slate-500">
                  Daftar menu sidebar yang akan tampil di {facilityCode} setelah snapshot dipublikasikan:
                </p>
                <div className="space-y-1">
                  {previewNavItems.map((nav) => (
                    <div
                      key={nav.key}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between"
                    >
                      <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {nav.label}
                      </span>
                      <span className="font-mono text-caption text-teal-700 dark:text-teal-400 ml-2 shrink-0">
                        {nav.category}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2.5 text-xs">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Ringkasan Konfigurasi yang Tersimpan
                </h3>
                <div className="space-y-1.5 text-caption text-slate-600 dark:text-slate-300 font-mono">
                  <div>
                    1. Klasifikasi fasilitas:{' '}
                    <strong>{workspace.activeFacility.serviceCapabilityClassification || 'Belum diisi'}</strong>
                  </div>
                  <div>
                    2. Batas rawat inap yang dikonfigurasi:{' '}
                    <strong>
                      {workspace.activeFacility.inpatientStayPolicy?.statutoryMaxDays != null ? `${workspace.activeFacility.inpatientStayPolicy.statutoryMaxDays} hari` : 'Belum ditetapkan'}
                    </strong>
                  </div>
                  <div>
                    3. Kontrak Klaim &amp; Grouper:{' '}
                    <strong>
                      {workspace.activeFacility.payerContract?.reimbursementModel || 'Belum diisi'} ({workspace.activeFacility.payerContract?.grouperVersion || 'Belum diisi'})
                    </strong>
                  </div>
                  <div>
                    4. Metode persediaan dan tarif pajak konfigurasi:{' '}
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
                  <label className="block text-caption font-semibold text-slate-700 dark:text-slate-300 mb-1">
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
        <div className="grid min-w-0 [&>*]:min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-form-min-inline-size)),1fr))] gap-4 items-start">
          {/* Left 5 Cols: Add or Update Facility */}
          <details ref={facilityFormRef} className="group min-w-0">
            <summary className={`${inlineFormLayout ? 'hidden' : 'flex'} mb-2 cursor-pointer list-none items-center justify-between gap-3 rounded-xl border border-[#D5E3DF] bg-white px-4 py-3 text-sm font-semibold text-[#00897B] dark:border-[#1E473F] dark:bg-[#0B211D] [&::-webkit-details-marker]:hidden`}>
              <span className="flex items-center gap-2"><Plus className="h-4 w-4 shrink-0" />{editingFacilityCode ? 'Edit Fasilitas' : 'Tambah Fasilitas'}</span><span className="text-xs group-open:hidden">Buka form</span><span className="hidden text-xs group-open:inline">Tutup</span>
            </summary>
          <form
            onSubmit={handleSaveFacilitySubmit}
            className="min-w-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {editingFacilityCode ? `Edit Fasilitas ${editingFacilityCode}` : 'Tambah Fasilitas Kesehatan'}
              </h2>
              <p className="text-xs text-slate-500">
                Registrasi identitas fasilitas kesehatan dalam jaringan.
              </p>
              </div>
              {editingFacilityCode && <button type="button" onClick={resetFacilityForm} className="shrink-0 text-xs font-semibold text-[#00897B]">Batal edit</button>}
            </div>

            <div className="grid min-w-0 [&>*]:min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-field-min-inline-size)),1fr))] gap-3">
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
                  disabled={Boolean(editingFacilityCode)}
                  placeholder="Kode unik fasilitas"
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
                  onChange={(e) => setFacType(e.target.value as Facility['type'] | '')}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="">Pilih tipe fasilitas</option>
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
                placeholder="Nama resmi fasilitas"
                required
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>

            <div className="grid min-w-0 [&>*]:min-w-0 grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <label className="block text-caption text-slate-500 mb-1">Kode Kemenkes</label>
                <input
                  type="text"
                  value={facKemenkes}
                  onChange={(e) => setFacKemenkes(e.target.value)}
                  placeholder="Kode Kemenkes"
                  className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-caption text-slate-500 mb-1">Kode BPJS</label>
                <input
                  type="text"
                  value={facBpjs}
                  onChange={(e) => setFacBpjs(e.target.value)}
                  placeholder="Kode BPJS"
                  className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-caption text-slate-500 mb-1">SATUSEHAT Org</label>
                <input
                  type="text"
                  value={facSatusehat}
                  onChange={(e) => setFacSatusehat(e.target.value)}
                  placeholder="ID organisasi"
                  className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>

            <div className="grid min-w-0 [&>*]:min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-field-min-inline-size)),1fr))] gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Alamat Fasilitas
                </label>
                <input
                  type="text"
                  value={facAddress}
                  onChange={(e) => setFacAddress(e.target.value)}
                  placeholder="Alamat fasilitas"
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
                  placeholder="Kota atau kabupaten"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>

            <div className="grid min-w-0 [&>*]:min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-field-min-inline-size)),1fr))] gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Telepon Faskes
                </label>
                <input
                  type="text"
                  value={facPhone}
                  onChange={(e) => setFacPhone(e.target.value)}
                  placeholder="Nomor telepon"
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
                  placeholder="https://server.instansi.id"
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={facActive} onChange={(event) => setFacActive(event.target.checked)} />Fasilitas aktif</label>
            <button
              type="submit"
              disabled={isSavingFacility}
              className="w-full py-2.5 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold cursor-pointer"
            >
              {isSavingFacility ? 'Menyimpan...' : 'Simpan Fasilitas ke Server'}
            </button>
          </form>
          </details>

          {/* Right 7 Cols: All Facilities Table */}
          <div className="min-w-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Registri Multi-Fasilitas Aktif ({workspace.allFacilities.length})
              </h2>
              <DataExportToolbar
                title="Registri Master Fasilitas Kesehatan"
                filenameBase={`KAEL_Superuser_Facilities_${facilityCode}`}
                facilityName={workspace.activeFacility?.name || 'Administrasi KAEL'}
                facilityCode={facilityCode}
                columns={suExportColumns}
                rows={suExportRows}
                compact
                contextLabel="Ekspor Faskes"
              />
            </div>
            <div className="w-full min-w-0 overflow-x-auto overscroll-x-contain">
              <table className="w-full min-w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-caption text-slate-500 bg-slate-50/70 dark:bg-slate-800/50">
                    <th className="py-2.5 px-4">Kode FASILITAS</th>
                    <th className="py-2.5 px-4">Nama &amp; Lokasi</th>
                    <th className="py-2.5 px-4">Kode Regulasi Nasional</th>
                    <th className="py-2.5 px-4">Server Node</th>
                    <th className="py-2.5 px-4 text-right">Tindakan</th>
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
                        <div className="text-caption text-slate-500">
                          {f.type.replace(/_/g, ' ')} · {f.address}, {f.city}
                        </div>
                        <div className={`mt-1 text-caption font-semibold ${f.active ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{f.active ? 'AKTIF' : 'NONAKTIF'}</div>
                      </td>
                      <td className="py-3 px-4 font-mono text-caption whitespace-nowrap">
                        <div>Kemenkes: {f.kemenkesCode}</div>
                        <div className="text-slate-500">
                          BPJS: {f.bpjsPcareCode} · SS: {f.satusehatOrgId}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-caption text-slate-500">
                        {f.serverNodeUrl}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <button type="button" onClick={() => editFacility(f)} className="rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-xs">Edit Fasilitas</button>
                          <button type="button" onClick={() => setDeleteTarget({ kind: 'facility', id: f.code, name: `Fasilitas ${f.name}` })} className="rounded-lg border border-red-200 dark:border-red-900 px-2.5 py-1.5 text-xs text-red-700 dark:text-red-300">Hapus Fasilitas</button>
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

      {/* SUB-TAB 3: SERVER CONFIG & AUDIT TRAIL */}
      {subTab === 'SERVER_AUDIT' && (
        <div className="grid min-w-0 [&>*]:min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-form-min-inline-size)),1fr))] gap-4 items-start">
          <details ref={serverFormRef} className="group min-w-0">
            <summary className={`${inlineFormLayout ? 'hidden' : 'flex'} mb-2 cursor-pointer list-none items-center justify-between gap-3 rounded-xl border border-[#D5E3DF] bg-white px-4 py-3 text-sm font-semibold text-[#00897B] dark:border-[#1E473F] dark:bg-[#0B211D] [&::-webkit-details-marker]:hidden`}>
              <span className="flex items-center gap-2"><Plus className="h-4 w-4 shrink-0" />Pengaturan Server</span><span className="text-xs group-open:hidden">Buka form</span><span className="hidden text-xs group-open:inline">Tutup</span>
            </summary>
          <form
            onSubmit={handleSaveServerConfig}
            className="min-w-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3.5"
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
            <div className="grid min-w-0 [&>*]:min-w-0 grid-cols-2 gap-3">
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
          </details>

          {/* Right 7 Cols: Security Audit Log & Database Backup */}
          <div className="min-w-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Log Audit Keamanan &amp; Jejak Aktivitas Lintas Fasilitas
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <DataExportToolbar
                  title="Log Audit Keamanan Server KAEL"
                  filenameBase={`KAEL_Superuser_Audit_${facilityCode}`}
                  facilityName={workspace.activeFacility?.name || 'Administrasi KAEL'}
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
            <div className="w-full min-w-0 overflow-x-auto overscroll-x-contain">
              <table className="w-full min-w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-caption text-slate-500 bg-slate-50/70 dark:bg-slate-800/50">
                    <th className="py-2.5 px-4">Waktu</th>
                    <th className="py-2.5 px-4">Fasilitas &amp; Aktor</th>
                    <th className="py-2.5 px-4">Aksi &amp; Rincian</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {workspace.auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-caption text-slate-500 whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleTimeString('id-ID')}
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <div className="font-mono font-bold text-teal-800 dark:text-teal-300">
                          {log.facilityCode}
                        </div>
                        <div className="text-caption font-mono text-slate-500">
                          @{log.actorUsername} ({log.actorRole})
                        </div>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="font-mono text-caption font-semibold text-slate-900 dark:text-slate-100">
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
