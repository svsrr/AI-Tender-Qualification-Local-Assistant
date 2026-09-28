import { IoclBidderEvaluation, IoclTenderMetadata, IoclWorkOrderEntry, TenderEligibilityCriteria } from '../types';
import { bidderOutcome, completionDateText, durationText as durationTextOf, GST_FACTOR, isEngineerConfirmed, numberToWords, parseTbaDate, resolveAdditionalPqc, summariseTba } from './tbaRules';

// Layout-neutral model of the committee's TBA document. The Excel and PDF writers both
// render exactly this, so the two files always carry the same figures and decisions.

export const PENDING_REVIEW = 'Pending engineer review';

export interface TbaAmount {
  lacs: number | null;
  // Ex-GST figure from the document; the Excel writer shows it as =base*1.18.
  baseLacs: number | null;
  note?: string;
}

export interface TbaRow {
  woNumberAndDate: string;
  jobName: string;
  meetsSimilarNature: string;
  compCertSubmitted: string;
  isSubcontract: string;
  ownerApprovalSubmitted: string;
  startDate: string;
  startDateValue: Date | null;
  compDate: string;
  compDateValue: Date | null;
  durationText: string;
  durationMonths: number | null;
  woValue: TbaAmount;
  compValue: TbaAmount;
  annualised: { lacs: number | null; text: string; derivable: boolean };
  apqcDocumentNo: string;
  meetsApqc: string;
  nilDeviationSheet: string;
  status: string;
  remarks: string;
  finalPosition: string;
  confirmed: boolean;
}

export interface TbaBidderBlock {
  slNo: number;
  bidderLabel: string;
  rows: TbaRow[];
}

export interface TbaSignatory {
  label: string;
  name: string;
  designation: string;
}

export interface TbaDocument {
  title: string;
  tenderNo: string;
  jobName: string;
  typeOfJobText: string;
  isArcTender: boolean;
  similarNatureDefinition: string;
  optionRupees: [number | null, number | null, number | null];
  additionalPqc: string;
  hasApqc: boolean;
  trDate: string;
  bidOpeningDate: string;
  totalBidsText: string;
  acceptable: number;
  rejected: number;
  query: number;
  pendingReviewBidders: number;
  pendingReviewRows: number;
  bidders: TbaBidderBlock[];
  signatories: TbaSignatory[];
}

const clean = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

const rupeesFromCriteria = (cr: unknown, lacsText: unknown): number | null => {
  const crNum = Number(cr);
  if (Number.isFinite(crNum) && crNum > 0) return Math.round(crNum * 1e7);
  const lacs = Number(String(lacsText ?? '').replace(/,/g, ''));
  return Number.isFinite(lacs) && lacs > 0 ? Math.round(lacs * 1e5) : null;
};

// Figures can arrive as undefined, strings or NaN (older saved rows, fallback extractions); the
// writers call toFixed on them, so anything that is not a finite number becomes null.
const toLacs = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

const amount = (rawLacs: unknown, rawBase: unknown, note?: string): TbaAmount => {
  const lacs = toLacs(rawLacs);
  const base = toLacs(rawBase);
  // Only keep the ex-GST base when it still reproduces the stored incl.-GST figure.
  const consistentBase = base !== null && lacs !== null && Math.abs(base * GST_FACTOR - lacs) < 0.01 ? base : null;
  return { lacs, baseLacs: consistentBase, note: note || undefined };
};

// A work order set to Not Evaluated takes no part in the evaluation, so its dates and values
// are left blank rather than shown as if they had been judged.
const NOT_EVALUATED_BLANKS: Partial<IoclWorkOrderEntry> = {
  startDate: '—',
  compDate: '—',
  durationMonths: '—',
  woValueLacs: null,
  woValueNote: '—',
  compValueLacs: null,
  compValueNote: '—',
  annualisedValueLacs: null,
};

