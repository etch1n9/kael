import React, { useState } from 'react';
import { CalendarCheck, Clock, Wallet } from 'lucide-react';
import { Facility, UserAccount } from '../domain/simrs.ts';

interface SdmErpModuleProps {
  activeFacility: Facility;
  currentUser: UserAccount;
  allUsers: UserAccount[];
  initialView?: 'SDM_JADWAL' | 'SDM_ERP';
}

type SdmTab = 'ABSENSI' | 'CUTI' | 'PENGGAJIAN';

export function SdmErpModule({
  currentUser,
  initialView = 'SDM_ERP',
}: SdmErpModuleProps) {
  const [activeTab, setActiveTab] = useState<SdmTab>(
    initialView === 'SDM_JADWAL' ? 'ABSENSI' : 'PENGGAJIAN'
  );

  const tabs: { key: SdmTab; label: string; icon: typeof Clock }[] = [
    { key: 'ABSENSI', label: 'Absensi & shift', icon: Clock },
    { key: 'CUTI', label: 'Cuti & izin', icon: CalendarCheck },
    { key: 'PENGGAJIAN', label: 'Penggajian', icon: Wallet },
  ];

  return (
    <div className="min-w-0 space-y-3">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-[#0F2922] dark:text-white tracking-tight mt-0.5">
          SDM &amp; Kepegawaian
        </h1>
        <p className="text-xs text-[#52736B] dark:text-[#86B5A9] mt-1">
          Pencatatan presensi, cuti, dan penggajian belum tersedia di server KAEL.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 min-w-0" role="tablist" aria-label="Layanan SDM">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            id={`sdm-tab-${key}`}
            type="button"
            role="tab"
            aria-selected={activeTab === key}
            aria-controls={`sdm-panel-${key}`}
            onClick={() => setActiveTab(key)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
              activeTab === key
                ? 'bg-[#00897B] text-white'
                : 'bg-white dark:bg-[#0B211D] border border-[#D5E3DF] dark:border-[#1E473F] text-[#0F2922] dark:text-white hover:bg-[#EBF4F1]'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <section
        id={`sdm-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`sdm-tab-${activeTab}`}
        className="rounded-2xl border border-[#E2ECE8] dark:border-[#183831] bg-white dark:bg-[#0B211D] p-4 space-y-3"
      >
        {activeTab === 'ABSENSI' && (
          <>
            <h2 className="text-sm font-bold text-[#0F2922] dark:text-white">Presensi dan jadwal shift belum tersedia</h2>
            <p className="text-xs text-[#52736B] dark:text-[#86B5A9]">
              {currentUser.fullName} • {currentUser.roleName || currentUser.role} • NIP/SIP: {currentUser.nipOrSip || 'Belum diisi'}
            </p>
            <p id="sdm-attendance-help" className="max-w-(--kael-text-column-inline-size) text-sm leading-relaxed text-[#52736B] dark:text-[#86B5A9]">
              Kehadiran dan jadwal shift memerlukan penyimpanan di server. Pencatatan dinonaktifkan sampai data dapat disimpan dan dibaca kembali.
            </p>
            <button type="button" disabled aria-describedby="sdm-attendance-help" className="rounded-xl bg-[#00897B] px-4 py-2 text-xs font-semibold text-white opacity-50 cursor-not-allowed">
              Catat Kehadiran
            </button>
          </>
        )}

        {activeTab === 'CUTI' && (
          <>
            <h2 className="text-sm font-bold text-[#0F2922] dark:text-white">Pengajuan dan persetujuan cuti belum tersedia</h2>
            <p id="sdm-leave-help" className="max-w-(--kael-text-column-inline-size) text-sm leading-relaxed text-[#52736B] dark:text-[#86B5A9]">
              Pengajuan, riwayat, dan persetujuan cuti memerlukan penyimpanan di server. Pengiriman serta persetujuan dinonaktifkan sampai alur tersebut tersedia.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled aria-describedby="sdm-leave-help" className="rounded-xl bg-[#00897B] px-4 py-2 text-xs font-semibold text-white opacity-50 cursor-not-allowed">Kirim Permohonan Cuti</button>
              <button type="button" disabled aria-describedby="sdm-leave-help" className="rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] px-4 py-2 text-xs font-semibold opacity-50 cursor-not-allowed">Setujui Cuti</button>
            </div>
          </>
        )}

        {activeTab === 'PENGGAJIAN' && (
          <>
            <h2 className="text-sm font-bold text-[#0F2922] dark:text-white">Penggajian belum tersedia</h2>
            <p className="max-w-(--kael-text-column-inline-size) text-sm leading-relaxed text-[#52736B] dark:text-[#86B5A9]">
              Komponen gaji dan proses pencairan belum tersedia di server. Pencairan memerlukan data gaji yang disimpan serta disahkan terlebih dahulu.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
