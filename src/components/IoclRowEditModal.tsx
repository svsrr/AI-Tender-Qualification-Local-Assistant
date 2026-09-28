import React, { useState } from 'react';
import { FINAL_POSITION_OPTIONS, FinalPosition, IoclBidderEvaluation, IoclWorkOrderEntry, isOneTimeJobTender, WO_STATUS_OPTIONS, WoStatus } from '../types';
import {
  annualisedLacs,
  contractDurationBetween,
  durationMonthsBetween,
  formatContractDuration,
  evaluateBidderWorkOrders,
  finalPositionForStatus,
  isValueRuleRemark,
  resolvePqcThresholdsLacs,
  resolveSimilarNatureClause,
  rowAfterSimilarNatureEdit,
} from '../utils/tbaRules';
import { useApp } from '../context/AppContext';
import {
  X,
  Save,
  Calculator,
  AlertCircle,
  CheckCircle2,
  FileEdit,
  Building2,
  Calendar,
  Layers,
  Trash2,
} from 'lucide-react';

interface IoclRowEditModalProps {
  bidder: IoclBidderEvaluation;
  workOrder: IoclWorkOrderEntry;
  onClose: () => void;
}

export const IoclRowEditModal: React.FC<IoclRowEditModalProps> = ({
  bidder,
  workOrder,
  onClose,
}) => {
  const { confirmIoclWorkOrder, updateIoclWorkOrder, updateIoclBidder, deleteIoclWorkOrder, deleteIoclBidder, ioclMetadata, criteria } = useApp();
  const showApqc = Boolean(ioclMetadata?.hasApqc);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const isOneTimeJob = isOneTimeJobTender(ioclMetadata?.typeOfJob, criteria?.arcAnnualizationAllowed);
  const similarClause = resolveSimilarNatureClause(ioclMetadata, criteria);
  // Set when the engineer overturns a similar-nature rejection: they must say why it is accepted.
  const [needsAcceptanceRemark, setNeedsAcceptanceRemark] = useState(false);

  // Rows saved before column 5 drove the status can read No yet still be accepted; open them as rejected.
  const inconsistentRejection =
    workOrder.meetsSimilarNature === 'No' && workOrder.woStatus !== 'WO Rejected'
      ? rowAfterSimilarNatureEdit(workOrder, { woStatus: workOrder.woStatus, remarks: workOrder.remarks }, 'No', similarClause)
      : null;

  const [formData, setFormData] = useState({
    bidderName: bidder.bidderName,
    cityState: bidder.cityState || 'Bhubaneswar, Odisha',
    woNumberAndDate: workOrder.woNumberAndDate,
    issuingOrg: workOrder.issuingOrg,
    jobName: workOrder.jobName,
    meetsSimilarNature: workOrder.meetsSimilarNature,
    compCertSubmitted: workOrder.compCertSubmitted,
    isSubcontract: workOrder.isSubcontract,
    ownerApprovalSubmitted: workOrder.ownerApprovalSubmitted,
    startDate: workOrder.startDate,
    compDate: workOrder.compDate,
    durationMonths: workOrder.durationMonths,
    woValueLacs: workOrder.woValueLacs?.toString() || '',
    compValueLacs: workOrder.compValueLacs?.toString() || '',
    annualisedValueLacs: workOrder.annualisedValueLacs?.toString() || '',
    nilDeviationSheet: workOrder.nilDeviationSheet,
    ...(inconsistentRejection
      ? { woStatus: inconsistentRejection.woStatus, remarks: inconsistentRejection.remarks, finalPosition: 'Technically Rejected' as FinalPosition | '' }
      : {
          woStatus: workOrder.woStatus,
          remarks: workOrder.remarks,
          finalPosition: (workOrder.finalPosition ?? finalPositionForStatus(workOrder.woStatus) ?? '') as FinalPosition | '',
        }),
    apqcDocumentNo: workOrder.apqcDocumentNo || '',
    meetsApqc: workOrder.meetsApqc || 'NA',
    editReason: 'Manual verification review as per scanned records',
  });

  // Column 5 drives the recommendation: No rejects the work order with the NIT clause remark.
  const handleSimilarNatureChange = (verdict: 'Yes' | 'No' | 'To verify') => {
    const next = rowAfterSimilarNatureEdit(
      { ...workOrder, woNumberAndDate: formData.woNumberAndDate },
      { woStatus: formData.woStatus, remarks: formData.remarks },
      verdict,
      similarClause
    );
    setNeedsAcceptanceRemark(next.needsAcceptanceRemark);
    setFormData({ ...formData, meetsSimilarNature: verdict, woStatus: next.woStatus, finalPosition: next.finalPosition ?? '', remarks: next.remarks });
  };

  // Calculate annualised value
  const handleRecalculateAnnualised = () => {
    const fromDates = durationMonthsBetween(formData.startDate, formData.compDate, !isOneTimeJob);
    const stated = String(formData.durationMonths || '')
      .split('+')
      .map((p) => parseFloat(p.replace(/[^0-9.]/g, '')))
      .filter((n) => !isNaN(n))
      .reduce((a, b) => a + b, 0);
    const months = fromDates ?? (stated > 0 ? stated : null);
    const compVal = formData.compValueLacs ? parseFloat(formData.compValueLacs) : null;
    const annualised = annualisedLacs(compVal !== null && !isNaN(compVal) ? compVal : null, months, true);
    const nextAnnualised = annualised !== null ? annualised : (formData.annualisedValueLacs ? parseFloat(formData.annualisedValueLacs) : null);

    // A new value can change the decision, so re-judge the row against the PQC value criterion
    // together with the bidder's other work orders, and rewrite the status and remark to match.
    // A query or rejection for another reason (documents, similar nature) is kept as it is.
    const valueDecided = formData.woStatus.startsWith('WO Accepted') || isValueRuleRemark(formData.remarks);
    const formRow: IoclWorkOrderEntry = {
      ...workOrder,
      woNumberAndDate: formData.woNumberAndDate,
      meetsSimilarNature: formData.meetsSimilarNature,
      isSubcontract: formData.isSubcontract,
      ownerApprovalSubmitted: formData.ownerApprovalSubmitted,
      compValueLacs: compVal !== null && !isNaN(compVal) ? compVal : null,
      annualisedValueLacs: nextAnnualised !== null && !isNaN(nextAnnualised) ? nextAnnualised : null,
      woStatus: formData.woStatus,
      remarks: formData.remarks,
      aiExtractionStatus: valueDecided ? 'WO Accepted(1 WO)' : formData.woStatus,
      aiExtractionRemarks: valueDecided ? '' : formData.remarks,
    };
    const suggestion = evaluateBidderWorkOrders(
      bidder.workOrders,
      {
        thresholds: resolvePqcThresholdsLacs(ioclMetadata, criteria),
        isArcTender: !isOneTimeJob,
        similarNatureClause: similarClause,
        nit: ioclMetadata,
        claimedOrders: bidder.claimedOrders,
      },
      { id: workOrder.id, row: formRow, treatAsUnconfirmed: true }
    ).suggestions[workOrder.id];

    setFormData((prev) => ({
      ...prev,
      durationMonths: fromDates !== null ? String(fromDates) : prev.durationMonths,
      annualisedValueLacs: annualised !== null ? annualised.toString() : prev.annualisedValueLacs,
      ...(suggestion
        ? {
            woStatus: suggestion.woStatus,
            finalPosition: (suggestion.finalPosition ?? '') as FinalPosition | '',
            // Keep the engineer's similar-nature justification, if one is being written.
            remarks: needsAcceptanceRemark && prev.remarks.trim() ? `${prev.remarks.trim()} ${suggestion.remarks}` : suggestion.remarks,
          }
        : {}),
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const start = formData.startDate;
    const comp = formData.compDate;
    const dur = parseFloat(formData.durationMonths || '0');
    const woVal = formData.woValueLacs ? parseFloat(formData.woValueLacs) : null;
    const compVal = formData.compValueLacs ? parseFloat(formData.compValueLacs) : null;

    // Validate Dates: Completion cannot be before Start Date
    if (start && comp) {
      const [ds, ms, ys] = start.split('-').map(Number);
      const [dc, mc, yc] = comp.split('-').map(Number);
      const startDateObj = new Date(ys, ms - 1, ds);
      const compDateObj = new Date(yc, mc - 1, dc);
      
      if (!isNaN(startDateObj.getTime()) && !isNaN(compDateObj.getTime()) && compDateObj < startDateObj) {
        alert("Completion date cannot be before start date.");
        return;
      }
    }

    // Validate Duration: Cannot be negative
    if (!isNaN(dur) && dur < 0) {
      alert("Duration of job cannot be negative.");
      return;
    }

    // Validate Values: Cannot be negative
    if ((woVal !== null && woVal < 0) || (compVal !== null && compVal < 0)) {
      alert("Work order value cannot be negative.");
      return;
    }

    if (needsAcceptanceRemark && !formData.remarks.trim()) {
      alert('Please add a remark explaining why this work order is accepted as similar nature.');
      return;
    }

    const annValParsed = isOneTimeJob ? null : (formData.annualisedValueLacs ? parseFloat(formData.annualisedValueLacs) : null);

    // An edited amount no longer corresponds to the original ex-GST figure, so the stored
    // base (used for the =base*1.18 export formula) is dropped rather than left stale.
    const woValueChanged = woVal !== workOrder.woValueLacs;
    const compValueChanged = compVal !== workOrder.compValueLacs;

    confirmIoclWorkOrder(bidder.id, workOrder.id, {
      woNumberAndDate: formData.woNumberAndDate,
      issuingOrg: formData.issuingOrg,
      jobName: formData.jobName,
      meetsSimilarNature: formData.meetsSimilarNature,
      compCertSubmitted: formData.compCertSubmitted,
      isSubcontract: formData.isSubcontract,
      ownerApprovalSubmitted: formData.ownerApprovalSubmitted,
      startDate: formData.startDate,
      compDate: formData.compDate,
      durationMonths: formData.durationMonths,
      woValueLacs: woVal,
      compValueLacs: compVal,
      annualisedValueLacs: annValParsed,
      nilDeviationSheet: formData.nilDeviationSheet,
      woStatus: formData.woStatus,
      finalPosition: formData.finalPosition || undefined,
      remarks: formData.remarks,
      ...(woValueChanged ? { woValueBaseLacs: null, woValueGstBasis: 'Incl. GST' as const } : {}),
      ...(compValueChanged ? { compValueBaseLacs: null, compValueGstBasis: 'Incl. GST' as const } : {}),
      ...(showApqc ? { apqcDocumentNo: formData.apqcDocumentNo, meetsApqc: formData.meetsApqc as 'Yes' | 'No' | 'NA' } : {}),
    });

    // The NIL deviation undertaking covers the whole bid, so the other work orders follow this one.
    if (formData.nilDeviationSheet !== workOrder.nilDeviationSheet) {
      bidder.workOrders
        .filter((wo) => wo.id !== workOrder.id)
        .forEach((wo) => updateIoclWorkOrder(bidder.id, wo.id, { nilDeviationSheet: formData.nilDeviationSheet }));
    }

    if (formData.bidderName !== bidder.bidderName || formData.cityState !== bidder.cityState) {
      updateIoclBidder(bidder.id, {
        bidderName: formData.bidderName,
        cityState: formData.cityState,
      });
    }

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-300 w-full max-w-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-6 py-4 bg-slate-800 text-white">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded bg-blue-600/30 text-blue-400">
              <FileEdit className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base">
                Edit Row — Sl #{bidder.slNo}
              </h3>
              <p className="text-xs text-slate-300">
                {bidder.bidderName} — {workOrder.woNumberAndDate}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
          {/* Column #2: Bidder Name & Registered Location */}
          <div className="p-3 bg-blue-50/70 rounded-lg border border-blue-200 space-y-2">
            <div className="text-[11px] font-bold text-blue-900 uppercase tracking-wider flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-blue-600" />
              <span>Column #2: Bidder Name &amp; Registered Location</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Bidder / Company Name</label>
                <input
                  type="text"
                  required
                  value={formData.bidderName}
                  onChange={(e) => setFormData({ ...formData, bidderName: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded font-semibold text-slate-900 focus:ring-2 focus:ring-blue-500 bg-white"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">City, State Location</label>
                <input
                  type="text"
                  value={formData.cityState}
                  onChange={(e) => setFormData({ ...formData, cityState: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-slate-900 focus:ring-2 focus:ring-blue-500 bg-white"
                />
              </div>
            </div>
          </div>

          {/* WO details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">
                Column #3: Work Order No., Date & Issuing Org
              </label>
              <textarea
                rows={2}
                value={formData.woNumberAndDate}
                onChange={(e) => setFormData({ ...formData, woNumberAndDate: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 font-mono text-xs"
                required
              />
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">
                Column #4: Job Name (Scope of Work)
              </label>
              <textarea
                rows={2}
                value={formData.jobName}
                onChange={(e) => setFormData({ ...formData, jobName: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 text-xs"
                required
              />
            </div>
          </div>

          {/* Compliance flags */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 bg-slate-50 rounded border border-slate-200">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">#5 Similar Nature</label>
              <select
                value={formData.meetsSimilarNature}
                onChange={(e) => handleSimilarNatureChange(e.target.value as 'Yes' | 'No' | 'To verify')}
                className="w-full px-2 py-1.5 border border-slate-300 rounded bg-white"
              >
                <option value="Yes">Yes (Complies)</option>
                <option value="No">No (Does Not Comply)</option>
                <option value="To verify">To verify</option>
              </select>
              {workOrder.similarNatureReason && (
                <p className="mt-1 text-[10px] text-slate-500 leading-snug">AI: {workOrder.similarNatureReason}</p>
              )}
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">#6 Comp Certificate</label>
              <select
                value={formData.compCertSubmitted}
                onChange={(e) => setFormData({ ...formData, compCertSubmitted: e.target.value as 'Yes' | 'No' })}
                className="w-full px-2 py-1.5 border border-slate-300 rounded bg-white"
              >
                <option value="Yes">Yes (Submitted)</option>
                <option value="No">No (Missing)</option>
              </select>
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">#7 Sub Contract?</label>
              <select
                value={formData.isSubcontract}
                onChange={(e) => setFormData({ ...formData, isSubcontract: e.target.value as 'Yes' | 'No' })}
                className="w-full px-2 py-1.5 border border-slate-300 rounded bg-white"
              >
                <option value="No">No (Main Contractor)</option>
                <option value="Yes">Yes (Sub-Contract)</option>
              </select>
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">#8 Owner Approval</label>
              <select
                value={formData.ownerApprovalSubmitted}
                onChange={(e) => setFormData({ ...formData, ownerApprovalSubmitted: e.target.value as 'Yes' | 'No' | 'NA' })}
                className="w-full px-2 py-1.5 border border-slate-300 rounded bg-white"
              >
                <option value="NA">NA (Main Contract)</option>
                <option value="Yes">Yes (Owner NOC Verified)</option>
                <option value="No">No (No Owner Approval)</option>
              </select>
            </div>
          </div>

          {/* Dates & Values */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">#9 Start Date</label>
              <input
                type="text"
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                className="w-full px-2 py-1.5 border border-slate-300 rounded font-mono"
                placeholder="DD-MM-YYYY"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">#10 Completion Date</label>
              <input
                type="text"
                value={formData.compDate}
                onChange={(e) => setFormData({ ...formData, compDate: e.target.value })}
                className="w-full px-2 py-1.5 border border-slate-300 rounded font-mono"
                placeholder="DD-MM-YYYY"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">#11 Duration (Months)</label>
              <input
                type="text"
                value={formData.durationMonths}
                onChange={(e) => setFormData({ ...formData, durationMonths: e.target.value })}
                className="w-full px-2 py-1.5 border border-slate-300 rounded font-mono"
                placeholder="e.g. 12 or 24"
              />
              {formatContractDuration(contractDurationBetween(formData.startDate, formData.compDate)) && (
                <div className="text-[10px] text-slate-500 mt-1">
                  From the dates: {formatContractDuration(contractDurationBetween(formData.startDate, formData.compDate))}
                  {' '}(= {durationMonthsBetween(formData.startDate, formData.compDate, !isOneTimeJob)} months)
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">#12 WO Value (Lacs Incl GST)</label>
              <input
                type="number"
                step="0.01"
                value={formData.woValueLacs}
                onChange={(e) => setFormData({ ...formData, woValueLacs: e.target.value })}
                className="w-full px-2 py-1.5 border border-slate-300 rounded font-mono"
                placeholder="₹ In Lacs"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">#13 Comp Value (Lacs Incl GST)</label>
              <input
                type="number"
                step="0.01"
                value={formData.compValueLacs}
                onChange={(e) => setFormData({ ...formData, compValueLacs: e.target.value })}
                className="w-full px-2 py-1.5 border border-slate-300 rounded font-mono font-bold"
                placeholder="₹ In Lacs"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-semibold text-purple-900">#14 Annualised Value (ARC)</label>
                {isOneTimeJob ? (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-bold border border-slate-300">
                    NA (One-Time Job)
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleRecalculateAnnualised}
                    className="text-[10px] text-purple-700 underline hover:text-purple-900 font-semibold"
                    title="Recalculate: (Amount × 12 / Duration). If duration < 12 months, job is considered to have taken in a 1-year time."
                  >
                    Recalculate (Pro-rata)
                  </button>
                )}
              </div>
              {isOneTimeJob ? (
                <div className="p-2.5 bg-slate-50 border border-slate-300 rounded text-xs text-slate-700 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold font-mono text-slate-800 text-sm">NA</span>
                    <span className="text-[10px] text-slate-500 font-medium">Criteria Not Invoked</span>
                  </div>
                  <p className="text-[10.5px] text-slate-600 leading-tight">
                    For <strong>One-Time Jobs</strong>, annualized WO value criteria is kept as <strong>NA</strong>. The completed value in Col 13 is evaluated directly at 100% full value without annualization.
                  </p>
                </div>
              ) : (
                <>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.annualisedValueLacs}
                    onChange={(e) => setFormData({ ...formData, annualisedValueLacs: e.target.value })}
                    className="w-full px-2 py-1.5 border border-purple-300 bg-purple-50 rounded font-mono font-bold text-purple-900"
                    placeholder="₹ In Lacs"
                  />
                  <div className="text-[10px] text-slate-500 mt-1">
                    {(() => {
                      const d = parseFloat((formData.durationMonths || '').toString().replace(/[^0-9.]/g, ''));
                      if (!isNaN(d) && d > 0 && d < 12) {
                        return (
                          <span className="text-amber-800 font-medium">
                            Actual duration ({d} mos) &lt; 1 yr &rarr; considered as 1-year time (no artificial inflation)
                          </span>
                        );
                      }
                      return <span>Formula: (Amount ÷ Duration Mos) × 12</span>;
                    })()}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Status & Recommendation */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 bg-amber-50/50 rounded border border-amber-200">
            <div>
              <label className="font-semibold text-slate-800 block mb-1">#15 NIL Deviation Sheet</label>
              <select
                value={formData.nilDeviationSheet}
                onChange={(e) => setFormData({ ...formData, nilDeviationSheet: e.target.value as 'Yes' | 'No' | 'Query to be raised' })}
                className="w-full px-2 py-1.5 border border-slate-300 rounded bg-white"
              >
                <option value="Yes">Yes (Submitted)</option>
                <option value="No">No (Missing)</option>
                <option value="Query to be raised">Query to be raised</option>
              </select>
              {bidder.workOrders.length > 1 && (
                <p className="text-[10px] text-slate-500 mt-1">One undertaking per bid: applies to all {bidder.workOrders.length} work orders of this bidder.</p>
              )}
            </div>

            <div>
              <label className="font-semibold text-slate-800 block mb-1">#16 Work Order Status</label>
              <select
                value={formData.woStatus}
                disabled={formData.meetsSimilarNature === 'No'}
                title={formData.meetsSimilarNature === 'No' ? 'Rejected because the work order is not of similar nature (#5)' : undefined}
                onChange={(e) => {
                  const woStatus = e.target.value as WoStatus;
                  setFormData({ ...formData, woStatus, finalPosition: finalPositionForStatus(woStatus) ?? formData.finalPosition });
                }}
                className="w-full px-2 py-1.5 border border-slate-300 rounded bg-white font-semibold disabled:bg-rose-50 disabled:text-rose-800"
              >
                {WO_STATUS_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
              {formData.meetsSimilarNature === 'No' && (
                <p className="text-[10px] text-rose-700 mt-1">Rejected: not of similar nature (#5).</p>
              )}
            </div>

            <div>
              <label className="font-semibold text-slate-800 block mb-1">#18 Final Position (this work order)</label>
              <select
                value={formData.finalPosition}
                disabled={formData.meetsSimilarNature === 'No'}
                onChange={(e) => setFormData({ ...formData, finalPosition: e.target.value as FinalPosition | '' })}
                className="w-full px-2 py-1.5 border border-slate-300 rounded bg-white font-bold disabled:bg-rose-50 disabled:text-rose-800"
              >
                <option value="">Not evaluated</option>
                {FINAL_POSITION_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
              <p className="text-[10px] text-slate-500 mt-1">The bidder's overall position is derived from all confirmed work orders.</p>
            </div>
          </div>

          {showApqc && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 bg-slate-50 rounded border border-slate-200">
              <div>
                <label className="font-semibold text-slate-800 block mb-1">Document no. against Additional Technical Requirement</label>
                <input
                  value={formData.apqcDocumentNo}
                  onChange={(e) => setFormData({ ...formData, apqcDocumentNo: e.target.value })}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded bg-white"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-800 block mb-1">Meets Additional PQC / Technical Requirement?</label>
                <select
                  value={formData.meetsApqc}
                  onChange={(e) => setFormData({ ...formData, meetsApqc: e.target.value as 'Yes' | 'No' | 'NA' })}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded bg-white"
                >
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                  <option value="NA">NA</option>
                </select>
              </div>
            </div>
          )}

          {/* Remarks */}
          <div>
            <label className="font-semibold text-slate-700 block mb-1">
              #17 Remarks: Reason for Technical Acceptance / Rejection / Technical Query
            </label>
            {needsAcceptanceRemark && (
              <p className="mb-1 text-[11px] font-semibold text-amber-800">
                Similar nature changed to Yes: state why this work order is accepted as similar nature.
              </p>
            )}
            <textarea
              rows={3}
              value={formData.remarks}
              onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
              placeholder={needsAcceptanceRemark ? 'e.g. Scope includes insulation of process lines inside the CDU battery limit, as confirmed from the BOQ.' : undefined}
              className={`w-full px-3 py-2 border rounded text-xs leading-relaxed ${needsAcceptanceRemark && !formData.remarks.trim() ? 'border-amber-400 ring-1 ring-amber-300' : 'border-slate-300'}`}
              required
            />
          </div>

          {/* Audit Reason */}
          <div>
            <label className="font-semibold text-slate-700 block mb-1">
              Reason for Changes
            </label>
            <input
              type="text"
              value={formData.editReason}
              onChange={(e) => setFormData({ ...formData, editReason: e.target.value })}
              className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs"
              required
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200">
            <div>
              {showConfirmDelete ? (
                <div className="flex items-center flex-wrap gap-2">
                  <span className="text-xs text-red-600 font-semibold">Confirm removal:</span>
                  {bidder.workOrders.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        deleteIoclWorkOrder(bidder.id, workOrder.id, false);
                        onClose();
                      }}
                      className="px-2.5 py-1.5 rounded bg-red-600 hover:bg-red-700 text-white font-bold text-xs shadow-xs"
                    >
                      Delete This WO
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      deleteIoclBidder(bidder.id);
                      onClose();
                    }}
                    className="px-2.5 py-1.5 rounded bg-rose-800 hover:bg-rose-900 text-white font-bold text-xs shadow-xs"
                  >
                    Remove Entire Bidder
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowConfirmDelete(false)}
                    className="px-2 py-1.5 text-xs text-slate-500 hover:text-slate-700"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowConfirmDelete(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded text-red-600 hover:bg-red-50 font-medium text-xs transition"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-500" />
                  {bidder.workOrders.length > 1 ? 'Delete Work Order' : 'Delete Work Order / Bidder'}
                </button>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex items-center gap-2 px-5 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-xs"
              >
                <Save className="w-4 h-4" />
                Save &amp; Confirm
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
