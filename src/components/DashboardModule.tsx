import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  BedDouble,
  CheckCircle2,
  ClipboardList,
  Filter,
  Landmark,
  Pill,
  Search,
  Stethoscope,
  Users,
} from 'lucide-react';
import { ModuleKey, VisitQueueItem } from '../types/simrs';
import { WorkspacePayload } from '../utils/apiClient';
import {
  buildCashflowTimeSeries,
  canUserAccessModule,
  formatRupiah,
  ROLE_LABELS,
} from '../utils/clinicalLogic';
import {
  buildDefaultFacilityConfigSnapshot,
  calculateVersionedHospitalMetrics,
  calculateVersionedKbkMetrics,
} from '../utils/platformEngine';
import { DataExportToolbar } from './DataExportToolbar';
import { KpiSparklineCanvas } from './KpiSparklineChart';
import { ExportColumn } from '../utils/exportDocument';

interface DashboardModuleProps {
  workspace: WorkspacePayload;
  onNavigateModule: (moduleKey: ModuleKey) => void;
  onOpenVisitInRme: (visit: VisitQueueItem) => void;
}

export const DashboardModule: React.FC<DashboardModuleProps> = ({
  workspace,
  onNavigateModule,
  onOpenVisitInRme,
}) => {
  const {
    user,
    activeFacility,
    patients,
    visits,
    beds,
    medications,
    pharmacyOrders,
    labOrders,
    invoices,
    accountingEntries,
  } = workspace;

  const [queueSearch, setQueueSearch] = useState('');
  const [poliFilter, setPoliFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const activeConfig = useMemo(
    () =>
      workspace.activeFacilityConfig ||
      buildDefaultFacilityConfigSnapshot(activeFacility),
    [workspace.activeFacilityConfig, activeFacility]
  );

  const hasFktpKbk = activeConfig.enabledSubCapabilities.includes('SUB_CLAIM_FKTP_KBK');
  const hasHospitalInpatient = activeConfig.enabledSubCapabilities.includes(
    'SUB_INPATIENT_BED_MGMT'
  );

  const kbkMetrics = useMemo(
    () =>
      calculateVersionedKbkMetrics({
        patients: workspace.patients,
        visits,
        soapRecords: workspace.soapRecords || [],
        referrals: workspace.referrals || [],
        registeredJknParticipants:
          activeFacility.payerContract?.registeredJknParticipants || 1200,
        baseCapitationNormRp: 11500,
        ruleSetId: activeConfig.dashboardTargets?.formulaVersion || 'KEMENKES_BPJS_2026_V1',
      }),
    [workspace.patients, visits, workspace.soapRecords, workspace.referrals, activeFacility, activeConfig]
  );

  const hospitalMetrics = useMemo(
    () =>
      calculateVersionedHospitalMetrics({
        beds,
        visits,
        periodDays: 30,
        ruleSetId: activeConfig.dashboardTargets?.formulaVersion || 'SIRS_KEMENKES_2026_V1',
      }),
    [beds, visits, activeConfig]
  );

  const activeQueueCount = visits.filter(
    (v) => v.status !== 'SELESAI' && v.status !== 'BATAL'
  ).length;
  const availableBedsCount = beds.filter((b) => b.status === 'TERSEDIA').length;
  const occupiedBedsCount = beds.filter((b) => b.status === 'TERISI').length;

  const pendingPharmacy = pharmacyOrders.filter((po) => po.status !== 'DISERAHKAN').length;
  const pendingLab = labOrders.filter((lo) => lo.status !== 'SELESAI_VERIFIKASI').length;

  const totalRevenue = accountingEntries
    .filter((a) => a.type === 'PENDAPATAN')
    .reduce((sum, a) => sum + a.amount, 0);
  const pendingReceivables = invoices
    .filter((i) => i.status !== 'LUNAS')
    .reduce((sum, i) => sum + (i.bpjsCoveredAmount || i.patientPayableAmount), 0);

  const recentCashSeries = useMemo(
    () => buildCashflowTimeSeries(accountingEntries, 12),
    [accountingEntries]
  );

  const lowStockMeds = medications.filter((m) => {
    const total = m.batches.reduce((s, b) => s + b.stock, 0);
    return total <= m.minStock;
  });

  const filteredVisits = useMemo(() => {
    const q = queueSearch.trim().toLowerCase();
    return visits.filter((v) => {
      if (poliFilter !== 'ALL' && v.polyclinic !== poliFilter) return false;
      if (statusFilter !== 'ALL' && v.status !== statusFilter) return false;
      if (!q) return true;
      return (
        v.patientName.toLowerCase().includes(q) ||
        v.mrNumber.toLowerCase().includes(q) ||
        v.queueNumber.toLowerCase().includes(q) ||
        v.doctorName.toLowerCase().includes(q) ||
        v.chiefComplaint.toLowerCase().includes(q)
      );
    });
  }, [visits, queueSearch, poliFilter, statusFilter]);

  const canAccessOwnerFinance = canUserAccessModule(user, 'KEUANGAN_OWNER');

  const visitExportColumns: ExportColumn<VisitQueueItem>[] = [
    { key: 'queueNumber', header: 'No. Antrean' },
    { key: 'patientName', header: 'Nama Pasien' },
    { key: 'mrNumber', header: 'No. RM' },
    { key: 'polyclinic', header: 'Poliklinik' },
    { key: 'doctorName', header: 'Dokter Pemeriksa' },
    { key: 'guarantor', header: 'Penjamin' },
    { key: 'chiefComplaint', header: 'Keluhan Utama' },
    { key: 'status', header: 'Status Layanan' },
  ];

  return (
    <div className="space-y-5">
      {/* Top Page Title */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#52736B] dark:text-[#86B5A9]">
            Ruang kerja • {activeFacility.name}
          </p>
          <h1 className="text-2xl font-bold text-[#0F2922] dark:text-white tracking-tight mt-0.5">
            Ringkasan eksekutif
          </h1>
        </div>
      </div>

      {/* Fresh Jade Teal-Green Hero Banner */}
      <div className="bg-[#008272] dark:bg-[#0A6C5F] text-white rounded-2xl px-7 py-6 shadow-xs flex items-center justify-between gap-6">
        <div className="space-y-1">
          <p className="text-xs font-medium text-white/90">
            Selamat bekerja, {user.fullName} • {ROLE_LABELS[user.role] || user.role}
          </p>
          <h2 className="text-2xl sm:text-[26px] font-bold tracking-tight text-white leading-snug max-w-xl">
            Layanan yang terkoordinasi,
            <br />
            pasien yang lebih diperhatikan.
          </h2>
          <p className="text-xs text-white/80 pt-1 font-mono">
            {activeFacility.code} • Kemenkes {activeFacility.kemenkesCode} • BPJS{' '}
            {activeFacility.bpjsPcareCode}
          </p>
        </div>

        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white p-2.5 shrink-0 flex items-center justify-center shadow-sm">
          <img
            src="/assets/aistudio/kael-logo_d4a66617.png"
            alt="KAEL"
            className="w-full h-full object-contain"
          />
        </div>
      </div>

      {/* 4 Clean White KPI Cards (Pure Numeric & Actionable — No Mini Charts) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => onNavigateModule('SEMUA_PASIEN')}
          className="text-left bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] hover:border-[#00897B] rounded-2xl p-5 transition-all cursor-pointer"
        >
          <div className="text-xs text-[#52736B] dark:text-[#86B5A9]">Pasien terdaftar</div>
          <div className="text-2xl font-bold text-[#0F2922] dark:text-white mt-1.5 font-mono">
            {patients.length}
          </div>
          <div className="text-xs text-[#52736B] dark:text-[#86B5A9] mt-1.5">
            Direktori Master Patient Index &rarr;
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateModule('PENDAFTARAN')}
          className="text-left bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] hover:border-[#00897B] rounded-2xl p-5 transition-all cursor-pointer"
        >
          <div className="text-xs text-[#52736B] dark:text-[#86B5A9]">Menunggu layanan</div>
          <div className="text-2xl font-bold text-[#0F2922] dark:text-white mt-1.5 font-mono">
            {activeQueueCount}
          </div>
          <div className="text-xs text-[#52736B] dark:text-[#86B5A9] mt-1.5">
            Dari {visits.length} kunjungan hari ini
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateModule('RAWAT_INAP')}
          className="text-left bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] hover:border-[#00897B] rounded-2xl p-5 transition-all cursor-pointer"
        >
          <div className="text-xs text-[#52736B] dark:text-[#86B5A9]">
            Tempat tidur tersedia
          </div>
          <div className="text-2xl font-bold text-[#0F2922] dark:text-white mt-1.5 font-mono">
            {availableBedsCount}
          </div>
          <div className="text-xs text-[#52736B] dark:text-[#86B5A9] mt-1.5">
            Total kapasitas {beds.length} bed
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateModule('RAWAT_INAP')}
          className="text-left bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] hover:border-[#00897B] rounded-2xl p-5 transition-all cursor-pointer"
        >
          <div className="text-xs text-[#52736B] dark:text-[#86B5A9]">Pasien rawat inap</div>
          <div className="text-2xl font-bold text-[#0F2922] dark:text-white mt-1.5 font-mono">
            {occupiedBedsCount}
          </div>
          <div className="text-xs text-[#52736B] dark:text-[#86B5A9] mt-1.5">
            {lowStockMeds.length > 0
              ? `${lowStockMeds.length} item obat di bawah stok minimum`
              : 'Admisi aktif bangsal & observasi'}
          </div>
        </button>
      </div>

      {/* Adaptive Regulatory & Performance Indicators (FKTP KBK or Hospital Barber-Johnson) */}
      <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-[#0F2922] dark:text-white">
              {hasFktpKbk
                ? 'Indikator Kapitasi Berbasis Kinerja FKTP & Mutu Layanan'
                : 'Indikator Efisiensi Rumah Sakit Kemenkes Barber-Johnson'}
            </h2>
            <p className="text-xs text-[#52736B] dark:text-[#86B5A9]">
              {hasFktpKbk
                ? `Dihitung otomatis dari ${kbkMetrics.registeredJknParticipants.toLocaleString('id-ID')} peserta terdaftar • Rule ${kbkMetrics.ruleSetId}`
                : `Dihitung dari ${hospitalMetrics.activeInpatientBeds} tempat tidur rawat inap aktif di luar bed observasi IGD • Rule ${hospitalMetrics.ruleSetId}`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigateModule('LAPORAN_REGULASI')}
            className="text-xs font-semibold text-[#00897B] hover:underline cursor-pointer"
          >
            Buka Laporan Regulasi Kemenkes &rarr;
          </button>
        </div>

        {hasFktpKbk ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="p-3.5 rounded-xl bg-[#F4F9F7] dark:bg-[#081916] border border-[#DCE8E4] dark:border-[#183831]">
              <div className="text-[#52736B] dark:text-[#86B5A9]">Angka Kontak Peserta</div>
              <div className="text-lg font-bold font-mono text-[#0F2922] dark:text-white mt-1">
                {kbkMetrics.angkaKontakPermil} ‰
              </div>
              <div className="text-[11px] font-mono text-[#00897B] mt-0.5">
                Target ≥ 150‰ • Skor {kbkMetrics.akScore}
              </div>
            </div>
            <div className="p-3.5 rounded-xl bg-[#F4F9F7] dark:bg-[#081916] border border-[#DCE8E4] dark:border-[#183831]">
              <div className="text-[#52736B] dark:text-[#86B5A9]">Rasio Rujukan Non-Spesialistik</div>
              <div className="text-lg font-bold font-mono text-[#0F2922] dark:text-white mt-1">
                {kbkMetrics.rrnsPercent}%
              </div>
              <div className="text-[11px] font-mono text-[#00897B] mt-0.5">
                Target ≤ 2% • 144 Diagnosis SKDI 4A
              </div>
            </div>
            <div className="p-3.5 rounded-xl bg-[#F4F9F7] dark:bg-[#081916] border border-[#DCE8E4] dark:border-[#183831]">
              <div className="text-[#52736B] dark:text-[#86B5A9]">Rasio Peserta Prolanis Terkendali</div>
              <div className="text-lg font-bold font-mono text-[#0F2922] dark:text-white mt-1">
                {kbkMetrics.rpptPercent}%
              </div>
              <div className="text-[11px] font-mono text-[#00897B] mt-0.5">
                Target ≥ 5% • Skor Bobot {kbkMetrics.weightedPerformanceScore}
              </div>
            </div>
            <div className="p-3.5 rounded-xl bg-[#F4F9F7] dark:bg-[#081916] border border-[#DCE8E4] dark:border-[#183831]">
              <div className="text-[#52736B] dark:text-[#86B5A9]">Estimasi Pencairan Kapitasi</div>
              <div className="text-lg font-bold font-mono text-[#00897B] mt-1">
                {formatRupiah(kbkMetrics.estimatedMonthlyCapitationRp)}
              </div>
              <div className="text-[11px] font-mono text-[#52736B] mt-0.5">
                Pencairan {kbkMetrics.capitationPayoutPercent}% norma kapitasi
              </div>
            </div>
          </div>
        ) : null}

        {hasHospitalInpatient ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-[#F4F9F7] dark:bg-[#081916] border border-[#DCE8E4] dark:border-[#183831]">
              <div className="text-[#52736B] dark:text-[#86B5A9]">BOR</div>
              <div className="text-base font-bold font-mono text-[#0F2922] dark:text-white mt-0.5">
                {hospitalMetrics.borPercent}%
              </div>
              <div className="text-[10px] font-mono text-[#00897B]">Ideal 60–85%</div>
            </div>
            <div className="p-3 rounded-xl bg-[#F4F9F7] dark:bg-[#081916] border border-[#DCE8E4] dark:border-[#183831]">
              <div className="text-[#52736B] dark:text-[#86B5A9]">ALOS</div>
              <div className="text-base font-bold font-mono text-[#0F2922] dark:text-white mt-0.5">
                {hospitalMetrics.alosDays} hari
              </div>
              <div className="text-[10px] font-mono text-[#00897B]">Ideal 6–9 hari</div>
            </div>
            <div className="p-3 rounded-xl bg-[#F4F9F7] dark:bg-[#081916] border border-[#DCE8E4] dark:border-[#183831]">
              <div className="text-[#52736B] dark:text-[#86B5A9]">TOI</div>
              <div className="text-base font-bold font-mono text-[#0F2922] dark:text-white mt-0.5">
                {hospitalMetrics.toiDays} hari
              </div>
              <div className="text-[10px] font-mono text-[#00897B]">Ideal 1–3 hari</div>
            </div>
            <div className="p-3 rounded-xl bg-[#F4F9F7] dark:bg-[#081916] border border-[#DCE8E4] dark:border-[#183831]">
              <div className="text-[#52736B] dark:text-[#86B5A9]">BTO</div>
              <div className="text-base font-bold font-mono text-[#0F2922] dark:text-white mt-0.5">
                {hospitalMetrics.btoTimes} kali
              </div>
              <div className="text-[10px] font-mono text-[#00897B]">Putaran bed</div>
            </div>
            <div className="p-3 rounded-xl bg-[#F4F9F7] dark:bg-[#081916] border border-[#DCE8E4] dark:border-[#183831]">
              <div className="text-[#52736B] dark:text-[#86B5A9]">NDR / GDR</div>
              <div className="text-base font-bold font-mono text-[#0F2922] dark:text-white mt-0.5">
                {hospitalMetrics.ndrPermil}‰ / {hospitalMetrics.gdrPermil}‰
              </div>
              <div className="text-[10px] font-mono text-[#00897B]">Batas &lt; 25‰</div>
            </div>
            <div className="p-3 rounded-xl bg-[#F4F9F7] dark:bg-[#081916] border border-[#DCE8E4] dark:border-[#183831]">
              <div className="text-[#52736B] dark:text-[#86B5A9]">Waktu Tunggu RJ</div>
              <div className="text-base font-bold font-mono text-[#0F2922] dark:text-white mt-0.5">
                {hospitalMetrics.avgOutpatientWaitMinutes} mnt
              </div>
              <div className="text-[10px] font-mono text-[#00897B]">Standar ≤ 60 mnt</div>
            </div>
          </div>
        ) : null}
      </div>

      {/* 2-Column Split: Aktivitas Layanan + Single Main Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-5 bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-6 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div>
              <h2 className="text-lg font-bold text-[#0F2922] dark:text-white">
                Pintasan layanan klinis
              </h2>
            </div>

            <div className="space-y-2.5 pt-1">
              <button
                type="button"
                onClick={() => onNavigateModule('RME_DOKTER')}
                className="w-full py-2.5 px-4 rounded-xl bg-[#00897B] hover:bg-[#00796B] text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                Pemeriksaan SOAP &amp; Rekam Medis
              </button>
              <button
                type="button"
                onClick={() => onNavigateModule('PENDAFTARAN')}
                className="w-full py-2.5 px-4 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-white dark:bg-[#0C2621] hover:bg-[#EBF4F1] text-[#0F2922] dark:text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                Loket pendaftaran &amp; antrean pasien
              </button>
              <button
                type="button"
                onClick={() => onNavigateModule('SEMUA_PASIEN')}
                className="w-full py-2.5 px-4 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-white dark:bg-[#0C2621] hover:bg-[#EBF4F1] text-[#0F2922] dark:text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                Direktori pasien terdaftar • {patients.length} RM
              </button>
            </div>
          </div>

          <div className="pt-3 border-t border-[#E2ECE8] dark:border-[#183831] grid grid-cols-2 gap-2 text-xs">
            <button
              type="button"
              onClick={() => onNavigateModule('APOTEK')}
              className="p-2.5 rounded-xl bg-[#F3F8F6] dark:bg-[#081916] text-left hover:border-[#00897B] border border-transparent cursor-pointer"
            >
              <span className="text-[#52736B] block text-[11px]">Antrean Resep Farmasi</span>
              <span className="font-bold text-[#0F2922] dark:text-white font-mono">
                {pendingPharmacy} resep aktif
              </span>
            </button>
            <button
              type="button"
              onClick={() => onNavigateModule('LABORATORIUM')}
              className="p-2.5 rounded-xl bg-[#F3F8F6] dark:bg-[#081916] text-left hover:border-[#00897B] border border-transparent cursor-pointer"
            >
              <span className="text-[#52736B] block text-[11px]">Laboratorium Patologi</span>
              <span className="font-bold text-[#0F2922] dark:text-white font-mono">
                {pendingLab} spesimen aktif
              </span>
            </button>
          </div>
        </div>

        {/* Right 7 Columns: Single Main Chart on Ringkasan */}
        <div className="lg:col-span-7 bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-5 flex flex-col justify-between space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-[#0F2922] dark:text-white">
                Tren penerimaan layanan
              </h2>
              <p className="text-xs text-[#52736B] dark:text-[#86B5A9] mt-0.5 font-mono">
                {formatRupiah(totalRevenue)} · Piutang {formatRupiah(pendingReceivables)}
              </p>
            </div>

            {canAccessOwnerFinance && (
              <button
                type="button"
                onClick={() => onNavigateModule('KEUANGAN_OWNER')}
                className="px-3 py-1.5 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] text-xs font-semibold text-[#00897B] hover:bg-[#EBF4F1] transition-colors cursor-pointer"
              >
                Buka Arus Kas &amp; Laba Rugi &rarr;
              </button>
            )}
          </div>

          <KpiSparklineCanvas
            series={recentCashSeries}
            defaultMode="MASUK"
            compact
            title="Perkembangan Penerimaan Harian"
            subtitle="Persentase kenaikan/penurunan arus kas masuk 12 hari terakhir"
          />
        </div>
      </div>

      {/* Live Polyclinic & IGD Queue Table */}
      <section className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E2ECE8] dark:border-[#183831] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-bold text-[#0F2922] dark:text-white">
                Antrean Poliklinik &amp; Rekam Medis Hari Ini • {filteredVisits.length}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <DataExportToolbar
                title="Ringkasan Antrean & Kunjungan Layanan"
                subtitle={`Fasilitas: ${activeFacility.name} • ${activeFacility.code}`}
                filenameBase={`KAEL_Antrean_Layanan_${activeFacility.code}`}
                facilityName={activeFacility.name}
                facilityCode={activeFacility.code}
                columns={visitExportColumns}
                rows={filteredVisits}
                compact
                contextLabel="Ekspor Tabel Antrean"
              />
              <button
                type="button"
                onClick={() => onNavigateModule('PENDAFTARAN')}
                className="text-xs font-semibold text-[#00897B] hover:underline flex items-center gap-1 cursor-pointer"
              >
                Kelola Pendaftaran &amp; Antrean
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 pt-1">
            <div className="sm:col-span-6 relative">
              <Search className="w-3.5 h-3.5 text-[#52736B] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={queueSearch}
                onChange={(e) => setQueueSearch(e.target.value)}
                placeholder="Cari nama pasien, No. RM, nomor antrean, dokter..."
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
              />
            </div>
            <div className="sm:col-span-3">
              <select
                aria-label="Filter Poliklinik Dashboard"
                value={poliFilter}
                onChange={(e) => setPoliFilter(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
              >
                <option value="ALL">Semua Unit / Poli</option>
                {(
                  activeFacility.polyclinics || [
                    'POLI_UMUM',
                    'POLI_GIGI',
                    'POLI_KIA_KB',
                    'POLI_ANAK',
                    'POLI_PENYAKIT_DALAM',
                    'IGD',
                  ]
                ).map((poly: string) => (
                  <option key={poly} value={poly}>
                    {poly}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-3">
              <select
                aria-label="Filter Status Antrean Dashboard"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
              >
                <option value="ALL">Semua Status</option>
                <option value="MENUNGGU">Menunggu Skrining</option>
                <option value="DIPERIKSA_PERAWAT">Diperiksa Perawat / Bidan</option>
                <option value="DIPERIKSA_DOKTER">Diperiksa Dokter</option>
                <option value="FARMASI_LAB">Di Apotek / Lab</option>
                <option value="KASIR">Menunggu Kasir</option>
                <option value="SELESAI">Selesai</option>
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#EAF3F0] dark:bg-[#0F2D27] text-[#52736B] dark:text-[#86B5A9] border-b border-[#E2ECE8] dark:border-[#183831]">
                <th className="py-3 px-4 font-semibold">No. Antrean</th>
                <th className="py-3 px-4 font-semibold">Pasien &amp; No. RM</th>
                <th className="py-3 px-4 font-semibold">Unit / Dokter</th>
                <th className="py-3 px-4 font-semibold">Tanda Vital &amp; Triase</th>
                <th className="py-3 px-4 font-semibold">Tahap Layanan</th>
                <th className="py-3 px-4 font-semibold text-right">Tindakan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2ECE8] dark:divide-[#183831]">
              {filteredVisits.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[#52736B]">
                    Tidak ada antrean kunjungan yang cocok dengan filter saat ini.
                  </td>
                </tr>
              ) : (
                filteredVisits.map((visit) => (
                  <tr
                    key={visit.id}
                    className="hover:bg-[#F3F8F6] dark:hover:bg-[#0F2B25] transition-colors"
                  >
                    <td className="py-3 px-4 font-mono font-semibold text-[#00897B] whitespace-nowrap">
                      <div>{visit.queueNumber}</div>
                      <div className="text-[11px] font-normal text-[#52736B]">
                        {visit.guarantor.replace(/_/g, ' ')}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-[#0F2922] dark:text-white">
                        {visit.patientName} · {visit.gender}
                      </div>
                      <div className="text-[11px] font-mono text-[#52736B]">
                        {visit.mrNumber} · NIK {visit.nik.slice(0, 6)}***
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-[#0F2922] dark:text-white">
                        {visit.polyclinic.replace(/_/g, ' ')}
                      </div>
                      <div className="text-[11px] text-[#52736B] truncate max-w-[180px]">
                        {visit.doctorName}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px]">
                      <div className="text-[#0F2922] dark:text-white">
                        TD {visit.vitals.systolic}/{visit.vitals.diastolic} · HR{' '}
                        {visit.vitals.heartRate} · {visit.vitals.temperature}°C
                      </div>
                      <div className="text-[#00897B] font-semibold">
                        {visit.triageLevel.replace(/_/g, ' ')}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-[#0F2922] dark:text-white whitespace-nowrap">
                      {visit.status.replace(/_/g, ' ')}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onOpenVisitInRme(visit)}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#00897B] hover:bg-[#00796B] text-white transition-colors cursor-pointer"
                      >
                        Periksa RME
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
