import { processFileForUpload, largeFileWaitHint, oversizeUploadMessage } from '../utils/pdfExtractor';
import { apiFetch } from '../utils/api';
import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { IoclBidderEvaluation, IoclWorkOrderEntry, DocumentItem, isOneTimeJobTender } from '../types';
import { claimedOrdersFrom, noWorkOrdersMessage, mapExtractedWorkOrder, extractedWorkOrdersFrom, resolveSimilarNatureClause, resolveSimilarNatureDefinition, splitDuplicateWorkOrders, duplicateMergePrompt } from '../utils/tbaRules';
import { storeSourcePdf, StoredSourcePdf } from '../services/sourcePdfStore';
import {
  UploadCloud,
  FileText,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  X,
  FileCheck2,
  Sparkles,
  Building,
  RefreshCw,
} from 'lucide-react';

interface RawPdfIngestionModalProps {
  onClose: () => void;
  onSuccess: (newBidder: IoclBidderEvaluation) => void;
}

export const RawPdfIngestionModal: React.FC<RawPdfIngestionModalProps> = ({
  onClose,
  onSuccess,
}) => {
  const { criteria, ioclMetadata, addIoclBidder, addAuditLog, uploadDocuments, ensureActiveTenderId } = useApp();
  const [bidderNameInput, setBidderNameInput] = useState<string>('');
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [uploadedFileObj, setUploadedFileObj] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processingStep, setProcessingStep] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Refreshing or closing mid-extraction loses the result (nothing is saved until the
  // response comes back), so warn the user before they navigate away.
  useEffect(() => {
    if (!isProcessing) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isProcessing]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const tooLarge = oversizeUploadMessage(file);
      if (tooLarge) {
        e.target.value = '';
        setUploadedFileName('');
        setUploadedFileObj(null);
        setErrorMessage(tooLarge);
        return;
      }
      setUploadedFileName(file.name);
      setUploadedFileObj(file);
      setErrorMessage('');
      if (!bidderNameInput) {
        const cleanName = file.name
          .replace(/\.[^/.]+$/, '')
          .replace(/[-_]/g, ' ')
          .replace(/\b(wo|work order|order|completion|cert|certificate)\b/gi, '')
          .trim();
        if (cleanName) {
          setBidderNameInput(cleanName.startsWith('M/s') ? cleanName : `M/s ${cleanName}`);
        }
      }
    }
  };

  const handleRunAiExtraction = async () => {
    if (!uploadedFileObj) {
      setErrorMessage('Please select or drop a Work Order / Completion PDF.');
      return;
    }

    setIsProcessing(true);
    setProcessingStep(1);
    setErrorMessage('');

    setTimeout(() => setProcessingStep(2), 500);
    setTimeout(() => setProcessingStep(3), 1000);
    setTimeout(() => setProcessingStep(4), 1500);

    try {
      let base64Data: string | undefined = undefined;
      let finalContent: string | undefined = undefined;

      if (uploadedFileObj.type === 'text/plain' || uploadedFileObj.name.endsWith('.txt')) {
        finalContent = await uploadedFileObj.text();
      } else {
        const payload = await processFileForUpload(uploadedFileObj);
        base64Data = payload.base64Data;
        finalContent = payload.textContent;
      }

      const res = await apiFetch('/api/extract-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: uploadedFileObj.name,
          fileBase64: base64Data,
          textContent: finalContent,
          mimeType: uploadedFileObj.type || 'application/pdf',
          documentType: 'Work Orders',
          pqcCriteria: {
            tenderRef: criteria?.tenderRef || ioclMetadata?.tenderNo || '',
            similarWorkDefinition: resolveSimilarNatureDefinition(ioclMetadata, criteria),
            estimatedCostCr: criteria?.estimatedCostCr,
            optionASingleWorkCr: criteria?.optionASingleWorkCr,
            optionBTwoWorksCr: criteria?.optionBTwoWorksCr,
            optionCThreeWorksCr: criteria?.optionCThreeWorksCr,
          },
        }),
      });

      const rawText = await res.text();
      if (!res.ok || rawText.trim().startsWith('<')) {
        let msg = `Extraction failed with status ${res.status}`;
        if (rawText.includes('<html') || rawText.includes('<HTML') || rawText.trim().startsWith('<!doctype')) {
          msg = 'AI extraction service is unreachable. Please verify the backend server is running.';
        } else {
          try {
            const errObj = JSON.parse(rawText);
            if (errObj?.error) msg = errObj.error;
          } catch {}
        }
        throw new Error(msg);
      }

      let json: any = {};
      try {
        json = JSON.parse(rawText);
      } catch (e: any) {
        throw new Error('Failed to parse AI extraction response.');
      }
      // A long extraction keeps the connection alive by starting a 200 response early, so a
      // failure after that point arrives as { success: false, error } rather than a status code.
      if (json?.success === false && json?.error) throw new Error(json.error);
      const d = json.data || {};

      setProcessingStep(4);

      const detectedName = json.contractorName || json.bidderName || d.bidderName || d.contractorName || json.client_name;
      const resolvedBidderName =
        bidderNameInput.trim() ||
        (detectedName && detectedName !== 'Bidder Name Not Detected in Document'
          ? (detectedName.startsWith('M/s') ? detectedName : `M/s ${detectedName}`)
          : `M/s ${uploadedFileObj.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ')}`);

      const extractedWos = extractedWorkOrdersFrom(json);
      if (extractedWos.length === 0) {
        throw new Error(noWorkOrdersMessage(json, uploadedFileObj.name));
      }
      const isArcTender = !isOneTimeJobTender(ioclMetadata?.typeOfJob, criteria?.arcAnnualizationAllowed);

      const docId = `doc-${Date.now()}`;
      const previewBlobUrl = URL.createObjectURL(uploadedFileObj);
      const docItem: DocumentItem = {
        id: docId,
        bidderId: '',
        fileName: uploadedFileObj.name,
        previewUrl: previewBlobUrl,
        fileData: base64Data,
        uploadTime: new Date().toISOString().replace('T', ' ').substring(0, 19),
        documentType: 'Work Orders',
        fileSizeBytes: uploadedFileObj.size || 0,
        pageCount: 1,
        status: 'Extracted',
        overallConfidence: 90,
        authenticityScore: 95,
        riskFlags: [],
        extractedFields: [],
      };
      uploadDocuments([docItem]);

      // Keep the original PDF (this browser + Firebase Storage) so the evidence viewer shows the real document.
      let source: StoredSourcePdf | null = null;
      try {
        source = await storeSourcePdf(uploadedFileObj, ensureActiveTenderId());
      } catch (e) {
        console.warn('Could not keep the original PDF for the evidence viewer:', e);
      }

      const allWorkOrders: IoclWorkOrderEntry[] = extractedWos.map((raw, i) => ({
        id: `iocl-wo-extracted-${Date.now()}-${i}`,
        ...mapExtractedWorkOrder(raw, {
          isArcTender,
          docName: uploadedFileObj.name,
          similarNatureDefinition: resolveSimilarNatureDefinition(ioclMetadata, criteria),
          similarNatureClause: resolveSimilarNatureClause(ioclMetadata, criteria),
          nit: ioclMetadata,
          sourceDocId: source?.sourceDocId,
          sourceDocPath: source?.sourceDocPath,
        }),
      }));

      // The same work order can appear twice in one dossier (WO copy and completion certificate).
      const split = splitDuplicateWorkOrders([], allWorkOrders);
      const workOrders =
        split.duplicates.length > 0 && window.confirm(duplicateMergePrompt(split.duplicates)) ? split.fresh : allWorkOrders;

      const newBidder: Omit<IoclBidderEvaluation, 'id' | 'slNo'> = {
        bidderName: resolvedBidderName,
        cityState: d.cityState || '',
        workOrders,
        claimedOrders: claimedOrdersFrom(json, uploadedFileObj.name),
        // Recomputed from engineer-confirmed work orders; nothing is confirmed yet.
        finalPosition: 'Query to be raised',
        pageNumber: 1,
        gstin: d.gstin || '',
        contactPerson: 'Authorized Signatory',
        rawPdfsCount: 1,
      };

      addIoclBidder(newBidder);

      addAuditLog({
        action: 'Document Ingested & Evaluated',
        bidderName: resolvedBidderName,
        documentName: uploadedFileObj.name,
        fieldName: 'TBA Sheet Extraction',
        oldValue: 'Raw File Unparsed',
        newValue: `${workOrders.length} work order(s) extracted; status pending engineer review`,
        reason: 'Automated AI extraction from uploaded PDF.',
      });

      setIsProcessing(false);
      onClose();
    } catch (err: any) {
      console.error('Ingestion error:', err);
      setIsProcessing(false);
      setErrorMessage(err.message || 'An error occurred while parsing the document. Please check the file and try again.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-300 w-full max-w-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-600/30 text-blue-400 border border-blue-500/40">
              <Cpu className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-wide">
                Upload Work Order
              </h3>
              <p className="text-xs text-slate-300">
                Extract work order details for evaluation
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 text-xs max-h-[78vh] overflow-y-auto">
          {/* Instructions Box */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3.5 flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-bold text-blue-950 text-xs mb-1">
                How It Works
              </h4>
              <p className="text-blue-900 text-[11px] leading-relaxed">
                Upload Work Orders, Completion Certificates, or LOI documents. AI extracts key details, checks PQC compliance, calculates ARC values, and adds them to the evaluation sheet.
              </p>
            </div>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Bidder Name input */}
          <div className="space-y-1.5">
            <label className="block font-bold text-slate-800 uppercase text-[11px] tracking-wider">
              Bidder / Vendor Name
            </label>
            <input
              type="text"
              value={bidderNameInput}
              onChange={(e) => setBidderNameInput(e.target.value)}
              placeholder="e.g. M/s Larsen & Petrochem Engineering (or leave blank to auto-detect)"
              className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
            />
          </div>

          {/* File Upload Drop Zone */}
          <div className="space-y-1.5">
            <label className="block font-bold text-slate-800 uppercase text-[11px] tracking-wider">
              Upload Work Order / Completion Document (PDF / TXT)
            </label>
            <label className="border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-lg p-6 flex flex-col items-center justify-center text-center cursor-pointer bg-slate-50 hover:bg-blue-50/30 transition">
              <UploadCloud className="w-9 h-9 text-blue-600 mb-2" />
              <span className="font-semibold text-slate-800 text-xs">
                Click to browse or drop bidder Work Order or Completion PDF
              </span>
              <span className="text-[11px] text-slate-500 mt-1">
                Supports PDF or TXT up to 20 MB (split larger PDFs)
              </span>
              {uploadedFileName && (
                <div className="mt-3 px-3 py-1 bg-emerald-100 text-emerald-800 font-mono text-xs rounded-full flex items-center gap-1.5">
                  <FileCheck2 className="w-3.5 h-3.5" />
                  Selected: {uploadedFileName}
                </div>
              )}
              <input
                type="file"
                accept=".pdf,application/pdf,.txt,text/plain"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>

          {/* Processing Indicator */}
          {isProcessing && (
            <div className="bg-slate-900 text-white rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
                  Analyzing Document...
                </span>
                <span className="font-mono text-amber-300">Step {processingStep} of 4</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-blue-500 h-full transition-all duration-500 ease-out"
                  style={{ width: `${(processingStep / 4) * 100}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-300">
                {processingStep === 1 && 'Extracting text and identifying issuing authority...'}
                {processingStep === 2 && 'Evaluating similar nature against refinery PQC criteria...'}
                {processingStep === 3 && 'Checking dates, duration, and calculating ARC annualization pro-rata...'}
                {processingStep === 4 && 'Generating technical evaluation sheet row with final recommendation...'}
              </p>
              {largeFileWaitHint(uploadedFileObj) && (
                <p className="text-[11px] font-semibold text-amber-300">{largeFileWaitHint(uploadedFileObj)}</p>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-200">
            <div className="text-slate-500 text-[11px]">
              Target Sheet: <strong className="text-slate-800">{criteria.tenderTitle || 'Active Tender'} {criteria.tenderRef ? `(#${criteria.tenderRef})` : ''}</strong>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isProcessing}
                className="px-4 py-2 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRunAiExtraction}
                disabled={isProcessing || !uploadedFileObj}
                className="flex items-center gap-2 px-5 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-xs transition disabled:opacity-50"
              >
                <FileText className="w-4 h-4" />
                {isProcessing ? 'Processing Document...' : 'Extract & Add to TBA Sheet'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
