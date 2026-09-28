import type { CellHookData, RowInput } from 'jspdf-autotable';
import { PENDING_REVIEW, TbaAmount, TbaDocument, TbaRow } from './tbaDocument';

// Renders the TBA as landscape A4 matching the committee's printed format: tender header
// block on page 1, the column header repeated on every page, colour-coded decisions,
// signature block, and "Page X of N". jsPDF is loaded on demand.

const HEADER_BLUE: [number, number, number] = [220, 230, 241];
const ACCEPTED_GREEN: [number, number, number] = [215, 228, 189];
const REJECTED_PINK: [number, number, number] = [242, 220, 219];
const QUERY_YELLOW: [number, number, number] = [255, 255, 204];
const PENDING_GREY: [number, number, number] = [237, 237, 237];

const MARGIN = 14;

// jsPDF's built-in Helvetica only covers the WinAnsi character set, so symbols such as ₹
// (common in AI-written remarks) are spelled out instead of printing as garbage.
const pdfText = (value: unknown): string =>
  String(value ?? '')
    .replace(/₹\s?/g, 'Rs. ')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/[^\n\r\t\x20-\x7E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u20AC]/g, '');

const formatRupees = (rupees: number | null) =>
  rupees === null ? 'Not configured' : `${rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const amountText = (a: TbaAmount) => {
  if (a.lacs === null) return a.note ? pdfText(a.note) : '';
  return a.note ? `${a.lacs.toFixed(2)}\n(${pdfText(a.note)})` : a.lacs.toFixed(2);
};

const decisionFill = (text: string): [number, number, number] | undefined => {
  const t = text.toUpperCase();
  if (t === PENDING_REVIEW.toUpperCase()) return PENDING_GREY;
  // Rejection and query first: a rejected bidder's column 18 text also says "not acceptable".
  if (t.includes('REJECT')) return REJECTED_PINK;
  if (t.includes('QUERY')) return QUERY_YELLOW;
  if (t.includes('ACCEPT')) return ACCEPTED_GREEN;
  return undefined;
};

interface ColumnSpec {
  key: string;
  header: string;
  width: number; // relative, from the Excel template's column widths
  align?: 'left' | 'center';
  cell?: (row: TbaRow) => string;
}

function columnsFor(doc: TbaDocument): ColumnSpec[] {
  const cols: ColumnSpec[] = [
    { key: 'sl', header: 'Sl No.', width: 7.6 },
    { key: 'bidder', header: "Bidder's Name", width: 27.5, align: 'left' },
    { key: 'wo', header: 'Work Order No. & dated,\nName of Issuing Organisation', width: 23.7, align: 'left', cell: (r) => r.woNumberAndDate },
    { key: 'job', header: 'Job Name', width: 27.0, align: 'left', cell: (r) => r.jobName },
    { key: 'similar', header: 'Whether meeting Similar nature\n(Yes/ No)', width: 14.2, cell: (r) => r.meetsSimilarNature },
    { key: 'cc', header: 'Completion certificate Submitted\n(Yes/ No)', width: 16.8, cell: (r) => r.compCertSubmitted },
    { key: 'sub', header: 'Whether job is of sub contract type\n(Yes/ No)', width: 14.2, cell: (r) => r.isSubcontract },
    { key: 'approval', header: 'Approval from owner/ end user Submitted\n(Yes/ No)', width: 15.1, cell: (r) => r.ownerApprovalSubmitted },
    { key: 'start', header: 'Start Date\n(DD-MM-YYYY)', width: 19.6, cell: (r) => r.startDate },
    { key: 'comp', header: 'Comp Date\n(DD-MM-YYYY)', width: 19.6, cell: (r) => r.compDate },
    { key: 'dur', header: 'Duration of job\n(in months)', width: 13.6, cell: (r) => r.durationText },
    { key: 'wov', header: 'WO value in lacs\nIncl. GST', width: 13.6, cell: (r) => amountText(r.woValue) },
    { key: 'compv', header: 'Comp Value of similar nature in lacs\nIncl. GST', width: 17.6, cell: (r) => amountText(r.compValue) },
    { key: 'ann', header: 'Annualised completed value of similar nature in lacs Incl. GST\n(In case of ARC only)', width: 20.4, cell: (r) => r.annualised.text },
  ];
  if (doc.hasApqc) {
    cols.push(
      { key: 'apqcDoc', header: 'Document no. against Additional Technical Requirement of NIT', width: 21.7, align: 'left', cell: (r) => r.apqcDocumentNo },
      { key: 'apqc', header: 'Whether meeting Additional PQC/Technical Requirement?\n(Yes/ No)', width: 28.6, cell: (r) => r.meetsApqc }
    );
  }
  cols.push(
    { key: 'nil', header: 'NIL deviation sheet', width: 15.3, cell: (r) => r.nilDeviationSheet },
    { key: 'status', header: 'WO Acceptable or Rejected or Query', width: 17.6, cell: (r) => r.status },
    { key: 'remarks', header: 'Remarks\nReason for Technical acceptance or Rejection\nOr\nTechnical Query', width: 33.5, align: 'left', cell: (r) => r.remarks },
    { key: 'final', header: 'Final Position of bidder / Recommendation of Indenting Department', width: 27.4, cell: (r) => r.finalPosition }
  );
  return cols;
}

export async function buildTbaPdf(doc: TbaDocument): Promise<ArrayBuffer> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const probe = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageWidth = probe.internal.pageSize.getWidth();
  const pageHeight = probe.internal.pageSize.getHeight();
  const usable = pageWidth - MARGIN * 2;

  const cols = columnsFor(doc);
  const totalWidth = cols.reduce((s, col) => s + col.width, 0);
  const statusIdx = cols.findIndex((col) => col.key === 'status');
  const finalIdx = cols.findIndex((col) => col.key === 'final');
  const finalCol = cols[finalIdx];

  // Serial number, bidder name and column 18 belong to the bidder, not to a work order. They are
  // drawn as one tall cell per bidder, but where a bidder's work orders run onto another page the
  // cell is repeated at the top of that page ("contd.") so no page shows work orders without the
  // bidder they belong to. Which rows start a page is only known after layout, so the table is
  // laid out, the page breaks are read back, and it is laid out again with the repeats in place.
  type RowMeta = { separator: boolean; first: boolean; last: boolean; finalText: string };
  const buildBody = (continued: Set<number>, lastOnPage: Set<number>) => {
    const body: RowInput[] = [];
    const meta: RowMeta[] = [];
    for (const block of doc.bidders) {
      const finalText = block.rows[0] && finalCol ? pdfText(finalCol.cell!(block.rows[0])) : '';
      block.rows.forEach((row, i) => {
        const idx = body.length;
        const first = i === 0;
        const last = i === block.rows.length - 1;
        const repeat = !first && continued.has(idx);
        const shown = first || repeat;
        const lineWidth = { top: shown ? 0.4 : 0, bottom: last || lastOnPage.has(idx) ? 0.4 : 0, left: 0.4, right: 0.4 };
        const bidderCell = (content: string, styles: Record<string, unknown> = {}) => ({
          content: shown ? content : '',
          styles: { ...styles, lineWidth },
        });
        const contd = repeat ? '\n(contd.)' : '';
        const cells: RowInput = [
          bidderCell(String(block.slNo), { fontStyle: 'bold', halign: 'center', valign: 'top' }),
          bidderCell(pdfText(block.bidderLabel) + contd, { fontStyle: 'bold', halign: 'left', valign: 'top' }),
        ];
        cols.slice(2).forEach((col) => {
          if (col.key === 'final') cells.push(bidderCell(finalText + contd, { valign: 'top' }));
          else cells.push({ content: pdfText(col.cell!(row)) });
        });
        body.push(cells);
        meta.push({ separator: false, first, last, finalText });
      });
      // Blank separator band between bidders, as in the template.
      body.push([{ content: '', colSpan: cols.length, styles: { minCellHeight: 6, cellPadding: 0, lineWidth: 0.4 } }]);
      meta.push({ separator: true, first: false, last: false, finalText: '' });
    }
    return { body, meta };
  };

  const layout = (continued: Set<number>, lastOnPage: Set<number>) => {
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const base = { font: 'helvetica' as const, fontSize: 6.4, textColor: 0, lineColor: 0, lineWidth: 0.4, cellPadding: 2.2, valign: 'middle' as const, overflow: 'linebreak' as const };
    const label = { fontStyle: 'bold' as const };
    const value = { fontStyle: 'bold' as const, fillColor: HEADER_BLUE };

    // Tender header block (page 1 only).
    const headW = [0.15, 0.11, 0.08, 0.42, 0.13, 0.11].map((f) => f * usable);
    const [a, b, c] = doc.optionRupees;
    autoTable(pdf, {
      startY: MARGIN + (doc.pendingReviewRows > 0 ? 12 : 0),
      margin: { left: MARGIN, right: MARGIN },
      theme: 'grid',
      styles: { ...base, fontSize: 6.8 },
      columnStyles: Object.fromEntries(headW.map((w, i) => [i, { cellWidth: w }])),
      body: [
        [{ content: pdfText(doc.title), colSpan: 6, styles: { ...label, halign: 'center', fontSize: 7.5 } }],
        [
          { content: 'Tender No.', styles: label },
          { content: pdfText(doc.tenderNo), styles: value },
          { content: 'Name of Job :', styles: value },
          { content: pdfText(doc.jobName), colSpan: 3, styles: value },
        ],
        [
          { content: 'PQC as per NIT', colSpan: 4, styles: value },
          { content: 'Type of Job (ARC/ One time)', styles: { ...label, halign: 'right' } },
          { content: pdfText(doc.typeOfJobText), styles: { ...value, halign: 'center' } },
        ],
        [
          { content: '(i) Similar nature definition', styles: label },
          { content: pdfText(doc.similarNatureDefinition), colSpan: 3, styles: value },
          { content: 'TR date', styles: { ...label, halign: 'right' } },
          { content: pdfText(doc.trDate), styles: { ...value, halign: 'center' } },
        ],
        [
          { content: '(ii) Similar nature of WO and completed value INCL GST', styles: label },
          { content: `(a) 1 job   ${formatRupees(a)}      (b) 2 jobs   ${formatRupees(b)}      (c) 3 jobs   ${formatRupees(c)}`, colSpan: 3, styles: value },
          { content: 'Total No. of Bids', styles: { ...label, halign: 'right' } },
          { content: pdfText(doc.totalBidsText), styles: { ...value, halign: 'center' } },
        ],
        [
          { content: '(iii) Additional PQC, if any', styles: label },
          { content: pdfText(doc.additionalPqc), colSpan: 3, styles: value },
          { content: 'Technically Acceptable', styles: { ...label, halign: 'right' } },
          { content: String(doc.acceptable), styles: { ...value, halign: 'center' } },
        ],
        [
          { content: 'Date of Bid opening', styles: label },
          { content: pdfText(doc.bidOpeningDate), colSpan: 3, styles: value },
          { content: 'Technically not acceptable\nQuery to be raised to', styles: { ...label, halign: 'right' } },
          { content: `${doc.rejected}\n${doc.query}`, styles: { ...value, halign: 'center' } },
        ],
      ],
    });

    const { body, meta } = buildBody(continued, lastOnPage);
    const rowPages: number[] = [];
    autoTable(pdf, {
      startY: ((pdf as any).lastAutoTable?.finalY ?? MARGIN) + 6,
      margin: { left: MARGIN, right: MARGIN, top: MARGIN + (doc.pendingReviewRows > 0 ? 12 : 0), bottom: 22 },
      theme: 'grid',
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      styles: base,
      headStyles: { ...base, fontSize: 5.9, cellPadding: 1.4, fontStyle: 'bold', fillColor: HEADER_BLUE, halign: 'center' },
      columnStyles: Object.fromEntries(
        cols.map((col, i) => [i, { cellWidth: (col.width / totalWidth) * usable, halign: col.align ?? 'center' }])
      ),
      head: [cols.map((col) => pdfText(col.header))],
      body,
      didParseCell: (data: CellHookData) => {
        if (data.section !== 'body') return;
        const idx = data.column.index;
        if (idx !== statusIdx && idx !== finalIdx) return;
        // Column 18 is coloured by the bidder's decision on every row of the bidder, so the tall
        // cell reads as one block even where its text is not repeated.
        const text =
          idx === finalIdx
            ? meta[data.row.index]?.finalText ?? ''
            : String(data.cell.raw && typeof data.cell.raw === 'object' ? (data.cell.raw as any).content : data.cell.raw ?? '');
        const fill = decisionFill(text);
        if (fill) data.cell.styles.fillColor = fill;
      },
      didDrawCell: (data: CellHookData) => {
        if (data.section === 'body' && data.column.index === 0) rowPages[data.row.index] = data.pageNumber;
      },
    });
    return { pdf, rowPages, meta };
  };

  // Lay out, read where pages break, and lay out again with the bidder repeated on each new page.
  // A repeat can make a row taller and move a break, so this settles in at most a few rounds.
  let continued = new Set<number>();
  let lastOnPage = new Set<number>();
  let result = layout(continued, lastOnPage);
  for (let round = 0; round < 3; round++) {
    const nextContinued = new Set<number>();
    const nextLastOnPage = new Set<number>();
    result.meta.forEach((m, i) => {
      if (m.separator) return;
      const page = result.rowPages[i];
      if (!m.first && page !== undefined && page !== result.rowPages[i - 1]) nextContinued.add(i);
      if (!m.last && page !== undefined && result.rowPages[i + 1] !== undefined && result.rowPages[i + 1] !== page) nextLastOnPage.add(i);
    });
    const same = (a: Set<number>, b: Set<number>) => a.size === b.size && [...a].every((x) => b.has(x));
    if (same(nextContinued, continued) && same(nextLastOnPage, lastOnPage)) break;
    continued = nextContinued;
    lastOnPage = nextLastOnPage;
    result = layout(continued, lastOnPage);
  }
  const pdf = result.pdf;

  // Signature block, kept together on one page.
  let y = ((pdf as any).lastAutoTable?.finalY ?? MARGIN) + 22;
  if (y + 60 > pageHeight - 24) {
    pdf.addPage();
    y = MARGIN + 30;
  }
  const sigX = [MARGIN + 18, pageWidth / 2 - 60, pageWidth - MARGIN - 190];
  doc.signatories.forEach((s, i) => {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.text(pdfText(s.label), sigX[i], y);
    pdf.setFont('helvetica', 'bold');
    pdf.text(pdfText(s.name), sigX[i], y + 34);
    pdf.text(pdfText(s.designation), sigX[i], y + 44);
  });

  // Page numbering and the draft marker go on after layout so the total page count is known.
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(0);
    pdf.text(`Page ${p} of ${pages}`, pageWidth - MARGIN, pageHeight - 10, { align: 'right' });
    if (doc.pendingReviewRows > 0) {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8);
      pdf.setTextColor(192, 0, 0);
      pdf.text(
        `DRAFT: ${doc.pendingReviewRows} work order(s) pending engineer review. Counts include only confirmed decisions.`,
        MARGIN,
        MARGIN + 6
      );
      pdf.setTextColor(0);
    }
  }

  return pdf.output('arraybuffer');
}
