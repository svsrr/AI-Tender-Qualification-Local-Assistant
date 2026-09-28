import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { IoclBidderEvaluation, IoclWorkOrderEntry, isOneTimeJobTender } from '../types';
import { buildTbaDocument } from '../utils/tbaDocument';
import {
  bidderOutcome,
  claimedOrdersWithoutDocuments,
  completionDateText,
  durationText,
  contractDurationBetween,
  experienceWindow,
  findDuplicateWorkOrders,
  evaluateBidderWorkOrders,
  extractionSuggestionOf,
  formatContractDuration,
  finalPositionForStatus,
  isEngineerConfirmed,
  resolveAdditionalPqc,
  resolvePqcThresholdsLacs,
  resolveSimilarNatureClause,
  resolveSimilarNatureDefinition,
  suggestionWithSimilarNature,
} from '../utils/tbaRules';
import { apiFetch } from '../utils/api';
import { RawPdfViewerModal } from './RawPdfViewerModal';
import { IoclRowEditModal } from './IoclRowEditModal';
import { RawPdfIngestionModal } from './RawPdfIngestionModal';
import { OneClickQueryGeneratorModal } from './OneClickQueryGeneratorModal';
import { EditCommitteeModal } from './EditCommitteeModal';
import { EditBidderModal } from './EditBidderModal';
import {
  FileSpreadsheet,
  Download,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Building2,
  Calendar,
  Layers,
  Sparkles,
  ExternalLink,
  Eye,
  FileEdit,
  Search,
  Filter,
  RefreshCw,
  PlusCircle,
  FileText,
  FileCheck2,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ShieldCheck,
  Building,
  Table,
  Trash2,
  Users,
  Edit3,
  FolderPlus,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';

export const TechnicalEvaluationSheet: React.FC = () => {
  const {
    ioclBidders,
    ioclMetadata,
    updateIoclMetadata,
    updateCriteria,
    criteria,
    selectedBidderId,
    setSelectedBidderId,
    setActiveTab,
    activeTenderId,
    setActiveTenderId,
    deleteIoclWorkOrder,
    deleteIoclBidder,
    clearAllDataAndStartFresh,
    isSidebarCollapsed,
    toggleSidebar,
    canEditActiveTender,
    editLock,
    confirmIoclWorkOrder,
    updateIoclWorkOrder,
    tbaSummary,
  } = useApp();

  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);

  const handleNewEvaluation = () => {
    if (window.confirm('Start a new evaluation? This will clear all current session data and return you to the setup wizard.')) {
      clearAllDataAndStartFresh();
      setActiveTab('onboarding');
    }
  };

  const isOneTimeJob = isOneTimeJobTender(ioclMetadata?.typeOfJob, criteria?.arcAnnualizationAllowed);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [subcontractFilter, setSubcontractFilter] = useState<string>('All');
  const [viewMode, setViewMode] = useState<'continuous' | 'paginated'>('continuous');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [showEditCommittee, setShowEditCommittee] = useState<boolean>(false);
  const [woToDelete, setWoToDelete] = useState<{
    bidderId: string;
    woId: string;
    woName: string;
    bidderName: string;
    totalWos: number;
    isPlaceholder: boolean;
  } | null>(null);
  const [bidderToDelete, setBidderToDelete] = useState<{
    bidderId: string;
    bidderName: string;
    totalWos: number;
  } | null>(null);
  const [editingBidder, setEditingBidder] = useState<IoclBidderEvaluation | null>(null);

  // Active focus bidder if selected from Dashboard or elsewhere
  const activeFocusBidder = selectedBidderId
    ? ioclBidders.find(
        (b) =>
          b.id === selectedBidderId ||
          (b.bidderName && selectedBidderId && b.bidderName.toLowerCase() === selectedBidderId.toLowerCase())
      )
    : null;

  // Modals state
  const [selectedInspectPair, setSelectedInspectPair] = useState<{
    bidder: IoclBidderEvaluation;
    workOrder: IoclWorkOrderEntry;
    initialKey?: string;
  } | null>(null);

  const [selectedEditPair, setSelectedEditPair] = useState<{
    bidder: IoclBidderEvaluation;
    workOrder: IoclWorkOrderEntry;
  } | null>(null);

  const [showIngestionModal, setShowIngestionModal] = useState<boolean>(false);

  // 1-Click AI Technical Query Generator modal state
  const [showAiTqModal, setShowAiTqModal] = useState<boolean>(false);
  const [aiTqBidderId, setAiTqBidderId] = useState<string | undefined>(undefined);
  const [aiTqWoNumber, setAiTqWoNumber] = useState<string | undefined>(undefined);
  const [aiTqDeficiency, setAiTqDeficiency] = useState<string | undefined>(undefined);

  const printRef = useRef<HTMLDivElement>(null);
  const [showNitClauses, setShowNitClauses] = useState(false);
  // Rows already in the sheet are checked for duplicates too, not only new uploads.
  const duplicateRows = React.useMemo(() => findDuplicateWorkOrders(ioclBidders), [ioclBidders]);
  const nitClauses = ioclMetadata?.nitClauses || [];
  const nitRelaxations = nitClauses.filter((c) => c.relaxation);
  const nitWindow = experienceWindow(ioclMetadata);

  // Confirmed rows are never re-decided, but where the PQC value rule disagrees with the confirmed
  // option (e.g. an ARC row accepted as 1 WO on its completed value) the engineer is told.
  const valueRuleWarnings = React.useMemo(() => {
    const ctx = {
      thresholds: resolvePqcThresholdsLacs(ioclMetadata, criteria),
      isArcTender: !isOneTimeJobTender(ioclMetadata?.typeOfJob, criteria?.arcAnnualizationAllowed),
      similarNatureClause: resolveSimilarNatureClause(ioclMetadata, criteria),
      nit: ioclMetadata,
    };
    const all: Record<string, string> = {};
    for (const b of ioclBidders) Object.assign(all, evaluateBidderWorkOrders(b.workOrders || [], { ...ctx, claimedOrders: b.claimedOrders }).warnings);
    return all;
  }, [ioclBidders, ioclMetadata, criteria]);


  // Collapsed header: one slim action row; search/filters and the tender details block are hidden.
  const [headerCollapsed, setHeaderCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('tba_header_collapsed') === '1';
    } catch {
      return false;
    }
  });
  // A second horizontal scrollbar above the table, kept in step with the table's own one at the
  // bottom, so a long sheet can be scrolled sideways without first scrolling down to its end.
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const [tableScrollWidth, setTableScrollWidth] = useState(0);
  useEffect(() => {
    const table = tableScrollRef.current;
    const top = topScrollRef.current;
    if (!table || !top) return;
    const measure = () => setTableScrollWidth(table.scrollWidth > table.clientWidth ? table.scrollWidth : 0);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(table);
    if (table.firstElementChild) observer.observe(table.firstElementChild);
    // Assigned as onscroll rather than added as listeners: re-running this effect rebinds the
    // handlers instead of stacking another pair on the same element. Browsers report fractional
    // scroll positions, so only a real difference is copied and the two cannot bounce.
    const follow = (from: HTMLDivElement, to: HTMLDivElement) => () => {
      if (Math.abs(to.scrollLeft - from.scrollLeft) > 0.5) to.scrollLeft = from.scrollLeft;
    };
    table.onscroll = follow(table, top);
    top.onscroll = follow(top, table);
    return () => {
      observer.disconnect();
      table.onscroll = null;
      top.onscroll = null;
    };
    // Rebinds when the table is rebuilt (rows loaded from the cloud, filters, collapsed header),
    // which replaces the elements the previous run was holding.
  }, [ioclBidders, headerCollapsed, statusFilter, searchQuery]);

  const toggleHeaderCollapsed = () => {
    setHeaderCollapsed((prev) => {
      try {
        localStorage.setItem('tba_header_collapsed', prev ? '0' : '1');
      } catch {
        // Preference only; the toggle still works for this session.
      }
      return !prev;
    });
  };

  // Compute effective metadata values with seamless fallbacks
  const clientLabel = (ioclMetadata as { refineryUnit?: string })?.refineryUnit || criteria?.clientOrg || 'Technical Evaluation';
  const effectiveTenderNo = ioclMetadata?.tenderNo || criteria?.tenderRef || '-';
  const effectiveJobName = ioclMetadata?.jobName || criteria?.tenderTitle || '-';
  const effectiveSimilarNature =
    ioclMetadata?.similarNatureDefinition || criteria?.similarWorkDefinition || '-';

  const formatOption = (val?: string, cr?: number, multiplierCr?: number) => {
    if (val && val !== '0.00' && val !== '0' && typeof val === 'string' && val.trim() !== '') {
      return val.includes('Lacs') ? val : `${val} Lacs`;
    }
    if (cr && cr > 0) return `${(cr * 100).toFixed(2)} Lacs`;
    if (multiplierCr && multiplierCr > 0) return `${(multiplierCr * 100).toFixed(2)} Lacs`;
    return '-';
  };

  // The NIT's figures only: a value it does not state shows "-", never a % of the estimated cost.
  const effectiveOption1 = formatOption(ioclMetadata?.valueOption1Job, criteria?.optionASingleWorkCr, 0);
  const effectiveOption2 = formatOption(ioclMetadata?.valueOption2Jobs, criteria?.optionBTwoWorksCr, 0);
  const effectiveOption3 = formatOption(ioclMetadata?.valueOption3Jobs, criteria?.optionCThreeWorksCr, 0);
  const effectiveBidDate =
    ioclMetadata?.dateOfBidOpening ||
    criteria?.closingDate ||
    '-';
  const { text: effectiveAdditionalPqc, hasApqc: hasEffectiveApqc } = resolveAdditionalPqc(ioclMetadata, criteria);

  const [isEditingBidDate, setIsEditingBidDate] = useState(false);
  const [tempBidDate, setTempBidDate] = useState('');
  const [isEditingBidSubmission, setIsEditingBidSubmission] = useState(false);
  const [tempBidSubmission, setTempBidSubmission] = useState('');

  // Filter logic
  const filteredBidders = ioclBidders.filter((b) => {
    // Focus filter if bidder was clicked from Dashboard. A selection that matches no bidder
    // here (left over from another tender) is ignored rather than hiding every row with no
    // "show all" banner to undo it.
    if (activeFocusBidder && b.id !== activeFocusBidder.id) return false;

    // Search query
    const q = (searchQuery || '').toLowerCase();
    const matchesSearch =
      !q ||
      (b.bidderName || '').toLowerCase().includes(q) ||
      (b.cityState || '').toLowerCase().includes(q) ||
      (b.workOrders || []).some(
        (w) =>
          (w.woNumberAndDate || '').toLowerCase().includes(q) ||
          (w.issuingOrg || '').toLowerCase().includes(q) ||
          (w.jobName || '').toLowerCase().includes(q)
      );

    // Status filter
    const matchesStatus =
      statusFilter === 'All' || b.finalPosition === statusFilter;

    // Subcontract filter
    const matchesSubcontract =
      subcontractFilter === 'All' ||
      (subcontractFilter === 'Subcontract' &&
        b.workOrders.some((w) => w.isSubcontract === 'Yes')) ||
      (subcontractFilter === 'MainContract' &&
        b.workOrders.every((w) => w.isSubcontract === 'No'));

    // Paginated filter if in paginated view
    const matchesPage =
      viewMode === 'continuous' || !searchQuery
        ? viewMode === 'continuous' || b.pageNumber === currentPage
        : true;

    return matchesSearch && matchesStatus && matchesSubcontract && matchesPage;
  });

  // Cell status helpers for authentic PDF color styling
  const getRowBgClass = (status?: string | null) => {
    const s = String(status || '');
    if (s.includes('Acceptable') || s.includes('Accepted')) {
      return 'bg-[#e2f0d9] hover:bg-[#d5e8cb] text-emerald-950';
    }
    if (s.includes('Query')) {
      return 'bg-[#fff2cc] hover:bg-[#fae8b4] text-amber-950';
    }
    if (s.includes('Rejected')) {
      return 'bg-[#fce4d6] hover:bg-[#fad4c0] text-rose-950';
    }
    return 'bg-white hover:bg-slate-50 text-slate-900';
  };

  const getStatusBadge = (status?: string | null) => {
    const s = String(status || 'Pending Review');
    if (s.includes('Acceptable') || s.includes('Accepted')) {
      return (
        <span className="inline-flex items-center gap-1 font-bold text-emerald-800 text-[11px]">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          {s}
        </span>
      );
    }
    if (s.includes('Query')) {
      return (
        <span className="inline-flex items-center gap-1 font-bold text-amber-800 text-[11px]">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          {s}
        </span>
      );
    }
    if (s.includes('Rejected')) {
      return (
        <span className="inline-flex items-center gap-1 font-bold text-rose-800 text-[11px]">
          <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
          {s}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 font-bold text-slate-600 text-[11px]">
        {s}
      </span>
    );
  };

  const pendingReviewCount = ioclBidders.reduce(
    (n, b) => n + (b.workOrders || []).filter((wo) => !isEngineerConfirmed(wo)).length,
    0
  );

  // Column 5 is re-judged against the NIT definition shown in the header. Engineer-confirmed rows
  // are never changed; unconfirmed rows get a fresh verdict and a matching status suggestion.
  const similarDefinition = resolveSimilarNatureDefinition(ioclMetadata, criteria);
  const similarClause = resolveSimilarNatureClause(ioclMetadata, criteria);
  const [similarCheck, setSimilarCheck] = useState<{ running: boolean; message: string | null }>({ running: false, message: null });
  const staleSimilarCount = ioclBidders.reduce(
    (n, b) =>
      n + (b.workOrders || []).filter((wo) => !isEngineerConfirmed(wo) && wo.jobName && (wo.similarNatureDefinition || '') !== similarDefinition).length,
    0
  );

  const recheckSimilarNature = async () => {
    if (!similarDefinition) {
      setSimilarCheck({ running: false, message: 'Set the NIT similar-nature definition in the header first.' });
      return;
    }
    const rows = ioclBidders.flatMap((b) =>
      (b.workOrders || []).filter((wo) => !isEngineerConfirmed(wo) && wo.jobName).map((wo) => ({ bidderId: b.id, wo }))
    );
    if (rows.length === 0) {
      setSimilarCheck({ running: false, message: 'Every work order is already confirmed by an engineer; nothing to re-check.' });
      return;
    }
    setSimilarCheck({ running: true, message: `Checking ${rows.length} work order(s) against the NIT definition…` });
    const counts = { Yes: 0, No: 0, 'To verify': 0 } as Record<string, number>;
    try {
      for (let i = 0; i < rows.length; i += 40) {
        const chunk = rows.slice(i, i + 40);
        const res = await apiFetch('/api/assess-similar-nature', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            definition: similarDefinition,
            workOrders: chunk.map(({ wo }) => ({ id: wo.id, jobName: wo.jobName, issuingOrg: wo.issuingOrg })),
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || `Server returned ${res.status}`);
        for (const result of json.results || []) {
          const row = chunk.find(({ wo }) => wo.id === result.id);
          if (!row) continue;
          const base = extractionSuggestionOf(row.wo);
          const suggestion = suggestionWithSimilarNature(base, result.verdict, result.reason, {
            woNumberAndDate: row.wo.woNumberAndDate,
            clause: similarClause,
          });
          counts[result.verdict] = (counts[result.verdict] || 0) + 1;
          updateIoclWorkOrder(row.bidderId, row.wo.id, {
            meetsSimilarNature: result.verdict,
            similarNatureReason: result.reason,
            similarNatureConfidence: result.confidence,
            similarNatureDefinition: similarDefinition,
            aiExtractionStatus: base.status,
            aiExtractionRemarks: base.remarks,
            woStatus: suggestion.status,
            finalPosition: finalPositionForStatus(suggestion.status),
            remarks: suggestion.remarks,
            aiSuggestedStatus: suggestion.status,
            aiSuggestedRemarks: suggestion.remarks,
          });
        }
      }
      setSimilarCheck({
        running: false,
        message: `Checked ${rows.length} work order(s): ${counts.Yes} similar, ${counts.No} not similar, ${counts['To verify']} to verify by you.`,
      });
    } catch (err: any) {
      setSimilarCheck({ running: false, message: `Similar nature check failed: ${err?.message || err}` });
    }
  };

  // Excel and PDF are generated from the same TBA document model, so both files carry the
  // same figures. Unconfirmed rows are exported as "Pending engineer review" with a DRAFT mark.
  const handleExport = async (kind: 'excel' | 'pdf') => {
    if (
      pendingReviewCount > 0 &&
      !window.confirm(
        `${pendingReviewCount} work order(s) are still AI suggestions awaiting engineer confirmation.\n\n` +
          'They will be exported as "Pending engineer review" and the document will be marked DRAFT. Continue?'
      )
    ) {
      return;
    }
    setExporting(kind);
    try {
      const doc = buildTbaDocument(ioclBidders, ioclMetadata, criteria, !isOneTimeJob);
      const safeTender = (doc.tenderNo || 'Tender').replace(/[^A-Za-z0-9_-]+/g, '_');
      const stamp = new Date().toISOString().slice(0, 10);
      const suffix = doc.pendingReviewRows > 0 ? '_DRAFT' : '';
      if (kind === 'excel') {
        const { downloadTbaExcel } = await import('../utils/tbaExcel');
        await downloadTbaExcel(doc, `TBA_${safeTender}_${stamp}${suffix}.xlsx`);
      } else {
        const [{ buildTbaPdf }, { triggerDownload }] = await Promise.all([import('../utils/tbaPdf'), import('../utils/tbaExcel')]);
        const bytes = await buildTbaPdf(doc);
        triggerDownload(new Blob([bytes], { type: 'application/pdf' }), `TBA_${safeTender}_${stamp}${suffix}.pdf`);
      }
    } catch (err: any) {
      console.error('TBA export failed:', err);
      alert(`Could not generate the ${kind === 'excel' ? 'Excel' : 'PDF'} file: ${err?.message || err}`);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="flex-1 bg-slate-50 flex flex-col h-full overflow-y-auto">
      {!canEditActiveTender && editLock && (
        <div className="bg-amber-50 border-b border-amber-300 px-6 py-2 flex items-center gap-2 text-xs font-semibold text-amber-900 sticky top-0 z-40">
          <Eye className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            View-only: {editLock.name} is currently editing this tender. Your changes here won't be saved to the cloud until you claim edit mode (top-right).
          </span>
        </div>
      )}
      {/* Top toolbar: one compact row of actions. Search/filters and the tender details block collapse. */}
      <div className="bg-white border-b border-slate-200 px-4 py-2 sticky top-0 z-30 shadow-2xs">
        <div className="flex flex-wrap lg:flex-nowrap items-center gap-2">
          <button
            type="button"
            onClick={toggleSidebar}
            className="p-1.5 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 hover:border-slate-400 text-slate-700 hover:text-blue-700 transition-colors shrink-0 focus-visible:ring-2 focus-visible:ring-blue-500"
            title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar for more space'}
          >
            {isSidebarCollapsed ? <PanelLeftOpen className="w-4 h-4 text-blue-600" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>

          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span
              className="hidden xl:inline px-2.5 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase bg-blue-900 text-white font-mono truncate max-w-[150px] shrink-0"
              title={clientLabel}
            >
              {clientLabel}
            </span>
            <h1 className="text-sm font-bold text-slate-900 whitespace-nowrap">TBA Sheet</h1>
            <div
              className="hidden md:flex items-center min-w-0 rounded-lg border border-slate-200 px-2.5 py-0.5 bg-slate-50 text-[11px] gap-1.5 overflow-hidden"
              title={`Tender ${effectiveTenderNo}${effectiveJobName && effectiveJobName !== '-' ? ` — ${effectiveJobName}` : ''}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
              <span className="font-bold font-mono text-slate-800 whitespace-nowrap">{effectiveTenderNo}</span>
              {effectiveJobName && effectiveJobName !== '-' && <span className="text-slate-500 truncate">{effectiveJobName}</span>}
            </div>
            {headerCollapsed && (searchQuery.trim() || statusFilter !== 'All') && (
              <button
                onClick={toggleHeaderCollapsed}
                className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-bold whitespace-nowrap"
                title="Rows are filtered; expand the header to change the filter"
              >
                Filter active
              </button>
            )}
          </div>

          <div className="flex flex-wrap lg:flex-nowrap items-center gap-1.5 shrink-0">
            {/* Technical Query Generator */}
            <button
              onClick={() => {
                const flagged = ioclBidders.find((b) => b.finalPosition === 'Query to be raised');
                const firstWo = flagged?.workOrders?.[0]?.woNumberAndDate?.split(' ')[0] || '';
                setAiTqBidderId(flagged?.id);
                setAiTqWoNumber(firstWo);
                setAiTqDeficiency(flagged?.workOrders?.[0]?.remarks);
                setShowAiTqModal(true);
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 active:scale-[0.98] text-amber-950 text-xs font-bold shadow-xs transition-all focus-visible:ring-2 focus-visible:ring-amber-500"
              title="Draft a technical query"
            >
              <FileText className="w-4 h-4 text-amber-950" />
              <span>Draft TQ</span>
            </button>

            {/* New Evaluation / Upload NIT */}
            <button
              onClick={handleNewEvaluation}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white text-xs font-bold transition-all shadow-sm focus-visible:ring-2 focus-visible:ring-blue-400"
              title="Start a new evaluation"
            >
              <FolderPlus className="w-4 h-4 text-white" />
              <span className="hidden 2xl:inline">New Evaluation</span>
            </button>

            {pendingReviewCount > 0 && (
              <span
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-100 border border-slate-300 text-slate-700 text-xs font-semibold whitespace-nowrap"
                title={`${pendingReviewCount} row(s) are AI suggestions not yet confirmed by an engineer`}
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                {pendingReviewCount}
                <span className="hidden 2xl:inline">pending review</span>
              </span>
            )}

            {/* Re-judge column 5 for unconfirmed rows against the NIT definition in the header */}
            <button
              onClick={recheckSimilarNature}
              disabled={similarCheck.running || !canEditActiveTender}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition disabled:opacity-60 ${
                staleSimilarCount > 0 ? 'border-amber-400 bg-amber-50 hover:bg-amber-100 text-amber-900' : 'border-slate-300 hover:bg-slate-50 text-slate-700'
              }`}
              title={
                canEditActiveTender
                  ? 'Judge each unconfirmed job name against the NIT similar-nature definition (confirmed rows are not changed)'
                  : 'Claim edit mode to re-check similar nature'
              }
            >
              {similarCheck.running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-amber-600" />}
              <span className="hidden xl:inline">Similar nature</span>
              {staleSimilarCount > 0 && !similarCheck.running && (
                <span className="px-1.5 rounded-full bg-amber-500 text-white text-[10px] font-bold">{staleSimilarCount}</span>
              )}
            </button>

            {/* Download TBA in the committee's Excel template */}
            <button
              onClick={() => handleExport('excel')}
              disabled={exporting !== null}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-60 text-slate-700 text-xs font-medium transition"
              title="Download the Technical Bid Analysis as an Excel workbook (committee template)"
            >
              {exporting === 'excel' ? <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" /> : <FileSpreadsheet className="w-4 h-4 text-emerald-600" />}
              Excel
            </button>

            {/* Download TBA as landscape A4 PDF */}
            <button
              onClick={() => handleExport('pdf')}
              disabled={exporting !== null}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-60 text-slate-700 text-xs font-medium transition"
              title="Download the Technical Bid Analysis as a landscape A4 PDF"
            >
              {exporting === 'pdf' ? <RefreshCw className="w-4 h-4 animate-spin text-rose-600" /> : <Download className="w-4 h-4 text-rose-600" />}
              PDF
            </button>

            <button
              onClick={toggleHeaderCollapsed}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-600 text-xs font-medium transition"
              title={headerCollapsed ? 'Show search, filters and tender details' : 'Hide search, filters and tender details for more space'}
            >
              {headerCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              <span className="hidden 2xl:inline">{headerCollapsed ? 'Expand' : 'Collapse'}</span>
            </button>
          </div>
        </div>

        {similarCheck.message && (
          <div className="mt-2 flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-900">
            <span className="flex items-center gap-1.5">
              {similarCheck.running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {similarCheck.message}
            </span>
            {!similarCheck.running && (
              <button onClick={() => setSimilarCheck({ running: false, message: null })} className="text-amber-700 hover:text-amber-900 font-bold">
                Dismiss
              </button>
            )}
          </div>
        )}

        {/* Executive Focus Mode Banner */}
        {activeFocusBidder && (
          <div className="mt-2 px-3 py-2 bg-blue-50/90 border border-blue-200 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-600 animate-pulse shrink-0"></span>
              <div>
                <span className="font-bold text-blue-950">
                  Focused Review: Bidder #{activeFocusBidder.slNo} — {activeFocusBidder.bidderName}
                </span>
                <span className="text-slate-600 ml-2">
                  ({activeFocusBidder.cityState} • {activeFocusBidder.workOrders.length} Work Order{activeFocusBidder.workOrders.length > 1 ? 's' : ''})
                </span>
              </div>
              <span className="ml-2 px-2 py-0.5 rounded text-[11px] font-bold bg-white border border-blue-200 text-blue-900">
                {activeFocusBidder.finalPosition}
              </span>
            </div>
            <button
              onClick={() => setSelectedBidderId('')}
              className="px-3 py-1 bg-white hover:bg-blue-100 text-blue-800 border border-blue-300 rounded-lg font-medium transition text-xs flex items-center gap-1 shadow-xs"
            >
              <span>✕ Show All {ioclBidders.length} Bidders</span>
            </button>
          </div>
        )}

        {/* Filter & Search Bar */}
        {!headerCollapsed && (
        <div className="flex flex-wrap items-center justify-between gap-3 mt-2 pt-2 border-t border-slate-100 text-xs">
          {/* Search */}
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search by Bidder Name, WO No, Org, or City..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 rounded-lg border border-slate-300 bg-slate-50 text-xs focus:bg-white focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
            />
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-2 overflow-x-auto py-1">
            <span className="text-slate-500 font-medium">Status:</span>
            {[
              { id: 'All', label: `All (${ioclBidders.length})` },
              { id: 'Technically Acceptable', label: `Acceptable (${ioclMetadata.technicallyAcceptable})`, color: 'bg-[#e2f0d9] text-emerald-900 font-bold' },
              { id: 'Query to be raised', label: `Queries (${ioclMetadata.queryToBeRaisedTo})`, color: 'bg-[#fff2cc] text-amber-900 font-bold' },
              { id: 'Technically Rejected', label: `Rejected (${ioclMetadata.technicallyNotAcceptable})`, color: 'bg-[#fce4d6] text-rose-900 font-bold' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition whitespace-nowrap ${
                  statusFilter === tab.id
                    ? tab.color || 'bg-slate-900 text-white'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* View Mode Toggle: Continuous vs Paginated (6 Pages) */}
          <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
            <div className="flex rounded-lg border border-slate-300 overflow-hidden text-xs">
              <button
                onClick={() => setViewMode('continuous')}
                className={`px-3 py-1 font-medium transition ${
                  viewMode === 'continuous'
                    ? 'bg-slate-800 text-white'
                    : 'bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                Continuous (All)
              </button>
              <button
                onClick={() => setViewMode('paginated')}
                className={`px-3 py-1 font-medium transition ${
                  viewMode === 'paginated'
                    ? 'bg-slate-800 text-white'
                    : 'bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                Page-by-Page
              </button>
            </div>

            {viewMode === 'paginated' && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-1 rounded hover:bg-slate-200 disabled:opacity-30"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="font-mono text-xs text-slate-700 font-semibold px-1">
                  Page {currentPage} of 6
                </span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(6, p + 1))}
                  disabled={currentPage === 6}
                  className="p-1 rounded hover:bg-slate-200 disabled:opacity-30"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
        )}
      </div>

      {/* Main Sheet Container */}
      <div ref={printRef} className={`p-4 md:p-6 max-w-[1900px] mx-auto w-full ${headerCollapsed ? 'space-y-3 pt-3 md:pt-3' : 'space-y-6'}`}>
        {headerCollapsed ? (
          <button
            onClick={toggleHeaderCollapsed}
            className="w-full flex items-center justify-between gap-3 px-4 py-1.5 rounded-lg border border-slate-300 bg-[#d9e1f2]/60 hover:bg-[#d9e1f2] text-[11px] text-slate-700 transition"
            title="Show tender details, PQC and bid statistics"
          >
            <span className="truncate">
              <span className="font-bold uppercase tracking-wide">Tender details & PQC hidden</span>
              <span className="ml-2 text-slate-500">
                Bids {ioclBidders.length} · Acceptable {ioclMetadata.technicallyAcceptable} · Rejected {ioclMetadata.technicallyNotAcceptable} · Query{' '}
                {ioclBidders.filter((b) => b.finalPosition === 'Query to be raised').length}
              </span>
            </span>
            <span className="flex items-center gap-1 font-semibold text-blue-700 shrink-0">
              Show <ChevronDown className="w-3.5 h-3.5" />
            </span>
          </button>
        ) : (
        /* Authentic IOCL Header Sub-table (Matching the top of the PDF) */
        <div className="bg-white rounded-lg border border-slate-300 shadow-xs overflow-hidden text-xs">
          {/* Top Banner Title */}
          <div className="bg-[#d9e1f2] border-b border-slate-300 px-4 py-2.5 text-center font-bold text-slate-900 tracking-wider text-xs md:text-sm uppercase">
            TECHNICAL BID ANALYSIS — EVALUATION & RECOMMENDATION
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-300">
            {/* Left Block: Tender info & PQC as per NIT (8 cols) */}
            <div className="lg:col-span-8 p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2 pb-2 border-b border-slate-200">
                <div className="md:col-span-1">
                  <span className="font-bold text-slate-800 block">Tender No.:</span>
                  <span className="font-mono font-bold text-blue-900 text-sm">{effectiveTenderNo}</span>
                </div>
                <div className="md:col-span-3">
                  <span className="font-bold text-slate-800 block">Name of Job:</span>
                  <span className="text-slate-800 font-semibold">{effectiveJobName}</span>
                </div>
              </div>

              <div>
                <span className="font-bold text-slate-900 block mb-1 underline">
                  PQC as per NIT:
                </span>
                <div className="space-y-1.5 pl-2 text-[11px] text-slate-800">
                  <p>
                    <strong>(i) Similar nature definition:</strong> {effectiveSimilarNature}
                  </p>
                  <p>
                    <strong>(ii) Similar nature of WO and completed value INCL GST:</strong>
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pl-4 py-1 font-mono text-[11px]">
                    <div className="p-1.5 rounded bg-slate-50 border border-slate-200">
                      <span className="text-slate-500 block text-[10px]">(a) 1 job:</span>
                      <strong className="text-slate-900">{effectiveOption1}</strong>
                    </div>
                    <div className="p-1.5 rounded bg-slate-50 border border-slate-200">
                      <span className="text-slate-500 block text-[10px]">(b) 2 jobs:</span>
                      <strong className="text-slate-900">{effectiveOption2}</strong>
                    </div>
                    <div className="p-1.5 rounded bg-slate-50 border border-slate-200">
                      <span className="text-slate-500 block text-[10px]">(c) 3 jobs:</span>
                      <strong className="text-slate-900">{effectiveOption3}</strong>
                    </div>
                  </div>
                  <p className="flex items-start gap-1 flex-wrap">
                    <strong>(iii) Additional PQC, if any:</strong>{' '}
                    <span className={hasEffectiveApqc ? 'text-amber-950 font-semibold' : 'text-slate-700'}>
                      {effectiveAdditionalPqc}
                    </span>
                    {hasEffectiveApqc ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                        APQC Applicable
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-500 border border-slate-200">
                        Nil
                      </span>
                    )}
                  </p>
                  {/* Unconfirmed rows follow every edit of a tender field at once; confirmed rows are the
                      engineer's and are only flagged. This says how many need a second look. */}
                  {Object.keys(valueRuleWarnings).length > 0 && (
                    <div className="rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] font-semibold text-rose-800 print:hidden">
                      {Object.keys(valueRuleWarnings).length} confirmed work order(s) no longer agree with the PQC / NIT rules (see the red notes in column 17). Unconfirmed rows have been re-checked automatically.
                    </div>
                  )}

                  {/* What the NIT itself says, as read from the tender document. The NIT decides:
                      where it is silent or allows a relaxation, the row remarks say so. */}
                  {(nitClauses.length > 0 || nitWindow || ioclMetadata?.valueBasisText) && (
                    <div className="rounded border border-slate-200 bg-slate-50/70 print:hidden">
                      <button
                        type="button"
                        onClick={() => setShowNitClauses((v) => !v)}
                        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        <span className="flex items-center gap-2">
                          Conditions read from this NIT
                          <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[10px] font-bold">{nitClauses.length} clauses</span>
                          {nitRelaxations.length > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold">
                              {nitRelaxations.length} with relaxations
                            </span>
                          )}
                        </span>
                        {showNitClauses ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                      {showNitClauses && (
                        <div className="px-2 pb-2 space-y-1.5 text-[11px] text-slate-700">
                          {!nitWindow && (ioclMetadata?.experienceWindowYears ?? 0) > 0 && (
                            <p className="text-amber-800">
                              <strong>Experience window:</strong> the NIT allows work completed within {ioclMetadata?.experienceWindowYears} years,
                              but gives no bid submission date ("as per GeM schedule"). Fill in the original last date of bid submission below to apply it.
                            </p>
                          )}
                          {nitWindow && (
                            <p>
                              <strong>Experience window:</strong> {nitWindow.years} years, {nitWindow.fromText} to {nitWindow.toText} (counted back from the {nitWindow.source}). Work orders completed outside it are rejected.
                            </p>
                          )}
                          {ioclMetadata?.valueBasisText && (
                            <p><strong>Value counted:</strong> {ioclMetadata.valueBasisText}</p>
                          )}
                          {nitClauses.length === 0 ? (
                            <p className="text-amber-800">
                              No clauses were read from this NIT, so every decision uses the app's standard rules. Upload the NIT in Tender Setup to have its clauses read.
                            </p>
                          ) : (
                            <ul className="space-y-1">
                              {nitClauses.map((c, i) => (
                                <li key={`${c.no}-${i}`} className="flex gap-2">
                                  <span className="font-mono font-bold text-slate-900 shrink-0">{c.no || '-'}</span>
                                  <span>
                                    <span className="font-semibold">{c.title}</span>
                                    {c.source && c.source !== 'NIT' ? (
                                      <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-bold">as amended by {c.source}</span>
                                    ) : null}
                                    {c.requirement ? <span className="text-slate-600"> — {c.requirement}</span> : null}
                                    {c.relaxation ? (
                                      <span className="block text-amber-800">Relaxation: {c.relaxation} (the app does not apply relaxations by itself)</span>
                                    ) : null}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <strong>Date of Bid opening:</strong>
                    {isEditingBidDate ? (
                      <div className="inline-flex items-center gap-1">
                        <input
                          type="text"
                          value={tempBidDate}
                          onChange={(e) => setTempBidDate(e.target.value)}
                          placeholder="DD.MM.YYYY"
                          className="text-xs px-2 py-0.5 bg-white border border-blue-400 rounded focus:outline-none font-mono font-semibold text-slate-900 w-28"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const val = tempBidDate.trim();
                            updateIoclMetadata({ dateOfBidOpening: val });
                            updateCriteria({ closingDate: val });
                            setIsEditingBidDate(false);
                          }}
                          className="px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-[10.5px] font-semibold"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsEditingBidDate(false)}
                          className="px-2 py-0.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded text-[10.5px]"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="font-mono font-semibold text-slate-900">{effectiveBidDate}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setTempBidDate(effectiveBidDate === '-' ? '' : effectiveBidDate);
                            setIsEditingBidDate(true);
                          }}
                          title="Click to edit Bid Opening Date"
                          className="text-slate-400 hover:text-blue-600 p-0.5 rounded transition-colors inline-flex items-center gap-0.5 text-[10.5px]"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span className="text-[10px] text-slate-400 hover:underline">Edit</span>
                        </button>
                      </span>
                    )}
                  </div>
                  {/* The experience window counts back from the ORIGINAL last date of bid submission, which a
                      NIT on GeM often leaves to the portal schedule: the engineer enters it here. */}
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <strong>Last date of bid submission (original):</strong>
                    {isEditingBidSubmission ? (
                      <div className="inline-flex items-center gap-1">
                        <input
                          type="text"
                          value={tempBidSubmission}
                          onChange={(e) => setTempBidSubmission(e.target.value)}
                          placeholder="DD.MM.YYYY"
                          className="text-xs px-2 py-0.5 bg-white border border-blue-400 rounded focus:outline-none font-mono font-semibold text-slate-900 w-28"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => {
                            updateIoclMetadata({ bidSubmissionDate: tempBidSubmission.trim() });
                            setIsEditingBidSubmission(false);
                          }}
                          className="px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-[10.5px] font-semibold"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsEditingBidSubmission(false)}
                          className="px-2 py-0.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded text-[10.5px]"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="font-mono font-semibold text-slate-900">{ioclMetadata?.bidSubmissionDate || '-'}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setTempBidSubmission(ioclMetadata?.bidSubmissionDate || '');
                            setIsEditingBidSubmission(true);
                          }}
                          title="Original last date of bid submission: the experience window counts back from it"
                          className="text-slate-400 hover:text-blue-600 p-0.5 rounded transition-colors inline-flex items-center gap-0.5 text-[10.5px]"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span className="text-[10px] text-slate-400 hover:underline">Edit</span>
                        </button>
                        {nitWindow ? (
                          <span className="text-[10.5px] text-slate-600">
                            {nitWindow.years}-year window: {nitWindow.fromText} to {nitWindow.toText}
                            {nitWindow.source !== 'last date of bid submission' ? ' (from the bid opening date until this is filled in)' : ''}
                          </span>
                        ) : null}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Right Block: Job Type & Statistics (4 cols) */}
            <div className="lg:col-span-4 p-4 space-y-3 bg-slate-50/50 flex flex-col justify-between">
              <div className="space-y-2 text-[11px]">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800">Type of Job (ARC/ One time):</span>
                    <button
                      type="button"
                      onClick={() => {
                        const newIsOneTime = !isOneTimeJob;
                        updateIoclMetadata({
                          typeOfJob: newIsOneTime
                            ? 'One-Time Job (Annualization Not Applicable)'
                            : 'ARC Job (Annualization Applicable)',
                        });
                        updateCriteria({
                          arcAnnualizationAllowed: !newIsOneTime,
                          typeOfJob: newIsOneTime ? 'One time' : 'ARC',
                        });
                      }}
                      className="text-[10px] text-blue-700 hover:text-blue-900 underline font-semibold cursor-pointer"
                      title="Toggle between One-time Job (Col 14 NA) and ARC Job (Annualized)"
                    >
                      {isOneTimeJob ? 'Switch to ARC' : 'Switch to One-Time'}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                    <span className="font-semibold text-purple-900">{ioclMetadata.typeOfJob}</span>
                    {isOneTimeJob ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 text-slate-800 font-bold border border-slate-300">
                        One-Time Job (Annualization: NA)
                      </span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold border border-amber-300">
                        ARC (Annualized)
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <span className="font-bold text-slate-800 block">TR date:</span>
                  <span className="font-mono font-semibold text-slate-900">{ioclMetadata.trDate}</span>
                </div>
              </div>

              {/* Statistics Table matching PDF */}
              <div className="border border-slate-300 rounded overflow-hidden text-xs">
                <div className="bg-slate-200 font-bold px-3 py-1.5 border-b border-slate-300 flex justify-between">
                  <span>Total No. of Bids:</span>
                  <span className="font-mono text-slate-900">{ioclMetadata.totalBidsText}</span>
                </div>
                <div className="p-2 space-y-1 text-[11px]">
                  <div className="flex justify-between items-center bg-[#e2f0d9] px-2 py-1 rounded border border-emerald-200">
                    <span className="font-semibold text-emerald-950">Technically Acceptable:</span>
                    <strong className="font-mono text-emerald-900 text-xs">
                      {ioclBidders.filter((b) => b.finalPosition === 'Technically Acceptable').length}
                    </strong>
                  </div>
                  <div className="flex justify-between items-center bg-[#fce4d6] px-2 py-1 rounded border border-rose-200">
                    <span className="font-semibold text-rose-950">Technically not acceptable:</span>
                    <strong className="font-mono text-rose-900 text-xs">
                      {ioclBidders.filter((b) => b.finalPosition === 'Technically Rejected').length}
                    </strong>
                  </div>
                  <div className="flex justify-between items-center bg-[#fff2cc] px-2 py-1 rounded border border-amber-200">
                    <span className="font-semibold text-amber-950">Query to be raised to:</span>
                    <strong className="font-mono text-amber-900 text-xs">
                      {ioclBidders.filter((b) => b.finalPosition === 'Query to be raised').length}
                    </strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        )}

        {/* 18-COLUMN TABULAR WORKSHEET */}
        <div className="bg-white rounded-lg border border-slate-300 shadow-sm overflow-hidden">
          <div ref={topScrollRef} className={`overflow-x-auto print:hidden border-b border-slate-200 ${tableScrollWidth ? '' : 'hidden'}`} aria-hidden="true">
            <div style={{ width: tableScrollWidth, height: 1 }} />
          </div>
          <div ref={tableScrollRef} className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[11px] font-sans">
              {/* Table Header: 18 Columns */}
              <thead>
                <tr className="bg-[#d9e1f2] text-slate-900 font-bold border-b-2 border-slate-400 divide-x divide-slate-300 text-center leading-tight select-none">
                  <th className="p-2.5 w-10">1.<br />Sl No.</th>
                  <th className="p-2.5 min-w-[170px] text-left">2.<br />Bidder's Name</th>
                  <th className="p-2.5 min-w-[210px] text-left">3.<br />Work Order No. & dated, Name of issuing Organisation</th>
                  <th className="p-2.5 min-w-[220px] text-left">4.<br />Job Name</th>
                  <th className="p-2 w-16">5.<br />Whether meeting Similar nature (Yes/ No)</th>
                  <th className="p-2 w-16">6.<br />Completion cert Submitted (Yes/ No)</th>
                  <th className="p-2 w-16">7.<br />Job of sub contract type (Yes/ No)</th>
                  <th className="p-2 w-16">8.<br />Approval from owner Submitted (Yes/ No)</th>
                  <th className="p-2 w-20">9.<br />Start Date (DD-MM-YYYY)</th>
                  <th className="p-2 w-20">10.<br />Comp Date (DD-MM-YYYY)</th>
                  <th className="p-2 w-16">11.<br />Duration (months)</th>
                  <th className="p-2 w-20">12.<br />WO value in lacs Incl. GST</th>
                  <th className="p-2 w-24">13.<br />Comp Value of similar nature in lacs Incl. GST</th>
                  <th className="p-2 w-24">
                    14.<br />Annualised completed value in lacs Incl. GST (ARC only)
                    {isOneTimeJob && (
                      <div className="mt-1">
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-300 text-slate-800 font-bold">
                          NA (One-Time Job)
                        </span>
                      </div>
                    )}
                  </th>
                  <th className="p-2 w-16">15.<br />NIL deviation sheet</th>
                  <th className="p-2.5 min-w-[130px]">16.<br />WO Acceptable or Rejected or Query</th>
                  <th className="p-2.5 min-w-[280px] text-left">17.<br />Remarks: Reason for Technical acceptance or Rejection Or Technical Query</th>
                  <th className="p-2.5 min-w-[140px]">18.<br />Final Position of bidder / Recommendation</th>
                  <th className="p-2 w-14 text-center print:hidden">Action</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-300">
                {filteredBidders.length === 0 ? (
                  <tr>
                    <td colSpan={19} className="p-12 text-center text-slate-500 text-xs">
                      <div className="max-w-md mx-auto py-6 space-y-3">
                        <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto">
                          <Table className="w-6 h-6" />
                        </div>
                        <div className="font-bold text-slate-800 text-sm">No Bidders Added Yet</div>
                        <p className="text-slate-500 text-xs">
                          Set up the tender criteria or add bidders and upload their work order documents.
                        </p>
                        <div className="flex items-center justify-center gap-3 pt-2">
                          <button
                            onClick={() => setActiveTab('onboarding')}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-xs transition shadow-sm"
                          >
                            Open Tender Setup →
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredBidders.map((bidder) => {
                    const wos = bidder.workOrders.length > 0 ? bidder.workOrders : [{
                      id: `placeholder-${bidder.id}`,
                      woNumberAndDate: 'Pending Work Order Upload',
                      issuingOrg: 'Upload Required',
                      jobName: 'No work orders uploaded yet',
                      meetsSimilarNature: 'Requires Committee Review' as any,
                      compCertSubmitted: 'Not Attached',
                      isSubcontract: 'Direct / Main',
                      ownerApprovalSubmitted: 'NA',
                      startDate: null,
                      compDate: null,
                      durationMonths: null,
                      woValueLacs: null,
                      compValueLacs: null,
                      annualisedValueLacs: null,
                      nilDeviationSheet: 'Not Mentioned',
                      woStatus: 'Query to be raised',
                      remarks: 'Please upload work order and completion certificate PDF.',
                    }];
                    const rowCount = wos.length;
                    const finalBg = getRowBgClass(bidder.finalPosition);

                    return wos.map((wo, woIndex) => {
                      const isFirstWo = woIndex === 0;
                      const woBg = getRowBgClass(wo.woStatus);

                      return (
                        <tr
                          key={`${bidder.id}-${wo.id}`}
                          className={`divide-x divide-slate-300 transition hover:filter hover:brightness-95 ${finalBg}`}
                        >
                          {/* Col 1: Sl No. (Rowspanned if multiple WOs) */}
                          {isFirstWo && (
                            <td
                              rowSpan={rowCount}
                              className="p-2 text-center font-bold text-slate-900 align-top border-r border-slate-300 bg-slate-50/50"
                            >
                              {bidder.slNo}
                            </td>
                          )}

                          {/* Col 2: Bidder's Name (Rowspanned if multiple WOs) */}
                          {isFirstWo && (
                            <td
                              rowSpan={rowCount}
                              className="p-2.5 text-left font-bold text-slate-900 align-top border-r border-slate-300 bg-white/70"
                            >
                              <div className="flex items-start justify-between gap-1 group">
                                <div>
                                  <div className="font-semibold text-slate-900 leading-snug flex items-center gap-1.5 flex-wrap">
                                    <span>{bidder.bidderName}</span>
                                    <button
                                      type="button"
                                      onClick={() => setEditingBidder(bidder)}
                                      className="opacity-40 group-hover:opacity-100 p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition"
                                      title="Edit Bidder Name & Location"
                                    >
                                      <Edit3 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                  <div className="text-[10px] text-slate-500 font-normal mt-0.5">
                                    {bidder.cityState}
                                  </div>
                                  {rowCount > 1 && (
                                    <span className="inline-block mt-1 px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 text-[9px] font-mono font-bold">
                                      {rowCount} Work Orders
                                    </span>
                                  )}
                                  {(() => {
                                    // Orders the bidder's own list claims but for which no work order was extracted.
                                    const missing = claimedOrdersWithoutDocuments(bidder.claimedOrders, bidder.workOrders || []);
                                    const listed = (bidder.claimedOrders || []).length;
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
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setBidderToDelete({
                                      bidderId: bidder.id,
                                      bidderName: bidder.bidderName,
                                      totalWos: bidder.workOrders.length,
                                    })
                                  }
                                  className="opacity-50 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-700 hover:bg-red-100/70 rounded-md transition-colors shrink-0"
                                  title="Remove Entire Bidder from Evaluation Sheet"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          )}

                          {/* Col 3: Work Order No. & dated, Name of issuing Org */}
                          <td
                            onClick={() =>
                              setSelectedInspectPair({
                                bidder,
                                workOrder: wo,
                                initialKey: 'woNumberAndDate',
                              })
                            }
                            className="p-2 text-left font-mono text-[10px] leading-tight text-slate-800 align-top cursor-pointer hover:bg-amber-50/80 transition group"
                            title="Click to view authentic work order on Canvas PDF viewer"
                          >
                            {/* Work orders are numbered 1, 2, 3 ... within the bidder, whatever order they were extracted in. */}
                            <span className="font-bold text-blue-800 mr-1">{woIndex + 1}.</span>
                            <span className="group-hover:text-blue-700 group-hover:underline">
                              {wo.woNumberAndDate}
                            </span>
                            {wo.issuingOrg && <div className="text-[9px] text-slate-500 font-sans mt-0.5">{wo.issuingOrg}</div>}
                            {(duplicateRows.sameBidder[wo.id] || duplicateRows.acrossBidders[wo.id]) && (
                              <div className="mt-1 text-[9.5px] font-sans font-semibold text-amber-900 bg-amber-50 border border-amber-300 rounded px-1.5 py-1 print:hidden">
                                {duplicateRows.sameBidder[wo.id] ? `${duplicateRows.sameBidder[wo.id]} Merge the details and delete the extra row, or set it to Not Evaluated.` : ''}
                                {duplicateRows.acrossBidders[wo.id] ? ` ${duplicateRows.acrossBidders[wo.id]}` : ''}
                              </div>
                            )}
                          </td>

                          {/* Col 4: Job Name */}
                          <td
                            onClick={() =>
                              setSelectedInspectPair({
                                bidder,
                                workOrder: wo,
                                initialKey: 'jobName',
                              })
                            }
                            className="p-2 text-left text-[10.5px] leading-tight text-slate-800 align-top cursor-pointer hover:bg-blue-50/80 transition group"
                            title="Click to verify Scope & Similar Nature on Canvas PDF"
                          >
                            <span className="group-hover:text-blue-900">{wo.jobName}</span>
                          </td>

                          {/* Col 5: Similar Nature */}
                          <td className="p-1.5 text-center font-bold align-top">
                            <span
                              onClick={() =>
                                setSelectedInspectPair({
                                  bidder,
                                  workOrder: wo,
                                  initialKey: 'jobName',
                                })
                              }
                              className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer hover:scale-105 transition inline-block ${
                                wo.meetsSimilarNature === 'Yes'
                                  ? 'bg-emerald-100 text-emerald-800 font-bold'
                                  : wo.meetsSimilarNature === 'No'
                                  ? 'bg-rose-100 text-rose-800 font-bold'
                                  : 'bg-amber-100 text-amber-900 font-bold'
                              }`}
                              title={
                                wo.similarNatureReason
                                  ? `${isEngineerConfirmed(wo) ? '' : 'AI suggestion: '}${wo.similarNatureReason}`
                                  : 'Click to view the job name on the document'
                              }
                            >
                              {wo.meetsSimilarNature}
                            </span>
                            {!isEngineerConfirmed(wo) && wo.similarNatureReason && (
                              <div className="mt-1 text-[9px] font-normal text-slate-500 leading-tight text-left max-w-[140px] mx-auto" title={wo.similarNatureReason}>
                                {wo.similarNatureReason.length > 90 ? `${wo.similarNatureReason.slice(0, 90)}…` : wo.similarNatureReason}
                              </div>
                            )}
                          </td>

                          {/* Col 6: Completion Certificate Submitted */}
                          <td className="p-1.5 text-center font-bold align-top">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] ${
                                wo.compCertSubmitted === 'Yes'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}
                            >
                              {wo.compCertSubmitted}
                            </span>
                          </td>

                          {/* Col 7: Sub contract type */}
                          <td className="p-1.5 text-center font-medium align-top">
                            <span
                              className={
                                wo.isSubcontract === 'Yes'
                                  ? 'text-amber-800 font-bold'
                                  : 'text-slate-700'
                              }
                            >
                              {wo.isSubcontract}
                            </span>
                            {wo.isSubcontract === 'Yes' && wo.subcontractReason && (
                              <div className="text-[9.5px] leading-tight text-amber-700 mt-0.5" title={wo.subcontractReason}>
                                {wo.subcontractReason}
                              </div>
                            )}
                          </td>

                          {/* Col 8: Owner approval submitted */}
                          <td className="p-1.5 text-center font-medium align-top">
                            <span
                              className={
                                wo.ownerApprovalSubmitted === 'Yes'
                                  ? 'text-emerald-800 font-bold'
                                  : wo.ownerApprovalSubmitted === 'No'
                                  ? 'text-rose-800 font-bold'
                                  : 'text-slate-500'
                              }
                            >
                              {wo.ownerApprovalSubmitted}
                            </span>
                          </td>

                          {/* Col 9: Start Date */}
                          <td className="p-1.5 text-center font-mono text-[10px] text-slate-800 align-top whitespace-nowrap">
                            {wo.woStatus === 'Not Evaluated' ? '—' : wo.startDate}
                          </td>

                          {/* Col 10: Comp Date */}
                          <td className="p-1.5 text-center font-mono text-[10px] text-slate-800 align-top">
                            {wo.woStatus === 'Not Evaluated' ? '—' : completionDateText(wo).proven ? (
                              wo.compDate
                            ) : (
                              <span className="font-sans text-[9.5px] font-semibold text-amber-800">{completionDateText(wo).text}</span>
                            )}
                          </td>

                          {/* Col 11: Duration (months) */}
                          <td className="p-1.5 text-center font-bold font-mono text-[10.5px] text-slate-900 align-top">
                            {wo.woStatus === 'Not Evaluated' ? '—' : durationText(wo).proven ? (
                              wo.durationMonths
                            ) : (
                              <span className="font-sans text-[9.5px] font-semibold text-amber-800">{durationText(wo).text}</span>
                            )}
                            {/* ARC annualisation divides by this figure, so show the calendar breakdown to check it against the dates. */}
                            {!isOneTimeJob && wo.woStatus !== 'Not Evaluated' && durationText(wo).proven && (() => {
                              const exact = formatContractDuration(contractDurationBetween(wo.startDate, wo.compDate));
                              return exact ? <div className="text-[9.5px] font-normal font-sans text-slate-500 whitespace-nowrap">{exact}</div> : null;
                            })()}
                          </td>

                          {/* Col 12: WO value in lacs Incl. GST */}
                          <td
                            onClick={() =>
                              setSelectedInspectPair({
                                bidder,
                                workOrder: wo,
                                initialKey: 'woValueLacs',
                              })
                            }
                            className="p-1.5 text-right font-mono text-[10px] text-slate-800 align-top whitespace-nowrap cursor-pointer hover:bg-amber-100/70 transition group"
                            title="Click to view Awarded WO Value on Canvas PDF"
                          >
                            <span className="group-hover:text-amber-900 group-hover:font-semibold">
                              {wo.woStatus === 'Not Evaluated'
                                ? '—'
                                : typeof wo.woValueLacs === 'number'
                                ? wo.woValueLacs.toFixed(2)
                                : wo.woValueNote || '-'}
                            </span>
                          </td>

                          {/* Col 13: Comp Value of similar nature in lacs Incl. GST */}
                          <td
                            onClick={() =>
                              setSelectedInspectPair({
                                bidder,
                                workOrder: wo,
                                initialKey: 'compValueLacs',
                              })
                            }
                            className="p-1.5 text-right font-mono font-bold text-[10.5px] text-slate-900 align-top whitespace-nowrap bg-white/40 cursor-pointer hover:bg-amber-200/80 transition group"
                            title="Click to view Executed Value Bounding Box & OCR Grounding"
                          >
                            <span className="group-hover:text-emerald-800 group-hover:underline flex items-center justify-end gap-1">
                              {wo.woStatus === 'Not Evaluated'
                                ? '—'
                                : typeof wo.compValueLacs === 'number'
                                ? wo.compValueLacs.toFixed(2)
                                : wo.compValueNote || '-'}
                              <span className="text-[8px] bg-amber-500/20 text-amber-900 px-1 py-0.2 rounded font-sans uppercase font-bold tracking-tighter opacity-0 group-hover:opacity-100 transition">
                                OCR
                              </span>
                            </span>
                          </td>

                          {/* Col 14: Annualised completed value (ARC only) */}
                          <td className="p-1.5 text-center font-mono font-bold text-[10.5px] align-top whitespace-nowrap bg-purple-50/40">
                            {isOneTimeJob ? (
                              <span
                                className="px-2 py-0.5 rounded bg-slate-100 text-slate-500 font-bold border border-slate-200 text-[10px]"
                                title="NIT is for a One-Time Job: Annualized WO value criteria is not invoked (NA)"
                              >
                                NA
                              </span>
                            ) : wo.woStatus === 'Not Evaluated' ? (
                              <span className="text-slate-400 font-normal">—</span>
                            ) : typeof wo.annualisedValueLacs === 'number' ? (
                              <span className="text-purple-950 font-mono text-right block">{wo.annualisedValueLacs.toFixed(2)}</span>
                            ) : (
                              <span className="text-slate-400 font-normal">-</span>
                            )}
                          </td>

                          {/* Col 15: NIL deviation sheet */}
                          <td className="p-1.5 text-center font-medium align-top">
                            <span
                              className={
                                wo.nilDeviationSheet === 'Yes'
                                  ? 'text-slate-800'
                                  : 'text-amber-800 font-bold'
                              }
                            >
                              {wo.nilDeviationSheet}
                            </span>
                          </td>

                          {/* Col 16: WO Status */}
                          <td className="p-2 text-center align-top whitespace-nowrap">
                            {getStatusBadge(wo.woStatus)}
                            {isEngineerConfirmed(wo) ? (
                              <div
                                className="mt-1 text-[9px] text-emerald-700 font-semibold"
                                title={`Confirmed by ${wo.engineerConfirmedBy}${wo.engineerConfirmedAt ? ` on ${new Date(wo.engineerConfirmedAt).toLocaleString('en-IN')}` : ''}`}
                              >
                                Confirmed
                              </div>
                            ) : (
                              <div className="mt-1 flex flex-col items-center gap-1">
                                <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[9px] font-bold uppercase tracking-wide">
                                  AI suggestion
                                </span>
                                {canEditActiveTender && (
                                  <button
                                    onClick={() => confirmIoclWorkOrder(bidder.id, wo.id)}
                                    className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold rounded shadow-2xs transition"
                                    title="Accept the suggested status, final position and remarks as your decision. Use Edit to change them first."
                                  >
                                    Confirm
                                  </button>
                                )}
                              </div>
                            )}
                            {wo.woStatus === 'Query to be raised' && (
                              <button
                                onClick={() => {
                                  const woNum = wo.woNumberAndDate ? wo.woNumberAndDate.split(' ')[0] : (wo.id || '');
                                  setAiTqBidderId(bidder.id);
                                  setAiTqWoNumber(woNum);
                                  setAiTqDeficiency(wo.remarks);
                                  setShowAiTqModal(true);
                                }}
                                className="mt-1.5 px-2 py-0.5 bg-amber-500 hover:bg-amber-400 text-amber-950 text-[10px] font-bold rounded flex items-center gap-1 mx-auto shadow-2xs transition-colors"
                                title="Generate AI Technical Query in 1 click"
                              >
                                <Sparkles className="w-3 h-3 text-amber-950" />
                                <span>1-Click TQ</span>
                              </button>
                            )}
                          </td>

                          {/* Col 17: Remarks */}
                          <td
                            className={`p-2 text-left text-[10.5px] leading-relaxed align-top ${
                              isEngineerConfirmed(wo) ? 'text-slate-800' : 'text-slate-500 italic'
                            }`}
                          >
                            {wo.remarks}
                            {valueRuleWarnings[wo.id] && (
                              <div className="mt-1 not-italic text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded px-1.5 py-1 print:hidden">
                                {valueRuleWarnings[wo.id]} Edit the row to review it.
                              </div>
                            )}
                          </td>

                          {/* Col 18: Final Position of bidder (Rowspanned if multiple WOs) */}
                          {isFirstWo && (
                            <td
                              rowSpan={rowCount}
                              className={`p-2.5 text-center align-middle font-bold border-l border-slate-300 ${finalBg}`}
                            >
                              <div className="flex flex-col items-center justify-center gap-1">
                                {bidder.finalPosition && bidder.workOrders.some(isEngineerConfirmed) ? (
                                  <>
                                    {getStatusBadge(bidder.finalPosition)}
                                    {bidderOutcome(bidder.workOrders || []).remark && (
                                      <span className="text-[10px] font-normal text-slate-700 leading-snug">
                                        {bidderOutcome(bidder.workOrders || []).remark}
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <span className="px-2 py-1 rounded bg-slate-100 border border-slate-300 text-slate-600 text-[10px] font-semibold">
                                    Pending review
                                  </span>
                                )}
                                {bidder.finalPosition === 'Query to be raised' && (
                                  <button
                                    onClick={() => {
                                      const woNum = bidder.workOrders[0]?.woNumberAndDate
                                        ? bidder.workOrders[0].woNumberAndDate.split(' ')[0]
                                        : (bidder.workOrders[0]?.id || '');
                                      setAiTqBidderId(bidder.id);
                                      setAiTqWoNumber(woNum);
                                      setAiTqDeficiency(bidder.workOrders[0]?.remarks || 'Clarification on credentials required');
                                      setShowAiTqModal(true);
                                    }}
                                    className="mt-1 px-2 py-0.5 bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 text-[10px] font-bold rounded flex items-center gap-1 mx-auto transition"
                                    title="Generate Technical Query for bidder"
                                  >
                                    <Sparkles className="w-2.5 h-2.5 text-amber-700" />
                                    <span>AI Query</span>
                                  </button>
                                )}
                              </div>
                            </td>
                          )}

                          {/* Actions: View PDF / Quick Edit / Generate TQ */}
                          <td className="p-1.5 text-center align-middle print:hidden bg-white/60">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() =>
                                  setSelectedInspectPair({
                                    bidder,
                                    workOrder: wo,
                                  })
                                }
                                className="p-1 rounded hover:bg-blue-100 text-blue-700 transition"
                                title="Inspect Raw Bidder PDF & OCR Bounding Boxes"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() =>
                                  setSelectedEditPair({
                                    bidder,
                                    workOrder: wo,
                                  })
                                }
                                className="p-1 rounded hover:bg-slate-200 text-slate-700 transition"
                                title="Edit Values & Recalculate"
                              >
                                <FileEdit className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => {
                                  const woNum = wo.woNumberAndDate ? wo.woNumberAndDate.split(' ')[0] : '4160002725';
                                  setAiTqBidderId(bidder.id);
                                  setAiTqWoNumber(woNum);
                                  setAiTqDeficiency(wo.remarks);
                                  setShowAiTqModal(true);
                                }}
                                className="p-1 rounded hover:bg-amber-100 text-amber-700 transition"
                                title="1-Click AI Technical Query Generator"
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setWoToDelete({
                                    bidderId: bidder.id,
                                    woId: wo.id,
                                    woName: wo.woNumberAndDate || wo.jobName,
                                    bidderName: bidder.bidderName,
                                    totalWos: bidder.workOrders.length,
                                    isPlaceholder: wo.id.startsWith('placeholder-'),
                                  })
                                }
                                className="p-1 rounded-md text-slate-400 hover:text-red-700 hover:bg-red-100/70 transition-colors"
                                title={
                                  wo.id.startsWith('placeholder-')
                                    ? 'Remove Bidder from Evaluation Sheet'
                                    : 'Delete Work Order from Evaluation'
                                }
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    });
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Page 6 Official Signatories Box (Matching the bottom of the PDF document) */}
        <div className="bg-white rounded-lg border border-slate-300 p-6 shadow-xs text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 mb-4 border-b border-slate-200 gap-2">
            <div className="flex items-center gap-2 text-slate-800 font-bold uppercase tracking-wider text-xs">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Technical evaluation approved by</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-500 text-[11px] font-mono hidden md:inline">
                {criteria.clientOrg || 'IOCL Paradip Refinery'}
              </span>
              <button
                onClick={() => setShowEditCommittee(true)}
                className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                title="Edit Signatories, Designations, and Review Panel"
              >
                <Edit3 className="w-3.5 h-3.5 text-blue-600" />
                <span>Edit Signatories & Review Panel</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6 pt-2 text-center">
            {/* 1. Approving Authority */}
            {ioclMetadata?.signatories?.approvingAuthority !== null && (
              <div
                onClick={() => setShowEditCommittee(true)}
                className="p-4 rounded-lg bg-slate-50 hover:bg-slate-100/80 border border-slate-200 flex flex-col items-center justify-between min-h-[140px] cursor-pointer group transition relative"
                title="Click to edit signatory details"
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-[10px] text-slate-500 font-bold uppercase">
                    {ioclMetadata?.signatories?.approvingAuthority?.title || 'Signature of Approving Authority'}
                  </span>
                  <Edit3 className="w-3 h-3 text-slate-400 group-hover:text-blue-600 transition" />
                </div>
                <div className="py-2 w-full">
                  <div className="text-xs text-slate-700 font-semibold border-b border-dashed border-slate-400 pb-4">Signature:</div>
                  <div className="text-[11px] text-slate-600 mt-1">Date: ____________</div>
                  <div className="text-sm font-bold text-slate-900 mt-1 group-hover:text-blue-700 transition">
                    {ioclMetadata?.signatories?.approvingAuthority?.name || 'Approving Authority'}
                  </div>
                  <div className="text-[11px] text-slate-600 font-medium">
                    {ioclMetadata?.signatories?.approvingAuthority?.designation || 'Designation'}
                  </div>
                  {ioclMetadata?.signatories?.approvingAuthority?.department && (
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {ioclMetadata.signatories.approvingAuthority.department}
                    </div>
                  )}
                </div>
                {ioclMetadata?.signatories?.approvingAuthority?.status && (
                  <span className="text-[10px] text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full font-semibold">
                    {ioclMetadata.signatories.approvingAuthority.status}
                  </span>
                )}
              </div>
            )}

            {/* 2. Next Superior Officer */}
            {ioclMetadata?.signatories?.nextSuperiorOfficer !== null && (
              <div
                onClick={() => setShowEditCommittee(true)}
                className="p-4 rounded-lg bg-slate-50 hover:bg-slate-100/80 border border-slate-200 flex flex-col items-center justify-between min-h-[140px] cursor-pointer group transition relative"
                title="Click to edit signatory details"
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-[10px] text-slate-500 font-bold uppercase">
                    {ioclMetadata?.signatories?.nextSuperiorOfficer?.title || 'Signature of Next Superior Officer'}
                  </span>
                  <Edit3 className="w-3 h-3 text-slate-400 group-hover:text-blue-600 transition" />
                </div>
                <div className="py-2 w-full">
                  <div className="text-xs text-slate-700 font-semibold border-b border-dashed border-slate-400 pb-4">Signature:</div>
                  <div className="text-[11px] text-slate-600 mt-1">Date: ____________</div>
                  <div className="text-sm font-bold text-slate-900 mt-1 group-hover:text-blue-700 transition">
                    {ioclMetadata?.signatories?.nextSuperiorOfficer?.name || 'Next Superior Officer'}
                  </div>
                  <div className="text-[11px] text-slate-600 font-medium">
                    {ioclMetadata?.signatories?.nextSuperiorOfficer?.designation || 'Designation'}
                  </div>
                  {ioclMetadata?.signatories?.nextSuperiorOfficer?.department && (
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {ioclMetadata.signatories.nextSuperiorOfficer.department}
                    </div>
                  )}
                </div>
                {ioclMetadata?.signatories?.nextSuperiorOfficer?.status && (
                  <span className="text-[10px] text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full font-semibold">
                    {ioclMetadata.signatories.nextSuperiorOfficer.status}
                  </span>
                )}
              </div>
            )}

            {/* 3. Superior Officer */}
            {ioclMetadata?.signatories?.superiorOfficer !== null && (
              <div
                onClick={() => setShowEditCommittee(true)}
                className="p-4 rounded-lg bg-slate-50 hover:bg-slate-100/80 border border-slate-200 flex flex-col items-center justify-between min-h-[140px] cursor-pointer group transition relative"
                title="Click to edit signatory details"
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-[10px] text-slate-500 font-bold uppercase">
                    {ioclMetadata?.signatories?.superiorOfficer?.title || 'Signature of Superior Officer'}
                  </span>
                  <Edit3 className="w-3 h-3 text-slate-400 group-hover:text-blue-600 transition" />
                </div>
                <div className="py-2 w-full">
                  <div className="text-xs text-slate-700 font-semibold border-b border-dashed border-slate-400 pb-4">Signature:</div>
                  <div className="text-[11px] text-slate-600 mt-1">Date: ____________</div>
                  <div className="text-sm font-bold text-slate-900 mt-1 group-hover:text-blue-700 transition">
                    {ioclMetadata?.signatories?.superiorOfficer?.name || 'Superior Officer'}
                  </div>
                  <div className="text-[11px] text-slate-600 font-medium">
                    {ioclMetadata?.signatories?.superiorOfficer?.designation || 'Designation'}
                  </div>
                  {ioclMetadata?.signatories?.superiorOfficer?.department && (
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {ioclMetadata.signatories.superiorOfficer.department}
                    </div>
                  )}
                </div>
                {ioclMetadata?.signatories?.superiorOfficer?.status && (
                  <span className="text-[10px] text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full font-semibold">
                    {ioclMetadata.signatories.superiorOfficer.status}
                  </span>
                )}
              </div>
            )}

            {/* 4. Initiator */}
            {ioclMetadata?.signatories?.initiator !== null && (
              <div
                onClick={() => setShowEditCommittee(true)}
                className="p-4 rounded-lg bg-slate-50 hover:bg-slate-100/80 border border-slate-200 flex flex-col items-center justify-between min-h-[140px] cursor-pointer group transition relative"
                title="Click to edit signatory details"
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-[10px] text-slate-500 font-bold uppercase">
                    {ioclMetadata?.signatories?.initiator?.title || 'Signature of Initiator'}
                  </span>
                  <Edit3 className="w-3 h-3 text-slate-400 group-hover:text-blue-600 transition" />
                </div>
                <div className="py-2 w-full">
                  <div className="text-xs text-slate-700 font-semibold border-b border-dashed border-slate-400 pb-4">Signature:</div>
                  <div className="text-[11px] text-slate-600 mt-1">Date: ____________</div>
                  <div className="text-sm font-bold text-slate-900 mt-1 group-hover:text-blue-700 transition">
                    {ioclMetadata?.signatories?.initiator?.name || 'Initiator'}
                  </div>
                  <div className="text-[11px] text-slate-600 font-medium">
                    {ioclMetadata?.signatories?.initiator?.designation || 'Designation'}
                  </div>
                  {ioclMetadata?.signatories?.initiator?.department && (
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {ioclMetadata.signatories.initiator.department}
                    </div>
                  )}
                </div>
                {ioclMetadata?.signatories?.initiator?.status && (
                  <span className="text-[10px] text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full font-semibold">
                    {ioclMetadata.signatories.initiator.status}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MODAL: Edit Committee Signatories */}
      {showEditCommittee && (
        <EditCommitteeModal onClose={() => setShowEditCommittee(false)} />
      )}

      {/* MODAL 1: Inspect Raw PDF Evidence */}
      {selectedInspectPair && (
        <RawPdfViewerModal
          bidder={selectedInspectPair.bidder}
          workOrder={selectedInspectPair.workOrder}
          initialSelectedKey={selectedInspectPair.initialKey}
          onClose={() => setSelectedInspectPair(null)}
          onEditField={() => {
            const pair = selectedInspectPair;
            setSelectedInspectPair(null);
            setSelectedEditPair(pair);
          }}
        />
      )}

      {/* MODAL 2: Edit / Override Values */}
      {selectedEditPair && (
        <IoclRowEditModal
          bidder={selectedEditPair.bidder}
          workOrder={selectedEditPair.workOrder}
          onClose={() => setSelectedEditPair(null)}
        />
      )}

      {/* MODAL 3: Ingest New Raw PDF to 18 Columns */}
      {showIngestionModal && (
        <RawPdfIngestionModal
          onClose={() => setShowIngestionModal(false)}
          onSuccess={(newBidder) => {
            setShowIngestionModal(false);
          }}
        />
      )}

      {/* MODAL 4: 1-Click AI Technical Query Generator */}
      <OneClickQueryGeneratorModal
        isOpen={showAiTqModal}
        onClose={() => setShowAiTqModal(false)}
        initialBidderId={aiTqBidderId}
        initialWoNumber={aiTqWoNumber}
        initialDeficiency={aiTqDeficiency}
        onQueryGenerated={() => {
          setActiveTab('technical-queries');
        }}
      />

      {/* MODAL 5: Delete Work Order Confirmation */}
      {woToDelete && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3 text-red-600">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {woToDelete.isPlaceholder ? 'Remove Bidder from Evaluation' : 'Delete Work Order Details'}
                </h3>
                <p className="text-xs text-slate-500">
                  {woToDelete.isPlaceholder
                    ? 'Remove this bidder entry from the evaluation sheet.'
                    : 'Remove this work order record from technical review.'}
                </p>
              </div>
            </div>

            <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 text-xs space-y-1">
              <div>
                <span className="text-slate-500">Bidder:</span>{' '}
                <strong className="text-slate-900">{woToDelete.bidderName}</strong>
              </div>
              {!woToDelete.isPlaceholder && (
                <div>
                  <span className="text-slate-500">Work Order Ref:</span>{' '}
                  <strong className="text-slate-900 font-mono">{woToDelete.woName}</strong>
                </div>
              )}
            </div>

            {woToDelete.isPlaceholder ? (
              <p className="text-xs text-slate-600">
                Are you sure you want to completely remove <strong>{woToDelete.bidderName}</strong> from the Technical Evaluation Sheet?
              </p>
            ) : woToDelete.totalWos > 1 ? (
              <p className="text-xs text-slate-600">
                This bidder has <strong>{woToDelete.totalWos} work orders</strong>. Would you like to delete only this specific work order, or remove the entire bidder?
              </p>
            ) : (
              <p className="text-xs text-slate-600">
                This is the only work order for <strong>{woToDelete.bidderName}</strong>. You can choose to delete this work order or remove the entire bidder.
              </p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setWoToDelete(null)}
                className="px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition"
              >
                Cancel
              </button>

              {!woToDelete.isPlaceholder && woToDelete.totalWos <= 1 && (
                <button
                  type="button"
                  onClick={() => {
                    deleteIoclWorkOrder(woToDelete.bidderId, woToDelete.woId, false);
                    setWoToDelete(null);
                  }}
                  className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-200 hover:bg-slate-300 rounded-lg transition"
                  title="Keeps bidder slot as Pending Work Order Upload"
                >
                  Clear WO Only
                </button>
              )}

              {!woToDelete.isPlaceholder && woToDelete.totalWos > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    deleteIoclWorkOrder(woToDelete.bidderId, woToDelete.woId, false);
                    setWoToDelete(null);
                  }}
                  className="px-3.5 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition shadow-xs"
                >
                  Delete This WO Only
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  deleteIoclBidder(woToDelete.bidderId);
                  setWoToDelete(null);
                }}
                className={`px-3.5 py-2 text-xs font-bold text-white rounded-lg transition shadow-xs ${
                  woToDelete.totalWos > 1 ? 'bg-rose-800 hover:bg-rose-900' : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {woToDelete.isPlaceholder
                  ? 'Yes, Remove Bidder'
                  : woToDelete.totalWos > 1
                  ? 'Remove Entire Bidder'
                  : 'Delete & Remove Bidder'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 6: Delete Entire Bidder Confirmation */}
      {bidderToDelete && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3 text-red-600">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Remove Bidder from Evaluation</h3>
                <p className="text-xs text-slate-500">Remove bidder and all associated work orders.</p>
              </div>
            </div>

            <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 text-xs space-y-1">
              <div>
                <span className="text-slate-500">Bidder Name:</span>{' '}
                <strong className="text-slate-900">{bidderToDelete.bidderName}</strong>
              </div>
              <div>
                <span className="text-slate-500">Work Orders Count:</span>{' '}
                <strong className="text-slate-900">{bidderToDelete.totalWos}</strong>
              </div>
            </div>

            <p className="text-xs text-slate-600">
              Are you sure you want to completely remove <strong>{bidderToDelete.bidderName}</strong> from the Technical Evaluation Sheet? This will also update the serial numbers.
            </p>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setBidderToDelete(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  deleteIoclBidder(bidderToDelete.bidderId);
                  setBidderToDelete(null);
                }}
                className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition shadow-xs"
              >
                Yes, Remove Bidder
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 7: Edit Bidder Profile & Name Modal */}
      {editingBidder && (
        <EditBidderModal
          bidder={editingBidder}
          onClose={() => setEditingBidder(null)}
        />
      )}
    </div>
  );
};
