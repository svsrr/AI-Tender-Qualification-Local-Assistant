import type { PDFDocumentProxy } from 'pdfjs-dist';
import { BoundingBoxCategory, IoclWorkOrderEntry, PdfBoundingBox } from '../types';

// Finds where a work order's extracted values really appear on the original PDF. Positions come
// from the PDF's own text layer when the value is printed there, otherwise from Gemini reading
// the rendered page. A value that cannot be found is reported as not found — never drawn at a
// guessed position.

export const EVIDENCE_LOCATOR_VERSION = 2;

export interface EvidenceTarget {
  fieldKey: string;
  label: string;
  category: BoundingBoxCategory;
  extractedValue: string;
  // Strings that, if found in the page text, pin the value down (most specific first).
  needles: string[];
  // Money fields: acceptable amounts in lakhs (incl. and excl. GST) for checking an AI quote.
  lakhsCandidates?: number[];
}

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function dateNeedles(date?: string): string[] {
  const m = String(date || '').match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return [];
  const [, d, mo, y] = m;
  // Separators vanish in compact(), so one digit run covers 08-10-2021, 08.10.2021 and 08/10/2021.
  return [`${d}${mo}${y}`, `${d}${mo}${y.slice(2)}`];
}

function lacsNeedles(lacs?: number | null, base?: number | null): string[] {
  const out: string[] = [];
  for (const v of [base, lacs]) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
    // 59.58 lacs is printed as 59,58,xxx rupees or "59.58 lakh"; compact() keeps the digits.
    const rupees = String(Math.round(v * 100000));
    out.push(rupees.slice(0, rupees.length - 3));
    out.push(v.toFixed(2).replace('.', ''));
  }
  // Short digit runs (e.g. "5958") match unrelated numbers too easily.
  return [...new Set(out)].filter((n) => n.length >= 5);
}

const GST = 1.18;

function lakhsCandidates(lacs?: number | null, base?: number | null): number[] {
  return [lacs, base, typeof lacs === 'number' ? lacs / GST : null].filter((v): v is number => typeof v === 'number' && v > 0);
}

// Amounts printed in a quote, in lakhs: "Rs 1,24,15,058.73" (rupees) or "124.15 lakh".
function amountsInLakhs(quote: string): number[] {
  const out: number[] = [];
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(lakhs?|lacs?|lac|l\b|crores?|cr\b)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(quote))) {
    const n = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(n) || n <= 0) continue;
    const unit = (m[2] || '').toLowerCase();
    if (unit.startsWith('cr')) out.push(n * 100);
    else if (unit) out.push(n);
    else {
      out.push(n / 100000); // plain rupees
      out.push(n); // a bare figure already in lakhs
    }
  }
  return out;
}

// An AI-reported position only counts when the text it read there actually states the extracted
// value. The model otherwise tends to box the same kind of field holding a different number.
export function quoteSupportsTarget(target: EvidenceTarget, quote: string): boolean {
  const q = compact(quote);
  if (!q) return false;
  if (target.lakhsCandidates?.length) {
    return amountsInLakhs(quote).some((a) => target.lakhsCandidates!.some((c) => Math.abs(a - c) <= Math.max(0.02, c * 0.015)));
  }
  const wantedDate = target.extractedValue.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (wantedDate) {
    // Dates may be printed with any separator, a 2-digit year or without leading zeros.
    const [, d, m, y] = wantedDate.map(Number);
    const re = /(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{2,4})/g;
    let hit: RegExpExecArray | null;
    while ((hit = re.exec(quote))) {
      const year = Number(hit[3]) < 100 ? 2000 + Number(hit[3]) : Number(hit[3]);
      if (Number(hit[1]) === d && Number(hit[2]) === m && year === y) return true;
    }
    return false;
  }
  if (target.needles.length > 0) {
    return target.needles.some((n) => q.includes(compact(n)));
  }
  const words = target.extractedValue.split(/\s+/).map(compact).filter((w) => w.length >= 4);
  if (words.length === 0) return false;
  const hits = words.filter((w) => q.includes(w)).length;
  return hits / words.length >= 0.5;
}

