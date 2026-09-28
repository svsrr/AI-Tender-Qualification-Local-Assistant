import * as pdfjsLib from 'pdfjs-dist';
import { csvCell } from './csv';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

// Where pdf.js finds its decoders, CMaps, fonts and colour profiles (copied there by
// pdfjsAssetsPlugin in vite.config.ts). Pass to every getDocument call: without wasmUrl,
// JBIG2 / JPEG 2000 scans are dropped and the page renders nearly blank.
export const PDFJS_DOCUMENT_OPTIONS = {
  wasmUrl: '/pdfjs/wasm/',
  cMapUrl: '/pdfjs/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/pdfjs/standard_fonts/',
  iccUrl: '/pdfjs/iccs/',
};

export async function extractTextFromPdfFile(
  file: File,
  onProgress?: (percent: number, message: string) => void
): Promise<string> {
  if (onProgress) onProgress(15, 'Reading PDF array buffer...');
  const arrayBuffer = await file.arrayBuffer();
  
  if (onProgress) onProgress(30, 'Initializing PDF parser worker...');
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, ...PDFJS_DOCUMENT_OPTIONS }).promise;
  const numPages = pdf.numPages;
  
  let fullText = '';
  for (let i = 1; i <= numPages; i++) {
    const pct = Math.round(30 + (i / numPages) * 35);
    if (onProgress) onProgress(pct, `Extracting local text: Page ${i} of ${numPages} (${pct}%)`);
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items = (content.items || []) as any[];

    // Sort items by vertical Y coordinate descending (top to bottom), then X coordinate ascending (left to right)
    items.sort((a, b) => {
      const yA = a.transform ? a.transform[5] : 0;
      const yB = b.transform ? b.transform[5] : 0;
      const xA = a.transform ? a.transform[4] : 0;
      const xB = b.transform ? b.transform[4] : 0;
      if (Math.abs(yB - yA) > 4) return yB - yA;
      return xA - xB;
    });

    let pageText = '';
    let lastY: number | null = null;
    for (const item of items) {
      const currentY = item.transform ? item.transform[5] : null;
      if (lastY !== null && currentY !== null && Math.abs(currentY - lastY) > 6) {
        pageText += '\n';
      } else if (pageText && !pageText.endsWith('\n') && !pageText.endsWith(' ')) {
        pageText += ' ';
      }
      pageText += item.str || '';
      if (currentY !== null) lastY = currentY;
    }

    fullText += `--- Page ${i} ---\n${pageText.trim()}\n\n`;
  }
  return fullText;
}

export async function processFileForUpload(
  file: File,
  onProgress?: (percent: number, message: string) => void
): Promise<{ base64Data?: string; textContent?: string }> {
  if (onProgress) onProgress(10, `Preparing ${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB)...`);

  // Helper 1: Fast Base64 Encoding
  const getBase64Promise = (): Promise<string | undefined> => {
    if (file.size > 28 * 1024 * 1024) return Promise.resolve(undefined);
    return new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(file);
    });
  };

  // Helper 2: Fast Local Text Extraction with 2.5s Timeout
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const getTextPromise = (): Promise<string | undefined> => {
    if (!isPdf) return Promise.resolve(undefined);
    const timeoutPromise = new Promise<undefined>((res) => setTimeout(() => res(undefined), 2500));
    const extractPromise = extractTextFromPdfFile(file, onProgress)
      .then((txt) => (txt && txt.trim().length > 30 ? txt.trim() : undefined))
      .catch(() => undefined);

    return Promise.race([extractPromise, timeoutPromise]);
  };

  if (onProgress) onProgress(35, 'Encoding document & analyzing text in parallel...');
  const [base64Data, textContent] = await Promise.all([getBase64Promise(), getTextPromise()]);

  if (onProgress) onProgress(95, 'Sending the document to the AI for reading...');
  return { base64Data, textContent };
}

