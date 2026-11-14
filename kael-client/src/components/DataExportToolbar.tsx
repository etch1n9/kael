import React, { useState } from 'react';
import { ModalDialog } from './ModalDialog';
import {
  Download,
  FileSpreadsheet,
  FileText,
  Printer,
  Table,
  X,
} from 'lucide-react';
import {
  ExportColumn,
  ExportDocumentPayload,
  exportToCsv,
  exportToDocs,
  exportToPdf,
  exportToExcelXml,
  printDocumentIsolated,
} from '../utils/exportDocument';

interface DataExportToolbarProps<T = Record<string, unknown>> {
  title: string;
  subtitle?: string;
  filenameBase: string;
  facilityName: string;
  facilityCode: string;
  columns: ExportColumn<T>[];
  rows: T[];
  compact?: boolean;
  contextLabel?: string;
}

export function DataExportToolbar<T = Record<string, unknown>>({
  title,
  subtitle,
  filenameBase,
  facilityName,
  facilityCode,
  columns,
  rows,
  compact = false,
  contextLabel = 'Ekspor Tabel:',
}: DataExportToolbarProps<T>) {
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [feedbackToast, setFeedbackToast] = useState<string | null>(null);

  const payload: ExportDocumentPayload<T> = {
    title,
    subtitle,
    filenameBase,
    facilityName,
    facilityCode,
    columns,
    rows,
  };

  const triggerNotice = (msg: string) => {
    setFeedbackToast(msg);
    setTimeout(() => setFeedbackToast(null), 3200);
  };

  const handleDownloadPdf = () => {
    exportToPdf(payload);
    triggerNotice(`PDF dengan ${rows.length} baris disiapkan untuk diunduh.`);
  };

  return (
    <>
      <div
        data-testid="contextual-data-export-toolbar"
        className="inline-flex flex-wrap items-center gap-1.5 no-print bg-[#F4F9F7] dark:bg-[#091E1A] px-2.5 py-1.5 rounded-xl border border-[#D5E3DF] dark:border-[#1B423A]"
      >
        {!compact && (
          <span className="text-caption font-semibold text-[#52736B] dark:text-[#86B5A9] flex items-center gap-1 pr-1">
            <Download className="w-3 h-3 text-[#00897B]" />
            <span>{contextLabel}</span>
          </span>
        )}

        <button
          type="button"
          onClick={() => setShowPdfPreview(true)}
          title="Pratinjau & Unduh PDF"
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-caption font-mono font-semibold border border-[#C8DDD7] dark:border-[#1E473F] bg-white dark:bg-[#0D2823] text-[#0F2922] dark:text-[#E6F4F1] hover:bg-[#00897B] hover:text-white hover:border-[#00897B] transition-colors cursor-pointer"
        >
          <Printer className="w-3 h-3 text-[#00897B] group-hover:text-white" />
          <span>{compact ? 'PDF' : 'Ekspor PDF'}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            exportToExcelXml(payload);
            triggerNotice(`Excel XML dengan ${rows.length} baris disiapkan untuk diunduh.`);
          }}
          title="Ekspor Excel XML (.xml)"
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-caption font-mono font-semibold border border-[#C8DDD7] dark:border-[#1E473F] bg-white dark:bg-[#0D2823] text-[#0F2922] dark:text-[#E6F4F1] hover:bg-[#00897B] hover:text-white hover:border-[#00897B] transition-colors cursor-pointer"
        >
          <FileSpreadsheet className="w-3 h-3 text-[#00897B]" />
          <span>{compact ? 'Excel XML' : 'Ekspor Excel XML'}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            exportToCsv(payload);
            triggerNotice(`CSV dengan ${rows.length} baris disiapkan untuk diunduh.`);
          }}
          title="Ekspor ke CSV"
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-caption font-mono font-semibold border border-[#C8DDD7] dark:border-[#1E473F] bg-white dark:bg-[#0D2823] text-[#0F2922] dark:text-[#E6F4F1] hover:bg-[#00897B] hover:text-white hover:border-[#00897B] transition-colors cursor-pointer"
        >
          <Table className="w-3 h-3 text-[#00897B]" />
          <span>{compact ? 'CSV' : 'Ekspor CSV'}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            exportToDocs(payload);
            triggerNotice(`Dokumen dengan ${rows.length} baris disiapkan untuk diunduh.`);
          }}
          title="Ekspor ke Dokumen Word"
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-caption font-mono font-semibold border border-[#C8DDD7] dark:border-[#1E473F] bg-white dark:bg-[#0D2823] text-[#0F2922] dark:text-[#E6F4F1] hover:bg-[#00897B] hover:text-white hover:border-[#00897B] transition-colors cursor-pointer"
        >
          <FileText className="w-3 h-3 text-[#00897B]" />
          <span>{compact ? 'DOC' : 'Ekspor DOC'}</span>
        </button>

        {feedbackToast && (
          <span className="text-caption font-medium px-2 py-0.5 rounded-md bg-[#E6F4F1] dark:bg-[#0F3D35] text-[#00695C] dark:text-[#80CBC4]">
            {feedbackToast}
          </span>
        )}
      </div>

      {/* Printable & Downloadable PDF Preview Modal */}
      {showPdfPreview && (
        <ModalDialog onClose={() => setShowPdfPreview(false)} label={`Pratinjau & Unduh PDF ${title}`}>
          <div className="min-h-0 bg-white text-[#0F2922] rounded-2xl max-w-6xl w-full max-h-full flex flex-col overflow-hidden shadow-2xl border border-[#DCE7E3]">
            {/* Modal Action Bar */}
            <div className="shrink-0 px-4 py-3 border-b border-[#DCE7E3] flex flex-wrap items-center justify-between gap-3 bg-[#F4F9F7] rounded-t-2xl no-print">
              <div>
                <span className="text-caption font-bold uppercase tracking-wider text-[#00897B]">
                  PRATINJAU &amp; UNDUH PDF
                </span>
                <h3 className="text-base font-bold text-[#0F2922]">{title}</h3>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="download-pdf-binary-btn"
                  onClick={handleDownloadPdf}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#00897B] hover:bg-[#00796B] text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Unduh File PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => printDocumentIsolated(payload)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#B9D1C9] bg-white hover:bg-[#EAF3F0] text-[#0F2922] text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Printer className="w-4 h-4 text-[#00897B]" />
                  <span>Cetak Printer</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowPdfPreview(false)}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-[#CEDFD9] hover:bg-white text-xs font-medium text-[#52736B] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                  <span>Tutup</span>
                </button>
              </div>
            </div>

            {/* Exported table preview */}
            <div className="min-h-0 p-3 sm:p-5 overflow-y-auto flex-1 space-y-4">
              <div className="border-b-2 border-[#00897B] pb-3 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="text-caption font-bold tracking-widest text-[#00897B] uppercase">
                    KAEL — EKSPOR DATA
                  </div>
                  <h2 className="text-xl font-bold text-[#0F2922] mt-0.5">{title}</h2>
                  <p className="text-xs text-[#52736B]">
                    {facilityName} ({facilityCode})
                    {subtitle ? ` — ${subtitle}` : ''}
                  </p>
                </div>
                <div className="text-right text-xs text-[#52736B] font-mono">
                  <div>Dibuat: {new Date().toLocaleString('id-ID')}</div>
                  <div>Total Data: {rows.length} baris</div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#0F3D35] text-white">
                      {columns.map((col, idx) => (
                        <th
                          key={idx}
                          className="py-2.5 px-3 text-left font-semibold border border-[#0F3D35]"
                        >
                          {col.header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={columns.length}
                          className="py-8 text-center text-[#52736B] border border-[#DCE7E3]"
                        >
                          Tidak ada baris data pada filter saat ini.
                        </td>
                      </tr>
                    ) : (
                      rows.map((row, rIdx) => (
                        <tr
                          key={rIdx}
                          className={rIdx % 2 === 0 ? 'bg-white' : 'bg-[#F4F9F7]'}
                        >
                          {columns.map((col, cIdx) => {
                            const val = col.format
                              ? col.format(row)
                              : (row as Record<string, unknown>)[String(col.key)];
                            const display =
                              val === null || val === undefined
                                ? '-'
                                : Array.isArray(val)
                                ? val.join(', ')
                                : String(val);
                            return (
                              <td
                                key={cIdx}
                                className="py-2 px-3 border border-[#DCE7E3] text-[#0F2922] align-top"
                              >
                                {display}
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="pt-6 flex items-center justify-between text-xs text-[#52736B] border-t border-[#E6F0EC]">
                <span>
                  Data fasilitas: {facilityName}
                </span>
                <span>Pratinjau data ekspor</span>
              </div>
            </div>
          </div>
        </ModalDialog>
      )}
    </>
  );
}
