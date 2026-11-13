import React, { useCallback, useEffect, useState } from 'react';
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
} from 'lucide-react';
import { AllPatientsModule } from './components/AllPatientsModule';
import { CashierAndBridgingModule } from './components/CashierAndBridgingModule';
import { DashboardModule } from './components/DashboardModule';
import { DoctorRmeModule } from './components/DoctorRmeModule';
import { LoginView } from './components/LoginView';
import { OwnerFinanceModule } from './components/OwnerFinanceModule';
import { PharmacyAndLabModule } from './components/PharmacyAndLabModule';
import { RegistrationAndBedsModule } from './components/RegistrationAndBedsModule';
import { SdmErpModule } from './components/SdmErpModule';
import { SuperuserControlModule } from './components/SuperuserControlModule';
import { ModuleKey, VisitQueueItem } from './types/simrs';
import {
  kaelApi,
  loadStoredSession,
  saveStoredSession,
  StoredSession,
  WorkspacePayload,
} from './utils/apiClient';
import { canUserAccessModule, ROLE_LABELS } from './utils/clinicalLogic';

import {
  buildDefaultFacilityConfigSnapshot,
  NAV_GROUP_TITLES,
  NavGroupKey,
  resolveFacilityNavigation,
} from './utils/platformEngine';

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
  PELAPORAN_OTORITAS: { shortLabel: 'Pelaporan', icon: ShieldCheck },
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
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [miniFlyoutCategory, setMiniFlyoutCategory] = useState<NavGroupKey | null>(null);
  // Default all 7 separated category sections to collapsed on initial load
  const [expandedGroups, setExpandedGroups] = useState<Record<NavGroupKey, boolean>>({
    PENDAFTARAN_ADMISI: false,
    PELAYANAN_MEDIS: false,
    FARMASI_LOGISTIK: false,
    PENUNJANG_INSTALASI: false,
    KEUANGAN_AKUNTANSI: false,
    SDM_KEPEGAWAIAN: false,
    PELAPORAN_OTORITAS: false,
  });

  const navigateAndExpandCategory = useCallback((targetModule: ModuleKey) => {
    setActiveModule(targetModule);
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
      BRIDGING_SATUSEHAT: 'PELAPORAN_OTORITAS',
      SUPERUSER_CONTROL: 'PELAPORAN_OTORITAS',
    };
    const cat = groupByModule[targetModule];
    if (cat) {
      setExpandedGroups((prev) => (prev[cat] ? prev : { ...prev, [cat]: true }));
    }
  }, []);

  // Sync dark mode class on <html>
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('kael_theme_dark', String(darkMode));
  }, [darkMode]);

  const fetchActiveWorkspace = useCallback(async (activeSession: StoredSession) => {
    setIsLoadingWorkspace(true);
    setWorkspaceError(null);
    try {
      const data = await kaelApi.fetchWorkspace(
        activeSession.token,
        activeSession.activeFacility.code
      );
      setWorkspace(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat data server.';
      setWorkspaceError(msg);
      if (msg.includes('Sesi tidak valid') || msg.includes('berakhir') || msg.includes('401')) {
        saveStoredSession(null);
        setSession(null);
        setWorkspace(null);
      }
    } finally {
      setIsLoadingWorkspace(false);
    }
  }, []);

  // Support ?autostart=1 query param for instant workstation entry
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1' && !session) {
      kaelApi
        .login({
          username: 'superuser',
          password: 'kael2026',
          facilityCode: 'KLINIK_JAMYLA',
          rememberMe: true,
        })
        .then((newSession) => {
          saveStoredSession(newSession);
          setSession(newSession);
        })
        .catch(() => {
          // Ignore autostart error if manual login needed
        });
    }
  }, [session]);

  useEffect(() => {
    if (session) {
      fetchActiveWorkspace(session);
    }
  }, [session, fetchActiveWorkspace]);

  // Linux Desktop Keyboard Shortcuts (Ctrl+K Command Palette, Ctrl+B Toggle Sidebar & Alt+1..0 Module Switch)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((prev) => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setIsSidebarCollapsed((prev) => !prev);
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
  }, [session, workspace, navigateAndExpandCategory]);

  const handleLoginSuccess = (newSession: StoredSession) => {
    saveStoredSession(newSession);
    setSession(newSession);
    setActiveModule('DASHBOARD');
  };

  const handleLogout = () => {
    saveStoredSession(null);
    setSession(null);
    setWorkspace(null);
  };

  const handleSwitchFacility = async (newFacilityCode: string) => {
    if (!session || newFacilityCode === session.activeFacility.code) return;
    setIsLoadingWorkspace(true);
    try {
      const switched = await kaelApi.switchFacility(session.token, newFacilityCode);
      const updatedSession: StoredSession = {
        ...session,
        activeFacility: switched.activeFacility,
        accessibleFacilities: switched.accessibleFacilities,
      };
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
  const effectiveFacility = workspace?.activeFacility || session.activeFacility;
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

  const activeNavMeta =
    allowedNavItems.find((n) => n.key === activeModule) ||
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
  ];

  const topItem = allowedNavItems.find((i) => i.key === 'DASHBOARD');
  const isRememberedSession = Boolean(session.rememberMe);

  return (
    <div className="min-h-screen w-full bg-[#F3F8F6] dark:bg-[#061714] text-[#0F2922] dark:text-[#ECF7F4] flex flex-col">
      <div className="flex-1 flex min-h-0">
        {/* Left Workspace Sidebar: Full Mode (w-64) or Minimalist Category-Rail Mode (w-[90px]) */}
        <aside
          data-testid="kael-left-sidebar"
          data-sidebar-mode={isSidebarCollapsed ? 'minimal-icons' : 'expanded'}
          className={`relative z-30 ${
            isSidebarCollapsed ? 'w-[90px]' : 'w-64'
          } shrink-0 bg-[#0C3B33] dark:bg-[#072620] text-[#E6F4F1] border-r border-[#164E44] flex flex-col justify-between no-print select-none transition-all duration-150`}
        >
          {isSidebarCollapsed ? (
            /* MINIMALIST CATEGORY RAIL MODE: Shows Categories (not subcategories) with icon + small readable label below */
            <>
              <div className="flex-1 flex flex-col items-center min-h-0 py-3">
                {/* Compact Brand + Expand Button */}
                <div className="flex flex-col items-center gap-2 pb-3 border-b border-[#164E44] w-full px-2">
                  {!logoError ? (
                    <img
                      src="/assets/aistudio/kael-logo_d4a66617.png"
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
                      <span className="text-[10px] leading-tight text-center truncate w-full">
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
                        <span className="text-[10px] leading-tight text-center truncate w-full">
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
                  className="absolute left-[96px] top-16 w-60 rounded-2xl bg-[#0C3B33] dark:bg-[#072620] border border-[#1E5B4F] shadow-xl p-2.5 space-y-1 z-50"
                >
                  <div className="px-2.5 py-1.5 flex items-center justify-between border-b border-[#164E44]">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#9BC4BC]">
                      {NAV_GROUP_TITLES[miniFlyoutCategory]}
                    </span>
                    <button
                      type="button"
                      onClick={() => setMiniFlyoutCategory(null)}
                      className="text-[10px] text-[#9BC4BC] hover:text-white cursor-pointer"
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
                  title={`${effectiveUser.fullName} • ${effectiveFacility.code}`}
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
                  <span className="text-[9px] font-semibold leading-none">Keluar</span>
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
                          src="/assets/aistudio/kael-logo_d4a66617.png"
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
                      className="p-1.5 rounded-lg text-[#9BC4BC] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      <PanelLeftClose className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="mt-2.5 text-[10px] font-semibold tracking-[0.14em] text-[#9BC4BC] uppercase">
                    HEALTHCARE &amp; ERP
                  </div>
                </div>

                {/* Facility Switcher for Multi-Clinic / Hospital Accounts */}
                {accessibleFacilities.length > 1 && (
                  <div className="px-4 pb-3">
                    <label
                      htmlFor="sidebar-facility-switcher"
                      className="block text-[10px] font-semibold uppercase tracking-wider text-[#9BC4BC] mb-1 flex items-center gap-1.5"
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
                  className="flex-1 px-3 py-2 space-y-3 overflow-y-auto kael-sidebar-scroll"
                >
                  {/* Top-Level Workspace Summary */}
                  {topItem && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setActiveModule('DASHBOARD')}
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
                        <span className="text-[13px] truncate">{topItem.label}</span>
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
                          className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9BC4BC] hover:text-white transition-colors cursor-pointer"
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
                                  onClick={() => setActiveModule(item.key)}
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
                                    <div className="text-[13px] truncate leading-snug">
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
                    {effectiveUser.fullName}
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-[#9BC4BC]">
                    <span className="truncate" title={ROLE_LABELS[effectiveUser.role]}>
                      {effectiveUser.role}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-[#124B41] text-[#A7E8DC] text-[10px]">
                      {isRememberedSession ? 'Sesi 7 Hari ✓' : 'Sesi 1 Hari'}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-[#7FB3A8] truncate">
                    {effectiveFacility.code}
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
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top Bar */}
          <header className="h-14 bg-[#F3F8F6] dark:bg-[#061714] border-b border-[#E2ECE8] dark:border-[#14332C] px-6 flex items-center justify-between gap-4 no-print">
            <div className="flex items-center gap-2.5 text-xs text-[#52736B] dark:text-[#86B5A9] truncate">
              <span className="font-mono font-semibold uppercase tracking-wider text-[#3B6259] dark:text-[#9BC4BC]">
                {effectiveFacility.code}
              </span>
              <span aria-hidden="true">•</span>
              <span className="font-medium text-[#0F2922] dark:text-white truncate">
                {activeNavMeta.label}
              </span>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              {/* Connected Status Pill matching Reference */}
              <div className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#E1F3EC] dark:bg-[#0F3830] text-[#00796B] dark:text-[#4DB6AC] text-[11px] font-semibold tracking-wide">
                <span className="w-2 h-2 rounded-full bg-[#00897B]" />
                <span>TERHUBUNG • AKTIF</span>
              </div>

              <button
                type="button"
                onClick={() => setCommandOpen(true)}
                className="px-3 py-1.5 text-xs font-medium rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-white dark:bg-[#0B211D] text-[#0F2922] dark:text-[#E6F4F1] hover:bg-[#EBF4F1] transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer"
              >
                <Search className="w-3.5 h-3.5 text-[#00897B]" />
                <span className="hidden md:inline">Cari pada daftar...</span>
                <kbd className="font-mono text-[10px] text-[#52736B] dark:text-[#86B5A9]">
                  Ctrl+K
                </kbd>
              </button>

              <button
                type="button"
                onClick={() => session && fetchActiveWorkspace(session)}
                disabled={isLoadingWorkspace}
                className="px-3.5 py-1.5 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-white dark:bg-[#0B211D] hover:bg-[#EBF4F1] dark:hover:bg-[#11302A] text-xs font-medium text-[#0F2922] dark:text-white flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 text-[#00897B] ${
                    isLoadingWorkspace ? 'animate-spin' : ''
                  }`}
                />
                <span>Muat ulang</span>
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
          <main className="flex-1 p-6 overflow-y-auto max-w-[1440px] w-full mx-auto">
            {workspaceError && (
              <div
                role="alert"
                className="mb-5 p-4 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-900 text-xs text-red-800 dark:text-red-200 flex items-center justify-between"
              >
                <span>Kesalahan komunikasi server: {workspaceError}</span>
                <button
                  type="button"
                  onClick={() => session && fetchActiveWorkspace(session)}
                  className="underline font-semibold ml-4"
                >
                  Coba Lagi
                </button>
              </div>
            )}

            {!workspace ? (
              <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-8 space-y-3">
                <div className="h-5 w-64 bg-[#E2ECE8] dark:bg-[#163831] rounded animate-pulse" />
                <div className="h-4 w-96 bg-[#EDF4F1] dark:bg-[#112C26] rounded animate-pulse" />
              </div>
            ) : (
              <>
                {activeModule === 'DASHBOARD' && (
                  <DashboardModule
                    workspace={workspace}
                    onNavigateModule={navigateAndExpandCategory}
                    onOpenVisitInRme={handleOpenVisitInRme}
                  />
                )}

                {activeModule === 'SEMUA_PASIEN' && (
                  <AllPatientsModule
                    token={session.token}
                    activeFacility={effectiveFacility}
                    patients={workspace.patients}
                    visits={workspace.visits}
                    soapRecords={workspace.soapRecords}
                    doctors={workspace.doctors}
                    onRefreshWorkspace={() => fetchActiveWorkspace(session)}
                    onNavigateModule={handleNavigateModuleWithVisit}
                  />
                )}

                {(activeModule === 'PENDAFTARAN' ||
                  activeModule === 'JADWAL_DOKTER' ||
                  activeModule === 'RAWAT_INAP') && (
                  <RegistrationAndBedsModule
                    key={activeModule}
                    token={session.token}
                    activeFacility={effectiveFacility}
                    patients={workspace.patients}
                    visits={workspace.visits}
                    beds={workspace.beds}
                    doctors={workspace.doctors}
                    initialSubTab={
                      activeModule === 'RAWAT_INAP'
                        ? 'BEDS'
                        : activeModule === 'JADWAL_DOKTER'
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

                {(activeModule === 'RME_DOKTER' ||
                  activeModule === 'IGD_TRIASE_EWS' ||
                  activeModule === 'GIGI_ODONTOGRAM' ||
                  activeModule === 'KIA_IMUNISASI' ||
                  activeModule === 'PROLANIS_PRB' ||
                  activeModule === 'BEDAH_IBS' ||
                  activeModule === 'MCU_SURAT_MEDIS') && (
                  <DoctorRmeModule
                    key={activeModule}
                    token={session.token}
                    facilityCode={effectiveFacility.code}
                    workspace={workspace}
                    selectedVisitId={selectedRmeVisitId}
                    initialSubView={activeModule}
                    onSelectVisitId={setSelectedRmeVisitId}
                    onRefreshWorkspace={() => fetchActiveWorkspace(session)}
                  />
                )}

                {(activeModule === 'APOTEK' ||
                  activeModule === 'KATALOG_OPNAME' ||
                  activeModule === 'MUTASI_STOK' ||
                  activeModule === 'PENGADAAN_PBF' ||
                  activeModule === 'LABORATORIUM' ||
                  activeModule === 'RADIOLOGI_RIS' ||
                  activeModule === 'PENUNJANG_RS') && (
                  <PharmacyAndLabModule
                    key={activeModule}
                    token={session.token}
                    facilityCode={effectiveFacility.code}
                    workspace={workspace}
                    initialView={activeModule}
                    onRefreshWorkspace={() => fetchActiveWorkspace(session)}
                  />
                )}

                {(activeModule === 'KASIR_AKUNTANSI' ||
                  activeModule === 'BRIDGING_SATUSEHAT' ||
                  activeModule === 'LAPORAN_REGULASI') && (
                  <CashierAndBridgingModule
                    key={activeModule}
                    token={session.token}
                    facilityCode={effectiveFacility.code}
                    workspace={workspace}
                    initialView={activeModule}
                    onRefreshWorkspace={() => fetchActiveWorkspace(session)}
                  />
                )}

                {(activeModule === 'KEUANGAN_OWNER' ||
                  activeModule === 'NERACA_GL' ||
                  activeModule === 'KLAIM_BPJS_PIUTANG' ||
                  activeModule === 'JASA_MEDIS_REMUN') && (
                  <OwnerFinanceModule
                    key={activeModule}
                    token={session.token}
                    facilityCode={effectiveFacility.code}
                    workspace={workspace}
                    initialView={activeModule}
                    onRefreshWorkspace={() => fetchActiveWorkspace(session)}
                  />
                )}

                {(activeModule === 'SDM_JADWAL' || activeModule === 'SDM_ERP') && (
                  <SdmErpModule
                    key={activeModule}
                    token={session.token}
                    activeFacility={effectiveFacility}
                    currentUser={effectiveUser}
                    allUsers={workspace.allUsers || workspace.doctors}
                    initialView={activeModule}
                    onRefreshWorkspace={() => fetchActiveWorkspace(session)}
                  />
                )}

                {activeModule === 'SUPERUSER_CONTROL' && (
                  <SuperuserControlModule
                    token={session.token}
                    facilityCode={effectiveFacility.code}
                    workspace={workspace}
                    onRefreshWorkspace={() => fetchActiveWorkspace(session)}
                  />
                )}
              </>
            )}
          </main>
        </div>
      </div>

      {/* Bottom Desktop Status Bar matching Reference */}
      <footer className="h-7 px-4 bg-white dark:bg-[#051411] border-t border-[#E2ECE8] dark:border-[#14332C] flex items-center justify-between text-[11px] text-[#52736B] dark:text-[#86B5A9] no-print">
        <div className="flex items-center gap-2 truncate">
          <span>Layanan lokal tersambung</span>
          <span aria-hidden="true">•</span>
          <span>Otorisasi: {ROLE_LABELS[effectiveUser.role]}</span>
          <span aria-hidden="true">•</span>
          <span>KAEL 2.4.0</span>
        </div>
        <div className="hidden sm:flex items-center gap-2 font-mono text-[10px]">
          <span>Faskes: {effectiveFacility.code}</span>
          <span aria-hidden="true">•</span>
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
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Pencarian Cepat Pasien dan Modul"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-start justify-center pt-20 px-4"
        >
          <div className="bg-white dark:bg-[#0B211D] border border-[#D5E3DF] dark:border-[#1E473F] rounded-2xl max-w-xl w-full p-4 shadow-2xl space-y-3">
            <div className="flex items-center justify-between gap-2 border-b border-[#E2ECE8] dark:border-[#183831] pb-2.5">
              <div className="flex items-center gap-2 flex-1">
                <Search className="w-4 h-4 text-[#00897B]" />
                <input
                  type="search"
                  autoFocus
                  value={commandQuery}
                  onChange={(e) => setCommandQuery(e.target.value)}
                  placeholder="Ketik nama pasien, No. RM, NIK, kode fasilitas, atau nama modul..."
                  className="w-full text-xs bg-transparent focus:outline-hidden text-[#0F2922] dark:text-white"
                />
              </div>
              <button
                type="button"
                onClick={() => setCommandOpen(false)}
                className="px-2 py-1 text-[11px] font-mono rounded border border-[#D5E3DF] dark:border-[#1E473F]"
              >
                ESC
              </button>
            </div>

            <div className="max-h-72 overflow-y-auto space-y-3 text-xs">
              <div>
                <div className="text-[11px] font-semibold text-[#52736B] mb-1">
                  Navigasi Cepat Menu
                </div>
                <div className="grid grid-cols-2 gap-1.5">
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
                        <span className="font-medium truncate">{item.label}</span>
                        <span className="font-mono text-[10px] text-[#00897B] ml-2">
                          {item.shortKey}
                        </span>
                      </button>
                    ))}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-semibold text-[#52736B] mb-1">
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
                        <span className="font-mono text-[11px] text-[#00897B] font-semibold">
                          Buka RME · {v.queueNumber}
                        </span>
                      </button>
                    ))}
                </div>
              </div>

              {accessibleFacilities.length > 1 && (
                <div>
                  <div className="text-[11px] font-semibold text-[#52736B] mb-1">
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
        </div>
      )}
    </div>
  );
}