function buildRow(stored: IoclWorkOrderEntry, isArcTender: boolean): TbaRow {
  // No proven completion: columns 10 and 11 say why instead of showing a contractual date.
  const completion = completionDateText(stored);
  const duration = durationTextOf(stored);
  const withReasons = completion.proven && duration.proven ? stored : { ...stored, compDate: completion.text, durationMonths: duration.text };
  const wo = stored.woStatus === 'Not Evaluated' ? { ...stored, ...NOT_EVALUATED_BLANKS } : withReasons;
  const confirmed = isEngineerConfirmed(wo);
  const durationText = clean(wo.durationMonths);
  const durationMonths = /^\d+(\.\d+)?$/.test(durationText) ? Number(durationText) : null;
  const startValue = /^\d{2}-\d{2}-\d{4}$/.test(clean(wo.startDate)) ? parseTbaDate(wo.startDate) : null;
  const compValue = /^\d{2}-\d{2}-\d{4}$/.test(clean(wo.compDate)) ? parseTbaDate(wo.compDate) : null;
  const annualisedLacs = toLacs(wo.annualisedValueLacs);

  return {
    woNumberAndDate: [clean(wo.woNumberAndDate), clean(wo.issuingOrg) && !clean(wo.woNumberAndDate).toLowerCase().includes(clean(wo.issuingOrg).toLowerCase()) ? `issued by ${clean(wo.issuingOrg)}` : '']
      .filter(Boolean)
      .join(' '),
    jobName: clean(wo.jobName),
    meetsSimilarNature: clean(wo.meetsSimilarNature),
    compCertSubmitted: clean(wo.compCertSubmitted),
    isSubcontract: clean(wo.isSubcontract),
    ownerApprovalSubmitted: clean(wo.ownerApprovalSubmitted),
    startDate: clean(wo.startDate),
    startDateValue: startValue,
    compDate: clean(wo.compDate),
    compDateValue: compValue,
    durationText,
    durationMonths,
    woValue: amount(wo.woValueLacs, wo.woValueBaseLacs, wo.woValueNote),
    compValue: amount(wo.compValueLacs, wo.compValueBaseLacs, wo.compValueNote),
    annualised: isArcTender
      ? {
          lacs: annualisedLacs,
          text: annualisedLacs !== null ? annualisedLacs.toFixed(2) : '',
          // The Excel formula =O*12/MAX(12,M) only applies when both inputs are plain numbers.
          derivable: annualisedLacs !== null && durationMonths !== null && toLacs(wo.compValueLacs) !== null,
        }
      : { lacs: null, text: 'NA', derivable: false },
    apqcDocumentNo: clean(wo.apqcDocumentNo),
    meetsApqc: clean(wo.meetsApqc),
    nilDeviationSheet: clean(wo.nilDeviationSheet),
    status: confirmed ? clean(wo.woStatus) : PENDING_REVIEW,
    remarks: confirmed ? clean(wo.remarks) : clean(wo.remarks) ? `AI suggestion (not yet confirmed): ${clean(wo.remarks)}` : '',
    finalPosition: confirmed ? clean(wo.finalPosition) : PENDING_REVIEW,
    confirmed,
  };
}

// Column 18 is one decision per bidder: written once, on the bidder's first row, with the work
// orders it rests on ("Technically acceptable as per WO No. X (1 similar work option of PQC)").
function withBidderPosition(rows: TbaRow[], workOrders: IoclWorkOrderEntry[]): TbaRow[] {
  const outcome = bidderOutcome(workOrders);
  const text = outcome.position ? `${outcome.position}. ${outcome.remark}`.trim() : PENDING_REVIEW;
  return rows.map((row, i) => ({ ...row, finalPosition: i === 0 ? text : '' }));
}

export function buildTbaDocument(
  bidders: IoclBidderEvaluation[],
  metadata: IoclTenderMetadata,
  criteria: TenderEligibilityCriteria,
  isArcTender: boolean
): TbaDocument {
  const summary = summariseTba(bidders);
  const blocks: TbaBidderBlock[] = bidders
    .filter((b) => (b.workOrders || []).length > 0)
    .map((b, i) => ({
      slNo: i + 1,
      bidderLabel: [clean(b.bidderName), clean(b.cityState)].filter(Boolean).join(', '),
      // Work orders are numbered 1, 2, 3 ... within the bidder, so a bidder running over several
      // printed pages can still be followed.
      rows: withBidderPosition(
        b.workOrders.map((wo, i) => {
          const row = buildRow(wo, isArcTender);
          return { ...row, woNumberAndDate: `${i + 1}. ${row.woNumberAndDate}` };
        }),
        b.workOrders
      ),
    }));

  const sig = metadata.signatories || {};
  const signatories: TbaSignatory[] = [
    { label: 'Signature of approving authority', person: sig.approvingAuthority },
    { label: 'Signature of Next Superior Officer', person: sig.nextSuperiorOfficer },
    { label: 'Signature of Superior Officer', person: sig.superiorOfficer },
  ].map(({ label, person }) => ({ label, name: clean(person?.name), designation: clean(person?.designation) }));

  const { hasApqc, text: apqcText } = resolveAdditionalPqc(metadata, criteria);

  return {
    title: 'TECHNICAL BID ANALYSIS/ TECHNICAL EVALUATION AND RECOMMENDATION BY INITIATING DEPARTMENT',
    tenderNo: clean(metadata.tenderNo || criteria.tenderRef),
    jobName: clean(metadata.jobName || criteria.tenderTitle),
    typeOfJobText: isArcTender ? 'ARC job (work experience value submitted by the bidder shall be annualized)' : 'One time job',
    isArcTender,
    similarNatureDefinition: clean(metadata.similarNatureDefinition || criteria.similarWorkDefinition),
    optionRupees: [
      rupeesFromCriteria(criteria.optionASingleWorkCr, metadata.valueOption1Job),
      rupeesFromCriteria(criteria.optionBTwoWorksCr, metadata.valueOption2Jobs),
      rupeesFromCriteria(criteria.optionCThreeWorksCr, metadata.valueOption3Jobs),
    ],
    additionalPqc: hasApqc ? apqcText : 'Not applicable',
    hasApqc,
    trDate: clean(metadata.trDate),
    bidOpeningDate: clean(metadata.dateOfBidOpening),
    totalBidsText: `${summary.totalBids} (${numberToWords(summary.totalBids)})`,
    acceptable: summary.acceptable,
    rejected: summary.rejected,
    query: summary.query,
    pendingReviewBidders: summary.pendingReview,
    pendingReviewRows: bidders.reduce((n, b) => n + (b.workOrders || []).filter((wo) => !isEngineerConfirmed(wo)).length, 0),
    bidders: blocks,
    signatories,
  };
}
