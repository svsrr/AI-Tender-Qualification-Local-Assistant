import { processFileForUpload, largeFileWaitHint, oversizeUploadMessage } from '../utils/pdfExtractor';
import { apiFetch } from '../utils/api';
import { claimedOrdersFrom, mergeClaimedOrders, claimedOrdersWithoutDocuments, mergeNitCorrigendum, noWorkOrdersMessage, mapExtractedWorkOrder, extractedWorkOrdersFrom, resolveSimilarNatureClause, resolveSimilarNatureDefinition, splitDuplicateWorkOrders, duplicateMergePrompt, mergeDuplicateWorkOrder, isEngineerConfirmed } from '../utils/tbaRules';
import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import {
  FileText,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Sparkles,
  Plus,
  Trash2,
  ShieldCheck,
  Building2,
  FileCheck2,
  Calculator,
  HelpCircle,
  RefreshCw,
  FolderPlus,
  MessageSquareCode,
  Info,
  ChevronRight,
  ChevronDown,
  Database
} from 'lucide-react';
import { TenderEligibilityCriteria, IoclBidderEvaluation, IoclTenderMetadata, NitClause, isOneTimeJobTender, DocumentItem } from '../types';
import { storeSourcePdf, StoredSourcePdf } from '../services/sourcePdfStore';

const fileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

// The NIT's own conditions, taken from an /api/extract-nit response.
// A PSU NIT answers this outright - "Whether the Tendered Job is an ARC / AMC of one-year or
// more duration ... Yes, ARC Job" - and that answer decides whether work-order values are
// annualised. The contract duration is only a fallback: it is printed in the time schedule,
// pages away from the PQC, and a tender read without it used to fall back to One-time and
// silently drop annualisation for every bidder.
function typeOfJobFrom(extracted: any, current: string): string {
  if (typeof extracted?.annualisationApplicable === 'boolean') return extracted.annualisationApplicable ? 'ARC' : 'One time';
  const months = Number(extracted?.durationMonths);
  if (Number.isFinite(months) && months > 0) return months >= 12 ? 'ARC' : 'One time';
  return current;
}

function nitConditionsFrom(extracted: any, fileName = 'NIT'): Partial<IoclTenderMetadata> {
  const years = Number(extracted?.experienceWindowYears);
  return {
    nitDocuments: [{ name: fileName, kind: 'NIT', title: 'NIT', readAt: new Date().toISOString() }],
    bidSubmissionDate: String(extracted?.bidSubmissionDate || '').trim(),
    experienceWindowYears: Number.isFinite(years) && years > 0 ? years : null,
    experienceWindowText: String(extracted?.experienceWindowText || '').trim(),
    annualisationApplicable: typeof extracted?.annualisationApplicable === 'boolean' ? extracted.annualisationApplicable : null,
    valueBasisText: String(extracted?.valueBasisText || '').trim(),
    nitClauses: Array.isArray(extracted?.pqcClauses)
      ? (extracted.pqcClauses as NitClause[]).map((c) => ({ ...c, source: 'NIT' }))
      : [],
  };
}

