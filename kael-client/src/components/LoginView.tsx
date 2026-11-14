import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Building2,
  ChevronDown,
  X,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  RefreshCw,
  Server,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import {
  kaelApi,
  getServerOrigin,
  getDefaultServerOrigin,
  resetApiBaseUrl,
  setApiBaseUrl,
  StoredSession,
} from '../utils/apiClient';
import { normalizeFacilityCode } from '../domain/clinicalLogic.ts';
import '../styles/login.css';
import { normalizeServerOrigin, ServerConnection } from '../utils/serverConnection';
import {
  FacilityProfile,
  loadFacilityProfiles,
  saveFacilityProfile,
  deleteFacilityProfile,
} from '../utils/facilityProfiles';

interface LoginViewProps {
  onLoginSuccess: (session: StoredSession) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
  const [facilityCode, setFacilityCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [serverUrl, setServerUrl] = useState(() => getServerOrigin());
  const [activeOverlay, setActiveOverlay] = useState<'server' | 'profiles' | null>(null);
  const [splitLayout, setSplitLayout] = useState(false);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const splitMeasureRef = useRef<HTMLSpanElement | null>(null);
  const overlayRef = useRef<HTMLDialogElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const brandRef = useRef<HTMLElement | null>(null);
  const serverTriggerRef = useRef<HTMLButtonElement | null>(null);
  const profilesTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [serverConfigError, setServerConfigError] = useState<string | null>(null);
  const connectionRequest = useRef<AbortController | null>(null);
  const [serverInfo, setServerInfo] = useState<ServerConnection | null>(null);
  const [pingError, setPingError] = useState<string | null>(null);
  const [isConnectingServer, setIsConnectingServer] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);
  const [profiles, setProfiles] = useState(loadFacilityProfiles);
  const [editingProfileId, setEditingProfileId] = useState<string | undefined>();
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [profileDraft, setProfileDraft] = useState({ origin: getServerOrigin(), facilityCode: '', label: '' });
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const [pendingConnection, setPendingConnection] = useState<{ origin: string; facilityCode?: string; reset?: boolean } | null>(null);

  useLayoutEffect(() => {
    const layout = layoutRef.current;
    const measurement = splitMeasureRef.current;
    if (!layout || !measurement) return;
    const updateLayout = () => {
      const paneWidth = measurement.getBoundingClientRect().width;
      setSplitLayout(paneWidth > 0 && layout.clientWidth >= paneWidth * 2);
    };
    const observer = new ResizeObserver(updateLayout);
    observer.observe(layout);
    observer.observe(measurement);
    updateLayout();
    return () => observer.disconnect();
  }, []);

  const closeOverlay = () => {
    setActiveOverlay(null);
    setPendingConnection(null);
    setServerUrl(getServerOrigin());
    setServerConfigError(null);
  };

