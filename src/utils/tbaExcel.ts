import type { Borders, Cell, Fill, Worksheet } from 'exceljs';
import { WO_STATUS_OPTIONS } from '../types';
import { GST_FACTOR } from './tbaRules';
import { PENDING_REVIEW, TbaAmount, TbaDocument, TbaRow } from './tbaDocument';

// Writes the TBA workbook in the committee's template layout (columns A–V, "Technical
// evaluation" sheet). exceljs is loaded on demand so it never weighs on app startup.

const COLUMN_WIDTHS: Record<string, number> = {
  A: 7.6, B: 11.3, C: 19.0, D: 23.7, E: 19.7, F: 10.1, G: 11.7, H: 15.4, I: 12.3, J: 15.1, K: 17.9,
  L: 17.4, M: 11.4, N: 12.0, O: 17.6, P: 21.7, Q: 21.7, R: 28.6, S: 15.3, T: 17.6, U: 37.1, V: 30.0,
};

const HEADERS: Record<string, string> = {
  A: 'Sl No.',
  B: "Bidder's Name",
  D: 'Work Order No. & dated, \nName of Issuing Organisation',
  E: 'Job Name',
  G: 'Whether meeting Similar nature\n\n(Yes/ No)',
  H: 'Completion certificate Submitted\n(Yes/ No)',
  I: 'Whether job is of sub contract type\n\n(Yes/ No)',
  J: 'Approval from owner/ end user Submitted\n(Yes/ No)',
  K: 'Start Date\n(DD-MM-YYYY)',
  L: 'Comp Date\n(DD-MM-YYYY)',
  M: 'Duration of job\n(in months)',
  N: 'WO value in lacs \nIncl. GST',
  O: 'Comp Value of similar nature in lacs\nIncl. GST',
  P: 'Annualised completed value of similar nature in lacs Incl. GST\n(In case of ARC only)',
  Q: 'Document no. against Additional Technical Requirement of NIT',
  R: 'Whether meeting Additional PQC/Technical Requirement?\n(Yes/ No)',
  S: 'NIL deviation  sheet',
  T: 'WO Acceptable or Rejected or Query',
  U: 'Remarks\n\nReason for Technical acceptance or Rejection\nOr \nTechnical Query',
  V: 'Final Position of bidder / Recommendation of Indenting Department',
};

// Colours from the template: header/value fill (Office accent1 at 80% tint) and the
// conditional-format fills for accepted / rejected / query.
const HEADER_BLUE = 'FFDCE6F1';
const ACCEPTED_GREEN = 'FFD7E4BD';
const REJECTED_PINK = 'FFF2DCDB';
const QUERY_YELLOW = 'FFFFFFCC';
const PENDING_GREY = 'FFEDEDED';

// Indian digit grouping (1,18,00,000.00) regardless of the viewer's locale.
const INDIAN_RUPEES_FORMAT = '[>=10000000]##\\,##\\,##\\,##0.00;[>=100000]##\\,##\\,##0.00;##,##0.00';

const FONT = 'Calibri';
const thin = { style: 'thin' as const };
const allThin: Partial<Borders> = { top: thin, left: thin, bottom: thin, right: thin };
const solid = (argb: string): Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

const style = (
  cell: Cell,
  opts: { bold?: boolean; size?: number; fill?: string; h?: 'left' | 'center' | 'right'; wrap?: boolean; border?: boolean; numFmt?: string } = {}
) => {
  cell.font = { name: FONT, size: opts.size ?? 14, bold: opts.bold ?? false };
  cell.alignment = { horizontal: opts.h ?? 'center', vertical: 'middle', wrapText: opts.wrap ?? true };
  if (opts.fill) cell.fill = solid(opts.fill);
  if (opts.border !== false) cell.border = allThin;
  if (opts.numFmt) cell.numFmt = opts.numFmt;
};

// Excel does not auto-size rows with wrapped or merged text when a generated file is opened,
// so heights are estimated from text length against the column width (Calibri 14pt). Word
// wrapping and long unbroken references (e.g. BANDR/SITE/40091/...) waste line space, so the
// estimate is deliberately generous: a slightly tall row beats clipped text.
const linesFor = (text: string, widthChars: number) =>
  String(text || '')
    .split('\n')
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / Math.max(4, widthChars * 0.64))), 0);

const widthOf = (...cols: string[]) => cols.reduce((w, c) => w + COLUMN_WIDTHS[c], 0);
const heightFor = (lines: number) => Math.min(409, Math.max(30, lines * 19 + 12));

