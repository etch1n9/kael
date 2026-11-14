import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  FlaskConical,
  PackagePlus,
  Pill,
  Plus,
  Printer,
  RefreshCw,
  Search,
} from 'lucide-react';
import {
  LabOrder,
  MedicationInventory,
  MedicationMutationType,
  MedicationStockMutation,
  ModuleKey,
  PharmacyOrder,
} from '../domain/simrs.ts';
import { kaelApi, WorkspacePayload } from '../utils/apiClient';
import { evaluateLabFlag, formatRupiah } from '../domain/clinicalLogic.ts';
import { computeErpCompleteFinancialAnalysis } from '../domain/platformEngine.ts';
import { DataExportToolbar } from './DataExportToolbar';
import { ModalDialog } from './ModalDialog';
import { ExportColumn } from '../utils/exportDocument';

interface PharmacyAndLabModuleProps {
  token: string;
  facilityCode: string;
  workspace: WorkspacePayload;
  initialView: ModuleKey;
  onRefreshWorkspace: () => Promise<void>;
}

type PharmacySubTab =
  | 'RESEP_FEFO'
  | 'STOCK_OPNAME'
  | 'MUTASI_KELUAR_MASUK'
  | 'PENGADAAN_PBF'
  | 'LABORATORIUM'
  | 'RADIOLOGI_RIS'
  | 'PENUNJANG_RS';

