import React, { useEffect, useState } from 'react';
import {
  Building2,
  Eye,
  EyeOff,
  HelpCircle,
  KeyRound,
  Lock,
  RefreshCw,
  Server,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { Facility } from '../types/simrs';
import {
  getConfiguredApiBaseUrl,
  kaelApi,
  setConfiguredApiBaseUrl,
  StoredSession,
} from '../utils/apiClient';
import { normalizeFacilityCode } from '../utils/clinicalLogic';

interface LoginViewProps {
  onLoginSuccess: (session: StoredSession) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
  const [facilityCode, setFacilityCode] = useState('KLINIK_JAMYLA');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [serverUrl, setServerUrl] = useState(getConfiguredApiBaseUrl());
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [showSysadminHelp, setShowSysadminHelp] = useState(false);

  const [serverInfo, setServerInfo] = useState<{
    serverNode: string;
    environment: string;
    latencyMs: number;
    facilities: {
      code: string;
      name: string;
      type: Facility['type'];
      city: string;
      kemenkesCode: string;
      bpjsPcareCode: string;
    }[];
  } | null>(null);

  const [pingError, setPingError] = useState<string | null>(null);
  const [isConnectingServer, setIsConnectingServer] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginError, setLoginError] = useState(stringOrNull(null));
  const [logoFailed, setLogoFailed] = useState(false);

  function stringOrNull(v: string | null) {
    return v;
  }

  const probeServer = async () => {
    setIsConnectingServer(true);
    setPingError(null);
    const start = performance.now();
    try {
      const data = await kaelApi.fetchPublicFacilities();
      const latencyMs = Math.max(1, Math.round(performance.now() - start));
      setServerInfo({
        serverNode: data.serverNode,
        environment: data.environment,
        latencyMs,
        facilities: data.facilities,
      });
    } catch (err) {
      setPingError(
        err instanceof Error
          ? err.message
          : 'Tidak dapat terhubung ke endpoint server KAEL.'
      );
    } finally {
      setIsConnectingServer(false);
    }
  };

  useEffect(() => {
    probeServer();
  }, []);

  const handleSaveServerEndpoint = (e: React.FormEvent) => {
    e.preventDefault();
    setConfiguredApiBaseUrl(serverUrl);
    setShowServerConfig(false);
    probeServer();
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);

    const rawUser = username.trim();
    const cleanUser =
      rawUser.toLowerCase() === 'superadmin' ? 'superuser' : rawUser;
    const cleanFac = normalizeFacilityCode(facilityCode);

    if (!cleanFac) {
      setLoginError(
        'Kode FASILITAS wajib dipilih atau diisi (contoh: KLINIK_JAMYLA atau RSUD_MAJALAYA).'
      );
      return;
    }
    if (!cleanUser) {
      setLoginError('Username, NIP, atau Nomor SIP wajib diisi.');
      return;
    }
    if (!password) {
      setLoginError('Kata sandi otorisasi wajib diisi.');
      return;
    }

    setIsSubmitting(true);
    try {
      const session = await kaelApi.login({
        username: cleanUser,
        password,
        facilityCode: cleanFac,
        rememberMe,
      });
      onLoginSuccess({
        ...session,
        rememberMe,
      });
    } catch (err) {
      setLoginError(
        err instanceof Error
          ? err.message
          : 'Otentikasi gagal. Periksa kembali kredensial dan kode fasilitas.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedFacilityMeta = (serverInfo?.facilities || []).find(
    (f) => f.code === normalizeFacilityCode(facilityCode)
  );

  const quickAccounts = [
    { user: 'superuser', label: 'superuser • Root', fac: 'RSUD_MAJALAYA' },
    { user: 'owner.jamyla', label: 'owner.jamyla • Owner', fac: 'KLINIK_JAMYLA' },
    { user: 'manajer.klinik', label: 'manajer.klinik • Manajer', fac: 'KLINIK_JAMYLA' },
    { user: 'dr.hendra', label: 'dr.hendra • Dokter Sp.PD', fac: 'KLINIK_JAMYLA' },
    { user: 'drg.nabila', label: 'drg.nabila • Dokter Gigi', fac: 'KLINIK_JAMYLA' },
    { user: 'perawat.siti', label: 'perawat.siti • Perawat', fac: 'KLINIK_JAMYLA' },
    { user: 'bidan.fitri', label: 'bidan.fitri • Bidan KIA', fac: 'KLINIK_JAMYLA' },
    { user: 'apt.rina', label: 'apt.rina • Apoteker', fac: 'KLINIK_JAMYLA' },
    { user: 'kasir.budi', label: 'kasir.budi • Kasir', fac: 'KLINIK_JAMYLA' },
    { user: 'hrd.sdm', label: 'hrd.sdm • SDM', fac: 'KLINIK_JAMYLA' },
  ];

  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-[#F3F8F6] dark:bg-[#061714] text-[#0F2922] dark:text-[#ECF5F2] select-none">
      {/* Left Split Branding Panel */}
      <section className="w-full lg:w-[45%] xl:w-[46%] bg-[#0C3B33] text-white px-8 py-10 sm:px-12 lg:px-14 lg:py-12 flex flex-col justify-between shrink-0">
        {/* Top-Left Brand Lockup */}
        <div className="flex items-center gap-3">
          {!logoFailed ? (
            <img
              src="/assets/aistudio/kael-logo_d4a66617.png"
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
        <div className="my-auto py-12 lg:py-0 max-w-lg">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9BBFB7] mb-3">
            PELAYANAN YANG TERHUBUNG
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-bold tracking-tight text-white leading-[1.16]">
            Lebih dekat ke pasien.
            <br />
            Lebih ringan mengelola.
          </h1>
          <p className="text-sm text-[#BFD8D2] mt-4 leading-relaxed">
            Satu ruang kerja untuk pelayanan, dokumen, dan operasional fasilitas.
          </p>
        </div>

        <div className="hidden lg:block h-8" aria-hidden="true" />
      </section>

      {/* Right Column: Original Login Form Card */}
      <main className="flex-1 flex items-center justify-center px-4 py-8 sm:px-8 lg:px-12">
        <div className="w-full max-w-md bg-white dark:bg-[#0B211D] border border-[#D5E3DF] dark:border-[#183831] rounded-2xl shadow-lg overflow-hidden">
          {/* Modern Jade/Teal Banner (Original Login Form Header) */}
          <div className="px-7 py-6 bg-[#00897B] flex items-center justify-between gap-4 text-white">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-white/85">
                HEALTHCARE WORKSPACE &amp; ERP
              </div>
              <h2 className="text-xl font-bold tracking-tight text-white mt-0.5">
                Masuk ke Ruang Kerja KAEL
              </h2>
            </div>
            {!logoFailed && (
              <div className="w-14 h-14 rounded-2xl bg-white p-2 shrink-0 flex items-center justify-center shadow-xs">
                <img
                  src="/assets/aistudio/kael-logo_d4a66617.png"
                  alt="Logo KAEL"
                  referrerPolicy="no-referrer"
                  onError={() => setLogoFailed(true)}
                  className="w-full h-full object-contain"
                />
              </div>
            )}
          </div>

          <div className="p-7">
            {showServerConfig && (
              <form
                onSubmit={handleSaveServerEndpoint}
                className="mb-5 p-3.5 rounded-xl bg-[#F3F8F6] dark:bg-[#071714] border border-[#D5E3DF] dark:border-[#1E473F]"
              >
                <label
                  htmlFor="server-endpoint-input"
                  className="block text-xs font-semibold text-[#0F2922] dark:text-white mb-1.5"
                >
                  Host / Endpoint API Server SIMRS
                </label>
                <div className="flex gap-2">
                  <input
                    id="server-endpoint-input"
                    type="text"
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                    placeholder="/api"
                    className="flex-1 px-3 py-1.5 text-xs font-mono rounded-lg border border-[#D5E3DF] dark:border-[#1E473F] bg-white dark:bg-[#0B211D]"
                  />
                  <button
                    type="submit"
                    className="px-3.5 py-1.5 text-xs font-semibold bg-[#00897B] text-white rounded-lg hover:bg-[#00796B] transition-colors cursor-pointer"
                  >
                    Simpan
                  </button>
                </div>
              </form>
            )}

            {pingError && (
              <div
                role="alert"
                className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300"
              >
                Peringatan Jaringan: {pingError}
              </div>
            )}

            {loginError && (
              <div
                role="alert"
                className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 font-medium"
              >
                {loginError}
              </div>
            )}

            <form onSubmit={handleLoginSubmit} className="space-y-4">
              {/* 1. Mandatory FASILITAS Field */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label
                    htmlFor="login-facility-input"
                    className="block text-xs font-semibold text-[#0F2922] dark:text-white whitespace-nowrap shrink-0"
                  >
                    FASILITAS KESEHATAN <span className="text-red-600">*</span>
                  </label>
                  {(serverInfo?.facilities.length ?? 0) > 0 && (
                    <select
                      aria-label="Pilih Fasilitas Terdaftar"
                      value={
                        (serverInfo?.facilities || []).some(
                          (f) => f.code === normalizeFacilityCode(facilityCode)
                        )
                          ? normalizeFacilityCode(facilityCode)
                          : ''
                      }
                      onChange={(e) => {
                        if (e.target.value) setFacilityCode(e.target.value);
                      }}
                      className="max-w-[195px] truncate text-right text-[11px] font-mono font-semibold text-[#00897B] bg-transparent border-0 focus:outline-none cursor-pointer"
                    >
                      <option value="" disabled>
                        Pilih fasilitas...
                      </option>
                      {(serverInfo?.facilities || []).map((f) => (
                        <option key={f.code} value={f.code}>
                          {f.code} — {f.city}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="relative">
                  <Building2 className="w-4 h-4 text-[#52736B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="login-facility-input"
                    type="text"
                    list="kael-facility-datalist"
                    value={facilityCode}
                    onChange={(e) => setFacilityCode(e.target.value.toUpperCase())}
                    placeholder="KLINIK_JAMYLA"
                    required
                    className="w-full pl-10 pr-3 py-2.5 text-sm font-mono font-semibold rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714] text-[#0F2922] dark:text-white focus:outline-none focus:border-[#00897B]"
                  />
                  <datalist id="kael-facility-datalist">
                    {(serverInfo?.facilities || []).map((f) => (
                      <option key={f.code} value={f.code}>
                        {f.name} — {f.city}
                      </option>
                    ))}
                  </datalist>
                </div>
                {selectedFacilityMeta && (
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-[#52736B] dark:text-[#86B5A9] font-mono">
                    <span className="truncate">{selectedFacilityMeta.name}</span>
                    <span className="shrink-0">
                      Kemenkes: {selectedFacilityMeta.kemenkesCode}
                    </span>
                  </div>
                )}
              </div>

              {/* 2. Username / NIP / SIP */}
              <div>
                <label
                  htmlFor="login-username-input"
                  className="block text-xs font-semibold text-[#0F2922] dark:text-white mb-1.5"
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
                  className="block text-xs font-semibold text-[#0F2922] dark:text-white mb-1.5"
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
                  <span className="text-xs font-medium text-[#0F2922] dark:text-white group-hover:text-[#00897B] transition-colors">
                    Ingat sesi saya
                  </span>
                </label>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 px-4 rounded-xl bg-[#00897B] hover:bg-[#00796B] disabled:opacity-60 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs"
              >
                <Lock className="w-4 h-4" />
                {isSubmitting
                  ? 'Memverifikasi Otorisasi...'
                  : `Masuk ke ${normalizeFacilityCode(facilityCode) || 'Ruang Kerja'}`}
              </button>
            </form>

            {/* Compact Utility Footer */}
            <div className="mt-5 pt-4 border-t border-[#E2ECE8] dark:border-[#183831] flex items-center justify-between gap-3 text-[11px] text-[#52736B] dark:text-[#86B5A9]">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#00897B] shrink-0" />
                <span>Otorisasi berbasis peran aktif</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowServerConfig((prev) => !prev)}
                  title="Pengaturan Endpoint Server"
                  className="text-[#52736B] hover:text-[#00897B] shrink-0 cursor-pointer"
                >
                  <Server className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={probeServer}
                  disabled={isConnectingServer}
                  title="Muat Ulang Koneksi Server"
                  className="text-[#52736B] hover:text-[#00897B] shrink-0 cursor-pointer"
                >
                  <RefreshCw className={`w-4 h-4 ${isConnectingServer ? 'animate-spin' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowSysadminHelp((prev) => !prev)}
                  title="Daftar Akun Demo"
                  className="text-[#52736B] hover:text-[#00897B] shrink-0 cursor-pointer"
                >
                  <HelpCircle className="w-4 h-4" />
                </button>
              </div>
            </div>

            {showSysadminHelp && (
              <div className="mt-3 p-3.5 rounded-xl bg-[#F3F8F6] dark:bg-[#071714] border border-[#D5E3DF] dark:border-[#1E473F] text-[11px] space-y-2">
                <div className="font-semibold text-[#0F2922] dark:text-white flex items-center justify-between">
                  <span>Akun Demo • Sandi: kael2026</span>
                  <span className="font-mono text-[#00897B]">Isi cepat</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 font-mono">
                  {quickAccounts.map((acc) => (
                    <button
                      key={acc.user}
                      type="button"
                      onClick={() => {
                        setUsername(acc.user);
                        setPassword('kael2026');
                        setFacilityCode(acc.fac);
                      }}
                      className="text-left px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#0B211D] border border-[#D5E3DF] dark:border-[#1E473F] hover:border-[#00897B] text-[#0F2922] dark:text-white truncate cursor-pointer"
                    >
                      {acc.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};