const amountValue = (amount: TbaAmount): Cell['value'] => {
  if (amount.lacs === null) return amount.note || '';
  if (amount.note) return `${amount.lacs.toFixed(2)}\n(${amount.note})`;
  if (amount.baseLacs !== null) return { formula: `${amount.baseLacs}*${GST_FACTOR}`, result: amount.lacs };
  return amount.lacs;
};

const statusFill = (text: string): string | undefined => {
  const t = text.toUpperCase();
  if (t === PENDING_REVIEW.toUpperCase()) return PENDING_GREY;
  // Rejection and query first: a rejected bidder's column 18 text also says "not acceptable".
  if (t.includes('REJECT')) return REJECTED_PINK;
  if (t.includes('QUERY')) return QUERY_YELLOW;
  if (t.includes('ACCEPT')) return ACCEPTED_GREEN;
  return undefined;
};

function writeHeaderBlock(ws: Worksheet, doc: TbaDocument) {
  const put = (addr: string, value: Cell['value'], opts: Parameters<typeof style>[1] = {}) => {
    const cell = ws.getCell(addr);
    cell.value = value;
    style(cell, { bold: true, h: 'left', ...opts });
    return cell;
  };
  const merge = (range: string) => ws.mergeCells(range);

  merge('A1:V1');
  put('A1', doc.title, { h: 'center' });
  ws.getRow(1).height = 24;

  merge('A2:B2');
  put('A2', 'Tender No.');
  put('C2', doc.tenderNo, { fill: HEADER_BLUE });
  put('D2', '', { fill: HEADER_BLUE });
  put('E2', 'Name of Job :', { fill: HEADER_BLUE });
  merge('F2:V2');
  put('F2', doc.jobName, { fill: HEADER_BLUE });
  ws.getRow(2).height = heightFor(linesFor(doc.jobName, widthOf('F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V')));

  merge('A3:Q3');
  put('A3', 'PQC as per NIT', { fill: HEADER_BLUE });
  merge('R3:T3');
  put('R3', 'Type of Job (ARC/ One time)', { h: 'right' });
  merge('U3:V3');
  put('U3', doc.typeOfJobText, { fill: HEADER_BLUE, h: 'center' });
  ws.getRow(3).height = heightFor(linesFor(doc.typeOfJobText, widthOf('U', 'V')));

  merge('A4:D4');
  put('A4', '(i) Similar nature definition ');
  merge('E4:Q4');
  put('E4', doc.similarNatureDefinition, { fill: HEADER_BLUE });
  merge('R4:T4');
  put('R4', 'TR date', { h: 'right' });
  merge('U4:V4');
  put('U4', doc.trDate, { fill: HEADER_BLUE, h: 'center' });
  ws.getRow(4).height = heightFor(linesFor(doc.similarNatureDefinition, widthOf('E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q')));

  merge('A5:C5');
  put('A5', '(ii) Similar nature of WO and completed value INCL GST');
  put('D5', '', { fill: HEADER_BLUE });
  const [one, two, three] = doc.optionRupees;
  put('E5', '(a) 1 job', { h: 'center' });
  merge('F5:H5');
  put('F5', one ?? 'Not configured', { fill: HEADER_BLUE, numFmt: INDIAN_RUPEES_FORMAT });
  put('I5', '(b) 2 jobs', { h: 'center' });
  merge('J5:M5');
  put('J5', two ?? 'Not configured', { fill: HEADER_BLUE, numFmt: INDIAN_RUPEES_FORMAT });
  put('N5', '(c ) 3 jobs', { h: 'center' });
  merge('O5:Q5');
  put('O5', three ?? 'Not configured', { fill: HEADER_BLUE, numFmt: INDIAN_RUPEES_FORMAT });
  merge('R5:T5');
  put('R5', 'Total No. of Bids', { h: 'right' });
  merge('U5:V5');
  put('U5', doc.totalBidsText, { fill: HEADER_BLUE, h: 'center' });
  ws.getRow(5).height = 54.75;

  merge('A6:D6');
  put('A6', '(iii) Additional PQC, if any ');
  merge('E6:Q6');
  put('E6', doc.additionalPqc, { fill: HEADER_BLUE });
  merge('R6:T6');
  put('R6', 'Technically Acceptable', { h: 'right' });
  merge('U6:V6');
  put('U6', doc.acceptable, { fill: HEADER_BLUE, h: 'center' });
  ws.getRow(6).height = heightFor(linesFor(doc.additionalPqc, widthOf('E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q')));

  merge('A7:D7');
  put('A7', 'Date of Bid opening');
  merge('E7:Q7');
  put('E7', doc.bidOpeningDate, { fill: HEADER_BLUE });
  merge('R7:T7');
  put('R7', 'Technically not acceptable\nQuery to be raised to', { h: 'right' });
  merge('U7:V7');
  put('U7', `${doc.rejected}\n${doc.query}`, { fill: HEADER_BLUE, h: 'center' });
  ws.getRow(7).height = 37.5;

  merge('A8:V8');
  const note = ws.getCell('A8');
  if (doc.pendingReviewRows > 0) {
    note.value = `DRAFT: ${doc.pendingReviewRows} work order(s) are still pending engineer review; counts above include only confirmed decisions.`;
    note.font = { name: FONT, size: 14, bold: true, color: { argb: 'FFC00000' } };
    note.alignment = { horizontal: 'left', vertical: 'middle' };
    ws.getRow(8).height = 24;
  } else {
    ws.getRow(8).height = 9;
  }
}