export const PharmacyAndLabModule: React.FC<PharmacyAndLabModuleProps> = ({
  token,
  facilityCode,
  workspace,
  initialView,
  onRefreshWorkspace,
}) => {
  const [activeTab, setActiveTab] = useState<PharmacySubTab>(() => {
    if (initialView === 'KATALOG_OPNAME') return 'STOCK_OPNAME';
    if (initialView === 'MUTASI_STOK') return 'MUTASI_KELUAR_MASUK';
    if (initialView === 'PENGADAAN_PBF') return 'PENGADAAN_PBF';
    if (initialView === 'LABORATORIUM') return 'LABORATORIUM';
    if (initialView === 'RADIOLOGI_RIS') return 'RADIOLOGI_RIS';
    if (initialView === 'PENUNJANG_RS') return 'PENUNJANG_RS';
    return 'RESEP_FEFO';
  });
  const grantedModules = workspace.user.resolvedModules || workspace.user.customPrivileges || [];
  const hasModule = (key: ModuleKey) => workspace.user.role === 'SUPERUSER' || grantedModules.includes(key);
  const tabModule: Record<PharmacySubTab, ModuleKey> = {
    RESEP_FEFO: 'APOTEK', STOCK_OPNAME: 'KATALOG_OPNAME', MUTASI_KELUAR_MASUK: 'MUTASI_STOK',
    PENGADAAN_PBF: 'PENGADAAN_PBF', LABORATORIUM: 'LABORATORIUM', RADIOLOGI_RIS: 'RADIOLOGI_RIS', PENUNJANG_RS: 'PENUNJANG_RS',
  };
  const allowedTabs: PharmacySubTab[] = (initialView === 'KATALOG_OPNAME' || initialView === 'MUTASI_STOK'
    ? ['STOCK_OPNAME', 'MUTASI_KELUAR_MASUK'] as PharmacySubTab[]
    : [Object.keys(tabModule).find((tab) => tabModule[tab as PharmacySubTab] === initialView) || 'RESEP_FEFO'] as PharmacySubTab[])
    .filter((tab) => hasModule(tabModule[tab]));
  useEffect(() => {
    if (!allowedTabs.includes(activeTab) && allowedTabs[0]) setActiveTab(allowedTabs[0]);
  }, [initialView, activeTab, grantedModules.join(',')]);
  const isInventoryContext = ['APOTEK', 'KATALOG_OPNAME', 'MUTASI_STOK', 'PENGADAAN_PBF'].includes(initialView);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // Printable Etiket State
  const [etiketOrder, setEtiketOrder] = useState<PharmacyOrder | null>(null);

  // 1. Incoming Medication (Obat Masuk PBF) Form State
  const [restockMedId, setRestockMedId] = useState<string>('');
  const [batchNumber, setBatchNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [restockQty, setRestockQty] = useState<number>(1);
  const [supplierName, setSupplierName] = useState('');
  const [isRestocking, setIsRestocking] = useState(false);

  // 2. Direct Outgoing Medication (Obat Keluar ke Pasien / Unit) Form State
  const [outMedId, setOutMedId] = useState<string>('');
  const [outQty, setOutQty] = useState<number>(1);
  const [outPatientOrUnit, setOutPatientOrUnit] = useState('');
  const [outNotes, setOutNotes] = useState('');
  const [isDispensingDirect, setIsDispensingDirect] = useState(false);

  // 3. Interactive Stock Opname Table State (keyed by `${medicationId}__${batchNumber}`)
  const [opnameDrafts, setOpnameDrafts] = useState<Record<string, number>>({});
  const [opnameGlobalReason, setOpnameGlobalReason] = useState('');
  const [isSavingBatchOpname, setIsSavingBatchOpname] = useState(false);

  // 4. Mutation Ledger Filters
  const [mutationTypeFilter, setMutationTypeFilter] = useState<'ALL' | MedicationMutationType>(
    'ALL'
  );
  const [mutationMedFilter, setMutationMedFilter] = useState<string>('ALL');

  // 5. Add New Master Medication Form State
  const [showAddMasterModal, setShowAddMasterModal] = useState(false);
  const [newMedCode, setNewMedCode] = useState('');
  const [newMedName, setNewMedName] = useState('');
  const [newMedGeneric, setNewMedGeneric] = useState('');
  const [newMedCategory, setNewMedCategory] = useState<MedicationInventory['category'] | ''>('');
  const [newMedForm, setNewMedForm] = useState<MedicationInventory['form'] | ''>('');
  const [newMedUnit, setNewMedUnit] = useState('');
  const [newMedBuyPrice, setNewMedBuyPrice] = useState<number | ''>('');
  const [newMedSellPrice, setNewMedSellPrice] = useState<number | ''>('');
  const [newMedStock, setNewMedStock] = useState<number>(0);

  // 6. Laboratory State
  const [selectedLabOrder, setSelectedLabOrder] = useState<LabOrder | null>(
    workspace.labOrders[0] || null
  );
  const [labValues, setLabValues] = useState<Record<string, number | null>>(() => {
    const first = workspace.labOrders[0];
    if (!first) return {};
    return Object.fromEntries(first.parameters.map((p) => [p.code, p.value]));
  });
  const [labNotes, setLabNotes] = useState<string>(
    workspace.labOrders[0]?.clinicalNotes || ''
  );
  type LabReferenceDraft = { min: number | ''; max: number | ''; source: string; context: string; verified: boolean };
  const [labReferences, setLabReferences] = useState<Record<string, LabReferenceDraft>>({});
  const [showNewLabForm, setShowNewLabForm] = useState(false);
  const [newLabVisitId, setNewLabVisitId] = useState<string>('');
  const [newLabPanels, setNewLabPanels] = useState<string[]>([]);
  const [newLabNotes, setNewLabNotes] = useState('');

  // 7. PBF Purchase Order State
  const [poSupplier, setPoSupplier] = useState('');
  const [poInvoiceNo, setPoInvoiceNo] = useState('');
  const [poMedId, setPoMedId] = useState<string>('');
  const [poVatRate, setPoVatRate] = useState<number | ''>('');
  const [poUnitCost, setPoUnitCost] = useState<number | ''>('');
  const [poQty, setPoQty] = useState<number>(1);
  const [poBatch, setPoBatch] = useState('');
  const [poExpiry, setPoExpiry] = useState('');

  // 8. Radiology RIS Order State
  const [radVisitId, setRadVisitId] = useState<string>('');
  const [radModality, setRadModality] = useState<'XRAY' | 'USG' | 'CT' | 'MRI' | ''>('');
  const [radTariff, setRadTariff] = useState<number | ''>('');
  const [radExamName, setRadExamName] = useState('');
  const [radIndication, setRadIndication] = useState('');
  const [radFindings, setRadFindings] = useState(
    ''
  );
  const [radImpression, setRadImpression] = useState('');

  const mutations: MedicationStockMutation[] = useMemo(
    () => workspace.medicationMutations || [],
    [workspace.medicationMutations]
  );

  const deepErp = useMemo(
    () =>
      computeErpCompleteFinancialAnalysis({
        accountingEntries: workspace.accountingEntries || [],
        invoices: workspace.invoices || [],
        medications: workspace.medications || [],
        mutations,
        purchaseOrders: workspace.purchaseOrders || [],
        visits: workspace.visits || [],
        nearExpiryThresholdDays: workspace.activeFacilityConfig?.pharmacyPolicy.nearExpiryThresholdDays,
      }),
    [
      workspace.accountingEntries,
      workspace.invoices,
      workspace.medications,
      mutations,
      workspace.purchaseOrders,
      workspace.visits,
      workspace.activeFacilityConfig?.pharmacyPolicy.nearExpiryThresholdDays,
    ]
  );

  // Compute Pharmacy Inventory & Mutation Summary Metrics
  const pharmacyStats = useMemo(() => {
    let totalUnitsInStock = 0;
    let totalInventoryAssetHna = 0;
    let totalPotentialSalesHja = 0;
    let lowStockCount = 0;

    for (const med of workspace.medications) {
      const medStock = med.batches.reduce((s, b) => s + b.stock, 0);
      totalUnitsInStock += medStock;
      totalInventoryAssetHna += medStock * med.buyPrice;
      totalPotentialSalesHja += medStock * med.sellPrice;
      if (medStock <= med.minStock) {
        lowStockCount++;
      }
    }

    const incomingMutations = mutations.filter(
      (m) => m.type === 'MASUK_PBF' || m.type === 'STOK_AWAL' || m.quantityChange > 0
    );
    const outgoingMutations = mutations.filter(
      (m) => m.type === 'KELUAR_RESEP' || m.quantityChange < 0
    );

    const totalIncomingQty = incomingMutations.reduce(
      (s, m) => s + Math.max(0, m.quantityChange),
      0
    );
    const totalIncomingValue = incomingMutations.reduce((s, m) => s + m.totalValue, 0);

    const totalOutgoingQty = outgoingMutations.reduce(
      (s, m) => s + Math.abs(Math.min(0, m.quantityChange)),
      0
    );
    const totalOutgoingValue = outgoingMutations.reduce((s, m) => s + m.totalValue, 0);

    return {
      totalUnitsInStock,
      totalInventoryAssetHna,
      totalPotentialSalesHja,
      lowStockCount,
      totalIncomingQty,
      totalIncomingValue,
      totalOutgoingQty,
      totalOutgoingValue,
    };
  }, [workspace.medications, mutations]);

  // Flatten all medication batches for the Stock Opname table
  const stockOpnameRows = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const rows: {
      rowKey: string;
      medicationId: string;
      code: string;
      kfaCode: string;
      name: string;
      genericName: string;
      category: string;
      unit: string;
      minStock: number;
      buyPrice: number;
      sellPrice: number;
      batchNumber: string;
      expiryDate: string;
      systemStock: number;
      actualStock: number;
      diffQty: number;
      diffValueRp: number;
    }[] = [];

    for (const med of workspace.medications) {
      if (
        q &&
        !med.name.toLowerCase().includes(q) &&
        !med.genericName.toLowerCase().includes(q) &&
        !med.code.toLowerCase().includes(q) &&
        !med.kfaCode.includes(q)
      ) {
        continue;
      }
      for (const batch of med.batches) {
        const rowKey = `${med.id}__${batch.batchNumber}`;
        const actualStock =
          opnameDrafts[rowKey] !== undefined ? opnameDrafts[rowKey] : batch.stock;
        const diffQty = actualStock - batch.stock;
        const diffValueRp = Math.abs(diffQty) * med.buyPrice;
        rows.push({
          rowKey,
          medicationId: med.id,
          code: med.code,
          kfaCode: med.kfaCode,
          name: med.name,
          genericName: med.genericName,
          category: med.category,
          unit: med.unit,
          minStock: med.minStock,
          buyPrice: med.buyPrice,
          sellPrice: med.sellPrice,
          batchNumber: batch.batchNumber,
          expiryDate: batch.expiryDate,
          systemStock: batch.stock,
          actualStock,
          diffQty,
          diffValueRp,
        });
      }
    }
    return rows;
  }, [workspace.medications, searchQuery, opnameDrafts]);

  const modifiedOpnameItems = useMemo(
    () =>
      stockOpnameRows
        .filter((r) => r.diffQty !== 0)
        .map((r) => ({
          medicationId: r.medicationId,
          batchNumber: r.batchNumber,
          actualStock: r.actualStock,
        })),
    [stockOpnameRows]
  );

  const filteredMutations = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return mutations.filter((m) => {
      if (mutationTypeFilter !== 'ALL' && m.type !== mutationTypeFilter) return false;
      if (mutationMedFilter !== 'ALL' && m.medicationId !== mutationMedFilter) return false;
      if (!q) return true;
      return (
        m.medicationName.toLowerCase().includes(q) ||
        m.medicationCode.toLowerCase().includes(q) ||
        m.batchNumber.toLowerCase().includes(q) ||
        m.counterpartyOrPatient.toLowerCase().includes(q) ||
        m.referenceId.toLowerCase().includes(q)
      );
    });
  }, [mutations, mutationTypeFilter, mutationMedFilter, searchQuery]);

  const selectLabForEdit = (order: LabOrder) => {
    setSelectedLabOrder(order);
    setLabValues(Object.fromEntries(order.parameters.map((p) => [p.code, p.value])));
    setLabNotes(order.clinicalNotes);
    setLabReferences(Object.fromEntries(order.parameters.map((parameter) => [parameter.code, {
      min: typeof parameter.refMin === 'number' ? parameter.refMin : '', max: typeof parameter.refMax === 'number' ? parameter.refMax : '',
      source: parameter.referenceSource || '', context: parameter.methodPopulation || '', verified: parameter.referenceVerified === true,
    }])));

  };

  // Handler 1: Dispense Patient E-Resep (Automatic FEFO Stock Deduction + Mutation Record)
  const handleDispenseOrder = async (order: PharmacyOrder) => {
    setFeedback(null);
    if (!reviewNotes[order.id]?.trim()) {
      setFeedback({ type: 'error', text: 'Catat hasil telaah resep dan edukasi yang benar-benar dilakukan sebelum menyerahkan obat.' });
      return;
    }
    try {
      const dispensed = await kaelApi.dispensePharmacyOrder(
        token,
        facilityCode,
        order.id,
        reviewNotes[order.id].trim()
      );
      await onRefreshWorkspace();
      setFeedback({
        type: 'success',
        text: `Resep ${dispensed.patientName} berhasil diserahkan. Sistem otomatis mengurangi stok batch FEFO dan mencatat harga jual ke mutasi obat keluar.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal menyerahkan resep farmasi.',
      });
    }
  };

  // Handler 2: Incoming Batch Restock from PBF (Automatic Stock Addition + Mutation Record)
  const handleRestockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restockMedId) return;
    setFeedback(null);
    setIsRestocking(true);
    try {
      const updated = await kaelApi.restockMedication(token, facilityCode, restockMedId, {
        batchNumber,
        expiryDate,
        quantity: Number(restockQty),
        supplierName,
      });
      await onRefreshWorkspace();
      setFeedback({
        type: 'success',
        text: `Obat Masuk +${restockQty} ${updated.unit} untuk ${updated.name} Batch ${batchNumber.toUpperCase()} senilai ${formatRupiah(
          Number(restockQty) * updated.buyPrice
        )} otomatis ditambahkan ke stok dan dicatat pada mutasi stok. Penerimaan stok ini tidak membuktikan pembayaran.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal menerima stok batch obat.',
      });
    } finally {
      setIsRestocking(false);
    }
  };

  // Handler 3: Direct Outgoing Medication (Obat Keluar ke Pasien / Unit)
  const handleDirectDispenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!outMedId || !outPatientOrUnit.trim() || !outNotes.trim()) return;
    setFeedback(null);
    setIsDispensingDirect(true);
    try {
      const updated = await kaelApi.directDispenseMedication(token, facilityCode, outMedId, {
        quantity: Number(outQty),
        patientOrUnitName: outPatientOrUnit,
        notes: outNotes,
      });
      await onRefreshWorkspace();
      setFeedback({
        type: 'success',
        text: `Obat Keluar -${outQty} ${updated.unit} ${updated.name} senilai ${formatRupiah(
          Number(outQty) * updated.sellPrice
        )} untuk ${outPatientOrUnit} berhasil dipotong otomatis dari batch FEFO dan tercatat di Kartu Stok.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal mencatat pengeluaran obat.',
      });
    } finally {
      setIsDispensingDirect(false);
    }
  };

  // Handler 4: Single Row Stock Opname Adjustment
  const handleSingleRowOpname = async (
    medicationId: string,
    batchNo: string,
    actualStock: number,
    medName: string
  ) => {
    setFeedback(null);
    if (!opnameGlobalReason.trim()) { setFeedback({ type: 'error', text: 'Isi alasan penyesuaian stok yang sebenarnya.' }); return; }
    try {
      await kaelApi.stockOpnameMedication(token, facilityCode, medicationId, {
        batchNumber: batchNo,
        actualStock,
        reason: opnameGlobalReason,
      });
      setOpnameDrafts((prev) => {
        const next = { ...prev };
        delete next[`${medicationId}__${batchNo}`];
        return next;
      });
      await onRefreshWorkspace();
      setFeedback({
        type: 'success',
        text: `Stok Opname ${medName} Batch ${batchNo} berhasil disesuaikan menjadi ${actualStock} dan tercatat di riwayat mutasi.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal menyimpan stok opname.',
      });
    }
  };

  // Handler 5: Save All Modified Rows in Stock Opname Table
  const handleBatchOpnameSave = async () => {
    if (modifiedOpnameItems.length === 0 || !opnameGlobalReason.trim()) { setFeedback({ type: 'error', text: 'Isi alasan penyesuaian dan perubahan stok.' }); return; }
    setFeedback(null);
    setIsSavingBatchOpname(true);
    try {
      const res = await kaelApi.batchStockOpname(token, facilityCode, {
        reason: opnameGlobalReason,
        items: modifiedOpnameItems,
      });
      setOpnameDrafts({});
      await onRefreshWorkspace();
      setFeedback({
        type: 'success',
        text: `Berhasil menyimpan penyesuaian Stock Opname untuk ${res.updatedCount} batch obat sekaligus dan mencatat ${res.mutationsCreated} mutasi ke Kartu Stok.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal menyimpan penyesuaian massal opname.',
      });
    } finally {
      setIsSavingBatchOpname(false);
    }
  };

  // Handler 6: Create New Master Medication SKU
  const handleCreateMasterMed = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMedCode.trim() || !newMedName.trim() || !newMedUnit.trim() || !newMedCategory || !newMedForm || newMedBuyPrice === '' || newMedSellPrice === '' || !Number.isFinite(newMedBuyPrice) || !Number.isFinite(newMedSellPrice) || newMedBuyPrice < 0 || newMedSellPrice < 0) { setFeedback({ type: 'error', text: 'Isi kode, nama, satuan, harga beli, dan harga jual obat secara eksplisit.' }); return; }
    setFeedback(null);
    try {
      const created = await kaelApi.createMedication(token, facilityCode, {
        code: newMedCode,
        name: newMedName,
        genericName: newMedGeneric.trim(),
        unit: newMedUnit,
        category: newMedCategory,
        form: newMedForm,
        buyPrice: Number(newMedBuyPrice),
        sellPrice: Number(newMedSellPrice),
        initialStock: Number(newMedStock),
      });
      setNewMedCode('');
      setNewMedName('');
      setNewMedGeneric('');
      setShowAddMasterModal(false);
      await onRefreshWorkspace();
      setFeedback({
        type: 'success',
        text: `Master obat baru ${created.name} · ${created.code} dengan stok awal +${newMedStock} ${created.unit} berhasil didaftarkan.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal menambahkan master obat baru.',
      });
    }
  };

  const handleCreateDirectLabOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLabVisitId || newLabPanels.length === 0) return;
    setFeedback(null);
    try {
      const created = await kaelApi.createLabOrder(token, facilityCode, {
        visitId: newLabVisitId,
        panelCodes: newLabPanels,
        clinicalNotes: newLabNotes,
      });
      setShowNewLabForm(false);
      await onRefreshWorkspace();
      setSelectedLabOrder(created);
      setLabReferences({});
      setLabNotes(created.clinicalNotes);
      setLabValues(Object.fromEntries(created.parameters.map((p) => [p.code, p.value])));
      setFeedback({
        type: 'success',
        text: `Order laboratorium baru ${created.specimenCode} untuk ${created.patientName} berhasil diterbitkan.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal membuat order laboratorium.',
      });
    }
  };

  const handleVerifyLab = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLabOrder) return;
    setFeedback(null);
    try {
      if (selectedLabOrder.parameters.some((parameter) => !Number.isFinite(labValues[parameter.code] ?? parameter.value))) {
        throw new Error('Isi semua hasil pengukuran laboratorium sebelum verifikasi.');
      }
      const parametersPayload = selectedLabOrder.parameters.map((parameter) => {
        const reference = labReferences[parameter.code];
        if (reference?.verified && (reference.min === '' || reference.max === '' || !Number.isFinite(reference.min) || !Number.isFinite(reference.max) || reference.min > reference.max || !reference.source.trim())) throw new Error(`Lengkapi rentang dan sumber referensi ${parameter.code}, atau hapus konfirmasi referensi.`);
        return {
          code: parameter.code, value: labValues[parameter.code] ?? parameter.value,
          ...(reference ? { refMin: reference.min === '' ? null : reference.min, refMax: reference.max === '' ? null : reference.max, referenceVerified: reference.verified, referenceSource: reference.source.trim(), methodPopulation: reference.context.trim() } : {}),
        };
      });
      const verified = await kaelApi.verifyLabOrder(token, facilityCode, selectedLabOrder.id, {
        parameters: parametersPayload,
        clinicalNotes: labNotes,
      });
      await onRefreshWorkspace();
      setSelectedLabOrder(verified);
      setFeedback({
        type: 'success',
        text: `Hasil laboratorium spesimen ${verified.specimenCode} untuk ${verified.patientName} berhasil diverifikasi dan dikirim ke RME Dokter.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal memverifikasi hasil laboratorium.',
      });
    }
  };

  const handleCreatePoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const med = workspace.medications.find((m) => m.id === poMedId);
    if (!med || !Number.isFinite(poQty) || poQty <= 0 || poVatRate === '' || !Number.isFinite(poVatRate) || poVatRate < 0 || poVatRate > 100 || poUnitCost === '' || !Number.isFinite(poUnitCost) || poUnitCost < 0) { setFeedback({ type: 'error', text: 'Pilih obat dan isi harga perolehan serta persentase pajak sesuai faktur. Isi 0 jika tidak dikenai pajak.' }); return; }
    setFeedback(null);
    try {
      const created = await kaelApi.createPurchaseOrder(token, facilityCode, {
        supplierName: poSupplier,
        supplierInvoiceNo: poInvoiceNo,
        vatRatePct: poVatRate,
        receiveImmediately: true,
        items: [
          {
            medicationId: med.id,
            medicationCode: med.code,
            medicationName: med.name,
            quantity: Number(poQty),
            unitCostHna: poUnitCost,
            batchNumber: poBatch,
            expiryDate: poExpiry,
          },
        ],
      });
      await onRefreshWorkspace();
      const poObj = created.purchaseOrder || (created as any);
      setFeedback({
        type: 'success',
        text: `PO & Faktur PBF ${poObj.poNumber} senilai ${formatRupiah(
          poObj.grandTotalPayable || poObj.totalAmount || 0
        )} diterima ke gudang farmasi dan dijurnal ke Buku Besar.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal membuat PO PBF.',
      });
    }
  };

  const handleCreateRadiologySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!radVisitId || !radModality || (radTariff !== '' && (!Number.isFinite(radTariff) || radTariff < 0))) { setFeedback({ type: 'error', text: 'Pilih kunjungan dan modalitas. Tarif yang diisi harus berupa angka tidak negatif.' }); return; }
    setFeedback(null);
    try {
      const created = await kaelApi.createRadiologyOrder(token, facilityCode, {
        visitId: radVisitId,
        modality: radModality,
        ...(radTariff === '' ? {} : { tariff: radTariff }),
        examName: radExamName,
        clinicalIndication: radIndication,
        findings: radFindings,
        impression: radImpression,
      });
      await onRefreshWorkspace();
      setFeedback({
        type: 'success',
        text: created.status === 'EXPERTISE_VERIFIED'
          ? `Hasil radiologi ${created.accessionNumber} (${created.examName}) berhasil disimpan dengan status terverifikasi.`
          : `Order radiologi ${created.accessionNumber} (${created.examName}) berhasil disimpan. Pemeriksaan dan pengisian hasil masih menunggu.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal membuat order radiologi.',
      });
    }
  };

  // Export Column Definitions per Table
  const resepExportColumns: ExportColumn<PharmacyOrder>[] = [
    { key: 'id', header: 'ID Resep' },
    { key: 'patientName', header: 'Nama Pasien' },
    { key: 'mrNumber', header: 'No. RM' },
    { key: 'doctorName', header: 'Dokter Penulis' },
    {
      key: 'items',
      header: 'Daftar Obat & Jumlah',
      format: (r) =>
        r.items.map((i) => `${i.medicationName} -${i.quantity} ${i.unit}`).join('; '),
    },
    {
      key: 'totalHarga',
      header: 'Total Nilai Resep IDR',
      format: (r) => r.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0),
    },
    { key: 'status', header: 'Status Penyerahan' },
  ];

  const stockOpnameExportColumns: ExportColumn<(typeof stockOpnameRows)[number]>[] = [
    { key: 'code', header: 'Kode SKU' },
    { key: 'kfaCode', header: 'Kode KFA' },
    { key: 'name', header: 'Nama Obat / Alkes' },
    { key: 'batchNumber', header: 'Nomor Batch' },
    { key: 'expiryDate', header: 'Kedaluwarsa ED' },
    { key: 'unit', header: 'Satuan' },
    { key: 'buyPrice', header: 'Harga Beli HNA IDR' },
    { key: 'sellPrice', header: 'Harga Jual HJA IDR' },
    { key: 'systemStock', header: 'Stok Sistem' },
    { key: 'actualStock', header: 'Stok Fisik Aktual' },
    { key: 'diffQty', header: 'Selisih' },
    { key: 'diffValueRp', header: 'Nilai Selisih IDR' },
  ];

  const mutationExportColumns: ExportColumn<MedicationStockMutation>[] = [
    {
      key: 'timestamp',
      header: 'Waktu Mutasi',
      format: (r) => r.timestamp.slice(0, 16).replace('T', ' '),
    },
    { key: 'type', header: 'Jenis Mutasi' },
    { key: 'medicationCode', header: 'Kode SKU' },
    { key: 'medicationName', header: 'Nama Obat' },
    { key: 'batchNumber', header: 'No. Batch' },
    { key: 'stockBefore', header: 'Stok Awal' },
    {
      key: 'quantityChange',
      header: 'Keluar / Masuk Qty',
      format: (r) => (r.quantityChange > 0 ? `+${r.quantityChange}` : r.quantityChange),
    },
    { key: 'stockAfter', header: 'Stok Akhir' },
    { key: 'unitPrice', header: 'Harga Satuan IDR' },
    { key: 'totalValue', header: 'Total Nominal IDR' },
    { key: 'counterpartyOrPatient', header: 'Pasien / Distributor PBF' },
  ];

  const labExportColumns: ExportColumn<LabOrder>[] = [
    { key: 'specimenCode', header: 'Kode Spesimen' },
    { key: 'patientName', header: 'Nama Pasien' },
    { key: 'mrNumber', header: 'No. RM' },
    { key: 'doctorName', header: 'Dokter Pengirim' },
    { key: 'clinicalNotes', header: 'Catatan Klinis' },
    { key: 'status', header: 'Status Verifikasi' },
  ];

  return (
    <div className="min-w-0 space-y-3">
      {/* Top Module Title & Sub-Navigation Bar */}
      <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-[#0F2922] dark:text-white mt-0.5 tracking-tight">
              {activeTab === 'LABORATORIUM'
                ? 'Laboratorium patologi klinik'
                : activeTab === 'RADIOLOGI_RIS'
                ? 'Radiologi & pencitraan diagnostik RIS'
                : activeTab === 'PENUNJANG_RS'
                ? 'Instalasi gizi, bank darah, CSSD & IPSRS'
                : activeTab === 'PENGADAAN_PBF'
                ? 'Pengadaan PO, faktur PBF & hutang dagang'
                : activeTab === 'STOCK_OPNAME'
                ? 'Persediaan obat'
                : activeTab === 'MUTASI_KELUAR_MASUK'
                ? 'Persediaan obat'
                : 'Pelayanan resep & dispensasi FEFO'}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            {isInventoryContext && hasModule('KATALOG_OPNAME') && <button
              type="button"
              onClick={() => setShowAddMasterModal((prev) => !prev)}
              className="px-3.5 py-2 rounded-xl bg-[#00897B] hover:bg-[#00796B] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah obat</span>
            </button>}
          </div>
        </div>

        {/* Sub-Tabs Navigation + Live Search */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {allowedTabs.length > 1 && <div className="grid grid-cols-2 gap-2 w-full sm:w-auto sm:flex sm:flex-wrap">
            {allowedTabs.includes('RESEP_FEFO') && (
            <button
              type="button"
              data-testid="tab-resep-fefo"
              onClick={() => setActiveTab('RESEP_FEFO')}
              className={`px-3 py-2 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'RESEP_FEFO'
                  ? 'bg-[#00897B] text-white'
                  : 'bg-[#F3F8F6] dark:bg-[#081916] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
              }`}
            >
              <Pill className="w-3.5 h-3.5" />
              Antrean Resep &amp; FEFO
            </button>
            )}

            {allowedTabs.includes('STOCK_OPNAME') && (
            <button
              type="button"
              data-testid="tab-stock-opname"
              onClick={() => setActiveTab('STOCK_OPNAME')}
              className={`min-h-10 min-w-0 px-2 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 text-center cursor-pointer ${
                activeTab === 'STOCK_OPNAME'
                  ? 'bg-[#00897B] text-white'
                  : 'bg-[#F3F8F6] dark:bg-[#081916] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
              }`}
            >
              <ClipboardList className="w-3.5 h-3.5" />
              Stok dan opname
            </button>
            )}

            {allowedTabs.includes('MUTASI_KELUAR_MASUK') && (
            <button
              type="button"
              data-testid="tab-mutasi-obat"
              onClick={() => setActiveTab('MUTASI_KELUAR_MASUK')}
              className={`min-h-10 min-w-0 px-2 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 text-center cursor-pointer ${
                activeTab === 'MUTASI_KELUAR_MASUK'
                  ? 'bg-[#00897B] text-white'
                  : 'bg-[#F3F8F6] dark:bg-[#081916] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
              }`}
            >
              <PackagePlus className="w-3.5 h-3.5" />
              Mutasi stok
            </button>
            )}

            {allowedTabs.includes('PENGADAAN_PBF') && (
            <button
              type="button"
              data-testid="tab-pengadaan-pbf"
              onClick={() => setActiveTab('PENGADAAN_PBF')}
              className={`px-3 py-2 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'PENGADAAN_PBF'
                  ? 'bg-[#00897B] text-white'
                  : 'bg-[#F3F8F6] dark:bg-[#081916] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
              }`}
            >
              Pengadaan PO PBF
            </button>
            )}

            {allowedTabs.includes('LABORATORIUM') && (
            <button
              type="button"
              data-testid="tab-laboratorium"
              onClick={() => setActiveTab('LABORATORIUM')}
              className={`px-3 py-2 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'LABORATORIUM'
                  ? 'bg-[#00897B] text-white'
                  : 'bg-[#F3F8F6] dark:bg-[#081916] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
              }`}
            >
              <FlaskConical className="w-3.5 h-3.5" />
              Laboratorium Patologi
            </button>
            )}

            {allowedTabs.includes('RADIOLOGI_RIS') && (
            <button
              type="button"
              data-testid="tab-radiologi-ris"
              onClick={() => setActiveTab('RADIOLOGI_RIS')}
              className={`px-3 py-2 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'RADIOLOGI_RIS'
                  ? 'bg-[#00897B] text-white'
                  : 'bg-[#F3F8F6] dark:bg-[#081916] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
              }`}
            >
              Radiologi RIS
            </button>
            )}

            {allowedTabs.includes('PENUNJANG_RS') && (
            <button
              type="button"
              data-testid="tab-penunjang-rs"
              onClick={() => setActiveTab('PENUNJANG_RS')}
              className={`px-3 py-2 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'PENUNJANG_RS'
                  ? 'bg-[#00897B] text-white'
                  : 'bg-[#F3F8F6] dark:bg-[#081916] text-[#0F2922] dark:text-white border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1]'
              }`}
            >
              Gizi, BDRS, CSSD &amp; IPSRS
            </button>
            )}
          </div>}

          <div className="relative min-w-0 w-full sm:flex-1 sm:max-w-sm">
            <Search className="w-4 h-4 text-[#52736B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari obat, KFA, batch, atau pasien..."
              aria-label="Cari Obat atau Spesimen"
              className="min-w-0 w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
            />
          </div>
        </div>
      </div>

      {/* Add Master SKU Drawer */}
      {showAddMasterModal && isInventoryContext && hasModule('KATALOG_OPNAME') && (
        <ModalDialog onClose={() => setShowAddMasterModal(false)} labelledBy="add-medication-title">
        <form
          onSubmit={handleCreateMasterMed}
          className="flex min-h-0 max-h-full w-full max-w-(--kael-dialog-max-inline-size) flex-col rounded-xl border border-[#00897B] bg-white dark:bg-[#0B211D] shadow-xl"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#E2ECE8] dark:border-[#183831] px-4 py-3">
            <h2 id="add-medication-title" className="text-sm font-bold text-[#0F2922] dark:text-white">
              Tambah obat
            </h2>
            <button
              type="button"
              onClick={() => setShowAddMasterModal(false)}
              className="text-xs text-[#52736B] underline cursor-pointer"
            >
              Tutup
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {feedback?.type === 'error' && <div role="alert" className="mb-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-xs text-red-800 dark:text-red-200">{feedback.text}</div>}
          <div className="min-w-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-field-min-inline-size)),1fr))] gap-3 text-xs items-end">
            <div>
              <label className="block font-semibold mb-1">Kode SKU</label>
              <input
                type="text"
                value={newMedCode}
                onChange={(e) => setNewMedCode(e.target.value.toUpperCase())}
                placeholder="CTZ-10"
                required
                className="min-w-0 w-full px-3 py-2 font-mono rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
              />
            </div>
            <div className="">
              <label className="block font-semibold mb-1">Nama Obat / Alkes</label>
              <input
                type="text"
                value={newMedName}
                onChange={(e) => setNewMedName(e.target.value)}
                placeholder="Cetirizine HCl 10mg Tablet"
                required
                className="min-w-0 w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
              />
            </div>
            <label className="block font-semibold">Kategori<select required value={newMedCategory} onChange={(event) => setNewMedCategory(event.target.value as MedicationInventory['category'] | '')} className="mt-1 min-w-0 w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"><option value="">Pilih kategori</option>{(['OBAT_KERAS', 'OBAT_BEBAS_TERBATAS', 'OBAT_BEBAS', 'NARKOTIKA_PSIKOTROPIKA', 'ALKES_BMHP'] as const).map((category) => <option key={category} value={category}>{category.replace(/_/g, ' ')}</option>)}</select></label>
            <label className="block font-semibold">Bentuk sediaan<select required value={newMedForm} onChange={(event) => setNewMedForm(event.target.value as MedicationInventory['form'] | '')} className="mt-1 min-w-0 w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"><option value="">Pilih bentuk</option>{(['TABLET', 'KAPSUL', 'SIRUP', 'INJEKSI', 'SALEP', 'INFUS', 'ALKES'] as const).map((form) => <option key={form} value={form}>{form}</option>)}</select></label>
            <label className="block font-semibold">Satuan<input type="text" required value={newMedUnit} onChange={(event) => setNewMedUnit(event.target.value)} placeholder="Satuan persediaan" className="mt-1 min-w-0 w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" /></label>
            <label className="block font-semibold">Nama generik<input type="text" value={newMedGeneric} onChange={(event) => setNewMedGeneric(event.target.value)} placeholder="Jika tercantum" className="mt-1 min-w-0 w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" /></label>
            <div>
              <label className="block font-semibold mb-1">Harga Beli HNA</label>
              <input
                type="number"
                min={1}
                value={newMedBuyPrice}
                onChange={(e) => setNewMedBuyPrice(e.target.value === '' ? '' : Number(e.target.value))}
                className="min-w-0 w-full px-3 py-2 font-mono rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Harga Jual HJA</label>
              <input
                type="number"
                min={1}
                value={newMedSellPrice}
                onChange={(e) => setNewMedSellPrice(e.target.value === '' ? '' : Number(e.target.value))}
                className="min-w-0 w-full px-3 py-2 font-mono rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Stok Awal ({newMedUnit})</label>
              <input
                type="number"
                min={0}
                value={newMedStock}
                onChange={(e) => setNewMedStock(Number(e.target.value))}
                className="min-w-0 w-full px-3 py-2 font-mono rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
              />
            </div>
          </div>

          </div>
          <div className="flex shrink-0 justify-end border-t border-[#E2ECE8] dark:border-[#183831] px-4 py-3">
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-[#00897B] text-white text-xs font-semibold cursor-pointer"
            >
              Simpan obat
            </button>
          </div>
        </form>
        </ModalDialog>
      )}

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
            className="underline ml-4 whitespace-nowrap cursor-pointer"
          >
            Tutup
          </button>
        </div>
      )}

      {/* Printable Etiket Obat Modal */}
      {etiketOrder && (
        <div className="bg-white text-slate-900 border-2 border-slate-900 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-300 pb-3">
            <div>
              <h3 className="text-sm font-bold uppercase">
                ETIKET OBAT INSTALASI FARMASI — {workspace.activeFacility.name}
              </h3>
              <p className="text-xs text-slate-600">
                Pasien: <strong>{etiketOrder.patientName}</strong> ({etiketOrder.mrNumber}) · Dokter:{' '}
                {etiketOrder.doctorName}
              </p>
            </div>
            <div className="no-print flex items-center gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="px-3 py-1.5 text-xs font-semibold rounded bg-slate-900 text-white flex items-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                Cetak Semua Etiket
              </button>
              <button
                type="button"
                onClick={() => setEtiketOrder(null)}
                className="px-3 py-1.5 text-xs rounded border border-slate-300 cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>

          <div className="min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {etiketOrder.items.map((item, idx) => (
              <div
                key={idx}
                className="p-3.5 rounded-lg border-2 border-slate-800 font-mono text-xs space-y-1"
              >
                <div className="font-bold border-b border-slate-300 pb-1">
                  {workspace.activeFacility.name} · Dicetak: {new Date().toLocaleDateString('id-ID')}
                </div>
                <div>
                  Nama: <strong>{etiketOrder.patientName}</strong> ({etiketOrder.mrNumber})
                </div>
                <div className="text-sm font-bold pt-1">
                  {item.medicationName} ({item.quantity} {item.unit})
                </div>
                <div className="font-bold text-teal-900">
                  Aturan Pakai: {item.signa} ({item.dosage})
                </div>
                <div className="text-caption text-slate-600 pt-1">
                  Ikuti instruksi penggunaan dan penyimpanan yang diberikan petugas untuk obat ini.
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ======================================================================== */}
      {/* TAB 1: ANTREAN E-RESEP & SISTEM OTOMATIS PENGURANGAN STOK SAAT DISERAHKAN */}
      {/* ======================================================================== */}
      {activeTab === 'RESEP_FEFO' && allowedTabs.includes('RESEP_FEFO') && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-[#0F2922] dark:text-white">
                Antrean Resep Pasien &amp; Penyerahan Obat FEFO
              </h2>
              <p className="text-xs text-[#52736B] dark:text-[#86B5A9]">
                Saat tombol Verifikasi &amp; Serahkan diklik, sistem otomatis mengurangi stok batch FEFO dan mencatat harga jual ke Kartu Stok Obat Keluar.
              </p>
            </div>

            <DataExportToolbar
              title="Rekapitulasi Pelayanan E-Resep & Penyerahan Obat Pasien"
              filenameBase={`KAEL_Resep_Farmasi_${facilityCode}`}
              facilityName={workspace.activeFacility.name}
              facilityCode={facilityCode}
              columns={resepExportColumns}
              rows={workspace.pharmacyOrders}
              contextLabel="Ekspor Data Resep:"
            />
          </div>

          <div className="min-w-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-form-min-inline-size)),1fr))] gap-4">
            {workspace.pharmacyOrders.map((order) => {
              const isDispensed = order.status === 'DISERAHKAN';
              const totalResepValue = order.items.reduce(
                (s, i) => s + i.quantity * i.unitPrice,
                0
              );
              return (
                <div
                  key={order.id}
                  className="min-w-0 bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-4 flex flex-col justify-between space-y-4"
                >
                  <div>
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="font-bold text-[#00897B]">
                        Order #{order.id.slice(-6).toUpperCase()} · RM {order.mrNumber}
                      </span>
                      <span
                        className={`px-2.5 py-0.5 rounded-md font-semibold ${
                          isDispensed
                            ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                            : 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                        }`}
                      >
                        {order.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <h3 className="text-sm font-bold text-[#0F2922] dark:text-white mt-1">
                      Pasien: {order.patientName}
                    </h3>
                    <div className="text-xs text-[#52736B]">
                      Dokter Penulis Resep: {order.doctorName}
                    </div>

                    {order.allergies.length > 0 && (
                      <div className="mt-2 p-2 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 flex items-center gap-1.5 font-semibold">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        Alergi Pasien: {order.allergies.join(', ')}
                      </div>
                    )}

                    {/* Automatic Stock Deduction Calculation Preview Table */}
                    <div className="mt-3 min-w-0 w-full overflow-x-auto border border-[#E2ECE8] dark:border-[#183831] rounded-xl">
                      <table className="w-full min-w-full table-auto [&_th]:whitespace-nowrap text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-[#EAF3F0] dark:bg-[#0F2D27] text-[#52736B] dark:text-[#86B5A9] text-caption">
                            <th className="py-2 px-3">Obat &amp; Aturan Pakai</th>
                            <th className="py-2 px-3 text-right">Stok Saat Ini</th>
                            <th className="py-2 px-3 text-right">Keluar</th>
                            <th className="py-2 px-3 text-right">Sisa Otomatis</th>
                            <th className="py-2 px-3 text-right">Harga</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E2ECE8] dark:divide-[#183831]">
                          {order.items.map((item, idx) => {
                            const matchedMed = workspace.medications.find(
                              (m) =>
                                m.id === item.medicationId || m.code === item.medicationCode
                            );
                            const currentTotalStock = matchedMed
                              ? matchedMed.batches.reduce((s, b) => s + b.stock, 0)
                              : 0;
                            const projectedRemaining = isDispensed
                              ? currentTotalStock
                              : Math.max(0, currentTotalStock - item.quantity);

                            return (
                              <tr key={`${item.medicationCode}-${idx}`}>
                                <td className="py-2 px-3">
                                  <div className="font-semibold text-[#0F2922] dark:text-white">
                                    {item.medicationName}
                                  </div>
                                  <div className="text-caption font-mono text-[#52736B]">
                                    {item.dosage} · {item.signa}
                                  </div>
                                </td>
                                <td className="py-2 px-3 text-right font-mono">
                                  {currentTotalStock} {item.unit}
                                </td>
                                <td className="py-2 px-3 text-right font-mono font-bold text-amber-700 dark:text-[#E5B85B]">
                                  -{item.quantity} {item.unit}
                                </td>
                                <td className="py-2 px-3 text-right font-mono font-bold text-[#00897B]">
                                  {projectedRemaining} {item.unit}
                                </td>
                                <td className="py-2 px-3 text-right font-mono">
                                  <div className="font-semibold">
                                    {formatRupiah(item.quantity * item.unitPrice)}
                                  </div>
                                  <div className="text-caption text-[#52736B]">
                                    @{formatRupiah(item.unitPrice)}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-3 pt-2.5 text-xs space-y-2">
                      <div className="font-semibold">Catatan telaah resep dan edukasi petugas</div>
                      {isDispensed ? <p>{order.pharmacistNotes || 'Tidak ada catatan telaah yang tersimpan.'}</p> : (
                        <textarea value={reviewNotes[order.id] || ''} onChange={(event) => setReviewNotes((previous) => ({ ...previous, [order.id]: event.target.value }))} aria-label={`Catatan telaah resep ${order.patientName}`} placeholder="Catat pemeriksaan resep, konfirmasi, dan edukasi yang telah dilakukan" className="min-w-0 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
                      )}
                    </div>

                    {isDispensed && order.dispensedBatches.length > 0 && (
                      <div className="mt-3 p-2.5 rounded-xl bg-[#F4F9F7] dark:bg-[#081916] border border-[#DCE8E4] dark:border-[#183831] text-caption font-mono text-[#0F2922] dark:text-[#E6F4F1]">
                        <div>
                          Diserahkan oleh: <strong>{order.dispensedBy}</strong> · Pemotongan Batch FEFO:
                        </div>
                        <div className="font-semibold text-[#00897B] mt-0.5">
                          {order.dispensedBatches
                            .map(
                              (b) =>
                                `${b.medicationCode} [Batch ${b.batchNumber}: -${b.quantity}]`
                            )
                            .join(' · ')}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="pt-3 border-t border-[#E2ECE8] dark:border-[#183831] flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-mono text-[#52736B]">
                      Total Nilai Obat Keluar:{' '}
                      <strong className="text-[#0F2922] dark:text-white">
                        {formatRupiah(totalResepValue)}
                      </strong>
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setEtiketOrder(order)}
                        className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] hover:bg-[#EBF4F1] flex items-center gap-1 cursor-pointer"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        Etiket
                      </button>
                      {!isDispensed ? (
                        <button
                          type="button"
                          onClick={() => handleDispenseOrder(order)}
                          className="px-4 py-2 text-xs font-semibold rounded-xl bg-[#00897B] hover:bg-[#00796B] text-white transition-colors cursor-pointer"
                        >
                          Verifikasi &amp; Serahkan Obat
                        </button>
                      ) : (
                        <span className="text-xs font-semibold text-[#00897B] flex items-center gap-1">
                          <CheckCircle2 className="w-4 h-4" />
                          Stok Terpotong &amp; Selesai
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ======================================================================== */}
      {/* TAB 2: DAFTAR OBAT LENGKAP & TABEL STOCK OPNAME FISIK INTERAKTIF          */}
      {/* ======================================================================== */}
      {activeTab === 'STOCK_OPNAME' && allowedTabs.includes('STOCK_OPNAME') && (
        <div className="min-w-0 bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-xl overflow-hidden">
          <div className="p-4 border-b border-[#E2ECE8] dark:border-[#183831] bg-[#F8FBFA] dark:bg-[#081916] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-[#0F2922] dark:text-white">
                  Stok obat ({stockOpnameRows.length} batch)
                </h2>
              </div>

              <DataExportToolbar
                title="Daftar Obat & Lembar Kerja Stock Opname Farmasi"
                subtitle={`Total Batch: ${stockOpnameRows.length} • Nilai Aset HNA: ${formatRupiah(
                  pharmacyStats.totalInventoryAssetHna
                )}`}
                filenameBase={`KAEL_Stock_Opname_Obat_${facilityCode}`}
                facilityName={workspace.activeFacility.name}
                facilityCode={facilityCode}
                columns={stockOpnameExportColumns}
                rows={stockOpnameRows}
                compact
                contextLabel="Ekspor Stok"
              />
            </div>

          </div>

          <div className="min-w-0 w-full overflow-x-auto">
            <table className="w-full min-w-full table-auto [&_th]:whitespace-nowrap text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#EAF3F0] dark:bg-[#0F2D27] text-[#52736B] dark:text-[#86B5A9] border-b border-[#E2ECE8] dark:border-[#183831]">
                  <th className="py-3 px-4 font-semibold">Kode SKU &amp; KFA</th>
                  <th className="py-3 px-4 font-semibold">Nama Obat &amp; Zat Aktif</th>
                  <th className="py-3 px-4 font-semibold">Batch &amp; ED</th>
                  <th className="py-3 px-4 font-semibold text-right">Harga Beli / Jual</th>
                  <th className="py-3 px-4 font-semibold text-right">Stok Sistem</th>
                  <th className="py-3 px-4 font-semibold text-center">Stok Fisik Aktual</th>
                  <th className="py-3 px-4 font-semibold text-right">Selisih</th>
                  <th className="py-3 px-4 font-semibold text-right">Nilai Selisih</th>
                  <th className="py-3 px-4 font-semibold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2ECE8] dark:divide-[#183831]">
                {stockOpnameRows.length === 0 && <tr><td colSpan={9} className="px-4 py-5 text-slate-500">Belum ada batch obat.</td></tr>}
                {stockOpnameRows.map((row) => {
                  const hasPhysicalCount = Object.prototype.hasOwnProperty.call(opnameDrafts, row.rowKey);
                  const hasDiff = hasPhysicalCount && row.diffQty !== 0;
                  return (
                    <tr
                      key={row.rowKey}
                      className={
                        hasDiff
                          ? 'bg-emerald-50/50 dark:bg-emerald-950/20'
                          : 'hover:bg-[#F3F8F6] dark:hover:bg-[#0F2B25]'
                      }
                    >
                      <td className="py-3 px-4 font-mono whitespace-nowrap">
                        <div className="font-bold text-[#00897B]">{row.code}</div>
                        <div className="text-caption text-[#52736B]">KFA: {row.kfaCode}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-[#0F2922] dark:text-white">
                          {row.name}
                        </div>
                        <div className="text-caption text-[#52736B]">
                          {row.genericName} · Min: {row.minStock} {row.unit}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono whitespace-nowrap">
                        <div className="font-semibold text-[#0F2922] dark:text-white">
                          {row.batchNumber}
                        </div>
                        <div className="text-caption text-[#52736B]">ED: {row.expiryDate}</div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono whitespace-nowrap">
                        <div className="text-[#52736B]">
                          Beli: <strong>{formatRupiah(row.buyPrice)}</strong>
                        </div>
                        <div className="text-[#00897B]">
                          Jual: <strong>{formatRupiah(row.sellPrice)}</strong>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-[#0F2922] dark:text-white whitespace-nowrap">
                        {row.systemStock} {row.unit}
                      </td>
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        <input
                          type="number"
                          min={0}
                          aria-label={`Stok Fisik ${row.name} Batch ${row.batchNumber}`}
                          value={hasPhysicalCount ? row.actualStock : ''}
                          onChange={(event) => setOpnameDrafts((previous) => {
                            const next = { ...previous };
                            if (event.target.value === '') delete next[row.rowKey];
                            else next[row.rowKey] = Number(event.target.value);
                            return next;
                          })}
                          className="w-24 px-2.5 py-1.5 text-center font-mono font-bold rounded-lg border border-[#00897B] bg-white dark:bg-[#071714] text-[#0F2922] dark:text-white"
                        />
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold whitespace-nowrap">
                        <span
                          className={
                            row.diffQty > 0
                              ? 'text-[#00897B]'
                              : row.diffQty < 0
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-[#52736B]'
                          }
                        >
                          {hasPhysicalCount ? `${row.diffQty > 0 ? '+' : ''}${row.diffQty} ${row.unit}` : 'Belum dihitung'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono whitespace-nowrap">
                        {!hasPhysicalCount ? <span>—</span> : row.diffQty === 0 ? (
                          <span className="text-[#52736B]">Rp 0</span>
                        ) : (
                          <span
                            className={`font-semibold ${
                              row.diffQty > 0 ? 'text-[#00897B]' : 'text-rose-600'
                            }`}
                          >
                            {row.diffQty > 0 ? '+' : '-'} {formatRupiah(row.diffValueRp)}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {hasDiff ? (
                          <button
                            type="button"
                            onClick={() =>
                              handleSingleRowOpname(
                                row.medicationId,
                                row.batchNumber,
                                row.actualStock,
                                row.name
                              )
                            }
                            className="px-3 py-1.5 rounded-lg bg-[#00897B] hover:bg-[#00796B] text-white text-caption font-semibold cursor-pointer"
                          >
                            Sesuaikan
                          </button>
                        ) : (
                          <span className="text-caption text-[#52736B]">{hasPhysicalCount ? 'Hitungan sama dengan sistem' : 'Belum dihitung'}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
            {/* Batch Opname Save Bar */}
            <div className="flex flex-wrap items-end justify-between gap-3 p-3 sm:p-4 border-t border-[#E2ECE8] dark:border-[#183831] text-xs">
              <div className="min-w-0 w-full sm:flex-1 sm:min-w-(--kael-field-min-inline-size) space-y-1">
                <label htmlFor="stock-opname-reason" className="block font-semibold text-[#0F2922] dark:text-white">
                  Alasan penyesuaian
                </label>
                <input
                  id="stock-opname-reason"
                  type="text"
                  value={opnameGlobalReason}
                  onChange={(e) => setOpnameGlobalReason(e.target.value)}
                  className="min-w-0 w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-white dark:bg-[#0B211D]"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {modifiedOpnameItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setOpnameDrafts({})}
                    className="px-3 py-1.5 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] text-xs font-medium text-[#52736B] hover:text-[#0F2922] cursor-pointer"
                  >
                    Reset
                  </button>
                )}
                <button
                  type="button"
                  data-testid="save-batch-opname-btn"
                  disabled={modifiedOpnameItems.length === 0 || isSavingBatchOpname}
                  onClick={handleBatchOpnameSave}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    modifiedOpnameItems.length > 0
                      ? 'bg-[#00897B] hover:bg-[#00796B] text-white cursor-pointer'
                      : 'bg-[#E2ECE8] dark:bg-[#163831] text-[#68877F] cursor-not-allowed'
                  }`}
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${isSavingBatchOpname ? 'animate-spin' : ''}`}
                  />
                  <span>
                    {isSavingBatchOpname ? 'Menyimpan…' : `Simpan ${modifiedOpnameItems.length} perubahan`}
                  </span>
                </button>
              </div>
            </div>

        </div>
      )}

      {/* ======================================================================== */}
      {/* TAB 3: OBAT MASUK (PBF) & OBAT KELUAR (PASIEN) BESERTA HARGA + OTOMASI   */}
      {/* ======================================================================== */}
      {activeTab === 'MUTASI_KELUAR_MASUK' && allowedTabs.includes('MUTASI_KELUAR_MASUK') && (
        <div className="min-w-0 space-y-3">
          {/* Top 2-Column Action Forms: Catat Obat Masuk (+Stok) & Catat Obat Keluar (-Stok) */}
          <div className="min-w-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-form-min-inline-size)),1fr))] gap-5">
            {/* Form 1: Obat Masuk PBF (Otomatis Menambah Stok + Hitung Harga Beli) */}
            <form
              onSubmit={handleRestockSubmit}
              className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-4 space-y-3.5"
            >
              <div className="flex items-center justify-between border-b border-[#E2ECE8] dark:border-[#183831] pb-2.5">
                <div>
                  <span className="text-caption font-bold uppercase tracking-wider text-[#00897B]">
                    PENERIMAAN OBAT MASUK
                  </span>
                  <h2 className="text-sm font-bold text-[#0F2922] dark:text-white">
                    Penerimaan Obat Masuk PBF
                  </h2>
                </div>
                <ArrowDownLeft className="w-5 h-5 text-[#00897B]" />
              </div>

              <div className="min-w-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-field-min-inline-size)),1fr))] gap-3 text-xs">
                <div className="">
                  <label className="block font-semibold mb-1">Pilih Obat / Alkes</label>
                  <select
                    value={restockMedId}
                    onChange={(e) => setRestockMedId(e.target.value)}
                    className="min-w-0 w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                  >
                <option value="">Pilih obat</option>
                    {workspace.medications.map((m) => {
                      const totalS = m.batches.reduce((s, b) => s + b.stock, 0);
                      return (
                        <option key={m.id} value={m.id}>
                          {m.code} — {m.name} (Stok: {totalS} {m.unit} • HNA:{' '}
                          {formatRupiah(m.buyPrice)})
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold mb-1">Nomor Batch Baru / Lama</label>
                  <input
                    type="text"
                    value={batchNumber}
                    onChange={(e) => setBatchNumber(e.target.value)}
                    required
                    className="min-w-0 w-full px-3 py-2 font-mono rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-1">Tgl. Kedaluwarsa</label>
                  <input
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    required
                    className="min-w-0 w-full px-3 py-2 font-mono rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-1">Jumlah Masuk</label>
                  <input
                    type="number"
                    min={1}
                    value={restockQty}
                    onChange={(e) => setRestockQty(Number(e.target.value))}
                    required
                    className="min-w-0 w-full px-3 py-2 font-mono font-bold rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-1">Distributor PBF</label>
                  <input
                    type="text"
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    className="min-w-0 w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                  />
                </div>
              </div>

              {(() => {
                const selectedMed = workspace.medications.find((m) => m.id === restockMedId);
                const curStock = selectedMed
                  ? selectedMed.batches.reduce((s, b) => s + b.stock, 0)
                  : 0;
                const totalBuy = selectedMed ? selectedMed.buyPrice * Number(restockQty) : 0;
                return (
                  <div className="p-3 rounded-xl bg-[#F4F9F7] dark:bg-[#081916] flex items-center justify-between text-xs font-mono">
                    <span>
                      Stok: {curStock} &rarr;{' '}
                      <strong className="text-[#00897B]">
                        {curStock + Number(restockQty)} {selectedMed?.unit}
                      </strong>
                    </span>
                    <span>
                      Total Nilai Masuk:{' '}
                      <strong className="text-[#00897B]">{formatRupiah(totalBuy)}</strong>
                    </span>
                  </div>
                );
              })()}

              <button
                type="submit"
                disabled={isRestocking}
                className="min-w-0 w-full py-2.5 px-4 rounded-xl bg-[#00897B] hover:bg-[#00796B] text-white text-xs font-semibold cursor-pointer"
              >
                {isRestocking
                  ? 'Memproses Obat Masuk...'
                  : 'Terima Obat Masuk'}
              </button>
            </form>

            {/* Form 2: Obat Keluar ke Pasien / Unit (Otomatis Mengurangi Stok FEFO + Hitung Harga Jual) */}
            <form
              onSubmit={handleDirectDispenseSubmit}
              className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-4 space-y-3.5"
            >
              <div className="flex items-center justify-between border-b border-[#E2ECE8] dark:border-[#183831] pb-2.5">
                <div>
                  <span className="text-caption font-bold uppercase tracking-wider text-amber-700 dark:text-[#E5B85B]">
                    PENGELUARAN OBAT FEFO
                  </span>
                  <h2 className="text-sm font-bold text-[#0F2922] dark:text-white">
                    Pengeluaran Obat ke Pasien / Unit Layanan
                  </h2>
                </div>
                <ArrowUpRight className="w-5 h-5 text-amber-600" />
              </div>

              <div className="min-w-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-field-min-inline-size)),1fr))] gap-3 text-xs">
                <div className="">
                  <label className="block font-semibold mb-1">Pilih Obat yang Dikeluarkan</label>
                  <select
                    value={outMedId}
                    onChange={(e) => setOutMedId(e.target.value)}
                    className="min-w-0 w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                  >
                <option value="">Pilih obat</option>
                    {workspace.medications.map((m) => {
                      const totalS = m.batches.reduce((s, b) => s + b.stock, 0);
                      return (
                        <option key={m.id} value={m.id}>
                          {m.code} — {m.name} (Stok Tersedia: {totalS} {m.unit} • HJA:{' '}
                          {formatRupiah(m.sellPrice)})
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold mb-1">Jumlah Keluar</label>
                  <input
                    type="number"
                    min={1}
                    value={outQty}
                    onChange={(e) => setOutQty(Number(e.target.value))}
                    required
                    className="min-w-0 w-full px-3 py-2 font-mono font-bold rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-1">Pasien / Unit Penerima</label>
                  <input
                    type="text"
                    value={outPatientOrUnit}
                    onChange={(e) => setOutPatientOrUnit(e.target.value)}
                    required
                    placeholder="Nama Pasien / RM / IGD..."
                    className="min-w-0 w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                  />
                </div>

                <div className="">
                  <label className="block font-semibold mb-1">Keterangan / Aturan Pakai</label>
                  <input
                    type="text"
                    value={outNotes}
                    onChange={(e) => setOutNotes(e.target.value)}
                    className="min-w-0 w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                  />
                </div>
              </div>

              {(() => {
                const selectedMed = workspace.medications.find((m) => m.id === outMedId);
                const curStock = selectedMed
                  ? selectedMed.batches.reduce((s, b) => s + b.stock, 0)
                  : 0;
                const totalSell = selectedMed ? selectedMed.sellPrice * Number(outQty) : 0;
                return (
                  <div className="p-3 rounded-xl bg-[#F4F9F7] dark:bg-[#081916] flex items-center justify-between text-xs font-mono">
                    <span>
                      Stok: {curStock} &rarr;{' '}
                      <strong className="text-amber-700 dark:text-[#E5B85B]">
                        {Math.max(0, curStock - Number(outQty))} {selectedMed?.unit}
                      </strong>
                    </span>
                    <span>
                      Total Nilai Jual Keluar:{' '}
                      <strong className="text-amber-700 dark:text-[#E5B85B]">
                        {formatRupiah(totalSell)}
                      </strong>
                    </span>
                  </div>
                );
              })()}

              <button
                type="submit"
                disabled={isDispensingDirect}
                className="min-w-0 w-full py-2.5 px-4 rounded-xl bg-[#0F3D35] hover:bg-[#0C312B] text-white text-xs font-semibold cursor-pointer"
              >
                {isDispensingDirect
                  ? 'Memproses Obat Keluar...'
                  : 'Serahkan Obat Keluar'}
              </button>
            </form>
          </div>

          {/* Complete Ledger Table of Incoming & Outgoing Medications with Prices */}
          <div className="min-w-0 bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-xl overflow-hidden">
            <div className="p-4 border-b border-[#E2ECE8] dark:border-[#183831] bg-[#F8FBFA] dark:bg-[#081916] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-[#0F2922] dark:text-white">
                    Tabel Riwayat Obat Masuk &amp; Obat Keluar Beserta Harga ({filteredMutations.length} Catatan)
                  </h2>
                  <p className="text-xs text-[#52736B] dark:text-[#86B5A9]">
                    Riwayat mutasi obat masuk PBF, penyerahan resep pasien, dan penyesuaian stok opname.
                  </p>
                </div>

                <DataExportToolbar
                  title="Laporan Kartu Stok & Mutasi Obat"
                  subtitle={`Masuk: +${pharmacyStats.totalIncomingQty} unit (${formatRupiah(
                    pharmacyStats.totalIncomingValue
                  )}) • Keluar: -${pharmacyStats.totalOutgoingQty} unit (${formatRupiah(
                    pharmacyStats.totalOutgoingValue
                  )})`}
                  filenameBase={`KAEL_Mutasi_Obat_Masuk_Keluar_${facilityCode}`}
                  facilityName={workspace.activeFacility.name}
                  facilityCode={facilityCode}
                  columns={mutationExportColumns}
                  rows={filteredMutations}
                  contextLabel="Ekspor Kartu Stok:"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2.5 text-xs pt-1">
                <select
                  aria-label="Filter Jenis Mutasi Obat"
                  value={mutationTypeFilter}
                  onChange={(e) =>
                    setMutationTypeFilter(e.target.value as 'ALL' | MedicationMutationType)
                  }
                  className="px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-white dark:bg-[#0B211D] font-medium"
                >
                  <option value="ALL">Semua Mutasi</option>
                  <option value="MASUK_PBF">Obat Masuk PBF</option>
                  <option value="KELUAR_RESEP">Obat Keluar Resep</option>
                  <option value="PENYESUAIAN_OPNAME">Hanya Penyesuaian Stock Opname</option>
                  <option value="STOK_AWAL">Hanya Saldo Stok Awal</option>
                </select>

                <select
                  aria-label="Filter Item Obat"
                  value={mutationMedFilter}
                  onChange={(e) => setMutationMedFilter(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-white dark:bg-[#0B211D] font-medium"
                >
                  <option value="ALL">Semua Item Obat ({workspace.medications.length})</option>
                  {workspace.medications.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.code} — {m.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="min-w-0 w-full overflow-x-auto">
              <table className="w-full min-w-full table-auto [&_th]:whitespace-nowrap text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#EAF3F0] dark:bg-[#0F2D27] text-[#52736B] dark:text-[#86B5A9] border-b border-[#E2ECE8] dark:border-[#183831]">
                    <th className="py-3 px-4 font-semibold">Waktu &amp; Referensi</th>
                    <th className="py-3 px-4 font-semibold">Jenis Mutasi</th>
                    <th className="py-3 px-4 font-semibold">Nama Obat &amp; Batch</th>
                    <th className="py-3 px-4 font-semibold text-right">Stok Awal</th>
                    <th className="py-3 px-4 font-semibold text-right">Masuk / Keluar</th>
                    <th className="py-3 px-4 font-semibold text-right">Stok Akhir</th>
                    <th className="py-3 px-4 font-semibold text-right">Harga Satuan</th>
                    <th className="py-3 px-4 font-semibold text-right">Total Nilai</th>
                    <th className="py-3 px-4 font-semibold">Pasien / PBF &amp; Keterangan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2ECE8] dark:divide-[#183831]">
                  {filteredMutations.map((mut) => {
                    const isIncoming = mut.quantityChange > 0;
                    return (
                      <tr
                        key={mut.id}
                        className="hover:bg-[#F3F8F6] dark:hover:bg-[#0F2B25]"
                      >
                        <td className="py-3 px-4 font-mono whitespace-nowrap">
                          <div className="font-bold text-[#0F2922] dark:text-white">
                            {mut.referenceId}
                          </div>
                          <div className="text-caption text-[#52736B]">
                            {mut.timestamp.slice(0, 16).replace('T', ' ')}
                          </div>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-caption font-mono font-bold ${
                              mut.type === 'MASUK_PBF' || mut.type === 'STOK_AWAL'
                                ? 'bg-[#E6F4F1] dark:bg-[#0F3830] text-[#00796B] dark:text-[#38E8D6]'
                                : mut.type === 'KELUAR_RESEP'
                                ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-[#E5B85B]'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {mut.type.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-[#0F2922] dark:text-white">
                            {mut.medicationName}
                          </div>
                          <div className="text-caption font-mono text-[#52736B]">
                            {mut.medicationCode} · Batch {mut.batchNumber}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-[#52736B] whitespace-nowrap">
                          {mut.stockBefore} {mut.unit}
                        </td>
                        <td
                          className={`py-3 px-4 text-right font-mono font-bold whitespace-nowrap ${
                            isIncoming
                              ? 'text-[#00897B]'
                              : 'text-amber-700 dark:text-[#E5B85B]'
                          }`}
                        >
                          {isIncoming ? `+${mut.quantityChange}` : mut.quantityChange}{' '}
                          {mut.unit}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-[#0F2922] dark:text-white whitespace-nowrap">
                          {mut.stockAfter} {mut.unit}
                        </td>
                        <td className="py-3 px-4 text-right font-mono whitespace-nowrap">
                          {formatRupiah(mut.unitPrice)}
                        </td>
                        <td
                          className={`py-3 px-4 text-right font-mono font-bold whitespace-nowrap ${
                            isIncoming
                              ? 'text-[#00897B]'
                              : 'text-amber-700 dark:text-[#E5B85B]'
                          }`}
                        >
                          {formatRupiah(mut.totalValue)}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-[#0F2922] dark:text-white">
                            {mut.counterpartyOrPatient}
                          </div>
                          <div className="text-caption text-[#52736B]">
                            {mut.notes} • Oleh: {mut.actorName}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================================== */}
      {/* TAB 4: LABORATORIUM PATOLOGI KLINIK & RADIOLOGI                          */}
      {/* ======================================================================== */}
      {activeTab === 'LABORATORIUM' && allowedTabs.includes('LABORATORIUM') && (
        <div className="min-w-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-form-min-inline-size)),1fr))] gap-4 items-start">
          {/* Left 5 Cols: Lab Worklist Queue & Direct Order Creation */}
          <div className="min-w-0 bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-4 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-[#0F2922] dark:text-white">
                Spesimen Laboratorium ({workspace.labOrders.length})
              </h2>
              <button
                type="button"
                onClick={() => setShowNewLabForm((prev) => !prev)}
                className="px-2.5 py-1.5 text-xs font-semibold rounded-xl bg-[#00897B] text-white hover:bg-[#00796B] flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Order Lab Baru
              </button>
            </div>

            <DataExportToolbar
              title="Laporan Pemeriksaan Laboratorium & Diagnostik"
              filenameBase={`KAEL_Laboratorium_${facilityCode}`}
              facilityName={workspace.activeFacility.name}
              facilityCode={facilityCode}
              columns={labExportColumns}
              rows={workspace.labOrders}
              compact
            />

            {showNewLabForm && (
              <form
                onSubmit={handleCreateDirectLabOrder}
                className="p-3.5 rounded-xl border border-[#00897B] bg-[#F4F9F7] dark:bg-[#081916] space-y-2.5 text-xs"
              >
                <div className="font-bold text-[#0F2922] dark:text-white">
                  Buat Permintaan Spesimen Lab Baru
                </div>
                <div>
                  <label className="block text-caption font-semibold mb-1">
                    Pilih Kunjungan Pasien
                  </label>
                  <select
                    value={newLabVisitId}
                    onChange={(e) => setNewLabVisitId(e.target.value)}
                    className="min-w-0 w-full px-2.5 py-1.5 rounded-lg border border-[#D5E3DF] dark:border-[#1E473F] bg-white dark:bg-[#0B211D]"
                  >
                <option value="">Pilih kunjungan</option>
                    {workspace.visits.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.queueNumber} — {v.patientName} ({v.mrNumber})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-caption font-semibold mb-1">
                    Panel Parameter Uji
                  </label>
                  <div className="min-w-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-field-min-inline-size)),1fr))] gap-1">
                    {['HGB', 'WBC', 'PLT', 'GDS', 'CHOL', 'UA', 'CREAT', 'SGOT'].map((code) => (
                      <label key={code} className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={newLabPanels.includes(code)}
                          onChange={() =>
                            setNewLabPanels((prev) =>
                              prev.includes(code)
                                ? prev.filter((c) => c !== code)
                                : [...prev, code]
                            )
                          }
                        />
                        <span className="font-mono">{code}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-caption font-semibold mb-1">Indikasi Klinis</label>
                  <input
                    type="text"
                    value={newLabNotes}
                    onChange={(e) => setNewLabNotes(e.target.value)}
                    className="min-w-0 w-full px-2.5 py-1.5 rounded-lg border border-[#D5E3DF] dark:border-[#1E473F] bg-white dark:bg-[#0B211D]"
                  />
                </div>
                <button
                  type="submit"
                  className="min-w-0 w-full py-1.5 rounded-lg bg-[#00897B] text-white font-semibold cursor-pointer"
                >
                  Terbitkan Barcode Spesimen
                </button>
              </form>
            )}

            <div className="space-y-2.5">
              {workspace.labOrders.map((order) => {
                const isSelected = selectedLabOrder?.id === order.id;
                return (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => selectLabForEdit(order)}
                    className={`w-full text-left p-3.5 rounded-xl border transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-[#00897B] bg-[#E6F4F1]/60 dark:bg-[#0F3830]/60'
                        : 'border-[#E2ECE8] dark:border-[#183831] hover:bg-[#F3F8F6] dark:hover:bg-[#0F2B25]'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="font-bold text-[#00897B]">{order.specimenCode}</span>
                      <span className="text-[#52736B]">{order.status.replace(/_/g, ' ')}</span>
                    </div>
                    <div className="text-xs font-semibold text-[#0F2922] dark:text-white mt-1">
                      {order.patientName} · {order.mrNumber}
                    </div>
                    <div className="text-caption text-[#52736B] mt-0.5">
                      Pengirim: {order.doctorName} · {order.parameters.length} Parameter Uji
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right 7 Cols: Lab Result Analyzer & Reference Flagging */}
          <div className="min-w-0 bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-4">
            {!selectedLabOrder ? (
              <div className="text-xs text-[#52736B] py-5 px-4 text-center">
                Pilih spesimen laboratorium untuk menginput dan memverifikasi hasil.
              </div>
            ) : (
              <form onSubmit={handleVerifyLab} className="space-y-4">
                <div className="flex items-start justify-between border-b border-[#E2ECE8] dark:border-[#183831] pb-3">
                  <div>
                    <div className="text-xs font-mono text-[#00897B] font-semibold">
                      Spesimen: {selectedLabOrder.specimenCode} · Status:{' '}
                      {selectedLabOrder.status.replace(/_/g, ' ')}
                    </div>
                    <h3 className="text-sm font-bold text-[#0F2922] dark:text-white mt-0.5">
                      Hasil Pemeriksaan Laboratorium — {selectedLabOrder.patientName} (
                      {selectedLabOrder.mrNumber})
                    </h3>
                    <div className="text-xs text-[#52736B]">
                      Indikasi Klinis: {selectedLabOrder.clinicalNotes}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] flex items-center gap-1.5 cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Cetak Tampilan Hasil
                  </button>
                </div>

                <div className="min-w-0 w-full overflow-x-auto">
                  <table className="w-full min-w-full table-auto [&_th]:whitespace-nowrap text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[#E2ECE8] dark:border-[#183831] text-caption text-[#52736B]">
                        <th className="py-2 px-3">Parameter Uji</th>
                        <th className="py-2 px-3">Hasil Kuantitatif</th>
                        <th className="py-2 px-3">Satuan</th>
                        <th className="py-2 px-3">Rentang referensi tersimpan</th>
                        <th className="py-2 px-3">Interpretasi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2ECE8] dark:divide-[#183831]">
                      {selectedLabOrder.parameters.map((param) => {
                        const currentVal =
                          labValues[param.code] !== undefined
                            ? labValues[param.code]
                            : param.value;
                        const reference = labReferences[param.code];
                        const referenceVerified = reference ? reference.verified && !!reference.source.trim() : param.referenceVerified === true && !!param.referenceSource?.trim();
                        const refMin = reference ? (reference.min === '' ? null : reference.min) : param.refMin;
                        const refMax = reference ? (reference.max === '' ? null : reference.max) : param.refMax;
                        const rangeFlag = currentVal === null || !Number.isFinite(currentVal) ? null : evaluateLabFlag(Number(currentVal), refMin, refMax, undefined, undefined, referenceVerified);
                        return (
                          <tr key={param.code}>
                            <td className="py-2.5 px-3 font-semibold">
                              <span className="font-mono text-[#00897B]">{param.code}</span> —{' '}
                              {param.name}
                            </td>
                            <td className="py-2.5 px-3">
                              <input
                                type="number"
                                step="0.1"
                                required
                                value={currentVal ?? ''}
                                onChange={(e) =>
                                  setLabValues({
                                    ...labValues,
                                    [param.code]: e.target.value === '' ? null : Number(e.target.value),
                                  })
                                }
                                className="w-24 px-2 py-1 text-xs font-mono font-bold rounded-lg border border-[#D5E3DF] dark:border-[#1E473F] bg-white dark:bg-[#071714]"
                              />
                            </td>
                            <td className="py-2.5 px-3 font-mono text-[#52736B]">{param.unit}</td>
                            <td className="py-2.5 px-3 font-mono tabular-nums text-[#52736B]">
                              {Number.isFinite(param.refMin) && Number.isFinite(param.refMax) ? `${param.refMin} – ${param.refMax}` : 'Belum ditetapkan'}
                              <div className="text-caption">{param.referenceVerified && param.referenceSource ? `Sumber tersimpan: ${param.referenceSource}` : 'Kesesuaian metode dan populasi belum diverifikasi.'}</div>
                            </td>
                            <td className="py-2.5 px-3 font-mono font-semibold">
                              <span className="text-slate-500">{rangeFlag === null ? 'Belum diukur' : rangeFlag === 'UNASSESSED' ? 'Belum dinilai terhadap rentang' : `${rangeFlag} · relatif terhadap rentang terkonfirmasi`}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <details className="rounded-lg border border-slate-300 dark:border-slate-700 p-3 text-xs space-y-3">
                  <summary className="cursor-pointer font-semibold">Referensi interpretasi per parameter (opsional)</summary>
                  <p className="max-w-(--kael-text-column-inline-size)">Isi hanya rentang yang telah ditetapkan laboratorium untuk metode dan populasi pasien ini. Tanpa konfirmasi serta sumber, hasil tersimpan tanpa klasifikasi otomatis.</p>
                  {selectedLabOrder.parameters.map((parameter) => {
                    const reference = labReferences[parameter.code] || { min: '', max: '', source: '', context: '', verified: false };
                    const update = (patch: Partial<LabReferenceDraft>) => setLabReferences((previous) => ({ ...previous, [parameter.code]: { ...reference, ...patch } }));
                    return <div key={parameter.code} className="border-t border-slate-200 dark:border-slate-700 pt-3 space-y-2">
                      <strong>{parameter.code} · {parameter.name}</strong>
                      <div className="min-w-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-field-min-inline-size)),1fr))] gap-2"><label>Batas bawah<input type="number" step="any" value={reference.min} onChange={(event) => update({ min: event.target.value === '' ? '' : Number(event.target.value), verified: false })} className="mt-1 min-w-0 w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" /></label><label>Batas atas<input type="number" step="any" value={reference.max} onChange={(event) => update({ max: event.target.value === '' ? '' : Number(event.target.value), verified: false })} className="mt-1 min-w-0 w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" /></label></div>
                      <label className="block">Sumber atau dokumen referensi<input value={reference.source} onChange={(event) => update({ source: event.target.value, verified: false })} className="mt-1 min-w-0 w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" /></label>
                      <label className="block">Metode dan populasi yang berlaku<input value={reference.context} onChange={(event) => update({ context: event.target.value, verified: false })} className="mt-1 min-w-0 w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" /></label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={reference.verified} onChange={(event) => update({ verified: event.target.checked })} />Saya telah memeriksa kesesuaian rentang dan sumber untuk hasil ini.</label>
                    </div>;
                  })}
                </details>
                <div>
                  <label className="block text-xs font-semibold text-[#0F2922] dark:text-white mb-1">
                    Ekspertise / Catatan Analis Patologi Klinik
                  </label>
                  <input
                    type="text"
                    value={labNotes}
                    onChange={(e) => setLabNotes(e.target.value)}
                    className="min-w-0 w-full px-3 py-2 text-xs rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-[#00897B] hover:bg-[#00796B] text-white text-xs font-semibold cursor-pointer"
                  >
                    Simpan Verifikasi Hasil Lokal
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ======================================================================== */}
      {/* TAB 5: PENGADAAN PO, FAKTUR PBF & HUTANG DAGANG                          */}
      {/* ======================================================================== */}
      {activeTab === 'PENGADAAN_PBF' && allowedTabs.includes('PENGADAAN_PBF') && (
        <div className="min-w-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-form-min-inline-size)),1fr))] gap-4 items-start">
          <form
            onSubmit={handleCreatePoSubmit}
            className="min-w-0 bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-4 space-y-3.5 text-xs"
          >
            <div>
              <h2 className="text-sm font-bold text-[#0F2922] dark:text-white">
                Penerbitan PO &amp; Penerimaan Faktur PBF
              </h2>
              <p className="text-xs text-[#52736B] mt-0.5">
                Otomatis menambah stok batch gudang farmasi, mencatat pajak sesuai faktur, dan menjurnal Hutang Dagang PBF.
              </p>
            </div>
            <div>
              <label className="block font-semibold mb-1">Distributor PBF</label>
              <input
                type="text"
                value={poSupplier}
                onChange={(e) => setPoSupplier(e.target.value)}
                required
                className="min-w-0 w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Nomor Faktur PBF</label>
              <input
                type="text"
                value={poInvoiceNo}
                onChange={(e) => setPoInvoiceNo(e.target.value)}
                required
                className="min-w-0 w-full px-3 py-2 font-mono rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Item Obat / BMHP</label>
              <select
                value={poMedId}
                onChange={(e) => setPoMedId(e.target.value)}
                className="min-w-0 w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
              >
                <option value="">Pilih obat</option>
                {workspace.medications.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.code} — {m.name} · HNA {formatRupiah(m.buyPrice)}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-field-min-inline-size)),1fr))] gap-2.5">
              <div>
                <label className="block font-semibold mb-1">Kuantitas</label>
                <input
                  type="number"
                  min={1}
                  value={poQty}
                  onChange={(e) => setPoQty(Number(e.target.value))}
                  className="min-w-0 w-full px-3 py-2 font-mono font-bold rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Batch</label>
                <input
                  type="text"
                  value={poBatch}
                  onChange={(e) => setPoBatch(e.target.value)}
                  className="min-w-0 w-full px-3 py-2 font-mono rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Kedaluwarsa</label>
                <input
                  type="date"
                  value={poExpiry}
                  onChange={(e) => setPoExpiry(e.target.value)}
                  className="min-w-0 w-full px-3 py-2 font-mono rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                />
              </div>
            </div>
            <div className="min-w-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-field-min-inline-size)),1fr))] gap-2.5">
              <label>Harga perolehan per unit sesuai faktur<input type="number" min={0} step="any" required value={poUnitCost} onChange={(event) => setPoUnitCost(event.target.value === '' ? '' : Number(event.target.value))} className="mt-1 min-w-0 w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" /></label>
              <label>Tarif pajak sesuai faktur (%)<input type="number" min={0} max={100} step="any" required value={poVatRate} onChange={(event) => setPoVatRate(event.target.value === '' ? '' : Number(event.target.value))} className="mt-1 min-w-0 w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" /></label>
            </div>
            <button
              type="submit"
              className="min-w-0 w-full py-2.5 rounded-xl bg-[#00897B] hover:bg-[#00796B] text-white font-semibold cursor-pointer"
            >
              Terbitkan PO &amp; Terima Faktur ke Gudang
            </button>
          </form>

          <div className="min-w-0 bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E2ECE8] dark:border-[#183831]">
              <h2 className="text-sm font-bold text-[#0F2922] dark:text-white">
                Daftar Purchase Order &amp; Faktur PBF ({(workspace.purchaseOrders || []).length})
              </h2>
            </div>
            <div className="min-w-0 w-full overflow-x-auto">
              <table className="w-full min-w-full table-auto [&_th]:whitespace-nowrap text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#EAF3F0] dark:bg-[#0F2D27] text-[#52736B] dark:text-[#86B5A9] border-b border-[#E2ECE8] dark:border-[#183831]">
                    <th className="py-3 px-4">No. PO &amp; Faktur</th>
                    <th className="py-3 px-4">Distributor PBF</th>
                    <th className="py-3 px-4 text-right">DPP HNA</th>
                    <th className="py-3 px-4 text-right">Pajak tercatat</th>
                    <th className="py-3 px-4 text-right">Total Tagihan</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2ECE8] dark:divide-[#183831]">
                  {(workspace.purchaseOrders || []).map((po) => (
                    <tr key={po.id}>
                      <td className="py-3 px-4 font-mono">
                        <div className="font-bold text-[#00897B]">{po.poNumber}</div>
                        <div className="text-caption text-[#52736B]">{po.supplierInvoiceNo}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-[#0F2922] dark:text-white">
                          {po.supplierName}
                        </div>
                        <div className="text-caption text-[#52736B]">
                          Jatuh tempo: {po.dueDate || 'Belum diisi'}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono">
                        {formatRupiah(po.subtotalHna)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono">
                        {typeof (po.ppnAmount ?? po.totalVat) === 'number' ? formatRupiah((po.ppnAmount ?? po.totalVat) as number) : 'Belum dicatat'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-[#0F2922] dark:text-white">
                        {formatRupiah(po.totalAmount ?? po.grandTotalPayable ?? 0)}
                      </td>
                      <td className="py-3 px-4 font-mono text-caption text-[#00897B] font-semibold">
                        {po.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================================== */}
      {/* TAB 6: RADIOLOGI & PENCITRAAN DIAGNOSTIK RIS                             */}
      {/* ======================================================================== */}
      {activeTab === 'RADIOLOGI_RIS' && allowedTabs.includes('RADIOLOGI_RIS') && (
        <div className="min-w-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-form-min-inline-size)),1fr))] gap-4 items-start">
          <form
            onSubmit={handleCreateRadiologySubmit}
            className="min-w-0 bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-4 space-y-3 text-xs"
          >
            <h2 className="text-sm font-bold text-[#0F2922] dark:text-white">
              Order &amp; Ekspertise Radiologi RIS
            </h2>
            <div>
              <label className="block font-semibold mb-1">Pasien Kunjungan</label>
              <select
                value={radVisitId}
                onChange={(e) => setRadVisitId(e.target.value)}
                className="min-w-0 w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
              >
                <option value="">Pilih kunjungan</option>
                {workspace.visits.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.queueNumber} — {v.patientName} · {v.mrNumber}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,var(--kael-field-min-inline-size)),1fr))] gap-2.5">
              <div>
                <label className="block font-semibold mb-1">Modalitas</label>
                <select
                  value={radModality}
                  onChange={(e) =>
                    setRadModality(e.target.value as 'XRAY' | 'USG' | 'CT' | 'MRI' | '')
                  }
                  className="min-w-0 w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                >
                  <option value="">Pilih modalitas</option>
                  <option value="XRAY">X-Ray Digital</option>
                  <option value="USG">Ultrasonografi USG</option>
                  <option value="CT">CT-Scan</option>
                  <option value="MRI">MRI</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Pemeriksaan</label>
                <input
                  type="text"
                  value={radExamName}
                  onChange={(e) => setRadExamName(e.target.value)}
                  className="min-w-0 w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold mb-1">Indikasi Klinis</label>
              <input
                type="text"
                value={radIndication}
                onChange={(e) => setRadIndication(e.target.value)}
                className="min-w-0 w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Temuan Ekspertise Radiolog</label>
              <textarea
                rows={2}
                value={radFindings}
                onChange={(e) => setRadFindings(e.target.value)}
                className="min-w-0 w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Kesan / Kesimpulan</label>
              <input
                type="text"
                value={radImpression}
                onChange={(e) => setRadImpression(e.target.value)}
                className="min-w-0 w-full px-3 py-2 rounded-xl border border-[#D5E3DF] dark:border-[#1E473F] bg-[#F8FBFA] dark:bg-[#071714]"
              />
            </div>
            <label className="block font-semibold">Tarif fasilitas (kosong: belum ditetapkan)<input type="number" min={0} step="any" value={radTariff} onChange={(event) => setRadTariff(event.target.value === '' ? '' : Number(event.target.value))} className="mt-1 min-w-0 w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" /></label>
            <button
              type="submit"
              className="min-w-0 w-full py-2.5 rounded-xl bg-[#00897B] hover:bg-[#00796B] text-white font-semibold cursor-pointer"
            >
              Simpan Order / Hasil Radiologi
            </button>
          </form>

          <div className="min-w-0 bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E2ECE8] dark:border-[#183831]">
              <h2 className="text-sm font-bold text-[#0F2922] dark:text-white">
                Daftar Pemeriksaan Radiologi RIS ({(workspace.radiologyOrders || []).length})
              </h2>
            </div>
            <div className="divide-y divide-[#E2ECE8] dark:divide-[#183831] text-xs">
              {(workspace.radiologyOrders || []).map((ro) => (
                <div key={ro.id} className="p-4 space-y-1.5">
                  <div className="flex items-center justify-between font-mono">
                    <span className="font-bold text-[#00897B]">
                      {ro.accessionNumber} · {ro.modality} — {ro.examName}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-[#E6F4F1] text-[#00796B] font-semibold">
                      {ro.status}
                    </span>
                  </div>
                  <div className="font-semibold text-[#0F2922] dark:text-white">
                    {ro.patientName} · {ro.mrNumber} · Radiolog: {ro.radiologistName}
                  </div>
                  <div className="text-[#52736B]">{ro.findings}</div>
                  <div className="font-semibold text-[#00897B]">Kesan: {ro.impression}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ======================================================================== */}
      {/* TAB 7: INSTALASI PENUNJANG RS (GIZI, BANK DARAH, CSSD & IPSRS)           */}
      {/* ======================================================================== */}
      {activeTab === 'PENUNJANG_RS' && allowedTabs.includes('PENUNJANG_RS') && (
        <div className="min-w-0 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-4 space-y-2">
            <div className="font-mono text-caption text-[#00897B] font-bold">
              INSTALASI GIZI KLINIK
            </div>
            <h3 className="text-sm font-bold text-[#0F2922] dark:text-white">
              Dietetik Bangsal &amp; Asuhan Gizi Rawat Inap
            </h3>
            <p className="max-w-(--kael-text-column-inline-size) text-[#52736B]">
              Data asesmen, rencana diet, dan distribusi makanan belum tersedia di KAEL. Konfirmasikan pelayanan dengan unit gizi.
            </p>
          </div>
          <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-4 space-y-2">
            <div className="font-mono text-caption text-[#00897B] font-bold">
              BANK DARAH RUMAH SAKIT
            </div>
            <h3 className="text-sm font-bold text-[#0F2922] dark:text-white">
              Stok Komponen Darah PRC, TC, FFP &amp; Crossmatch
            </h3>
            <p className="max-w-(--kael-text-column-inline-size) text-[#52736B]">
              Data stok komponen darah dan hasil uji silang belum tersedia di KAEL. Konfirmasikan ketersediaan dengan unit bank darah.
            </p>
          </div>
          <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-4 space-y-2">
            <div className="font-mono text-caption text-[#00897B] font-bold">
              STERILISASI SENTRAL
            </div>
            <h3 className="text-sm font-bold text-[#0F2922] dark:text-white">
              Dekontaminasi, Autoclave &amp; Indikator Biologi Set Instrumen
            </h3>
            <p className="max-w-(--kael-text-column-inline-size) text-[#52736B]">
              Data siklus sterilisasi dan hasil indikator belum tersedia di KAEL. Status steril instrumen harus dikonfirmasi dengan unit CSSD.
            </p>
          </div>
          <div className="bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] rounded-2xl p-4 space-y-2">
            <div className="font-mono text-caption text-[#00897B] font-bold">
              PEMELIHARAAN SARANA &amp; AMBULANS
            </div>
            <h3 className="text-sm font-bold text-[#0F2922] dark:text-white">
              Kalibrasi Alat Kesehatan ASPAK, Gas Medis &amp; Armada Rujukan
            </h3>
            <p className="max-w-(--kael-text-column-inline-size) text-[#52736B]">
              Data pemeliharaan, gas medis, dan kesiapan ambulans belum tersedia di KAEL. Konfirmasikan kondisi sarana dan armada dengan unit terkait.
            </p>
          </div>
        </div>
      )}
        {/* Recorded inventory values and availability of historical stock metrics */}
        {isInventoryContext && <details className="rounded-lg border border-[#DCE8E4] dark:border-[#183831] bg-[#F4F9F7] dark:bg-[#081916]">
          <summary className="px-3 py-2 text-xs font-semibold cursor-pointer text-[#52736B] dark:text-[#86B5A9]">Ringkasan persediaan</summary>
          <div className="min-w-0 grid grid-cols-2 xl:grid-cols-4 gap-2 px-3 pb-3">
          <div className="min-w-0 p-3 rounded-xl bg-[#F4F9F7] dark:bg-[#081916] border border-[#DCE8E4] dark:border-[#183831]">
            <div className="text-xs text-[#52736B] dark:text-[#86B5A9]">
              Nilai Aset HNA &amp; Potensi HJA
            </div>
            <div className="text-lg font-bold text-[#0F2922] dark:text-white font-mono mt-1">
              {formatRupiah(pharmacyStats.totalInventoryAssetHna)}
            </div>
            <div className="text-caption font-mono text-[#00796B] dark:text-[#4DB6AC] mt-1">
              HJA {formatRupiah(pharmacyStats.totalPotentialSalesHja)} • Margin{' '}
              {typeof deepErp.pharmacyAnalytics.potentialMarginPercent === 'number' && Number.isFinite(deepErp.pharmacyAnalytics.potentialMarginPercent)
                ? `${deepErp.pharmacyAnalytics.potentialMarginPercent}%`
                : 'belum tersedia'}
            </div>
          </div>

          <div className="min-w-0 p-3 rounded-xl bg-[#F4F9F7] dark:bg-[#081916] border border-[#DCE8E4] dark:border-[#183831]">
            <div className="text-xs text-[#52736B] dark:text-[#86B5A9]">
              Perputaran &amp; Hari Persediaan
            </div>
            <div className="text-lg font-bold text-[#00897B] font-mono mt-1">
              {typeof deepErp.pharmacyAnalytics.inventoryTurnoverRatio === 'number' && Number.isFinite(deepErp.pharmacyAnalytics.inventoryTurnoverRatio)
                ? `ITR ${deepErp.pharmacyAnalytics.inventoryTurnoverRatio}x`
                : 'Belum tersedia'}
            </div>
            <div className="text-caption font-mono text-[#52736B] dark:text-[#86B5A9] mt-1">
              {typeof deepErp.pharmacyAnalytics.daysSalesOfInventory === 'number' && Number.isFinite(deepErp.pharmacyAnalytics.daysSalesOfInventory)
                ? `DSI ${deepErp.pharmacyAnalytics.daysSalesOfInventory} hari`
                : 'Memerlukan riwayat persediaan dan periode perhitungan.'}
            </div>
            <div className="text-caption font-mono text-[#52736B] dark:text-[#86B5A9] mt-1">{pharmacyStats.totalUnitsInStock} unit tercatat</div>
          </div>

          <div className="min-w-0 p-3 rounded-xl bg-[#F4F9F7] dark:bg-[#081916] border border-[#DCE8E4] dark:border-[#183831]">
            <div className="text-xs text-[#52736B] dark:text-[#86B5A9]">
              Mutasi Masuk PBF &amp; Keluar Pasien
            </div>
            <div className="text-lg font-bold text-[#0F2922] dark:text-white font-mono mt-1">
              +{pharmacyStats.totalIncomingQty} / -{pharmacyStats.totalOutgoingQty} unit
            </div>
            <div className="text-caption font-mono text-[#52736B] dark:text-[#86B5A9] mt-1">
              Keluar {formatRupiah(pharmacyStats.totalOutgoingValue)}
            </div>
          </div>

          <div className="min-w-0 p-3 rounded-xl bg-[#F4F9F7] dark:bg-[#081916] border border-[#DCE8E4] dark:border-[#183831]">
            <div className="text-xs text-[#52736B] dark:text-[#86B5A9]">
              Kedaluwarsa &amp; Pergerakan Stok
            </div>
            <div className="text-lg font-bold text-amber-700 dark:text-[#E5B85B] font-mono mt-1">
              {Number.isFinite(workspace.activeFacilityConfig?.pharmacyPolicy.nearExpiryThresholdDays) ? `${deepErp.pharmacyAnalytics.nearExpiryBatchCount} batch kedaluwarsa atau ≤${workspace.activeFacilityConfig?.pharmacyPolicy.nearExpiryThresholdDays} hari` : 'Ambang kedaluwarsa belum ditetapkan'}
            </div>
            <div className="text-caption font-mono text-[#52736B] dark:text-[#86B5A9] mt-1">
              Stok kritis {pharmacyStats.lowStockCount} SKU
            </div>
            <div className="text-caption text-[#52736B] dark:text-[#86B5A9] mt-1">
              {typeof deepErp.pharmacyAnalytics.deadStockItemCount === 'number' && Number.isFinite(deepErp.pharmacyAnalytics.deadStockItemCount)
                ? `Stok tidak bergerak: ${deepErp.pharmacyAnalytics.deadStockItemCount} item`
                : 'Penilaian stok tidak bergerak belum tersedia.'}
            </div>
          </div>
        </div>

        </details>}
    </div>
  );
};
