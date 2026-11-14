import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Cpu,
  CreditCard,
  Download,
  FileSpreadsheet,
  Plus,
  Printer,
  RefreshCw,
  Search,
} from 'lucide-react';
import { AccountingEntry, BillingLineItem, BridgingLog, InvoiceRecord } from '../domain/simrs.ts';
import { kaelApi, WorkspacePayload } from '../utils/apiClient';
import { formatRupiah } from '../domain/clinicalLogic.ts';
import { DataExportToolbar } from './DataExportToolbar';
import { ExportColumn } from '../utils/exportDocument';
import { ServiceIndicators } from './ServiceIndicators';

interface CashierAndBridgingModuleProps {
  token: string;
  facilityCode: string;
  workspace: WorkspacePayload;
  initialView: 'KASIR_AKUNTANSI' | 'BRIDGING_SATUSEHAT' | 'LAPORAN_REGULASI';
  onRefreshWorkspace: () => Promise<void>;
}

export const CashierAndBridgingModule: React.FC<CashierAndBridgingModuleProps> = ({
  token,
  facilityCode,
  workspace,
  initialView,
  onRefreshWorkspace,
}) => {
  const [activeTab, setActiveTab] = useState<'KASIR' | 'AKUNTANSI' | 'BRIDGING' | 'REGULASI'>(
    initialView === 'BRIDGING_SATUSEHAT'
      ? 'BRIDGING'
      : initialView === 'LAPORAN_REGULASI'
      ? 'REGULASI'
      : 'KASIR'
  );
  const grantedModules = workspace.user.resolvedModules || workspace.user.customPrivileges || [];
  const hasModule = (key: 'KASIR_AKUNTANSI' | 'BRIDGING_SATUSEHAT' | 'LAPORAN_REGULASI') => workspace.user.role === 'SUPERUSER' || grantedModules.includes(key);
  const allowedTabs = initialView === 'KASIR_AKUNTANSI' && hasModule(initialView)
    ? ['KASIR', 'AKUNTANSI'] : initialView === 'BRIDGING_SATUSEHAT' && hasModule(initialView)
    ? ['BRIDGING'] : initialView === 'LAPORAN_REGULASI' && hasModule(initialView) ? ['REGULASI'] : [];
  useEffect(() => {
    if (!allowedTabs.includes(activeTab) && allowedTabs[0]) setActiveTab(allowedTabs[0] as typeof activeTab);
  }, [initialView, activeTab, grantedModules.join(',')]);
  const [pricingDraft, setPricingDraft] = useState<Array<{ category: BillingLineItem['category']; description: string; quantity: number; unitPrice: number | '' }> | null>(null);
  const [isSavingPrices, setIsSavingPrices] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRecord | null>(
    workspace.invoices[0] || null
  );
  const [paymentMethod, setPaymentMethod] = useState<InvoiceRecord['paymentMethod'] | ''>('');
  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [isSettling, setIsSettling] = useState(false);

  // Filters for Cashier Invoices & Bridging
  const [invSearch, setInvSearch] = useState('');
  const [invStatusFilter, setInvStatusFilter] = useState<string>('ALL');
  const [invGuarantorFilter, setInvGuarantorFilter] = useState<string>('ALL');
  const [bridgingGatewayFilter, setBridgingGatewayFilter] = useState<string>('ALL');

  // Add Custom Billing Line Item State
  const [showAddBillItem, setShowAddBillItem] = useState(false);
  const [billCategory, setBillCategory] = useState<
    'PENDAFTARAN' | 'KONSULTASI' | 'TINDAKAN' | 'FARMASI' | 'LABORATORIUM' | 'KAMAR_INAP'
  >('TINDAKAN');
  const [billDesc, setBillDesc] = useState('');
  const [billQty, setBillQty] = useState(1);
  const [billPrice, setBillPrice] = useState<number | ''>('');

  // Manual Accounting Entry State
  const [showAddJournal, setShowAddJournal] = useState(false);
  const [jrnType, setJrnType] = useState<'PENDAPATAN' | 'PENGELUARAN'>('PENGELUARAN');
  const [jrnCategory, setJrnCategory] = useState<AccountingEntry['category']>('OPERASIONAL');
  const [jrnAccountCode, setJrnAccountCode] = useState('');
  const [jrnAccountName, setJrnAccountName] = useState('');
  const [jrnDesc, setJrnDesc] = useState('');
  const [jrnAmount, setJrnAmount] = useState<number | ''>('');

  const [selectedBridgingLog, setSelectedBridgingLog] = useState<BridgingLog | null>(
    workspace.bridgingLogs[0] || null
  );
  const [isSyncingBridging, setIsSyncingBridging] = useState(false);

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const filteredInvoices = useMemo(() => {
    const q = invSearch.trim().toLowerCase();
    return workspace.invoices.filter((inv) => {
      if (invStatusFilter !== 'ALL' && inv.status !== invStatusFilter) return false;
      if (invGuarantorFilter !== 'ALL' && inv.guarantor !== invGuarantorFilter) return false;
      if (q) {
        const hay = `${inv.invoiceNumber} ${inv.patientName} ${inv.mrNumber} ${inv.guarantor}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [workspace.invoices, invSearch, invStatusFilter, invGuarantorFilter]);

  const handlePayInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvoice || !paymentMethod || selectedInvoice.pricingStatus === 'PENDING') return;
    setFeedback(null);
    setIsSettling(true);
    try {
      const updated = await kaelApi.payInvoice(token, facilityCode, selectedInvoice.id, {
        paymentMethod,
        discountAmount: Number(discountAmount) || 0,
      });
      setSelectedInvoice(updated);
      await onRefreshWorkspace();
      setFeedback({
        type: 'success',
        text: `Tagihan ${updated.invoiceNumber} (${updated.patientName}) diperbarui menjadi ${updated.status} pada catatan lokal.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal memproses pembayaran kasir.',
      });
    } finally {
      setIsSettling(false);
    }
  };

  const openPricingEditor = () => {
    if (!selectedInvoice) return;
    setPricingDraft([
      ...selectedInvoice.items.map(({ category, description, quantity, unitPrice }) => ({ category, description, quantity, unitPrice })),
      ...(selectedInvoice.unpricedItems || []).map(({ category, description, quantity }) => ({ category, description, quantity, unitPrice: '' as const })),
    ]);
  };

  const handleSavePricing = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedInvoice || !pricingDraft?.length || pricingDraft.some((item) => item.unitPrice === '' || !Number.isFinite(item.unitPrice) || item.unitPrice < 0 || !Number.isFinite(item.quantity) || item.quantity <= 0)) {
      setFeedback({ type: 'error', text: 'Isi harga setiap komponen sesuai tarif fasilitas. Isi 0 secara eksplisit untuk layanan tanpa biaya.' });
      return;
    }
    setIsSavingPrices(true);
    setFeedback(null);
    try {
      const updated = await kaelApi.updateInvoicePricing(token, facilityCode, selectedInvoice.id, {
        items: pricingDraft.map((item) => ({ ...item, unitPrice: Number(item.unitPrice) })),
      });
      setSelectedInvoice(updated);
      setPricingDraft(null);
      await onRefreshWorkspace();
      setFeedback({ type: 'success', text: `Tarif tagihan ${updated.invoiceNumber} berhasil ditetapkan. Pembayaran belum dicatat.` });
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Gagal menetapkan tarif tagihan.' });
    } finally {
      setIsSavingPrices(false);
    }
  };

  const handleAddBillItemSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvoice || !billDesc.trim() || billPrice === '' || !Number.isFinite(Number(billPrice)) || Number(billPrice) < 0) return;
    setFeedback(null);
    try {
      const updated = await kaelApi.addInvoiceItem(token, facilityCode, selectedInvoice.id, {
        category: billCategory,
        description: billDesc.trim(),
        quantity: Number(billQty),
        unitPrice: Number(billPrice),
      });
      setSelectedInvoice(updated);
      setBillDesc('');
      setShowAddBillItem(false);
      await onRefreshWorkspace();
      setFeedback({
        type: 'success',
        text: `Komponen biaya tambahan berhasil dimasukkan ke tagihan ${updated.invoiceNumber}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal menambah item biaya.',
      });
    }
  };

  const handleCreateJournalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jrnDesc.trim() || !jrnAccountCode.trim() || !jrnAccountName.trim() || !Number.isFinite(Number(jrnAmount)) || Number(jrnAmount) <= 0) return;
    setFeedback(null);
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
        text: `Jurnal ${created.entryNumber} (${created.type}) sebesar ${formatRupiah(
          created.amount
        )} berhasil dicatat pada fasilitas.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal mencatat jurnal akuntansi.',
      });
    }
  };

  const handleExportAccountingCsv = () => {
    const headers = [
      'No Jurnal',
      'Waktu',
      'Kode Akun',
      'Nama Akun',
      'Tipe',
      'Kategori',
      'Deskripsi',
      'Nominal IDR',
    ];
    const rows = workspace.accountingEntries.map((acc) => [
      acc.entryNumber,
      acc.timestamp,
      acc.accountCode,
      acc.accountName,
      acc.type,
      acc.category,
      `"${acc.description.replace(/"/g, '""')}"`,
      acc.amount,
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `jurnal-akuntansi-${facilityCode.toLowerCase()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleTriggerBridging = async (
    targetSystem: BridgingLog['targetSystem'],
    resourceType: string
  ) => {
    setIsSyncingBridging(true);
    setFeedback(null);
    try {
      const log = await kaelApi.triggerBridgingSync(token, facilityCode, {
        targetSystem,
        resourceType,
        patientName: '',
        payloadPreview: { facilityCode, requestedAt: new Date().toISOString() },
      });
      setSelectedBridgingLog(log);
      await onRefreshWorkspace();
      setFeedback({
        type: 'success',
        text: `Permintaan untuk ${targetSystem.replace(/_/g, ' ')} tercatat dalam antrean lokal.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal melakukan sinkronisasi bridging.',
      });
    } finally {
      setIsSyncingBridging(false);
    }
  };

  const totalRevenue = workspace.accountingEntries
    .filter((a) => a.type === 'PENDAPATAN')
    .reduce((sum, a) => sum + a.amount, 0);
  const totalExpense = workspace.accountingEntries
    .filter((a) => a.type === 'PENGELUARAN')
    .reduce((sum, a) => sum + a.amount, 0);

  const canRead = (collection: string) => workspace.dataAccess?.[collection] !== false;
  const canReadClinicalData = workspace.dataAccess?.soapRecords ?? (workspace.user.role === 'SUPERUSER' ||
    grantedModules.includes('RME_DOKTER') || grantedModules.includes('SEMUA_PASIEN'));
  const ledgerEmptyState = canRead('accountingEntries') ? 'Belum ada transaksi' : 'Data transaksi tidak tersedia untuk akses akun ini';

  const diagnosisCounts = useMemo(() => {
    const counts = new Map<string, { code: string; name: string; count: number }>();
    for (const record of workspace.soapRecords) {
      const code = record.assessment.primaryIcd10Code?.trim();
      if (!code) continue;
      const current = counts.get(code);
      if (current) current.count += 1;
      else counts.set(code, { code, name: record.assessment.primaryIcd10Name, count: 1 });
    }
    return [...counts.values()].sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));
  }, [workspace.soapRecords]);

  const cashierExportColumns: ExportColumn<Record<string, unknown>>[] =
    activeTab === 'BRIDGING'
      ? [
          { key: 'targetSystem', header: 'Penyedia' },
          { key: 'patientName', header: 'Sumber Data / Pasien' },
          { key: 'resourceType', header: 'Resource FHIR / Endpoint' },
          { key: 'status', header: 'Tahap / Status' },
          { key: 'latencyMs', header: 'Latensi ms', format: (row) => row.status !== 'QUEUED_LOCAL' && typeof row.latencyMs === 'number' && row.latencyMs > 0 ? row.latencyMs : 'Belum tersedia' },
          { key: 'timestamp', header: 'Dibuat' },
          { key: 'externalId', header: 'ID Referensi' },
        ]
      : activeTab === 'AKUNTANSI'
      ? [
          { key: 'entryNumber', header: 'No. Jurnal' },
          { key: 'timestamp', header: 'Waktu' },
          { key: 'accountCode', header: 'Kode COA' },
          { key: 'accountName', header: 'Nama Akun' },
          { key: 'type', header: 'Tipe' },
          { key: 'category', header: 'Kategori' },
          { key: 'description', header: 'Uraian' },
          { key: 'amount', header: 'Nominal' },
        ]
      : [
          { key: 'invoiceNumber', header: 'No. Invoice' },
          { key: 'patientName', header: 'Nama Pasien' },
          { key: 'mrNumber', header: 'No. RM' },
          { key: 'guarantor', header: 'Penjamin' },
          { key: 'subtotal', header: 'Subtotal Tagihan' },
          { key: 'status', header: 'Status Pembayaran' },
        ];

  const cashierExportRows = (
    activeTab === 'BRIDGING'
      ? workspace.bridgingLogs
      : activeTab === 'AKUNTANSI'
      ? workspace.accountingEntries
      : filteredInvoices
  ) as unknown as Record<string, unknown>[];

  return (
    <div className="min-w-0 space-y-3">
      {/* Modern Header matching satusehat-workspace_f279793b.png */}
      <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-xl p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-[#0F2922] dark:text-white tracking-tight mt-0.5">
              {activeTab === 'BRIDGING'
                ? 'Antrean integrasi layanan'
                : activeTab === 'AKUNTANSI'
                ? 'Jurnal kas harian & buku besar kasir'
                : activeTab === 'REGULASI' ? 'Indikator dan pelaporan' : 'Kasir & penagihan pasien'}
            </h1>
            <p className="text-xs text-[#52736B] dark:text-[#86B5A9] mt-0.5">
              {activeTab === 'BRIDGING'
                ? 'Permintaan integrasi dicatat dalam antrean lokal. Pengiriman dan respons provider belum tersedia.'
                : activeTab === 'REGULASI' ? 'Indikator dan ringkasan lokal menggunakan data serta periode yang dipilih.' : 'Pencatatan tagihan, penerimaan, dan pengeluaran fasilitas.'}
            </p>
          </div>
        </div>

        {allowedTabs.length > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            {allowedTabs.includes('KASIR') && (
            <button
              type="button"
              onClick={() => setActiveTab('KASIR')}
              className={`px-4 py-2 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'KASIR'
                  ? 'bg-[#00897B] text-white'
                  : 'bg-[#F3F8F6] dark:bg-[#081916] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
              }`}
            >
              <CreditCard className="w-3.5 h-3.5" />
              Kasir &amp; Penagihan ({workspace.invoices.length})
            </button>
            )}
            {allowedTabs.includes('AKUNTANSI') && (
            <button
              type="button"
              onClick={() => setActiveTab('AKUNTANSI')}
              className={`px-4 py-2 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'AKUNTANSI'
                  ? 'bg-[#00897B] text-white'
                  : 'bg-[#F3F8F6] dark:bg-[#081916] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Jurnal Kas Harian ({workspace.accountingEntries.length})
            </button>
            )}
            {allowedTabs.includes('BRIDGING') && (
            <button
              type="button"
              onClick={() => setActiveTab('BRIDGING')}
              className={`px-4 py-2 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'BRIDGING'
                  ? 'bg-[#00897B] text-white'
                  : 'bg-[#F3F8F6] dark:bg-[#081916] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              Antrean SATUSEHAT • BPJS • IoMT ({workspace.bridgingLogs.length})
            </button>
            )}
            {allowedTabs.includes('REGULASI') && (
            <button
              type="button"
              onClick={() => setActiveTab('REGULASI')}
              className={`px-4 py-2 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'REGULASI'
                  ? 'bg-[#00897B] text-white'
                  : 'bg-[#F3F8F6] dark:bg-[#081916] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Indikator dan pelaporan
            </button>
            )}
          </div>

          {activeTab === 'AKUNTANSI' && allowedTabs.includes('AKUNTANSI') && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAddJournal((prev) => !prev)}
                className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-[#00897B] text-white hover:bg-[#00796B] flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Catat Jurnal Manual
              </button>
            </div>
          )}
        </div>
        )}
      </div>

      {feedback && (
        <div
          role="status"
          className={`p-3.5 rounded-xl border text-xs font-medium flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
              : 'bg-red-50 dark:bg-red-950/60 border-red-200 dark:border-red-800 text-red-900 dark:text-red-200'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="underline ml-4 whitespace-nowrap"
          >
            Tutup
          </button>
        </div>
      )}

      {/* TAB 1: KASIR & BILLING */}
      {activeTab === 'KASIR' && allowedTabs.includes('KASIR') && (
        <div className="min-w-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-form-min-inline-size)),1fr))] gap-4 items-start">
          {/* Left 5 Cols: Invoice Queue with Complete Filter Bar */}
          <div className="min-w-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Daftar Tagihan Pasien ({filteredInvoices.length} dari {workspace.invoices.length})
              </h2>
              <DataExportToolbar
                title="Rekapitulasi Tagihan & Kasir Pasien"
                filenameBase={`KAEL_Tagihan_${facilityCode}`}
                facilityName={workspace.activeFacility.name}
                facilityCode={facilityCode}
                columns={cashierExportColumns}
                rows={cashierExportRows}
                compact
                contextLabel="Ekspor Tagihan"
              />
            </div>

            {/* Invoice Filter Controls */}
            <div className="space-y-2 text-xs">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={invSearch}
                  onChange={(e) => setInvSearch(e.target.value)}
                  placeholder="Cari No. Invoice, Nama Pasien, No. RM..."
                  className="min-w-0 w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div className="min-w-0 grid grid-cols-2 gap-2">
                <select
                  value={invStatusFilter}
                  onChange={(e) => setInvStatusFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="ALL">Semua Status</option>
                  <option value="BELUM_LUNAS">Belum Lunas</option>
                  <option value="LUNAS">Sudah Lunas</option>
                  <option value="KLAIM_DIAJUKAN">Klaim BPJS Diajukan</option>
                </select>
                <select
                  value={invGuarantorFilter}
                  onChange={(e) => setInvGuarantorFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="ALL">Semua Penjamin</option>
                  <option value="BPJS_KESEHATAN">BPJS Kesehatan</option>
                  <option value="UMUM">Pasien Umum</option>
                  <option value="ASURANSI_SWASTA">Asuransi Swasta</option>
                  <option value="KORPORASI">Korporasi</option>
                </select>
              </div>
            </div>

            <div className="space-y-2.5">
              {filteredInvoices.map((inv) => {
                const isSelected = selectedInvoice?.id === inv.id;
                const isPaid = inv.status === 'LUNAS';
                return (
                  <button
                    key={inv.id}
                    type="button"
                    onClick={() => {
                      setSelectedInvoice(inv);
                      setPricingDraft(null);
                      setPaymentMethod(inv.status === 'BELUM_LUNAS' ? '' : inv.paymentMethod);
                      setDiscountAmount(inv.discountAmount);
                    }}
                    className={`w-full text-left p-3.5 rounded-lg border transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-emerald-700 dark:border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/40'
                        : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="font-bold text-emerald-800 dark:text-emerald-300">
                        {inv.invoiceNumber}
                      </span>
                      <span
                        className={
                          isPaid
                            ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                            : 'text-amber-600 dark:text-amber-400 font-semibold'
                        }
                      >
                        {inv.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 mt-1">
                      {inv.patientName} ({inv.mrNumber})
                    </div>
                    <div className="flex items-center justify-between text-caption font-mono text-slate-500 mt-1">
                      <span>Penjamin: {inv.guarantor.replace(/_/g, ' ')}</span>
                      <strong className="text-slate-900 dark:text-slate-100">
                        {inv.pricingStatus === 'PENDING' ? 'Komponen berharga sementara' : 'Total'}: {formatRupiah(inv.subtotal)}
                      </strong>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right 7 Cols: Itemized Invoice Settlement & Kwitansi */}
          <div className="min-w-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4">
            {!selectedInvoice ? (
              <div className="text-xs text-slate-500 py-5 px-4 text-center">
                Pilih tagihan untuk mencatat pembayaran atau mencetak tampilan tagihan.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
                  <div>
                    <div className="text-xs font-mono text-teal-700 dark:text-teal-400 font-semibold">
                      No. Invoice: {selectedInvoice.invoiceNumber} · Penjamin:{' '}
                      {selectedInvoice.guarantor.replace(/_/g, ' ')}
                    </div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                      Rincian Tagihan Layanan — {selectedInvoice.patientName} (
                      {selectedInvoice.mrNumber})
                    </h3>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedInvoice.status === 'BELUM_LUNAS' && <button type="button" onClick={openPricingEditor} className="px-3 py-1.5 text-xs font-semibold rounded border border-teal-600 text-teal-700 dark:text-teal-300">{selectedInvoice.pricingStatus === 'PENDING' ? 'Lengkapi tarif' : 'Tinjau tarif'}</button>}
                    {selectedInvoice.status === 'BELUM_LUNAS' && (
                      <button
                        type="button"
                        onClick={() => setShowAddBillItem((prev) => !prev)}
                        className="px-3 py-1.5 text-xs font-semibold rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Tambah Biaya
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="px-3 py-1.5 text-xs font-semibold rounded border border-slate-300 dark:border-slate-700 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Cetak tampilan tagihan
                    </button>
                  </div>
                </div>

                {selectedInvoice.pricingStatus === 'PENDING' && <div className="p-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/40 text-xs text-amber-900 dark:text-amber-200">Tarif belum lengkap. Nilai yang terlihat hanya mencakup komponen yang telah diberi harga; pembayaran belum dapat dicatat.</div>}
                {pricingDraft && <form onSubmit={handleSavePricing} className="p-4 rounded-lg border border-teal-600 space-y-3 text-xs">
                  <p className="font-semibold">Tinjau seluruh tarif fasilitas. Isian kosong berarti belum ditetapkan; 0 berarti tanpa biaya.</p>
                  {pricingDraft.map((item, index) => <label key={`${item.category}-${index}`} className="min-w-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-field-min-inline-size)),1fr))] gap-2 items-center"><span className="min-w-0 break-words">{item.description} · {item.quantity} unit ({item.category})</span><input type="number" min={0} step="any" required value={item.unitPrice} aria-label={`Tarif ${item.description}`} onChange={(event) => setPricingDraft((previous) => previous?.map((row, rowIndex) => rowIndex === index ? { ...row, unitPrice: event.target.value === '' ? '' : Number(event.target.value) } : row) || null)} className="min-w-0 w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" /></label>)}
                  <div className="flex flex-wrap gap-3"><button type="submit" disabled={isSavingPrices} className="px-3 py-2 rounded bg-teal-700 text-white disabled:opacity-50">{isSavingPrices ? 'Menyimpan...' : 'Tetapkan seluruh tarif'}</button><button type="button" onClick={() => setPricingDraft(null)}>Batal</button></div>
                </form>}

                {showAddBillItem && (
                  <form
                    onSubmit={handleAddBillItemSubmit}
                    className="min-w-0 p-3.5 rounded-lg border border-teal-600 bg-slate-50 dark:bg-slate-800/60 grid grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-field-min-inline-size)),1fr))] gap-2.5 items-end text-xs"
                  >
                    <div className="min-w-0">
                      <label className="block text-caption font-semibold mb-1">Kategori</label>
                      <select
                        value={billCategory}
                        onChange={(e) =>
                          setBillCategory(e.target.value as typeof billCategory)
                        }
                        className="min-w-0 w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                      >
                        <option value="TINDAKAN">TINDAKAN</option>
                        <option value="KONSULTASI">KONSULTASI</option>
                        <option value="FARMASI">FARMASI / ALKES</option>
                        <option value="LABORATORIUM">LABORATORIUM</option>
                        <option value="KAMAR_INAP">KAMAR INAP</option>
                        <option value="PENDAFTARAN">ADMINISTRASI / PENDAFTARAN</option>
                      </select>
                    </div>
                    <div className="min-w-0">
                      <label className="block text-caption font-semibold mb-1">Uraian Biaya</label>
                      <input
                        type="text"
                        value={billDesc}
                        onChange={(e) => setBillDesc(e.target.value)}
                        placeholder="Jasa Observasi / Alkes..."
                        required
                        className="min-w-0 w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                    </div>
                    <div className="min-w-0">
                      <label className="block text-caption font-semibold mb-1">Qty</label>
                      <input
                        type="number"
                        min={1}
                        value={billQty}
                        onChange={(e) => setBillQty(Number(e.target.value))}
                        className="min-w-0 w-full px-2 py-1.5 font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                    </div>
                    <div className="min-w-0">
                      <label className="block text-caption font-semibold mb-1">Tarif</label>
                      <input
                        type="number"
                        value={billPrice}
                        onChange={(e) => setBillPrice(e.target.value === '' ? '' : Number(e.target.value))}
                        min={0}
                        required
                        className="min-w-0 w-full px-2 py-1.5 font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                    </div>
                    <div className="col-span-full min-w-0 flex justify-end">
                      <button
                        type="submit"
                        className="px-4 py-1.5 rounded bg-teal-700 text-white font-semibold cursor-pointer"
                      >
                        Tambahkan ke Tagihan
                      </button>
                    </div>
                  </form>
                )}

                <form onSubmit={handlePayInvoice} className="space-y-4">
                  <div className="min-w-0 w-full overflow-x-auto">
                    <table className="w-full min-w-full table-auto [&_th]:whitespace-nowrap text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-caption text-slate-500">
                          <th className="py-2 px-3">Kategori</th>
                          <th className="py-2 px-3">Komponen Biaya</th>
                          <th className="py-2 px-3 text-right">Qty</th>
                          <th className="py-2 px-3 text-right">Harga Satuan</th>
                          <th className="py-2 px-3 text-right">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {selectedInvoice.items.map((item) => (
                          <tr key={item.id}>
                            <td className="py-2.5 px-3 font-mono text-caption text-slate-500">
                              {item.category}
                            </td>
                            <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-slate-100">
                              {item.description}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                              {item.quantity}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                              {formatRupiah(item.unitPrice)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">
                              {formatRupiah(item.subtotal)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2 text-xs font-mono tabular-nums">
                    <div className="flex justify-between">
                      <span className="text-slate-500">{selectedInvoice.pricingStatus === 'PENDING' ? 'Subtotal komponen berharga sementara:' : 'Subtotal tagihan:'}</span>
                      <span className="font-semibold">
                        {formatRupiah(selectedInvoice.subtotal)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Tagihan kepada penjamin (lokal):</span>
                      <span className="text-teal-700 dark:text-teal-400 font-semibold">
                        {formatRupiah(selectedInvoice.bpjsCoveredAmount)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm font-bold pt-2 border-t border-slate-200 dark:border-slate-800">
                      <span>{selectedInvoice.pricingStatus === 'PENDING' ? 'Perhitungan sementara pasien:' : 'Tagihan dibayar pasien:'}</span>
                      <span>{formatRupiah(selectedInvoice.patientPayableAmount)}</span>
                    </div>
                  </div>

                  {selectedInvoice.pricingStatus === 'PENDING' ? <p className="text-xs text-amber-700 dark:text-amber-300">Lengkapi tarif sebelum mencatat pembayaran atau pengajuan klaim.</p> : selectedInvoice.status === 'BELUM_LUNAS' ? (
                    <div className="min-w-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-field-min-inline-size)),1fr))] gap-3 items-end pt-2">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          Metode Pembayaran
                        </label>
                        <select
                          value={paymentMethod}
                          required
                          onChange={(e) =>
                            setPaymentMethod(e.target.value as InvoiceRecord['paymentMethod'] | '')
                          }
                          className="min-w-0 w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                        >
                          <option value="">Pilih metode pencatatan</option>
                          <option value="QRIS">QRIS</option>
                          <option value="TUNAI">Tunai Kasir</option>
                          <option value="DEBIT_KREDIT">Debit / Kartu Kredit</option>
                          <option value="KLAIM_BPJS">Pengajuan klaim BPJS (lokal)</option>
                          <option value="PIUTANG_ASURANSI">Piutang asuransi / korporasi</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          Potongan / Diskon
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={discountAmount}
                          onChange={(e) => setDiscountAmount(Number(e.target.value))}
                          className="min-w-0 w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={isSettling}
                        className="py-2 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold cursor-pointer"
                      >
                        {isSettling ? 'Memproses...' : 'Simpan pencatatan pembayaran'}
                      </button>
                    </div>
                  ) : (
                    <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>
                        Status tagihan lokal: {selectedInvoice.status}. Petugas: {selectedInvoice.cashierName || 'belum tercatat'}.
                        {selectedInvoice.status === 'KLAIM_DIAJUKAN' && ' Hasil verifikasi provider belum tersedia.'}
                      </span>
                    </div>
                  )}
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: BUKU BESAR AKUNTANSI & KEUANGAN */}
      {activeTab === 'AKUNTANSI' && allowedTabs.includes('AKUNTANSI') && (
        <div className="min-w-0 space-y-3">
          {showAddJournal && (
            <form
              onSubmit={handleCreateJournalSubmit}
              className="bg-white dark:bg-slate-900 border border-teal-600 rounded-xl p-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-field-min-inline-size)),1fr))] gap-3 items-end text-xs"
            >
              <div>
                <label className="block font-semibold mb-1">Tipe Transaksi</label>
                <select
                  value={jrnType}
                  onChange={(e) => {
                    const t = e.target.value as 'PENDAPATAN' | 'PENGELUARAN';
                    setJrnType(t);
                  }}
                  className="min-w-0 w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="PENGELUARAN">PENGELUARAN — Beban</option>
                  <option value="PENDAPATAN">PENDAPATAN — Penerimaan</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Kategori</label>
                <select
                  value={jrnCategory}
                  onChange={(e) =>
                    setJrnCategory(e.target.value as AccountingEntry['category'])
                  }
                  className="min-w-0 w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="OPERASIONAL">OPERASIONAL</option>
                  <option value="PENGADAAN_OBAT">PENGADAAN OBAT</option>
                  <option value="LAYANAN_MEDIS">LAYANAN MEDIS</option>
                  <option value="KLAIM_BPJS">KLAIM BPJS</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Kode COA</label>
                <input
                  type="text"
                  value={jrnAccountCode}
                  required
                  onChange={(e) => setJrnAccountCode(e.target.value)}
                  className="min-w-0 w-full px-2.5 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Nama akun COA</label>
                <input type="text" value={jrnAccountName} onChange={(event) => setJrnAccountName(event.target.value)}
                  required className="min-w-0 w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
              </div>
              <div className="">
                <label className="block font-semibold mb-1">Uraian Jurnal</label>
                <input
                  type="text"
                  value={jrnDesc}
                  onChange={(e) => setJrnDesc(e.target.value)}
                  placeholder="Contoh: Pembayaran Oksigen Medis / Kalibrasi Alat Lab"
                  required
                  className="min-w-0 w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Nominal</label>
                <input
                  type="number"
                  value={jrnAmount}
                  onChange={(e) => setJrnAmount(e.target.value === '' ? '' : Number(e.target.value))}
                  min={1}
                  required
                  className="min-w-0 w-full px-2.5 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-teal-700 text-white font-semibold cursor-pointer"
                >
                  Simpan catatan transaksi
                </button>
              </div>
            </form>
          )}

          <div className="min-w-0 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-500">Pemasukan tercatat</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 mt-1">
                {workspace.accountingEntries.length ? formatRupiah(totalRevenue) : ledgerEmptyState}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-500">
                Pengeluaran tercatat
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums text-amber-700 dark:text-amber-400 mt-1">
                {workspace.accountingEntries.length ? formatRupiah(totalExpense) : ledgerEmptyState}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-500">Selisih pemasukan dan pengeluaran</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                {workspace.accountingEntries.length ? formatRupiah(totalRevenue - totalExpense) : ledgerEmptyState}
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Jurnal kas harian
              </h2>
              <DataExportToolbar
                title="Jurnal Kas Harian Fasilitas"
                filenameBase={`KAEL_Jurnal_Kasir_${facilityCode}`}
                facilityName={workspace.activeFacility.name}
                facilityCode={facilityCode}
                columns={cashierExportColumns}
                rows={cashierExportRows}
                compact
                contextLabel="Ekspor Buku Besar"
              />
            </div>
            <div className="min-w-0 w-full overflow-x-auto">
              <table className="w-full min-w-full table-auto [&_th]:whitespace-nowrap text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-caption text-slate-500 bg-slate-50/70 dark:bg-slate-800/50">
                    <th className="py-2.5 px-4">No. Jurnal &amp; Waktu</th>
                    <th className="py-2.5 px-4">Kode &amp; Nama Akun COA</th>
                    <th className="py-2.5 px-4">Uraian Transaksi</th>
                    <th className="py-2.5 px-4">Referensi</th>
                    <th className="py-2.5 px-4 text-right">Nominal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {workspace.accountingEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                        <div className="font-bold">{entry.entryNumber}</div>
                        <div className="text-caption text-slate-500">
                          {new Date(entry.timestamp).toLocaleString('id-ID')}
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-mono font-semibold text-teal-800 dark:text-teal-300">
                          {entry.accountCode}
                        </div>
                        <div className="text-caption text-slate-500">{entry.accountName}</div>
                      </td>
                      <td className="py-3 px-4 text-slate-800 dark:text-slate-200">
                        {entry.description}
                      </td>
                      <td className="py-3 px-4 font-mono text-caption text-slate-500 whitespace-nowrap">
                        {entry.referenceId}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-mono tabular-nums font-bold whitespace-nowrap ${
                          entry.type === 'PENDAPATAN'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        {entry.type === 'PENDAPATAN' ? '+' : '-'} {formatRupiah(entry.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: BRIDGING SATUSEHAT KEMENKES, BPJS P-CARE/V-CLAIM & IOMT */}
      {activeTab === 'BRIDGING' && allowedTabs.includes('BRIDGING') && (
        <div className="min-w-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-form-min-inline-size)),1fr))] gap-4 items-start">
          {/* Left 7 Cols: Bridging Actions & Log Table */}
          <div className="min-w-0 space-y-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Antrean lokal SATUSEHAT, BPJS &amp; IoMT
                </h2>
                <p className="text-xs text-slate-500">
                  Org ID: {workspace.activeFacility.satusehatOrgId || 'belum diisi'} · Kode P-Care/V-Claim:{' '}
                  {workspace.activeFacility.bpjsPcareCode || 'belum diisi'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isSyncingBridging}
                  onClick={() =>
                    handleTriggerBridging(
                      'SATUSEHAT_FHIR_R4',
                      'Permintaan pemrosesan SATUSEHAT'
                    )
                  }
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-teal-700 hover:bg-teal-800 text-white flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingBridging ? 'animate-spin' : ''}`} />
                  Antrekan permintaan SATUSEHAT
                </button>
                <button
                  type="button"
                  disabled={isSyncingBridging}
                  onClick={() =>
                    handleTriggerBridging(
                      'BPJS_PCARE',
                      'Permintaan pemrosesan BPJS'
                    )
                  }
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Antrekan permintaan BPJS
                </button>
                <button
                  type="button"
                  disabled={isSyncingBridging}
                  onClick={() =>
                    handleTriggerBridging(
                      'IOMT_GATEWAY',
                      'Permintaan koneksi IoMT'
                    )
                  }
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1 cursor-pointer"
                >
                  <Cpu className="w-3.5 h-3.5" />
                  Antrekan permintaan IoMT
                </button>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50/50 dark:bg-slate-800/30">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Catatan antrean integrasi ({workspace.bridgingLogs.length})
                </span>
                <DataExportToolbar
                  title="Catatan antrean SATUSEHAT, BPJS & IoMT"
                  filenameBase={`KAEL_Bridging_${facilityCode}`}
                  facilityName={workspace.activeFacility.name}
                  facilityCode={facilityCode}
                  columns={cashierExportColumns}
                  rows={cashierExportRows}
                  compact
                  contextLabel="Ekspor Log"
                />
              </div>
              <div className="min-w-0 w-full overflow-x-auto">
              <table className="w-full min-w-full table-auto [&_th]:whitespace-nowrap text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-caption text-slate-500 bg-slate-50/70 dark:bg-slate-800/50">
                    <th className="py-2.5 px-4">Target Gateway</th>
                    <th className="py-2.5 px-4">Resource &amp; Pasien</th>
                    <th className="py-2.5 px-4">Status tercatat</th>
                    <th className="py-2.5 px-4 text-right">Payload</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {workspace.bridgingLogs.length === 0 && <tr><td colSpan={4} className="p-4 text-center text-slate-500">Belum ada permintaan integrasi yang tercatat.</td></tr>}
                  {workspace.bridgingLogs.map((log) => (
                    <tr
                      key={log.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    >
                      <td className="py-3 px-4 font-mono text-caption font-bold text-teal-800 dark:text-teal-300 whitespace-nowrap">
                        {log.targetSystem.replace(/_/g, ' ')}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {log.resourceType}
                        </div>
                        <div className="text-caption text-slate-500">{log.patientName || 'Permintaan fasilitas'}</div>
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-caption whitespace-nowrap">
                        <div className="text-slate-700 dark:text-slate-300 font-semibold">
                          {log.status}
                        </div>
                        {log.status !== 'QUEUED_LOCAL' && log.latencyMs > 0 && <div className="text-slate-500">{log.latencyMs} ms</div>}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setSelectedBridgingLog(log)}
                          className="px-2.5 py-1 text-xs font-medium rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          Inspeksi JSON
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          </div>

          {/* Right 5 Cols: FHIR R4 / BPJS Payload JSON Inspector */}
          <div className="min-w-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Detail permintaan integrasi
            </h3>
            {selectedBridgingLog ? (
              <div className="space-y-2 text-xs font-mono">
                <div className="text-caption text-slate-500">
                  Referensi tercatat: <strong>{selectedBridgingLog.externalId || 'belum tersedia'}</strong>
                </div>
                <pre className="p-3.5 rounded-lg bg-slate-950 text-slate-100 overflow-x-auto text-caption leading-relaxed">
                  {JSON.stringify(selectedBridgingLog.payloadPreview, null, 2)}
                </pre>
              </div>
            ) : (
              <div className="text-xs text-slate-500 py-6 text-center">
                Pilih log untuk melihat struktur JSON payload.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: LAPORAN REGULASI KEMENKES SIRS RL 1-5 / LB1-LB4 & ORKESTRASI RUJUKAN */}
      {activeTab === 'REGULASI' && allowedTabs.includes('REGULASI') && (
        <div className="min-w-0 space-y-3">
          <ServiceIndicators workspace={workspace} />
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 text-sm text-slate-500">
            Format, periode, dan pengiriman laporan SIRS/LB belum dikonfigurasi. Ringkasan berikut hanya menggunakan rekam medis serta rujukan yang tersimpan.
          </div>
          <div className="min-w-0 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-1">
              <div className="text-caption font-semibold text-slate-500">
                Klasifikasi fasilitas yang tersimpan
              </div>
              <div className="text-base font-bold text-slate-900 dark:text-slate-100">
                {workspace.activeFacility.permenkes6_2026Class || 'Belum diisi'}
              </div>
              <div className="font-mono text-caption text-teal-700 dark:text-teal-400">
                Kode registrasi: {workspace.activeFacility.kemenkesCode || 'belum diisi'}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-1">
              <div className="text-caption font-semibold text-slate-500">
                Diagnosis utama yang tercatat
              </div>
              <div className="text-base font-bold text-slate-900 dark:text-slate-100">
                {canReadClinicalData ? diagnosisCounts.reduce((total, diagnosis) => total + diagnosis.count, 0) + ' rekam medis dengan kode ICD-10' : 'Data rekam medis tidak tersedia untuk akses akun ini'}
              </div>
              <div className="font-mono text-caption text-slate-500">
                {canReadClinicalData && diagnosisCounts[0]
                  ? 'Terbanyak: ' + diagnosisCounts[0].code + ' — ' + diagnosisCounts[0].name + ' (' + diagnosisCounts[0].count + ' catatan)'
                  : canReadClinicalData ? 'Belum ada diagnosis yang tercatat' : 'Memerlukan izin pembacaan rekam medis'}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-1">
              <div className="text-caption font-semibold text-slate-500">
                Catatan rujukan lokal
              </div>
              <div className="text-base font-bold text-slate-900 dark:text-slate-100">
                {canRead('referrals') ? (workspace.referrals || []).length + ' rujukan lintas fasilitas' : 'Data rujukan tidak tersedia untuk akses akun ini'}
              </div>
              <div className="font-mono text-caption text-emerald-700 dark:text-emerald-400">
                Status mengikuti catatan rujukan yang tersimpan
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Daftar rujukan lokal ({(workspace.referrals || []).length})
              </span>
            </div>
            <div className="min-w-0 w-full overflow-x-auto">
            <table className="w-full min-w-full table-auto [&_th]:whitespace-nowrap text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-caption text-slate-500 bg-slate-50 dark:bg-slate-800/50">
                  <th className="py-2.5 px-4">No. Rujukan &amp; Tipe</th>
                  <th className="py-2.5 px-4">Pasien</th>
                  <th className="py-2.5 px-4">Faskes Asal → Tujuan</th>
                  <th className="py-2.5 px-4">Diagnosis ICD-10 &amp; Indikasi</th>
                  <th className="py-2.5 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {!(workspace.referrals || []).length && <tr><td colSpan={5} className="p-4 text-center text-slate-500">{canRead('referrals') ? 'Belum ada rujukan yang tercatat.' : 'Data rujukan tidak tersedia untuk akses akun ini.'}</td></tr>}
                {(workspace.referrals || []).map((ref) => (
                  <tr key={ref.id}>
                    <td className="py-3 px-4 font-mono">
                      <div className="font-bold text-slate-900 dark:text-slate-100">
                        {ref.referralNumber}
                      </div>
                      <div className="text-caption text-teal-700 dark:text-teal-400">
                        {ref.referralType}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                      {ref.patientName}
                    </td>
                    <td className="py-3 px-4 font-mono text-caption">
                      {ref.originFacilityCode} → {ref.destinationFacilityName}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold">
                        {ref.primaryIcd10Code} — {ref.primaryIcd10Name}
                      </div>
                      <div className="text-caption text-slate-500">{ref.clinicalReason}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-caption font-bold text-emerald-700 dark:text-emerald-400">
                      {ref.status}
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