export function evidenceTargetsForWorkOrder(wo: IoclWorkOrderEntry): EvidenceTarget[] {
  const targets: EvidenceTarget[] = [];
  const woNumbers = String(wo.woNumberAndDate || '').match(/[A-Za-z0-9/\-]*\d{5,}[A-Za-z0-9/\-]*/g) || [];
  if (woNumbers.length > 0) {
    targets.push({
      fieldKey: 'woNumberAndDate',
      label: 'Work order no. & date (col 3)',
      category: 'date_duration',
      extractedValue: wo.woNumberAndDate,
      needles: woNumbers.map((n) => n.replace(/[^0-9A-Za-z]/g, '')),
    });
  }
  if (wo.issuingOrg) {
    targets.push({ fieldKey: 'issuingOrg', label: 'Issuing organisation', category: 'general', extractedValue: wo.issuingOrg, needles: [] });
  }
  if (wo.jobName) {
    targets.push({ fieldKey: 'jobName', label: 'Job name (col 4)', category: 'scope_similar_nature', extractedValue: wo.jobName, needles: [] });
  }
  if (wo.startDate) {
    targets.push({ fieldKey: 'startDate', label: 'Start date (col 9)', category: 'date_duration', extractedValue: wo.startDate, needles: dateNeedles(wo.startDate) });
  }
  if (wo.compDate) {
    targets.push({ fieldKey: 'compDate', label: 'Completion date (col 10)', category: 'date_duration', extractedValue: wo.compDate, needles: dateNeedles(wo.compDate) });
  }
  if (typeof wo.woValueLacs === 'number') {
    targets.push({
      fieldKey: 'woValueLacs',
      label: 'WO value (col 12)',
      category: 'monetary',
      extractedValue: `${wo.woValueLacs.toFixed(2)} lacs`,
      needles: lacsNeedles(wo.woValueLacs, wo.woValueBaseLacs),
      lakhsCandidates: lakhsCandidates(wo.woValueLacs, wo.woValueBaseLacs),
    });
  }
  if (typeof wo.compValueLacs === 'number') {
    targets.push({
      fieldKey: 'compValueLacs',
      label: 'Completed value (col 13)',
      category: 'monetary',
      extractedValue: `${wo.compValueLacs.toFixed(2)} lacs`,
      needles: lacsNeedles(wo.compValueLacs, wo.compValueBaseLacs),
      lakhsCandidates: lakhsCandidates(wo.compValueLacs, wo.compValueBaseLacs),
    });
  }
  return targets;
}

export function pageRangeForWorkOrder(wo: IoclWorkOrderEntry, numPages: number, maxPages = 12): number[] {
  const start = Math.min(Math.max(1, wo.sourcePageStart || wo.rawPdfSnippet?.pageNumber || 1), numPages);
  const end = Math.min(numPages, Math.max(start, wo.sourcePageEnd || start + 5), start + maxPages - 1);
  const pages: number[] = [];
  for (let p = start; p <= end; p++) pages.push(p);
  return pages;
}

interface TextRun {
  text: string;
  // Rectangle in PDF user space: x, y (baseline), width, height.
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PageText {
  pageNumber: number;
  width: number;
  height: number;
  convert: (rect: number[]) => number[];
  runs: TextRun[];
  // compact() of all runs joined, with the run index and position within that run for every character.
  joined: string;
  charRun: number[];
  charPos: number[];
}

// A match: the runs it spans, and how far into the first run it starts / into the last run it ends (0-1).
interface TextHit {
  runs: number[];
  startFrac: number;
  endFrac: number;
}

async function readPageText(pdf: PDFDocumentProxy, pageNumber: number): Promise<PageText> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const runs: TextRun[] = [];
  let joined = '';
  const charRun: number[] = [];
  const charPos: number[] = [];
  for (const item of content.items as any[]) {
    if (!item.str || !item.transform) continue;
    const [, , , d, e, f] = item.transform;
    const run: TextRun = { text: item.str, x: e, y: f, w: item.width || 0, h: item.height || Math.abs(d) || 8 };
    const idx = runs.push(run) - 1;
    const c = compact(item.str);
    joined += c;
    for (let i = 0; i < c.length; i++) {
      charRun.push(idx);
      charPos.push(i);
    }
  }
  return {
    pageNumber,
    width: viewport.width,
    height: viewport.height,
    convert: ([x1, y1, x2, y2]) => {
      const [a, b, c, d, e, f] = viewport.transform;
      return [a * x1 + c * y1 + e, b * x1 + d * y1 + f, a * x2 + c * y2 + e, b * x2 + d * y2 + f];
    },
    runs,
    joined,
    charRun,
    charPos,
  };
}

