import React, { useMemo, useState } from 'react';
import { ArrowRight, ArrowUpRight, Search } from 'lucide-react';
import { ModuleKey, VisitQueueItem } from '../domain/simrs.ts';
import { WorkspacePayload } from '../utils/apiClient';
import {
  buildCashflowTimeSeries,
  canUserAccessModule,
  formatRupiah,
  getInvoiceOutstanding,
} from '../domain/clinicalLogic.ts';
import {
  buildDefaultFacilityConfigSnapshot,
} from '../domain/platformEngine.ts';
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
    pharmacyOrders,
    labOrders,
    invoices,
    accountingEntries,
  } = workspace;

  const [queueSearch, setQueueSearch] = useState('');
  const [poliFilter, setPoliFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const todayKey = new Date().toLocaleDateString('sv-SE');

  const activeConfig = useMemo(
    () =>
      workspace.activeFacilityConfig ||
      buildDefaultFacilityConfigSnapshot(activeFacility),
    [workspace.activeFacilityConfig, activeFacility]
  );

  const todaysVisits = visits.filter((visit) => new Date(visit.createdAt).toLocaleDateString('sv-SE') === todayKey);
  const hasAnyModule = (modules: ModuleKey[]) => modules.some((module) => canUserAccessModule(user, module));
  const canReadPatients = workspace.dataAccess?.patients ?? hasAnyModule(['PENDAFTARAN', 'SEMUA_PASIEN', 'RME_DOKTER', 'IGD_TRIASE_EWS', 'RAWAT_INAP', 'LABORATORIUM', 'RADIOLOGI_RIS', 'KASIR_AKUNTANSI']);
  const canReadQueue = workspace.dataAccess?.visits ?? hasAnyModule(['PENDAFTARAN', 'SEMUA_PASIEN', 'RME_DOKTER', 'IGD_TRIASE_EWS', 'JADWAL_DOKTER', 'RAWAT_INAP', 'LABORATORIUM', 'APOTEK', 'KASIR_AKUNTANSI']);
  const canReadBeds = workspace.dataAccess?.beds ?? hasAnyModule(['RAWAT_INAP']);
  const canReadFinance = workspace.dataAccess?.accountingEntries ?? hasAnyModule(['KASIR_AKUNTANSI', 'KEUANGAN_OWNER', 'NERACA_GL', 'KLAIM_BPJS_PIUTANG', 'JASA_MEDIS_REMUN']);
  const canReadPharmacy = workspace.dataAccess?.pharmacyOrders ?? hasAnyModule(['APOTEK', 'KATALOG_OPNAME', 'MUTASI_STOK', 'PENGADAAN_PBF', 'RME_DOKTER']);
  const canReadLaboratory = workspace.dataAccess?.labOrders ?? hasAnyModule(['LABORATORIUM', 'RME_DOKTER']);
  const polyclinicOptions = useMemo(() => Array.from(new Set([
    ...(activeFacility.polyclinics || []),
    ...activeConfig.units.filter((unit) => unit.active && ['RUANG_PRAKTIK', 'POLIKLINIK_SPESIALIS', 'IGD'].includes(unit.unitType)).map((unit) => unit.unitCode),
    ...visits.map((visit) => visit.polyclinic),
    ...workspace.doctors.map((doctor) => doctor.polyclinic || ''),
  ].filter(Boolean))).sort((left, right) => left.localeCompare(right)), [activeFacility.polyclinics, activeConfig.units, visits, workspace.doctors]);

  const activeQueueCount = todaysVisits.filter(
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
    .filter((i) => i.status !== 'LUNAS' && i.pricingStatus !== 'PENDING')
    .reduce((sum, i) => sum + getInvoiceOutstanding(i), 0);

  const recentCashSeries = useMemo(
    () => buildCashflowTimeSeries(accountingEntries, 12),
    [accountingEntries]
  );

  const filteredVisits = useMemo(() => {
    const q = queueSearch.trim().toLowerCase();
    return todaysVisits.filter((v) => {
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
  }, [visits, todayKey, queueSearch, poliFilter, statusFilter]);

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
    <div className="min-w-0 space-y-3">
      {/* Top Page Title */}
      <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-[#0F2922] dark:text-white tracking-tight">Ringkasan operasional</h1>
          <p className="mt-0.5 text-sm text-[#52736B] dark:text-[#86B5A9]">Selamat datang, {user.username} di {activeFacility.name}</p>
        </div>
        {canUserAccessModule(user, 'LAPORAN_REGULASI') && <button type="button" onClick={() => onNavigateModule('LAPORAN_REGULASI')} className="inline-flex items-center gap-1.5 rounded-lg border border-[#D5E3DF] dark:border-[#1E473F] bg-white dark:bg-[#0B211D] px-3 py-2 text-xs font-semibold text-[#00897B]">Indikator dan pelaporan<ArrowRight className="h-3.5 w-3.5" /></button>}
      </div>

      {/* 4 Clean White KPI Cards (Pure Numeric & Actionable — No Mini Charts) */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <button
          type="button"
          onClick={() => onNavigateModule('SEMUA_PASIEN')}
          disabled={!canUserAccessModule(user, 'SEMUA_PASIEN')}
          className="disabled:cursor-not-allowed disabled:opacity-60 text-left bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] hover:border-[#00897B] rounded-xl p-3 sm:p-4 min-w-0 transition-all cursor-pointer"
        >
          <div className="text-xs text-[#52736B] dark:text-[#86B5A9]">Pasien terdaftar</div>
          <div className="text-2xl font-bold text-[#0F2922] dark:text-white mt-1 font-mono">
            {canReadPatients ? patients.length : 'Akses terbatas'}
          </div>
          <div className="text-xs text-[#52736B] dark:text-[#86B5A9] mt-1">
            Lihat daftar pasien
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateModule('PENDAFTARAN')}
          disabled={!canUserAccessModule(user, 'PENDAFTARAN')}
          className="disabled:cursor-not-allowed disabled:opacity-60 text-left bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] hover:border-[#00897B] rounded-xl p-3 sm:p-4 min-w-0 transition-all cursor-pointer"
        >
          <div className="text-xs text-[#52736B] dark:text-[#86B5A9]">Menunggu layanan</div>
          <div className="text-2xl font-bold text-[#0F2922] dark:text-white mt-1 font-mono">
            {canReadQueue ? activeQueueCount : 'Akses terbatas'}
          </div>
          <div className="text-xs text-[#52736B] dark:text-[#86B5A9] mt-1">
            {canReadQueue ? `Dari ${todaysVisits.length} kunjungan hari ini` : 'Peran ini tidak memiliki akses data kunjungan'}
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateModule('RAWAT_INAP')}
          disabled={!canUserAccessModule(user, 'RAWAT_INAP')}
          className="disabled:cursor-not-allowed disabled:opacity-60 text-left bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] hover:border-[#00897B] rounded-xl p-3 sm:p-4 min-w-0 transition-all cursor-pointer"
        >
          <div className="text-xs text-[#52736B] dark:text-[#86B5A9]">
            Tempat tidur tersedia
          </div>
          <div className="text-2xl font-bold text-[#0F2922] dark:text-white mt-1 font-mono">
            {canReadBeds ? availableBedsCount : 'Akses terbatas'}
          </div>
          <div className="text-xs text-[#52736B] dark:text-[#86B5A9] mt-1">
            {canReadBeds ? `Total kapasitas ${beds.length} bed` : 'Peran ini tidak memiliki akses data rawat inap'}
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateModule('RAWAT_INAP')}
          disabled={!canUserAccessModule(user, 'RAWAT_INAP')}
          className="disabled:cursor-not-allowed disabled:opacity-60 text-left bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] hover:border-[#00897B] rounded-xl p-3 sm:p-4 min-w-0 transition-all cursor-pointer"
        >
          <div className="text-xs text-[#52736B] dark:text-[#86B5A9]">Tempat tidur terisi</div>
          <div className="text-2xl font-bold text-[#0F2922] dark:text-white mt-1 font-mono">
            {canReadBeds ? occupiedBedsCount : 'Akses terbatas'}
          </div>
          <div className="text-xs text-[#52736B] dark:text-[#86B5A9] mt-1">
            {canReadBeds ? 'Tempat tidur berstatus terisi saat ini' : 'Peran ini tidak memiliki akses data rawat inap'}
          </div>
        </button>
      </div>


      {/* Live Polyclinic & IGD Queue Table */}
      <section className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-xl min-w-0">
        <div className="p-3 sm:p-4 border-b border-[#E2ECE8] dark:border-[#183831] space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-[#0F2922] dark:text-white">
                Antrean hari ini {canReadQueue ? `(${filteredVisits.length})` : ''}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <DataExportToolbar
                title="Ringkasan Antrean & Kunjungan Layanan"
                subtitle={activeFacility.name}
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
          disabled={!canUserAccessModule(user, 'PENDAFTARAN')}
                className="text-xs font-semibold text-[#00897B] hover:underline flex items-center gap-1 cursor-pointer"
              >
                Kelola Pendaftaran &amp; Antrean
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-field-min-inline-size)),1fr))] gap-2.5 pt-1">
            <div className="relative min-w-0">
              <Search className="w-3.5 h-3.5 text-[#52736B] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={queueSearch}
                onChange={(e) => setQueueSearch(e.target.value)}
                placeholder="Cari nama pasien, No. RM, nomor antrean, dokter..."
                className="min-w-0 w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
              />
            </div>
            <div className="min-w-0">
              <select
                aria-label="Filter Poliklinik Dashboard"
                value={poliFilter}
                onChange={(e) => setPoliFilter(e.target.value)}
                className="min-w-0 w-full px-3 py-2 text-xs rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
              >
                <option value="ALL">Semua Unit / Poli</option>
                {polyclinicOptions.map((poly) => (
                  <option key={poly} value={poly}>{poly.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div className="min-w-0">
              <select
                aria-label="Filter Status Antrean Dashboard"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="min-w-0 w-full px-3 py-2 text-xs rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
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

        <div className="min-w-0 w-full overflow-x-auto rounded-b-xl">
          <table className="w-full min-w-full table-auto [&_th]:whitespace-nowrap text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#EAF3F0] dark:bg-[#0F2D27] text-[#52736B] dark:text-[#86B5A9] border-b border-[#E2ECE8] dark:border-[#183831]">
                <th className="py-2.5 px-3 font-semibold">No. Antrean</th>
                <th className="py-2.5 px-3 font-semibold">Pasien &amp; No. RM</th>
                <th className="py-2.5 px-3 font-semibold">Unit / Dokter</th>
                <th className="py-2.5 px-3 font-semibold">Tanda Vital &amp; Triase</th>
                <th className="py-2.5 px-3 font-semibold">Tahap Layanan</th>
                <th className="py-2.5 px-3 font-semibold text-right">Tindakan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2ECE8] dark:divide-[#183831]">
              {filteredVisits.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-5 px-4 text-center text-[#52736B]">
                    {canReadQueue ? 'Tidak ada kunjungan hari ini yang cocok dengan filter saat ini.' : 'Data antrean tidak tersedia untuk izin akun ini.'}
                  </td>
                </tr>
              ) : (
                filteredVisits.map((visit) => (
                  <tr
                    key={visit.id}
                    className="hover:bg-[#F3F8F6] dark:hover:bg-[#0F2B25] transition-colors"
                  >
                    <td className="py-2.5 px-3 font-mono font-semibold text-[#00897B] whitespace-nowrap">
                      <div>{visit.queueNumber}</div>
                      <div className="text-caption font-normal text-[#52736B]">
                        {visit.guarantor.replace(/_/g, ' ')}
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-[#0F2922] dark:text-white">
                        {visit.patientName} · {visit.gender}
                      </div>
                      <div className="text-caption font-mono text-[#52736B] whitespace-nowrap">
                        {visit.mrNumber} · NIK {visit.nik.slice(0, 6)}***
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-[#0F2922] dark:text-white">
                        {visit.polyclinic.replace(/_/g, ' ')}
                      </div>
                      <div className="text-caption text-[#52736B] whitespace-normal">
                        {visit.doctorName}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-caption whitespace-nowrap">
                      <div className="text-[#0F2922] dark:text-white">
                        TD {visit.vitals.systolic}/{visit.vitals.diastolic} · HR{' '}
                        {visit.vitals.heartRate} · {visit.vitals.temperature}°C
                      </div>
                      <div className="text-[#00897B] font-semibold">
                        {visit.triageLevel.replace(/_/g, ' ')}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-caption text-[#0F2922] dark:text-white whitespace-nowrap">
                      {visit.status.replace(/_/g, ' ')}
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onOpenVisitInRme(visit)}
                        disabled={!canUserAccessModule(user, 'RME_DOKTER')}
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
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-form-min-inline-size)),1fr))] gap-3 min-w-0">
        <section className="min-w-0 bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-bold text-[#0F2922] dark:text-white">Pintasan layanan</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {([
              { module: 'RME_DOKTER', label: 'Pemeriksaan SOAP dan RME' },
              { module: 'PENDAFTARAN', label: 'Pendaftaran dan antrean' },
              { module: 'SEMUA_PASIEN', label: 'Direktori pasien' },
            ] as const).map((action) => <button key={action.module} type="button" onClick={() => onNavigateModule(action.module)} disabled={!canUserAccessModule(user, action.module)} className="min-w-0 text-left px-3 py-2 rounded-lg border border-[#D5E3DF] dark:border-[#1E473F] text-xs font-semibold text-[#0F2922] dark:text-white hover:bg-[#EBF4F1] disabled:opacity-50 disabled:cursor-not-allowed">{action.label}</button>)}
          </div>
          <div className="grid grid-cols-2 gap-2 border-t border-[#E2ECE8] dark:border-[#183831] pt-3 text-xs">
            <button type="button" onClick={() => onNavigateModule('APOTEK')} disabled={!canUserAccessModule(user, 'APOTEK')} className="min-w-0 text-left rounded-lg bg-[#F3F8F6] dark:bg-[#081916] px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed"><span className="block text-[#52736B]">Resep farmasi</span><strong>{canReadPharmacy ? `${pendingPharmacy} aktif` : 'Akses terbatas'}</strong></button>
            <button type="button" onClick={() => onNavigateModule('LABORATORIUM')} disabled={!canUserAccessModule(user, 'LABORATORIUM')} className="min-w-0 text-left rounded-lg bg-[#F3F8F6] dark:bg-[#081916] px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed"><span className="block text-[#52736B]">Spesimen laboratorium</span><strong>{canReadLaboratory ? `${pendingLab} aktif` : 'Akses terbatas'}</strong></button>
          </div>
        </section>

        {/* Right 7 Columns: Single Main Chart on Ringkasan */}
        <div className="min-w-0 bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-[#0F2922] dark:text-white">
                Tren penerimaan layanan
              </h2>
              <p className="text-xs text-[#52736B] dark:text-[#86B5A9] mt-0.5 font-mono">
                {canReadFinance ? `${formatRupiah(totalRevenue)} · Piutang ${formatRupiah(pendingReceivables)}` : 'Peran ini tidak memiliki akses data keuangan'}
              </p>
            </div>

            {canAccessOwnerFinance && (
              <button
                type="button"
                onClick={() => onNavigateModule('KEUANGAN_OWNER')}
          disabled={!canUserAccessModule(user, 'KEUANGAN_OWNER')}
                className="px-3 py-1.5 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] text-xs font-semibold text-[#00897B] hover:bg-[#EBF4F1] transition-colors cursor-pointer"
              >
                Buka transaksi keuangan
              </button>
            )}
          </div>

          {canReadFinance && accountingEntries.length > 0 ? <KpiSparklineCanvas
            series={recentCashSeries}
            defaultMode="MASUK"
            compact
            title="Perkembangan Penerimaan Harian"
            subtitle="Penerimaan yang tercatat selama 12 hari terakhir"
          /> : <p className="text-sm text-[#52736B] dark:text-[#86B5A9] py-4 text-center">{canReadFinance ? 'Belum ada transaksi penerimaan tercatat.' : 'Data keuangan tidak tersedia untuk izin akun ini.'}</p>}
        </div>
      </div>

    </div>
  );
};
