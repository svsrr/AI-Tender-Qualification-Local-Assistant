import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { IoclBidderEvaluation, IoclWorkOrderEntry, PdfBoundingBox } from '../types';
import { useApp } from '../context/AppContext';
import { X, FileText, CheckCircle2, AlertTriangle, Trash2, Maximize2, Minimize2, Tag, Loader2, Upload } from 'lucide-react';
import { InteractiveCanvasPdfViewer, UnlocatedField } from './InteractiveCanvasPdfViewer';
import { loadSourcePdf, attachSourcePdf } from '../services/sourcePdfStore';
import {
  EVIDENCE_LOCATOR_VERSION,
  evidenceTargetsForWorkOrder,
  locateInTextLayer,
  pageRangeForWorkOrder,
  quoteSupportsTarget,
  renderPagesAsJpeg,
} from '../utils/evidenceLocator';
import { apiFetch } from '../utils/api';

interface RawPdfViewerModalProps {
  bidder: IoclBidderEvaluation | null;
  workOrder: IoclWorkOrderEntry | null;
  onClose: () => void;
  onEditField?: () => void;
  initialSelectedKey?: string;
}

// Evaluation-sheet keys that have no box of their own map to the box that evidences them.
const ROW_TO_BOX_KEY: Record<string, string> = { durationMonths: 'startDate', annualisedValueLacs: 'compValueLacs' };

