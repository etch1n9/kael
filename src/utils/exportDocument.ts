export interface ExportColumn<T = Record<string, unknown>> {
  key: keyof T | string;
  header: string;
  format?: (row: T) => string | number;
}

export interface ExportDocumentPayload<T = Record<string, unknown>> {
  title: string;
  subtitle?: string;
  filenameBase: string;
  facilityName: string;
  facilityCode: string;
  columns: ExportColumn<T>[];
  rows: T[];
  generatedBy?: string;
}

function escapeHtml(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function extractCellValue<T>(row: T, col: ExportColumn<T>): string {
  if (col.format) {
    const formatted = col.format(row);
    return formatted === null || formatted === undefined ? '' : String(formatted);
  }
  const rec = row as Record<string, unknown>;
  const raw = rec[String(col.key)];
  if (raw === null || raw === undefined) return '';
  if (Array.isArray(raw)) return raw.join(', ');
  if (typeof raw === 'object') return JSON.stringify(raw);
  return String(raw);
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * 1. Export to RFC-4180 CSV (UTF-8 with BOM for Excel compatibility)
 */
export function exportToCsv<T>(payload: ExportDocumentPayload<T>): void {
  const headers = payload.columns.map((c) => `"${c.header.replace(/"/g, '""')}"`).join(',');
  const lines = payload.rows.map((row) =>
    payload.columns
      .map((col) => {
        const val = extractCellValue(row, col).replace(/"/g, '""');
        return `"${val}"`;
      })
      .join(',')
  );
  const csvContent = '\uFEFF' + [headers, ...lines].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const dateTag = new Date().toISOString().slice(0, 10);
  triggerBlobDownload(blob, `${payload.filenameBase}_${dateTag}.csv`);
}

/**
 * 2. Export to Microsoft Excel SpreadsheetML (.xlsx / Spreadsheet XML)
 */
export function exportToXlsx<T>(payload: ExportDocumentPayload<T>): void {
  const timestamp = new Date().toLocaleString('id-ID');
  const headerCells = payload.columns
    .map(
      (col) =>
        `<Cell ss:StyleID="sHeader"><Data ss:Type="String">${escapeHtml(col.header)}</Data></Cell>`
    )
    .join('');

  const dataRows = payload.rows
    .map((row) => {
      const cells = payload.columns
        .map((col) => {
          const val = extractCellValue(row, col);
          const numericClean = val.replace(/[^0-9.-]/g, '');
          const isStrictNum =
            /^-?\d+(\.\d+)?$/.test(val.trim()) &&
            !val.trim().startsWith('0') &&
            numericClean.length < 15;
          if (isStrictNum) {
            return `<Cell ss:StyleID="sBody"><Data ss:Type="Number">${Number(val)}</Data></Cell>`;
          }
          return `<Cell ss:StyleID="sBody"><Data ss:Type="String">${escapeHtml(val)}</Data></Cell>`;
        })
        .join('');
      return `<Row ss:Height="20">${cells}</Row>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="10" ss:Color="#0F2922"/>
  </Style>
  <Style ss:ID="sTitle">
   <Font ss:FontName="Calibri" ss:Size="14" ss:Bold="1" ss:Color="#0F3D35"/>
  </Style>
  <Style ss:ID="sMeta">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Color="#52736B"/>
  </Style>
  <Style ss:ID="sHeader">
   <Interior ss:Color="#0F3D35" ss:Pattern="Solid"/>
   <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#0F3D35"/>
   </Borders>
  </Style>
  <Style ss:ID="sBody">
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#DCE7E3"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#DCE7E3"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#DCE7E3"/>
   </Borders>
  </Style>
 </Styles>
 <Worksheet ss:Name="${escapeHtml(payload.title.slice(0, 28))}">
  <Table>
   <Row ss:Height="24">
    <Cell ss:StyleID="sTitle"><Data ss:Type="String">KAEL HEALTHCARE &amp; ERP — ${escapeHtml(
      payload.title
    )}</Data></Cell>
   </Row>
   <Row ss:Height="18">
    <Cell ss:StyleID="sMeta"><Data ss:Type="String">Fasilitas: ${escapeHtml(
      payload.facilityName
    )} (${escapeHtml(payload.facilityCode)}) • Dicetak: ${escapeHtml(timestamp)}</Data></Cell>
   </Row>
   <Row ss:Height="10"></Row>
   <Row ss:Height="24">${headerCells}</Row>
   ${dataRows}
  </Table>
 </Worksheet>
</Workbook>`;

  const blob = new Blob([xml], {
    type: 'application/vnd.ms-excel;charset=utf-8',
  });
  const dateTag = new Date().toISOString().slice(0, 10);
  triggerBlobDownload(blob, `${payload.filenameBase}_${dateTag}.xlsx`);
}

/**
 * 3. Export to Word Document (.doc / Wordprocessing HTML)
 */
export function exportToDocs<T>(payload: ExportDocumentPayload<T>): void {
  const html = buildPrintableHtml(payload);
  const blob = new Blob(['\ufeff', html], {
    type: 'application/msword;charset=utf-8',
  });
  const dateTag = new Date().toISOString().slice(0, 10);
  triggerBlobDownload(blob, `${payload.filenameBase}_${dateTag}.doc`);
}

/**
 * 4. Build Structured Printable HTML matching the PDF Preview 100%
 */
export function buildPrintableHtml<T>(payload: ExportDocumentPayload<T>): string {
  const timestamp = new Date().toLocaleString('id-ID');
  const ths = payload.columns
    .map(
      (col) =>
        `<th style="background:#0F3D35;color:#ffffff;padding:8px 10px;text-align:left;font-size:11px;border:1px solid #0F3D35;">${escapeHtml(
          col.header
        )}</th>`
    )
    .join('');

  const trs = payload.rows
    .map((row, idx) => {
      const bg = idx % 2 === 0 ? '#ffffff' : '#F4F9F7';
      const tds = payload.columns
        .map(
          (col) =>
            `<td style="padding:7px 10px;font-size:11px;border:1px solid #DCE7E3;background:${bg};color:#0F2922;">${escapeHtml(
              extractCellValue(row, col)
            )}</td>`
        )
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(payload.title)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font-family: 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif; color: #0F2922; margin: 20px; background: #ffffff; }
  h1 { font-size: 18px; margin: 0 0 4px 0; color: #0F3D35; }
  .meta { font-size: 11px; color: #52736B; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; }
</style>
</head>
<body>
  <div style="border-bottom:2px solid #00897B;padding-bottom:10px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:flex-end;">
    <div>
      <div style="font-size:10px;font-weight:700;letter-spacing:0.12em;color:#00897B;">KAEL HEALTHCARE &amp; ERP</div>
      <h1>${escapeHtml(payload.title)}</h1>
      <div class="meta">${escapeHtml(payload.facilityName)} (${escapeHtml(
        payload.facilityCode
      )})${payload.subtitle ? ` • ${escapeHtml(payload.subtitle)}` : ''}</div>
    </div>
    <div style="font-size:11px;color:#52736B;text-align:right;">
      Waktu Cetak: ${escapeHtml(timestamp)}<br/>
      Total Baris Data: ${payload.rows.length} catatan
    </div>
  </div>
  <table>
    <thead><tr>${ths}</tr></thead>
    <tbody>${trs}</tbody>
  </table>
</body>
</html>`;
}

/**
 * Helper: Wrap text into lines that fit within maxWidth on a 2D Canvas context
 */
function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const clean = (text || '-').replace(/\s+/g, ' ').trim();
  if (!clean) return ['-'];
  if (ctx.measureText(clean).width <= maxWidth) return [clean];

  const words = clean.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) {
        lines.push(current);
      }
      // If a single word is longer than maxWidth, slice by characters
      if (ctx.measureText(word).width > maxWidth) {
        let chunk = '';
        for (const ch of word) {
          if (ctx.measureText(chunk + ch).width <= maxWidth) {
            chunk += ch;
          } else {
            lines.push(chunk);
            chunk = ch;
          }
        }
        current = chunk;
      } else {
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3); // Max 3 lines per cell to keep table clean
}

/**
 * Assemble one or more JPEG data URLs into a valid multi-page PDF-1.4 binary Uint8Array
 * Page size: A4 Landscape (841.89 x 595.28 pt)
 */
export function buildPdfBinaryFromJpegDataUrls(
  jpegDataUrls: { dataUrl: string; widthPx: number; heightPx: number }[]
): Uint8Array {
  const pageWidthPt = 841.89;
  const pageHeightPt = 595.28;

  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let byteOffset = 0;

  const pushBytes = (bytes: Uint8Array) => {
    chunks.push(bytes);
    byteOffset += bytes.byteLength;
  };
  const pushStr = (str: string) => {
    pushBytes(encoder.encode(str));
  };

  // Object 1: Catalog, Object 2: Pages
  // For each page i (0..N-1):
  //   pageObjId = 3 + i * 3
  //   contentObjId = 4 + i * 3
  //   imageObjId = 5 + i * 3
  const totalObjects = 2 + jpegDataUrls.length * 3;
  const offsets: number[] = new Array(totalObjects + 1).fill(0);

  pushStr('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');

  // 1 0 obj (Catalog)
  offsets[1] = byteOffset;
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // 2 0 obj (Pages)
  const kidsRefs = jpegDataUrls.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  offsets[2] = byteOffset;
  pushStr(
    `2 0 obj\n<< /Type /Pages /Kids [ ${kidsRefs} ] /Count ${jpegDataUrls.length} >>\nendobj\n`
  );

  for (let i = 0; i < jpegDataUrls.length; i++) {
    const pageObjId = 3 + i * 3;
    const contentObjId = 4 + i * 3;
    const imageObjId = 5 + i * 3;
    const { dataUrl, widthPx, heightPx } = jpegDataUrls[i];

    const base64Data = dataUrl.split(',')[1] || '';
    const binaryStr = atob(base64Data);
    const jpegBytes = new Uint8Array(binaryStr.length);
    for (let k = 0; k < binaryStr.length; k++) {
      jpegBytes[k] = binaryStr.charCodeAt(k);
    }

    // Page Object
    offsets[pageObjId] = byteOffset;
    pushStr(
      `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidthPt} ${pageHeightPt}] /Resources << /XObject << /Im${i} ${imageObjId} 0 R >> >> /Contents ${contentObjId} 0 R >>\nendobj\n`
    );

    // Content Stream (draw image scaled to full A4 landscape page)
    const contentStream = `q\n${pageWidthPt} 0 0 ${pageHeightPt} 0 0 cm\n/Im${i} Do\nQ\n`;
    const contentBytes = encoder.encode(contentStream);
    offsets[contentObjId] = byteOffset;
    pushStr(`${contentObjId} 0 obj\n<< /Length ${contentBytes.byteLength} >>\nstream\n`);
    pushBytes(contentBytes);
    pushStr('\nendstream\nendobj\n');

    // Image XObject (DCTDecode JPEG)
    offsets[imageObjId] = byteOffset;
    pushStr(
      `${imageObjId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.byteLength} >>\nstream\n`
    );
    pushBytes(jpegBytes);
    pushStr('\nendstream\nendobj\n');
  }

  // Cross-reference table
  const xrefOffset = byteOffset;
  pushStr(`xref\n0 ${totalObjects + 1}\n`);
  pushStr('0000000000 65535 f \n');
  for (let objId = 1; objId <= totalObjects; objId++) {
    const padded = String(offsets[objId]).padStart(10, '0');
    pushStr(`${padded} 00000 n \n`);
  }

  pushStr(
    `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  );

  const output = new Uint8Array(byteOffset);
  let pos = 0;
  for (const chunk of chunks) {
    output.set(chunk, pos);
    pos += chunk.byteLength;
  }
  return output;
}

/**
 * 5. Export directly to a downloadable multi-page PDF (.pdf) file whose layout matches the preview modal 100%
 */
export function exportToPdf<T>(payload: ExportDocumentPayload<T>): void {
  const canvasW = 1684; // High-DPI A4 Landscape width
  const canvasH = 1190; // High-DPI A4 Landscape height
  const marginX = 64;
  const marginY = 56;
  const contentW = canvasW - marginX * 2;
  const timestamp = new Date().toLocaleString('id-ID');

  const colCount = Math.max(1, payload.columns.length);
  const colW = contentW / colCount;

  // Create offscreen measurement canvas
  const measureCanvas = document.createElement('canvas');
  measureCanvas.width = canvasW;
  measureCanvas.height = canvasH;
  const mCtx = measureCanvas.getContext('2d');
  if (!mCtx) return;

  mCtx.font = '15px "Plus Jakarta Sans", "Segoe UI", Arial, sans-serif';

  // Pre-wrap all rows to determine exact row heights & pagination
  const preparedRows = payload.rows.map((row) => {
    const cellLines = payload.columns.map((col) => {
      const val = extractCellValue(row, col);
      return wrapCanvasText(mCtx, val, colW - 22);
    });
    const maxLines = Math.max(1, ...cellLines.map((l) => l.length));
    const rowHeight = Math.max(38, maxLines * 20 + 16);
    return { cellLines, rowHeight };
  });

  // Paginate rows across pages
  const pages: (typeof preparedRows)[] = [];
  let currentPageRows: typeof preparedRows = [];
  const firstPageHeaderH = 148;
  const nextPageHeaderH = 88;
  const tableHeaderH = 44;
  const footerReserveH = 86;

  let currentY = marginY + firstPageHeaderH + tableHeaderH;
  const maxPageY = canvasH - marginY - footerReserveH;

  if (preparedRows.length === 0) {
    pages.push([]);
  } else {
    for (const pRow of preparedRows) {
      if (currentY + pRow.rowHeight > maxPageY && currentPageRows.length > 0) {
        pages.push(currentPageRows);
        currentPageRows = [pRow];
        currentY = marginY + nextPageHeaderH + tableHeaderH + pRow.rowHeight;
      } else {
        currentPageRows.push(pRow);
        currentY += pRow.rowHeight;
      }
    }
    if (currentPageRows.length > 0) {
      pages.push(currentPageRows);
    }
  }

  const jpegPages: { dataUrl: string; widthPx: number; heightPx: number }[] = [];

  pages.forEach((pageRows, pageIndex) => {
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = canvasW;
    pageCanvas.height = canvasH;
    const ctx = pageCanvas.getContext('2d')!;

    // White sheet background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvasW, canvasH);

    let y = marginY;

    if (pageIndex === 0) {
      // Official KAEL Header matching the Preview Modal
      ctx.fillStyle = '#00897B';
      ctx.font = 'bold 14px "Plus Jakarta Sans", Arial, sans-serif';
      ctx.fillText('KAEL — HEALTHCARE & ERP DOCUMENT EXPORT', marginX, y + 16);

      ctx.fillStyle = '#0F2922';
      ctx.font = 'bold 26px "Plus Jakarta Sans", Arial, sans-serif';
      ctx.fillText(payload.title, marginX, y + 52);

      ctx.fillStyle = '#52736B';
      ctx.font = '15px "Plus Jakarta Sans", Arial, sans-serif';
      const subText = `${payload.facilityName} (${payload.facilityCode})${
        payload.subtitle ? ` • ${payload.subtitle}` : ''
      }`;
      ctx.fillText(subText, marginX, y + 80);

      // Right Metadata
      ctx.textAlign = 'right';
      ctx.font = '14px "JetBrains Mono", monospace';
      ctx.fillStyle = '#52736B';
      ctx.fillText(`Dicetak: ${timestamp}`, canvasW - marginX, y + 32);
      ctx.fillText(
        `Total Data: ${payload.rows.length} baris • Hal ${pageIndex + 1}/${pages.length}`,
        canvasW - marginX,
        y + 56
      );
      ctx.textAlign = 'left';

      // Emerald Header Divider Line
      ctx.strokeStyle = '#00897B';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(marginX, y + 104);
      ctx.lineTo(canvasW - marginX, y + 104);
      ctx.stroke();

      y += 128;
    } else {
      ctx.fillStyle = '#00897B';
      ctx.font = 'bold 14px "Plus Jakarta Sans", Arial, sans-serif';
      ctx.fillText(
        `KAEL HEALTHCARE & ERP — ${payload.title} (Lanjutan)`,
        marginX,
        y + 24
      );
      ctx.textAlign = 'right';
      ctx.fillStyle = '#52736B';
      ctx.font = '14px "JetBrains Mono", monospace';
      ctx.fillText(
        `Halaman ${pageIndex + 1} dari ${pages.length}`,
        canvasW - marginX,
        y + 24
      );
      ctx.textAlign = 'left';

      ctx.strokeStyle = '#DCE7E3';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(marginX, y + 40);
      ctx.lineTo(canvasW - marginX, y + 40);
      ctx.stroke();

      y += 60;
    }

    // Table Header Row (#0F3D35 background with white text, identical to preview)
    ctx.fillStyle = '#0F3D35';
    ctx.fillRect(marginX, y, contentW, tableHeaderH);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 14px "Plus Jakarta Sans", Arial, sans-serif';
    payload.columns.forEach((col, cIdx) => {
      const cellX = marginX + cIdx * colW;
      const headerLabel = wrapCanvasText(ctx, col.header, colW - 20)[0] || col.header;
      ctx.fillText(headerLabel, cellX + 11, y + 27);
    });

    y += tableHeaderH;

    // Table Body Rows
    ctx.font = '14px "Plus Jakarta Sans", Arial, sans-serif';
    if (pageRows.length === 0) {
      ctx.fillStyle = '#F8FBFA';
      ctx.fillRect(marginX, y, contentW, 52);
      ctx.strokeStyle = '#DCE7E3';
      ctx.strokeRect(marginX, y, contentW, 52);
      ctx.fillStyle = '#52736B';
      ctx.fillText('Tidak ada baris data pada filter saat ini.', marginX + 20, y + 31);
      y += 52;
    } else {
      pageRows.forEach((pRow, rIdx) => {
        const isEven = rIdx % 2 === 0;
        ctx.fillStyle = isEven ? '#FFFFFF' : '#F4F9F7';
        ctx.fillRect(marginX, y, contentW, pRow.rowHeight);

        ctx.strokeStyle = '#DCE7E3';
        ctx.lineWidth = 1;
        ctx.strokeRect(marginX, y, contentW, pRow.rowHeight);

        pRow.cellLines.forEach((lines, cIdx) => {
          const cellX = marginX + cIdx * colW;
          if (cIdx > 0) {
            ctx.beginPath();
            ctx.moveTo(cellX, y);
            ctx.lineTo(cellX, y + pRow.rowHeight);
            ctx.stroke();
          }
          ctx.fillStyle = '#0F2922';
          lines.forEach((line, lIdx) => {
            ctx.fillText(line, cellX + 11, y + 24 + lIdx * 19);
          });
        });

        y += pRow.rowHeight;
      });
    }

    // Footer Verification Block on Last Page
    const footerY = canvasH - marginY - 28;
    ctx.strokeStyle = '#E2ECE8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(marginX, footerY - 22);
    ctx.lineTo(canvasW - marginX, footerY - 22);
    ctx.stroke();

    ctx.fillStyle = '#52736B';
    ctx.font = '13px "Plus Jakarta Sans", Arial, sans-serif';
    ctx.fillText(
      `Dokumen Resmi Sistem Informasi Manajemen Klinik & RS KAEL • ${payload.facilityName}`,
      marginX,
      footerY
    );
    ctx.textAlign = 'right';
    ctx.fillText(
      `Otoritas Server • Halaman ${pageIndex + 1} / ${pages.length}`,
      canvasW - marginX,
      footerY
    );
    ctx.textAlign = 'left';

    jpegPages.push({
      dataUrl: pageCanvas.toDataURL('image/jpeg', 0.94),
      widthPx: canvasW,
      heightPx: canvasH,
    });
  });

  const pdfBytes = buildPdfBinaryFromJpegDataUrls(jpegPages);
  const blob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
  const dateTag = new Date().toISOString().slice(0, 10);
  triggerBlobDownload(blob, `${payload.filenameBase}_${dateTag}.pdf`);
}

/**
 * 6. Clean Isolated Iframe Print (prints only the formatted document table, never the background app)
 */
export function printDocumentIsolated<T>(payload: ExportDocumentPayload<T>): void {
  const html = buildPrintableHtml(payload);
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (doc) {
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
      }, 2000);
    }, 250);
  }
}

