import React, { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Activity,
  BedDouble,
  Building2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  CreditCard,
  FlaskConical,
  Landmark,
  LayoutDashboard,
  LogOut,
  Moon,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Pill,
  RefreshCw,
  Search,
  ShieldCheck,
  Stethoscope,
  Sun,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { LoginView } from './components/LoginView';
import { ModuleKey, VisitQueueItem } from './domain/simrs.ts';
import {
  ApiError,
  kaelApi,
  loadStoredSession,
  saveStoredSession,
  StoredSession,
  WorkspacePayload,
} from './utils/apiClient';
import { canUserAccessModule } from './domain/clinicalLogic.ts';

import {
  buildDefaultFacilityConfigSnapshot,
  NAV_GROUP_TITLES,
  NavGroupKey,
  resolveFacilityNavigation,
} from './domain/platformEngine.ts';

const AllPatientsModule = lazy(() => import('./components/AllPatientsModule').then((module) => ({ default: module.AllPatientsModule })));
const CashierAndBridgingModule = lazy(() => import('./components/CashierAndBridgingModule').then((module) => ({ default: module.CashierAndBridgingModule })));
const DashboardModule = lazy(() => import('./components/DashboardModule').then((module) => ({ default: module.DashboardModule })));
const DoctorRmeModule = lazy(() => import('./components/DoctorRmeModule').then((module) => ({ default: module.DoctorRmeModule })));
const OwnerFinanceModule = lazy(() => import('./components/OwnerFinanceModule').then((module) => ({ default: module.OwnerFinanceModule })));
const PharmacyAndLabModule = lazy(() => import('./components/PharmacyAndLabModule').then((module) => ({ default: module.PharmacyAndLabModule })));
const RegistrationAndBedsModule = lazy(() => import('./components/RegistrationAndBedsModule').then((module) => ({ default: module.RegistrationAndBedsModule })));
const SdmErpModule = lazy(() => import('./components/SdmErpModule').then((module) => ({ default: module.SdmErpModule })));
const SuperuserControlModule = lazy(() => import('./components/SuperuserControlModule').then((module) => ({ default: module.SuperuserControlModule })));

const MODULE_ICON_MAP: Record<ModuleKey, React.ComponentType<{ className?: string }>> = {
  DASHBOARD: LayoutDashboard,
  SEMUA_PASIEN: Users,
  PENDAFTARAN: ClipboardList,
  JADWAL_DOKTER: ClipboardList,
  RAWAT_INAP: BedDouble,
  RME_DOKTER: Stethoscope,
  IGD_TRIASE_EWS: Activity,
  GIGI_ODONTOGRAM: Stethoscope,
  KIA_IMUNISASI: Users,
  PROLANIS_PRB: Activity,
  BEDAH_IBS: Stethoscope,
  MCU_SURAT_MEDIS: ClipboardList,
  APOTEK: Pill,
  KATALOG_OPNAME: Pill,
  MUTASI_STOK: Pill,
  PENGADAAN_PBF: Pill,
  LABORATORIUM: FlaskConical,
  RADIOLOGI_RIS: FlaskConical,
  PENUNJANG_RS: Building2,
  KASIR_AKUNTANSI: CreditCard,
  KEUANGAN_OWNER: Landmark,
  NERACA_GL: Landmark,
  KLAIM_BPJS_PIUTANG: Landmark,
  JASA_MEDIS_REMUN: Landmark,
  SDM_JADWAL: UserCheck,
  SDM_ERP: UserCheck,
  LAPORAN_REGULASI: Activity,
  BRIDGING_SATUSEHAT: Activity,
  SUPERUSER_CONTROL: ShieldCheck,
};

const CATEGORY_MINI_META: Record<
  Exclude<NavGroupKey, 'TOP'>,
  { shortLabel: string; icon: React.ComponentType<{ className?: string }> }
> = {
  PENDAFTARAN_ADMISI: { shortLabel: 'Pendaftaran', icon: ClipboardList },
  PELAYANAN_MEDIS: { shortLabel: 'Pelayanan', icon: Stethoscope },
  FARMASI_LOGISTIK: { shortLabel: 'Farmasi', icon: Pill },
  PENUNJANG_INSTALASI: { shortLabel: 'Penunjang', icon: FlaskConical },
  KEUANGAN_AKUNTANSI: { shortLabel: 'Keuangan', icon: Landmark },
  SDM_KEPEGAWAIAN: { shortLabel: 'SDM', icon: UserCheck },
  PELAPORAN_OTORITAS: { shortLabel: 'Pelaporan', icon: Activity },
  INTEGRASI_LAYANAN: { shortLabel: 'Integrasi', icon: Activity },
  ADMINISTRASI: { shortLabel: 'Administrasi', icon: ShieldCheck },
};

export default function App() {
  const [session, setSession] = useState<StoredSession | null>(() => loadStoredSession());
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(null);
  const [activeModule, setActiveModule] = useState<ModuleKey>('DASHBOARD');
  const [selectedRmeVisitId, setSelectedRmeVisitId] = useState<string | null>(null);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('kael_theme_dark') === 'true';
  });
  const [logoError, setLogoError] = useState(false);
  const [isNarrowLayout, setIsNarrowLayout] = useState(true);
  const workspaceLayoutRef = useRef<HTMLDivElement>(null);
  const mainMinimumRef = useRef<HTMLSpanElement>(null);
  const sidebarMinimumRef = useRef<HTMLSpanElement>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const commandDialogRef = useRef<HTMLDialogElement>(null);
  const commandTriggerRef = useRef<HTMLButtonElement>(null);
  const [commandQuery, setCommandQuery] = useState('');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const mobileNavTrigger = useRef<HTMLButtonElement>(null);
  const mainViewportRef = useRef<HTMLElement>(null);
  const [miniFlyoutCategory, setMiniFlyoutCategory] = useState<NavGroupKey | null>(null);
  // Open each navigation group when its destination is selected.
  const [expandedGroups, setExpandedGroups] = useState<Record<NavGroupKey, boolean>>({
    PENDAFTARAN_ADMISI: false,
    PELAYANAN_MEDIS: false,
    FARMASI_LOGISTIK: false,
    PENUNJANG_INSTALASI: false,
    KEUANGAN_AKUNTANSI: false,
    SDM_KEPEGAWAIAN: false,
    PELAPORAN_OTORITAS: false,
    INTEGRASI_LAYANAN: false,
    ADMINISTRASI: false,
  });

  useLayoutEffect(() => {
    const layout = workspaceLayoutRef.current;
    const mainMinimum = mainMinimumRef.current;
    const sidebarMinimum = sidebarMinimumRef.current;
    if (!layout || !mainMinimum || !sidebarMinimum) return;
    const measure = () => setIsNarrowLayout(layout.clientWidth < mainMinimum.getBoundingClientRect().width + sidebarMinimum.getBoundingClientRect().width);
    const observer = new ResizeObserver(measure);
    observer.observe(layout);
    observer.observe(mainMinimum);
    observer.observe(sidebarMinimum);
    measure();
    return () => observer.disconnect();
  }, [session?.token, workspace?.activeFacility?.code, isSidebarCollapsed]);

  useEffect(() => {
    if (!isNarrowLayout) setMobileNavOpen(false);
  }, [isNarrowLayout]);

  const navigateAndExpandCategory = useCallback((targetModule: ModuleKey) => {
    setActiveModule(targetModule);
    setMobileNavOpen(false);
    setMiniFlyoutCategory(null);
    const groupByModule: Partial<Record<ModuleKey, NavGroupKey>> = {
      SEMUA_PASIEN: 'PENDAFTARAN_ADMISI',
      PENDAFTARAN: 'PENDAFTARAN_ADMISI',
      JADWAL_DOKTER: 'PENDAFTARAN_ADMISI',
      RAWAT_INAP: 'PENDAFTARAN_ADMISI',
      RME_DOKTER: 'PELAYANAN_MEDIS',
      IGD_TRIASE_EWS: 'PELAYANAN_MEDIS',
      GIGI_ODONTOGRAM: 'PELAYANAN_MEDIS',
      KIA_IMUNISASI: 'PELAYANAN_MEDIS',
      PROLANIS_PRB: 'PELAYANAN_MEDIS',
      BEDAH_IBS: 'PELAYANAN_MEDIS',
      MCU_SURAT_MEDIS: 'PELAYANAN_MEDIS',
      APOTEK: 'FARMASI_LOGISTIK',
      KATALOG_OPNAME: 'FARMASI_LOGISTIK',
      MUTASI_STOK: 'FARMASI_LOGISTIK',
      PENGADAAN_PBF: 'FARMASI_LOGISTIK',
      LABORATORIUM: 'PENUNJANG_INSTALASI',
      RADIOLOGI_RIS: 'PENUNJANG_INSTALASI',
      PENUNJANG_RS: 'PENUNJANG_INSTALASI',
      KASIR_AKUNTANSI: 'KEUANGAN_AKUNTANSI',
      KEUANGAN_OWNER: 'KEUANGAN_AKUNTANSI',
      NERACA_GL: 'KEUANGAN_AKUNTANSI',
      KLAIM_BPJS_PIUTANG: 'KEUANGAN_AKUNTANSI',
      JASA_MEDIS_REMUN: 'KEUANGAN_AKUNTANSI',
      SDM_JADWAL: 'SDM_KEPEGAWAIAN',
      SDM_ERP: 'SDM_KEPEGAWAIAN',
      LAPORAN_REGULASI: 'PELAPORAN_OTORITAS',
      BRIDGING_SATUSEHAT: 'INTEGRASI_LAYANAN',
      SUPERUSER_CONTROL: 'ADMINISTRASI',
    };
    const cat = groupByModule[targetModule];
    if (cat) {
      setExpandedGroups((prev) => (prev[cat] ? prev : { ...prev, [cat]: true }));
    }
  }, []);

  useEffect(() => {
    mainViewportRef.current?.scrollTo({ top: 0, behavior: 'instant' });
  }, [activeModule]);

  useEffect(() => {
    if (!commandOpen) return;
    const dialog = commandDialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMobileNavOpen(false);
    dialog.showModal();
    return () => {
      dialog.close();
      const target = previousFocus?.isConnected && previousFocus.getClientRects().length ? previousFocus : commandTriggerRef.current;
      target?.focus({ preventScroll: true });
    };
  }, [commandOpen]);

  useEffect(() => {
    if (session) return;
    setMobileNavOpen(false);
    setCommandOpen(false);
    setMiniFlyoutCategory(null);
  }, [session]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const panel = sidebarRef.current;
    const focusable = () => Array.from(panel?.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), a[href], input:not([disabled])') || []).filter((element) => element.getClientRects().length > 0);
    focusable()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileNavOpen(false);
      }
      if (event.key === 'Tab') {
        const controls = focusable();
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      if (!commandDialogRef.current?.open) mobileNavTrigger.current?.focus();
    };
  }, [mobileNavOpen]);

  // Sync dark mode class on <html>
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('kael_theme_dark', String(darkMode));
  }, [darkMode]);

  const workspaceRequest = useRef<AbortController | null>(null);
  const fetchActiveWorkspace = useCallback(async (activeSession: StoredSession) => {
    workspaceRequest.current?.abort();
    const request = new AbortController();
    workspaceRequest.current = request;
    setIsLoadingWorkspace(true);
    setWorkspaceError(null);
    try {
      const data = await kaelApi.fetchWorkspace(
        activeSession.token,
        activeSession.activeFacility?.code || '',
        request.signal
      );
      if (!request.signal.aborted) setWorkspace(data);
    } catch (err) {
      if (request.signal.aborted) return;
      const msg = err instanceof Error ? err.message : 'Gagal memuat data server.';
      setWorkspaceError(msg);
      if (err instanceof ApiError && err.status === 401) {
        saveStoredSession(null);
        setSession(null);
        setWorkspace(null);
      }
    } finally {
      if (!request.signal.aborted) setIsLoadingWorkspace(false);
    }
  }, []);

  useEffect(() => {
    if (session) void fetchActiveWorkspace(session);
    return () => workspaceRequest.current?.abort();
  }, [session, fetchActiveWorkspace]);

  // Workspace keyboard shortcuts: command palette, sidebar, and module navigation.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && session && workspace) {
        e.preventDefault();
        setCommandOpen((prev) => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        if (!isNarrowLayout) setIsSidebarCollapsed((prev) => !prev);
        else { setIsSidebarCollapsed(false); setMobileNavOpen((prev) => !prev); }
        setMiniFlyoutCategory(null);
      }
      if (e.key === 'Escape') {
        setCommandOpen(false);
        setMiniFlyoutCategory(null);
      }
      if (e.altKey && session && workspace) {
        const keyMap: Record<string, ModuleKey> = {
          '1': 'DASHBOARD',
          '2': 'SEMUA_PASIEN',
          '3': 'PENDAFTARAN',
          '4': 'RME_DOKTER',
          '5': 'RAWAT_INAP',
          '6': 'APOTEK',
          '7': 'LABORATORIUM',
          '8': 'KEUANGAN_OWNER',
          '9': 'KASIR_AKUNTANSI',
          s: 'SDM_ERP',
          b: 'BRIDGING_SATUSEHAT',
          '0': 'SUPERUSER_CONTROL',
        };
        const targetKey = keyMap[e.key.toLowerCase()];
        if (targetKey && canUserAccessModule(workspace.user, targetKey)) {
          e.preventDefault();
          navigateAndExpandCategory(targetKey);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [session, workspace, navigateAndExpandCategory, isNarrowLayout]);

  const handleLoginSuccess = (newSession: StoredSession) => {
    saveStoredSession(newSession);
    setSession(newSession);
    setActiveModule('DASHBOARD');
  };

  const handleLogout = () => {
    workspaceRequest.current?.abort();
    if (session) void kaelApi.logout(session.token).catch(() => {});
    saveStoredSession(null);
    setSession(null);
    setWorkspace(null);
  };

  const handleSwitchFacility = async (newFacilityCode: string) => {
    if (!session || isLoadingWorkspace || newFacilityCode === session.activeFacility?.code) return;
    setIsLoadingWorkspace(true);
    try {
      const switched = await kaelApi.switchFacility(session.token, newFacilityCode);
      const updatedSession: StoredSession = {
        ...session,
        activeFacility: switched.activeFacility,
        accessibleFacilities: switched.accessibleFacilities,
      };
      workspaceRequest.current?.abort();
      setWorkspace(null);
      setActiveModule('DASHBOARD');
      saveStoredSession(updatedSession);
      setSession(updatedSession);
      setSelectedRmeVisitId(null);
    } catch (err) {
      setWorkspaceError(
        err instanceof Error ? err.message : 'Gagal beralih fasilitas kesehatan.'
      );
      setIsLoadingWorkspace(false);
    }
  };

  const handleOpenVisitInRme = (visit: VisitQueueItem) => {
    setSelectedRmeVisitId(visit.id);
    navigateAndExpandCategory('RME_DOKTER');
  };

  const handleNavigateModuleWithVisit = (moduleKey: ModuleKey, visitId?: string) => {
    if (visitId) {
      setSelectedRmeVisitId(visitId);
    }
    navigateAndExpandCategory(moduleKey);
  };

  const toggleGroup = (cat: NavGroupKey) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [cat]: !prev[cat],
    }));
  };

  if (!session) {
    return <LoginView onLoginSuccess={handleLoginSuccess} />;
  }

  const effectiveUser = workspace?.user || session.user;
  const effectiveFacility = workspace ? workspace.activeFacility : session.activeFacility;

  if (!effectiveFacility) {
    return (
      <div className="kael-workspace h-dvh flex flex-col overflow-hidden bg-[#F3F8F6] dark:bg-[#061714] text-[#0F2922] dark:text-[#ECF5F2]">
        <header className="shrink-0 border-b border-[#D5E3DF] dark:border-[#183831] bg-white dark:bg-[#0B211D] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Pengelolaan platform</h1>
            <p className="text-sm text-[#52736B] dark:text-[#86B5A9] mt-1">Selamat datang, {effectiveUser.username}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {!!workspace?.allFacilities.some((facility) => facility.active) && (
              <label className="text-sm flex items-center gap-2">
                Buka fasilitas
                <select
                  aria-label="Buka fasilitas"
                  value=""
                  disabled={isLoadingWorkspace}
                  onChange={(event) => void handleSwitchFacility(event.target.value)}
                  className="rounded-lg border border-[#D5E3DF] bg-white dark:bg-[#0B211D] p-2"
                >
                  <option value="" disabled>Pilih fasilitas</option>
                  {workspace.allFacilities.filter((facility) => facility.active).map((facility) => (
                    <option key={facility.code} value={facility.code}>{facility.name}</option>
                  ))}
                </select>
              </label>
            )}
            <button type="button" onClick={handleLogout} className="px-4 py-2 rounded-lg border border-[#D5E3DF] text-sm">Keluar</button>
          </div>
        </header>
        <main className="kael-content min-h-0 flex-1 overflow-y-auto w-full mx-auto p-3 sm:p-4">
          {!workspace?.allFacilities.length && (
            <p className="mb-5 rounded-xl border border-[#D5E3DF] bg-white dark:bg-[#0B211D] p-4 text-sm">Mulai dengan membuat fasilitas, lalu atur role dan akun pengguna sesuai kebutuhan.</p>
          )}
          {workspaceError && <p role="alert" className="mb-4 text-sm text-red-700 dark:text-red-300">{workspaceError}</p>}
          {workspace ? (
            <Suspense fallback={<p role="status">Memuat pengelolaan platform…</p>}>
              <SuperuserControlModule token={session.token} facilityCode="" workspace={workspace} onRefreshWorkspace={() => fetchActiveWorkspace(session)} />
            </Suspense>
          ) : (
            <div role="status" className="rounded-xl bg-white dark:bg-[#0B211D] p-6">
              <p>{isLoadingWorkspace ? 'Memuat pengelolaan platform…' : 'Pengelolaan platform belum dapat dimuat.'}</p>
              {!isLoadingWorkspace && <button type="button" onClick={() => void fetchActiveWorkspace(session)} className="mt-3 text-[#00897B]">Coba lagi</button>}
            </div>
          )}
        </main>
      </div>
    );
  }
  const accessibleFacilities =
    workspace?.accessibleFacilities || session.accessibleFacilities;

  const activeConfig =
    workspace?.activeFacilityConfig ||
    buildDefaultFacilityConfigSnapshot(effectiveFacility);

  const resolvedNavItems = resolveFacilityNavigation(
    activeConfig,
    effectiveUser,
    effectiveFacility.code
  );

  const allowedNavItems = resolvedNavItems.map((item) => ({
    key: item.moduleKey,
    label: item.label,
    subtitle: item.subtitle,
    category: item.group,
    shortKey: item.shortKey,
    icon: MODULE_ICON_MAP[item.moduleKey] || Activity,
  }));

  const visibleModule = allowedNavItems.some(({ key }) => key === activeModule) ? activeModule : allowedNavItems[0]?.key;

  const activeNavMeta =
    allowedNavItems.find((n) => n.key === visibleModule) ||
    allowedNavItems[0] || {
      key: 'DASHBOARD' as ModuleKey,
      label: 'Ringkasan Eksekutif',
      subtitle: 'Indikator Klinis & Keuangan',
      category: 'TOP' as NavGroupKey,
      shortKey: 'Alt+1',
      icon: LayoutDashboard,
    };

  const categoriesOrder: NavGroupKey[] = [
    'PENDAFTARAN_ADMISI',
    'PELAYANAN_MEDIS',
    'FARMASI_LOGISTIK',
    'PENUNJANG_INSTALASI',
    'KEUANGAN_AKUNTANSI',
    'SDM_KEPEGAWAIAN',
    'PELAPORAN_OTORITAS',
    'INTEGRASI_LAYANAN',
    'ADMINISTRASI',
  ];

  const topItem = allowedNavItems.find((i) => i.key === 'DASHBOARD');

  return (
    <div className="kael-workspace h-dvh w-full overflow-hidden bg-[#F3F8F6] dark:bg-[#061714] text-[#0F2922] dark:text-[#ECF7F4] flex flex-col">
      <div ref={workspaceLayoutRef} className="relative flex-1 flex min-h-0">
        <span aria-hidden="true" ref={mainMinimumRef} className="kael-layout-probe" style={{ inlineSize: 'var(--kael-workspace-min-main-inline-size)' }} />
        <span aria-hidden="true" ref={sidebarMinimumRef} className="kael-layout-probe" style={{ inlineSize: isSidebarCollapsed ? 'var(--kael-sidebar-rail-inline-size)' : 'var(--kael-sidebar-inline-size)' }} />
        {mobileNavOpen && isNarrowLayout && <button type="button" onClick={() => setMobileNavOpen(false)} aria-label="Tutup latar menu" className="fixed inset-0 z-30 bg-black/40" />}
        {/* Workspace navigation follows the configured panel size and available content space. */}
        <aside
          ref={sidebarRef}
          id="workspace-navigation"
          role={mobileNavOpen ? 'dialog' : undefined}
          aria-modal={mobileNavOpen || undefined}
          aria-label={mobileNavOpen ? 'Navigasi layanan' : undefined}
          data-testid="kael-left-sidebar"
          data-sidebar-mode={isSidebarCollapsed ? 'minimal-icons' : 'expanded'}
          className={`${isNarrowLayout ? `fixed inset-y-0 left-0 z-40 ${mobileNavOpen ? 'flex' : 'hidden'}` : 'relative z-30 flex'} ${
            isSidebarCollapsed && !isNarrowLayout ? 'kael-sidebar-rail' : 'kael-sidebar-full'
          } shrink-0 min-h-0 bg-[#0C3B33] dark:bg-[#072620] text-[#E6F4F1] border-r border-[#164E44] flex-col justify-between no-print select-none`}
        >
          {isNarrowLayout && <button type="button" onClick={() => setMobileNavOpen(false)} aria-label="Tutup navigasi" className="absolute right-3 top-3 p-2 rounded-lg hover:bg-white/10"><X /></button>}
          {isSidebarCollapsed ? (
            /* MINIMALIST CATEGORY RAIL MODE: Shows Categories (not subcategories) with icon + small readable label below */
            <>
              <div className="flex-1 flex flex-col items-center min-h-0 py-3">
                {/* Compact Brand + Expand Button */}
                <div className="flex flex-col items-center gap-2 pb-3 border-b border-[#164E44] w-full px-2">
                  {!logoError ? (
                    <img
                      src="/assets/kael-logo.png"
                      alt="KAEL"
                      referrerPolicy="no-referrer"
                      onError={() => setLogoError(true)}
                      className="w-7 h-7 object-contain"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-lg bg-[#00897B] text-white font-bold flex items-center justify-center text-xs">
                      K
                    </div>
                  )}
                  <button
                    type="button"
                    data-testid="sidebar-toggle-btn"
                    onClick={() => {
                      setIsSidebarCollapsed(false);
                      setMiniFlyoutCategory(null);
                    }}
                    title="Perluas menu kiri (Ctrl+B)"
                    aria-label="Perluas menu kiri"
                    className="p-1.5 rounded-xl text-[#9BC4BC] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <PanelLeftOpen className="w-4 h-4" />
                  </button>
                </div>

                {/* Category Buttons with Icon + Small Label Underneath */}
                <nav
                  aria-label="Menu Minimalis Kategori KAEL"
                  className="flex-1 w-full px-1.5 py-2.5 space-y-1.5 overflow-y-auto kael-sidebar-scroll flex flex-col items-center"
                >
                  {topItem && (
                    <button
                      type="button"
                      data-testid="nav-mini-DASHBOARD"
                      onClick={() => {
                        setActiveModule('DASHBOARD');
                        setMobileNavOpen(false);
                        setMiniFlyoutCategory(null);
                      }}
                      title={topItem.label}
                      aria-label={topItem.label}
                      className={`relative w-full py-2 px-1 rounded-xl flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer ${
                        activeModule === 'DASHBOARD' && !miniFlyoutCategory
                          ? 'bg-white/15 text-white font-semibold'
                          : 'text-[#9BC4BC] hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {activeModule === 'DASHBOARD' && !miniFlyoutCategory && (
                        <span
                          aria-hidden="true"
                          className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-[#E5A93C]"
                        />
                      )}
                      <LayoutDashboard className="w-4 h-4 shrink-0 text-[#80CBC4]" />
                      <span className="text-caption leading-tight text-center truncate w-full">
                        Ringkasan
                      </span>
                    </button>
                  )}

                  {categoriesOrder.map((cat) => {
                    const items = allowedNavItems.filter((item) => item.category === cat);
                    if (items.length === 0) return null;
                    const meta = CATEGORY_MINI_META[cat as Exclude<NavGroupKey, 'TOP'>] || {
                      shortLabel: NAV_GROUP_TITLES[cat],
                      icon: Activity,
                    };
                    const IconComp = meta.icon;
                    const isCategoryActive =
                      items.some((i) => i.key === activeModule) || miniFlyoutCategory === cat;

                    return (
                      <button
                        key={cat}
                        type="button"
                        data-testid={`nav-mini-cat-${cat}`}
                        onClick={() => {
                          if (!items.some((i) => i.key === activeModule)) {
                            setActiveModule(items[0].key);
                          }
                          setMiniFlyoutCategory((prev) => (prev === cat ? null : cat));
                        }}
                        title={NAV_GROUP_TITLES[cat]}
                        aria-label={NAV_GROUP_TITLES[cat]}
                        className={`relative w-full py-2 px-1 rounded-xl flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer ${
                          isCategoryActive
                            ? 'bg-white/15 text-white font-semibold'
                            : 'text-[#9BC4BC] hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        {isCategoryActive && (
                          <span
                            aria-hidden="true"
                            className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-[#E5A93C]"
                          />
                        )}
                        <IconComp className="w-4 h-4 shrink-0 text-[#80CBC4]" />
                        <span className="text-caption leading-tight text-center truncate w-full">
                          {meta.shortLabel}
                        </span>
                      </button>
                    );
                  })}
                </nav>
              </div>

              {/* Floating Subcategory Flyout when a Category is clicked in Mini Mode */}
              {miniFlyoutCategory && (
                <div
                  data-testid="mini-sidebar-flyout"
                  className="kael-nav-flyout absolute top-16 rounded-2xl bg-[#0C3B33] dark:bg-[#072620] border border-[#1E5B4F] shadow-xl p-2.5 space-y-1 z-50"
                >
                  <div className="px-2.5 py-1.5 flex items-center justify-between border-b border-[#164E44]">
                    <span className="text-caption font-bold uppercase tracking-wider text-[#9BC4BC]">
                      {NAV_GROUP_TITLES[miniFlyoutCategory]}
                    </span>
                    <button
                      type="button"
                      onClick={() => setMiniFlyoutCategory(null)}
                      className="text-caption text-[#9BC4BC] hover:text-white cursor-pointer"
                    >
                      Tutup
                    </button>
                  </div>
                  <div className="pt-1 space-y-0.5">
                    {allowedNavItems
                      .filter((item) => item.category === miniFlyoutCategory)
                      .map((item) => {
                        const SubIcon = item.icon;
                        const isSubActive = activeModule === item.key;
                        return (
                          <button
                            key={item.key}
                            type="button"
                            onClick={() => {
                              setActiveModule(item.key);
                              setMobileNavOpen(false);
                              setMiniFlyoutCategory(null);
                            }}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left text-xs transition-colors cursor-pointer ${
                              isSubActive
                                ? 'bg-white/15 text-white font-semibold'
                                : 'text-[#C8E4DD] hover:bg-white/10 hover:text-white'
                            }`}
                          >
                            <SubIcon className="w-3.5 h-3.5 shrink-0 text-[#80CBC4]" />
                            <span className="truncate">{item.label}</span>
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Minimalist Bottom User Avatar & Logout Icon */}
              <div className="p-2.5 border-t border-[#185247] bg-[#0A332C] flex flex-col items-center gap-2">
                <div
                  title={`${effectiveUser.username} di ${effectiveFacility.name}`}
                  className="w-9 h-9 rounded-xl bg-[#124B41] text-[#A7E8DC] font-mono text-xs font-bold flex items-center justify-center"
                >
                  {effectiveUser.fullName.slice(0, 2).toUpperCase()}
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  title="Keluar dari akun"
                  aria-label="Keluar dari akun"
                  className="w-full py-1.5 px-1 rounded-xl bg-white hover:bg-[#EBF4F1] text-[#0C3B33] flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="text-caption font-semibold leading-none">Keluar</span>
                </button>
              </div>
            </>
          ) : (
            /* EXPANDED FULL SIDEBAR MODE */
            <>
              <div className="flex-1 flex flex-col min-h-0">
                {/* Official KAEL Brand Header + Minimize Sidebar Button */}
                <div className="px-5 pt-5 pb-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      {!logoError ? (
                        <img
                          src="/assets/kael-logo.png"
                          alt="Logo KAEL"
                          referrerPolicy="no-referrer"
                          onError={() => setLogoError(true)}
                          className="w-9 h-9 object-contain shrink-0"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-lg bg-[#00897B] text-white font-bold flex items-center justify-center text-sm">
                          K
                        </div>
                      )}
                      <div>
                        <div className="font-bold text-xl tracking-wide text-white leading-none">
                          KAEL
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      data-testid="sidebar-toggle-btn"
                      onClick={() => setIsSidebarCollapsed(true)}
                      title="Mode minimalis ikon (Ctrl+B)"
                      aria-label="Sembunyikan menu ke mode ikon minimalis"
                      className={`${isNarrowLayout ? 'hidden' : 'inline-flex'} p-1.5 rounded-lg text-[#9BC4BC] hover:text-white hover:bg-white/10 transition-colors cursor-pointer`}
                    >
                      <PanelLeftClose className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="mt-2.5 text-caption font-semibold tracking-[0.14em] text-[#9BC4BC] uppercase">
                    {effectiveFacility.name}
                  </div>
                </div>

                {/* Facility Switcher for Multi-Clinic / Hospital Accounts */}
                {accessibleFacilities.length > 1 && (
                  <div className="px-4 pb-3">
                    <label
                      htmlFor="sidebar-facility-switcher"
                      className="block text-caption font-semibold uppercase tracking-wider text-[#9BC4BC] mb-1 flex items-center gap-1.5"
                    >
                      <Building2 className="w-3 h-3 text-[#4DB6AC]" />
                      <span>Fasilitas Aktif</span>
                    </label>
                    <select
                      id="sidebar-facility-switcher"
                      value={effectiveFacility.code}
                      onChange={(e) => handleSwitchFacility(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono font-semibold rounded-xl border border-[#1E5B4F] bg-[#082B25] text-white focus:outline-hidden focus:border-[#4DB6AC] cursor-pointer"
                    >
                      {accessibleFacilities.map((fac) => (
                        <option
                          key={fac.code}
                          value={fac.code}
                          className="bg-[#082B25] text-white"
                        >
                          {fac.code} — {fac.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Seamless Scrollable Navigation */}
                <nav
                  aria-label="Menu Utama KAEL"
                  className="min-h-0 flex-1 px-3 py-2 space-y-2 overflow-y-auto kael-sidebar-scroll"
                >
                  {/* Top-Level Workspace Summary */}
                  {topItem && (
                    <div>
                      <button
                        type="button"
                        onClick={() => { setActiveModule('DASHBOARD'); setMobileNavOpen(false); }}
                        className={`group relative w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-colors cursor-pointer ${
                          activeModule === 'DASHBOARD'
                            ? 'bg-white/10 text-white font-semibold'
                            : 'text-[#C8E4DD] hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        {activeModule === 'DASHBOARD' && (
                          <span
                            aria-hidden="true"
                            className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-full bg-[#E5A93C]"
                          />
                        )}
                        <LayoutDashboard className="w-4 h-4 shrink-0 text-[#80CBC4]" />
                        <span className="text-sm truncate">{topItem.label}</span>
                      </button>
                    </div>
                  )}

                  {/* Collapsible Category Sections */}
                  {categoriesOrder.map((cat) => {
                    const items = allowedNavItems.filter((item) => item.category === cat);
                    if (items.length === 0) return null;
                    const isExpanded = expandedGroups[cat];
                    return (
                      <div key={cat} className="space-y-1">
                        <button
                          type="button"
                          onClick={() => toggleGroup(cat)}
                          className="w-full flex items-center gap-1.5 px-2 py-1 text-caption font-semibold uppercase tracking-[0.08em] text-[#9BC4BC] hover:text-white transition-colors cursor-pointer"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-3 h-3 shrink-0 text-[#9BC4BC]" />
                          ) : (
                            <ChevronRight className="w-3 h-3 shrink-0 text-[#9BC4BC]" />
                          )}
                          <span>{NAV_GROUP_TITLES[cat]}</span>
                        </button>

                        {isExpanded && (
                          <div className="space-y-0.5 pl-1">
                            {items.map((item) => {
                              const IconComp = item.icon;
                              const isActive = activeModule === item.key;
                              return (
                                <button
                                  key={item.key}
                                  type="button"
                                  onClick={() => { setActiveModule(item.key); setMobileNavOpen(false); }}
                                  className={`group relative w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-colors cursor-pointer ${
                                    isActive
                                      ? 'bg-white/10 text-white font-semibold'
                                      : 'text-[#C8E4DD] hover:bg-white/5 hover:text-white'
                                  }`}
                                >
                                  {isActive && (
                                    <span
                                      aria-hidden="true"
                                      className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-full bg-[#E5A93C]"
                                    />
                                  )}
                                  <IconComp className="w-4 h-4 shrink-0 text-[#80CBC4]" />
                                  <div className="min-w-0">
                                    <div className="text-sm truncate leading-snug">
                                      {item.label}
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </nav>
              </div>

              {/* Bottom User Profile & White Logout Button matching Reference */}
              <div className="p-4 border-t border-[#185247] bg-[#0A332C] space-y-3">
                <div className="space-y-0.5">
                  <div className="text-xs font-medium text-white truncate">
                    {effectiveUser.username}
                  </div>
                  <div className="flex items-center justify-between gap-2 text-caption font-mono text-[#9BC4BC]">
                    <span className="truncate" title={effectiveFacility.name}>
                      {effectiveFacility.name}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-[#124B41] text-[#A7E8DC] text-caption">
                      {session.rememberMe ? 'Sesi tersimpan' : 'Sesi browser'}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full py-2.5 px-3 rounded-xl bg-white hover:bg-[#EBF4F1] text-[#0C3B33] text-xs font-semibold text-center transition-colors shadow-xs cursor-pointer"
                >
                  Keluar dari akun
                </button>
              </div>
            </>
          )}
        </aside>

        {/* Right Main Content Area */}
        <div inert={mobileNavOpen || undefined} className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* Top Bar */}
          <header className="shrink-0 bg-[#F3F8F6] dark:bg-[#061714] border-b border-[#E2ECE8] dark:border-[#14332C] px-3 sm:px-4 py-2 flex items-center justify-between gap-2 no-print">
            {isNarrowLayout && <button ref={mobileNavTrigger} type="button" onClick={() => { setIsSidebarCollapsed(false); setMobileNavOpen(true); }} aria-label="Buka navigasi" aria-expanded={mobileNavOpen} aria-controls="workspace-navigation" className="p-2 rounded-lg border border-[#D5E3DF] dark:border-[#1E473F]"><Menu /></button>}
            <div className="flex items-center gap-2.5 text-xs text-[#52736B] dark:text-[#86B5A9] truncate">
              <span className="hidden sm:inline font-mono font-semibold uppercase tracking-wider text-[#3B6259] dark:text-[#9BC4BC]">
                {effectiveFacility.code}
              </span>
              <span aria-hidden="true" className="hidden sm:inline">/</span>
              <span className="font-medium text-[#0F2922] dark:text-white truncate">
                {activeNavMeta.label}
              </span>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <div
                role="status"
                className={`hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-caption font-semibold tracking-wide ${workspaceError ? 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300' : isLoadingWorkspace ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300' : 'bg-[#E1F3EC] dark:bg-[#0F3830] text-[#00796B] dark:text-[#4DB6AC]'}`}
              >
                <span className={`w-2 h-2 rounded-full ${workspaceError ? 'bg-red-500' : isLoadingWorkspace ? 'bg-amber-500 animate-pulse' : 'bg-[#00897B]'}`} />
                <span>{workspaceError ? 'KONEKSI TERGANGGU' : isLoadingWorkspace ? 'MEMUAT DATA' : 'TERHUBUNG'}</span>
              </div>

              <button
                ref={commandTriggerRef}
                type="button"
                onClick={() => setCommandOpen(true)}
                aria-label="Cari pasien atau menu"
                className="px-3 py-1.5 text-xs font-medium rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-white dark:bg-[#0B211D] text-[#0F2922] dark:text-[#E6F4F1] hover:bg-[#EBF4F1] transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer"
              >
                <Search className="w-3.5 h-3.5 text-[#00897B]" />
                <span className="hidden md:inline">Cari pada daftar...</span>
                <kbd className="hidden lg:inline font-mono text-caption text-[#52736B] dark:text-[#86B5A9]">
                  Ctrl+K
                </kbd>
              </button>

              <button
                type="button"
                onClick={() => session && fetchActiveWorkspace(session)}
                aria-label="Muat ulang data"
                disabled={isLoadingWorkspace}
                className="px-3.5 py-1.5 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-white dark:bg-[#0B211D] hover:bg-[#EBF4F1] dark:hover:bg-[#11302A] text-xs font-medium text-[#0F2922] dark:text-white flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 text-[#00897B] ${
                    isLoadingWorkspace ? 'animate-spin' : ''
                  }`}
                />
                <span className="hidden md:inline">Muat ulang</span>
              </button>

              <button
                type="button"
                onClick={() => setDarkMode((prev) => !prev)}
                aria-label="Ubah Tema Terang atau Gelap"
                className="p-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-white dark:bg-[#0B211D] hover:bg-[#EBF4F1] dark:hover:bg-[#11302A] text-[#0F2922] dark:text-white cursor-pointer"
              >
                {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              </button>
            </div>
          </header>

          {/* Main Viewport */}
          <main ref={mainViewportRef} className="kael-content min-h-0 flex-1 p-3 sm:p-4 overflow-y-auto w-full mx-auto">
            {workspaceError && (
              <div
                role="alert"
                className="mb-5 p-4 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-900 text-xs text-red-800 dark:text-red-200 flex items-center justify-between"
              >
                <span>
                  {workspaceError}
                  {workspace && <span className="block mt-1">Data terakhir masih ditampilkan. Muat ulang untuk mendapatkan data terbaru.</span>}
                </span>
                <button
                  type="button"
                  onClick={() => session && fetchActiveWorkspace(session)}
                  disabled={isLoadingWorkspace}
                  className="underline font-semibold ml-4 disabled:opacity-60"
                >
                  Coba Lagi
                </button>
              </div>
            )}

            {!workspace ? (
              <div role="status" className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-8 space-y-3">
                <p className="text-sm font-semibold">{isLoadingWorkspace ? 'Memuat ruang kerja…' : 'Ruang kerja belum dapat dimuat'}</p>
                {isLoadingWorkspace ? (
                  <>
                    <div className="h-5 max-w-full w-64 bg-[#E2ECE8] dark:bg-[#163831] rounded animate-pulse" />
                    <div className="h-4 max-w-full w-96 bg-[#EDF4F1] dark:bg-[#112C26] rounded animate-pulse" />
                  </>
                ) : <p className="text-xs text-[#52736B] dark:text-[#86B5A9]">Periksa koneksi ke server, lalu pilih Coba Lagi atau Muat ulang.</p>}
              </div>
            ) : (
              <Suspense fallback={<p role="status">Memuat modul…</p>}>
                {!visibleModule && <p className="rounded-xl bg-white dark:bg-[#0B211D] p-6 text-sm">Belum ada modul yang diaktifkan untuk akun dan fasilitas ini. Hubungi superuser untuk mengatur akses.</p>}
                {visibleModule === 'DASHBOARD' && (
                  <DashboardModule
                    workspace={workspace}
                    onNavigateModule={navigateAndExpandCategory}
                    onOpenVisitInRme={handleOpenVisitInRme}
                  />
                )}

                {visibleModule === 'SEMUA_PASIEN' && (
                  <AllPatientsModule
                    token={session.token}
                    activeFacility={effectiveFacility}
                    activeFacilityConfig={activeConfig}
                    patients={workspace.patients}
                    visits={workspace.visits}
                    soapRecords={workspace.soapRecords}
                    doctors={workspace.doctors}
                    onRefreshWorkspace={() => fetchActiveWorkspace(session)}
                    onNavigateModule={handleNavigateModuleWithVisit}
                  />
                )}

                {(visibleModule === 'PENDAFTARAN' ||
                  visibleModule === 'JADWAL_DOKTER' ||
                  visibleModule === 'RAWAT_INAP') && (
                  <RegistrationAndBedsModule
                    key={visibleModule}
                    token={session.token}
                    activeFacility={effectiveFacility}
                    patients={workspace.patients}
                    visits={workspace.visits}
                    beds={workspace.beds}
                    doctors={workspace.doctors}
                    allowedSubTabs={([
                      ['QUEUE_REG', 'PENDAFTARAN'],
                      ['MPI', 'SEMUA_PASIEN'],
                      ['SCHEDULE', 'JADWAL_DOKTER'],
                      ['BEDS', 'RAWAT_INAP'],
                    ] as const).filter(([, module]) => canUserAccessModule(effectiveUser, module)).map(([tab]) => tab)}
                    initialSubTab={
                      visibleModule === 'RAWAT_INAP'
                        ? 'BEDS'
                        : visibleModule === 'JADWAL_DOKTER'
                        ? 'SCHEDULE'
                        : 'QUEUE_REG'
                    }
                    onRefreshWorkspace={() => fetchActiveWorkspace(session)}
                    onSelectVisitForRme={(visitId) => {
                      setSelectedRmeVisitId(visitId);
                      setActiveModule('RME_DOKTER');
                    }}
                  />
                )}

                {(visibleModule === 'RME_DOKTER' ||
                  visibleModule === 'IGD_TRIASE_EWS' ||
                  visibleModule === 'GIGI_ODONTOGRAM' ||
                  visibleModule === 'KIA_IMUNISASI' ||
                  visibleModule === 'PROLANIS_PRB' ||
                  visibleModule === 'BEDAH_IBS' ||
                  visibleModule === 'MCU_SURAT_MEDIS') && (
                  <DoctorRmeModule
                    key={visibleModule}
                    token={session.token}
                    facilityCode={effectiveFacility.code}
                    workspace={workspace}
                    selectedVisitId={selectedRmeVisitId}
                    initialSubView={visibleModule}
                    onSelectVisitId={setSelectedRmeVisitId}
                    onRefreshWorkspace={() => fetchActiveWorkspace(session)}
                  />
                )}

                {(visibleModule === 'APOTEK' ||
                  visibleModule === 'KATALOG_OPNAME' ||
                  visibleModule === 'MUTASI_STOK' ||
                  visibleModule === 'PENGADAAN_PBF' ||
                  visibleModule === 'LABORATORIUM' ||
                  visibleModule === 'RADIOLOGI_RIS' ||
                  visibleModule === 'PENUNJANG_RS') && (
                  <PharmacyAndLabModule
                    key={visibleModule}
                    token={session.token}
                    facilityCode={effectiveFacility.code}
                    workspace={workspace}
                    initialView={visibleModule}
                    onRefreshWorkspace={() => fetchActiveWorkspace(session)}
                  />
                )}

                {(visibleModule === 'KASIR_AKUNTANSI' ||
                  visibleModule === 'BRIDGING_SATUSEHAT' ||
                  visibleModule === 'LAPORAN_REGULASI') && (
                  <CashierAndBridgingModule
                    key={visibleModule}
                    token={session.token}
                    facilityCode={effectiveFacility.code}
                    workspace={workspace}
                    initialView={visibleModule}
                    onRefreshWorkspace={() => fetchActiveWorkspace(session)}
                  />
                )}

                {(visibleModule === 'KEUANGAN_OWNER' ||
                  visibleModule === 'NERACA_GL' ||
                  visibleModule === 'KLAIM_BPJS_PIUTANG' ||
                  visibleModule === 'JASA_MEDIS_REMUN') && (
                  <OwnerFinanceModule
                    key={visibleModule}
                    token={session.token}
                    facilityCode={effectiveFacility.code}
                    workspace={workspace}
                    initialView={visibleModule}
                    onRefreshWorkspace={() => fetchActiveWorkspace(session)}
                  />
                )}

                {(visibleModule === 'SDM_JADWAL' || visibleModule === 'SDM_ERP') && (
                  <SdmErpModule
                    key={visibleModule}
                    activeFacility={effectiveFacility}
                    currentUser={effectiveUser}
                    allUsers={workspace.allUsers || workspace.doctors}
                    initialView={visibleModule}
                  />
                )}

                {visibleModule === 'SUPERUSER_CONTROL' && (
                  <SuperuserControlModule
                    token={session.token}
                    facilityCode={effectiveFacility.code}
                    workspace={workspace}
                    onRefreshWorkspace={() => fetchActiveWorkspace(session)}
                  />
                )}
              </Suspense>
            )}
          </main>
        </div>
      </div>

      {/* Bottom Desktop Status Bar matching Reference */}
      <footer inert={mobileNavOpen || undefined} className="shrink-0 px-3 sm:px-4 py-1 bg-white dark:bg-[#051411] border-t border-[#E2ECE8] dark:border-[#14332C] flex items-center justify-between gap-3 text-xs text-[#52736B] dark:text-[#86B5A9] no-print">
        <div className="flex items-center gap-2 truncate">
          <span>{workspaceError ? 'Koneksi server terganggu' : isLoadingWorkspace ? 'Memuat data server' : 'Server terhubung'}</span>
          <span className="border-l border-[#D5E3DF] dark:border-[#1E473F] pl-2">Pengguna: {effectiveUser.username}</span>
        </div>
        <div className="hidden sm:flex items-center gap-2 font-mono text-caption">
          <span>Faskes: {effectiveFacility.code}</span>
          <span>
            Sesi berlaku s/d:{' '}
            {session.expiresAt
              ? new Date(session.expiresAt).toLocaleString('id-ID', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : 'Aktif'}
          </span>
        </div>
      </footer>

      {/* Ctrl+K Quick Command & Patient Lookup Modal */}
      {commandOpen && workspace && (
        <dialog
          ref={commandDialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Pencarian Cepat Pasien dan Modul"
          onCancel={() => setCommandOpen(false)}
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (event.target === event.currentTarget && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) setCommandOpen(false);
          }}
          className="kael-command-dialog fixed inset-0 m-auto overflow-visible border-0 p-0 bg-transparent text-inherit backdrop:bg-black/60 backdrop:backdrop-blur-xs"
        >
          <div className="kael-command-panel min-h-0 flex flex-col bg-white dark:bg-[#0B211D] border border-[#D5E3DF] dark:border-[#1E473F] rounded-2xl w-full p-4 shadow-2xl gap-3">
            <div className="flex items-center justify-between gap-2 border-b border-[#E2ECE8] dark:border-[#183831] pb-2.5">
              <div className="flex items-center gap-2 flex-1">
                <Search className="w-4 h-4 text-[#00897B]" />
                <input
                  type="search"
                  autoFocus
                  value={commandQuery}
                  onChange={(e) => setCommandQuery(e.target.value)}
                  aria-label="Cari pasien atau menu"
                  placeholder="Cari pasien atau menu..."
                  className="min-w-0 w-full text-sm bg-transparent focus:outline-hidden text-[#0F2922] dark:text-white"
                />
              </div>
              <button
                type="button"
                onClick={() => setCommandOpen(false)}
                className="px-2 py-1 text-caption font-mono rounded border border-[#D5E3DF] dark:border-[#1E473F]"
              >
                ESC
              </button>
            </div>

            <div className="min-h-0 overflow-y-auto space-y-3 text-sm">
              <div>
                <div className="text-caption font-semibold text-[#52736B] mb-1">
                  Navigasi Cepat Menu
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {allowedNavItems
                    .filter(
                      (item) =>
                        !commandQuery ||
                        item.label.toLowerCase().includes(commandQuery.toLowerCase()) ||
                        item.subtitle.toLowerCase().includes(commandQuery.toLowerCase())
                    )
                    .map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          setActiveModule(item.key);
                          setCommandOpen(false);
                        }}
                        className="text-left px-3 py-2 rounded-xl border border-[#E2ECE8] dark:border-[#183831] hover:bg-[#EBF4F1] dark:hover:bg-[#12352E] flex items-center justify-between cursor-pointer"
                      >
                        <span className="min-w-0 font-medium">{item.label}</span>
                        <span className="shrink-0 font-mono text-xs text-[#00897B] ml-2">
                          {item.shortKey}
                        </span>
                      </button>
                    ))}
                </div>
              </div>

              <div>
                <div className="text-caption font-semibold text-[#52736B] mb-1">
                  Pasien Antrean Aktif • {effectiveFacility.code}
                </div>
                <div className="space-y-1">
                  {workspace.visits
                    .filter(
                      (v) =>
                        !commandQuery ||
                        v.patientName.toLowerCase().includes(commandQuery.toLowerCase()) ||
                        v.mrNumber.toLowerCase().includes(commandQuery.toLowerCase()) ||
                        v.nik.includes(commandQuery)
                    )
                    .map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => {
                          handleOpenVisitInRme(v);
                          setCommandOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 rounded-xl hover:bg-[#EBF4F1] dark:hover:bg-[#12352E] flex items-center justify-between cursor-pointer"
                      >
                        <span>
                          <strong>{v.patientName}</strong> · {v.mrNumber}
                        </span>
                        <span className="font-mono text-caption text-[#00897B] font-semibold">
                          Buka RME · {v.queueNumber}
                        </span>
                      </button>
                    ))}
                </div>
              </div>

              {accessibleFacilities.length > 1 && (
                <div>
                  <div className="text-caption font-semibold text-[#52736B] mb-1">
                    Beralih Fasilitas Kesehatan
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {accessibleFacilities.map((f) => (
                      <button
                        key={f.code}
                        type="button"
                        onClick={() => {
                          handleSwitchFacility(f.code);
                          setCommandOpen(false);
                        }}
                        className="px-2.5 py-1 text-xs font-mono rounded-lg border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1] dark:hover:bg-[#12352E] cursor-pointer"
                      >
                        {f.code}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </dialog>
      )}
    </div>
  );
}
