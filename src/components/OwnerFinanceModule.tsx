import React, { useMemo, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  FileSpreadsheet,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Stethoscope,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import { AccountingEntry, InvoiceRecord, ModuleKey } from '../types/simrs';
import { kaelApi, WorkspacePayload } from '../utils/apiClient';
import {
  buildCashflowTimeSeries,
  calculateFinancialSummary,
  calculateSparklineMetrics,
  formatRupiah,
  formatRupiahDecimals,
} from '../utils/clinicalLogic';
import { computeErpCompleteFinancialAnalysis } from '../utils/platformEngine';
import { DataExportToolbar } from './DataExportToolbar';
import { KpiSparklineCanvas } from './KpiSparklineChart';
import { ExportColumn } from '../utils/exportDocument';

interface OwnerFinanceModuleProps {
  token: string;
  facilityCode: string;
  workspace: WorkspacePayload;
  initialView?: ModuleKey;
  onRefreshWorkspace: () => Promise<void>;
}

export const OwnerFinanceModule: React.FC<OwnerFinanceModuleProps> = ({
  token,
  facilityCode,
  workspace,
  initialView = 'KEUANGAN_OWNER',
  onRefreshWorkspace,
}) => {
  const [subTab, setSubTab] = useState<
    'ARUS_KAS' | 'CATATAN_TRANSAKSI' | 'PIUTANG_KLAIM' | 'JASA_MEDIS'
  >(() => {
    if (initialView === 'NERACA_GL') return 'CATATAN_TRANSAKSI';
    if (initialView === 'KLAIM_BPJS_PIUTANG') return 'PIUTANG_KLAIM';
    if (initialView === 'JASA_MEDIS_REMUN') return 'JASA_MEDIS';
    return 'ARUS_KAS';
  });
  const [scopeMode, setScopeMode] = useState<'ACTIVE_FACILITY' | 'ALL_OWNED'>('ACTIVE_FACILITY');

  // Filters for Ledger & Claims
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'PENDAPATAN' | 'PENGELUARAN'>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [guarantorFilter, setGuarantorFilter] = useState<string>('ALL');
  const [claimStatusFilter, setClaimStatusFilter] = useState<
    'ALL' | 'PENDING_ONLY' | 'LUNAS_ONLY'
  >('ALL');

  // Doctor Fee-for-Service Share Rate (%)
  const [doctorSharePercent, setDoctorSharePercent] = useState<number>(40);

  // Manual Journal Entry Form State
  const [showAddJournal, setShowAddJournal] = useState(false);
  const [jrnType, setJrnType] = useState<'PENDAPATAN' | 'PENGELUARAN'>('PENGELUARAN');
  const [jrnCategory, setJrnCategory] = useState<AccountingEntry['category']>('OPERASIONAL');
  const [jrnAccountCode, setJrnAccountCode] = useState('5-3010');
  const [jrnAccountName, setJrnAccountName] = useState('Beban Operasional & Utilitas Faskes');
  const [jrnDesc, setJrnDesc] = useState('');
  const [jrnAmount, setJrnAmount] = useState<number>(500000);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const allowedRoles = ['OWNER', 'SUPERUSER', 'MANAJER_KLINIK', 'KASIR'];
  const hasAccess =
    allowedRoles.includes(workspace.user.role) ||
    workspace.user.customPrivileges?.includes('KEUANGAN_OWNER') ||
    workspace.user.customPrivileges?.includes('NERACA_GL') ||
    workspace.user.customPrivileges?.includes('KLAIM_BPJS_PIUTANG') ||
    workspace.user.customPrivileges?.includes('JASA_MEDIS_REMUN');

  const rawEntries = useMemo(() => {
    if (scopeMode === 'ALL_OWNED' && workspace.multiFacilityFinance) {
      return workspace.multiFacilityFinance.accountingEntries;
    }
    return workspace.accountingEntries;
  }, [scopeMode, workspace.accountingEntries, workspace.multiFacilityFinance]);

  const rawInvoices = useMemo(() => {
    if (scopeMode === 'ALL_OWNED' && workspace.multiFacilityFinance) {
      return workspace.multiFacilityFinance.invoices;
    }
    return workspace.invoices;
  }, [scopeMode, workspace.invoices, workspace.multiFacilityFinance]);

  const summary = useMemo(
    () => calculateFinancialSummary(rawEntries, rawInvoices),
    [rawEntries, rawInvoices]
  );

  const erpAnalysis = useMemo(
    () =>
      computeErpCompleteFinancialAnalysis({
        accountingEntries: rawEntries,
        invoices: rawInvoices,
        medications: workspace.medications || [],
        mutations: workspace.medicationMutations || [],
        purchaseOrders: workspace.purchaseOrders || [],
        visits: workspace.visits || [],
        doctorSharePercent,
      }),
    [
      rawEntries,
      rawInvoices,
      workspace.medications,
      workspace.medicationMutations,
      workspace.purchaseOrders,
      workspace.visits,
      doctorSharePercent,
    ]
  );

  // 12-Day Cashflow Time Series for Single Main KPI Sparkline Chart
  const cashflowSeries = useMemo(
    () => buildCashflowTimeSeries(rawEntries, 12),
    [rawEntries]
  );

  const masukMetrics = useMemo(
    () => calculateSparklineMetrics(cashflowSeries.map((c) => c.masuk)),
    [cashflowSeries]
  );
  const keluarMetrics = useMemo(
    () => calculateSparklineMetrics(cashflowSeries.map((c) => c.keluar)),
    [cashflowSeries]
  );
  const netoMetrics = useMemo(
    () => calculateSparklineMetrics(cashflowSeries.map((c) => c.neto)),
    [cashflowSeries]
  );

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rawEntries.filter((entry) => {
      if (typeFilter !== 'ALL' && entry.type !== typeFilter) return false;
      if (categoryFilter !== 'ALL' && entry.category !== categoryFilter) return false;
      if (q) {
        const hay = `${entry.entryNumber} ${entry.accountCode} ${entry.accountName} ${entry.description} ${entry.referenceId} ${entry.facilityCode}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rawEntries, typeFilter, categoryFilter, searchQuery]);

  const filteredClaims = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rawInvoices.filter((inv) => {
      if (claimStatusFilter === 'PENDING_ONLY' && inv.status === 'LUNAS') return false;
      if (claimStatusFilter === 'LUNAS_ONLY' && inv.status !== 'LUNAS') return false;
      if (guarantorFilter !== 'ALL' && inv.guarantor !== guarantorFilter) return false;
      if (q) {
        const hay = `${inv.invoiceNumber} ${inv.patientName} ${inv.mrNumber} ${inv.guarantor}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rawInvoices, claimStatusFilter, guarantorFilter, searchQuery]);

  const facilityComparison = useMemo(() => {
    const allEntries =
      workspace.multiFacilityFinance?.accountingEntries || workspace.accountingEntries;
    const allInvs = workspace.multiFacilityFinance?.invoices || workspace.invoices;
    const allVis = workspace.multiFacilityFinance?.visits || workspace.visits;

    return workspace.accessibleFacilities.map((fac) => {
      const fEntries = allEntries.filter((e) => e.facilityCode === fac.code);
      const fInvs = allInvs.filter((i) => i.facilityCode === fac.code);
      const fVisits = allVis.filter((v) => v.facilityCode === fac.code);
      const fSummary = calculateFinancialSummary(fEntries, fInvs);
      return {
        facility: fac,
        visitCount: fVisits.length,
        ...fSummary,
      };
    });
  }, [workspace]);

  const doctorFeeSummaries = useMemo(() => {
    return workspace.doctors.map((doc) => {
      const docVisits = workspace.visits.filter((v) => v.doctorId === doc.id);
      const docVisitIds = new Set(docVisits.map((v) => v.id));
      const docInvoices = workspace.invoices.filter((inv) => docVisitIds.has(inv.visitId));

      let medicalServiceRevenue = 0;
      for (const inv of docInvoices) {
        for (const item of inv.items) {
          if (item.category === 'KONSULTASI' || item.category === 'TINDAKAN') {
            medicalServiceRevenue += item.subtotal;
          }
        }
      }
      if (medicalServiceRevenue === 0 && docVisits.length > 0) {
        medicalServiceRevenue = docVisits.length * 75000;
      }

      const estimatedFee = Math.round((medicalServiceRevenue * doctorSharePercent) / 100);
      const pph21Deduction = Math.round(estimatedFee * 0.025);
      const netTakeHomeFee = estimatedFee - pph21Deduction;
      return {
        doctor: doc,
        visitCount: docVisits.length,
        medicalServiceRevenue,
        estimatedFee,
        pph21Deduction,
        netTakeHomeFee,
      };
    });
  }, [workspace.doctors, workspace.visits, workspace.invoices, doctorSharePercent]);

  if (!hasAccess) {
    return (
      <div className="bg-white dark:bg-[#0B211D] border border-red-200 dark:border-red-900 rounded-2xl p-8 text-center">
        <Lock className="w-8 h-8 text-red-600 mx-auto mb-2" />
        <h2 className="text-base font-bold text-[#0F2922] dark:text-white">
          Menu Khusus Manajemen Keuangan &amp; ERP
        </h2>
        <p className="text-xs text-[#52736B] mt-1">
          Laporan arus kas, neraca, rekonsiliasi klaim BPJS, dan remunerasi jasa medis memerlukan otorisasi Owner, Manajer, Kasir, atau Superuser.
        </p>
      </div>
    );
  }

  const handleCreateJournalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jrnDesc.trim() || jrnAmount <= 0) return;
    setFeedback(null);
    setIsSubmitting(true);
    try {
      const created = await kaelApi.createAccountingEntry(token, facilityCode, {
        accountCode: jrnAccountCode,
        accountName: jrnAccountName,
        type: jrnType,
        category: jrnCategory,
        description: jrnDesc.trim(),
        amount: Number(jrnAmount),
      });
      setJrnDesc('');
      setShowAddJournal(false);
      await onRefreshWorkspace();
      setFeedback({
        type: 'success',
        text: `Transaksi ${created.entryNumber} sebesar ${formatRupiah(
          created.amount
        )} berhasil dicatat ke Jurnal Keuangan ${facilityCode}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal mencatat jurnal keuangan.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReconcileClaim = async (inv: InvoiceRecord) => {
    setFeedback(null);
    setIsSubmitting(true);
    try {
      const res = await kaelApi.reconcileFinanceClaim(token, inv.facilityCode, inv.id);
      await onRefreshWorkspace();
      setFeedback({
        type: 'success',
        text: `Klaim ${res.invoice.invoiceNumber} atas nama ${
          res.invoice.patientName
        } sebesar ${formatRupiah(
          res.entry.amount
        )} telah dicairkan dan masuk ke Jurnal Kas ${res.entry.entryNumber}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal mencairkan klaim/piutang.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePayDoctorFee = async (
    doctorName: string,
    nipOrSip: string,
    amount: number,
    visitCount: number
  ) => {
    if (amount <= 0) return;
    setFeedback(null);
    setIsSubmitting(true);
    try {
      const created = await kaelApi.createAccountingEntry(token, facilityCode, {
        accountCode: '5-1020',
        accountName: 'Beban Bagi Hasil & Jasa Medis Dokter',
        type: 'PENGELUARAN',
        category: 'JASA_MEDIS',
        description: `Pembayaran Jasa Medis ${doctorSharePercent}% — ${doctorName} • ${visitCount} kunjungan`,
        amount,
        referenceId: `JM-${nipOrSip.slice(0, 8)}`,
      });
      await onRefreshWorkspace();
      setFeedback({
        type: 'success',
        text: `Pembayaran Jasa Medis ${doctorName} sebesar ${formatRupiah(
          amount
        )} berhasil dicatat pada jurnal ${created.entryNumber}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal mencatat pembayaran jasa medis.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const journalExportColumns: ExportColumn<AccountingEntry>[] = [
    { key: 'entryNumber', header: 'No. Jurnal' },
    {
      key: 'timestamp',
      header: 'Waktu Pencatatan',
      format: (r) => r.timestamp.slice(0, 16).replace('T', ' '),
    },
    { key: 'facilityCode', header: 'Fasilitas' },
    { key: 'accountCode', header: 'Kode COA' },
    { key: 'accountName', header: 'Nama Akun' },
    { key: 'type', header: 'Jenis Arus Kas' },
    { key: 'category', header: 'Kategori' },
    { key: 'description', header: 'Uraian Transaksi' },
    { key: 'amount', header: 'Nominal IDR' },
  ];

  const pageTitle =
    subTab === 'CATATAN_TRANSAKSI'
      ? 'Neraca & buku besar umum'
      : subTab === 'PIUTANG_KLAIM'
      ? 'Klaim BPJS, selisih tarif & umur piutang'
      : subTab === 'JASA_MEDIS'
      ? 'Jasa medis & remunerasi dokter'
      : 'Arus kas, HPP & laba rugi';

  return (
    <div className="space-y-5">
      {/* Top Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#52736B] dark:text-[#86B5A9]">
            {scopeMode === 'ALL_OWNED'
              ? `KONSOLIDASI ${workspace.accessibleFacilities.length} FASILITAS`
              : workspace.activeFacility.name.toUpperCase()}
          </p>
          <h1 className="text-2xl font-bold text-[#0F2922] dark:text-white tracking-tight mt-0.5">
            {pageTitle}
          </h1>
          <p className="text-xs text-[#52736B] dark:text-[#86B5A9] mt-0.5">
            Akuntansi berpasangan double-entry • kalkulasi HPP, margin laba, umur piutang, dan selisih tarif klaim.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {workspace.accessibleFacilities.length > 1 && (
            <div className="inline-flex items-center bg-white dark:bg-[#0B211D] p-1 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F]">
              <button
                type="button"
                onClick={() => setScopeMode('ACTIVE_FACILITY')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  scopeMode === 'ACTIVE_FACILITY'
                    ? 'bg-[#00897B] text-white'
                    : 'text-[#52736B] hover:text-[#0F2922] dark:hover:text-white'
                }`}
              >
                {facilityCode}
              </button>
              <button
                type="button"
                onClick={() => setScopeMode('ALL_OWNED')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  scopeMode === 'ALL_OWNED'
                    ? 'bg-[#00897B] text-white'
                    : 'text-[#52736B] hover:text-[#0F2922] dark:hover:text-white'
                }`}
              >
                Konsolidasi {workspace.accessibleFacilities.length} Faskes
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowAddJournal((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#00897B] hover:bg-[#00796B] text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Catat Transaksi Kas</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          role="status"
          className={`p-3.5 rounded-xl border text-xs font-medium flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-[#E6F4F1] dark:bg-[#0F3D35] border-[#B2DFDB] dark:border-[#1E564B] text-[#00695C] dark:text-[#80CBC4]'
              : 'bg-red-50 dark:bg-red-950/60 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-current opacity-75 hover:opacity-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Manual Journal Entry Form */}
      {showAddJournal && (
        <form
          onSubmit={handleCreateJournalSubmit}
          className="bg-white dark:bg-[#0B211D] border border-[#00897B] rounded-2xl p-5 space-y-4 shadow-sm"
        >
          <div className="flex items-center justify-between border-b border-[#E2ECE8] dark:border-[#183831] pb-3">
            <div>
              <h3 className="text-sm font-bold text-[#0F2922] dark:text-white">
                Catat Transaksi Kas Masuk atau Kas Keluar
              </h3>
              <p className="text-xs text-[#52736B]">
                Otomatis memperbarui buku besar double-entry dan laporan arus kas {facilityCode}.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddJournal(false)}
              className="p-1 rounded-lg text-[#52736B] hover:text-[#0F2922]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-6 gap-3 items-end text-xs">
            <div>
              <label className="block font-semibold mb-1">Jenis Arus Kas</label>
              <select
                value={jrnType}
                onChange={(e) => {
                  const t = e.target.value as 'PENDAPATAN' | 'PENGELUARAN';
                  setJrnType(t);
                  if (t === 'PENDAPATAN') {
                    setJrnCategory('LAYANAN_MEDIS');
                    setJrnAccountCode('4-1090');
                    setJrnAccountName('Pendapatan Layanan & Kapitasi Faskes');
                  } else {
                    setJrnCategory('OPERASIONAL');
                    setJrnAccountCode('5-3010');
                    setJrnAccountName('Beban Operasional & Utilitas Faskes');
                  }
                }}
                className="w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
              >
                <option value="PENGELUARAN">KAS KELUAR</option>
                <option value="PENDAPATAN">KAS MASUK</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold mb-1">Kategori Pos</label>
              <select
                value={jrnCategory}
                onChange={(e) =>
                  setJrnCategory(e.target.value as AccountingEntry['category'])
                }
                className="w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
              >
                <option value="OPERASIONAL">OPERASIONAL &amp; UTILITAS</option>
                <option value="PENGADAAN_OBAT">PENGADAAN OBAT &amp; ALKES</option>
                <option value="JASA_MEDIS">JASA MEDIS DOKTER</option>
                <option value="GAJI_SDM">GAJI &amp; TUNJANGAN SDM</option>
                <option value="LAYANAN_MEDIS">LAYANAN MEDIS PASIEN</option>
                <option value="FARMASI">PENJUALAN FARMASI</option>
                <option value="KLAIM_BPJS">PENCAIRAN KLAIM BPJS</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold mb-1">Kode Akun COA</label>
              <input
                type="text"
                value={jrnAccountCode}
                onChange={(e) => setJrnAccountCode(e.target.value)}
                className="w-full px-3 py-2 font-mono rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold mb-1">Uraian Transaksi</label>
              <input
                type="text"
                value={jrnDesc}
                onChange={(e) => setJrnDesc(e.target.value)}
                placeholder="Contoh: Pembelian Reagen Lab / Penerimaan Layanan..."
                required
                className="w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">Nominal IDR</label>
              <input
                type="number"
                min={1}
                value={jrnAmount}
                onChange={(e) => setJrnAmount(Number(e.target.value))}
                required
                className="w-full px-3 py-2 font-mono rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-xl bg-[#00897B] hover:bg-[#00796B] text-white text-xs font-semibold cursor-pointer"
            >
              {isSubmitting ? 'Menyimpan...' : 'Simpan & Posting ke Jurnal'}
            </button>
          </div>
        </form>
      )}

      {/* 4 Clean Numeric Financial Summary Cards (Zero Mini Sparklines — Anti Chart Spam) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#52736B] dark:text-[#86B5A9]">
                Pendapatan Kotor
              </span>
              <span className="px-2 py-0.5 rounded-md bg-[#E4F5EE] dark:bg-[#0F3830] text-[#00796B] dark:text-[#38E8D6] text-xs font-mono font-bold">
                {masukMetrics.formattedPeriodBadge}
              </span>
            </div>
            <div className="text-2xl leading-tight font-bold text-[#0F2922] dark:text-white mt-2 font-mono">
              {formatRupiahDecimals(erpAnalysis.grossRevenue)}
            </div>
          </div>
          <div className="text-[11px] text-[#52736B] dark:text-[#86B5A9] mt-3 flex items-center justify-between font-mono">
            <span>Pendapatan Bersih</span>
            <span>{formatRupiah(erpAnalysis.netRevenue)}</span>
          </div>
        </div>

        <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#52736B] dark:text-[#86B5A9]">
                HPP Layanan &amp; Farmasi
              </span>
              <span className="px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-[#E5B85B] text-xs font-mono font-bold">
                Margin Kotor {erpAnalysis.grossMarginPercent}%
              </span>
            </div>
            <div className="text-2xl leading-tight font-bold text-[#0F2922] dark:text-white mt-2 font-mono">
              {formatRupiahDecimals(erpAnalysis.totalHpp)}
            </div>
          </div>
          <div className="text-[11px] text-[#52736B] dark:text-[#86B5A9] mt-3 flex items-center justify-between font-mono">
            <span>Obat {formatRupiah(erpAnalysis.cogsPharmacy)}</span>
            <span>Jasa {formatRupiah(erpAnalysis.directDoctorFeeExpense)}</span>
          </div>
        </div>

        <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#52736B] dark:text-[#86B5A9]">
                Beban Operasional &amp; Pajak
              </span>
              <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-mono font-bold">
                {keluarMetrics.formattedPeriodBadge}
              </span>
            </div>
            <div className="text-2xl leading-tight font-bold text-[#0F2922] dark:text-white mt-2 font-mono">
              {formatRupiahDecimals(erpAnalysis.operatingExpenses + erpAnalysis.estimatedCorporateTax)}
            </div>
          </div>
          <div className="text-[11px] text-[#52736B] dark:text-[#86B5A9] mt-3 flex items-center justify-between font-mono">
            <span>PPh 21 JM {formatRupiah(erpAnalysis.estimatedDoctorTaxPph21)}</span>
            <span>PPh Badan {formatRupiah(erpAnalysis.estimatedCorporateTax)}</span>
          </div>
        </div>

        <div className="bg-[#08241F] border border-[#144E44] rounded-2xl p-5 text-white shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#A7CEC4]">Laba Bersih &amp; Neto Kas</span>
              <span className="px-2 py-0.5 rounded-md bg-[#114238] text-[#38E8D6] text-xs font-mono font-bold border border-[#1E6B5C]">
                {netoMetrics.formattedPeriodBadge}
              </span>
            </div>
            <div className="text-2xl leading-tight font-bold text-[#E5B85B] mt-2 font-mono">
              {formatRupiahDecimals(summary.netProfit)}
            </div>
          </div>
          <div className="text-[11px] text-[#A7CEC4] mt-3 flex items-center justify-between font-mono">
            <span>EBITDA {formatRupiah(erpAnalysis.ebitda)}</span>
            <span className="text-[#38E8D6] font-bold">
              Net Margin {erpAnalysis.netMarginPercent}%
            </span>
          </div>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setSubTab('ARUS_KAS')}
          className={`px-4 py-2 text-xs font-semibold rounded-xl transition-colors cursor-pointer ${
            subTab === 'ARUS_KAS'
              ? 'bg-[#00897B] text-white'
              : 'bg-white dark:bg-[#0B211D] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
          }`}
        >
          Arus kas, HPP &amp; laba rugi
        </button>
        <button
          type="button"
          onClick={() => setSubTab('CATATAN_TRANSAKSI')}
          className={`px-4 py-2 text-xs font-semibold rounded-xl transition-colors cursor-pointer ${
            subTab === 'CATATAN_TRANSAKSI'
              ? 'bg-[#00897B] text-white'
              : 'bg-white dark:bg-[#0B211D] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
          }`}
        >
          Neraca &amp; buku besar • {rawEntries.length} jurnal
        </button>
        <button
          type="button"
          onClick={() => setSubTab('PIUTANG_KLAIM')}
          className={`px-4 py-2 text-xs font-semibold rounded-xl transition-colors cursor-pointer ${
            subTab === 'PIUTANG_KLAIM'
              ? 'bg-[#00897B] text-white'
              : 'bg-white dark:bg-[#0B211D] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
          }`}
        >
          Klaim BPJS, selisih tarif &amp; piutang
        </button>
        <button
          type="button"
          onClick={() => setSubTab('JASA_MEDIS')}
          className={`px-4 py-2 text-xs font-semibold rounded-xl transition-colors cursor-pointer ${
            subTab === 'JASA_MEDIS'
              ? 'bg-[#00897B] text-white'
              : 'bg-white dark:bg-[#0B211D] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
          }`}
        >
          Jasa medis &amp; remunerasi • {workspace.doctors.length} dokter
        </button>
      </div>

      {/* TAB 1: ARUS KAS, HPP & LABA RUGI (Single Main Chart + Cost Center + Multi-Facility Comparison) */}
      {subTab === 'ARUS_KAS' && (
        <div className="space-y-5">
          <KpiSparklineCanvas
            series={cashflowSeries}
            defaultMode="NETO"
            title="Pergerakan arus kas harian"
            subtitle="Tren kas masuk, kas keluar, dan neto operasional 12 hari terakhir"
          />

          {/* Multi-Facility Performance Comparison Table */}
          <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl overflow-hidden">
            <div className="px-6 py-4 bg-[#F8FBFA] dark:bg-[#081916] border-b border-[#E2ECE8] dark:border-[#183831] flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-[#0F2922] dark:text-white flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-[#00897B]" />
                  Perbandingan Kinerja Keuangan Antar Fasilitas Kesehatan
                </h2>
                <p className="text-xs text-[#52736B]">
                  Rekapitulasi pemasukan, pengeluaran, piutang BPJS, dan neto kas pada setiap fasilitas.
                </p>
              </div>
              <DataExportToolbar
                title="Perbandingan Kinerja Keuangan Antar Fasilitas Kesehatan"
                subtitle={`Pemasukan: ${formatRupiah(summary.totalRevenue)} • Pengeluaran: ${formatRupiah(
                  summary.totalExpense
                )} • Neto: ${formatRupiah(summary.netProfit)}`}
                filenameBase={`KAEL_Rekap_Fasilitas_${facilityCode}`}
                facilityName={workspace.activeFacility.name}
                facilityCode={facilityCode}
                columns={[
                  { key: 'code', header: 'Kode Fasilitas', format: (r) => r.facility.code },
                  { key: 'name', header: 'Nama Fasilitas', format: (r) => r.facility.name },
                  { key: 'visitCount', header: 'Kunjungan' },
                  { key: 'totalRevenue', header: 'Pemasukan IDR' },
                  { key: 'totalExpense', header: 'Pengeluaran IDR' },
                  { key: 'netProfit', header: 'Neto Kas IDR' },
                ]}
                rows={facilityComparison}
                compact
                contextLabel="Ekspor Tabel Kinerja"
              />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#EAF3F0] dark:bg-[#0F2D27] text-[#52736B] dark:text-[#86B5A9] border-b border-[#E2ECE8] dark:border-[#183831]">
                    <th className="py-3 px-4 font-semibold">Kode &amp; Nama Fasilitas</th>
                    <th className="py-3 px-4 font-semibold">Tipe &amp; Kota</th>
                    <th className="py-3 px-4 font-semibold text-right">Kunjungan</th>
                    <th className="py-3 px-4 font-semibold text-right">Pemasukan</th>
                    <th className="py-3 px-4 font-semibold text-right">Pengeluaran</th>
                    <th className="py-3 px-4 font-semibold text-right">Piutang / Klaim</th>
                    <th className="py-3 px-4 font-semibold text-right">Neto Kas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2ECE8] dark:divide-[#183831]">
                  {facilityComparison.map((row) => (
                    <tr
                      key={row.facility.code}
                      className="hover:bg-[#F3F8F6] dark:hover:bg-[#0F2B25]"
                    >
                      <td className="py-3.5 px-4">
                        <div className="font-mono font-bold text-[#00897B]">
                          {row.facility.code}
                        </div>
                        <div className="font-semibold text-[#0F2922] dark:text-white">
                          {row.facility.name}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-[#52736B]">
                        <div>{row.facility.type.replace(/_/g, ' ')}</div>
                        <div className="text-[11px]">{row.facility.city}</div>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-semibold">
                        {row.visitCount} pasien
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-semibold text-[#00897B]">
                        {formatRupiah(row.totalRevenue)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-semibold text-[#B78320] dark:text-[#E5B85B]">
                        {formatRupiah(row.totalExpense)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-[#52736B]">
                        {formatRupiah(row.pendingBpjsClaims + row.unpaidPatientReceivables)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-[#0F2922] dark:text-white">
                        {formatRupiah(row.netProfit)} · {row.profitMarginPercent}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: NERACA BERIMBANG & BUKU BESAR DOUBLE-ENTRY */}
      {subTab === 'CATATAN_TRANSAKSI' && (
        <div className="space-y-5">
          {/* Balanced Balance Sheet (Neraca: Aset == Liabilitas + Ekuitas) */}
          <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2ECE8] dark:border-[#183831] pb-3">
              <div>
                <h2 className="text-sm font-bold text-[#0F2922] dark:text-white">
                  Neraca Keuangan Berimbang • Aset = Liabilitas + Ekuitas
                </h2>
                <p className="text-xs text-[#52736B]">
                  Rekonsiliasi posisi aset lancar, persediaan farmasi HNA, piutang klaim, hutang PBF, dan ekuitas berjalan.
                </p>
              </div>
              <span className="px-3 py-1 rounded-lg bg-[#E6F4F1] dark:bg-[#0F3830] text-[#00796B] dark:text-[#38E8D6] text-xs font-mono font-bold">
                {erpAnalysis.balanceSheet.isBalanced
                  ? `NERACA SEIMBANG ✓ (${formatRupiah(erpAnalysis.balanceSheet.totalAssets)})`
                  : 'PERIKSA SELISIH NERACA'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="p-4 rounded-xl bg-[#F4F9F7] dark:bg-[#081916] border border-[#DCE8E4] dark:border-[#183831] space-y-2">
                <div className="font-bold text-[#00897B] uppercase tracking-wider">
                  1. Aset Lancar
                </div>
                <div className="flex justify-between font-mono">
                  <span>Kas &amp; Bank</span>
                  <strong>{formatRupiah(erpAnalysis.balanceSheet.cashAndBank)}</strong>
                </div>
                <div className="flex justify-between font-mono">
                  <span>Piutang BPJS &amp; Pasien</span>
                  <strong>{formatRupiah(erpAnalysis.balanceSheet.accountsReceivable)}</strong>
                </div>
                <div className="flex justify-between font-mono">
                  <span>Persediaan Obat HNA</span>
                  <strong>{formatRupiah(erpAnalysis.balanceSheet.inventoryAssetHna)}</strong>
                </div>
                <div className="pt-2 border-t border-[#DCE8E4] dark:border-[#183831] flex justify-between font-mono font-bold text-sm">
                  <span>Total Aset</span>
                  <span className="text-[#00897B]">
                    {formatRupiah(erpAnalysis.balanceSheet.totalAssets)}
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#F4F9F7] dark:bg-[#081916] border border-[#DCE8E4] dark:border-[#183831] space-y-2">
                <div className="font-bold text-amber-700 dark:text-[#E5B85B] uppercase tracking-wider">
                  2. Liabilitas Jangka Pendek
                </div>
                <div className="flex justify-between font-mono">
                  <span>Hutang Dagang PBF</span>
                  <strong>{formatRupiah(erpAnalysis.balanceSheet.accountsPayablePbf)}</strong>
                </div>
                <div className="flex justify-between font-mono">
                  <span>Hutang Jasa Medis Dokter</span>
                  <strong>{formatRupiah(erpAnalysis.balanceSheet.doctorFeePayable)}</strong>
                </div>
                <div className="flex justify-between font-mono">
                  <span>Hutang Pajak PPh</span>
                  <strong>{formatRupiah(erpAnalysis.balanceSheet.taxPayable)}</strong>
                </div>
                <div className="pt-2 border-t border-[#DCE8E4] dark:border-[#183831] flex justify-between font-mono font-bold text-sm">
                  <span>Total Liabilitas</span>
                  <span className="text-amber-700 dark:text-[#E5B85B]">
                    {formatRupiah(erpAnalysis.balanceSheet.totalLiabilities)}
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#F4F9F7] dark:bg-[#081916] border border-[#DCE8E4] dark:border-[#183831] space-y-2">
                <div className="font-bold text-[#0F2922] dark:text-white uppercase tracking-wider">
                  3. Ekuitas &amp; Laba Ditahan
                </div>
                <div className="flex justify-between font-mono">
                  <span>Modal Disetor &amp; Cadangan</span>
                  <strong>
                    {formatRupiah(
                      erpAnalysis.balanceSheet.retainedEarningsAndEquity - erpAnalysis.netProfit
                    )}
                  </strong>
                </div>
                <div className="flex justify-between font-mono">
                  <span>Laba Berjalan Bersih</span>
                  <strong>{formatRupiah(erpAnalysis.netProfit)}</strong>
                </div>
                <div className="pt-2 border-t border-[#DCE8E4] dark:border-[#183831] flex justify-between font-mono font-bold text-sm">
                  <span>Liabilitas + Ekuitas</span>
                  <span className="text-[#00897B]">
                    {formatRupiah(
                      erpAnalysis.balanceSheet.totalLiabilities +
                        erpAnalysis.balanceSheet.retainedEarningsAndEquity
                    )}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-[#E2ECE8] dark:border-[#183831] bg-[#F8FBFA] dark:bg-[#081916] flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-3.5 h-3.5 text-[#52736B] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari uraian transaksi, nomor jurnal, kode akun COA, atau referensi..."
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-white dark:bg-[#0B211D]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                aria-label="Filter Tipe Arus Kas"
                value={typeFilter}
                onChange={(e) =>
                  setTypeFilter(e.target.value as 'ALL' | 'PENDAPATAN' | 'PENGELUARAN')
                }
                className="px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-white dark:bg-[#0B211D] font-medium"
              >
                <option value="ALL">Semua Jenis Jurnal</option>
                <option value="PENDAPATAN">Hanya Pemasukan</option>
                <option value="PENGELUARAN">Hanya Pengeluaran</option>
              </select>

              <select
                aria-label="Filter Kategori Akun"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-white dark:bg-[#0B211D] font-medium"
              >
                <option value="ALL">Semua Kategori Pos</option>
                <option value="LAYANAN_MEDIS">Layanan Medis</option>
                <option value="FARMASI">Farmasi / Obat</option>
                <option value="KLAIM_BPJS">Klaim BPJS</option>
                <option value="PENGADAAN_OBAT">Pengadaan Obat PBF</option>
                <option value="JASA_MEDIS">Jasa Medis Dokter</option>
                <option value="GAJI_SDM">Gaji &amp; Tunjangan SDM</option>
                <option value="OPERASIONAL">Operasional Faskes</option>
              </select>

              <DataExportToolbar
                title="Laporan Buku Besar & Jurnal Keuangan ERP"
                subtitle={`Pemasukan: ${formatRupiah(summary.totalRevenue)} • Pengeluaran: ${formatRupiah(
                  summary.totalExpense
                )} • Neto: ${formatRupiah(summary.netProfit)}`}
                filenameBase={`KAEL_Jurnal_Keuangan_${facilityCode}`}
                facilityName={workspace.activeFacility.name}
                facilityCode={facilityCode}
                columns={journalExportColumns}
                rows={filteredEntries}
                compact
                contextLabel="Ekspor Jurnal"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#EAF3F0] dark:bg-[#0F2D27] text-[#52736B] dark:text-[#86B5A9] border-b border-[#E2ECE8] dark:border-[#183831]">
                  <th className="py-3 px-4 font-semibold">No. Jurnal &amp; Waktu</th>
                  <th className="py-3 px-4 font-semibold">Fasilitas</th>
                  <th className="py-3 px-4 font-semibold">Akun COA &amp; Kategori</th>
                  <th className="py-3 px-4 font-semibold">Uraian Transaksi</th>
                  <th className="py-3 px-4 font-semibold">Referensi</th>
                  <th className="py-3 px-4 font-semibold text-right">Nominal IDR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2ECE8] dark:divide-[#183831]">
                {filteredEntries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-[#52736B]">
                      Tidak ada catatan transaksi yang sesuai dengan filter pencarian.
                    </td>
                  </tr>
                ) : (
                  filteredEntries.map((entry) => (
                    <tr
                      key={entry.id}
                      className="hover:bg-[#F3F8F6] dark:hover:bg-[#0F2B25]"
                    >
                      <td className="py-3 px-4 font-mono whitespace-nowrap">
                        <div className="font-bold text-[#0F2922] dark:text-white">
                          {entry.entryNumber}
                        </div>
                        <div className="text-[11px] text-[#52736B]">
                          {entry.timestamp.slice(0, 16).replace('T', ' ')}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] font-semibold text-[#00897B] whitespace-nowrap">
                        {entry.facilityCode}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-mono font-semibold text-[#0F2922] dark:text-white">
                          {entry.accountCode} · {entry.category.replace(/_/g, ' ')}
                        </div>
                        <div className="text-[11px] text-[#52736B]">{entry.accountName}</div>
                      </td>
                      <td className="py-3 px-4 text-[#0F2922] dark:text-white">
                        {entry.description}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-[#52736B] whitespace-nowrap">
                        {entry.referenceId}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-mono font-bold whitespace-nowrap ${
                          entry.type === 'PENDAPATAN'
                            ? 'text-[#00897B]'
                            : 'text-[#B78320] dark:text-[#E5B85B]'
                        }`}
                      >
                        {entry.type === 'PENDAPATAN' ? '+' : '-'} {formatRupiah(entry.amount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        </div>
      )}

      {/* TAB 3: KLAIM BPJS, SELISIH TARIF INA-CBG/iDRG & UMUR PIUTANG */}
      {subTab === 'PIUTANG_KLAIM' && (
        <div className="space-y-5">
          {/* Claim Ratios, INA-CBG/iDRG Variance & Receivable Aging Schedule */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
            <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-5 space-y-3">
              <div className="font-bold text-sm text-[#0F2922] dark:text-white">
                Rasio Klaim BPJS &amp; Analisis Selisih Tarif INA-CBG / iDRG vs Tarif Riil
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                <div className="p-3 rounded-xl bg-[#F4F9F7] dark:bg-[#081916]">
                  <div className="text-[#52736B]">Disetujui</div>
                  <div className="text-base font-bold font-mono text-[#00897B] mt-0.5">
                    {erpAnalysis.claimAnalytics.approvedRatePercent}%
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[#F4F9F7] dark:bg-[#081916]">
                  <div className="text-[#52736B]">Pending Verifikasi</div>
                  <div className="text-base font-bold font-mono text-amber-700 dark:text-[#E5B85B] mt-0.5">
                    {erpAnalysis.claimAnalytics.pendingRatePercent}%
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[#F4F9F7] dark:bg-[#081916]">
                  <div className="text-[#52736B]">Ditolak / Dispute</div>
                  <div className="text-base font-bold font-mono text-rose-600 mt-0.5">
                    {erpAnalysis.claimAnalytics.rejectedRatePercent}%
                  </div>
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-[#F4F9F7] dark:bg-[#081916] border border-[#DCE8E4] dark:border-[#183831] space-y-1.5 font-mono">
                <div className="flex justify-between">
                  <span>Total Tarif Paket INA-CBG / iDRG:</span>
                  <strong>{formatRupiah(erpAnalysis.claimAnalytics.totalPackageTariffRp)}</strong>
                </div>
                <div className="flex justify-between">
                  <span>Total Biaya Riil Rumah Sakit / Klinik:</span>
                  <strong>{formatRupiah(erpAnalysis.claimAnalytics.totalRealCostRp)}</strong>
                </div>
                <div className="flex justify-between pt-1 border-t border-[#DCE8E4] dark:border-[#183831]">
                  <span>Selisih Tarif Paket vs Riil:</span>
                  <strong
                    className={
                      erpAnalysis.claimAnalytics.totalTariffVarianceRp >= 0
                        ? 'text-[#00897B]'
                        : 'text-rose-600'
                    }
                  >
                    {erpAnalysis.claimAnalytics.totalTariffVarianceRp >= 0 ? '+' : ''}
                    {formatRupiah(erpAnalysis.claimAnalytics.totalTariffVarianceRp)}
                  </strong>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-5 space-y-3">
              <div className="font-bold text-sm text-[#0F2922] dark:text-white">
                Tabel Umur Piutang Klaim &amp; Hutang PBF Jatuh Tempo
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono">
                <div className="p-3 rounded-xl bg-[#F4F9F7] dark:bg-[#081916]">
                  <div className="text-[11px] text-[#52736B]">0–30 Hari</div>
                  <div className="font-bold text-[#0F2922] dark:text-white mt-1">
                    {formatRupiah(erpAnalysis.receivableAging.bucket0to30)}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[#F4F9F7] dark:bg-[#081916]">
                  <div className="text-[11px] text-[#52736B]">31–60 Hari</div>
                  <div className="font-bold text-amber-700 dark:text-[#E5B85B] mt-1">
                    {formatRupiah(erpAnalysis.receivableAging.bucket31to60)}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[#F4F9F7] dark:bg-[#081916]">
                  <div className="text-[11px] text-[#52736B]">61–90 Hari</div>
                  <div className="font-bold text-orange-600 mt-1">
                    {formatRupiah(erpAnalysis.receivableAging.bucket61to90)}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[#F4F9F7] dark:bg-[#081916]">
                  <div className="text-[11px] text-[#52736B]">&gt; 90 Hari</div>
                  <div className="font-bold text-rose-600 mt-1">
                    {formatRupiah(erpAnalysis.receivableAging.bucketOver90)}
                  </div>
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-[#F4F9F7] dark:bg-[#081916] border border-[#DCE8E4] dark:border-[#183831] flex items-center justify-between font-mono">
                <span>Total Hutang Dagang Faktur PBF Belum Lunas:</span>
                <strong className="text-amber-700 dark:text-[#E5B85B]">
                  {formatRupiah(erpAnalysis.payableAgingPbf.total)}
                </strong>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-[#E2ECE8] dark:border-[#183831] bg-[#F8FBFA] dark:bg-[#081916] flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-3.5 h-3.5 text-[#52736B] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari No. Invoice, Nama Pasien, atau No. RM..."
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-white dark:bg-[#0B211D]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                value={claimStatusFilter}
                onChange={(e) =>
                  setClaimStatusFilter(
                    e.target.value as 'ALL' | 'PENDING_ONLY' | 'LUNAS_ONLY'
                  )
                }
                className="px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-white dark:bg-[#0B211D] font-medium"
              >
                <option value="PENDING_ONLY">Hanya Klaim / Piutang Belum Cair</option>
                <option value="ALL">Semua Tagihan &amp; Klaim</option>
                <option value="LUNAS_ONLY">Sudah Lunas / Cair</option>
              </select>

              <select
                value={guarantorFilter}
                onChange={(e) => setGuarantorFilter(e.target.value)}
                className="px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-white dark:bg-[#0B211D] font-medium"
              >
                <option value="ALL">Semua Penjamin</option>
                <option value="BPJS_KESEHATAN">BPJS Kesehatan</option>
                <option value="UMUM_MANDIRI">Pasien Umum</option>
                <option value="ASURANSI_SWASTA">Asuransi Swasta</option>
              </select>

              <DataExportToolbar
                title="Rekapitulasi Klaim BPJS & Piutang Layanan"
                subtitle={`Fasilitas: ${workspace.activeFacility.name} (${facilityCode})`}
                filenameBase={`KAEL_Klaim_Piutang_${facilityCode}`}
                facilityName={workspace.activeFacility.name}
                facilityCode={facilityCode}
                columns={[
                  { key: 'invoiceNumber', header: 'No. Invoice' },
                  { key: 'facilityCode', header: 'Fasilitas' },
                  { key: 'patientName', header: 'Nama Pasien' },
                  { key: 'mrNumber', header: 'No. RM' },
                  { key: 'guarantor', header: 'Penjamin' },
                  {
                    key: 'amount',
                    header: 'Nilai Klaim / Tagihan',
                    format: (r) =>
                      r.bpjsCoveredAmount > 0 ? r.bpjsCoveredAmount : r.patientPayableAmount,
                  },
                  { key: 'status', header: 'Status' },
                ]}
                rows={filteredClaims}
                compact
                contextLabel="Ekspor Klaim"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#EAF3F0] dark:bg-[#0F2D27] text-[#52736B] dark:text-[#86B5A9] border-b border-[#E2ECE8] dark:border-[#183831]">
                  <th className="py-3 px-4 font-semibold">No. Invoice &amp; Fasilitas</th>
                  <th className="py-3 px-4 font-semibold">Pasien &amp; No. RM</th>
                  <th className="py-3 px-4 font-semibold">Penjamin Biaya</th>
                  <th className="py-3 px-4 font-semibold text-right">Nilai Tagihan / Klaim</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold text-right">Tindakan Rekonsiliasi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2ECE8] dark:divide-[#183831]">
                {filteredClaims.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-[#52736B]">
                      Tidak ada klaim BPJS atau piutang tertunda pada filter ini.
                    </td>
                  </tr>
                ) : (
                  filteredClaims.map((inv) => {
                    const effectiveAmount =
                      inv.bpjsCoveredAmount > 0
                        ? inv.bpjsCoveredAmount
                        : inv.patientPayableAmount;
                    return (
                      <tr key={inv.id} className="hover:bg-[#F3F8F6] dark:hover:bg-[#0F2B25]">
                        <td className="py-3 px-4 font-mono">
                          <div className="font-bold text-[#0F2922] dark:text-white">
                            {inv.invoiceNumber}
                          </div>
                          <div className="text-[11px] text-[#00897B]">{inv.facilityCode}</div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-[#0F2922] dark:text-white">
                            {inv.patientName}
                          </div>
                          <div className="font-mono text-[11px] text-[#52736B]">
                            {inv.mrNumber}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px]">{inv.guarantor}</td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-[#0F2922] dark:text-white">
                          {formatRupiah(effectiveAmount)}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2.5 py-0.5 rounded-md text-[11px] font-semibold ${
                              inv.status === 'LUNAS'
                                ? 'bg-[#E6F4F1] text-[#00796B]'
                                : 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                            }`}
                          >
                            {inv.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          {inv.status !== 'LUNAS' ? (
                            <button
                              type="button"
                              disabled={isSubmitting}
                              onClick={() => handleReconcileClaim(inv)}
                              className="px-3 py-1.5 rounded-lg bg-[#00897B] hover:bg-[#00796B] text-white text-[11px] font-semibold transition-colors cursor-pointer"
                            >
                              Cairkan Klaim ke Kas
                            </button>
                          ) : (
                            <span className="text-[11px] text-[#52736B] font-mono">
                              Terekonsiliasi
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          </div>
        </div>
      )}

      {/* TAB 4: JASA MEDIS & REMUNERASI DOKTER */}
      {subTab === 'JASA_MEDIS' && (
        <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl overflow-hidden">
          <div className="p-5 border-b border-[#E2ECE8] dark:border-[#183831] bg-[#F8FBFA] dark:bg-[#081916] flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-[#0F2922] dark:text-white">
                Subledger Remunerasi Jasa Medis Dokter &amp; Potongan Pajak PPh 21
              </h3>
              <p className="text-xs text-[#52736B]">
                Persentase jasa medis dihitung dari komponen tarif konsultasi &amp; tindakan medis per dokter.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <div className="flex items-center gap-2">
                <label className="font-semibold">Persentase Jasa Medis:</label>
                <input
                  type="number"
                  min={10}
                  max={90}
                  value={doctorSharePercent}
                  onChange={(e) => setDoctorSharePercent(Number(e.target.value))}
                  className="w-20 px-3 py-1.5 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-white dark:bg-[#0B211D] font-mono font-bold text-center"
                />
              </div>
              <DataExportToolbar
                title="Laporan Subledger Jasa Medis & Pajak PPh 21 Dokter"
                subtitle={`Rasio Jasa Medis: ${doctorSharePercent}% • ${workspace.activeFacility.name}`}
                filenameBase={`KAEL_Jasa_Medis_${facilityCode}`}
                facilityName={workspace.activeFacility.name}
                facilityCode={facilityCode}
                columns={[
                  { key: 'doctorName', header: 'Nama Dokter', format: (r) => r.doctor.fullName },
                  { key: 'sip', header: 'Nomor SIP', format: (r) => r.doctor.nipOrSip },
                  { key: 'visitCount', header: 'Jumlah Kunjungan' },
                  { key: 'medicalServiceRevenue', header: 'Omzet Tindakan & Konsul IDR' },
                  { key: 'estimatedFee', header: `Bruto Jasa Medis ${doctorSharePercent}% IDR` },
                  { key: 'pph21Deduction', header: 'Potongan PPh 21 IDR' },
                  { key: 'netTakeHomeFee', header: 'Honorarium Neto IDR' },
                ]}
                rows={doctorFeeSummaries}
                compact
                contextLabel="Ekspor Jasa Medis"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#EAF3F0] dark:bg-[#0F2D27] text-[#52736B] dark:text-[#86B5A9] border-b border-[#E2ECE8] dark:border-[#183831]">
                  <th className="py-3 px-4 font-semibold">Nama Dokter &amp; Spesialisasi</th>
                  <th className="py-3 px-4 font-semibold">Nomor SIP</th>
                  <th className="py-3 px-4 font-semibold text-right">Pasien Ditangani</th>
                  <th className="py-3 px-4 font-semibold text-right">Omzet Tindakan</th>
                  <th className="py-3 px-4 font-semibold text-right">
                    Bruto Jasa Medis
                  </th>
                  <th className="py-3 px-4 font-semibold text-right">PPh 21</th>
                  <th className="py-3 px-4 font-semibold text-right">Honorarium Neto</th>
                  <th className="py-3 px-4 font-semibold text-right">Pencairan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2ECE8] dark:divide-[#183831]">
                {doctorFeeSummaries.map((row) => (
                  <tr key={row.doctor.id} className="hover:bg-[#F3F8F6] dark:hover:bg-[#0F2B25]">
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-[#0F2922] dark:text-white">
                        {row.doctor.fullName}
                      </div>
                      <div className="text-[11px] text-[#52736B]">
                        {row.doctor.specialization || row.doctor.polyclinic || 'Dokter Klinis'}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-[11px]">{row.doctor.nipOrSip}</td>
                    <td className="py-3.5 px-4 text-right font-mono font-semibold">
                      {row.visitCount} kunjungan
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono">
                      {formatRupiah(row.medicalServiceRevenue)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono">
                      {formatRupiah(row.estimatedFee)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-amber-700 dark:text-[#E5B85B]">
                      -{formatRupiah(row.pph21Deduction)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-bold text-[#00897B]">
                      {formatRupiah(row.netTakeHomeFee)}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        type="button"
                        disabled={isSubmitting || row.netTakeHomeFee <= 0}
                        onClick={() =>
                          handlePayDoctorFee(
                            row.doctor.fullName,
                            row.doctor.nipOrSip,
                            row.netTakeHomeFee,
                            row.visitCount
                          )
                        }
                        className="px-3 py-1.5 rounded-lg bg-[#00897B] hover:bg-[#00796B] disabled:opacity-50 text-white text-[11px] font-semibold transition-colors cursor-pointer"
                      >
                        Bayar &amp; Posting Jurnal
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
