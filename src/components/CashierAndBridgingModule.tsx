import React, { useMemo, useState } from 'react';
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
import { AccountingEntry, BridgingLog, InvoiceRecord } from '../types/simrs';
import { kaelApi, WorkspacePayload } from '../utils/apiClient';
import { formatRupiah } from '../utils/clinicalLogic';
import { DataExportToolbar } from './DataExportToolbar';
import { ExportColumn } from '../utils/exportDocument';

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
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRecord | null>(
    workspace.invoices[0] || null
  );
  const [paymentMethod, setPaymentMethod] = useState<InvoiceRecord['paymentMethod']>('QRIS');
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
  const [billPrice, setBillPrice] = useState(75000);

  // Manual Accounting Entry State
  const [showAddJournal, setShowAddJournal] = useState(false);
  const [jrnType, setJrnType] = useState<'PENDAPATAN' | 'PENGELUARAN'>('PENGELUARAN');
  const [jrnCategory, setJrnCategory] = useState<AccountingEntry['category']>('OPERASIONAL');
  const [jrnAccountCode, setJrnAccountCode] = useState('5-3010');
  const [jrnAccountName, setJrnAccountName] = useState('Beban Operasional & Utilitas Faskes');
  const [jrnDesc, setJrnDesc] = useState('');
  const [jrnAmount, setJrnAmount] = useState(250000);

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
    if (!selectedInvoice) return;
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
        text: `Tagihan ${updated.invoiceNumber} (${updated.patientName}) berhasil diselesaikan dengan status ${updated.status} dan dicatat otomatis ke Buku Besar Akuntansi.`,
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

  const handleAddBillItemSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvoice || !billDesc.trim()) return;
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
    if (!jrnDesc.trim() || jrnAmount <= 0) return;
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
        )} berhasil diposting ke Buku Besar.`,
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
        patientName: workspace.visits[0]?.patientName || 'Sinkronisasi Faskes Kolektif',
        payloadPreview:
          targetSystem === 'IOMT_GATEWAY'
            ? {
                deviceProtocol: 'HL7-MLLP / IEEE-11073 Bedside Monitor',
                port: workspace.serverConfig.iomtListenPort,
                facilityCode,
                capturedVitals: {
                  systolic: 124,
                  diastolic: 78,
                  heartRate: 76,
                  spo2: 99,
                  temperature: 36.5,
                  ecgLeadII: 'Sinus Rhythm Normal',
                },
                timestamp: new Date().toISOString(),
              }
            : {
                resourceType: 'Bundle',
                facilityCode,
                satusehatOrgId: workspace.activeFacility.satusehatOrgId,
                bpjsCode: workspace.activeFacility.bpjsPcareCode,
                syncedVisitsCount: workspace.visits.length,
                timestamp: new Date().toISOString(),
              },
      });
      setSelectedBridgingLog(log);
      await onRefreshWorkspace();
      setFeedback({
        type: 'success',
        text: `Sinkronisasi ke ${targetSystem.replace(/_/g, ' ')} berhasil (HTTP 200 · Latency ${log.latencyMs} ms · Ref: ${log.externalId}).`,
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

  const cashierExportColumns: ExportColumn<Record<string, unknown>>[] =
    activeTab === 'BRIDGING'
      ? [
          { key: 'targetSystem', header: 'Penyedia' },
          { key: 'patientName', header: 'Sumber Data / Pasien' },
          { key: 'resourceType', header: 'Resource FHIR / Endpoint' },
          { key: 'status', header: 'Tahap / Status' },
          { key: 'latencyMs', header: 'Latensi ms' },
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
          { key: 'totalAmount', header: 'Total Tagihan' },
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
    <div className="space-y-5">
      {/* Modern Header matching satusehat-workspace_f279793b.png */}
      <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#52736B] dark:text-[#86B5A9]">
              {workspace.activeFacility.name.toUpperCase()} • {facilityCode}
            </p>
            <h1 className="text-2xl font-bold text-[#0F2922] dark:text-white tracking-tight mt-0.5">
              {activeTab === 'BRIDGING'
                ? 'Integrasi layanan • SATUSEHAT, BPJS & TTE'
                : activeTab === 'AKUNTANSI'
                ? 'Jurnal kas harian & buku besar kasir'
                : 'Kasir & penagihan pasien'}
            </h1>
            <p className="text-xs text-[#52736B] dark:text-[#86B5A9] mt-0.5">
              {activeTab === 'BRIDGING'
                ? 'Sinkronisasi bundle FHIR R4 SATUSEHAT Kemenkes, BPJS VClaim/PCare, dan gateway monitor IoMT.'
                : 'Penyelesaian tagihan layanan medis, farmasi, laboratorium, klaim JKN, dan ekspor dokumen resmi.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex flex-wrap items-center gap-2">
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
              SATUSEHAT • BPJS • TTE ({workspace.bridgingLogs.length})
            </button>
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
              Laporan SIRS RL/LB &amp; Rujukan ({(workspace.referrals || []).length})
            </button>
          </div>

          {activeTab === 'AKUNTANSI' && (
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
      {activeTab === 'KASIR' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left 5 Cols: Invoice Queue with Complete Filter Bar */}
          <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3.5">
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
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
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
                const isPaid = inv.status !== 'BELUM_LUNAS';
                return (
                  <button
                    key={inv.id}
                    type="button"
                    onClick={() => {
                      setSelectedInvoice(inv);
                      setPaymentMethod(inv.paymentMethod);
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
                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 mt-1">
                      <span>Penjamin: {inv.guarantor.replace(/_/g, ' ')}</span>
                      <strong className="text-slate-900 dark:text-slate-100">
                        Total: {formatRupiah(inv.subtotal)}
                      </strong>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right 7 Cols: Itemized Invoice Settlement & Kwitansi */}
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            {!selectedInvoice ? (
              <div className="text-xs text-slate-500 py-8 text-center">
                Pilih tagihan di sebelah kiri untuk memproses pembayaran atau mencetak kwitansi.
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
                      Cetak Kwitansi
                    </button>
                  </div>
                </div>

                {showAddBillItem && (
                  <form
                    onSubmit={handleAddBillItemSubmit}
                    className="p-3.5 rounded-lg border border-teal-600 bg-slate-50 dark:bg-slate-800/60 grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end text-xs"
                  >
                    <div className="sm:col-span-3">
                      <label className="block text-[11px] font-semibold mb-1">Kategori</label>
                      <select
                        value={billCategory}
                        onChange={(e) =>
                          setBillCategory(e.target.value as typeof billCategory)
                        }
                        className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                      >
                        <option value="TINDAKAN">TINDAKAN</option>
                        <option value="KONSULTASI">KONSULTASI</option>
                        <option value="FARMASI">FARMASI / ALKES</option>
                        <option value="LABORATORIUM">LABORATORIUM</option>
                        <option value="KAMAR_INAP">KAMAR INAP</option>
                        <option value="PENDAFTARAN">ADMINISTRASI / PENDAFTARAN</option>
                      </select>
                    </div>
                    <div className="sm:col-span-4">
                      <label className="block text-[11px] font-semibold mb-1">Uraian Biaya</label>
                      <input
                        type="text"
                        value={billDesc}
                        onChange={(e) => setBillDesc(e.target.value)}
                        placeholder="Jasa Observasi / Alkes..."
                        required
                        className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-semibold mb-1">Qty</label>
                      <input
                        type="number"
                        min={1}
                        value={billQty}
                        onChange={(e) => setBillQty(Number(e.target.value))}
                        className="w-full px-2 py-1.5 font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-[11px] font-semibold mb-1">Tarif</label>
                      <input
                        type="number"
                        value={billPrice}
                        onChange={(e) => setBillPrice(Number(e.target.value))}
                        className="w-full px-2 py-1.5 font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                    </div>
                    <div className="sm:col-span-12 flex justify-end">
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
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500">
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
                            <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500">
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
                      <span className="text-slate-500">Subtotal Tagihan:</span>
                      <span className="font-semibold">
                        {formatRupiah(selectedInvoice.subtotal)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Ditanggung Klaim BPJS Kesehatan:</span>
                      <span className="text-teal-700 dark:text-teal-400 font-semibold">
                        {formatRupiah(selectedInvoice.bpjsCoveredAmount)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm font-bold pt-2 border-t border-slate-200 dark:border-slate-800">
                      <span>Tagihan Dibayar Pasien:</span>
                      <span>{formatRupiah(selectedInvoice.patientPayableAmount)}</span>
                    </div>
                  </div>

                  {selectedInvoice.status === 'BELUM_LUNAS' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end pt-2">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          Metode Pembayaran
                        </label>
                        <select
                          value={paymentMethod}
                          onChange={(e) =>
                            setPaymentMethod(e.target.value as InvoiceRecord['paymentMethod'])
                          }
                          className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                        >
                          <option value="QRIS">QRIS Dinamis Rumah Sakit</option>
                          <option value="TUNAI">Tunai Kasir</option>
                          <option value="DEBIT_KREDIT">EDC Debit / Kartu Kredit</option>
                          <option value="KLAIM_BPJS">Verifikasi Klaim BPJS Penuh</option>
                          <option value="PIUTANG_ASURANSI">Jaminan Asuransi / Korporasi</option>
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
                          className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={isSettling}
                        className="py-2 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold cursor-pointer"
                      >
                        {isSettling ? 'Memproses...' : 'Selesaikan & Terbitkan Kwitansi'}
                      </button>
                    </div>
                  ) : (
                    <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>
                        Tagihan telah diselesaikan ({selectedInvoice.status}) oleh{' '}
                        {selectedInvoice.cashierName || 'Kasir Sentral'}.
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
      {activeTab === 'AKUNTANSI' && (
        <div className="space-y-5">
          {showAddJournal && (
            <form
              onSubmit={handleCreateJournalSubmit}
              className="bg-white dark:bg-slate-900 border border-teal-600 rounded-xl p-5 grid grid-cols-1 sm:grid-cols-6 gap-3 items-end text-xs"
            >
              <div>
                <label className="block font-semibold mb-1">Tipe Transaksi</label>
                <select
                  value={jrnType}
                  onChange={(e) => {
                    const t = e.target.value as 'PENDAPATAN' | 'PENGELUARAN';
                    setJrnType(t);
                    if (t === 'PENDAPATAN') {
                      setJrnAccountCode('4-1090');
                      setJrnAccountName('Pendapatan Layanan Non-Kapitasi');
                    } else {
                      setJrnAccountCode('5-3010');
                      setJrnAccountName('Beban Operasional & Utilitas Faskes');
                    }
                  }}
                  className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
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
                  className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
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
                  onChange={(e) => setJrnAccountCode(e.target.value)}
                  className="w-full px-2.5 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold mb-1">Uraian Jurnal</label>
                <input
                  type="text"
                  value={jrnDesc}
                  onChange={(e) => setJrnDesc(e.target.value)}
                  placeholder="Contoh: Pembayaran Oksigen Medis / Kalibrasi Alat Lab"
                  required
                  className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Nominal</label>
                <input
                  type="number"
                  value={jrnAmount}
                  onChange={(e) => setJrnAmount(Number(e.target.value))}
                  required
                  className="w-full px-2.5 py-2 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div className="sm:col-span-6 flex justify-end">
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-teal-700 text-white font-semibold cursor-pointer"
                >
                  Posting ke Buku Besar
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <div className="text-xs text-slate-500">Total Pendapatan Operasional &amp; Klaim</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 mt-1">
                {formatRupiah(totalRevenue)}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <div className="text-xs text-slate-500">
                Total Beban Pengadaan Obat &amp; Operasional
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums text-amber-700 dark:text-amber-400 mt-1">
                {formatRupiah(totalExpense)}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <div className="text-xs text-slate-500">Surplus / Arus Kas Bersih Faskes</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                {formatRupiah(totalRevenue - totalExpense)}
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Jurnal Umum &amp; Buku Besar Akuntansi — {facilityCode}
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
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 bg-slate-50/70 dark:bg-slate-800/50">
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
                        <div className="text-[11px] text-slate-500">
                          {new Date(entry.timestamp).toLocaleString('id-ID')}
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-mono font-semibold text-teal-800 dark:text-teal-300">
                          {entry.accountCode}
                        </div>
                        <div className="text-[11px] text-slate-500">{entry.accountName}</div>
                      </td>
                      <td className="py-3 px-4 text-slate-800 dark:text-slate-200">
                        {entry.description}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
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
      {activeTab === 'BRIDGING' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left 7 Cols: Bridging Actions & Log Table */}
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Interoperabilitas Nasional: SATUSEHAT FHIR R4, BPJS &amp; IoMT
                </h2>
                <p className="text-xs text-slate-500">
                  Org ID: {workspace.activeFacility.satusehatOrgId} · Kode P-Care/V-Claim:{' '}
                  {workspace.activeFacility.bpjsPcareCode}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isSyncingBridging}
                  onClick={() =>
                    handleTriggerBridging(
                      'SATUSEHAT_FHIR_R4',
                      'Bundle Encounter + Condition ICD-10 + Observation'
                    )
                  }
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-teal-700 hover:bg-teal-800 text-white flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingBridging ? 'animate-spin' : ''}`} />
                  Kirim Bundle SATUSEHAT
                </button>
                <button
                  type="button"
                  disabled={isSyncingBridging}
                  onClick={() =>
                    handleTriggerBridging(
                      'BPJS_PCARE',
                      'Sinkronisasi Kunjungan & Klaim BPJS Kesehatan'
                    )
                  }
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Validasi Klaim BPJS
                </button>
                <button
                  type="button"
                  disabled={isSyncingBridging}
                  onClick={() =>
                    handleTriggerBridging(
                      'IOMT_GATEWAY',
                      ' Akuisisi Vital Signs Bedside Monitor HL7/IEEE-11073'
                    )
                  }
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1 cursor-pointer"
                >
                  <Cpu className="w-3.5 h-3.5" />
                  Tarik TTV Alat IoMT
                </button>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50/50 dark:bg-slate-800/30">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Log Pertukaran Data Kesehatan ({workspace.bridgingLogs.length})
                </span>
                <DataExportToolbar
                  title="Log Integrasi Layanan SATUSEHAT, BPJS & TTE"
                  filenameBase={`KAEL_Bridging_${facilityCode}`}
                  facilityName={workspace.activeFacility.name}
                  facilityCode={facilityCode}
                  columns={cashierExportColumns}
                  rows={cashierExportRows}
                  compact
                  contextLabel="Ekspor Log"
                />
              </div>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 bg-slate-50/70 dark:bg-slate-800/50">
                    <th className="py-2.5 px-4">Target Gateway</th>
                    <th className="py-2.5 px-4">Resource &amp; Pasien</th>
                    <th className="py-2.5 px-4">Latensi &amp; Status</th>
                    <th className="py-2.5 px-4 text-right">Payload</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {workspace.bridgingLogs.map((log) => (
                    <tr
                      key={log.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    >
                      <td className="py-3 px-4 font-mono text-[11px] font-bold text-teal-800 dark:text-teal-300 whitespace-nowrap">
                        {log.targetSystem.replace(/_/g, ' ')}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {log.resourceType}
                        </div>
                        <div className="text-[11px] text-slate-500">{log.patientName}</div>
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-[11px] whitespace-nowrap">
                        <div className="text-emerald-700 dark:text-emerald-400 font-semibold">
                          {log.status}
                        </div>
                        <div className="text-slate-500">{log.latencyMs} ms</div>
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

          {/* Right 5 Cols: FHIR R4 / BPJS Payload JSON Inspector */}
          <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Inspektor Payload Pertukaran Data Kesehatan FHIR R4
            </h3>
            {selectedBridgingLog ? (
              <div className="space-y-2 text-xs font-mono">
                <div className="text-[11px] text-slate-500">
                  External UUID / SEP: <strong>{selectedBridgingLog.externalId}</strong>
                </div>
                <pre className="p-3.5 rounded-lg bg-slate-950 text-slate-100 overflow-x-auto text-[11px] leading-relaxed">
                  {JSON.stringify(selectedBridgingLog.payloadPreview, null, 2)}
                </pre>
              </div>
            ) : (
              <div className="text-xs text-slate-500 py-6 text-center">
                Pilih baris log di sebelah kiri untuk melihat struktur JSON payload.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: LAPORAN REGULASI KEMENKES SIRS RL 1-5 / LB1-LB4 & ORKESTRASI RUJUKAN */}
      {activeTab === 'REGULASI' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-1">
              <div className="text-[11px] font-semibold text-slate-500">
                Klasifikasi Kemenkes Permenkes 6/2026
              </div>
              <div className="text-base font-bold text-slate-900 dark:text-slate-100">
                RS/Faskes Kategori {workspace.activeFacility.permenkes6_2026Class || 'MADYA'}
              </div>
              <div className="font-mono text-[11px] text-teal-700 dark:text-teal-400">
                Kode Registrasi: {workspace.activeFacility.kemenkesCode}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-1">
              <div className="text-[11px] font-semibold text-slate-500">
                10 Besar Penyakit SIRS RL 4 / LB1
              </div>
              <div className="text-base font-bold text-slate-900 dark:text-slate-100">
                {workspace.soapRecords.length} Episode Terkode ICD-10
              </div>
              <div className="font-mono text-[11px] text-slate-500">
                Dominan: {workspace.soapRecords[0]?.assessment.primaryIcd10Code || 'I10'} — {workspace.soapRecords[0]?.assessment.primaryIcd10Name || 'Hipertensi Esensial'}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-1">
              <div className="text-[11px] font-semibold text-slate-500">
                Orkestrasi Rujukan SISRUTE &amp; PRB
              </div>
              <div className="text-base font-bold text-slate-900 dark:text-slate-100">
                {(workspace.referrals || []).length} Rujukan Lintas Faskes
              </div>
              <div className="font-mono text-[11px] text-emerald-700 dark:text-emerald-400">
                Kepatuhan Rujukan Balik PRB Terpantau
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Daftar Rujukan Berjenjang FKTP ↔ FKRTL &amp; SISRUTE ({(workspace.referrals || []).length})
              </span>
            </div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 bg-slate-50 dark:bg-slate-800/50">
                  <th className="py-2.5 px-4">No. Rujukan &amp; Tipe</th>
                  <th className="py-2.5 px-4">Pasien</th>
                  <th className="py-2.5 px-4">Faskes Asal → Tujuan</th>
                  <th className="py-2.5 px-4">Diagnosis ICD-10 &amp; Indikasi</th>
                  <th className="py-2.5 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {(workspace.referrals || []).map((ref) => (
                  <tr key={ref.id}>
                    <td className="py-3 px-4 font-mono">
                      <div className="font-bold text-slate-900 dark:text-slate-100">
                        {ref.referralNumber}
                      </div>
                      <div className="text-[11px] text-teal-700 dark:text-teal-400">
                        {ref.referralType}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                      {ref.patientName}
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px]">
                      {ref.originFacilityCode} → {ref.destinationFacilityName}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold">
                        {ref.primaryIcd10Code} — {ref.primaryIcd10Name}
                      </div>
                      <div className="text-[11px] text-slate-500">{ref.clinicalReason}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                      {ref.status}
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