function writeWorkOrderRow(ws: Worksheet, r: number, row: TbaRow, isArcTender: boolean) {
  ws.mergeCells(`E${r}:F${r}`);
  const set = (col: string, value: Cell['value'], opts: Parameters<typeof style>[1] = {}) => {
    const cell = ws.getCell(`${col}${r}`);
    cell.value = value;
    style(cell, opts);
    return cell;
  };

  set('D', row.woNumberAndDate, { h: 'left' });
  set('E', row.jobName, { h: 'left' });
  ws.getCell(`F${r}`).border = allThin;
  set('G', row.meetsSimilarNature);
  set('H', row.compCertSubmitted);
  set('I', row.isSubcontract);
  set('J', row.ownerApprovalSubmitted);
  set('K', row.startDateValue ?? row.startDate, { numFmt: row.startDateValue ? 'dd-mm-yyyy' : undefined });
  set('L', row.compDateValue ?? row.compDate, { numFmt: row.compDateValue ? 'dd-mm-yyyy' : undefined });
  set('M', row.durationMonths ?? row.durationText);
  set('N', amountValue(row.woValue), { numFmt: '0.00' });
  const compCell = set('O', amountValue(row.compValue), { numFmt: '0.00' });

  if (!isArcTender) {
    set('P', 'NA');
  } else if (row.annualised.derivable && typeof compCell.value !== 'string') {
    set('P', { formula: `O${r}*12/MAX(12,M${r})`, result: row.annualised.lacs ?? undefined }, { numFmt: '0.00' });
  } else {
    set('P', row.annualised.lacs ?? '', { numFmt: '0.00' });
  }

  set('Q', row.apqcDocumentNo, { h: 'left' });
  set('R', row.meetsApqc);
  set('S', row.nilDeviationSheet);
  set('T', row.status, { fill: statusFill(row.status) });
  set('U', row.remarks, { h: 'left' });
  set('V', row.finalPosition, { fill: statusFill(row.finalPosition) });

  const lines = Math.max(
    linesFor(row.woNumberAndDate, widthOf('D')),
    linesFor(row.jobName, widthOf('E', 'F')),
    linesFor(row.remarks, widthOf('U')),
    linesFor(row.finalPosition, widthOf('V')),
    linesFor(row.status, widthOf('T')),
    3
  );
  ws.getRow(r).height = heightFor(lines);
}

const listValidation = (values: readonly string[]) => ({
  type: 'list' as const,
  allowBlank: true,
  formulae: [`"${values.join(',')}"`],
  // Imported values such as "To verify" or "Pending engineer review" must stay valid.
  showErrorMessage: false,
});

export async function downloadTbaExcel(doc: TbaDocument, fileName: string) {
  const buffer = await buildTbaWorkbook(doc);
  triggerDownload(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName);
}

