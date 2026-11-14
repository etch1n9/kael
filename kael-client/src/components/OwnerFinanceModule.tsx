import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  FileSpreadsheet,
  Lock,
  Plus,
  Search,
  Stethoscope,
  X,
} from 'lucide-react';
import { AccountingEntry, InvoiceRecord, ModuleKey } from '../domain/simrs.ts';
import { kaelApi, WorkspacePayload } from '../utils/apiClient';
import {
  buildCashflowTimeSeries,
  calculateFinancialSummary,
  formatRupiah,
  getInvoiceOutstanding,
} from '../domain/clinicalLogic.ts';
import { computeErpCompleteFinancialAnalysis } from '../domain/platformEngine.ts';
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

  // Manual Journal Entry Form State
  const [showAddJournal, setShowAddJournal] = useState(false);
  const [jrnType, setJrnType] = useState<'PENDAPATAN' | 'PENGELUARAN'>('PENGELUARAN');
  const [jrnCategory, setJrnCategory] = useState<AccountingEntry['category']>('OPERASIONAL');
  const [jrnAccountCode, setJrnAccountCode] = useState('');
  const [jrnAccountName, setJrnAccountName] = useState('');
  const [jrnDesc, setJrnDesc] = useState('');
  const [jrnAmount, setJrnAmount] = useState<number | ''>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const financialModules = ['KEUANGAN_OWNER', 'NERACA_GL', 'KLAIM_BPJS_PIUTANG', 'JASA_MEDIS_REMUN'];
  const grantedModules = workspace.user.resolvedModules || workspace.user.customPrivileges || [];
  const hasAccess = workspace.user.role === 'SUPERUSER' || financialModules.some((module) =>
    grantedModules.includes(module as ModuleKey)
  );

  const moduleForTab: Record<typeof subTab, ModuleKey> = { ARUS_KAS: 'KEUANGAN_OWNER', CATATAN_TRANSAKSI: 'NERACA_GL', PIUTANG_KLAIM: 'KLAIM_BPJS_PIUTANG', JASA_MEDIS: 'JASA_MEDIS_REMUN' };
  const allowedTabs = (Object.keys(moduleForTab) as Array<typeof subTab>).filter((tab) => (moduleForTab[tab] === initialView || (initialView === 'KEUANGAN_OWNER' && ['CATATAN_TRANSAKSI', 'JASA_MEDIS'].includes(tab))) && (workspace.user.role === 'SUPERUSER' || grantedModules.includes(moduleForTab[tab])));
  useEffect(() => {
    if (!allowedTabs.includes(subTab) && allowedTabs[0]) setSubTab(allowedTabs[0]);
  }, [initialView, subTab, grantedModules.join(',')]);
  const [receiptDrafts, setReceiptDrafts] = useState<Record<string, { amount: number | ''; reference: string }>>({});
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
        nearExpiryThresholdDays: workspace.activeFacilityConfig?.pharmacyPolicy.nearExpiryThresholdDays,
      }),
    [
      rawEntries,
      rawInvoices,
      workspace.medications,
      workspace.medicationMutations,
      workspace.purchaseOrders,
      workspace.visits,
      workspace.activeFacilityConfig?.pharmacyPolicy.nearExpiryThresholdDays,
    ]
  );

  // 12-Day Cashflow Time Series for Single Main KPI Sparkline Chart
  const cashflowSeries = useMemo(
    () => buildCashflowTimeSeries(rawEntries, 12),
    [rawEntries]
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

    const facilitiesWithData = workspace.accessibleFacilities.filter((facility) =>
      facility.code === workspace.activeFacility.code ||
      allEntries.some((entry) => entry.facilityCode === facility.code) ||
      allInvs.some((invoice) => invoice.facilityCode === facility.code) ||
      allVis.some((visit) => visit.facilityCode === facility.code)
    );
    return facilitiesWithData.map((fac) => {
      const fEntries = allEntries.filter((e) => e.facilityCode === fac.code);
      const fInvs = allInvs.filter((i) => i.facilityCode === fac.code);
      const fVisits = allVis.filter((v) => v.facilityCode === fac.code);
      const fSummary = calculateFinancialSummary(fEntries, fInvs);
      return {
        facility: fac,
        visitCount: fVisits.length,
        hasEntries: fEntries.length > 0,
        hasInvoices: fInvs.length > 0,
        ...fSummary,
      };
    });
  }, [workspace]);

  const doctorFeeSummaries = useMemo(() => workspace.doctors.map((doctor) => {
    const visits = workspace.visits.filter((visit) => visit.doctorId === doctor.id);
    const visitIds = new Set(visits.map((visit) => visit.id));
    const invoices = workspace.invoices.filter((invoice) => visitIds.has(invoice.visitId) && invoice.pricingStatus !== 'PENDING');
    const medicalServiceRevenue = invoices.reduce((total, invoice) => total + invoice.items
      .filter((item) => item.category === 'KONSULTASI' || item.category === 'TINDAKAN')
      .reduce((sum, item) => sum + item.subtotal, 0), 0);
    return { doctor, visitCount: visits.length, invoiceCount: invoices.length, medicalServiceRevenue };
  }), [workspace.doctors, workspace.visits, workspace.invoices]);

  const localBpjsInvoices = rawInvoices.filter((invoice) => invoice.guarantor === 'BPJS_KESEHATAN');
  const outstandingInvoices = rawInvoices.filter((invoice) => invoice.status !== 'LUNAS' && invoice.pricingStatus !== 'PENDING');
  const canRead = (collection: string) => workspace.dataAccess?.[collection] !== false;
  const ledgerEmptyState = canRead('accountingEntries') ? 'Belum ada transaksi' : 'Data transaksi tidak tersedia untuk akses akun ini';
  const invoiceEmptyState = canRead('invoices') ? 'Belum ada tagihan' : 'Data tagihan tidak tersedia untuk akses akun ini';
  const canReadDoctorSummary = canRead('doctors') && canRead('visits') && canRead('invoices');
  const hasRecordedEntries = rawEntries.length > 0;
  const financialCards = [
    { label: 'Pemasukan tercatat', value: hasRecordedEntries ? formatRupiah(summary.totalRevenue) : ledgerEmptyState },
    { label: 'Pengeluaran tercatat', value: hasRecordedEntries ? formatRupiah(summary.totalExpense) : ledgerEmptyState },
    { label: 'Selisih pemasukan dan pengeluaran', value: hasRecordedEntries ? formatRupiah(summary.netProfit) : ledgerEmptyState },
    { label: 'Tagihan belum lunas', value: rawInvoices.length > 0
      ? formatRupiah(summary.pendingBpjsClaims + summary.unpaidPatientReceivables) : invoiceEmptyState },
  ];

  if (!hasAccess) {
    return (
      <div className="bg-white dark:bg-[#0B211D] border border-red-200 dark:border-red-900 rounded-2xl p-8 text-center">
        <Lock className="w-8 h-8 text-red-600 mx-auto mb-2" />
        <h2 className="text-base font-bold text-[#0F2922] dark:text-white">
          Menu Khusus Manajemen Keuangan &amp; ERP
        </h2>
        <p className="text-xs text-[#52736B] mt-1">
          Laporan arus kas, neraca, rekonsiliasi klaim BPJS, dan remunerasi jasa medis memerlukan izin modul keuangan pada role yang ditetapkan superuser.
        </p>
      </div>
    );
  }

  const handleCreateJournalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jrnDesc.trim() || !jrnAccountCode.trim() || !jrnAccountName.trim() || !Number.isFinite(Number(jrnAmount)) || Number(jrnAmount) <= 0) return;
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
    const receipt = receiptDrafts[inv.id];
    if (!receipt || receipt.amount === '' || !Number.isFinite(receipt.amount) || receipt.amount <= 0 || !receipt.reference.trim()) {
      setFeedback({ type: 'error', text: 'Isi nominal penerimaan aktual dan referensi pembayaran yang dapat ditelusuri.' }); return;
    }
    setIsSubmitting(true);
    try {
      const res = await kaelApi.reconcileFinanceClaim(token, inv.facilityCode, inv.id, { receivedAmount: receipt.amount, paymentReference: receipt.reference.trim() });
      setReceiptDrafts((previous) => { const next = { ...previous }; delete next[inv.id]; return next; });
      await onRefreshWorkspace();
      setFeedback({
        type: 'success',
        text: `Klaim ${res.invoice.invoiceNumber} atas nama ${
          res.invoice.patientName
        } sebesar ${formatRupiah(
          res.entry.amount
        )} dicatat sebagai penerimaan manual pada jurnal ${res.entry.entryNumber}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal mencatat penerimaan klaim/piutang.',
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
      ? 'Catatan transaksi keuangan'
      : subTab === 'PIUTANG_KLAIM'
      ? 'Tagihan penjamin & umur piutang'
      : subTab === 'JASA_MEDIS'
      ? 'Ringkasan layanan pemeriksa'
      : 'Pemasukan, pengeluaran & tagihan';

  return (
    <div className="min-w-0 space-y-3">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 min-w-0">
        <div>
          {scopeMode === 'ALL_OWNED' && <p className="text-xs font-semibold text-[#52736B] dark:text-[#86B5A9]">
            Konsolidasi {workspace.accessibleFacilities.length} fasilitas
          </p>}
          <h1 className="text-xl sm:text-2xl font-bold text-[#0F2922] dark:text-white tracking-tight mt-0.5">
            {pageTitle}
          </h1>
          <p className="text-xs text-[#52736B] dark:text-[#86B5A9] mt-0.5">
            Ringkasan berdasarkan transaksi, tagihan, dan faktur yang tercatat pada fasilitas.
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

          {(initialView === 'KEUANGAN_OWNER' || initialView === 'NERACA_GL') && <button
            type="button"
            onClick={() => setShowAddJournal((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#00897B] hover:bg-[#00796B] text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Catat Transaksi Kas</span>
          </button>}
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
      {showAddJournal && (initialView === 'KEUANGAN_OWNER' || initialView === 'NERACA_GL') && (
        <form
          onSubmit={handleCreateJournalSubmit}
          className="bg-white dark:bg-[#0B211D] border border-[#00897B] rounded-2xl p-4 space-y-4 shadow-sm"
        >
          <div className="flex items-center justify-between border-b border-[#E2ECE8] dark:border-[#183831] pb-3">
            <div>
              <h3 className="text-sm font-bold text-[#0F2922] dark:text-white">
                Catat Transaksi Kas Masuk atau Kas Keluar
              </h3>
              <p className="text-xs text-[#52736B]">
                Mencatat pemasukan atau pengeluaran pada fasilitas {facilityCode}.
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

          <div className="min-w-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-field-min-inline-size)),1fr))] gap-3 items-end text-xs">
            <div>
              <label className="block font-semibold mb-1">Jenis Arus Kas</label>
              <select
                value={jrnType}
                onChange={(e) => {
                  const t = e.target.value as 'PENDAPATAN' | 'PENGELUARAN';
                  setJrnType(t);
                }}
                className="min-w-0 w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
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
                className="min-w-0 w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
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
                required
                onChange={(e) => setJrnAccountCode(e.target.value)}
                className="min-w-0 w-full px-3 py-2 font-mono rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">Nama Akun COA</label>
              <input type="text" value={jrnAccountName} onChange={(event) => setJrnAccountName(event.target.value)}
                required className="min-w-0 w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]" />
            </div>

            <div className="">
              <label className="block font-semibold mb-1">Uraian Transaksi</label>
              <input
                type="text"
                value={jrnDesc}
                onChange={(e) => setJrnDesc(e.target.value)}
                placeholder="Contoh: Pembelian Reagen Lab / Penerimaan Layanan..."
                required
                className="min-w-0 w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">Nominal IDR</label>
              <input
                type="number"
                min={1}
                value={jrnAmount}
                onChange={(e) => setJrnAmount(e.target.value === '' ? '' : Number(e.target.value))}
                required
                className="min-w-0 w-full px-3 py-2 font-mono rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
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

      <div className="min-w-0 grid grid-cols-2 xl:grid-cols-4 gap-3">
        {financialCards.map((card) => (
          <div key={card.label} className="min-w-0 bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-xl p-3 sm:p-4">
            <p className="text-xs text-[#52736B] dark:text-[#86B5A9]">{card.label}</p>
            <p className="text-lg font-bold text-[#0F2922] dark:text-white mt-1 break-words">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Sub-Navigation Tabs */}
      {allowedTabs.length > 1 && <div className="flex flex-wrap items-center gap-2">
        {allowedTabs.includes('ARUS_KAS') && (
        <button
          type="button"
          onClick={() => setSubTab('ARUS_KAS')}
          className={`px-4 py-2 text-xs font-semibold rounded-xl transition-colors cursor-pointer ${
            subTab === 'ARUS_KAS'
              ? 'bg-[#00897B] text-white'
              : 'bg-white dark:bg-[#0B211D] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
          }`}
        >
          Pemasukan &amp; pengeluaran
        </button>
        )}
        {allowedTabs.includes('CATATAN_TRANSAKSI') && (
        <button
          type="button"
          onClick={() => setSubTab('CATATAN_TRANSAKSI')}
          className={`px-4 py-2 text-xs font-semibold rounded-xl transition-colors cursor-pointer ${
            subTab === 'CATATAN_TRANSAKSI'
              ? 'bg-[#00897B] text-white'
              : 'bg-white dark:bg-[#0B211D] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
          }`}
        >
          Catatan transaksi • {rawEntries.length} jurnal
        </button>
        )}
        {allowedTabs.includes('PIUTANG_KLAIM') && (
        <button
          type="button"
          onClick={() => setSubTab('PIUTANG_KLAIM')}
          className={`px-4 py-2 text-xs font-semibold rounded-xl transition-colors cursor-pointer ${
            subTab === 'PIUTANG_KLAIM'
              ? 'bg-[#00897B] text-white'
              : 'bg-white dark:bg-[#0B211D] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
          }`}
        >
          Tagihan penjamin &amp; piutang
        </button>
        )}
        {allowedTabs.includes('JASA_MEDIS') && (
        <button
          type="button"
          onClick={() => setSubTab('JASA_MEDIS')}
          className={`px-4 py-2 text-xs font-semibold rounded-xl transition-colors cursor-pointer ${
            subTab === 'JASA_MEDIS'
              ? 'bg-[#00897B] text-white'
              : 'bg-white dark:bg-[#0B211D] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
          }`}
        >
          Layanan pemeriksa • {workspace.doctors.length} praktisi
        </button>
        )}
      </div>}

      {/* TAB 1: ARUS KAS, HPP & LABA RUGI (Single Main Chart + Cost Center + Multi-Facility Comparison) */}
      {subTab === 'ARUS_KAS' && allowedTabs.includes('ARUS_KAS') && (
        <div className="min-w-0 space-y-3">
          {hasRecordedEntries ? (
            <KpiSparklineCanvas series={cashflowSeries} defaultMode="NETO" compact
              title="Transaksi harian tercatat" subtitle="Pemasukan dan pengeluaran yang tercatat dalam 12 hari terakhir" />
          ) : (
            <div className="rounded-2xl border border-[#E2ECE8] dark:border-[#183831] p-4 text-sm text-[#52736B]">
              {ledgerEmptyState}.
            </div>
          )}

          {/* Multi-Facility Performance Comparison Table */}
          <div className="min-w-0 bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-[#F8FBFA] dark:bg-[#081916] border-b border-[#E2ECE8] dark:border-[#183831] flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-[#0F2922] dark:text-white flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-[#00897B]" />
                  Transaksi keuangan per fasilitas
                </h2>
                <p className="text-xs text-[#52736B]">
                  Menampilkan data fasilitas yang tersedia untuk akun ini. Angka bersumber dari transaksi dan tagihan yang tercatat.
                </p>
              </div>
              <DataExportToolbar
                title="Transaksi keuangan per fasilitas"
                subtitle="Data transaksi dan tagihan yang tersimpan untuk akun ini"
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
                rows={facilityComparison.filter((row) => row.hasEntries || row.hasInvoices || row.visitCount > 0)}
                compact
                contextLabel="Ekspor Tabel Kinerja"
              />
            </div>

            <div className="min-w-0 w-full overflow-x-auto">
              <table className="w-full min-w-full table-auto [&_th]:whitespace-nowrap text-left border-collapse text-xs">
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
                        <div className="text-caption">{row.facility.city}</div>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-semibold">
                        {row.visitCount} pasien
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-semibold text-[#00897B]">
                        {row.hasEntries ? formatRupiah(row.totalRevenue) : 'Belum ada transaksi'}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-semibold text-[#B78320] dark:text-[#E5B85B]">
                        {row.hasEntries ? formatRupiah(row.totalExpense) : 'Belum ada transaksi'}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-[#52736B]">
                        {row.hasInvoices ? formatRupiah(row.pendingBpjsClaims + row.unpaidPatientReceivables) : 'Belum ada tagihan'}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-[#0F2922] dark:text-white">
                        {row.hasEntries ? formatRupiah(row.netProfit) : 'Belum ada transaksi'}
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
      {subTab === 'CATATAN_TRANSAKSI' && allowedTabs.includes('CATATAN_TRANSAKSI') && (
        <div className="min-w-0 space-y-3">
          <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-4 space-y-2">
            <h2 className="text-sm font-bold text-[#0F2922] dark:text-white">Neraca lengkap belum tersedia</h2>
            <p className="text-xs text-[#52736B]">Saldo awal, aset tetap, modal, serta subledger liabilitas belum tersedia untuk menyusun neraca. Catatan pemasukan dan pengeluaran yang tersimpan ditampilkan di bawah.</p>
          </div>

          <div className="min-w-0 bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-xl overflow-hidden">
          <div className="p-4 border-b border-[#E2ECE8] dark:border-[#183831] bg-[#F8FBFA] dark:bg-[#081916] flex flex-wrap items-center justify-between gap-3">
            <div className="relative min-w-0 w-full sm:flex-1 sm:min-w-(--kael-field-min-inline-size)">
              <Search className="w-3.5 h-3.5 text-[#52736B] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari uraian transaksi, nomor jurnal, kode akun COA, atau referensi..."
                className="min-w-0 w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-white dark:bg-[#0B211D]"
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

          <div className="min-w-0 w-full overflow-x-auto">
            <table className="w-full min-w-full table-auto [&_th]:whitespace-nowrap text-left border-collapse text-xs">
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
                    <td colSpan={6} className="py-5 px-4 text-center text-[#52736B]">
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
                        <div className="text-caption text-[#52736B]">
                          {entry.timestamp.slice(0, 16).replace('T', ' ')}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-caption font-semibold text-[#00897B] whitespace-nowrap">
                        {entry.facilityCode}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-mono font-semibold text-[#0F2922] dark:text-white">
                          {entry.accountCode} · {entry.category.replace(/_/g, ' ')}
                        </div>
                        <div className="text-caption text-[#52736B]">{entry.accountName}</div>
                      </td>
                      <td className="py-3 px-4 text-[#0F2922] dark:text-white">
                        {entry.description}
                      </td>
                      <td className="py-3 px-4 font-mono text-caption text-[#52736B] whitespace-nowrap">
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
      {subTab === 'PIUTANG_KLAIM' && allowedTabs.includes('PIUTANG_KLAIM') && (
        <div className="min-w-0 space-y-3">
          <div className="min-w-0 grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
            <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-4 space-y-3">
              <h2 className="font-bold text-sm text-[#0F2922] dark:text-white">Tagihan BPJS yang tercatat</h2>
              {localBpjsInvoices.length > 0 ? (
                <dl className="space-y-2">
                  <div className="flex justify-between"><dt>Jumlah tagihan</dt><dd>{localBpjsInvoices.length}</dd></div>
                  <div className="flex justify-between"><dt>Status KLAIM_DIAJUKAN</dt><dd>{localBpjsInvoices.filter((invoice) => invoice.status === 'KLAIM_DIAJUKAN').length}</dd></div>
                  <div className="flex justify-between"><dt>Status LUNAS</dt><dd>{localBpjsInvoices.filter((invoice) => invoice.status === 'LUNAS').length}</dd></div>
                </dl>
              ) : <p className="text-[#52736B]">{canRead('invoices') ? 'Belum ada tagihan BPJS.' : invoiceEmptyState}</p>}
              <p className="text-[#52736B]">Status berasal dari pencatatan lokal. Hasil verifikasi penjamin, tarif paket INA-CBG/iDRG, dan biaya riil belum tersedia untuk perbandingan klaim.</p>
            </div>
            <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-4 space-y-3">
              <h2 className="font-bold text-sm text-[#0F2922] dark:text-white">Umur tagihan belum lunas</h2>
              {outstandingInvoices.length > 0 ? (
                <dl className="min-w-0 grid grid-cols-2 gap-3">
                  {[['0–30 hari', erpAnalysis.receivableAging.bucket0to30], ['31–60 hari', erpAnalysis.receivableAging.bucket31to60],
                    ['61–90 hari', erpAnalysis.receivableAging.bucket61to90], ['Lebih dari 90 hari', erpAnalysis.receivableAging.bucketOver90]].map(([label, amount]) => (
                    <div key={label}><dt className="text-[#52736B]">{label}</dt><dd className="font-mono font-bold">{formatRupiah(Number(amount))}</dd></div>
                  ))}
                </dl>
              ) : <p className="text-[#52736B]">{canRead('invoices') ? 'Belum ada tagihan belum lunas.' : invoiceEmptyState}</p>}
              <p className="text-[#52736B]">Berdasarkan tanggal tagihan yang tersimpan. Faktur PBF fasilitas aktif belum lunas: {workspace.purchaseOrders?.length
                ? formatRupiah(erpAnalysis.payableAgingPbf.total) : canRead('purchaseOrders') ? 'belum ada faktur' : 'data tidak tersedia untuk akses akun ini' }.</p>
            </div>
          </div>

          <div className="min-w-0 bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-xl overflow-hidden">
          <div className="p-4 border-b border-[#E2ECE8] dark:border-[#183831] bg-[#F8FBFA] dark:bg-[#081916] flex flex-wrap items-center justify-between gap-3">
            <div className="relative min-w-0 w-full sm:flex-1 sm:min-w-(--kael-field-min-inline-size)">
              <Search className="w-3.5 h-3.5 text-[#52736B] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari No. Invoice, Nama Pasien, atau No. RM..."
                className="min-w-0 w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-white dark:bg-[#0B211D]"
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
                <option value="UMUM">Pasien Umum</option>
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
                      r.pricingStatus === 'PENDING' ? 'Tarif belum lengkap' : r.claimRequestedAmount ?? Math.max(0, r.subtotal - r.discountAmount),
                  },
                  { key: 'status', header: 'Status' },
                ]}
                rows={filteredClaims}
                compact
                contextLabel="Ekspor Klaim"
              />
            </div>
          </div>

          <div className="min-w-0 w-full overflow-x-auto">
            <table className="w-full min-w-full table-auto [&_th]:whitespace-nowrap text-left border-collapse text-xs">
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
                    <td colSpan={6} className="py-5 px-4 text-center text-[#52736B]">
                      Tidak ada klaim BPJS atau piutang tertunda pada filter ini.
                    </td>
                  </tr>
                ) : (
                  filteredClaims.map((inv) => {
                    const effectiveAmount = inv.claimRequestedAmount ?? Math.max(0, inv.subtotal - inv.discountAmount);
                    return (
                      <tr key={inv.id} className="hover:bg-[#F3F8F6] dark:hover:bg-[#0F2B25]">
                        <td className="py-3 px-4 font-mono">
                          <div className="font-bold text-[#0F2922] dark:text-white">
                            {inv.invoiceNumber}
                          </div>
                          <div className="text-caption text-[#00897B]">{inv.facilityCode}</div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-[#0F2922] dark:text-white">
                            {inv.patientName}
                          </div>
                          <div className="font-mono text-caption text-[#52736B]">
                            {inv.mrNumber}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono text-caption">{inv.guarantor}</td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-[#0F2922] dark:text-white">
                          {inv.pricingStatus === 'PENDING' ? 'Tarif belum lengkap' : formatRupiah(effectiveAmount)}
                          <div className="text-caption font-normal text-slate-500">Diterima tercatat: {formatRupiah(inv.totalReceivedAmount ?? 0)}</div>
                          <div className="text-caption font-normal text-slate-500">Sisa tagihan: {inv.pricingStatus === 'PENDING' ? 'Belum dapat dihitung' : formatRupiah(getInvoiceOutstanding(inv))}</div>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2.5 py-0.5 rounded-md text-caption font-semibold ${
                              inv.status === 'LUNAS'
                                ? 'bg-[#E6F4F1] text-[#00796B]'
                                : 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                            }`}
                          >
                            {inv.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          {inv.status === 'KLAIM_DIAJUKAN' && inv.pricingStatus !== 'PENDING' ? (
                            <div className="space-y-2">
                            <input type="number" min={0} step="any" value={receiptDrafts[inv.id]?.amount ?? ''} onChange={(event) => setReceiptDrafts((previous) => ({ ...previous, [inv.id]: { reference: previous[inv.id]?.reference || '', amount: event.target.value === '' ? '' : Number(event.target.value) } }))} placeholder="Nominal diterima aktual" aria-label={`Nominal penerimaan ${inv.invoiceNumber}`} className="min-w-0 w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
                            <input type="text" value={receiptDrafts[inv.id]?.reference || ''} onChange={(event) => setReceiptDrafts((previous) => ({ ...previous, [inv.id]: { amount: previous[inv.id]?.amount ?? '', reference: event.target.value } }))} placeholder="Referensi pembayaran" aria-label={`Referensi penerimaan ${inv.invoiceNumber}`} className="min-w-0 w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
                            <button
                              type="button"
                              disabled={isSubmitting}
                              onClick={() => handleReconcileClaim(inv)}
                              className="px-3 py-1.5 rounded-lg bg-[#00897B] hover:bg-[#00796B] text-white text-caption font-semibold transition-colors cursor-pointer"
                            >
                              Catat penerimaan manual
                            </button>
                            </div>
                          ) : (
                            <span className="text-caption text-[#52736B] font-mono">
                              {inv.status === 'LUNAS' ? 'Lunas pada catatan lokal' : inv.pricingStatus === 'PENDING' ? 'Lengkapi tarif di kasir' : 'Pengajuan belum tercatat'}
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

      {subTab === 'JASA_MEDIS' && allowedTabs.includes('JASA_MEDIS') && (
        <div className="min-w-0 bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-xl overflow-hidden">
          <div className="p-4 border-b border-[#E2ECE8] dark:border-[#183831] space-y-2">
            <h2 className="text-sm font-bold text-[#0F2922] dark:text-white">Tagihan konsultasi dan tindakan per pemeriksa</h2>
            <p className="text-xs text-[#52736B]">Nilai fasilitas aktif di bawah berasal dari komponen tagihan yang tersimpan. Aturan pembagian jasa, perhitungan pajak, serta subledger pembayaran pemeriksa belum dikonfigurasi.</p>
          </div>
          {!canReadDoctorSummary ? (
            <p className="p-4 text-sm text-[#52736B]">Data tenaga pemeriksa, kunjungan, atau tagihan belum tersedia untuk akses akun ini.</p>
          ) : doctorFeeSummaries.length === 0 ? (
            <p className="p-4 text-sm text-[#52736B]">Belum ada tenaga pemeriksa yang terdaftar dengan akses pada fasilitas ini.</p>
          ) : (
            <div className="min-w-0 w-full overflow-x-auto">
              <table className="w-full min-w-full table-auto [&_th]:whitespace-nowrap text-left text-xs">
                <thead><tr className="bg-[#F4F9F7] dark:bg-[#081916]">
                  <th className="p-3">Dokter</th><th className="p-3">Kunjungan tercatat</th><th className="p-3">Tagihan tercatat</th><th className="p-3">Nilai konsultasi dan tindakan</th><th className="p-3">Jasa dan pajak</th>
                </tr></thead>
                <tbody>{doctorFeeSummaries.map((row) => (
                  <tr key={row.doctor.id} className="border-t border-[#E2ECE8] dark:border-[#183831]">
                    <td className="p-3">{row.doctor.fullName}</td><td className="p-3">{row.visitCount}</td><td className="p-3">{row.invoiceCount}</td>
                    <td className="p-3">{row.invoiceCount > 0 ? formatRupiah(row.medicalServiceRevenue) : 'Belum ada tagihan'}</td>
                    <td className="p-3 text-[#52736B]">Belum dikonfigurasi</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