function boxForHit(page: PageText, hit: TextHit): [number, number, number, number] {
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  hit.runs.forEach((runIndex, k) => {
    const r = page.runs[runIndex];
    // Trim the first and last run to the matched characters (proportional to character count).
    const from = k === 0 ? r.x + r.w * hit.startFrac : r.x;
    const to = k === hit.runs.length - 1 ? r.x + r.w * hit.endFrac : r.x + r.w;
    const [x1, y1, x2, y2] = page.convert([from, r.y - r.h * 0.25, to, r.y + r.h]);
    xmin = Math.min(xmin, x1, x2);
    xmax = Math.max(xmax, x1, x2);
    ymin = Math.min(ymin, y1, y2);
    ymax = Math.max(ymax, y1, y2);
  });
  const pad = 3;
  const norm = (v: number, total: number) => Math.round(Math.min(1000, Math.max(0, (v / total) * 1000)));
  return [norm(ymin - pad, page.height), norm(xmin - pad, page.width), norm(ymax + pad, page.height), norm(xmax + pad, page.width)];
}

function findNeedle(page: PageText, needle: string): TextHit | null {
  const n = compact(needle);
  if (n.length < 4) return null;
  const at = page.joined.indexOf(n);
  if (at < 0) return null;
  const end = at + n.length - 1;
  const runLen = (i: number) => Math.max(1, compact(page.runs[page.charRun[i]].text).length);
  return {
    runs: [...new Set(page.charRun.slice(at, end + 1))],
    startFrac: page.charPos[at] / runLen(at),
    endFrac: (page.charPos[end] + 1) / runLen(end),
  };
}

// Free-text fields (job name, client) rarely survive OCR character for character, so they match
// on the longest run of consecutive significant words found on the page.
function findPhrase(page: PageText, phrase: string): TextHit | null {
  // Short words ("of", "at") stay in the needle because they are in the page text too; a slice
  // only counts when it holds enough significant words to be distinctive.
  const words = phrase.split(/\s+/).map(compact).filter(Boolean);
  const significant = (ws: string[]) => ws.filter((w) => w.length >= 3).length;
  const need = Math.min(3, significant(words));
  if (need === 0) return null;
  for (let len = Math.min(words.length, 10); len >= 1; len--) {
    for (let s = 0; s + len <= words.length; s++) {
      const slice = words.slice(s, s + len);
      if (significant(slice) < need) continue;
      const hit = findNeedle(page, slice.join(''));
      if (hit) return hit;
    }
  }
  return null;
}

export async function locateInTextLayer(
  pdf: PDFDocumentProxy,
  pages: number[],
  targets: EvidenceTarget[],
  woId: string
): Promise<{ boxes: PdfBoundingBox[]; missing: EvidenceTarget[]; textlessPages: number[] }> {
  const pageTexts: PageText[] = [];
  const textlessPages: number[] = [];
  for (const p of pages) {
    const t = await readPageText(pdf, p);
    if (t.joined.length < 40) textlessPages.push(p);
    else pageTexts.push(t);
  }

  const boxes: PdfBoundingBox[] = [];
  const missing: EvidenceTarget[] = [];
  for (const target of targets) {
    let found: { page: PageText; hit: TextHit } | null = null;
    for (const page of pageTexts) {
      for (const needle of target.needles) {
        const hit = findNeedle(page, needle);
        if (hit) {
          found = { page, hit };
          break;
        }
      }
      if (!found && target.needles.length === 0) {
        const hit = findPhrase(page, target.extractedValue);
        if (hit) found = { page, hit };
      }
      if (found) break;
    }
    if (!found) {
      missing.push(target);
      continue;
    }
    const { page, hit } = found;
    boxes.push({
      id: `${woId}-${target.fieldKey}`,
      pageNumber: page.pageNumber,
      label: target.label,
      fieldKey: target.fieldKey,
      category: target.category,
      box2d: boxForHit(page, hit),
      extractedValue: target.extractedValue,
      confidenceScore: 100,
      ocrQuote: hit.runs.map((i) => page.runs[i].text).join(' ').replace(/\s+/g, ' ').trim().slice(0, 300),
      locatedBy: 'text-layer',
    });
  }
  return { boxes, missing, textlessPages };
}

// Renders pages to JPEG for Gemini to read when the text layer is missing or garbled.
export async function renderPagesAsJpeg(pdf: PDFDocumentProxy, pages: number[], targetWidth = 1240): Promise<Array<{ pageNumber: number; imageBase64: string }>> {
  const out: Array<{ pageNumber: number; imageBase64: string }> = [];
  for (const pageNumber of pages) {
    const page = await pdf.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: targetWidth / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    // 'print' intent renders without requestAnimationFrame, so it keeps going in a background tab.
    await page.render({ canvasContext: ctx, viewport, canvas, intent: 'print' } as any).promise;
    out.push({ pageNumber, imageBase64: canvas.toDataURL('image/jpeg', 0.72).split('base64,')[1] });
    canvas.width = 0;
    canvas.height = 0;
  }
  return out;
}