  const positionOverlay = useCallback(() => {
    const dialog = overlayRef.current;
    const main = mainRef.current;
    if (!dialog?.open || !main || !activeOverlay) return;
    const viewport = window.visualViewport;
    const width = viewport?.width || window.innerWidth;
    const height = viewport?.height || window.innerHeight;
    const offsetLeft = viewport?.offsetLeft || 0;
    const offsetTop = viewport?.offsetTop || 0;
    const mainStyle = getComputedStyle(main);
    const gutter = Number.parseFloat(mainStyle.paddingBlockStart) || 0;
    const trigger = activeOverlay === 'server' ? serverTriggerRef.current : profilesTriggerRef.current;
    const anchorElement = trigger?.closest<HTMLElement>('[data-connection-anchor]');
    const anchor = anchorElement?.getBoundingClientRect();
    const gap = anchorElement ? Number.parseFloat(getComputedStyle(anchorElement).scrollMarginBlockEnd) || 0 : 0;
    const availableWidth = Math.max(0, width - gutter * 2);
    const availableHeight = Math.max(0, height - gutter * 2);
    const start = offsetLeft + gutter;
    const top = offsetTop + gutter;
    const end = offsetLeft + width - gutter;
    const bottom = offsetTop + height - gutter;

    // Resolve the preferred size through CSS before fitting it to the measured viewport.
    dialog.style.width = '';
    dialog.style.maxHeight = '';
    dialog.style.inlineSize = '';
    dialog.style.maxInlineSize = `${availableWidth}px`;
    dialog.style.maxBlockSize = `${availableHeight}px`;
    dialog.style.right = 'auto';
    dialog.style.bottom = 'auto';
    dialog.style.transform = 'none';
    const preferredWidth = dialog.getBoundingClientRect().width;
    const hasBrandPane = !!brandRef.current?.getClientRects().length;
    const panelWidth = Math.min(preferredWidth, hasBrandPane && anchor ? anchor.width : availableWidth, availableWidth);
    dialog.style.inlineSize = `${panelWidth}px`;
    const panelHeight = dialog.getBoundingClientRect().height;
    const mainBounds = main.getBoundingClientRect();
    const paneEnd = mainBounds.right - (Number.parseFloat(mainStyle.paddingInlineEnd) || 0);
    const fitsInline = !!anchor && anchor.left >= start && anchor.left + panelWidth <= Math.min(end, paneEnd);
    const below = anchor ? anchor.bottom + gap : bottom;
    const above = anchor ? anchor.top - gap - panelHeight : top - panelHeight;
    const fitsBelow = below >= top && below + panelHeight <= bottom;
    const fitsAbove = above >= top && above + panelHeight <= bottom;
    const useAnchor = hasBrandPane && anchor && fitsInline;

    dialog.style.left = `${useAnchor ? anchor.left : start + (availableWidth - panelWidth) / 2}px`;
    dialog.style.top = `${useAnchor && fitsBelow ? below : useAnchor && fitsAbove ? above : top + (availableHeight - panelHeight) / 2}px`;
  }, [activeOverlay]);