export const TenderOnboardingWizard: React.FC = () => {
  const {
    criteria,
    updateCriteria,
    addBidder,
    ioclBidders,
    addIoclWorkOrder,
    updateIoclWorkOrder,
    updateIoclBidder,
    moveIoclBidderTo,
    deleteIoclWorkOrder,
    deleteIoclBidder,
    setActiveTab,
    addTechnicalQuery,
    clearAllDataAndStartFresh,
    loadSampleEvaluationDataset,
    addAuditLog,
    updateIoclMetadata,
    ioclMetadata,
    uploadDocuments,
    ensureActiveTenderId,
  } = useApp();

  const [activeStep, setActiveStep] = useState<number>(() => {
    return criteria.isConfigured ? 2 : 1;
  });

  useEffect(() => {
    if (!criteria.isConfigured) {
      if (activeStep !== 1) setActiveStep(1);
      setNitForm({
        tenderTitle: '',
        tenderRef: '',
        clientOrg: '',
        location: '',
        typeOfJob: 'One-Time Job (Annualization Not Applicable)',
        estimatedCostCr: 0,
        similarWorkDefinition: '',
        similarWorkClause: '',
        minAnnualTurnoverCr: 0,
        optionASingleWorkCr: 0,
        optionBTwoWorksCr: 0,
        optionCThreeWorksCr: 0,
      });
    }
  }, [criteria.isConfigured]);

  // NIT Upload & Manual Entry State
  const [nitMode, setNitMode] = useState<'upload' | 'manual' | 'paste'>('upload');
  const [nitPastedText, setNitPastedText] = useState('');
  const [isExtractingNit, setIsExtractingNit] = useState(false);
  const [nitExtractError, setNitExtractError] = useState<string | null>(null);
  const [nitRawSnippet, setNitRawSnippet] = useState<string | null>(null);
  // Conditions read from this NIT itself (experience window, annualisation, value basis, clause
  // list). They are kept as extracted and saved with the tender: the NIT decides, not the app.
  const [nitConditions, setNitConditions] = useState<Partial<IoclTenderMetadata>>(() => ({
    bidSubmissionDate: ioclMetadata?.bidSubmissionDate,
    experienceWindowYears: ioclMetadata?.experienceWindowYears,
    experienceWindowText: ioclMetadata?.experienceWindowText,
    annualisationApplicable: ioclMetadata?.annualisationApplicable,
    valueBasisText: ioclMetadata?.valueBasisText,
    nitClauses: ioclMetadata?.nitClauses || [],
    nitDocuments: ioclMetadata?.nitDocuments || [],
  }));
  const corrigendumInputRef = useRef<HTMLInputElement>(null);
  const [isReadingCorrigendum, setIsReadingCorrigendum] = useState(false);
  const [corrigendumNote, setCorrigendumNote] = useState<{ ok: boolean; text: string } | null>(null);

  // Manual NIT Form Fields
  const [nitForm, setNitForm] = useState({
    tenderTitle: criteria.tenderTitle || '',
    tenderRef: criteria.tenderRef || '',
    clientOrg: criteria.clientOrg || '',
    location: criteria.location || '',
    typeOfJob: criteria.typeOfJob || (criteria.arcAnnualizationAllowed ? 'ARC' : 'One time'),
    dateOfBidOpening: ioclMetadata.dateOfBidOpening || criteria.closingDate || '',
    estimatedCostCr: criteria.estimatedCostCr || 0,
    similarWorkDefinition: criteria.similarWorkDefinition || '',
    similarWorkClause: resolveSimilarNatureClause(ioclMetadata, criteria),
    hasApqc: typeof criteria.hasApqc === 'boolean' ? criteria.hasApqc : (Boolean(criteria.additionalPqc) && !/^(nil|n\/?a|none|not applicable)$/i.test(criteria.additionalPqc.trim())),
    additionalPqc: criteria.additionalPqc && !/^(nil|n\/?a|none|not applicable)$/i.test(criteria.additionalPqc.trim()) ? criteria.additionalPqc : '',
    minAnnualTurnoverCr: criteria.minAnnualTurnoverCr || 0,
    optionASingleWorkCr: criteria.optionASingleWorkCr || 0,
    optionBTwoWorksCr: criteria.optionBTwoWorksCr || 0,
    optionCThreeWorksCr: criteria.optionCThreeWorksCr || 0,
  });

  // Bidder Management State
  const [newBidderName, setNewBidderName] = useState('');
  const [newBidderGstin, setNewBidderGstin] = useState('');
  const [selectedBidderForUpload, setSelectedBidderForUpload] = useState<string>('');
  const [isUploadingWo, setIsUploadingWo] = useState(false);
  // Whose PDF is being read, so the wait message shows on that bidder's card.
  const [uploadingBidderId, setUploadingBidderId] = useState<string | null>(null);
  // Bidder cards whose work orders are shown. A newly added bidder opens and the others fold away,
  // so earlier bidders' work orders do not push the new one down the page.
  const [expandedBidderIds, setExpandedBidderIds] = useState<Set<string>>(() => {
    const newest = ioclBidders[ioclBidders.length - 1];
    return new Set(newest ? [newest.id] : []);
  });
  const knownBidderIdsRef = useRef<Set<string>>(new Set(ioclBidders.map((b) => b.id)));
  useEffect(() => {
    const added = ioclBidders.filter((b) => !knownBidderIdsRef.current.has(b.id));
    knownBidderIdsRef.current = new Set(ioclBidders.map((b) => b.id));
    if (added.length) setExpandedBidderIds(new Set(added.map((b) => b.id)));
  }, [ioclBidders]);
  const toggleBidderExpanded = (id: string) =>
    setExpandedBidderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [uploadStatusMsg, setUploadStatusMsg] = useState('');
  const [uploadWaitHint, setUploadWaitHint] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadWoError, setUploadWoError] = useState<string | null>(null);
  const [lastUploadedWoResult, setLastUploadedWoResult] = useState<any | null>(null);
  const [pasteModalBidderId, setPasteModalBidderId] = useState<string | null>(null);
  const [pastedWoText, setPastedWoText] = useState<string>('');
  const [pastedWoDocName, setPastedWoDocName] = useState<string>('Work_Order_Document.txt');

  // Refreshing or closing mid-extraction loses the result (nothing is saved until the
  // response comes back), so warn the user before they navigate away.
  useEffect(() => {
    if (!isExtractingNit && !isUploadingWo) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isExtractingNit, isUploadingWo]);

  const nitFileInputRef = useRef<HTMLInputElement>(null);


  // Upload and Extract Real NIT PDF
  // A corrigendum / addendum amends the NIT already read: only what it changes is replaced, in
  // the form below and in the clause list, and nothing is saved until the engineer saves.
  const handleCorrigendumUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const tooLarge = oversizeUploadMessage(file);
    if (tooLarge) {
      setCorrigendumNote({ ok: false, text: tooLarge });
      return;
    }
    setIsReadingCorrigendum(true);
    setCorrigendumNote(null);
    setUploadWaitHint(largeFileWaitHint(file));
    try {
      const response = await apiFetch('/api/extract-nit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          fileBase64: await fileAsDataUrl(file),
          mimeType: file.type || 'application/pdf',
          documentKind: 'corrigendum',
          baseTenderRef: nitForm.tenderRef,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || (json?.success === false && json?.error)) throw new Error(json?.error || `Server returned status ${response.status}`);
      const merged = mergeNitCorrigendum(nitForm, nitConditions, json.data, file.name);
      setNitForm(merged.form);
      setNitConditions(merged.conditions);
      setCorrigendumNote({
        ok: true,
        text: merged.changes.length
          ? `${file.name}: ${merged.changes.length} change(s) applied below - ${merged.changes.join('; ')}. Check them, then save the NIT criteria.`
          : `${file.name} was read, but it changes none of the PQC values or clauses. It is listed for the record; save to keep it.`,
      });
    } catch (err: any) {
      setCorrigendumNote({ ok: false, text: `Could not read ${file.name}: ${err?.message || err}` });
    } finally {
      setIsReadingCorrigendum(false);
      setUploadWaitHint('');
    }
  };

  const handleNitFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const tooLarge = oversizeUploadMessage(file);
    if (tooLarge) {
      e.target.value = '';
      setNitExtractError(tooLarge);
      return;
    }

    setIsExtractingNit(true);
    setUploadWaitHint(largeFileWaitHint(file));
    setNitExtractError(null);
    setNitRawSnippet(null);

    try {
      // The file itself always goes to the server. Sending only locally extracted text (as large
      // NITs used to) left a scanned NIT with nothing to read.
      const base64Data = await fileAsDataUrl(file);

      const response = await apiFetch('/api/extract-nit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          fileBase64: base64Data,
          mimeType: file.type || 'application/pdf',
        }),
      });

      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }

      const resJson = await response.json();
      // After a long read the response may already be 200 when an error occurs (keep-alive).
      if (resJson?.success === false && resJson?.error) throw new Error(resJson.error);
      const extracted = resJson.data;

      if (extracted) {
        const costCr = extracted.estimatedCostCr || 0;
        // Only what the NIT states: a value it does not give stays blank for the engineer to fill in.
        const single80 = extracted.optionASingleWorkCr || 0;
        const two50 = extracted.optionBTwoWorksCr || 0;
        const three40 = extracted.optionCThreeWorksCr || 0;
        const to30 = extracted.minAnnualTurnoverCr || extracted.annualTurnoverCr || 0;

        const isApqcFound = typeof extracted.hasApqc === 'boolean'
          ? extracted.hasApqc
          : Boolean(extracted.additionalPqc && !/^(nil|n\/?a|none|not applicable)$/i.test(extracted.additionalPqc.trim()));
        const apqcText = isApqcFound
          ? (extracted.additionalPqc && !/^(nil|n\/?a|none|not applicable)$/i.test(extracted.additionalPqc.trim()) ? extracted.additionalPqc : '')
          : '';

        const newForm = {
          tenderTitle: extracted.tenderTitle || extracted.workName || extracted.jobName || file.name.replace(/\.[^/.]+$/, ''),
          tenderRef: extracted.tenderRef || extracted.tenderNo || '',
          clientOrg: extracted.clientOrg || '',
          location: extracted.location || '',
          typeOfJob: typeOfJobFrom(extracted, nitForm.typeOfJob),
          dateOfBidOpening: extracted.dateOfBidOpening || extracted.closingDate || nitForm.dateOfBidOpening || '',
          estimatedCostCr: costCr,
          similarWorkDefinition: extracted.similarWorkDefinition || '',
          similarWorkClause: extracted.similarWorkClause || '',
          hasApqc: isApqcFound,
          additionalPqc: apqcText,
          minAnnualTurnoverCr: to30,
          optionASingleWorkCr: single80,
          optionBTwoWorksCr: two50,
          optionCThreeWorksCr: three40,
        };

        setNitConditions(nitConditionsFrom(extracted, file.name));
        setNitForm(newForm);

        if (extracted.rawEvidenceSnippet) {
          setNitRawSnippet(extracted.rawEvidenceSnippet);
        }
      }
    } catch (err: any) {
      console.error('Error extracting NIT:', err);
      setNitExtractError(
        'Could not auto-extract all fields from PDF. You can review or manually complete the details below.'
      );
    } finally {
      setIsExtractingNit(false);
    }
  };

  // Direct Text Ingestion / Parsing for Sample Testing
  const handleExtractNitFromText = async (customText?: string) => {
    const textToProcess = customText || nitPastedText;
    if (!textToProcess.trim()) return;

    setIsExtractingNit(true);
    setNitExtractError(null);

    try {
      const response = await apiFetch('/api/extract-nit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          textContent: textToProcess,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }

      const resJson = await response.json();
      // After a long read the response may already be 200 when an error occurs (keep-alive).
      if (resJson?.success === false && resJson?.error) throw new Error(resJson.error);
      const extracted = resJson.data;

      if (extracted) {
        const costCr = extracted.estimatedCostCr || 0;
        // Only what the NIT states: a value it does not give stays blank for the engineer to fill in.
        const single80 = extracted.optionASingleWorkCr || 0;
        const two50 = extracted.optionBTwoWorksCr || 0;
        const three40 = extracted.optionCThreeWorksCr || 0;
        const to30 = extracted.minAnnualTurnoverCr || extracted.annualTurnoverCr || 0;

        const isApqcFound = typeof extracted.hasApqc === 'boolean'
          ? extracted.hasApqc
          : Boolean(extracted.additionalPqc && !/^(nil|n\/?a|none|not applicable)$/i.test(extracted.additionalPqc.trim()));
        const apqcText = isApqcFound
          ? (extracted.additionalPqc && !/^(nil|n\/?a|none|not applicable)$/i.test(extracted.additionalPqc.trim()) ? extracted.additionalPqc : '')
          : '';

        setNitForm({
          tenderTitle: extracted.tenderTitle || extracted.workName || extracted.jobName || '',
          tenderRef: extracted.tenderRef || extracted.tenderNo || '',
          clientOrg: extracted.clientOrg || '',
          location: extracted.location || '',
          typeOfJob: typeOfJobFrom(extracted, nitForm.typeOfJob),
          dateOfBidOpening: extracted.dateOfBidOpening || extracted.closingDate || nitForm.dateOfBidOpening || '',
          estimatedCostCr: costCr,
          similarWorkDefinition: extracted.similarWorkDefinition || '',
          similarWorkClause: extracted.similarWorkClause || '',
          hasApqc: isApqcFound,
          additionalPqc: apqcText,
          minAnnualTurnoverCr: to30,
          optionASingleWorkCr: single80,
          optionBTwoWorksCr: two50,
          optionCThreeWorksCr: three40,
        });

        setNitConditions(nitConditionsFrom(extracted));
        if (extracted.rawEvidenceSnippet) {
          setNitRawSnippet(extracted.rawEvidenceSnippet);
        }
      }
    } catch (err: any) {
      console.error('Error parsing NIT text:', err);
      setNitExtractError('Failed to parse text. Please review inputs below.');
    } finally {
      setIsExtractingNit(false);
    }
  };

  // Lock and Save NIT Criteria
  const handleSaveNitCriteria = () => {
    const isOneTime = nitForm.typeOfJob === 'One time' || (nitForm.typeOfJob ? nitForm.typeOfJob.toLowerCase().includes('one time') : false);
    // Saved as entered; a value the NIT does not state stays blank rather than a % of the cost.
    const singleLacs = nitForm.optionASingleWorkCr ? (nitForm.optionASingleWorkCr * 100).toFixed(2) : '';
    const twoLacs = nitForm.optionBTwoWorksCr ? (nitForm.optionBTwoWorksCr * 100).toFixed(2) : '';
    const threeLacs = nitForm.optionCThreeWorksCr ? (nitForm.optionCThreeWorksCr * 100).toFixed(2) : '';
    const finalApqcText = nitForm.hasApqc && nitForm.additionalPqc.trim() ? nitForm.additionalPqc.trim() : 'Nil';
    const bidOpeningDate = nitForm.dateOfBidOpening.trim();

    updateCriteria({
      tenderTitle: nitForm.tenderTitle || '',
      tenderRef: nitForm.tenderRef || '',
      clientOrg: nitForm.clientOrg || '',
      location: nitForm.location || '',
      typeOfJob: isOneTime ? 'One time' : 'ARC',
      arcAnnualizationAllowed: !isOneTime,
      estimatedCostCr: nitForm.estimatedCostCr,
      optionASingleWorkCr: nitForm.optionASingleWorkCr,
      optionBTwoWorksCr: nitForm.optionBTwoWorksCr,
      optionCThreeWorksCr: nitForm.optionCThreeWorksCr,
      minAnnualTurnoverCr: nitForm.minAnnualTurnoverCr,
      similarWorkDefinition: nitForm.similarWorkDefinition,
      similarWorkClause: nitForm.similarWorkClause,
      hasApqc: nitForm.hasApqc,
      additionalPqc: finalApqcText,
      isConfigured: true,
      closingDate: bidOpeningDate,
    });

    updateIoclMetadata({
      ...nitConditions,
      tenderNo: nitForm.tenderRef || '',
      jobName: nitForm.tenderTitle || '',
      typeOfJob: isOneTime
        ? 'One-Time Job (Annualization Not Applicable)'
        : 'ARC Job (Annualization Applicable)',
      similarNatureDefinition: nitForm.similarWorkDefinition || '',
      similarNatureClause: nitForm.similarWorkClause || '',
      valueOption1Job: singleLacs,
      valueOption2Jobs: twoLacs,
      valueOption3Jobs: threeLacs,
      hasApqc: nitForm.hasApqc,
      additionalPqc: finalApqcText,
      dateOfBidOpening: bidOpeningDate,
      trDate: new Date().toLocaleDateString('en-GB').replace(/\//g, '.'),
      totalBids: ioclBidders.length,
      totalBidsText: `${ioclBidders.length} Bidders`,
    });

    addAuditLog({
      action: 'Tender NIT Locked',
      oldValue: 'Unconfigured',
      newValue: `${nitForm.tenderRef || 'Configured NIT'} (${isOneTime ? 'One time job - Col 14 NA' : 'ARC job'})`,
      reason: 'NIT parameters verified and locked by evaluation engineer.',
    });

    setActiveStep(2);
  };

  // Register New Bidder
  const handleAddBidder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBidderName.trim()) return;

    addBidder({
      bidderName: newBidderName.trim(),
      gstin: newBidderGstin.trim(),
      companyName: newBidderName.trim(),
    });

    setNewBidderName('');
    setNewBidderGstin('');
  };

  // Handle Bidder-Wise Work Order Ingestion (supports PDF File or Text Content)
  const handleUploadWorkOrderForBidder = async (e: React.ChangeEvent<HTMLInputElement>, bidderId: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    // Refused before anything is sent: an oversized request is dropped by Cloud Run and would only
    // show "Failed to fetch".
    const tooLarge = oversizeUploadMessage(file);
    if (tooLarge) {
      setUploadingBidderId(null);
      setUploadWoError(tooLarge);
      return;
    }
    await processWorkOrderIngestion({
      bidderId,
      file,
    });
  };

  const processWorkOrderIngestion = async (params: {
    bidderId: string;
    file?: File;
    textContent?: string;
    fileName?: string;
  }) => {
    const { bidderId, file, textContent } = params;
    const docName = params.fileName || file?.name || 'Work_Order_Document.pdf';

    if (!bidderId) {
      setUploadWoError('Please select a target bidder before uploading.');
      return;
    }

    setIsUploadingWo(true);
    setUploadingBidderId(bidderId);
    setExpandedBidderIds((prev) => new Set(prev).add(bidderId));
    setUploadProgress(5);
    setUploadWoError(null);
    setUploadStatusMsg(`Preparing ${docName}...`);
    setUploadWaitHint(largeFileWaitHint(file));
    setLastUploadedWoResult(null);

    try {
      const uploadedPayload = file ? await processFileForUpload(file, (pct, msg) => {
        setUploadProgress(pct);
        setUploadStatusMsg(msg);
      }) : { textContent };

      setUploadProgress(85);
      setUploadStatusMsg('The AI is reading the document...');
      let base64Data = uploadedPayload.base64Data;
      let finalContent = uploadedPayload.textContent || textContent || undefined;

      const res = await apiFetch('/api/extract-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: docName,
          fileBase64: base64Data,
          textContent: finalContent,
          mimeType: file?.type || 'application/pdf',
          documentType: 'Work Orders',
          pqcCriteria: {
            tenderRef: criteria?.tenderRef || ioclMetadata?.tenderNo || '',
            similarWorkDefinition: resolveSimilarNatureDefinition(ioclMetadata, criteria),
            estimatedCostCr: criteria.estimatedCostCr,
            optionASingleWorkCr: criteria.optionASingleWorkCr,
            optionBTwoWorksCr: criteria.optionBTwoWorksCr,
            optionCThreeWorksCr: criteria.optionCThreeWorksCr,
          },
        }),
      });

      const rawResponseText = await res.text();
      let json: any = null;

      if (!res.ok || rawResponseText.trim().startsWith('<')) {
        let errorMsg = `Server returned status ${res.status}`;
        if (rawResponseText.includes('<HTML>') || rawResponseText.includes('<html') || rawResponseText.trim().startsWith('<!doctype')) {
          errorMsg = 'AI extraction server is currently initializing or unreachable. Please ensure the backend server is running.';
        } else {
          try {
            const parsed = JSON.parse(rawResponseText);
            if (parsed?.error) errorMsg = parsed.error;
          } catch {
            // fallback
          }
        }
        throw new Error(errorMsg);
      }

      try {
        json = JSON.parse(rawResponseText);
      } catch (e: any) {
        throw new Error('Failed to parse AI extraction response: ' + (e?.message || 'Invalid format'));
      }
      // A long extraction keeps the connection alive by starting a 200 response early, so a
      // failure after that point arrives as { success: false, error } rather than a status code.
      if (json?.success === false && json?.error) throw new Error(json.error);

      // The bidder's own list of claimed orders (performance statement, CA certificate) is kept
      // on the bidder, even from a file that holds no work order itself.
      const claimedHere = claimedOrdersFrom(json, docName);
      if (claimedHere.length) {
        const current = ioclBidders.find((b) => b.id === bidderId)?.claimedOrders;
        updateIoclBidder(bidderId, { claimedOrders: mergeClaimedOrders(current, claimedHere) });
      }
      const wosToInsert = extractedWorkOrdersFrom(json);
      if (wosToInsert.length === 0 && claimedHere.length) {
        throw new Error(
          `${noWorkOrdersMessage(json, docName)} Its list of ${claimedHere.length} claimed order(s) was recorded for this bidder, and each is checked against the work orders uploaded.`
        );
      }
      if (wosToInsert.length === 0) {
        throw new Error(noWorkOrdersMessage(json, docName));
      }
      {

        let previewBlobUrl: string | undefined = undefined;
        const docId = `doc-${Date.now()}`;
        let source: StoredSourcePdf | null = null;

        if (file) {
          previewBlobUrl = URL.createObjectURL(file);
          const docItem: DocumentItem = {
            id: docId,
            bidderId,
            fileName: file.name,
            previewUrl: previewBlobUrl,
            fileData: base64Data,
            uploadTime: new Date().toISOString().replace('T', ' ').substring(0, 19),
            documentType: 'Work Orders',
            fileSizeBytes: file.size || 0,
            pageCount: 1,
            status: 'Extracted',
            overallConfidence: 90,
            authenticityScore: 90,
            riskFlags: [],
            extractedFields: [],
          };
          uploadDocuments([docItem]);

          // Keep the original PDF (this browser + Firebase Storage) so the evidence viewer shows the real document.
          try {
            source = await storeSourcePdf(file, ensureActiveTenderId());
          } catch (e) {
            console.warn('Could not keep the original PDF for the evidence viewer:', e);
          }
        }

        const isArcTender = !isOneTimeJobTender(ioclMetadata?.typeOfJob, criteria?.arcAnnualizationAllowed);
        const entries = wosToInsert.map((woItem) =>
          mapExtractedWorkOrder(woItem, {
            isArcTender,
            docName,
            similarNatureDefinition: resolveSimilarNatureDefinition(ioclMetadata, criteria),
            similarNatureClause: resolveSimilarNatureClause(ioclMetadata, criteria),
            nit: ioclMetadata,
            sourceDocId: source?.sourceDocId,
            sourceDocPath: source?.sourceDocPath,
          })
        );

        // The same work order may already be listed for this bidder (from another PDF of the bid)
        // or appear twice in this one. The engineer decides whether to merge.
        const existingRows = ioclBidders.find((b) => b.id === bidderId)?.workOrders || [];
        const split = splitDuplicateWorkOrders(existingRows, entries);
        const merge = split.duplicates.length > 0 && window.confirm(duplicateMergePrompt(split.duplicates));
        const toAdd = merge ? split.fresh : entries;
        if (merge) {
          for (const dup of split.duplicates) {
            const kept = existingRows.find((r) => r.id === dup.existingId);
            // Confirmed rows are the engineer's decision and are left exactly as they are.
            if (!kept || isEngineerConfirmed(kept)) continue;
            const { id: _id, ...keptFields } = kept;
            updateIoclWorkOrder(bidderId, kept.id, mergeDuplicateWorkOrder(keptFields, dup.row));
          }
        }

        let lastEntry: ReturnType<typeof mapExtractedWorkOrder> | null = null;
        for (const entry of toAdd) {
          addIoclWorkOrder(bidderId, entry);
          lastEntry = entry;
        }

        if (lastEntry) {
          setLastUploadedWoResult({
            fileName: docName,
            bidderName: ioclBidders.find((b) => b.id === bidderId)?.bidderName || 'Selected Bidder',
            woNumber: lastEntry.woNumberAndDate || 'Not detected',
            client: lastEntry.issuingOrg || 'Not detected',
            valLacs: lastEntry.compValueLacs ?? lastEntry.woValueLacs,
            compValueLacs: lastEntry.compValueLacs,
            compDate: lastEntry.compDate,
          });
        }
        setUploadProgress(100);
        setUploadStatusMsg(
          `Extracted ${wosToInsert.length} work order(s)` +
            (merge ? `: ${toAdd.length} new, ${split.duplicates.length} duplicate(s) merged into existing rows` : '') +
            '. Status and remarks are AI suggestions until an engineer confirms them in the evaluation sheet.'
        );
      }
    } catch (err: any) {
      console.error('Work order extraction failed:', err);
      setUploadWoError(err.message || 'Failed to parse work order');
    } finally {
      setIsUploadingWo(false);
      setUploadingBidderId(null);
    }
  };


  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Step Navigation Tabs */}
      <div className="flex items-center gap-3 bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
        <button
          type="button"
          onClick={() => setActiveStep(1)}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-xs font-bold transition-all ${
            activeStep === 1
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
          }`}
        >
          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold ${activeStep === 1 ? 'bg-white text-blue-600' : 'bg-slate-200 text-slate-700'}`}>1</span>
          Step 1: Tender NIT & Criteria Definition
        </button>
        <button
          type="button"
          onClick={() => setActiveStep(2)}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-xs font-bold transition-all ${
            activeStep === 2
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
          }`}
        >
          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold ${activeStep === 2 ? 'bg-white text-blue-600' : 'bg-slate-200 text-slate-700'}`}>2</span>
          Step 2: Bidder Dossiers & Work Orders
        </button>
      </div>

      {activeStep === 1 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Step 1: Define Tender Eligibility Criteria (NIT)</h2>
              <p className="text-xs text-slate-600">
                You can upload the official NIT PDF for automatic extraction, or type the values directly.
              </p>
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setNitMode('upload')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  nitMode === 'upload' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Upload NIT PDF
              </button>
              <button
                type="button"
                onClick={() => setNitMode('paste')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  nitMode === 'paste' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Paste NIT Text / Sample
              </button>
              <button
                type="button"
                onClick={() => setNitMode('manual')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  nitMode === 'manual' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Fill Manually
              </button>
            </div>
          </div>

          {/* Paste NIT Text */}
          {nitMode === 'paste' && (
            <div className="space-y-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-blue-600" />
                  Paste Text from Notice Inviting Tender (NIT) Document
                </div>
              </div>

              <textarea
                value={nitPastedText}
                onChange={(e) => setNitPastedText(e.target.value)}
                placeholder="Paste tender document text or PQC clauses here..."
                rows={6}
                className="w-full text-xs font-mono p-3 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={!nitPastedText.trim() || isExtractingNit}
                  onClick={() => handleExtractNitFromText()}
                  className="px-4 py-2 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm transition-all flex items-center gap-2"
                >
                  {isExtractingNit ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Parsing NIT Text...
                    </>
                  ) : (
                    <>
                      <FileCheck2 className="w-3.5 h-3.5" />
                      Extract NIT Parameters Now
                    </>
                  )}
                </button>
              </div>

              {nitExtractError && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>{nitExtractError}</span>
                </div>
              )}

              {nitRawSnippet && (
                <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-1">
                  <div className="text-xs font-bold text-slate-700 flex items-center gap-2">
                    <FileCheck2 className="w-4 h-4 text-emerald-600" />
                    Extraction Evidence:
                  </div>
                  <pre className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-200 whitespace-pre-wrap font-mono">
                    {nitRawSnippet}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* NIT Upload Dropzone */}
          {nitMode === 'upload' && (
            <div className="space-y-4">
              <div
                onClick={() => {
                  if (!isExtractingNit && !isReadingCorrigendum) nitFileInputRef.current?.click();
                }}
                className="border-2 border-dashed border-slate-300 hover:border-blue-500 bg-slate-50 hover:bg-blue-50/40 rounded-xl p-8 text-center cursor-pointer transition-all"
              >
                <input
                  ref={nitFileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={handleNitFileUpload}
                  className="hidden"
                />
                <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center mx-auto mb-3">
                  <UploadCloud className="w-6 h-6" />
                </div>
                <div className="text-sm font-bold text-slate-900">
                  {isExtractingNit ? 'Extracting NIT text with pdf-parse...' : 'Click or Drag & Drop NIT PDF here'}
                </div>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  Extracts tender reference number, estimated cost, similar nature clause, and financial thresholds without hallucination.
                </p>

                {isExtractingNit && (
                  <div className="mt-4 flex items-center justify-center gap-2 text-xs text-blue-600 font-semibold">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Analyzing document structure...
                  </div>
                )}
                {isExtractingNit && uploadWaitHint && (
                  <p className="mt-2 text-[11px] font-semibold text-amber-800 max-w-md mx-auto">{uploadWaitHint}</p>
                )}
              </div>

              {nitExtractError && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>{nitExtractError}</span>
                </div>
              )}

              {nitRawSnippet && (
                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5">
                  <div className="text-xs font-bold text-slate-700 flex items-center gap-2">
                    <FileCheck2 className="w-4 h-4 text-emerald-600" />
                    Verified Extraction Quote (From uploaded PDF):
                  </div>
                  <pre className="text-xs text-slate-600 bg-white p-3 rounded border border-slate-200 whitespace-pre-wrap font-mono">
                    {nitRawSnippet}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* NIT documents: the NIT and any corrigenda / addenda that amend it */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold text-slate-700">
                NIT documents
                <span className="ml-1 font-normal text-slate-500">
                  (a corrigendum or addendum replaces only what it changes)
                </span>
              </div>
              <input ref={corrigendumInputRef} type="file" accept=".pdf,application/pdf" onChange={handleCorrigendumUpload} className="hidden" />
              <button
                type="button"
                onClick={() => corrigendumInputRef.current?.click()}
                disabled={isExtractingNit || isReadingCorrigendum || !nitForm.tenderRef}
                title={!nitForm.tenderRef ? 'Read the NIT first' : 'Upload a corrigendum, addendum or clarification to this NIT'}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-50 text-slate-800"
              >
                {isReadingCorrigendum ? 'Reading corrigendum…' : '+ Add corrigendum / addendum'}
              </button>
            </div>
            {(nitConditions.nitDocuments || []).length === 0 ? (
              <p className="text-[11px] text-slate-500">No NIT document read yet.</p>
            ) : (
              <ul className="space-y-1 text-[11px] text-slate-700">
                {(nitConditions.nitDocuments || []).map((d, i) => (
                  <li key={`${d.name}-${i}`}>
                    <span className={`mr-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${d.kind === 'NIT' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-900'}`}>{d.kind}</span>
                    <span className="font-semibold">{d.title || d.name}</span>
                    {d.summary ? <span className="text-slate-500"> - {d.summary}</span> : null}
                  </li>
                ))}
              </ul>
            )}
            {isReadingCorrigendum && uploadWaitHint && <p className="text-[11px] text-amber-800">{uploadWaitHint}</p>}
            {corrigendumNote && (
              <p className={`text-[11px] ${corrigendumNote.ok ? 'text-emerald-800' : 'text-rose-700'}`}>{corrigendumNote.text}</p>
            )}
          </div>

          {/* Form Fields for Review / Manual Entry */}
          <div className="space-y-4 pt-2">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Verify / Edit Extracted Tender Values
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tender Reference Number *
                </label>
                <input
                  type="text"
                  value={nitForm.tenderRef}
                  onChange={(e) => setNitForm({ ...nitForm, tenderRef: e.target.value })}
                  placeholder="e.g. IOCL/PR/PQC/2024/9070"
                  className="w-full text-xs px-3 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Issuing PSU / Organization *
                </label>
                <input
                  type="text"
                  value={nitForm.clientOrg}
                  onChange={(e) => setNitForm({ ...nitForm, clientOrg: e.target.value })}
                  placeholder="e.g. Indian Oil Corporation Ltd (IOCL)"
                  className="w-full text-xs px-3 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Location / Plant Unit
                </label>
                <input
                  type="text"
                  value={nitForm.location}
                  onChange={(e) => setNitForm({ ...nitForm, location: e.target.value })}
                  placeholder="e.g. Paradip Refinery, Odisha"
                  className="w-full text-xs px-3 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center justify-between">
                  <span>Date of Bid Opening / Due Date</span>
                  <span className="text-[10px] text-slate-400 font-normal">DD.MM.YYYY</span>
                </label>
                <input
                  type="text"
                  value={nitForm.dateOfBidOpening}
                  onChange={(e) => setNitForm({ ...nitForm, dateOfBidOpening: e.target.value })}
                  placeholder="e.g. 24.11.2023 or 15.02.2024"
                  className="w-full text-xs px-3 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center justify-between">
                  <span>Last Date of Bid Submission (original)</span>
                  <span className="text-[10px] text-slate-400 font-normal">DD.MM.YYYY</span>
                </label>
                <input
                  type="text"
                  value={nitConditions.bidSubmissionDate || ''}
                  onChange={(e) => setNitConditions({ ...nitConditions, bidSubmissionDate: e.target.value })}
                  placeholder="e.g. 24.11.2023"
                  className="w-full text-xs px-3 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium font-mono"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  {nitConditions.experienceWindowYears
                    ? `The NIT's ${nitConditions.experienceWindowYears}-year experience window counts back from this date (the original date, not an extended one).`
                    : 'The experience window, if the NIT sets one, counts back from this date.'}
                </p>
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tender Work Description *
                </label>
                <input
                  type="text"
                  value={nitForm.tenderTitle}
                  onChange={(e) => setNitForm({ ...nitForm, tenderTitle: e.target.value })}
                  placeholder="e.g. Annual Maintenance Contract for Refinery Mechanical & Piping Systems"
                  className="w-full text-xs px-3 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                />
              </div>

              {/* Type of Job Selector */}
              <div className="md:col-span-2 p-3.5 bg-slate-50 border border-slate-300 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-800">
                    Type of Tender Job (ARC vs One-Time Job) *
                  </label>
                  <span className="text-[10px] text-slate-500 font-mono">PQC Rule #14 Clause</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label
                    className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-all ${
                      nitForm.typeOfJob === 'One time'
                        ? 'bg-blue-50/70 border-blue-400 text-blue-950 ring-1 ring-blue-400'
                        : 'bg-white border-slate-200 hover:bg-slate-100 text-slate-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="typeOfJob"
                      value="One time"
                      checked={nitForm.typeOfJob === 'One time'}
                      onChange={() => setNitForm({ ...nitForm, typeOfJob: 'One time' })}
                      className="mt-0.5 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="space-y-0.5 text-xs">
                      <div className="font-bold flex items-center gap-1.5">
                        <span>One-Time Job</span>
                        <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-slate-200 text-slate-800 font-bold border border-slate-300">
                          Col 14: NA
                        </span>
                      </div>
                      <p className="text-[10.5px] text-slate-500 leading-tight">
                        Do <strong>NOT</strong> invoke annualized WO value criteria. Col 14 is marked as <strong>NA</strong> and 100% full executed value applies.
                      </p>
                    </div>
                  </label>

                  <label
                    className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-all ${
                      nitForm.typeOfJob === 'ARC'
                        ? 'bg-purple-50/70 border-purple-400 text-purple-950 ring-1 ring-purple-400'
                        : 'bg-white border-slate-200 hover:bg-slate-100 text-slate-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="typeOfJob"
                      value="ARC"
                      checked={nitForm.typeOfJob === 'ARC'}
                      onChange={() => setNitForm({ ...nitForm, typeOfJob: 'ARC' })}
                      className="mt-0.5 text-purple-600 focus:ring-purple-500"
                    />
                    <div className="space-y-0.5 text-xs">
                      <div className="font-bold flex items-center gap-1.5">
                        <span>ARC / AMC Rate Contract</span>
                        <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-purple-100 text-purple-900 font-bold border border-purple-300">
                          Col 14: Annualized
                        </span>
                      </div>
                      <p className="text-[10.5px] text-slate-500 leading-tight">
                        Work experience submitted by bidder shall be annualized pro-rata based on certified execution duration.
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Min. Annual Turnover (as per NIT)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    value={nitForm.minAnnualTurnoverCr || ''}
                    onChange={(e) =>
                      setNitForm({ ...nitForm, minAnnualTurnoverCr: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                  />
                  <span className="absolute right-3 top-2 text-xs text-slate-400 font-medium">₹ Cr</span>
                </div>
              </div>
            </div>

            {/* PQC Experience Thresholds */}
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
              <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <Calculator className="w-4 h-4 text-slate-600" />
                Manual PQC Experience Options (Manual Overridable)
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-white p-3 rounded-lg border border-slate-200">
                  <label className="text-[11px] font-semibold text-slate-600">Option 1: One Work (as per NIT)</label>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-sm font-bold text-slate-800">₹</span>
                    <input
                      type="number"
                      step="0.01"
                      value={nitForm.optionASingleWorkCr}
                      onChange={(e) => setNitForm({ ...nitForm, optionASingleWorkCr: parseFloat(e.target.value) || 0 })}
                      className="w-full text-base font-bold text-blue-800 bg-transparent border-none focus:ring-0 p-0"
                    />
                    <span className="text-xs font-bold text-slate-800">Cr</span>
                  </div>
                  <div className="text-[10px] text-slate-500">Single executed order requirement</div>
                </div>

                <div className="bg-white p-3 rounded-lg border border-slate-200">
                  <label className="text-[11px] font-semibold text-slate-600">Option 2: Two Works, each (as per NIT)</label>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-sm font-bold text-slate-800">₹</span>
                    <input
                      type="number"
                      step="0.01"
                      value={nitForm.optionBTwoWorksCr}
                      onChange={(e) => setNitForm({ ...nitForm, optionBTwoWorksCr: parseFloat(e.target.value) || 0 })}
                      className="w-full text-base font-bold text-blue-800 bg-transparent border-none focus:ring-0 p-0"
                    />
                    <span className="text-xs font-bold text-slate-800">Cr</span>
                  </div>
                  <div className="text-[10px] text-slate-500">Each order executed value</div>
                </div>

                <div className="bg-white p-3 rounded-lg border border-slate-200">
                  <label className="text-[11px] font-semibold text-slate-600">Option 3: Three Works, each (as per NIT)</label>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-sm font-bold text-slate-800">₹</span>
                    <input
                      type="number"
                      step="0.01"
                      value={nitForm.optionCThreeWorksCr}
                      onChange={(e) => setNitForm({ ...nitForm, optionCThreeWorksCr: parseFloat(e.target.value) || 0 })}
                      className="w-full text-base font-bold text-blue-800 bg-transparent border-none focus:ring-0 p-0"
                    />
                    <span className="text-xs font-bold text-slate-800">Cr</span>
                  </div>
                  <div className="text-[10px] text-slate-500">Each order executed value</div>
                </div>
              </div>
            </div>

            <div>
              <div className="flex flex-wrap items-end justify-between gap-2 mb-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Definition of "Similar Work" in NIT *
                </label>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  NIT Clause No.
                  <input
                    type="text"
                    value={nitForm.similarWorkClause}
                    onChange={(e) => setNitForm({ ...nitForm, similarWorkClause: e.target.value })}
                    placeholder="e.g. 11.3"
                    title="Quoted in the remark when a work order is rejected for not being of similar nature"
                    className="w-24 text-xs px-2 py-1 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </label>
              </div>
              <textarea
                rows={3}
                value={nitForm.similarWorkDefinition}
                onChange={(e) => setNitForm({ ...nitForm, similarWorkDefinition: e.target.value })}
                placeholder="e.g. Experience of having successfully completed maintenance, turnaround or mechanical overhaul works in Petroleum Refineries / Petrochemical Plants / Gas Processing Units..."
                className="w-full text-xs px-3 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
              />
            </div>

            {/* Additional Pre-Qualification Criteria (APQC) Section */}
            <div className={`p-4 rounded-xl border transition-all ${nitForm.hasApqc ? 'bg-amber-50/70 border-amber-300 shadow-2xs' : 'bg-slate-50 border-slate-200'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                    <span>Additional Technical PQC (APQC)</span>
                    <span className="text-[10px] text-slate-500 font-normal">(Clause 12 in standard PSU NIT)</span>
                  </span>
                  {nitForm.hasApqc ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                      APQC Detected & Applicable
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-200 text-slate-600">
                      Nil / Not Applicable
                    </span>
                  )}
                </div>

                {/* Exists toggle */}
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-600 font-semibold">Does APQC Exist in NIT?</span>
                  <div className="inline-flex rounded-lg p-0.5 bg-slate-200/80 border border-slate-300">
                    <button
                      type="button"
                      onClick={() => setNitForm({ ...nitForm, hasApqc: true })}
                      className={`px-3 py-1 text-[11px] font-bold rounded-md transition-all ${
                        nitForm.hasApqc
                          ? 'bg-amber-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Yes (Applicable)
                    </button>
                    <button
                      type="button"
                      onClick={() => setNitForm({ ...nitForm, hasApqc: false })}
                      className={`px-3 py-1 text-[11px] font-bold rounded-md transition-all ${
                        !nitForm.hasApqc
                          ? 'bg-slate-700 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      No (Nil)
                    </button>
                  </div>
                </div>
              </div>

              {nitForm.hasApqc ? (
                <div className="space-y-1.5 mt-2">
                  <label className="block text-[11px] font-semibold text-slate-800">
                    APQC Requirement Description / Verbatim Clause Text *
                  </label>
                  <textarea
                    rows={3}
                    value={nitForm.additionalPqc}
                    onChange={(e) => setNitForm({ ...nitForm, additionalPqc: e.target.value })}
                    placeholder="e.g. The bidder should have experience of execution of Insulation work in any petroleum refinery/ petrochemical plant/ hydrocarbon industry in at least one shutdown."
                    className="w-full text-xs px-3 py-2 bg-white border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 font-medium text-slate-900"
                  />
                  <p className="text-[10.5px] text-amber-900">
                    This clause will automatically populate Section (iii) "Additional PQC, if any" on the official TBA evaluation sheet.
                  </p>
                </div>
              ) : (
                <p className="text-[11px] text-slate-500 italic mt-1">
                  NIT does not require additional technical criteria beyond standard PQC (recorded as "Nil" in the TBA sheet). If this tender requires shutdown/special certifications, toggle to "Yes" to provide details.
                </p>
              )}
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-slate-100">
            <button
              onClick={handleSaveNitCriteria}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm transition-all"
            >
              Lock NIT Criteria & Proceed to Bidder Ingestion
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: BIDDER-WISE WORK ORDER UPLOAD */}
      {activeStep === 2 && (
        <div className="space-y-6">
{isUploadingWo && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3 shadow-sm">
          <div className="flex items-center justify-between text-xs font-bold text-blue-900">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" />
              <span>{uploadStatusMsg}</span>
            </div>
            <span className="font-mono">{uploadProgress}%</span>
          </div>
          {uploadWaitHint && (
            <p className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {uploadWaitHint}
            </p>
          )}
          <div className="w-full bg-blue-200 rounded-full h-2 overflow-hidden">
            <div 
              className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
              style={{ width: `${Math.max(5, uploadProgress)}%` }}
            />
          </div>
        </div>
      )}

      
          {/* Add Bidder Bar */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Step 2: Add Bidders & Upload Work Orders</h2>
                <p className="text-xs text-slate-600">
                  Register participating bidders, then upload each bidder's Work Order & Completion Certificate PDFs.
                </p>
              </div>
              {ioclBidders.length > 0 && (
                <button
                  onClick={() => setActiveTab('evaluation-sheet')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-colors shadow-sm"
                >
                  Open TBA Sheet
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Quick Bidder Registration Form */}
            <form onSubmit={handleAddBidder} className="mt-4 flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[240px]">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Bidder Name / Company *
                </label>
                <input
                  type="text"
                  value={newBidderName}
                  onChange={(e) => setNewBidderName(e.target.value)}
                  placeholder="e.g. M/s Larsen & Petrochem Engineering"
                  className="w-full text-xs px-3 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                />
              </div>

              <div className="w-48">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  GSTIN (Optional)
                </label>
                <input
                  type="text"
                  value={newBidderGstin}
                  onChange={(e) => setNewBidderGstin(e.target.value)}
                  placeholder="e.g. 21AAACB1234F1Z5"
                  className="w-full text-xs px-3 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-xs uppercase"
                />
              </div>

              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Bidder
              </button>
            </form>
          </div>

          {/* Error Banner */}
          {uploadWoError && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Extraction Alert: </span>
                {uploadWoError}
              </div>
            </div>
          )}

          {/* Bidders List & Upload Stations */}
          {ioclBidders.length === 0 ? (
            <div className="bg-slate-50 border-2 border-dashed border-slate-300 rounded-xl p-8 text-center">
              <Building2 className="w-10 h-10 text-slate-400 mx-auto mb-2" />
              <div className="text-sm font-bold text-slate-700">No Bidders Registered Yet</div>
              <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                Enter the name of participating bidders above to configure their technical work order submissions.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Active Bidders ({ioclBidders.length}) & Work Order Scrutiny
                  <span className="ml-2 normal-case font-normal tracking-normal text-slate-500">latest added on top (highest Sl No. first); Sl No. is the order in the TBA sheet</span>
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setExpandedBidderIds(new Set(ioclBidders.map((b) => b.id)))}
                    className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-[11px] font-semibold text-slate-700"
                  >
                    Expand all
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpandedBidderIds(new Set())}
                    className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-[11px] font-semibold text-slate-700"
                  >
                    Collapse all
                  </button>
                </div>
              </div>

              {/* Same list as the TBA sheet: the legacy `bidders` list is empty for tenders
                  whose bidders arrived another way (the demo sample, PDF ingestion). */}
              {[...ioclBidders].reverse().map((b) => {
                const workOrders = b.workOrders || [];
                // Sl No. is the bidder's place in the TBA sheet: earliest added is 1, whatever the
                // display order here.
                const slNo = ioclBidders.findIndex((x) => x.id === b.id) + 1;
                const expanded = expandedBidderIds.has(b.id);

                return (
                  <div
                    key={b.id}
                    className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
                  >
                    <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => toggleBidderExpanded(b.id)}
                          className="p-1 rounded hover:bg-slate-200 text-slate-500"
                          title={expanded ? 'Hide this bidder\'s work orders' : 'Show this bidder\'s work orders'}
                          aria-expanded={expanded}
                        >
                          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                        <label className="flex flex-col items-center text-[9px] font-semibold text-slate-500" title="Sl No. in the TBA sheet: choose another number to move this bidder">
                          Sl No.
                          <select
                            value={slNo}
                            onChange={(e) => moveIoclBidderTo(b.id, Number(e.target.value))}
                            className="mt-0.5 w-12 rounded-lg bg-blue-100 text-blue-800 font-bold text-xs px-1 py-1 border border-blue-200"
                          >
                            {ioclBidders.map((_, i) => (
                              <option key={i} value={i + 1}>{i + 1}</option>
                            ))}
                          </select>
                        </label>
                        <div>
                          <div className="text-sm font-bold text-slate-900">{b.bidderName}</div>
                          <div className="text-[11px] text-slate-500 flex items-center gap-2">
                            <span>GSTIN: {b.gstin || 'Not Provided'}</span>
                            <span>•</span>
                            <span className="font-semibold text-blue-700">{workOrders.length} Work Order(s) Ingested</span>
                          </div>
                          {(() => {
                                    // Orders the bidder's own list claims but for which no work order was extracted.
                                    const missing = claimedOrdersWithoutDocuments(b.claimedOrders, b.workOrders || []);
                                    const listed = (b.claimedOrders || []).length;
                                    if (!listed) return null;
                                    return (
                                      <div className={`mt-1.5 rounded border px-1.5 py-1 text-[9.5px] font-normal leading-snug print:hidden ${missing.length ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
                                        {missing.length ? (
                                          <>
                                            <span className="font-bold">{missing.length} claimed order(s) without a work order:</span>{' '}
                                            {missing.map((m) => `${m.orderNo}${m.client ? ` (${m.client.split(/[,(]/)[0].trim().slice(0, 32)})` : ''}`).join('; ')}.
                                            {' '}Claimed in {[...new Set(missing.flatMap((m) => m.sources))].join(' / ')}. Raise a query, or upload the order if it was missed.
                                          </>
                                        ) : (
                                          <>All orders in the bidder's own list have a work order extracted.</>
                                        )}
                                      </div>
                                    );
                                  })()}
                          {isUploadingWo && uploadingBidderId === b.id && (
                            <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 space-y-1" role="status">
                              <div className="flex items-center gap-2 text-[11px] font-bold text-blue-900">
                                <RefreshCw className="w-3.5 h-3.5 text-blue-600 animate-spin shrink-0" />
                                <span>Please wait - reading this bidder's PDF. {uploadStatusMsg}</span>
                                <span className="ml-auto font-mono">{uploadProgress}%</span>
                              </div>
                              {uploadWaitHint && <p className="text-[10.5px] font-semibold text-amber-800">{uploadWaitHint}</p>}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Ingestion Actions for this specific bidder */}
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Hidden file input */}
                        <input
                          id={`wo-file-input-${b.id}`}
                          type="file"
                          accept=".pdf,application/pdf,.txt"
                          onChange={(e) => handleUploadWorkOrderForBidder(e, b.id)}
                          className="hidden"
                        />

                        {/* Upload PDF Button */}
                        <button
                          onClick={() => {
                            setSelectedBidderForUpload(b.id);
                            document.getElementById(`wo-file-input-${b.id}`)?.click();
                          }}
                          disabled={isUploadingWo}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-colors shadow-sm disabled:opacity-50"
                        >
                          {isUploadingWo && uploadingBidderId === b.id ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <UploadCloud className="w-3.5 h-3.5" />
                          )}
                          {isUploadingWo && uploadingBidderId === b.id ? 'Extracting… please wait' : 'Upload Work Order PDF'}
                        </button>

                        {/* Paste Text Button */}
                        <button
                          onClick={() => {
                            setPasteModalBidderId(b.id);
                            setPastedWoText('');
                            setPastedWoDocName(`${b.bidderName.replace(/\s+/g, '_')}_WO.txt`);
                          }}
                          disabled={isUploadingWo}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                        >
                          <FileText className="w-3.5 h-3.5 text-slate-500" />
                          Paste Text
                        </button>

                        {/* Delete Bidder Option */}
                        <button
                          onClick={() => {
                            if (window.confirm(`Are you sure you want to remove bidder "${b.bidderName}" and all associated work orders?`)) {
                              deleteIoclBidder(b.id);
                            }
                          }}
                          className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-100/70 rounded-lg transition-colors"
                          title="Delete Bidder"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Work Orders Extracted for this Bidder (folded away when the card is collapsed) */}
                    <div className={`p-4 ${expanded ? '' : 'hidden'}`}>
                      {workOrders.length === 0 ? (
                        <div className="text-center py-6 text-slate-400 text-xs">
                          No work orders uploaded yet for this bidder. Click "Upload Work Order PDF" or "Paste Text" to extract and evaluate credentials.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {workOrders.map((wo, wIdx) => {
                            const hasMissingValues = !wo.compDate || wo.compValueLacs === null;

                            return (
                              <div
                                key={wo.id}
                                className={`p-4 rounded-lg border text-xs transition-all ${
                                  hasMissingValues
                                    ? 'bg-amber-50/40 border-amber-200'
                                    : 'bg-slate-50 border-slate-200'
                                }`}
                              >
                                <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                                  <div className="space-y-1.5 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-bold text-slate-900">
                                        WO #{wIdx + 1}: {wo.woNumberAndDate}
                                      </span>
                                      <span
                                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                          wo.meetsSimilarNature === 'Yes'
                                            ? 'bg-emerald-100 text-emerald-800'
                                            : 'bg-amber-100 text-amber-800'
                                        }`}
                                      >
                                        Similar: {wo.meetsSimilarNature}
                                      </span>
                                      <span className="px-2 py-0.5 rounded text-[10px] bg-slate-200 text-slate-700 font-medium">
                                        Source: {wo.rawPdfDocName || 'Uploaded Document'}
                                      </span>
                                    </div>

                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] text-slate-600 pt-1">
                                      <div>
                                        <span className="text-slate-400">Client:</span>{' '}
                                        <span className="font-semibold text-slate-800">{wo.issuingOrg}</span>
                                      </div>
                                      <div>
                                        <span className="text-slate-400">Executed Value:</span>{' '}
                                           {typeof wo.compValueLacs === 'number' && !isNaN(wo.compValueLacs)
                                             ? `₹${wo.compValueLacs.toFixed(2)} Lacs`
                                             : typeof wo.valLacs === 'number' && !isNaN(wo.valLacs)
                                             ? `₹${wo.valLacs.toFixed(2)} Lacs`
                                             : typeof wo.woValueLacs === 'number' && !isNaN(wo.woValueLacs)
                                             ? `₹${wo.woValueLacs.toFixed(2)} Lacs`
                                             : '⚠️ Missing in doc'}
                                      </div>
                                      <div>
                                        <span className="text-slate-400">Start Date:</span>{' '}
                                        <span className="font-semibold text-slate-800">
                                          {wo.startDate || '⚠️ Not stated'}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-slate-400">Completion Date:</span>{' '}
                                        <span className="font-semibold text-slate-800">
                                          {wo.compDate || '⚠️ Missing in cert'}
                                        </span>
                                      </div>
                                    </div>

                                    {wo.rawPdfSnippet && (
                                      <div className="text-[11px] text-slate-500 bg-white p-2 rounded border border-slate-200 mt-1 font-mono">
                                        "{wo.rawPdfSnippet.quoteText}"
                                      </div>
                                    )}
                                  </div>

                                  {/* Actions: 1-Click TQ and Delete Work Order */}
                                  <div className="flex items-center gap-2 self-end md:self-center">
                                    {hasMissingValues && (
                                      <button
                                        onClick={() =>
                                          addTechnicalQuery({
                                            bidderName: b.bidderName,
                                            querySubject: `Clarification for Work Order ${wo.woNumberAndDate}`,
                                            queryDetails: `Work Order ${wo.woNumberAndDate} (${wo.rawPdfDocName}) has incomplete details (Start: ${wo.startDate}, Completion: ${wo.compDate}, Value: ₹${wo.compValueLacs} Lakhs). Please submit certified proof and clarification.`,
                                            status: 'Open',
                                            priority: 'High',
                                            raisedBy: 'Technical Evaluation Committee',
                                          })
                                        }
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold transition-all shadow-sm"
                                        title="Generate official technical query for missing details"
                                      >
                                        <MessageSquareCode className="w-3.5 h-3.5" />
                                        ⚡ 1-Click Technical Query
                                      </button>
                                    )}
                                    <button
                                      onClick={() => {
                                        if (window.confirm(`Delete Work Order "${wo.woNumberAndDate}" from ${b.bidderName}?`)) {
                                          deleteIoclWorkOrder(b.id, wo.id);
                                        }
                                      }}
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-slate-500 hover:text-red-700 hover:bg-red-100/70 rounded-lg text-xs font-semibold transition-colors border border-transparent hover:border-red-200"
                                      title="Delete Work Order Details"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                      <span>Delete</span>
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Paste Work Order Text Modal */}
          {pasteModalBidderId && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-blue-600" />
                    <div>
                      <h3 className="text-base font-bold text-slate-900">
                        Paste Work Order / Purchase Order Text
                      </h3>
                      <p className="text-xs text-slate-500">
                        For {ioclBidders.find((b) => b.id === pasteModalBidderId)?.bidderName}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setPasteModalBidderId(null)}
                    className="text-slate-400 hover:text-slate-700 text-sm font-bold"
                  >
                    ✕
                  </button>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Document Title / Ref Name
                    </label>
                    <input
                      type="text"
                      value={pastedWoDocName}
                      onChange={(e) => setPastedWoDocName(e.target.value)}
                      placeholder="e.g. Work_Order_70204246.txt"
                      className="w-full text-xs px-3 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Paste Raw Work Order Content *
                    </label>
                    <textarea
                      value={pastedWoText}
                      onChange={(e) => setPastedWoText(e.target.value)}
                      rows={8}
                      placeholder="Paste full text of Work Order, Scope of Work, Purchase Order, or Completion Certificate..."
                      className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                  <button
                    onClick={() => setPasteModalBidderId(null)}
                    className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      if (!pastedWoText.trim() || !pasteModalBidderId) return;
                      const bId = pasteModalBidderId;
                      setPasteModalBidderId(null);
                      await processWorkOrderIngestion({
                        bidderId: bId,
                        textContent: pastedWoText,
                        fileName: pastedWoDocName || 'Pasted_Work_Order.txt',
                      });
                    }}
                    disabled={!pastedWoText.trim() || isUploadingWo}
                    className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-sm disabled:opacity-50"
                  >
                    Extract Work Order
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Last Extracted Work Order Confirmation Card */}
          {lastUploadedWoResult && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  Successfully Ingested {lastUploadedWoResult.fileName} for {lastUploadedWoResult.bidderName}
                </div>
                <button
                  onClick={() => setActiveTab('evaluation-sheet')}
                  className="text-xs font-bold text-emerald-700 hover:underline flex items-center gap-1"
                >
                  View in Master Scrutiny Sheet →
                </button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs bg-white p-3 rounded-lg border border-emerald-200">
                <div>
                  <span className="text-slate-400">WO Reference:</span>{' '}
                  <span className="font-semibold text-slate-800">{lastUploadedWoResult.woNumber}</span>
                </div>
                <div>
                  <span className="text-slate-400">Issuing Client:</span>{' '}
                  <span className="font-semibold text-slate-800">{lastUploadedWoResult.client}</span>
                </div>
                <div>
                  <span className="text-slate-400">Executed Value:</span>{' '}
                  <span className="font-semibold text-slate-800">
                    {typeof lastUploadedWoResult.valLacs === 'number' && !isNaN(lastUploadedWoResult.valLacs)
                      ? `₹${lastUploadedWoResult.valLacs.toFixed(2)} Lacs`
                      : typeof lastUploadedWoResult.compValueLacs === 'number' && !isNaN(lastUploadedWoResult.compValueLacs)
                      ? `₹${lastUploadedWoResult.compValueLacs.toFixed(2)} Lacs`
                      : 'Missing in PDF'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">Completion Date:</span>{' '}
                  <span className="font-semibold text-slate-800">
                    {lastUploadedWoResult.compDate || 'Missing in PDF'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