// Matches DD-MM-YYYY, DD/MM/YYYY, or YYYY-MM-DD
export function parseFlexibleDate(dStr: string): Date {
  const parts = dStr.split(/[\-\/\.]/).map(Number);
  if (parts.length === 3) {
    if (parts[0] > 1000) {
      // YYYY-MM-DD
      return new Date(parts[0], parts[1] - 1, parts[2]);
    } else {
      // DD-MM-YYYY
      return new Date(parts[2], parts[1] - 1, parts[0]);
    }
  }
  return new Date(dStr);
}

export function calculateDurationInMonths(startDateStr: string | null, compDateStr: string | null): number | null {
  if (!startDateStr || !compDateStr) return null;

  const start = parseFlexibleDate(startDateStr);
  const end = parseFlexibleDate(compDateStr);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;

  const diffInMs = end.getTime() - start.getTime();
  const diffInDays = diffInMs / (1000 * 60 * 60 * 24);

  // A completion date before the start date means the extracted dates are
  // wrong (OCR misread/swap) — surface that as "unknown" instead of a fake duration.
  if (diffInDays < 0) return null;

  return Math.max(1, Math.round(diffInDays / 30));
}

export function exportExtractionsToCsv(items: any[], filename: string = 'Work_Order_Extractions.csv') {
  let csv = 'Work Order No (wo_number),Client / Vendor Name (client_name),Work Order Date (wo_date),Work Order Value (INR) (wo_value),Completion Period (completion_period),Defect Liability Period (defect_liability_period),Consistency Status,Inconsistency Flags\n';
  
  items.forEach((item: any) => {
    const woNo = csvCell(item.wo_number || item.woNumber || '');
    const client = csvCell(item.client_name || item.contractorName || item.issuingOrg || '');
    const date = csvCell(item.wo_date || item.woDate || '');
    const val = item.wo_value !== undefined && item.wo_value !== null ? item.wo_value : (item.valLacs ? item.valLacs * 100000 : '');
    const comp = csvCell(item.completion_period || item.durationMonths || '');
    const dlp = csvCell(item.defect_liability_period || '');
    const status = csvCell(item.consistency_status || 'consistent');
    const flags = csvCell(Array.isArray(item.inconsistency_flags) ? item.inconsistency_flags.join('; ') : '');
    csv += `${woNo},${client},${date},${val},${comp},${dlp},${status},${flags}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}



// Shown while a large PDF is with Gemini, so a long wait is not mistaken for a hang. Measured on
// Cloud Run: 3-10 MB took 25-30 s, 14-16 MB (78-156 pages) took 35-80 s.
// Largest PDF accepted for AI reading. The file travels to the server as base64 (a third larger)
// and Cloud Run refuses any request over 32 MiB, which the browser reports only as "Failed to
// fetch": about 23.9 MB of PDF is the hard ceiling. 20 MB leaves a margin; a 21.2 MB PDF was read
// in 23 s in testing (22.09.2026), so Gemini is not the limit.
export const MAX_UPLOAD_MB = 20;

// Null when the file can be sent; otherwise the message asking the engineer to split it.
export function oversizeUploadMessage(file: File | null | undefined): string | null {
  if (!file || file.size <= MAX_UPLOAD_MB * 1024 * 1024) return null;
  const mb = (file.size / (1024 * 1024)).toFixed(1);
  return (
    `${file.name} is ${mb} MB; PDFs up to ${MAX_UPLOAD_MB} MB can be read. ` +
    `Please split it into smaller PDFs (for example one per work order, with its completion certificate) ` +
    `and upload each part to the same bidder. Work orders appearing in two parts are merged automatically.`
  );
}

export function largeFileWaitHint(file?: File | null): string {
  if (!file || file.size < 5 * 1024 * 1024) return '';
  const mb = (file.size / (1024 * 1024)).toFixed(1);
  const wait = file.size >= 12 * 1024 * 1024 ? '1-2 minutes' : 'about a minute';
  return `This is a large file (${mb} MB). AI extraction reads every page and can take ${wait} - please be patient and keep this tab open.`;
}