  useLayoutEffect(() => {
    if (!activeOverlay) return;
    const dialog = overlayRef.current;
    if (!dialog) return;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    positionOverlay();
    const frame = requestAnimationFrame(() => {
      dialog.querySelector<HTMLElement>('[data-overlay-initial-focus]')?.focus({ preventScroll: true });
      positionOverlay();
    });
    const resizeObserver = new ResizeObserver(positionOverlay);
    resizeObserver.observe(dialog);
    if (mainRef.current) resizeObserver.observe(mainRef.current);
    const trigger = activeOverlay === 'server' ? serverTriggerRef.current : profilesTriggerRef.current;
    const anchor = trigger?.closest('[data-connection-anchor]');
    if (anchor) resizeObserver.observe(anchor);
    window.addEventListener('resize', positionOverlay);
    window.visualViewport?.addEventListener('resize', positionOverlay);
    window.visualViewport?.addEventListener('scroll', positionOverlay);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener('resize', positionOverlay);
      window.visualViewport?.removeEventListener('resize', positionOverlay);
      window.visualViewport?.removeEventListener('scroll', positionOverlay);
      if (dialog.open) dialog.close();
      returnFocus?.focus({ preventScroll: true });
    };
  }, [activeOverlay, positionOverlay]);

  useLayoutEffect(() => {
    if (!activeOverlay) return;
    positionOverlay();
    const frame = requestAnimationFrame(() => {
      overlayRef.current?.querySelector<HTMLElement>('[data-overlay-initial-focus]')?.focus({ preventScroll: true });
      positionOverlay();
    });
    return () => cancelAnimationFrame(frame);
  }, [showProfileEditor, !!pendingConnection]);

  useLayoutEffect(() => {
    positionOverlay();
  }, [profiles.length, profileError, profileNotice, serverConfigError, positionOverlay]);

  let hasPendingEndpoint = true;
  try { hasPendingEndpoint = normalizeServerOrigin(serverUrl) !== getServerOrigin(); } catch { /* The address is validated when connected. */ }

  const probeServer = useCallback(async () => {
    connectionRequest.current?.abort();
    const request = new AbortController();
    connectionRequest.current = request;
    setIsConnectingServer(true);
    setServerInfo(null);
    setPingError(null);
    try {
      const data = await kaelApi.fetchHealth(request.signal);
      if (!request.signal.aborted) setServerInfo(data);
    } catch (error) {
      if (request.signal.aborted) return;
      setPingError(error instanceof Error ? error.message : 'Server KAEL belum dapat dihubungi.');
    } finally {
      if (!request.signal.aborted) setIsConnectingServer(false);
    }
  }, []);

  useEffect(() => {
    void probeServer();
    return () => connectionRequest.current?.abort();
  }, [probeServer]);

  const applyConnection = async (next: { origin: string; facilityCode?: string; reset?: boolean }) => {
    try {
      const previousOrigin = getServerOrigin();
      if (next.reset) resetApiBaseUrl();
      else setApiBaseUrl(next.origin);
      setServerUrl(getServerOrigin());
      if (previousOrigin !== getServerOrigin() || (next.facilityCode !== undefined && next.facilityCode !== facilityCode)) setPassword('');
      if (next.facilityCode !== undefined) setFacilityCode(next.facilityCode);
      else if (previousOrigin !== getServerOrigin()) setFacilityCode('');
      setPendingConnection(null);
      setServerConfigError(null);
      setLoginError(null);
      setActiveOverlay(null);
      await probeServer();
    } catch (error) {
      setActiveOverlay('server');
      setServerConfigError(error instanceof Error ? error.message : 'Alamat server tidak dapat disimpan pada browser ini.');
    }
  };

  const requestConnection = (origin: string, selectedFacility?: string, reset = false) => {
    try {
      const normalized = normalizeServerOrigin(origin);
      const next = { origin: normalized, facilityCode: selectedFacility, reset };
      const changesTarget = normalized !== getServerOrigin()
        || (selectedFacility !== undefined && selectedFacility !== facilityCode);
      if (password && changesTarget) setPendingConnection(next);
      else void applyConnection(next);
    } catch (error) {
      setActiveOverlay('server');
      setServerConfigError(error instanceof Error ? error.message : 'Alamat server tidak valid.');
    }
  };

  const handleSaveServerEndpoint = (event: React.FormEvent) => {
    event.preventDefault();
    requestConnection(serverUrl);
  };

  const beginProfile = (profile?: FacilityProfile) => {
    setEditingProfileId(profile?.id);
    setProfileDraft(profile
      ? { origin: profile.origin, facilityCode: profile.facilityCode, label: profile.label }
      : { origin: serverUrl, facilityCode, label: '' });
    setProfileError(null);
    setProfileNotice(null);
    setShowProfileEditor(true);
  };

  const handleSaveProfile = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      setProfiles(saveFacilityProfile(profiles, profileDraft, editingProfileId));
      setShowProfileEditor(false);
      setEditingProfileId(undefined);
      setProfileError(null);
      setProfileNotice('Profil disimpan pada browser ini.');
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Profil belum dapat disimpan.');
    }
  };

  const handleDeleteProfile = (id: string) => {
    try {
      setProfiles(deleteFacilityProfile(profiles, id));
      if (editingProfileId === id) setShowProfileEditor(false);
      setProfileError(null);
      setProfileNotice('Profil dihapus dari browser ini.');
    } catch {
      setProfileError('Profil belum dapat dihapus. Periksa izin penyimpanan browser.');
    }
  };

  const handleLoginSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting || isConnectingServer || !serverInfo || hasPendingEndpoint || pendingConnection) return;
    setLoginError(null);
    if (!username.trim() || !password) {
      setLoginError('Isi username, NIP, atau nomor SIP dan kata sandi.');
      return;
    }
    setIsSubmitting(true);
    try {
      const session = await kaelApi.login({
        username: username.trim(), password,
        facilityCode: normalizeFacilityCode(facilityCode) || undefined,
        rememberMe,
      });
      onLoginSuccess({ ...session, rememberMe });
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Otentikasi gagal. Periksa kredensial dan kode fasilitas.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div ref={layoutRef} data-split={splitLayout} className="kael-login-layout bg-[#F3F8F6] dark:bg-[#061714] text-[#0F2922] dark:text-[#ECF5F2] select-none">
      <span ref={splitMeasureRef} className="kael-login-split-measure" aria-hidden="true" />
      {/* Left Split Branding Panel */}
      <section ref={brandRef} className="kael-login-brand bg-[#0C3B33] text-white">
        {/* Top-Left Brand Lockup */}
        <div className="flex items-center gap-3">
          {!logoFailed ? (
            <img
              src="/assets/kael-logo.png"
              alt="Logo KAEL"
              referrerPolicy="no-referrer"
              onError={() => setLogoFailed(true)}
              className="w-8 h-8 object-contain shrink-0"
            />
          ) : (
            <div className="w-8 h-8 rounded-lg bg-[#00897B] text-white font-bold flex items-center justify-center text-sm">
              K
            </div>
          )}
          <span className="text-2xl font-bold tracking-[0.06em] text-white">
            KAEL
          </span>
        </div>

        {/* Center-Left Editorial Message matching Placement Reference */}
        <div className="kael-login-brand-copy">
          <div className="text-caption font-semibold uppercase tracking-[0.18em] text-[#9BBFB7] mb-3">
            PELAYANAN YANG TERHUBUNG
          </div>
          <h1 className="kael-login-display-heading font-bold tracking-tight text-white">
            Lebih dekat ke pasien.
            <br />
            Lebih ringan mengelola.
          </h1>
          <p className="text-sm text-[#BFD8D2] mt-4 leading-relaxed">
            Satu ruang kerja untuk pelayanan, dokumen, dan operasional fasilitas.
          </p>
        </div>

        <div className="h-8" aria-hidden="true" />
      </section>

      {/* Right Column: Original Login Form Card */}
      <main ref={mainRef} className="kael-login-main">
        <div className="kael-login-card bg-white dark:bg-[#0B211D] border border-[#D5E3DF] dark:border-[#183831] rounded-2xl shadow-lg overflow-hidden">
          {/* Modern Jade/Teal Banner (Original Login Form Header) */}
          <div className="px-5 py-4 bg-[#00897B] flex items-center justify-between gap-4 text-white">
            <div className="min-w-0">
              <div className="text-caption font-semibold uppercase tracking-wider text-white/85">
                HEALTHCARE WORKSPACE &amp; ERP
              </div>
              <h2 className="text-xl font-bold tracking-tight text-white mt-0.5">
                Masuk ke Ruang Kerja KAEL
              </h2>
            </div>
            {!logoFailed && (
              <div className="w-12 h-12 rounded-xl bg-white p-2 shrink-0 flex items-center justify-center shadow-xs">
                <img
                  src="/assets/kael-logo.png"
                  alt="Logo KAEL"
                  referrerPolicy="no-referrer"
                  onError={() => setLogoFailed(true)}
                  className="w-full h-full object-contain"
                />
              </div>
            )}
          </div>

          <div className="p-5">
            <div data-connection-anchor className="kael-login-connection-anchor mb-3 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2 text-caption font-semibold">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${isConnectingServer ? 'bg-amber-500 animate-pulse' : serverInfo ? 'bg-[#00897B]' : 'bg-red-500'}`} />
                  <span role="status">
                    {isConnectingServer ? 'Menghubungkan ke server…' : serverInfo ? 'Server terhubung' : 'Server belum terhubung'}
                  </span>
                </div>
                <button
                  type="button"
                  ref={serverTriggerRef}
                  onClick={() => setActiveOverlay('server')}
                  disabled={isSubmitting}
                  aria-haspopup="dialog"
                  aria-expanded={activeOverlay === 'server'}
                  aria-controls="login-connection-dialog"
                  className="inline-flex shrink-0 items-center gap-1 text-caption font-semibold text-[#00897B] disabled:opacity-60 cursor-pointer"
                >
                  <Server className="h-3.5 w-3.5" />
                  Atur server
                </button>
              </div>
              <p className="mt-1.5 truncate text-caption text-[#52736B] dark:text-[#86B5A9]" title={getServerOrigin()}>
                {getServerOrigin()}
                {serverInfo && !isConnectingServer ? ` · ${serverInfo.latencyMs} ms` : ''}
              </p>
            </div>

            {pingError && (
              <div
                role="alert"
                className="mb-3 max-h-24 overflow-y-auto overscroll-contain p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-caption text-red-700 dark:text-red-300"
              >
                Peringatan Jaringan: {pingError}
              </div>
            )}

            {loginError && (
              <div
                role="alert"
                className="mb-3 max-h-24 overflow-y-auto overscroll-contain p-3 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-900 text-caption text-red-700 dark:text-red-300 font-medium"
              >
                {loginError}
              </div>
            )}

            <form onSubmit={handleLoginSubmit} className="space-y-3">
              <div data-connection-anchor className="kael-login-connection-anchor">
                <div className="mb-1.5 flex items-center gap-1.5">
                  <label htmlFor="login-facility-input" className="text-caption font-semibold text-[#0F2922] dark:text-white">
                    FASILITAS KESEHATAN
                  </label>
                  <button ref={profilesTriggerRef} type="button" onClick={() => setActiveOverlay('profiles')}
                    disabled={isSubmitting} aria-label="Profil fasilitas" title="Profil fasilitas" aria-haspopup="dialog"
                    aria-expanded={activeOverlay === 'profiles'} aria-controls="login-connection-dialog"
                    className="rounded-md p-1 text-[#00897B] hover:bg-[#E6F4F1] dark:hover:bg-[#163F35] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00897B] disabled:opacity-60">
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                <div className="relative">
                  <Building2 className="w-4 h-4 text-[#52736B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input id="login-facility-input" type="text" value={facilityCode}
                    onChange={(event) => setFacilityCode(event.target.value.toUpperCase())}
                    placeholder="Masukkan kode fasilitas" autoComplete="off" spellCheck={false}
                    aria-describedby="login-facility-help" disabled={isSubmitting}
                    className="w-full pl-10 pr-3 py-2.5 text-sm font-mono font-semibold rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714] text-[#0F2922] dark:text-white focus:outline-none focus:border-[#00897B]" />
                </div>
                <p id="login-facility-help" className="mt-1.5 text-caption leading-relaxed text-[#52736B] dark:text-[#86B5A9]">
                  Isi kode dari pengelola. Kosongkan hanya untuk administrasi superuser.
                </p>
              </div>

              {/* 2. Username / NIP / SIP */}
              <div>
                <label
                  htmlFor="login-username-input"
                  className="block text-caption font-semibold text-[#0F2922] dark:text-white mb-1.5"
                >
                  Username / NIP / Nomor SIP <span className="text-red-600">*</span>
                </label>
                <div className="relative">
                  <UserCheck className="w-4 h-4 text-[#52736B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="login-username-input"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Masukkan username atau NIP/SIP"
                    required
                    autoFocus
                    autoComplete="username"
                    className="w-full pl-10 pr-3 py-2.5 text-sm rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714] text-[#0F2922] dark:text-white focus:outline-none focus:border-[#00897B]"
                  />
                </div>
              </div>

              {/* 3. Password */}
              <div>
                <label
                  htmlFor="login-password-input"
                  className="block text-caption font-semibold text-[#0F2922] dark:text-white mb-1.5"
                >
                  Kata Sandi <span className="text-red-600">*</span>
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-[#52736B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="login-password-input"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Masukkan kata sandi"
                    required
                    autoComplete="current-password"
                    className="w-full pl-10 pr-10 py-2.5 text-sm rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714] text-[#0F2922] dark:text-white focus:outline-none focus:border-[#00897B]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#52736B] hover:text-[#0F2922] dark:hover:text-white cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* 4. Remember Me — Clean Single Line */}
              <div className="pt-0.5">
                <label className="inline-flex items-center gap-2.5 cursor-pointer select-none group">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded border-[#D5E3DF] text-[#00897B] focus:ring-[#00897B] accent-[#00897B]"
                  />
                  <span className="text-caption font-medium text-[#0F2922] dark:text-white group-hover:text-[#00897B] transition-colors">
                    Ingat sesi saya
                  </span>
                </label>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || isConnectingServer || !serverInfo || hasPendingEndpoint || !!pendingConnection}
                className="w-full py-2.5 px-4 rounded-xl bg-[#00897B] hover:bg-[#00796B] disabled:opacity-60 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs"
              >
                <Lock className="w-4 h-4" />
                {isSubmitting
                  ? 'Memverifikasi Otorisasi...'
                  : isConnectingServer ? 'Menghubungkan server…'
                  : !serverInfo ? 'Hubungkan server untuk masuk'
                  : hasPendingEndpoint ? 'Hubungkan server untuk masuk'
                  : `Masuk ke ${normalizeFacilityCode(facilityCode) || 'Ruang Kerja'}`}
              </button>
            </form>

            {/* Compact Utility Footer */}
            <div className="mt-4 pt-3 border-t border-[#E2ECE8] dark:border-[#183831] flex flex-wrap items-center justify-between gap-3 text-caption text-[#52736B] dark:text-[#86B5A9]">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#00897B] shrink-0" />
                <span>Otorisasi berbasis peran aktif</span>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => void probeServer()}
                  disabled={isConnectingServer || isSubmitting}
                  aria-label="Muat ulang koneksi server"
                  title="Muat Ulang Koneksi Server"
                  className="text-[#52736B] hover:text-[#00897B] shrink-0 cursor-pointer"
                >
                  <RefreshCw className={`w-4 h-4 ${isConnectingServer ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>


          </div>
        </div>
      </main>

      <dialog
        ref={overlayRef}
        id="login-connection-dialog"
        aria-labelledby="login-overlay-title"
        aria-modal="true"
        onCancel={(event) => { event.preventDefault(); closeOverlay(); }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeOverlay();
        }}
        className="kael-login-dialog rounded-2xl border border-[#C8DDD7] bg-white p-0 text-[#0F2922] shadow-2xl dark:border-[#285046] dark:bg-[#0B211D] dark:text-[#ECF5F2]"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#D5E3DF] px-5 py-4 dark:border-[#1E473F]">
          <h3 id="login-overlay-title" className="text-base font-semibold">
            {pendingConnection ? 'Ganti koneksi' : activeOverlay === 'server' ? 'Atur server' : showProfileEditor ? editingProfileId ? 'Edit profil fasilitas' : 'Tambah profil fasilitas' : 'Profil fasilitas'}
          </h3>
          <button type="button" onClick={closeOverlay} aria-label="Tutup pengaturan"
            className="shrink-0 rounded-lg p-2 text-[#52736B] hover:bg-[#F3F8F6] dark:text-[#86B5A9] dark:hover:bg-[#163F35] focus-visible:outline-2 focus-visible:outline-[#00897B]">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {pendingConnection ? (
            <div className="space-y-3 text-sm leading-relaxed">
              <p>Mengganti server atau fasilitas akan mengosongkan kata sandi. Kredensial belum dikirim ke alamat baru.</p>
              <p className="break-all rounded-lg bg-[#F3F8F6] p-3 font-mono text-caption dark:bg-[#071714]">{pendingConnection.origin}</p>
              {pendingConnection.facilityCode && <p className="break-words text-sm">Fasilitas: {pendingConnection.facilityCode}</p>}
            </div>
          ) : activeOverlay === 'server' ? (
            <form id="server-connection-form" onSubmit={handleSaveServerEndpoint} className="space-y-3">
              <label htmlFor="server-endpoint-input" className="block text-sm font-medium">Alamat server KAEL</label>
              <input id="server-endpoint-input" type="text" data-overlay-initial-focus
                value={serverUrl} onChange={(event) => { setServerUrl(event.target.value); setServerConfigError(null); setPendingConnection(null); }}
                placeholder="https://kael.instansi.id" required disabled={isSubmitting || isConnectingServer}
                autoComplete="url" spellCheck={false} aria-describedby="server-endpoint-help"
                className="w-full rounded-xl border border-[#C8DDD7] bg-[#F8FBFA] px-3 py-2.5 font-mono text-sm focus:border-[#00897B] focus:outline-none dark:border-[#285046] dark:bg-[#071714]" />
              <p id="server-endpoint-help" className="text-caption leading-relaxed text-[#52736B] dark:text-[#86B5A9]">
                Isi alamat dari pengelola, termasuk port bila diperlukan. Alamat awal memakai hostname situs ini pada port 1507. Akhiran /api ditambahkan otomatis.
              </p>
              {hasPendingEndpoint && <p className="text-caption text-[#52736B] dark:text-[#86B5A9]">Perubahan alamat diterapkan setelah Anda menekan Hubungkan.</p>}
              {serverConfigError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{serverConfigError}</p>}
            </form>
          ) : showProfileEditor ? (
            <form id="facility-profile-form" onSubmit={handleSaveProfile} className="space-y-4">
              <p className="text-caption leading-relaxed text-[#52736B] dark:text-[#86B5A9]">Tersimpan di browser ini setelah Anda menekan Simpan. Kata sandi tidak disertakan.</p>
              <label className="block text-sm font-medium">
                Label profil (opsional)
                <input data-overlay-initial-focus value={profileDraft.label} maxLength={120}
                  onChange={(event) => setProfileDraft({ ...profileDraft, label: event.target.value })}
                  className="mt-1.5 w-full rounded-xl border border-[#C8DDD7] bg-[#F8FBFA] px-3 py-2.5 text-sm focus:border-[#00897B] focus:outline-none dark:border-[#285046] dark:bg-[#071714]" />
              </label>
              <label className="block text-sm font-medium">
                Alamat server
                <input type="text" required value={profileDraft.origin} spellCheck={false} autoComplete="off"
                  onChange={(event) => setProfileDraft({ ...profileDraft, origin: event.target.value })}
                  placeholder="http://192.168.1.20:1507"
                  className="mt-1.5 w-full rounded-xl border border-[#C8DDD7] bg-[#F8FBFA] px-3 py-2.5 font-mono text-sm focus:border-[#00897B] focus:outline-none dark:border-[#285046] dark:bg-[#071714]" />
              </label>
              <label className="block text-sm font-medium">
                Kode fasilitas
                <input type="text" required value={profileDraft.facilityCode} spellCheck={false} autoComplete="off"
                  onChange={(event) => setProfileDraft({ ...profileDraft, facilityCode: event.target.value.toUpperCase() })}
                  className="mt-1.5 w-full rounded-xl border border-[#C8DDD7] bg-[#F8FBFA] px-3 py-2.5 font-mono text-sm focus:border-[#00897B] focus:outline-none dark:border-[#285046] dark:bg-[#071714]" />
              </label>
              {profileError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{profileError}</p>}
            </form>
          ) : (
            <div className="space-y-3">
              <p className="text-caption leading-relaxed text-[#52736B] dark:text-[#86B5A9]">Pilih profil yang pernah Anda simpan pada browser ini, atau tambahkan alamat dan kode fasilitas secara manual.</p>
              {profiles.length === 0 ? <p className="py-5 text-center text-sm text-[#52736B] dark:text-[#86B5A9]">Belum ada profil tersimpan.</p> : profiles.map((profile, index) => (
                <div key={profile.id} className="rounded-xl border border-[#D5E3DF] bg-[#F8FBFA] p-3 dark:border-[#1E473F] dark:bg-[#071714]">
                  <p className="break-words text-sm font-semibold">{profile.label || profile.facilityCode}</p>
                  <p className="mt-1 break-all font-mono text-caption text-[#52736B] dark:text-[#86B5A9]">{profile.origin}</p>
                  {profile.label && <p className="mt-1 break-words font-mono text-caption">{profile.facilityCode}</p>}
                  <div className="mt-3 flex flex-wrap gap-2 text-caption font-semibold">
                    <button type="button" data-overlay-initial-focus={index === 0 ? '' : undefined} disabled={isSubmitting || isConnectingServer}
                      onClick={() => requestConnection(profile.origin, profile.facilityCode)}
                      className="rounded-lg bg-[#00897B] px-3 py-2 text-white hover:bg-[#00796B] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00897B] disabled:opacity-60">Gunakan</button>
                    <button type="button" disabled={isSubmitting} onClick={() => beginProfile(profile)}
                      aria-label={`Edit profil ${profile.label || profile.facilityCode}`}
                      className="rounded-lg px-3 py-2 text-[#00897B] hover:bg-[#E6F4F1] dark:hover:bg-[#163F35] focus-visible:outline-2 focus-visible:outline-[#00897B] disabled:opacity-60">Edit</button>
                    <button type="button" disabled={isSubmitting} onClick={() => handleDeleteProfile(profile.id)}
                      aria-label={`Hapus profil ${profile.label || profile.facilityCode}`}
                      className="rounded-lg px-3 py-2 text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40 focus-visible:outline-2 focus-visible:outline-red-600 disabled:opacity-60">Hapus</button>
                  </div>
                </div>
              ))}
              {profileError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{profileError}</p>}
              {profileNotice && <p role="status" className="text-sm text-[#00897B]">{profileNotice}</p>}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[#D5E3DF] bg-[#F8FBFA] px-5 py-3 dark:border-[#1E473F] dark:bg-[#071714]">
          {pendingConnection ? (
            <>
              <button type="button" onClick={() => setPendingConnection(null)} className="rounded-lg px-3 py-2 text-sm text-[#52736B] dark:text-[#86B5A9]">Batal</button>
              <button type="button" data-overlay-initial-focus onClick={() => void applyConnection(pendingConnection)} disabled={isConnectingServer || isSubmitting}
                className="rounded-lg bg-[#00897B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#00796B] disabled:opacity-60">Ganti koneksi</button>
            </>
          ) : activeOverlay === 'server' ? (
            <>
              <button type="button" onClick={() => requestConnection(getDefaultServerOrigin(), undefined, true)} disabled={isSubmitting || isConnectingServer}
                className="mr-auto rounded-lg px-1 py-2 text-caption font-semibold text-[#00897B] disabled:opacity-60">Pengaturan awal</button>
              <button type="submit" form="server-connection-form" disabled={isSubmitting || isConnectingServer}
                className="rounded-lg bg-[#00897B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#00796B] disabled:opacity-60">Hubungkan</button>
            </>
          ) : showProfileEditor ? (
            <>
              <button type="button" onClick={() => setShowProfileEditor(false)} className="rounded-lg px-3 py-2 text-sm text-[#52736B] dark:text-[#86B5A9]">Batal</button>
              <button type="submit" form="facility-profile-form" className="rounded-lg bg-[#00897B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#00796B]">
                {editingProfileId ? 'Simpan perubahan' : 'Simpan profil'}
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={closeOverlay} className="rounded-lg px-3 py-2 text-sm text-[#52736B] dark:text-[#86B5A9]">Tutup</button>
              <button type="button" data-overlay-initial-focus={profiles.length === 0 ? '' : undefined} onClick={() => beginProfile()} disabled={isSubmitting}
                className="rounded-lg bg-[#00897B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#00796B] disabled:opacity-60">Tambah profil</button>
            </>
          )}
        </footer>
      </dialog>
    </div>
  );
};
