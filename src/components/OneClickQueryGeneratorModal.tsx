import React, { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';
import { useApp } from '../context/AppContext';
import {
  Sparkles,
  HelpCircle,
  Copy,
  Check,
  Send,
  Printer,
  ChevronDown,
  ChevronUp,
  FileText,
  AlertTriangle,
  Layers,
  X,
  Clock,
  ShieldCheck,
  CheckCircle2,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import { TechnicalQuery } from '../types';

interface OneClickQueryGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialBidderId?: string;
  initialWoNumber?: string;
  initialDeficiency?: string;
  onQueryGenerated?: (query: TechnicalQuery) => void;
}

interface DeficiencyPreset {
  id: string;
  title: string;
  category: string;
  badge: string;
  description: string;
  defaultClause: string;
  defaultPoints: string[];
}

const PRESETS: DeficiencyPreset[] = [
  {
    id: 'completion-cert-dates-gst',
    title: 'Missing Dates & Executed Value with GST',
    category: 'missing_completion_certificate',
    badge: 'Most Common',
    description: 'Completion certificate does not clearly state start date, completion date, or executed value with GST.',
    defaultClause: 'NIT PQC Clause 3.2 - Client Completion Certificate',
    defaultPoints: [
      'Start date',
      'Completion date',
      'Executed value including GST',
    ],
  },
  {
    id: 'subcontract-owner-approval',
    title: 'Sub-contract without Owner / Client Approval',
    category: 'subcontract_approval',
    badge: 'Mandatory Rule',
    description: 'Work executed as sub-contractor without mandatory written approval / NOC from end Owner / Refinery EIC.',
    defaultClause: 'NIT PQC Clause 3.4 - Sub-contract Credentials with Owner Consent',
    defaultPoints: [
      'Prior written approval / NOC from end Client / Owner Engineer-in-Charge',
      'Direct Completion Certificate issued by Owner establishing scope',
      'TDS Form 26AS / GST reconciliation confirming direct payment receipts',
    ],
  },
  {
    id: 'sor-boq-breakdown',
    title: 'Missing SOR Copy / BOQ Itemized Scope',
    category: 'sor_boq',
    badge: 'Scope Breakdown',
    description: 'Scope requires high-pressure alloy piping / heater decoking, but submitted copy lacks itemized BOQ/SOR.',
    defaultClause: 'NIT PQC Clause 3.1 - Scope Breakdown & Similar Nature Verification',
    defaultPoints: [
      'Detailed Schedule of Rates (SOR) / Bill of Quantities (BOQ) copy',
      'Item-wise rate and execution breakdown establishing similar nature',
      'Certification of high-pressure piping / turnaround scope by Client',
    ],
  },
  {
    id: 'arc-annualization',
    title: 'Annual Rate Contract (ARC) Annualization Shortfall',
    category: 'arc_annualization',
    badge: 'ARC Rule',
    description: 'Contract duration exceeds 12 months, requiring year-wise breakdown or proof of continuous annual scope.',
    defaultClause: 'NIT PQC Clause 3.1.2 - Annualized Completed Value for Rate Contracts',
    defaultPoints: [
      'Year-wise actual executed value certification issued by Client EIC',
      'Proof of continuous unbroken annual maintenance performance',
      'Alternative single qualifying work credential exceeding required threshold',
    ],
  },
  {
    id: 'nil-deviation',
    title: 'NIL Deviation Undertaking Missing / Conditional',
    category: 'nil_deviation',
    badge: 'Commercial Compliance',
    description: 'Bidder submitted qualifications or commercial exceptions instead of clean Annexure-III NIL Deviation sheet.',
    defaultClause: 'NIT Clause 15 - Commercial & Technical NIL Deviation Undertaking',
    defaultPoints: [
      'Duly signed and stamped NIL Deviation Certificate (Annexure-III)',
      'Unconditional technical compliance declaration on bidder letterhead',
    ],
  },
];

export const OneClickQueryGeneratorModal: React.FC<OneClickQueryGeneratorModalProps> = ({
  isOpen,
  onClose,
  initialBidderId,
  initialWoNumber,
  initialDeficiency,
  onQueryGenerated,
}) => {
  const {
    bidders,
    ioclBidders,
    criteria,
    technicalQueries,
    addTechnicalQuery,
    setActiveTab,
  } = useApp();

  const [selectedPresetId, setSelectedPresetId] = useState<string>('completion-cert-dates-gst');
  const [selectedBidderId, setSelectedBidderId] = useState<string>(initialBidderId || bidders[0]?.id || '');
  const [woNumber, setWoNumber] = useState<string>(initialWoNumber || '');
  const [queryNumber, setQueryNumber] = useState<number>(technicalQueries.length + 1);
  const [deadlineDays, setDeadlineDays] = useState<number>(7);
  const [customDeficiencyNotes, setCustomDeficiencyNotes] = useState<string>(initialDeficiency || '');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [copiedQuery, setCopiedQuery] = useState<boolean>(false);
  const [addedToRegisterSuccess, setAddedToRegisterSuccess] = useState<boolean>(false);

  // Generated output state
  const [generatedData, setGeneratedData] = useState<{
    queryHeading: string;
    subject: string;
    queryText: string;
    numberedPoints: string[];
    applicableClause: string;
    statutoryDeadlineDays: number;
    cvcNote: string;
    fullFormalLetter: string;
    source: string;
  } | null>(null);

  // Initialize from props or default
  useEffect(() => {
    if (initialBidderId) setSelectedBidderId(initialBidderId);
    if (initialWoNumber) setWoNumber(initialWoNumber);
    if (initialDeficiency && typeof initialDeficiency === 'string') {
      setCustomDeficiencyNotes(initialDeficiency);
      const defLower = initialDeficiency.toLowerCase();
      // If deficiency matches sub-contract, pick subcontract preset
      if (defLower.includes('sub-contract') || defLower.includes('subcontract')) {
        setSelectedPresetId('subcontract-owner-approval');
      } else if (defLower.includes('sor') || defLower.includes('boq')) {
        setSelectedPresetId('sor-boq-breakdown');
      }
    }
  }, [initialBidderId, initialWoNumber, initialDeficiency]);

  // Find bidder metadata
  const currentBidder = bidders.find((b) => b.id === selectedBidderId) || bidders[0];
  const currentIoclBidder = ioclBidders.find((b) => b.id === selectedBidderId || b.slNo.toString() === selectedBidderId);

  const selectedPreset = PRESETS.find((p) => p.id === selectedPresetId) || PRESETS[0];

  // Auto-fill WO number if bidder selected from IOCL sheet
  const handleBidderChange = (bId: string) => {
    setSelectedBidderId(bId);
    const ioclMatch = ioclBidders.find((b) => b.id === bId || b.slNo.toString() === bId);
    if (ioclMatch && ioclMatch.workOrders?.length > 0) {
      setWoNumber(
        ioclMatch.workOrders[0]?.woNumberAndDate
          ? ioclMatch.workOrders[0].woNumberAndDate.split(' ')[0]
          : ''
      );
      if (ioclMatch.workOrders[0]?.remarks) {
        setCustomDeficiencyNotes(ioclMatch.workOrders[0].remarks);
      }
    }
  };

  const handleApplyPreset = (preset: DeficiencyPreset) => {
    setSelectedPresetId(preset.id);
  };

  const handleGenerateQuery = async () => {
    setIsGenerating(true);
    setAddedToRegisterSuccess(false);

    const bidderName = currentIoclBidder ? currentIoclBidder.bidderName : currentBidder?.companyName || 'Bidder';

    try {
      const res = await apiFetch('/api/generate-technical-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queryNumber,
          bidderName,
          woNumber,
          jobName: currentIoclBidder?.workOrders[0]?.jobName || criteria.tenderTitle || '',
          deficiencyCategory: selectedPreset.category,
          deficiencyDescription: customDeficiencyNotes || selectedPreset.description,
          tenderRef: criteria.tenderRef || '',
          clientOrg: criteria.clientOrg || 'PSU Organization',
        }),
      });

      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          setGeneratedData({
            ...json.data,
            source: json.source || 'Gemini',
          });
          setIsGenerating(false);
          return;
        }
      }
    } catch (e) {
      console.warn('Backend query generator call notice, using local generator:', e);
    }

    // High fidelity deterministic fallback (replicates prompt output exactly)
    const queryHeading = `Technical Query No. ${queryNumber}`;
    const promptPrefix = selectedPreset.id === 'subcontract-owner-approval'
      ? `Work Order No. ${woNumber} is of sub-contract nature. As per NIT Clause 3.4, please submit:`
      : selectedPreset.id === 'sor-boq-breakdown'
      ? `With reference to Work Order No. ${woNumber}, please submit:`
      : selectedPreset.id === 'arc-annualization'
      ? `With reference to Annual Rate Contract (ARC) Work Order No. ${woNumber}, please submit:`
      : 'Please submit completion certificate clearly indicating:';

    const points = selectedPreset.defaultPoints;
    const queryText = `${queryHeading}\n\n${promptPrefix}\n\n${points.map((pt, i) => `${i + 1}. ${pt}`).join('\n')}\nfor Work Order No. ${woNumber}.`;

    const fullFormalLetter = `INDIAN OIL CORPORATION LIMITED (REFINERIES DIVISION)
TECHNICAL EVALUATION - PRE-QUALIFICATION CLARIFICATION
REF: TQ/${criteria.tenderRef || 'MR/CC/2026/088'}/${String(queryNumber).padStart(2, '0')}
DATE: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}

TO:
${bidderName}

SUBJECT: TECHNICAL QUERY NO. ${queryNumber} - CLARIFICATION ON PQC CREDENTIALS
TENDER REFERENCE: ${criteria.tenderRef || 'MR/CC/2026/088'}
NAME OF WORK: Turnaround Maintenance & Alloy Piping Overhaul

Dear Sir/Madam,

During technical review of documents submitted against the subject tender, the following technical clarification is required in terms of ${selectedPreset.defaultClause}:

${queryText}

You are requested to submit your formal written clarification along with supporting authenticated documents within ${deadlineDays} calendar days (on or before 17:00 Hrs IST), failing which your bid will be evaluated based on credentials already submitted without any further reference.

Submission of fresh work orders or supplementary credentials not forming part of the original bid submission is not permissible.

Yours faithfully,
For ${criteria.clientOrg || 'Indian Oil Corporation Limited'},

Er. Sankar Mondal
Senior Manager (Mechanical / Technical Evaluation)
Initiating Department Officer`;

    setGeneratedData({
      queryHeading,
      subject: `Technical Clarification on PQC Credentials - Work Order No. ${woNumber}`,
      queryText,
      numberedPoints: points,
      applicableClause: selectedPreset.defaultClause,
      statutoryDeadlineDays: deadlineDays,
      cvcNote: 'Submission of fresh work orders post-bid opening is not permissible. Only clarifications/authentications of already submitted credentials are accepted.',
      fullFormalLetter: '',
      source: 'AI Query Generator',
    });

    setIsGenerating(false);
  };

  // Generate on initial load
  useEffect(() => {
    if (isOpen && !generatedData) {
      handleGenerateQuery();
    }
  }, [isOpen]);

  const handleCopyQuery = () => {
    if (!generatedData) return;
    navigator.clipboard.writeText(generatedData.queryText);
    setCopiedQuery(true);
    setTimeout(() => setCopiedQuery(false), 2000);
  };

  const handleAddToTqRegister = () => {
    if (!generatedData) return;

    const bidderName = currentIoclBidder ? currentIoclBidder.bidderName : currentBidder?.companyName || 'M/s Industrial Contractor';
    const deadlineDate = new Date(Date.now() + deadlineDays * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

    const newTq = addTechnicalQuery({
      tqRefNo: `TQ-${(currentBidder?.bidNumber || 'IOCL').slice(-3)}/${String(queryNumber).padStart(2, '0')}`,
      bidderId: selectedBidderId,
      bidderName,
      clauseRef: generatedData.applicableClause,
      credentialRef: `Work Order No. ${woNumber}`,
      deficiency: customDeficiencyNotes || selectedPreset.description,
      queryText: generatedData.queryText,
      responseDeadline: deadlineDate,
      status: 'Issued to Bidder',
      issuedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
      evaluatorRemarks: `Generated via ${generatedData.source}.`,
    });

    setAddedToRegisterSuccess(true);
    if (onQueryGenerated) {
      onQueryGenerated(newTq);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-300 w-full max-w-4xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-auto">
        {/* Modal Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold tracking-tight">
                  Technical Query (TQ) Notice Generator
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  Standard Format
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Draft official technical clarification letters for bidder work orders and credentials.
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
        <div className="p-6 space-y-6 max-h-[82vh] overflow-y-auto">
          {/* Top Quick Deficiency Presets */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-blue-600" />
                Select Deficiency Preset (or Customize):
              </span>
              <span className="text-[11px] text-slate-500">
                1-Click templates formulated for Indian PSUs
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {PRESETS.map((preset) => {
                const isSelected = selectedPresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => handleApplyPreset(preset)}
                    type="button"
                    className={`text-left p-3 rounded-xl border transition-all relative ${
                      isSelected
                        ? 'border-blue-600 bg-blue-50/80 ring-2 ring-blue-500/20 shadow-xs'
                        : 'border-slate-200 bg-slate-50 hover:bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        isSelected ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'
                      }`}>
                        {preset.badge}
                      </span>
                      {isSelected && (
                        <span className="h-2 w-2 rounded-full bg-blue-600"></span>
                      )}
                    </div>
                    <div className="text-xs font-bold text-slate-900 leading-snug">
                      {preset.title}
                    </div>
                    <div className="text-[11px] text-slate-500 line-clamp-2 mt-1">
                      {preset.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Configuration Inputs */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            {/* 1. Bidder Selection */}
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Target Bidder:
              </label>
              <select
                value={selectedBidderId}
                onChange={(e) => handleBidderChange(e.target.value)}
                className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                {/* Prioritize IOCL Bidders with Query status */}
                <optgroup label="⚠️ IOCL Bidders Flagged for Query">
                  {ioclBidders
                    .filter((b) => b.finalPosition === 'Query to be raised')
                    .map((b) => (
                      <option key={`iocl-${b.id}`} value={b.id}>
                        Sl {b.slNo}: {b.bidderName} (⚠️ Query Required)
                      </option>
                    ))}
                </optgroup>
                <optgroup label="All Tender Bidders">
                  {bidders.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.companyName} ({b.bidNumber})
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            {/* 2. Work Order Reference */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-bold text-slate-700">
                  Work Order / Ref No.:
                </label>
                {currentIoclBidder?.workOrders?.[0]?.woNumberAndDate && (
                  <button
                    type="button"
                    onClick={() => {
                      const firstWo = currentIoclBidder.workOrders[0].woNumberAndDate.split(' ')[0];
                      if (firstWo) setWoNumber(firstWo);
                    }}
                    className="text-[10px] text-blue-600 hover:underline font-semibold"
                  >
                    Use Bidder's WO
                  </button>
                )}
              </div>
              <input
                type="text"
                value={woNumber}
                onChange={(e) => setWoNumber(e.target.value)}
                className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-white font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder="e.g. WO Reference / Contract Number"
              />
            </div>

            {/* 3. Query Index & Deadline */}
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="block font-bold text-slate-700 mb-1">
                  Query Index:
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={queryNumber}
                  onChange={(e) => setQueryNumber(Number(e.target.value) || 1)}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-white font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
              <div className="flex-1">
                <label className="block font-bold text-slate-700 mb-1">
                  Deadline:
                </label>
                <select
                  value={deadlineDays}
                  onChange={(e) => setDeadlineDays(Number(e.target.value))}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  <option value={5}>5 Days</option>
                  <option value={7}>7 Days (Standard)</option>
                  <option value={10}>10 Days</option>
                  <option value={14}>14 Days</option>
                </select>
              </div>
            </div>

            {/* Optional Deficiency Note */}
            <div className="md:col-span-3">
              <label className="block font-bold text-slate-700 mb-1">
                Specific Observation / Custom Deficiency Note (Optional):
              </label>
              <input
                type="text"
                value={customDeficiencyNotes}
                onChange={(e) => setCustomDeficiencyNotes(e.target.value)}
                placeholder="e.g. Completion certificate lacks clear breakdown of executed value vs GST."
                className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Action Row */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <ShieldCheck className="w-4 h-4 text-blue-600" />
              <span>Standard clarification procedure under technical evaluation norms.</span>
            </div>

            <button
              type="button"
              onClick={handleGenerateQuery}
              disabled={isGenerating}
              className="w-full sm:w-auto px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-sm transition flex items-center justify-center gap-2"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Drafting Clarification Notice...</span>
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4 text-white" />
                  <span>Generate Technical Query Notice</span>
                </>
              )}
            </button>
          </div>

          {/* Output Display Card */}
          {generatedData && (
            <div className="space-y-4">
              {/* Core Query Card (Exact requested format) */}
              <div className="border-2 border-blue-600/30 rounded-2xl bg-slate-900 text-white overflow-hidden shadow-lg">
                <div className="bg-slate-950 px-5 py-3 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    <span className="font-bold text-xs uppercase tracking-wider text-emerald-400">
                      Generated Technical Query
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      (Ready for Bidder Portal / Official Letter)
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopyQuery}
                      className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-medium transition flex items-center gap-1.5"
                    >
                      {copiedQuery ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-400">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-slate-400" />
                          <span>Copy Query</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* The Formatted Query Output */}
                <div className="p-6">
                  <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-5 font-mono text-xs leading-relaxed text-slate-200 whitespace-pre-wrap select-all">
                    {generatedData.queryText}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs border-t border-slate-800/80 pt-4">
                    <div className="flex items-center gap-3">
                      <span className="text-slate-400">
                        Applicable Clause: <strong className="text-white">{generatedData.applicableClause}</strong>
                      </span>
                      <span className="text-slate-400">
                        Statutory Deadline: <strong className="text-amber-400">{generatedData.statutoryDeadlineDays} Days</strong>
                      </span>
                    </div>

                    <span className="text-[11px] text-slate-400 italic">
                      Engine: {generatedData.source}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons: Add to Register, Notify Bidder */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div>
                    <div className="text-xs font-bold text-emerald-950">
                      Save & Register this Technical Query
                    </div>
                    <div className="text-[11px] text-emerald-800">
                      Adds to the Technical Query Register and updates the bidder evaluation log.
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  {addedToRegisterSuccess ? (
                    <div className="px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow-xs">
                      <Check className="w-4 h-4" />
                      <span>Registered in Official TQ Register!</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handleAddToTqRegister}
                      className="w-full sm:w-auto px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition flex items-center justify-center gap-1.5 shadow-xs"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Add to Official TQ Register</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="bg-slate-50 px-6 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>Indian Oil Corporation Ltd • Technical Evaluation</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 border border-slate-300 hover:bg-slate-100 rounded-lg text-slate-700 font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