export async function buildTbaWorkbook(doc: TbaDocument): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AI Tender Qualification Assistant';
  wb.created = new Date();

  const ws = wb.addWorksheet('Technical evaluation', {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 9, zoomScale: 55 }],
  });

  Object.entries(COLUMN_WIDTHS).forEach(([col, width]) => {
    ws.getColumn(col).width = width;
  });
  if (!doc.hasApqc) {
    ws.getColumn('Q').hidden = true;
    ws.getColumn('R').hidden = true;
  }

  writeHeaderBlock(ws, doc);

  // Column header row (repeated on every printed page).
  ws.mergeCells('B9:C9');
  ws.mergeCells('E9:F9');
  Object.keys(COLUMN_WIDTHS).forEach((col) => {
    const cell = ws.getCell(`${col}9`);
    if (HEADERS[col]) cell.value = HEADERS[col];
    style(cell, { bold: true, fill: HEADER_BLUE });
  });
  ws.getRow(9).height = 150.75;

  let r = 10;
  const yesNo = listValidation(['Yes', 'No']);
  const yesNoNa = listValidation(['Yes', 'No', 'NA']);
  const statuses = listValidation(WO_STATUS_OPTIONS);
  const firstDataRow = r;

  for (const block of doc.bidders) {
    const first = r;
    block.rows.forEach((row) => {
      writeWorkOrderRow(ws, r, row, doc.isArcTender);
      ['G', 'H', 'I'].forEach((c) => (ws.getCell(`${c}${r}`).dataValidation = yesNo));
      ['J', 'R'].forEach((c) => (ws.getCell(`${c}${r}`).dataValidation = yesNoNa));
      ws.getCell(`T${r}`).dataValidation = statuses;
      r++;
    });
    const last = r - 1;

    // Column 18 is one decision per bidder, merged down the bidder's rows like the name.
    if (last > first) {
      ws.mergeCells(`V${first}:V${last}`);
      for (let i = first; i <= last; i++) ws.getCell(`V${i}`).border = allThin;
    }

    ws.mergeCells(`A${first}:A${last}`);
    ws.mergeCells(`B${first}:C${last}`);
    const sl = ws.getCell(`A${first}`);
    sl.value = block.slNo;
    style(sl, { bold: true });
    const name = ws.getCell(`B${first}`);
    name.value = block.bidderLabel;
    style(name, { bold: true, h: 'left' });
    for (let i = first; i <= last; i++) {
      ['A', 'B', 'C'].forEach((c) => (ws.getCell(`${c}${i}`).border = allThin));
    }

    // A long bidder name spanning few rows needs the last row to absorb the extra height.
    const nameLines = linesFor(block.bidderLabel, widthOf('B', 'C'));
    let spanned = 0;
    for (let i = first; i <= last; i++) spanned += ws.getRow(i).height ?? 30;
    if (heightFor(nameLines) > spanned) {
      ws.getRow(last).height = (ws.getRow(last).height ?? 30) + heightFor(nameLines) - spanned;
    }

    // Blank separator band between bidders, as in the template.
    ws.mergeCells(`A${r}:V${r}`);
    const sep = ws.getCell(`A${r}`);
    sep.border = { top: thin, bottom: { style: 'medium' }, left: thin, right: thin };
    ws.getRow(r).height = 19.5;
    r++;
  }
  const lastDataRow = r - 1;

  // Keep colours correct when someone later changes a status via the dropdown in Excel.
  if (lastDataRow >= firstDataRow) {
    const colourRule = (text: string, argb: string) => ({
      type: 'containsText' as const,
      operator: 'containsText' as const,
      text,
      priority: 1,
      style: { fill: { type: 'pattern' as const, pattern: 'solid' as const, bgColor: { argb } } },
    });
    for (const col of ['T', 'V']) {
      ws.addConditionalFormatting({
        ref: `${col}${firstDataRow}:${col}${lastDataRow}`,
        rules: [
          colourRule('Accept', ACCEPTED_GREEN),
          colourRule('Reject', REJECTED_PINK),
          colourRule('Query', QUERY_YELLOW),
        ],
      });
    }
  }

  // Signature block.
  const sigRow = r + 1;
  const sigCols = ['B', 'K', 'U'];
  doc.signatories.forEach((s, i) => {
    const col = sigCols[i];
    ws.getCell(`${col}${sigRow}`).value = s.label;
    ws.getCell(`${col}${sigRow}`).font = { name: FONT, size: 16 };
    ws.getCell(`${col}${sigRow + 4}`).value = s.name || '';
    ws.getCell(`${col}${sigRow + 4}`).font = { name: FONT, size: 16, bold: true };
    ws.getCell(`${col}${sigRow + 5}`).value = s.designation || '';
    ws.getCell(`${col}${sigRow + 5}`).font = { name: FONT, size: 16, bold: true };
  });
  for (let i = sigRow; i <= sigRow + 5; i++) ws.getRow(i).height = 21;
  const lastRow = sigRow + 5;

  ws.pageSetup = {
    paperSize: 9, // A4
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: '9:9',
    printArea: `A1:V${lastRow}`,
    margins: { left: 0.04, right: 0.04, top: 0.2, bottom: 0.35, header: 0, footer: 0.12 },
  };
  ws.headerFooter.oddFooter = '&RPage &P of &N';

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

export function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
