import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { TechnicalQuery } from '../types';
import { OneClickQueryGeneratorModal } from './OneClickQueryGeneratorModal';
import {
  HelpCircle,
  Plus,
  Send,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Sparkles,
  FileText,
  Printer,
  Copy,
  Check,
  Building2,
  Calendar,
  Layers,
  ArrowRight,
  Zap,
  ChevronRight,
  Trash2,
  Edit3,
} from 'lucide-react';

export const TechnicalQueriesView: React.FC = () => {
  const {
    technicalQueries,
    ioclBidders,
    criteria,
    addTechnicalQuery,
    deleteTechnicalQuery,
    updateTechnicalQuery,
    setActiveTab,
  } = useApp();

  const [selectedBidderFilter, setSelectedBidderFilter] = useState<string>('All');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('All');
  const [selectedQueryForLetter, setSelectedQueryForLetter] = useState<TechnicalQuery | null>(
    technicalQueries[0] || null
  );

  // One-Click AI Generator modal state
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiModalBidderId, setAiModalBidderId] = useState<string | undefined>(undefined);
  const [aiModalWoNumber, setAiModalWoNumber] = useState<string | undefined>(undefined);
  const [aiModalDeficiency, setAiModalDeficiency] = useState<string | undefined>(undefined);

  // New query modal
  const [showNewModal, setShowNewModal] = useState(false);
  const [newTqBidderId, setNewTqBidderId] = useState(ioclBidders[0]?.id || '');
  const [newClauseRef, setNewClauseRef] = useState('PQC Clause 3.1 - Technical Experience');
  const [newDeficiency, setNewDeficiency] = useState('');
  const [newQueryText, setNewQueryText] = useState('');
  const [newDeadline, setNewDeadline] = useState(
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10)
  );

  // Response simulation modal
  const [showResponseModal, setShowResponseModal] = useState(false);
  const [respondingTq, setRespondingTq] = useState<TechnicalQuery | null>(null);
  const [simulatedResponse, setSimulatedResponse] = useState('');
  const [committeeClosureRemark, setCommitteeClosureRemark] = useState('');

  // Edit query modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editTqBidderId, setEditTqBidderId] = useState('');
  const [editClauseRef, setEditClauseRef] = useState('');
  const [editDeficiency, setEditDeficiency] = useState('');
  const [editQueryText, setEditQueryText] = useState('');
  const [editDeadline, setEditDeadline] = useState('');

  const updateTechnicalQueryStatus = (
    id: string,
    status: TechnicalQuery['status'],
    bidderResponse: string | undefined,
    evaluatorRemarks: string
  ) => {
    const updates: Partial<TechnicalQuery> = { status, bidderResponse, evaluatorRemarks };
    if (status === 'Response Received') updates.bidderResponseDate = new Date().toLocaleDateString('en-IN');
    updateTechnicalQuery(id, updates);
    setSelectedQueryForLetter((current) => (current?.id === id ? { ...current, ...updates } : current));
  };

  const handleEditClick = (q: TechnicalQuery) => {
    setEditTqBidderId(q.bidderId);
    setEditClauseRef(q.clauseRef);
    setEditDeficiency(q.deficiency);
    setEditQueryText(q.queryText);
    setEditDeadline(q.responseDeadline);
    setShowEditModal(true);
  };

  const handleSaveEdit = () => {
    if (!selectedQueryForLetter) return;
    
    const b = ioclBidders.find((bid) => bid.id === editTqBidderId);
    
    const updates = {
      bidderId: editTqBidderId,
      bidderName: b ? b.bidderName : selectedQueryForLetter.bidderName,
      clauseRef: editClauseRef,
      deficiency: editDeficiency,
      queryText: editQueryText,
      responseDeadline: editDeadline,
    };
    
    updateTechnicalQuery(selectedQueryForLetter.id, updates);
    
    setSelectedQueryForLetter({
      ...selectedQueryForLetter,
      ...updates,
    });
    
    setShowEditModal(false);
  };

  const filteredQueries = technicalQueries.filter((q) => {
    if (selectedBidderFilter !== 'All' && q.bidderId !== selectedBidderFilter) return false;
    if (selectedStatusFilter !== 'All' && q.status !== selectedStatusFilter) return false;
    return true;
  });

  const handleCreateNewQuery = () => {
    const b = ioclBidders.find((bid) => bid.id === (newTqBidderId || ioclBidders[0]?.id));
    if (!b || !newQueryText.trim()) return;

    const created = addTechnicalQuery({
      tqRefNo: `TQ-${String(b.slNo).padStart(3, '0')}/${(technicalQueries.length + 1).toString().padStart(2, '0')}`,
      bidderId: b.id,
      bidderName: b.bidderName,
      clauseRef: newClauseRef,
      deficiency: newDeficiency,
      queryText: newQueryText,
      responseDeadline: newDeadline,
      status: 'Issued to Bidder',
      issuedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
      evaluatorRemarks: 'Raised during PQC evaluation.',
    });

    setSelectedQueryForLetter(created);
    setShowNewModal(false);
    setNewDeficiency('');
    setNewQueryText('');
  };

  // 1-Click batch generator for IOCL 18-column sheet flagged bidders
  const handleAutoGenerateAllIoclFlagged = () => {
    const flaggedBidders = ioclBidders.filter((b) => b.finalPosition === 'Query to be raised');
    let count = technicalQueries.length;

    flaggedBidders.forEach((b) => {
      const wo = b.workOrders?.[0];
      const woNum = wo?.woNumberAndDate ? wo.woNumberAndDate.split(' ')[0] : (wo?.id || 'Work Order');
      const rem = (wo?.remarks || '').toLowerCase();
      const isSub = rem.includes('sub-contract') || rem.includes('subcontract');
      const isSor = rem.includes('sor') || rem.includes('boq');
      const isArc = rem.includes('arc') || rem.includes('annualised');

      count += 1;
      let promptPrefix = 'Please submit completion certificate clearly indicating:';
      let numberedPoints = ['Start date', 'Completion date', 'Executed value including GST'];
      let clause = 'NIT PQC Clause 3.2 - Client Completion Certificate';

      if (isSub) {
        promptPrefix = `Work Order No. ${woNum} is of sub-contract nature. As per NIT Clause 3.4, please submit:`;
        numberedPoints = [
          'Prior written approval / NOC from end Client / Owner Engineer-in-Charge',
          'Direct Completion Certificate issued by Owner establishing scope',
          'TDS Form 26AS / GST reconciliation confirming direct payment receipts',
        ];
        clause = 'NIT PQC Clause 3.4 - Sub-contract Credentials with Owner Consent';
      } else if (isSor) {
        promptPrefix = `With reference to Work Order No. ${woNum}, please submit:`;
        numberedPoints = [
          'Detailed Schedule of Rates (SOR) / Bill of Quantities (BOQ) copy',
          'Item-wise rate and execution breakdown establishing similar nature',
          'Certification of high-pressure piping / turnaround scope by Client',
        ];
        clause = 'NIT PQC Clause 3.1 - Scope Breakdown & Similar Nature Verification';
      } else if (isArc) {
        promptPrefix = `With reference to Annual Rate Contract (ARC) Work Order No. ${woNum}, please submit:`;
        numberedPoints = [
          'Year-wise actual executed value certification issued by Client EIC',
          'Proof of continuous unbroken annual maintenance performance',
          'Alternative single qualifying work credential exceeding required threshold',
        ];
        clause = 'NIT PQC Clause 3.1.2 - Annualized Completed Value for Rate Contracts';
      }

      const queryText = `Technical Query No. ${count}\n\n${promptPrefix}\n\n${numberedPoints.map((pt, i) => `${i + 1}. ${pt}`).join('\n')}\nfor Work Order No. ${woNum}.`;

      addTechnicalQuery({
        tqRefNo: `TQ-IOCL/${String(count).padStart(2, '0')}`,
        bidderId: b.id,
        bidderName: b.bidderName,
        clauseRef: clause,
        credentialRef: `Work Order No. ${woNum}`,
        deficiency: wo?.remarks || 'Credential requires statutory verification',
        queryText,
        responseDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
        status: 'Issued to Bidder',
        issuedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
        evaluatorRemarks: 'Batch generated for TBA Sheet deficiencies.',
      });
    });
  };

  const openGeneratorForPreset = (wo: string, deficiency: string, bidderId?: string) => {
    setAiModalWoNumber(wo);
    setAiModalDeficiency(deficiency);
    setAiModalBidderId(bidderId || ioclBidders[0]?.id);
    setShowAiModal(true);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
              Technical Query (TQ) Management Engine
            </span>
            <span className="text-xs text-slate-500 font-mono">
              Total Queries: {technicalQueries.length}
            </span>
          </div>
          <h2 className="text-xl font-bold text-slate-900 mt-1">
            Official Clarifications & Technical Query Workflow
          </h2>
          <p className="text-xs text-slate-500">
            Facilitates the formal clarification process between tender evaluation committee and participating bidders.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => {
              const flagged = ioclBidders.find((b) => b.finalPosition === 'Query to be raised');
              const firstWo = flagged?.workOrders?.[0]?.woNumberAndDate?.split(' ')[0] || '';
              setAiModalBidderId(flagged?.id);
              setAiModalWoNumber(firstWo);
              setAiModalDeficiency(undefined);
              setShowAiModal(true);
            }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow-sm transition-all"
          >
            <FileText className="w-4 h-4 text-white" />
            <span>Draft Technical Query</span>
          </button>

          <button
            onClick={handleAutoGenerateAllIoclFlagged}
            className="px-3.5 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors shadow-sm"
            title="Scan TBA sheet and generate queries for all bidders marked 'Query to be raised'"
          >
            <Zap className="w-4 h-4" /> Generate for Flagged Bidders
          </button>

          <button
            onClick={() => setShowNewModal(true)}
            className="px-3.5 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" /> Manual Draft
          </button>
        </div>
      </div>

      {/* Featured Banner: Technical Query Generator */}
      <div className="bg-slate-900 text-white rounded-2xl p-6 border border-slate-800 shadow-md">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-400 text-amber-950 uppercase tracking-wider">
                Automated Drafting
              </span>
              <span className="text-xs text-amber-300 font-semibold flex items-center gap-1">
                <FileText className="w-3.5 h-3.5" /> Technical Query Generator
              </span>
            </div>
            <h3 className="text-lg font-bold tracking-tight text-white">
              Formulate structured clarification notices for bidder credential shortfalls
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              When credential deficiencies are discovered, the AI reads the work order number, client certificate, and NIT clause, producing clean numbered requirements ready for official issue.
            </p>

            {/* Standard Format Showcase Box */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 mt-2 font-mono text-[11px] text-slate-200">
              <div className="text-[10px] text-amber-400 uppercase font-bold tracking-wider mb-1">
                Standard Clarification Format:
              </div>
              <p className="font-bold text-white">Technical Query Clarification Letter</p>
              <p className="mt-1 text-slate-300">Please submit completion certificate clearly indicating:</p>
              <p className="mt-1 pl-2 text-emerald-400">1. Start date<br/>2. Completion date<br/>3. Executed value including GST</p>
              <p className="mt-1 text-slate-400">for the cited Work Order reference.</p>
            </div>
          </div>

          <div className="flex flex-col gap-2.5 w-full sm:w-auto shrink-0">
            <button
              onClick={() => {
                const flagged = ioclBidders.find((b) => b.finalPosition === 'Query to be raised');
                const firstWo = flagged?.workOrders?.[0]?.woNumberAndDate?.split(' ')[0] || '';
                openGeneratorForPreset(firstWo, 'Missing completion certificate indicating start date, completion date and executed value with GST.', flagged?.id);
              }}
              className="px-5 py-3 bg-amber-500 hover:bg-amber-400 active:scale-[0.98] text-amber-950 text-xs font-bold rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-amber-500"
            >
              <Sparkles className="w-4 h-4" />
              <span>Draft Query for Flagged Bidder</span>
            </button>

            <button
              onClick={() => {
                setAiModalBidderId(undefined);
                setAiModalWoNumber('');
                setAiModalDeficiency('');
                setShowAiModal(true);
              }}
              className="px-5 py-2.5 bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-2"
            >
              <span>Custom Bidder / WO Query</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Grid: Query List (Left) + Formal Letter Preview (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Queries Filter & Cards (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Filters */}
          <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-500">Bidder:</span>
              <select
                value={selectedBidderFilter}
                onChange={(e) => setSelectedBidderFilter(e.target.value)}
                className="p-1.5 border border-slate-300 rounded-lg text-xs"
              >
                <option value="All">All Bidders ({ioclBidders.length})</option>
                {ioclBidders.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.bidderName}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-500">Status:</span>
              <select
                value={selectedStatusFilter}
                onChange={(e) => setSelectedStatusFilter(e.target.value)}
                className="p-1.5 border border-slate-300 rounded-lg text-xs"
              >
                <option value="All">All Statuses</option>
                <option value="Draft">Draft</option>
                <option value="Issued to Bidder">Issued to Bidder</option>
                <option value="Response Received">Response Received</option>
                <option value="Closed / Accepted">Closed / Accepted</option>
              </select>
            </div>
          </div>

          {/* Queries List */}
          {filteredQueries.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
              <p className="font-semibold text-slate-800">No Technical Queries found for this filter.</p>
              <p className="text-xs text-slate-500 mt-1">
                Click "Auto-Scan & Generate TQs" to generate queries based on credential audit rules.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredQueries.map((q) => {
                const isSelected = selectedQueryForLetter?.id === q.id;
                const statusBadgeColors = {
                  Draft: 'bg-slate-100 text-slate-700 border-slate-300',
                  'Issued to Bidder': 'bg-amber-100 text-amber-800 border-amber-300',
                  'Response Received': 'bg-blue-100 text-blue-800 border-blue-300',
                  'Closed / Accepted': 'bg-emerald-100 text-emerald-800 border-emerald-300',
                }[q.status];

                return (
                  <div
                    key={q.id}
                    onClick={() => setSelectedQueryForLetter(q)}
                    className={`bg-white border rounded-xl p-4 shadow-sm transition-all cursor-pointer space-y-3 ${
                      isSelected
                        ? 'border-blue-600 ring-2 ring-blue-500/20 shadow-md'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-slate-900 text-white">
                          {q.tqRefNo}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${statusBadgeColors}`}>
                          {q.status}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-500 font-mono">
                        Deadline: {q.responseDeadline}
                      </span>
                    </div>

                    <div>
                      <div className="text-xs text-slate-500 font-medium">
                        Bidder: <strong className="text-slate-900">{q.bidderName}</strong>
                      </div>
                      <div className="text-xs font-semibold text-blue-700 mt-0.5">{q.clauseRef}</div>
                    </div>

                    <p className="text-xs text-slate-700 leading-relaxed font-sans line-clamp-2">
                      {q.queryText}
                    </p>

                    {/* Actions bar */}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                      <span className="text-[10px] text-slate-400">
                        Issued: {q.issuedAt || 'Recently'}
                      </span>

                      <div className="flex items-center gap-2">
                        {q.status === 'Issued to Bidder' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRespondingTq(q);
                              setSimulatedResponse(
                                `We hereby submit the certified copy of the Client Completion Certificate with the endorsement of the Engineer-in-Charge confirming executed value of ₹${criteria.optionASingleWorkCr} Cr.`
                              );
                              setShowResponseModal(true);
                            }}
                            className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold rounded border border-blue-200 transition-colors"
                          >
                            Record Bidder Response
                          </button>
                        )}

                        {q.status === 'Response Received' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              updateTechnicalQueryStatus(
                                q.id,
                                'Closed / Accepted',
                                q.bidderResponse,
                                'Clarification accepted by Lead Evaluation Engineer. Credential marked valid.'
                              );
                            }}
                            className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold rounded border border-emerald-200 transition-colors flex items-center gap-1"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" /> Accept & Close Query
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Technical Query Details & Action Panel (5 cols) */}
        <div className="lg:col-span-5">
          {selectedQueryForLetter ? (
            <div className="bg-white border border-slate-300 rounded-xl shadow-sm p-6 space-y-5 sticky top-6">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <div className="flex items-center gap-2">
                  <HelpCircle className="w-4 h-4 text-blue-600" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Query Record Details
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleEditClick(selectedQueryForLetter)}
                    className="p-1.5 text-slate-400 hover:text-blue-700 hover:bg-blue-100/70 rounded-md transition-colors"
                    title="Edit Query"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm('Are you sure you want to delete this technical query?')) {
                        deleteTechnicalQuery(selectedQueryForLetter.id);
                        setSelectedQueryForLetter(null);
                      }
                    }}
                    className="p-1.5 text-slate-400 hover:text-rose-700 hover:bg-rose-100/70 rounded-md transition-colors"
                    title="Delete Query"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                    {selectedQueryForLetter.tqRefNo}
                  </span>
                </div>
              </div>

              {/* Bidder & Tender Info */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Target Bidder:</span>
                  <strong className="text-slate-900">{selectedQueryForLetter.bidderName}</strong>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Tender Reference:</span>
                  <span className="font-mono text-slate-700">{criteria.tenderRef}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Status:</span>
                  <span className="font-semibold text-blue-700">{selectedQueryForLetter.status}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Response Deadline:</span>
                  <span className="font-bold text-rose-700">{selectedQueryForLetter.responseDeadline}</span>
                </div>
              </div>

              {/* Clause & Deficiency */}
              <div className="space-y-3 text-xs">
                <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-lg">
                  <strong className="text-blue-900 block mb-1">Clause Reference:</strong>
                  <span className="text-blue-950 font-medium">{selectedQueryForLetter.clauseRef}</span>
                </div>

                <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg">
                  <strong className="text-amber-900 block mb-1">Observed Deficiency:</strong>
                  <span className="text-amber-950">{selectedQueryForLetter.deficiency}</span>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <strong className="text-slate-900 block mb-1">Technical Clarification Required:</strong>
                  <p className="text-slate-800 leading-relaxed font-sans">{selectedQueryForLetter.queryText}</p>
                </div>
              </div>

              {/* Response Section */}
              {selectedQueryForLetter.bidderResponse ? (
                <div className="bg-emerald-50 border border-emerald-300 p-3.5 rounded-lg text-xs space-y-1">
                  <strong className="text-emerald-900 block">Bidder Clarification Response:</strong>
                  <p className="text-emerald-950 leading-relaxed font-sans">
                    "{selectedQueryForLetter.bidderResponse}"
                  </p>
                  <div className="text-[10px] text-emerald-700 pt-1">
                    Recorded: {selectedQueryForLetter.bidderResponseDate || 'Recently'}
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-slate-50 border border-dashed border-slate-300 rounded-lg text-xs text-slate-500 text-center">
                  Awaiting bidder clarification response against observed deficiency.
                </div>
              )}

              {/* Actions inside Details Card */}
              <div className="pt-2 flex items-center justify-end gap-2">
                {selectedQueryForLetter.status === 'Issued to Bidder' && (
                  <button
                    type="button"
                    onClick={() => {
                      setRespondingTq(selectedQueryForLetter);
                      setSimulatedResponse(
                        `We hereby submit the certified copy of the Client Completion Certificate with the endorsement of the Engineer-in-Charge confirming executed value of ₹${criteria.optionASingleWorkCr} Cr.`
                      );
                      setShowResponseModal(true);
                    }}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-xs transition"
                  >
                    Record Bidder Response
                  </button>
                )}

                {selectedQueryForLetter.status === 'Response Received' && (
                  <button
                    type="button"
                    onClick={() => {
                      updateTechnicalQueryStatus(
                        selectedQueryForLetter.id,
                        'Closed / Accepted',
                        selectedQueryForLetter.bidderResponse,
                        'Clarification accepted by Lead Evaluation Engineer. Credential marked valid.'
                      );
                    }}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-xs transition flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Accept & Close Query
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400">
              Select a query from the list to view deficiency details and resolution progress.
            </div>
          )}
        </div>
      </div>

      {/* New Query Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-lg w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Draft Custom Technical Query (TQ)</h3>

            <div>
              <label className="text-xs font-bold text-slate-700 uppercase">Target Bidder</label>
              <select
                value={newTqBidderId}
                onChange={(e) => setNewTqBidderId(e.target.value)}
                className="w-full mt-1 p-2 border border-slate-300 rounded-lg text-xs"
              >
                {ioclBidders.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.slNo}. {b.bidderName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 uppercase">Clause Reference</label>
              <input
                type="text"
                value={newClauseRef}
                onChange={(e) => setNewClauseRef(e.target.value)}
                className="w-full mt-1 p-2 border border-slate-300 rounded-lg text-xs"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 uppercase">Deficiency Observed</label>
              <textarea
                rows={2}
                placeholder="e.g. Work completion certificate missing EIC signature or Form 26AS mismatch..."
                value={newDeficiency}
                onChange={(e) => setNewDeficiency(e.target.value)}
                className="w-full mt-1 p-2 border border-slate-300 rounded-lg text-xs"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 uppercase">Query / Clarification Text</label>
              <textarea
                rows={3}
                placeholder="Bidder is requested to clarify whether..."
                value={newQueryText}
                onChange={(e) => setNewQueryText(e.target.value)}
                className="w-full mt-1 p-2 border border-slate-300 rounded-lg text-xs"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 uppercase">Statutory Response Deadline</label>
              <input
                type="date"
                value={newDeadline}
                onChange={(e) => setNewDeadline(e.target.value)}
                className="w-full mt-1 p-2 border border-slate-300 rounded-lg text-xs font-mono"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateNewQuery}
                className="px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-500 flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" /> Issue Query
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Query Modal */}
      {showEditModal && selectedQueryForLetter && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-lg w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Edit Technical Query (TQ)</h3>

            <div>
              <label className="text-xs font-bold text-slate-700 uppercase">Target Bidder</label>
              <select
                value={editTqBidderId}
                onChange={(e) => setEditTqBidderId(e.target.value)}
                className="w-full mt-1 p-2 border border-slate-300 rounded-lg text-xs"
              >
                {ioclBidders.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.slNo}. {b.bidderName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 uppercase">Clause Reference</label>
              <input
                type="text"
                value={editClauseRef}
                onChange={(e) => setEditClauseRef(e.target.value)}
                className="w-full mt-1 p-2 border border-slate-300 rounded-lg text-xs"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 uppercase">Deficiency Observed</label>
              <textarea
                rows={2}
                value={editDeficiency}
                onChange={(e) => setEditDeficiency(e.target.value)}
                className="w-full mt-1 p-2 border border-slate-300 rounded-lg text-xs"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 uppercase">Query / Clarification Text</label>
              <textarea
                rows={3}
                value={editQueryText}
                onChange={(e) => setEditQueryText(e.target.value)}
                className="w-full mt-1 p-2 border border-slate-300 rounded-lg text-xs"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 uppercase">Statutory Response Deadline</label>
              <input
                type="date"
                value={editDeadline}
                onChange={(e) => setEditDeadline(e.target.value)}
                className="w-full mt-1 p-2 border border-slate-300 rounded-lg text-xs font-mono"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                className="px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-500 flex items-center gap-1.5"
              >
                <Edit3 className="w-3.5 h-3.5" /> Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Response Simulation Modal */}
      {showResponseModal && respondingTq && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-lg w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-900">
              Record Bidder Clarification Response
            </h3>
            <p className="text-xs text-slate-500">
              TQ Ref: <strong>{respondingTq.tqRefNo}</strong> • {respondingTq.bidderName}
            </p>

            <div>
              <label className="text-xs font-bold text-slate-700 uppercase">Bidder Written Clarification</label>
              <textarea
                rows={4}
                value={simulatedResponse}
                onChange={(e) => setSimulatedResponse(e.target.value)}
                className="w-full mt-1 p-2 border border-slate-300 rounded-lg text-xs"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowResponseModal(false)}
                className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  updateTechnicalQueryStatus(
                    respondingTq.id,
                    'Response Received',
                    simulatedResponse,
                    'Response recorded on portal. Awaiting committee acceptance.'
                  );
                  setShowResponseModal(false);
                }}
                className="px-4 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-500 flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Record Clarification
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 1-Click AI Technical Query Generator Modal */}
      <OneClickQueryGeneratorModal
        isOpen={showAiModal}
        onClose={() => setShowAiModal(false)}
        initialBidderId={aiModalBidderId}
        initialWoNumber={aiModalWoNumber}
        initialDeficiency={aiModalDeficiency}
        onQueryGenerated={(q) => {
          setSelectedQueryForLetter(q);
        }}
      />
    </div>
  );
};
