import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  PanelRightClose,
  PanelRightOpen,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  AlertTriangle,
  CheckCircle2,
  FileText,
  IndianRupee,
  FileCheck,
  Sparkles,
  Layers,
  Copy,
  Check,
  Clock,
  Building,
  Loader2,
  SearchX,
  Type,
} from 'lucide-react';
import { PdfBoundingBox, BoundingBoxCategory } from '../types';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { PDFJS_DOCUMENT_OPTIONS } from '../utils/pdfExtractor';

// Same bundled worker as pdfExtractor.ts, so the worker always matches the installed pdfjs-dist.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();

export interface UnlocatedField {
  fieldKey: string;
  label: string;
  extractedValue: string;
}

interface InteractiveCanvasPdfViewerProps {
  pdfUrlOrData?: string | ArrayBuffer | Uint8Array;
  documentTitle?: string;
  initialPage?: number;
  initialSelectedBoxId?: string;
  boundingBoxes: PdfBoundingBox[];
  // Extracted values that could not be found on the document; listed, never drawn.
  unlocatedFields?: UnlocatedField[];
  // Shown instead of the canvas when there is no PDF to render.
  emptyState?: React.ReactNode;
  // Status line under the toolbar (e.g. "Locating values with AI…").
  statusNote?: React.ReactNode;
  onDocumentLoaded?: (pdf: PDFDocumentProxy) => void;
  onSelectBox?: (box: PdfBoundingBox) => void;
  onVerifyBox?: (boxId: string) => void;
  readOnly?: boolean;
  className?: string;
  /** @deprecated page count now comes from the PDF itself */
  totalDocPages?: number;
  embedded?: boolean;
}

async function toPdfSource(input: string | ArrayBuffer | Uint8Array): Promise<{ data: Uint8Array } | { url: string }> {
  if (input instanceof Uint8Array) return { data: input.slice() }; // pdf.js transfers (detaches) the buffer it gets
  if (input instanceof ArrayBuffer) return { data: new Uint8Array(input.slice(0)) };
  const trimmed = input.trim();
  if (trimmed.startsWith('data:') || trimmed.startsWith('JVBERi')) {
    const base64 = trimmed.includes('base64,') ? trimmed.split('base64,')[1] : trimmed;
    const bin = window.atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { data: bytes };
  }
  return { url: trimmed };
}

const CATEGORY_STYLE: Record<BoundingBoxCategory, { border: string; fill: string; badge: string; icon: React.ElementType }> = {
  monetary: { border: 'border-emerald-500', fill: 'bg-emerald-400/15', badge: 'bg-emerald-600', icon: IndianRupee },
  signature_stamp: { border: 'border-rose-500', fill: 'bg-rose-400/15', badge: 'bg-rose-600', icon: CheckCircle2 },
  scope_similar_nature: { border: 'border-blue-500', fill: 'bg-blue-400/15', badge: 'bg-blue-600', icon: FileText },
  date_duration: { border: 'border-orange-500', fill: 'bg-orange-400/15', badge: 'bg-orange-500', icon: Clock },
  subcontract_eic: { border: 'border-purple-500', fill: 'bg-purple-400/15', badge: 'bg-purple-600', icon: Building },
  statutory_tax: { border: 'border-teal-500', fill: 'bg-teal-400/15', badge: 'bg-teal-600', icon: FileCheck },
  general: { border: 'border-slate-500', fill: 'bg-slate-400/15', badge: 'bg-slate-600', icon: Layers },
};

const locatedByLabel = (box: PdfBoundingBox) =>
  box.locatedBy === 'text-layer' ? 'Exact text match' : box.locatedBy === 'ai-vision' ? 'Located by AI on page image' : 'Position not verified';