export const RawPdfViewerModal: React.FC<RawPdfViewerModalProps> = ({
  bidder,
  workOrder,
  onClose,
  onEditField,
  initialSelectedKey,
}) => {
  const { deleteIoclWorkOrder, documents, updateIoclWorkOrder, canEditActiveTender, ensureActiveTenderId } = useApp();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [activeHighlightKey, setActiveHighlightKey] = useState<string | null>(initialSelectedKey || null);
  const [isExpandedCanvas, setIsExpandedCanvas] = useState(false);

  const [pdfSource, setPdfSource] = useState<Uint8Array | string | undefined>(undefined);
  const [sourceState, setSourceState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [missingReason, setMissingReason] = useState('');
  const [attachError, setAttachError] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<PdfBoundingBox[]>([]);
  const [unlocated, setUnlocated] = useState<UnlocatedField[]>([]);
  const [locateStatus, setLocateStatus] = useState<React.ReactNode>(null);
  const [startPage, setStartPage] = useState<number>(workOrder?.sourcePageStart || workOrder?.rawPdfSnippet?.pageNumber || 1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const locatedForRef = useRef<string | null>(null);

  // Rows extracted before originals were kept may still point at a same-session upload.
  const legacySource = useMemo(() => {
    if (!workOrder) return undefined;
    const name = (workOrder.rawPdfDocName || '').toLowerCase();
    const doc = name ? documents.find((d) => (d.fileName || '').toLowerCase() === name) : undefined;
    return workOrder.storageUrl || doc?.storageUrl || workOrder.rawPdfUrl || doc?.previewUrl || undefined;
  }, [workOrder, documents]);

  const workOrderId = workOrder?.id;
  const sourceDocId = workOrder?.sourceDocId;
  const sourceDocPath = workOrder?.sourceDocPath;

  useEffect(() => {
    let cancelled = false;
    setSourceState('loading');
    (async () => {
      if (sourceDocId || sourceDocPath) {
        const res = await loadSourcePdf(sourceDocId, sourceDocPath);
        if (cancelled) return;
        if (!('reason' in res)) {
          setPdfSource(res.bytes);
          setSourceState('ready');
          return;
        }
        setMissingReason(res.reason);
      } else {
        setMissingReason('no-reference');
      }
      if (legacySource) {
        setPdfSource(legacySource);
        setSourceState('ready');
      } else {
        setPdfSource(undefined);
        setSourceState('missing');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workOrderId, sourceDocId, sourceDocPath, legacySource]);

  const handleDocumentLoaded = useCallback(
    async (pdf: PDFDocumentProxy) => {
      if (!workOrder || !bidder) return;
      const runKey = `${workOrder.id}:${pdf.fingerprints?.[0] || ''}`;
      if (locatedForRef.current === runKey) return;
      locatedForRef.current = runKey;

      const targets = evidenceTargetsForWorkOrder(workOrder);
      const finish = (found: PdfBoundingBox[], final = true) => {
        setBoxes(found);
        // Only report values as not found once every search step has run.
        if (!final) return setUnlocated([]);
        setUnlocated(
          targets
            .filter((t) => !found.some((b) => b.fieldKey === t.fieldKey))
            .map((t) => ({ fieldKey: t.fieldKey, label: t.label, extractedValue: t.extractedValue }))
        );
        if (found.length > 0) setStartPage(found[0].pageNumber);
      };

      if (workOrder.boundingBoxesVersion === EVIDENCE_LOCATOR_VERSION && Array.isArray(workOrder.boundingBoxes)) {
        finish(workOrder.boundingBoxes);
        setLocateStatus(null);
        return;
      }

      const pages = pageRangeForWorkOrder(workOrder, pdf.numPages);
      const pageLabel = pages.length > 1 ? `pages ${pages[0]}–${pages[pages.length - 1]}` : `page ${pages[0]}`;
      setStartPage(pages[0]);
      setLocateStatus(
        <>
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching {pageLabel} for the extracted values…
        </>
      );
      const text = await locateInTextLayer(pdf, pages, targets, workOrder.id);
      finish(text.boxes, text.missing.length === 0);

      let found = text.boxes;
      let aiFailed = false;
      if (text.missing.length > 0) {
        setLocateStatus(
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading {pageLabel} with AI to locate {text.missing.length} value
            {text.missing.length === 1 ? '' : 's'} not found in the PDF text…
          </>
        );
        try {
          const images = await renderPagesAsJpeg(pdf, pages);
          const res = await apiFetch('/api/locate-evidence', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pages: images,
              fields: text.missing.map((t) => ({ fieldKey: t.fieldKey, label: t.label, value: t.extractedValue })),
            }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(json?.error || `Server returned ${res.status}`);
          const aiBoxes: PdfBoundingBox[] = (json.locations || []).flatMap((l: any) => {
            const target = text.missing.find((t) => t.fieldKey === l.fieldKey);
            // Discard positions whose text does not state the extracted value.
            if (!target || found.some((b) => b.fieldKey === l.fieldKey) || !quoteSupportsTarget(target, l.quote)) return [];
            return [
              {
                id: `${workOrder.id}-${target.fieldKey}`,
                pageNumber: l.pageNumber,
                label: target.label,
                fieldKey: target.fieldKey,
                category: target.category,
                box2d: l.box2d,
                extractedValue: target.extractedValue,
                confidenceScore: 0,
                ocrQuote: l.quote,
                locatedBy: 'ai-vision' as const,
              },
            ];
          });
          found = [...found, ...aiBoxes].sort((a, b) => a.pageNumber - b.pageNumber);
          finish(found);
        } catch (err: any) {
          aiFailed = true;
          finish(found);
          setLocateStatus(
            <span className="text-amber-300 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> AI could not locate the remaining values: {err?.message || String(err)}
            </span>
          );
        }
      }
      if (!aiFailed) setLocateStatus(null);
      // Cache the real positions on the row so the next open (and teammates) skip the search.
      if (!aiFailed && canEditActiveTender) {
        updateIoclWorkOrder(bidder.id, workOrder.id, { boundingBoxes: found, boundingBoxesVersion: EVIDENCE_LOCATOR_VERSION });
      }
    },
    [workOrder, bidder, canEditActiveTender, updateIoclWorkOrder]
  );

  const handleAttach = async (file: File | undefined) => {
    if (!file || !workOrder || !bidder) return;
    setAttachError(null);
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      setAttachError('Please choose a PDF file.');
      return;
    }
    try {
      const stored = await attachSourcePdf(file, ensureActiveTenderId());
      locatedForRef.current = null;
      setPdfSource(stored.bytes);
      setSourceState('ready');
      if (canEditActiveTender) {
        // Every row that came from the same uploaded file gets the original back.
        const docName = (workOrder.rawPdfDocName || '').toLowerCase();
        for (const wo of bidder.workOrders || []) {
          if (wo.id === workOrder.id || (docName && (wo.rawPdfDocName || '').toLowerCase() === docName)) {
            updateIoclWorkOrder(bidder.id, wo.id, {
              sourceDocId: stored.sourceDocId,
              sourceDocPath: stored.sourceDocPath,
              boundingBoxes: undefined,
              boundingBoxesVersion: undefined,
            });
          }
        }
      }
    } catch (err: any) {
      setAttachError(err?.message || String(err));
    }
  };

  if (!bidder || !workOrder) return null;

  const getStatusBadge = (status?: string | null) => {
    const s = String(status || 'Pending');
    if (s.includes('Accepted') || s.includes('Acceptable')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          {s}
        </span>
      );
    }
    if (s.includes('Query')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
          {s}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-300">
        <X className="w-3.5 h-3.5 text-rose-600" />
        {s}
      </span>
    );
  };

  const docTitle = workOrder.rawPdfDocName || 'Original document';

  const handleTableRowClick = (fieldKey: string) => {
    setActiveHighlightKey(fieldKey);
    const match = boxes.find((b) => b.fieldKey === (ROW_TO_BOX_KEY[fieldKey] || fieldKey));
    if (match) setSelectedBoxId(match.id);
  };

  const handleSelectBoxFromCanvas = (box: PdfBoundingBox) => {
    setSelectedBoxId(box.id);
    setActiveHighlightKey(box.fieldKey);
  };

  const missingMessage =
    missingReason === 'no-reference'
      ? 'No original file is linked to this row. It was extracted before original PDFs were kept, or it is sample data.'
      : missingReason === 'not-in-cloud'
      ? 'The original PDF is not in cloud storage. It was uploaded from a browser that could not sync it.'
      : `The original PDF could not be loaded (${missingReason}).`;

  const emptyState =
    sourceState === 'loading' ? (
      <div className="flex items-center justify-center gap-2 text-slate-300">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading the original PDF…
      </div>
    ) : (
      <>
        <FileText className="w-10 h-10 mx-auto text-slate-500" />
        <p className="font-semibold text-white">Original PDF not available</p>
        <p className="text-xs text-slate-400 leading-relaxed">{missingMessage}</p>
        <p className="text-xs text-slate-400 leading-relaxed">
          Attach <span className="font-mono text-slate-200">{workOrder.rawPdfDocName || 'the original PDF'}</span> to see the real document
          with the extracted values highlighted.
        </p>
        <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => handleAttach(e.target.files?.[0])} />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold"
        >
          <Upload className="w-3.5 h-3.5" /> Attach original PDF
        </button>
        {!canEditActiveTender && (
          <p className="text-[11px] text-amber-300">Another engineer holds the edit lock, so the file is only shown in this view and not linked to the row.</p>
        )}
        {attachError && <p className="text-[11px] text-rose-300">{attachError}</p>}
      </>
    );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-300 w-full max-w-7xl h-[94vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-6 py-3.5 bg-slate-950 text-white border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-600/30 text-red-400 border border-red-500/40 shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-wide">Document Viewer</h3>
              <p className="text-xs text-slate-300">
                Bidder #{bidder.slNo}: <span className="text-white font-semibold">{bidder.bidderName}</span>
                {bidder.cityState ? ` (${bidder.cityState})` : ''} • WO: <span className="text-amber-300 font-mono">{workOrder.woNumberAndDate}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsExpandedCanvas(!isExpandedCanvas)}
              className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs border border-slate-700 transition"
              title={isExpandedCanvas ? 'Show evaluation sheet' : 'Expand document view'}
            >
              {isExpandedCanvas ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              <span>{isExpandedCanvas ? 'Split view' : 'Expand'}</span>
            </button>
            {getStatusBadge(workOrder.woStatus)}
            <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* One row bounded by the modal: without min-h-0 / minmax(0,1fr) the right column grew to
            its content, was clipped, and could not scroll to the rows below #15. */}
        <div className="grid grid-cols-1 lg:grid-cols-12 lg:grid-rows-[minmax(0,1fr)] flex-1 min-h-0 overflow-hidden">
          <div className={`${isExpandedCanvas ? 'lg:col-span-12' : 'lg:col-span-8'} h-full overflow-hidden flex flex-col bg-slate-900 border-r border-slate-800`}>
            <InteractiveCanvasPdfViewer
              pdfUrlOrData={sourceState === 'ready' ? pdfSource : undefined}
              documentTitle={docTitle}
              boundingBoxes={boxes}
              unlocatedFields={unlocated}
              emptyState={emptyState}
              statusNote={locateStatus}
              onDocumentLoaded={handleDocumentLoaded}
              initialSelectedBoxId={selectedBoxId || undefined}
              onSelectBox={handleSelectBoxFromCanvas}
              initialPage={startPage}
              className="h-full border-none rounded-none"
            />
          </div>

          {/* Right Column: 18-Column Schema Data Mapping (Collapsible or 4 cols) */}
          {!isExpandedCanvas && (
            <div className="lg:col-span-4 min-h-0 p-4 bg-white overflow-y-auto space-y-4 flex flex-col border-l border-slate-200">
              <div>
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5 font-mono">
                    <Tag className="w-3.5 h-3.5 text-blue-600" />
                    Evaluation Sheet
                  </h4>
                  <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">
                    Linked
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Click any row to highlight it on the document.
                </p>
              </div>

              {/* Table of the 18 columns for this row */}
              <div className="border border-slate-200 rounded-lg overflow-hidden text-xs shrink-0">
                <table className="w-full text-left">
                  <tbody className="divide-y divide-slate-200">
                    <tr
                      onClick={() => handleTableRowClick('woNumberAndDate')}
                      className={`cursor-pointer transition ${activeHighlightKey === 'woNumberAndDate' ? 'bg-amber-100/70 font-semibold' : 'hover:bg-slate-50'}`}
                    >
                      <td className="p-2 text-slate-600 w-2/5 font-medium">#3 WO & Date</td>
                      <td className="p-2 font-mono text-[11px] text-slate-900">{workOrder.woNumberAndDate}</td>
                    </tr>
                    <tr
                      onClick={() => handleTableRowClick('jobName')}
                      className={`cursor-pointer transition ${activeHighlightKey === 'jobName' ? 'bg-blue-100/70 font-semibold' : 'hover:bg-slate-50'}`}
                    >
                      <td className="p-2 text-slate-600 font-medium">#4 Job Name</td>
                      <td className="p-2 text-[11px] text-slate-800">{workOrder.jobName}</td>
                    </tr>
                    <tr
                      onClick={() => handleTableRowClick('jobName')}
                      className={`cursor-pointer transition ${activeHighlightKey === 'jobName' ? 'bg-blue-100/70 font-semibold' : 'hover:bg-slate-50'}`}
                    >
                      <td className="p-2 text-slate-600 font-medium">#5 Similar Nature</td>
                      <td className="p-2">
                        <span className={`px-2 py-0.5 rounded font-bold text-[11px] ${workOrder.meetsSimilarNature === 'Yes' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                          {workOrder.meetsSimilarNature}
                        </span>
                      </td>
                    </tr>
                    <tr
                      onClick={() => handleTableRowClick('ownerApprovalSubmitted')}
                      className={`cursor-pointer transition ${activeHighlightKey === 'ownerApprovalSubmitted' ? 'bg-purple-100/70 font-semibold' : 'hover:bg-slate-50'}`}
                    >
                      <td className="p-2 text-slate-600 font-medium">#7 Sub Contract</td>
                      <td className="p-2 font-semibold text-slate-800">{workOrder.isSubcontract}</td>
                    </tr>
                    <tr
                      onClick={() => handleTableRowClick('ownerApprovalSubmitted')}
                      className={`cursor-pointer transition ${activeHighlightKey === 'ownerApprovalSubmitted' ? 'bg-purple-100/70 font-semibold' : 'hover:bg-slate-50'}`}
                    >
                      <td className="p-2 text-slate-600 font-medium">#8 Owner Approval</td>
                      <td className="p-2 font-semibold text-slate-800">{workOrder.ownerApprovalSubmitted}</td>
                    </tr>
                    <tr
                      onClick={() => handleTableRowClick('durationMonths')}
                      className={`cursor-pointer transition ${activeHighlightKey === 'durationMonths' ? 'bg-orange-100/70 font-semibold' : 'hover:bg-slate-50'}`}
                    >
                      <td className="p-2 text-slate-600 font-medium">#9-11 Period</td>
                      <td className="p-2 font-mono text-[11px]">{workOrder.durationMonths} Mos ({workOrder.startDate} - {workOrder.compDate})</td>
                    </tr>
                    <tr
                      onClick={() => handleTableRowClick('woValueLacs')}
                      className={`cursor-pointer transition ${activeHighlightKey === 'woValueLacs' ? 'bg-amber-100/70 font-semibold' : 'hover:bg-slate-50'}`}
                    >
                      <td className="p-2 text-slate-600 font-medium">#12 WO Value</td>
                      <td className="p-2 font-mono">
                        {typeof workOrder.woValueLacs === 'number' ? `₹${workOrder.woValueLacs.toFixed(2)} Lacs` : workOrder.woValueNote || '-'}
                      </td>
                    </tr>
                    <tr
                      onClick={() => handleTableRowClick('compValueLacs')}
                      className={`cursor-pointer transition ${activeHighlightKey === 'compValueLacs' ? 'bg-amber-200/80 font-bold' : 'hover:bg-slate-50'}`}
                    >
                      <td className="p-2 text-slate-800 font-bold">#13 Comp Value</td>
                      <td className="p-2 font-mono font-bold text-emerald-700">
                        {typeof workOrder.compValueLacs === 'number' ? `₹${workOrder.compValueLacs.toFixed(2)} Lacs` : workOrder.compValueNote || '-'}
                      </td>
                    </tr>
                    {typeof workOrder.annualisedValueLacs === 'number' && (
                      <tr
                        onClick={() => handleTableRowClick('annualisedValueLacs')}
                        className={`cursor-pointer transition ${activeHighlightKey === 'annualisedValueLacs' ? 'bg-purple-100/70 font-semibold' : 'hover:bg-slate-50'}`}
                      >
                        <td className="p-2 text-slate-600 font-medium">#14 Annualised</td>
                        <td className="p-2 font-mono font-bold text-purple-800">
                          ₹{workOrder.annualisedValueLacs.toFixed(2)} Lacs
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td className="p-2 text-slate-600 font-medium">#15 Deviation</td>
                      <td className="p-2 font-semibold text-slate-800">{workOrder.nilDeviationSheet}</td>
                    </tr>
                    <tr className="bg-slate-50">
                      <td className="p-2 text-slate-600 font-medium">#17 Remarks</td>
                      <td className="p-2 text-slate-700 italic text-[11px] leading-relaxed">{workOrder.remarks}</td>
                    </tr>
                    <tr className="bg-emerald-50/50">
                      <td className="p-2 font-bold text-slate-900">#18 Position</td>
                      <td className="p-2 font-bold">{getStatusBadge(bidder.finalPosition)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col gap-2 pt-2 border-t border-slate-200 shrink-0">
                {confirmDelete ? (
                  <div className="flex items-center justify-between p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs">
                    <span className="text-red-700 font-semibold">Delete this work order?</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          deleteIoclWorkOrder(bidder.id, workOrder.id);
                          onClose();
                        }}
                        className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded font-bold"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setConfirmDelete(false)}
                        className="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="flex items-center gap-2">
                  {!confirmDelete && (
                    <button
                      onClick={() => setConfirmDelete(true)}
                      className="py-1.5 px-3 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 font-medium text-xs transition flex items-center gap-1"
                      title="Delete this Work Order"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete
                    </button>
                  )}
                  {onEditField && (
                    <button
                      onClick={onEditField}
                      className="flex-1 py-1.5 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs shadow-xs transition"
                    >
                      Edit Values
                    </button>
                  )}
                  <button
                    onClick={onClose}
                    className="py-1.5 px-3 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 font-medium text-xs transition"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