export const InteractiveCanvasPdfViewer: React.FC<InteractiveCanvasPdfViewerProps> = ({
  pdfUrlOrData,
  documentTitle = 'Document.pdf',
  initialPage = 1,
  initialSelectedBoxId,
  boundingBoxes = [],
  unlocatedFields = [],
  emptyState,
  statusNote,
  onDocumentLoaded,
  onSelectBox,
  onVerifyBox,
  readOnly = false,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [showBoundingBoxes, setShowBoundingBoxes] = useState<boolean>(true);
  // The Field evidence panel can be folded away to give the page more room; remembered per browser.
  const [showEvidencePanel, setShowEvidencePanel] = useState<boolean>(() => {
    try {
      return localStorage.getItem('pdf_evidence_panel') !== 'closed';
    } catch {
      return true;
    }
  });
  const toggleEvidencePanel = () =>
    setShowEvidencePanel((open) => {
      try {
        localStorage.setItem('pdf_evidence_panel', open ? 'closed' : 'open');
      } catch {
        // Preference only.
      }
      return !open;
    });
  const [selectedCategory, setSelectedCategory] = useState<BoundingBoxCategory | 'all'>('all');
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(initialSelectedBoxId || null);
  const [hoveredBoxId, setHoveredBoxId] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const numPages = pdfDoc?.numPages || 0;
  const onDocumentLoadedRef = useRef(onDocumentLoaded);
  onDocumentLoadedRef.current = onDocumentLoaded;

  // Load the document once per source; page turns and zoom only re-render.
  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;
    setPdfDoc(null);
    setLoadError(null);
    if (!pdfUrlOrData) return;
    setIsLoading(true);
    (async () => {
      try {
        const source = await toPdfSource(pdfUrlOrData);
        loadingTask = pdfjsLib.getDocument({ ...source, ...PDFJS_DOCUMENT_OPTIONS } as any);
        const loaded = await loadingTask.promise;
        if (cancelled) return;
        setPdfDoc(loaded);
        onDocumentLoadedRef.current?.(loaded);
      } catch (err: any) {
        if (!cancelled) setLoadError(err?.message || String(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      loadingTask?.destroy();
    };
  }, [pdfUrlOrData]);

  useEffect(() => {
    if (initialPage) setCurrentPage(initialPage);
  }, [initialPage]);

  useEffect(() => {
    if (!initialSelectedBoxId) return;
    setSelectedBoxId(initialSelectedBoxId);
    const target = boundingBoxes.find((b) => b.id === initialSelectedBoxId);
    if (target) setCurrentPage(target.pageNumber);
  }, [initialSelectedBoxId, boundingBoxes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!pdfDoc || !canvas) return;
    let cancelled = false;
    setIsRendering(true);
    (async () => {
      try {
        const pageNum = Math.min(Math.max(1, currentPage), pdfDoc.numPages);
        const page = await pdfDoc.getPage(pageNum);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (800 * zoomLevel) / base.width });
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(viewport.width * dpr);
        canvas.height = Math.round(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        renderTaskRef.current?.cancel();
        const task = page.render({ canvasContext: ctx, viewport, canvas } as any);
        renderTaskRef.current = task;
        await task.promise;
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') console.warn('PDF page render failed:', err);
      } finally {
        if (!cancelled) setIsRendering(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, currentPage, zoomLevel]);

  const visibleBoxesForPage = useMemo(
    () =>
      boundingBoxes.filter(
        (box) => box.pageNumber === currentPage && (selectedCategory === 'all' || box.category === selectedCategory)
      ),
    [boundingBoxes, currentPage, selectedCategory]
  );

  const activeBox = useMemo(() => boundingBoxes.find((b) => b.id === selectedBoxId) || null, [boundingBoxes, selectedBoxId]);

  const selectBox = (box: PdfBoundingBox) => {
    setSelectedBoxId(box.id);
    setCurrentPage(box.pageNumber);
    onSelectBox?.(box);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const hasDocument = Boolean(pdfUrlOrData);

  return (
    <div className={`flex flex-col h-full bg-slate-900 text-white rounded-xl overflow-hidden shadow-2xl border border-slate-700 ${className}`}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-slate-950/95 border-b border-slate-800 text-xs shrink-0 select-none">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-medium text-slate-300">
            <FileText className="w-4 h-4 text-blue-400 shrink-0" />
            <span className="font-mono truncate max-w-[200px] sm:max-w-xs text-white" title={documentTitle}>
              {documentTitle}
            </span>
          </div>
          <div className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded-lg p-0.5">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={!pdfDoc || currentPage <= 1}
              className="p-1 rounded hover:bg-slate-800 disabled:opacity-40 transition text-slate-300"
              title="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2 font-mono font-semibold text-slate-200 text-[11px]">
              Page {pdfDoc ? Math.min(currentPage, numPages) : '-'} / {numPages || '-'}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
              disabled={!pdfDoc || currentPage >= numPages}
              className="p-1 rounded hover:bg-slate-800 disabled:opacity-40 transition text-slate-300"
              title="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded-lg p-0.5">
          <button onClick={() => setZoomLevel((z) => Math.max(0.6, Number((z - 0.15).toFixed(2))))} className="p-1 rounded hover:bg-slate-800 text-slate-300" title="Zoom out">
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="px-2 font-mono font-bold text-slate-300 text-[11px] min-w-[42px] text-center">{Math.round(zoomLevel * 100)}%</span>
          <button onClick={() => setZoomLevel((z) => Math.min(2.2, Number((z + 0.15).toFixed(2))))} className="p-1 rounded hover:bg-slate-800 text-slate-300" title="Zoom in">
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleEvidencePanel}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-semibold transition text-[11px] bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700"
            title={showEvidencePanel ? 'Hide the Field evidence panel to see more of the page' : 'Show the Field evidence panel'}
          >
            {showEvidencePanel ? <PanelRightClose className="w-3.5 h-3.5" /> : <PanelRightOpen className="w-3.5 h-3.5" />}
            <span>{showEvidencePanel ? 'Hide evidence' : 'Show evidence'}</span>
          </button>
          <button
            onClick={() => setShowBoundingBoxes(!showBoundingBoxes)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-semibold transition text-[11px] ${
              showBoundingBoxes ? 'bg-blue-600/30 text-blue-300 border-blue-500/50' : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
          >
            {showBoundingBoxes ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span>{showBoundingBoxes ? 'Boxes on' : 'Boxes off'}</span>
            <span className="ml-1 px-1.5 rounded-full text-[10px] bg-blue-500/40 text-blue-200 font-mono">{visibleBoxesForPage.length}</span>
          </button>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value as any)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-slate-200 text-[11px] focus:outline-none focus:border-blue-500"
          >
            <option value="all">All fields</option>
            <option value="monetary">Values</option>
            <option value="date_duration">WO no. & dates</option>
            <option value="scope_similar_nature">Job name</option>
            <option value="general">Organisation</option>
          </select>
        </div>
      </div>

      {(statusNote || boundingBoxes.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-1.5 bg-slate-900/80 border-b border-slate-800 text-[11px] shrink-0">
          {statusNote && <div className="text-slate-300 flex items-center gap-1.5">{statusNote}</div>}
          {boundingBoxes.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
              <span className="text-slate-400">Jump to:</span>
              {boundingBoxes.map((box) => (
                <button
                  key={box.id}
                  onClick={() => selectBox(box)}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono border whitespace-nowrap ${
                    selectedBoxId === box.id ? 'bg-blue-600 text-white border-blue-400' : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  P{box.pageNumber}: {box.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden relative">
        {/* No justify-center here: it centres a zoomed page that is wider than the pane by pushing
            its left half out of reach of the scrollbar. The page centres itself with mx-auto instead. */}
        <div className="flex-1 overflow-auto p-4 sm:p-6 bg-slate-950 flex items-start relative select-none">
          {!hasDocument ? (
            <div className="max-w-md mx-auto mt-16 text-center text-slate-300 space-y-3">{emptyState || <p>No document to display.</p>}</div>
          ) : loadError ? (
            <div className="max-w-md mx-auto mt-16 text-center text-rose-300 space-y-2">
              <AlertTriangle className="w-8 h-8 mx-auto" />
              <p className="font-semibold">The original PDF could not be opened.</p>
              <p className="text-xs text-rose-200/80 break-words">{loadError}</p>
            </div>
          ) : (
            <div className="relative shadow-2xl rounded-sm mx-auto shrink-0" style={{ minWidth: `${Math.round(800 * zoomLevel)}px` }}>
              <canvas ref={canvasRef} className="block rounded-sm bg-white" />
              {(isLoading || isRendering) && (
                <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2 py-1 rounded bg-slate-900/80 text-[11px] text-slate-200">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {isLoading ? 'Opening PDF…' : 'Rendering…'}
                </div>
              )}
              {showBoundingBoxes && pdfDoc && (
                <div className="absolute inset-0 pointer-events-none">
                  {visibleBoxesForPage.map((box) => {
                    const [ymin, xmin, ymax, xmax] = box.box2d;
                    const style = CATEGORY_STYLE[box.category] || CATEGORY_STYLE.general;
                    const Icon = style.icon;
                    const isSelected = selectedBoxId === box.id;
                    const isHovered = hoveredBoxId === box.id;
                    return (
                      <div
                        key={box.id}
                        onClick={() => selectBox(box)}
                        onMouseEnter={() => setHoveredBoxId(box.id)}
                        onMouseLeave={() => setHoveredBoxId(null)}
                        style={{ top: `${ymin / 10}%`, left: `${xmin / 10}%`, width: `${(xmax - xmin) / 10}%`, height: `${(ymax - ymin) / 10}%` }}
                        className={`absolute pointer-events-auto cursor-pointer rounded-sm border-2 transition ${style.border} ${
                          isSelected ? 'bg-yellow-300/35 ring-4 ring-yellow-400/50' : isHovered ? style.fill.replace('/15', '/30') : style.fill
                        }`}
                      >
                        <div className={`absolute -top-4 left-0 px-1.5 rounded text-[9px] text-white font-bold shadow-sm flex items-center gap-1 whitespace-nowrap ${style.badge}`}>
                          <Icon className="w-2.5 h-2.5 shrink-0" />
                          {box.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Inspector */}
        <div className={`${showEvidencePanel ? 'flex' : 'hidden'} w-80 sm:w-96 bg-slate-900 border-l border-slate-800 flex-col shrink-0 overflow-hidden`}>
          <div className="p-3.5 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200 font-mono">Field evidence</h4>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              {visibleBoxesForPage.length} on page {currentPage}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
            {activeBox ? (
              <div className="space-y-3">
                <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <h5 className="text-sm font-bold text-white">{activeBox.label}</h5>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold border whitespace-nowrap ${
                        activeBox.locatedBy === 'text-layer'
                          ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40'
                          : 'bg-amber-600/20 text-amber-300 border-amber-500/40'
                      }`}
                    >
                      {activeBox.locatedBy === 'text-layer' ? <Type className="w-3 h-3 inline mr-1" /> : <Sparkles className="w-3 h-3 inline mr-1" />}
                      {locatedByLabel(activeBox)}
                    </span>
                  </div>
                  <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-700 flex items-center justify-between gap-2">
                    <div className="font-mono text-sm font-bold text-amber-400 break-all">{activeBox.extractedValue}</div>
                    <button onClick={() => handleCopy(activeBox.extractedValue)} className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white shrink-0" title="Copy value">
                      {copiedText === activeBox.extractedValue ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {activeBox.ocrQuote && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Text at this position</span>
                      <span className="text-[10px] font-mono text-slate-400">Page {activeBox.pageNumber}</span>
                    </div>
                    <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-500/30 text-amber-100/90 text-xs italic leading-relaxed font-serif">
                      "{activeBox.ocrQuote}"
                    </div>
                  </div>
                )}

                {activeBox.locatedBy === 'ai-vision' && (
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    This page has no usable text layer, so the position was read by AI from the page image. Check it against the highlighted area.
                  </p>
                )}

                {activeBox.riskNote && (
                  <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800/60 text-rose-200/90 text-[11px]">{activeBox.riskNote}</div>
                )}

                {!readOnly && onVerifyBox && (
                  <button
                    onClick={() => onVerifyBox(activeBox.id)}
                    className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Accept field
                  </button>
                )}
              </div>
            ) : (
              <div className="p-6 text-center text-slate-500 space-y-2">
                <Layers className="w-8 h-8 mx-auto text-slate-600" />
                <p className="font-medium text-slate-400">No field selected</p>
                <p className="text-[11px]">Click a highlighted box on the page, or a field below.</p>
              </div>
            )}

            <div className="pt-4 border-t border-slate-800 space-y-2">
              <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono">Found on the document</h5>
              {boundingBoxes.length === 0 && <p className="text-[11px] text-slate-500">No extracted values located yet.</p>}
              {boundingBoxes.map((box) => {
                const style = CATEGORY_STYLE[box.category] || CATEGORY_STYLE.general;
                const Icon = style.icon;
                return (
                  <button
                    key={box.id}
                    onClick={() => selectBox(box)}
                    className={`w-full text-left p-2 rounded-lg border transition flex items-center justify-between gap-2 ${
                      selectedBoxId === box.id ? 'bg-blue-600/20 border-blue-500 text-white' : 'bg-slate-800/50 border-slate-700/60 hover:bg-slate-800 text-slate-300'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <Icon className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      <span className="truncate text-xs font-medium">{box.label}</span>
                    </span>
                    <span className="font-mono text-[10px] text-slate-400 shrink-0">
                      P{box.pageNumber} · {box.locatedBy === 'text-layer' ? 'text' : 'AI'}
                    </span>
                  </button>
                );
              })}
            </div>

            {unlocatedFields.length > 0 && (
              <div className="pt-3 border-t border-slate-800 space-y-2">
                <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono flex items-center gap-1.5">
                  <SearchX className="w-3.5 h-3.5" />
                  Not found on the document
                </h5>
                {unlocatedFields.map((f) => (
                  <div key={f.fieldKey} className="p-2 rounded-lg border border-dashed border-slate-700 text-slate-400">
                    <div className="text-xs font-medium text-slate-300">{f.label}</div>
                    <div className="text-[10px] font-mono break-words">{f.extractedValue}</div>
                  </div>
                ))}
                <p className="text-[10px] text-slate-500">Check these values manually; the extracted figure may be wrong or printed differently.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
