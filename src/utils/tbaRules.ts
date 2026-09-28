import {
  ClaimedOrder,
  FinalPosition,
  GstBasis,
  IoclTenderMetadata,
  NitClause,
  NitClauseTopic,
  IoclBidderEvaluation,
  IoclWorkOrderEntry,
  WO_STATUS_OPTIONS,
  WoStatus,
} from '../types';

// Single source of truth for how an extracted work order becomes a TBA row. Every upload
// path and both exports use these rules, so the sheet, Excel and PDF cannot disagree.

export const GST_FACTOR = 1.18;

// Whether the tender carries an Additional PQC, which adds two columns to the TBA. An explicit
// hasApqc flag wins; otherwise any stated requirement other than nil/NA counts.
export function resolveAdditionalPqc(
  metadata: { additionalPqc?: string; hasApqc?: boolean } | undefined,
  criteria: { additionalPqc?: string; hasApqc?: boolean } | undefined
): { hasApqc: boolean; text: string } {
  const text = metadata?.additionalPqc?.trim() || criteria?.additionalPqc?.trim() || 'Nil';
  const statesRequirement = !/^(nil|n\/?a|none|not applicable)$/i.test(text);
  const hasApqc = (metadata?.hasApqc ?? criteria?.hasApqc) ?? statesRequirement;
  return { hasApqc, text };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const toNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

// Accepts "18-08-2025", "18.08.2025", "18/08/2025 (original ARC completion date)" or
// "2025-08-18"; ignores surrounding text. Returns a UTC date so month maths is DST-proof.
export function parseTbaDate(raw: unknown): Date | null {
  const s = String(raw ?? '');
  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  const dmy = /(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/.exec(s);
  let y: number, m: number, d: number;
  if (dmy) [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
  else if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1950 || y > 2100) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 ? date : null;
}

export function formatTbaDate(date: Date | null): string {
  if (!date) return '';
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${date.getUTCFullYear()}`;
}

const DAY_MS = 86_400_000;
const daysInMonthUtc = (year: number, monthIndex: number) => new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

// Last day of a contract period of `months` calendar months starting on `start`: the day before
// the same date `months` later (01-01-2026 + 12 -> 31-12-2026, 10-11-2026 + 12 -> 09-11-2027).
// When that month has no such date (start 31-01 or 29-02) the period ends on its last day
// (29-02-2028 + 12 -> 28-02-2029). months = 0 gives the day before the start.
export function contractPeriodEnd(start: Date, months: number): Date {
  const total = start.getUTCMonth() + months;
  const year = start.getUTCFullYear() + Math.floor(total / 12);
  const monthIndex = ((total % 12) + 12) % 12;
  const day = start.getUTCDate();
  if (day > daysInMonthUtc(year, monthIndex)) return new Date(Date.UTC(year, monthIndex + 1, 0));
  return new Date(Date.UTC(year, monthIndex, day) - DAY_MS);
}

export interface ContractDuration {
  months: number; // whole calendar months completed
  days: number; // days beyond them (0 when the job ends exactly on a period end)
  exactMonths: number; // months + days as a fraction of the next month, 2 decimals
}

// Actual execution time between two dates, both days counted, in calendar months under the
// contract-period rule above. 19-08-2024 to 18-08-2025 is exactly 12 months; 01-01-2026 to
// 15-01-2027 is 12 months 15 days = 12.48. Null when a date is missing or the completion
// precedes the start, which indicates a misread rather than a real duration.
export function contractDurationBetween(start: unknown, comp: unknown): ContractDuration | null {
  const s = parseTbaDate(start);
  const c = parseTbaDate(comp);
  if (!s || !c || c.getTime() < s.getTime()) return null;
  let months = Math.max(0, (c.getUTCFullYear() - s.getUTCFullYear()) * 12 + c.getUTCMonth() - s.getUTCMonth() - 1);
  while (contractPeriodEnd(s, months + 1).getTime() <= c.getTime()) months++;
  const periodEnd = contractPeriodEnd(s, months);
  const days = Math.round((c.getTime() - periodEnd.getTime()) / DAY_MS);
  const nextMonthDays = Math.round((contractPeriodEnd(s, months + 1).getTime() - periodEnd.getTime()) / DAY_MS);
  return { months, days, exactMonths: Math.round((months + days / nextMonthDays) * 100) / 100 };
}

// Column 11. ARC tenders keep the fraction because annualisation divides by it (12 vs 12.48
// months changes the value); one-time jobs show whole months as the TBA always has.
export function durationMonthsBetween(start: unknown, comp: unknown, isArcTender = false): number | null {
  const d = contractDurationBetween(start, comp);
  if (!d) return null;
  return isArcTender ? d.exactMonths : Math.max(1, Math.round(d.exactMonths));
}

// "12 months 15 days", shown under column 11 so the fraction can be checked against the dates.
export function formatContractDuration(d: ContractDuration | null): string {
  if (!d) return '';
  const parts = [];
  if (d.months) parts.push(`${d.months} month${d.months === 1 ? '' : 's'}`);
  if (d.days || !d.months) parts.push(`${d.days} day${d.days === 1 ? '' : 's'}`);
  return parts.join(' ');
}

// ARC tenders annualise the completed value; a job shorter than a year counts as a
// full year so the value is never inflated (8 months at 190.09 annualises to 190.09).
export function annualisedLacs(compValueLacs: number | null, durationMonths: number | null, isArcTender: boolean): number | null {
  if (!isArcTender || compValueLacs === null || durationMonths === null || durationMonths <= 0) return null;
  return round2((compValueLacs * 12) / Math.max(12, durationMonths));
}

// Columns 10 and 11 when there is no proven completion: say why instead of showing a date that is
// only the contractual end of the work order.
export const COMPLETION_CERT_MISSING = 'Completion certificate not submitted';
export const COMPLETION_DATE_MISSING = 'Completion date not found in the documents';

export function completionDateText(wo: Pick<IoclWorkOrderEntry, 'compCertSubmitted' | 'compDate'>): { text: string; proven: boolean } {
  if (wo.compCertSubmitted === 'No') return { text: COMPLETION_CERT_MISSING, proven: false };
  if (!parseTbaDate(wo.compDate)) return { text: COMPLETION_DATE_MISSING, proven: false };
  return { text: wo.compDate, proven: true };
}

export function durationText(wo: Pick<IoclWorkOrderEntry, 'compCertSubmitted' | 'compDate' | 'durationMonths'>): { text: string; proven: boolean } {
  const completion = completionDateText(wo);
  if (!completion.proven) return completion;
  const text = String(wo.durationMonths ?? '').trim();
  return text ? { text, proven: true } : { text: COMPLETION_DATE_MISSING, proven: false };
}

export interface PqcThresholdsLacs {
  oneWork: number | null;
  twoWorks: number | null;
  threeWorks: number | null;
}

const lacsFromText = (v: unknown): number | null => {
  const n = Number(String(v ?? '').replace(/,/g, '').replace(/lacs?|lakhs?/i, '').trim());
  return Number.isFinite(n) && n > 0 ? n : null;
};
const lacsFromCr = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? round2(n * 100) : null;
};

// This tender's PQC values, in the order the TBA header shows them: the figure typed in the TBA
// header, else Tender Setup's crore figure. Null when the NIT gives none: the value criterion is
// then not judged, rather than judged against 80 / 50 / 40 % of the estimated cost, which is a
// common formula but not what any particular NIT says.
export function resolvePqcThresholdsLacs(
  metadata: { valueOption1Job?: string; valueOption2Jobs?: string; valueOption3Jobs?: string } | undefined,
  criteria: { optionASingleWorkCr?: number; optionBTwoWorksCr?: number; optionCThreeWorksCr?: number; estimatedCostCr?: number } | undefined
): PqcThresholdsLacs {
  return {
    oneWork: lacsFromText(metadata?.valueOption1Job) ?? lacsFromCr(criteria?.optionASingleWorkCr),
    twoWorks: lacsFromText(metadata?.valueOption2Jobs) ?? lacsFromCr(criteria?.optionBTwoWorksCr),
    threeWorks: lacsFromText(metadata?.valueOption3Jobs) ?? lacsFromCr(criteria?.optionCThreeWorksCr),
  };
}

// Plant owners a work order can be executed for. A work order for one of them that was issued by
// someone else is a sub-contract (M/s JK Project Engineers ordering piping work at IOCL-SRU).
const PLANT_OWNERS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'IOCL', pattern: /\b(iocl|indian\s*oil)\b/i },
  { name: 'HPCL', pattern: /\b(hpcl|hindustan\s*petroleum)\b/i },
  { name: 'BPCL', pattern: /\b(bpcl|bharat\s*petroleum)\b/i },
  { name: 'ONGC', pattern: /\bongc\b|oil\s*(and|&)\s*natural\s*gas/i },
  { name: 'GAIL', pattern: /\bgail\b/i },
  { name: 'Oil India', pattern: /\boil\s*india\b/i },
  { name: 'NRL', pattern: /\bnrl\b|numaligarh/i },
  { name: 'MRPL', pattern: /\bmrpl\b|mangalore\s*refinery/i },
  { name: 'CPCL', pattern: /\bcpcl\b|chennai\s*petroleum/i },
  { name: 'NTPC', pattern: /\bntpc\b/i },
  { name: 'BHEL', pattern: /\bbhel\b|bharat\s*heavy/i },
  { name: 'SAIL', pattern: /\bsail\b|steel\s*authority/i },
  { name: 'Reliance', pattern: /\breliance\b/i },
  { name: 'Nayara', pattern: /\bnayara\b/i },
];
const SUBCONTRACT_WORDS = /\bsub[\s-]?contract(or|ed|ing)?\b|\bback[\s-]?to[\s-]?back\b/i;

export interface SubcontractFinding {
  isSubcontract: 'Yes' | 'No';
  reason?: string;
}

// Column 7. The extractor's own Yes is kept; otherwise the document's wording and who issued
// the order decide. Returns a reason whenever the answer is Yes so the engineer can check it.
export function detectSubcontract(wo: {
  aiFlag?: unknown;
  issuingOrg?: string;
  jobName?: string;
  woNumberAndDate?: string;
  mainOwner?: string;
  evidence?: string;
}): SubcontractFinding {
  const issuer = String(wo.issuingOrg || '');
  const text = [wo.woNumberAndDate, wo.jobName, wo.evidence].map((v) => String(v || '')).join(' ');
  if (SUBCONTRACT_WORDS.test(text)) {
    return { isSubcontract: 'Yes', reason: 'The document describes this order as a sub-contract.' };
  }
  const where = `${wo.mainOwner || ''} ${wo.jobName || ''}`;
  const owner = PLANT_OWNERS.find((o) => o.pattern.test(where));
  // Includes consultants and EPC contractors (EIL, Toyo, Technip, BHEL): the owner gave them the
  // job and they sub-contracted it, so the owner's approval is still needed.
  if (owner && issuer && !owner.pattern.test(issuer)) {
    return { isSubcontract: 'Yes', reason: `Work at ${owner.name}, but the order was issued by ${issuer}, not by ${owner.name}.` };
  }
  if (String(wo.aiFlag ?? '').trim().toLowerCase() === 'yes') {
    return { isSubcontract: 'Yes', reason: 'Marked as a sub-contract by the AI extraction; check the order.' };
  }
  return { isSubcontract: 'No' };
}

// A sub-contract counts only with the main owner's approval / certificate (NIT). Without it the
// work order is not suggested as accepted: the bidder is asked for it.
const SUBCONTRACT_APPROVAL_NOTE = 'Sub-contract WO: bidder to submit the main owner\'s approval / certificate for the sub-contracted work.';

export function suggestionWithSubcontract(
  base: { status: WoStatus; remarks: string },
  isSubcontract: 'Yes' | 'No',
  ownerApproval: 'Yes' | 'No' | 'NA'
): { status: WoStatus; remarks: string } {
  if (isSubcontract !== 'Yes' || ownerApproval === 'Yes' || base.remarks.includes(SUBCONTRACT_APPROVAL_NOTE)) return base;
  if (base.status.startsWith('WO Accepted')) return { status: 'Query to be raised', remarks: SUBCONTRACT_APPROVAL_NOTE };
  if (base.status === 'WO Rejected') return base;
  return { status: base.status, remarks: base.remarks ? `${base.remarks} ${SUBCONTRACT_APPROVAL_NOTE}` : SUBCONTRACT_APPROVAL_NOTE };
}

export function normaliseGstBasis(raw: unknown): GstBasis {
  const s = String(raw ?? '').toLowerCase();
  if (/excl|without|exclusive|plus gst|\+ ?gst/.test(s)) return 'Excl. GST';
  if (/incl|inclusive|with gst/.test(s)) return 'Incl. GST';
  return 'Not stated';
}

export function applyGst(value: number | null, basis: GstBasis): { lacs: number | null; baseLacs: number | null } {
  if (value === null) return { lacs: null, baseLacs: null };
  if (basis === 'Excl. GST') return { lacs: round2(value * GST_FACTOR), baseLacs: value };
  return { lacs: value, baseLacs: null };
}

export function normaliseWoStatus(raw: unknown): WoStatus {
  const s = String(raw ?? '').trim().toLowerCase();
  const exact = WO_STATUS_OPTIONS.find((o) => o.toLowerCase() === s);
  if (exact) return exact;
  if (s.includes('reject')) return 'WO Rejected';
  const accepted = /accept\w*\s*\(?\s*(\d)/.exec(s);
  if (accepted && ['1', '2', '3'].includes(accepted[1])) return `WO Accepted(${accepted[1]} WO)` as WoStatus;
  if (s.includes('accept')) return 'WO Accepted(1 WO)';
  if (s.includes('not evaluated')) return 'Not Evaluated';
  return 'Query to be raised';
}

// A stored row can come from an older build, or from a save that dropped a field. One saved
// without a woStatus used to blank the whole sheet, because every rule reads that status first.
// Such a row is read as "Query to be raised": nothing is accepted without a status of its own.
export function normaliseStoredWorkOrder<T extends { woStatus?: unknown; remarks?: unknown; finalPosition?: FinalPosition }>(wo: T): T {
  const hasStatus = typeof wo?.woStatus === 'string' && (WO_STATUS_OPTIONS as readonly string[]).includes(wo.woStatus as string);
  const hasRemarks = typeof wo?.remarks === 'string';
  if (hasStatus && hasRemarks) return wo;
  const status = normaliseWoStatus(wo?.woStatus);
  return {
    ...wo,
    woStatus: status,
    remarks: hasRemarks ? wo.remarks : '',
    finalPosition: wo?.finalPosition ?? finalPositionForStatus(status),
  };
}

// The same for every work order of every bidder, as a tender arrives from this browser's cache
// or from the cloud. Returns the array it was given when nothing needed repairing.
export function normaliseStoredBidders<B extends { workOrders?: any[] }>(bidders: B[]): B[] {
  if (!Array.isArray(bidders)) return bidders;
  let changed = false;
  const out = bidders.map((b) => {
    const rows = Array.isArray(b?.workOrders) ? b.workOrders : [];
    const next = rows.map(normaliseStoredWorkOrder);
    if (next.every((r, i) => r === rows[i])) return b;
    changed = true;
    return { ...b, workOrders: next };
  });
  return changed ? out : bidders;
}

export function finalPositionForStatus(status: WoStatus): FinalPosition | undefined {
  if (status.startsWith('WO Accepted')) return 'Technically Acceptable';
  if (status === 'WO Rejected') return 'Technically Rejected';
  if (status === 'Query to be raised') return 'Query to be raised';
  return undefined;
}

export const isEngineerConfirmed = (wo: IoclWorkOrderEntry) => Boolean(wo.engineerConfirmedBy);

// The NIL deviation undertaking is one document per bid, not per work order, so every row of a
// bidder carries the same value: Yes if it was found anywhere in the bid, else No if recorded.
export function bidderNilDeviation(values: IoclWorkOrderEntry['nilDeviationSheet'][]): IoclWorkOrderEntry['nilDeviationSheet'] {
  if (values.includes('Yes')) return 'Yes';
  if (values.includes('No')) return 'No';
  return 'Query to be raised';
}

// The definition printed in the TBA header is the one work orders are judged against.
export function resolveSimilarNatureDefinition(
  metadata: { similarNatureDefinition?: string } | undefined,
  criteria: { similarWorkDefinition?: string } | undefined
): string {
  return (metadata?.similarNatureDefinition || criteria?.similarWorkDefinition || '').trim();
}

// Clause of the NIT that defines similar nature, as typed ("Clause No. 11.3" -> "11.3").
export function resolveSimilarNatureClause(
  metadata: { similarNatureClause?: string } | undefined,
  criteria: { similarWorkClause?: string } | undefined
): string {
  return String(metadata?.similarNatureClause || criteria?.similarWorkClause || '')
    .replace(/^\s*(clause)?\s*(no\.?|number)?\s*[:.-]?\s*/i, '')
    .trim();
}

export type SimilarNatureVerdict = IoclWorkOrderEntry['meetsSimilarNature'];

const SIMILAR_NO_PHRASE = 'is not meeting the similar nature criteria as per';
const LEGACY_SIMILAR_NO_PREFIX = 'Not of similar nature as per NIT:';
const SIMILAR_VERIFY_PREFIX = 'Similar nature to be verified:';

// Remark for a work order rejected on similar nature, in the committee's wording:
// "Submitted WO No. X is not meeting the similar nature criteria as per Clause No. 11.3 of NIT."
export function similarNatureRejectionRemark(woNumberAndDate: string, clause: string, reason?: string): string {
  const where = clause ? `Clause No. ${clause} of NIT` : 'NIT';
  const why = String(reason || '').trim();
  return `Submitted WO No. ${workOrderRef(woNumberAndDate)} ${SIMILAR_NO_PHRASE} ${where}.${why ? ` ${why}` : ''}`;
}

// "1. Sub-contract WO no. 4347525932 dated 10.03.2022 issued by ..." -> "4347525932 dated 10.03.2022"
function workOrderRef(woNumberAndDate: string): string {
  const text = String(woNumberAndDate || '').replace(/\s+/g, ' ').trim();
  // "Contract no. 2774019278 dated 09.04.2020 (amendment no. VII ...)" reads as 2774019278, so
  // column 18 names the work order instead of repeating its whole title.
  const number = /(?:work\s*order|purchase\s*order|contract|agreement|\bwo|\bpo|\bloa|\bloi)\s*(?:no\.?|number|#)?\s*[:.-]?\s*([A-Za-z0-9][A-Za-z0-9/_-]*\d[A-Za-z0-9/_-]*)/i.exec(text);
  const date = /\b(?:dated|dt\.?|date)\s*[:.-]?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i.exec(text);
  if (number) return `${number[1]}${date ? ` dated ${date[1]}` : ''}`;
  // Numbers with colons or spaces, e.g. BHEL's "Work Order No. RD:MPX: 53265001 Dt: 22-04-2026":
  // everything between "No." and the date.
  const spaced = /(?:work\s*order|purchase\s*order|contract|agreement|\bwo|\bpo|\bloa|\bloi)\s*(?:no\.?|number|#)\s*[:.-]?\s*(.+?)\s*(?:,|\bdt\b\.?|\bdated\b|\bdate\b|\(|$)/i.exec(text);
  if (spaced && /\d/.test(spaced[1])) return `${spaced[1].replace(/[\s:.-]+$/, '')}${date ? ` dated ${date[1]}` : ''}`;
  return text.split(/\s+(?:issued by|main owner)\b/i)[0].trim() || '-';
}

export const isSimilarNatureRejectionRemark = (remarks: string | undefined) =>
  Boolean(remarks && (remarks.includes(SIMILAR_NO_PHRASE) || remarks.startsWith(LEGACY_SIMILAR_NO_PREFIX)));

// The extractor's own suggestion for a row, before any similar-nature verdict was applied.
// Rows saved before that was recorded fall back to the current suggestion, unless it was
// itself produced by a similar-nature verdict.
export function extractionSuggestionOf(wo: IoclWorkOrderEntry): { status: WoStatus; remarks: string } {
  if (wo.aiExtractionStatus) return { status: wo.aiExtractionStatus, remarks: wo.aiExtractionRemarks || '' };
  const remarks = wo.aiSuggestedRemarks ?? wo.remarks ?? '';
  if (isSimilarNatureRejectionRemark(remarks) || remarks.startsWith(SIMILAR_VERIFY_PREFIX)) return { status: 'Query to be raised', remarks: '' };
  const noteAt = remarks.indexOf(SIMILAR_VERIFY_PREFIX);
  return { status: normaliseWoStatus(wo.aiSuggestedStatus ?? wo.woStatus), remarks: noteAt > 0 ? remarks.slice(0, noteAt).trim() : remarks };
}

// Suggested status/remarks once column 5 is known. A work order that is not of similar nature
// is rejected outright, and one that cannot be judged from its title is not suggested as accepted.
export function suggestionWithSimilarNature(
  base: { status: WoStatus; remarks: string },
  verdict: SimilarNatureVerdict,
  reason: string | undefined,
  row: { woNumberAndDate: string; clause: string }
): { status: WoStatus; remarks: string } {
  const why = String(reason || '').trim();
  if (verdict === 'No') {
    return { status: 'WO Rejected', remarks: similarNatureRejectionRemark(row.woNumberAndDate, row.clause, why) };
  }
  if (verdict === 'To verify') {
    const note = `${SIMILAR_VERIFY_PREFIX} ${why ? `${why} ` : ''}Bidder to provide detailed BOQ/SOR of the executed work.`;
    if (base.status.startsWith('WO Accepted')) return { status: 'Query to be raised', remarks: note };
    // Already a query or rejection for another reason: keep it and add the similar-nature point.
    return { status: base.status, remarks: base.remarks ? `${base.remarks} ${note}` : note };
  }
  return base;
}

// Status, final position and remarks after an engineer changes column 5 by hand.
// No rejects the work order with the clause remark. Moving to Yes restores the value-based
// suggestion but clears the remark: the engineer must record why it is accepted.
export function rowAfterSimilarNatureEdit(
  wo: IoclWorkOrderEntry,
  current: { woStatus: WoStatus; remarks: string },
  verdict: SimilarNatureVerdict,
  clause: string
): { woStatus: WoStatus; finalPosition: FinalPosition | undefined; remarks: string; needsAcceptanceRemark: boolean } {
  const base = suggestionWithSubcontract(extractionSuggestionOf(wo), wo.isSubcontract, wo.ownerApprovalSubmitted);
  if (verdict === 'No') {
    const remarks = similarNatureRejectionRemark(wo.woNumberAndDate, clause);
    return { woStatus: 'WO Rejected', finalPosition: 'Technically Rejected', remarks, needsAcceptanceRemark: false };
  }
  if (verdict === 'Yes') {
    if (isSimilarNatureRejectionRemark(current.remarks)) {
      // Still rejected for another reason (e.g. below the PQC value): keep that reason.
      if (base.status === 'WO Rejected') {
        return { woStatus: base.status, finalPosition: 'Technically Rejected', remarks: base.remarks, needsAcceptanceRemark: false };
      }
      return { woStatus: base.status, finalPosition: finalPositionForStatus(base.status), remarks: '', needsAcceptanceRemark: true };
    }
    if (current.remarks.includes(SIMILAR_VERIFY_PREFIX)) {
      return { woStatus: base.status, finalPosition: finalPositionForStatus(base.status), remarks: base.remarks, needsAcceptanceRemark: false };
    }
    return { woStatus: current.woStatus, finalPosition: finalPositionForStatus(current.woStatus), remarks: current.remarks, needsAcceptanceRemark: false };
  }
  const suggestion = suggestionWithSimilarNature(base, 'To verify', wo.similarNatureReason, { woNumberAndDate: wo.woNumberAndDate, clause });
  return { woStatus: suggestion.status, finalPosition: finalPositionForStatus(suggestion.status), remarks: suggestion.remarks, needsAcceptanceRemark: false };
}

// ---------------------------------------------------------------------------------------------
// The NIT decides. These helpers read the clauses extracted from this tender's own NIT, so that
// every rule the app applies can quote the clause it comes from, and so that a clause allowing a
// relaxation is put to the engineer instead of the built-in rule being applied silently.
// ---------------------------------------------------------------------------------------------

export type NitSource = Pick<
  IoclTenderMetadata,
  'nitClauses' | 'bidSubmissionDate' | 'dateOfBidOpening' | 'experienceWindowYears' | 'experienceWindowText' | 'annualisationApplicable' | 'valueBasisText'
> | undefined;

export function nitClauseFor(nit: NitSource, topic: NitClauseTopic): NitClause | undefined {
  return (nit?.nitClauses || []).find((c) => c.topic === topic && (c.no || c.requirement));
}

// "(Clause No. 11.2 of NIT)" when this NIT has such a clause, else "" so the remark reads plainly.
export function clauseCitation(nit: NitSource, topic: NitClauseTopic): string {
  const clause = nitClauseFor(nit, topic);
  return clause?.no ? ` (Clause No. ${clause.no} of NIT)` : '';
}

// What to add to a remark when the NIT's own clause allows a relaxation, or when this NIT says
// nothing on the point and the app's built-in rule was used. The engineer decides either way.
export function nitRuleNote(nit: NitSource, topic: NitClauseTopic, builtInRule: string): string {
  const clause = nitClauseFor(nit, topic);
  if (clause?.relaxation) {
    return ` NIT ${clause.no ? `Clause No. ${clause.no}` : 'clause'} also allows: "${clause.relaxation}" - engineer to check this work order against it before applying the above.`;
  }
  if (!clause) {
    return ` The NIT read for this tender states no clause on this point; applied the standard rule: ${builtInRule} Engineer to confirm against the tender document.`;
  }
  return '';
}

export interface ExperienceWindow {
  years: number;
  from: Date;
  to: Date;
  fromText: string;
  toText: string;
  source: string;
}

// "during any of the last seven years ending on the last day of the month immediately previous to
// the month in which the original last date of bid submission falls" (7 in this NIT, read from it).
export function experienceWindow(nit: NitSource): ExperienceWindow | null {
  const years = Number(nit?.experienceWindowYears);
  if (!Number.isFinite(years) || years <= 0) return null;
  const basis = parseTbaDate(nit?.bidSubmissionDate) ?? parseTbaDate(nit?.dateOfBidOpening);
  if (!basis) return null;
  // UTC throughout, like the other date helpers: the last day of the month before the bid date,
  // and the same number of years back, plus a day (7 years ending 31-10-2023 start on 01-11-2016).
  const to = new Date(Date.UTC(basis.getUTCFullYear(), basis.getUTCMonth(), 0));
  const from = new Date(Date.UTC(to.getUTCFullYear() - years, to.getUTCMonth(), to.getUTCDate() + 1));
  return {
    years,
    from,
    to,
    fromText: formatTbaDate(from),
    toText: formatTbaDate(to),
    source: nit?.bidSubmissionDate ? 'last date of bid submission' : 'date of bid opening',
  };
}

// Null when the completion date or the window is unknown.
export function isWithinExperienceWindow(compDate: unknown, window: ExperienceWindow | null): boolean | null {
  if (!window) return null;
  const comp = parseTbaDate(compDate);
  if (!comp) return null;
  return comp >= window.from && comp <= window.to;
}

// ---------------------------------------------------------------------------------------------
// PQC value criterion across a bidder's work orders: one work of at least the 1-work value, OR
// two works EACH of at least the 2-work value, OR three works EACH of at least the 3-work value.
// ARC tenders compare the annualised value. A work order below the smallest value can count under
// no option and is rejected on its own; one above it is only rejected once the bidder's other
// work orders cannot make up any option with it.
// ---------------------------------------------------------------------------------------------

export type WorksOption = 1 | 2 | 3;

export interface BidderValueContext {
  thresholds: PqcThresholdsLacs;
  isArcTender: boolean;
  similarNatureClause: string;
  // This bidder's own list of claimed orders (performance statement, CA certificate), if read.
  claimedOrders?: ClaimedOrder[];
  // This tender's NIT, so each rule can quote its clause and defer to any relaxation it allows.
  nit?: NitSource;
}

export interface RowVerdict {
  woStatus: WoStatus;
  finalPosition: FinalPosition | undefined;
  remarks: string;
}

export interface BidderEvaluation {
  // Suggested status/remarks for every row an engineer has not confirmed yet.
  suggestions: Record<string, RowVerdict>;
  // Confirmed rows the value rule disagrees with: shown to the engineer, never applied.
  warnings: Record<string, string>;
}

const optionThreshold = (t: PqcThresholdsLacs, option: WorksOption) =>
  option === 1 ? t.oneWork : option === 2 ? t.twoWorks : t.threeWorks;

const lacsText = (v: number) => `Rs. ${v.toFixed(2)} Lacs`;
const optionText = (option: WorksOption) => (option === 1 ? '1 similar work' : `${option} similar works each`);
const optionOf = (status: string): WorksOption => (Number(/\((\d) WO\)/.exec(status)?.[1] ?? 1) as WorksOption);

export function qualifyingValueLacs(wo: IoclWorkOrderEntry, isArcTender: boolean): number | null {
  const v = isArcTender ? wo.annualisedValueLacs : wo.compValueLacs;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function minimumPqcValue(t: PqcThresholdsLacs): number | null {
  const set = [t.oneWork, t.twoWorks, t.threeWorks].filter((v): v is number => typeof v === 'number' && v > 0);
  return set.length ? Math.min(...set) : null;
}

// The strongest option a single value meets on its own (1 is strongest).
export function bestOptionFor(value: number, t: PqcThresholdsLacs): WorksOption | null {
  for (const option of [1, 2, 3] as WorksOption[]) {
    const min = optionThreshold(t, option);
    if (min && value >= min) return option;
  }
  return null;
}

// The first option (1, then 2, then 3) that these work orders make up, and which of them do it
// (highest values first).
export function qualifyingCombination(
  items: Array<{ id: string; value: number }>,
  t: PqcThresholdsLacs
): { option: WorksOption; ids: string[] } | null {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  for (const option of [1, 2, 3] as WorksOption[]) {
    const min = optionThreshold(t, option);
    if (!min) continue;
    const meeting = sorted.filter((x) => x.value >= min);
    if (meeting.length >= option) return { option, ids: meeting.slice(0, option).map((x) => x.id) };
  }
  return null;
}

// Remarks written by the value rule, recognised so that a re-check can replace them.
const VALUE_REMARK_MARKERS = [
  'the minimum value for 3 similar works as per PQC', // before the bidder-level check
  'as per PQC value criterion',
  'not meeting the PQC value criterion',
  'the value criterion was not checked',
  'could not be determined from the documents',
];
export const isValueRuleRemark = (remarks: string | undefined) =>
  Boolean(remarks && VALUE_REMARK_MARKERS.some((m) => remarks.includes(m)));

const woLabel = (wo: IoclWorkOrderEntry) => workOrderRef(wo.woNumberAndDate);
const listLabels = (wos: IoclWorkOrderEntry[]) => {
  const labels = wos.map(woLabel);
  return labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
};

// What the documents alone say about an unconfirmed row: completion, similar nature,
// sub-contract. The extractor's own value opinion ("exceeds requirement", "(1 WO)") and any
// earlier value rejection are dropped, because value is judged across the bidder below.
export function documentarySuggestion(wo: IoclWorkOrderEntry, clause: string): { status: WoStatus; remarks: string } {
  let base = extractionSuggestionOf(wo);
  if (base.status.startsWith('WO Accepted') || (base.status === 'WO Rejected' && isValueRuleRemark(base.remarks))) {
    base = { status: 'WO Accepted(1 WO)', remarks: '' };
  }
  const withSimilar = suggestionWithSimilarNature(base, wo.meetsSimilarNature, wo.similarNatureReason, {
    woNumberAndDate: wo.woNumberAndDate,
    clause,
  });
  return suggestionWithSubcontract(withSimilar, wo.isSubcontract, wo.ownerApprovalSubmitted);
}

// Conditions of the NIT that decide a work order on its own, before any value comparison:
// work for the bidder's own plant, completion outside the experience window, and an executed
// value above the ordered value. Each remark quotes the clause it comes from.
function nitGateVerdict(wo: IoclWorkOrderEntry, nit: NitSource): RowVerdict | null {
  if (wo.ownPlantWork === 'Yes') {
    return verdict(
      'WO Rejected',
      `Work executed by the bidder for its own plant / project is not counted as experience${clauseCitation(nit, 'own-plant')}.` +
        nitRuleNote(nit, 'own-plant', 'a work order issued by the bidder to itself or within its own group does not count.')
    );
  }
  const window = experienceWindow(nit);
  const within = isWithinExperienceWindow(wo.compDate, window);
  if (window && within === false) {
    return verdict(
      'WO Rejected',
      `Work completed on ${wo.compDate} falls outside the ${window.years}-year experience window ` +
        `${window.fromText} to ${window.toText}, counted back from the ${window.source}${clauseCitation(nit, 'experience-window')}.`
    );
  }
  return null;
}

function gstBasisNote(wo: IoclWorkOrderEntry, nit: NitSource): string | null {
  const unclear: string[] = [];
  if (typeof wo.woValueLacs === 'number' && wo.woValueGstBasis === 'Not stated') unclear.push(`WO value Rs. ${wo.woValueLacs.toFixed(2)} Lacs`);
  if (typeof wo.compValueLacs === 'number' && wo.compValueGstBasis === 'Not stated') unclear.push(`completed value Rs. ${wo.compValueLacs.toFixed(2)} Lacs`);
  if (!unclear.length) return null;
  return `GST not stated in the document for the ${unclear.join(' and ')}: taken as inclusive of GST${clauseCitation(nit, 'gst')}; check whether it includes GST.`;
}

const verdict = (woStatus: WoStatus, remarks: string): RowVerdict => ({
  woStatus,
  finalPosition: finalPositionForStatus(woStatus),
  remarks,
});

// Suggested status and remarks for each unconfirmed work order of one bidder, judged together.
// `overrides` lets the edit window evaluate its unsaved form values in place of the stored row.
export function evaluateBidderWorkOrders(
  workOrders: IoclWorkOrderEntry[],
  ctx: BidderValueContext,
  overrides?: { id: string; row: IoclWorkOrderEntry; treatAsUnconfirmed?: boolean }
): BidderEvaluation {
  const t = ctx.thresholds;
  const which = ctx.isArcTender ? 'Annualised value' : 'Completed value';
  const suggestions: Record<string, RowVerdict> = {};
  const warnings: Record<string, string> = {};
  const min = minimumPqcValue(t);
  // Added to a rejection so a relaxation in this NIT, or its silence, is put to the engineer.
  const valueRuleNote = nitRuleNote(
    ctx.nit,
    'value',
    'one work of at least the 1-work value, or 2 / 3 works each of at least their value.'
  );

  type Row = {
    wo: IoclWorkOrderEntry;
    confirmed: boolean;
    kind: 'eligible' | 'query' | 'rejected';
    value: number | null;
    doc?: { status: WoStatus; remarks: string };
  };
  const rows: Row[] = [];
  for (const stored of workOrders) {
    const isOverride = overrides?.id === stored.id;
    const wo = isOverride ? overrides!.row : stored;
    // Not Evaluated rows take no part in the result.
    if (wo.woStatus === 'Not Evaluated') continue;
    const confirmed = isOverride && overrides!.treatAsUnconfirmed ? false : isEngineerConfirmed(wo);
    const doc = confirmed ? undefined : documentarySuggestion(wo, ctx.similarNatureClause);
    const status = doc ? doc.status : normaliseWoStatus(wo.woStatus);
    const kind = status.startsWith('WO Accepted') ? 'eligible' : status === 'WO Rejected' ? 'rejected' : 'query';
    rows.push({ wo, confirmed, kind, value: qualifyingValueLacs(wo, ctx.isArcTender), doc });
  }

  // Rows the documents already reject or query keep that suggestion.
  for (const r of rows) {
    if (!r.confirmed && r.kind !== 'eligible' && r.doc) suggestions[r.wo.id] = verdict(r.doc.status, r.doc.remarks);
  }

  // The NIT's own conditions come before the value comparison.
  for (const r of rows) {
    if (r.confirmed || r.kind !== 'eligible') continue;
    const gate = nitGateVerdict(r.wo, ctx.nit);
    if (!gate) continue;
    suggestions[r.wo.id] = gate;
    r.kind = gate.woStatus === 'WO Rejected' ? 'rejected' : 'query';
  }

  // A confirmed acceptance is the engineer's decision and is not changed, but if a tender field
  // edited since (say the bid submission date, which moves the experience window) now puts the
  // work order outside a NIT condition, the row says so.
  for (const r of rows) {
    if (!r.confirmed || r.kind !== 'eligible') continue;
    const gate = nitGateVerdict(r.wo, ctx.nit);
    if (gate) warnings[r.wo.id] = `Rule check: ${gate.remarks}`;
  }

  // No PQC values set for this tender: nothing to judge the value against.
  if (min === null) {
    for (const r of rows) {
      if (!r.confirmed && r.kind === 'eligible') {
        suggestions[r.wo.id] = verdict('WO Accepted(1 WO)', 'PQC values are not set in the TBA header, so the value criterion was not checked.');
      }
    }
    return { suggestions, warnings };
  }

  const eligible = rows.filter((r) => r.kind === 'eligible');
  // An eligible row without a value cannot be judged; one below the smallest option fails on its own.
  for (const r of eligible) {
    if (r.confirmed) continue;
    if (r.value === null) {
      suggestions[r.wo.id] = verdict(
        'Query to be raised',
        `${which} could not be determined from the documents: bidder to submit the executed value with the completion certificate.`
      );
    } else if (r.value < min) {
      suggestions[r.wo.id] = verdict(
        'WO Rejected',
        `${which} ${lacsText(r.value)} is below ${lacsText(min)}, the least value accepted under any option of the PQC value criterion` +
          `${clauseCitation(ctx.nit, 'value')}.${valueRuleNote}`
      );
    }
  }

  const candidates = eligible.filter((r) => r.value !== null && r.value >= min);
  const combo = qualifyingCombination(candidates.map((r) => ({ id: r.wo.id, value: r.value as number })), t);

  // Work orders under query that could still count (value unknown, or at least the smallest option).
  const pending = rows.filter((r) => r.kind === 'query' && (r.value === null || r.value >= min));
  const potential = combo
    ? null
    : qualifyingCombination(
        [...candidates, ...pending].map((r) => ({ id: r.wo.id, value: r.value ?? Number.POSITIVE_INFINITY })),
        t
      );

  for (const r of candidates) {
    if (r.confirmed) continue;
    const value = r.value as number;
    if (combo) {
      const inCombo = combo.ids.includes(r.wo.id);
      const option = inCombo ? combo.option : (bestOptionFor(value, t) as WorksOption);
      const need = optionThreshold(t, option) as number;
      const partners = inCombo
        ? candidates.filter((c) => combo.ids.includes(c.wo.id) && c.wo.id !== r.wo.id).map((c) => c.wo)
        : [];
      suggestions[r.wo.id] = verdict(
        `WO Accepted(${option} WO)` as WoStatus,
        `${which} ${lacsText(value)} meets ${lacsText(need)} required for ${optionText(option)} under the PQC value criterion` +
          `${clauseCitation(ctx.nit, 'value')}.` +
          (partners.length ? ` Qualifies together with WO No. ${listLabels(partners)}.` : '')
      );
    } else if (potential) {
      const option = potential.option;
      const need = optionThreshold(t, option) as number;
      const waitingOn = pending.filter((p) => potential.ids.includes(p.wo.id)).map((p) => p.wo);
      suggestions[r.wo.id] = verdict(
        `WO Accepted(${option} WO)` as WoStatus,
        `${which} ${lacsText(value)} meets ${lacsText(need)} required for ${optionText(option)} under the PQC value criterion` +
          `${clauseCitation(ctx.nit, 'value')}.` +
          ` The bidder qualifies only together with WO No. ${listLabels(waitingOn)}, which is under query.`
      );
    } else {
      const option = bestOptionFor(value, t) as WorksOption;
      const need = optionThreshold(t, option) as number;
      suggestions[r.wo.id] = verdict(
        'WO Rejected',
        `${which} ${lacsText(value)} meets ${lacsText(need)} only for ${optionText(option)}, but the bidder has no other work order to make up ${option} works: not meeting the PQC value criterion` +
          `${clauseCitation(ctx.nit, 'value')}.${valueRuleNote}`
      );
    }
  }

  // A value whose GST basis the document does not state is taken as inclusive of GST (as NITs
  // usually provide), but the engineer is asked to check it.
  for (const r of rows) {
    if (r.confirmed) continue;
    const current = suggestions[r.wo.id];
    const note = [gstBasisNote(r.wo, ctx.nit), caCertifiedNote(r.wo, ctx.claimedOrders)].filter(Boolean).join(' ');
    if (!current || !note) continue;
    suggestions[r.wo.id] = { ...current, remarks: current.remarks ? `${current.remarks} ${note}` : note };
  }

  // Confirmed rows are never changed, but a value that does not support the confirmed option is flagged.
  for (const r of eligible) {
    if (!r.confirmed || r.value === null) continue;
    const option = optionOf(r.wo.woStatus);
    const need = optionThreshold(t, option);
    if (need && r.value < need) {
      const fits = bestOptionFor(r.value, t);
      const valueWarning =
        `Rule check: ${which.toLowerCase()} ${lacsText(r.value)} is below ${lacsText(need)} required for ${optionText(option)}` +
        (fits ? `; it meets only the ${fits}-works option.` : '; it meets no PQC option.');
      warnings[r.wo.id] = warnings[r.wo.id] ? `${warnings[r.wo.id]} ${valueWarning}` : valueWarning;
    }
  }
  return { suggestions, warnings };
}

export interface BidderOutcome {
  position: FinalPosition | null;
  // One-line explanation for column 18.
  remark: string;
}

// A bidder's final position from the rows an engineer has confirmed. Acceptable only when the
// accepted rows make up a PQC option: one "(1 WO)" row, two rows labelled (1 WO) or (2 WO), or
// any three accepted rows. Null while unconfirmed rows could still change the outcome.
export function bidderOutcome(workOrders: IoclWorkOrderEntry[]): BidderOutcome {
  const considered = workOrders.filter((wo) => wo.woStatus !== 'Not Evaluated');
  const confirmed = considered.filter(isEngineerConfirmed);
  if (confirmed.length === 0) return { position: null, remark: '' };

  const accepted = confirmed.filter((wo) => normaliseWoStatus(wo.woStatus).startsWith('WO Accepted'));
  for (const option of [1, 2, 3] as WorksOption[]) {
    const usable = accepted.filter((wo) => optionOf(wo.woStatus) <= option);
    if (usable.length >= option) {
      const which = option === 1 ? '1 similar work' : `${option} similar works`;
      return {
        position: 'Technically Acceptable',
        remark: `Technically acceptable as per WO No. ${listLabels(usable.slice(0, option))} (${which} option of PQC).`,
      };
    }
  }
  const queried = confirmed.filter((wo) => wo.woStatus === 'Query to be raised');
  if (queried.length) {
    return { position: 'Query to be raised', remark: `Query to be raised on WO No. ${listLabels(queried)}.` };
  }
  if (considered.some((wo) => !isEngineerConfirmed(wo))) return { position: null, remark: '' };
  return {
    position: 'Technically Rejected',
    remark: accepted.length
      ? `Not acceptable: the accepted WO No. ${listLabels(accepted)} do not make up any PQC option (1 work, 2 works or 3 works).`
      : 'Not acceptable: none of the submitted work orders meets the PQC.',
  };
}

export function bidderFinalPosition(workOrders: IoclWorkOrderEntry[]): FinalPosition | null {
  return bidderOutcome(workOrders).position;
}

// When the NIT counts only "the completed value of items meeting similar nature", a work order
// that is not of similar nature contributes nothing to the value criterion.
export function countsOnlySimilarItemsValue(...texts: Array<string | undefined>): boolean {
  return texts.some((t) =>
    /value\s+of\s+(the\s+)?(items?|works?|portion)\s+(meeting|of|under|falling\s+under)\s+(the\s+)?similar\s+nature/i.test(String(t || ''))
  );
}

const ZEROED_NOTE = 'Counted as 0: not of similar nature, and the NIT counts only the value of items meeting similar nature.';

// Applies the rule above to one row, and undoes it once the row is of similar nature again.
// Idempotent: a row already at 0 with its values held back is returned unchanged.
export function withSimilarItemsValueRule(wo: IoclWorkOrderEntry, similarItemsOnly: boolean): IoclWorkOrderEntry {
  const held = wo.valuesBeforeSimilarNo;
  if (similarItemsOnly && wo.meetsSimilarNature === 'No') {
    if (held) return wo;
    return {
      ...wo,
      valuesBeforeSimilarNo: {
        compValueLacs: wo.compValueLacs ?? null,
        compValueBaseLacs: wo.compValueBaseLacs ?? null,
        annualisedValueLacs: wo.annualisedValueLacs ?? null,
      },
      compValueLacs: 0,
      compValueBaseLacs: null,
      annualisedValueLacs: wo.annualisedValueLacs === null ? null : 0,
      compValueNote: ZEROED_NOTE,
    };
  }
  if (!held) return wo;
  const { valuesBeforeSimilarNo: _held, ...rest } = wo;
  return {
    ...rest,
    compValueLacs: held.compValueLacs,
    compValueBaseLacs: held.compValueBaseLacs,
    annualisedValueLacs: held.annualisedValueLacs,
    compValueNote: wo.compValueNote === ZEROED_NOTE ? '' : wo.compValueNote,
  };
}

export interface TbaSummary {
  totalBids: number;
  acceptable: number;
  rejected: number;
  query: number;
  pendingReview: number;
}

export function summariseTba(bidders: IoclBidderEvaluation[]): TbaSummary {
  const summary: TbaSummary = { totalBids: bidders.length, acceptable: 0, rejected: 0, query: 0, pendingReview: 0 };
  for (const b of bidders) {
    const position = bidderFinalPosition(b.workOrders || []);
    if (position === 'Technically Acceptable') summary.acceptable++;
    else if (position === 'Technically Rejected') summary.rejected++;
    else if (position === 'Query to be raised') summary.query++;
    else summary.pendingReview++;
  }
  return summary;
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

export function numberToWords(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numberToWords(n % 100)}` : ''}`;
  return String(n);
}

export interface ExtractionContext {
  isArcTender: boolean;
  // This tender's NIT conditions, so JV shares and composite orders quote their clause.
  nit?: NitSource;
  docName: string;
  rawPdfUrl?: string;
  fileData?: string;
  storageUrl?: string;
  // NIT similar-nature definition sent for this extraction (see resolveSimilarNatureDefinition).
  similarNatureDefinition?: string;
  similarNatureClause?: string;
  // The original PDF as kept by sourcePdfStore, so the evidence viewer can reopen it later.
  sourceDocId?: string;
  sourceDocPath?: string;
}

const yesNo = (v: unknown): 'Yes' | 'No' | undefined => {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'yes') return 'Yes';
  if (s === 'no') return 'No';
  return undefined;
};

// Builds a TBA row from one work order returned by /api/extract-document. Values the
// document did not provide stay empty so the engineer sees the gap — nothing is invented.
// Duration and annualised value are recomputed here from the actual dates.
export function mapExtractedWorkOrder(raw: any, ctx: ExtractionContext): Omit<IoclWorkOrderEntry, 'id'> {
  const start = parseTbaDate(raw?.startDate);
  const compCertSubmitted = yesNo(raw?.compCertSubmitted) ?? 'No';
  // Without a completion certificate there is no proven completion date: a date read from the
  // work order is only its contractual end, so it is left blank and the sheet says why.
  const comp = compCertSubmitted === 'Yes' ? parseTbaDate(raw?.compDate) : null;
  const computedMonths = durationMonthsBetween(start && formatTbaDate(start), comp && formatTbaDate(comp), ctx.isArcTender);
  const statedMonths = compCertSubmitted === 'Yes' ? toNumber(raw?.durationMonths) : null;
  const months = computedMonths ?? statedMonths;

  const woGst = normaliseGstBasis(raw?.woValueGstBasis);
  const compGst = normaliseGstBasis(raw?.compValueGstBasis);
  const wo = applyGst(toNumber(raw?.woValueLacs), woGst);
  let completed = applyGst(toNumber(raw?.compValueLacs), compGst);
  const valueNotes: string[] = [];

  // A composite order whose AMC is still running counts for its completed supply-and-installation
  // part, which the NIT treats as a completed work.
  const supplyInstall = applyGst(toNumber(raw?.compositeSupplyInstallValueLacs), compGst);
  if (supplyInstall.lacs !== null && String(raw?.amcOngoing || '').toLowerCase() === 'yes') {
    completed = supplyInstall;
    valueNotes.push(
      `Composite work order with AMC/O&M still running: the completed supply and installation value Rs. ${supplyInstall.lacs.toFixed(2)} Lacs is counted` +
        `${clauseCitation(ctx.nit, 'composite-work')}.`
    );
  }

  // A JV / consortium work order counts in the bidder's share of it.
  const jvShare = toNumber(raw?.jvSharePercent);
  const hasJvShare = jvShare !== null && jvShare > 0 && jvShare < 100;
  if (hasJvShare && completed.lacs !== null) {
    const full = completed.lacs;
    completed = { lacs: round2((full * (jvShare as number)) / 100), baseLacs: null };
    valueNotes.push(
      `Executed as a JV / consortium member: ${jvShare}% share of Rs. ${full.toFixed(2)} Lacs counted` +
        `${clauseCitation(ctx.nit, 'joint-venture')}.`
    );
  }

  const woNumberAndDate = String(
    raw?.woNumberAndDate || [raw?.woNumber && `WO no. ${raw.woNumber}`, raw?.woDate && `dated ${raw.woDate}`].filter(Boolean).join(' ') || ''
  ).trim();

  const issuingOrg = String(raw?.issuingOrg || '').trim();
  const jobName = String(raw?.jobName || '').trim();
  const subcontract = detectSubcontract({
    aiFlag: raw?.isSubcontract,
    issuingOrg,
    jobName,
    woNumberAndDate,
    mainOwner: raw?.mainOwner,
    // Only the document's own quote: the AI's remarks may say "not a sub-contract".
    evidence: raw?.subcontractEvidence,
  });
  const isSubcontract = subcontract.isSubcontract;
  const statedApproval = yesNo(raw?.ownerApprovalSubmitted);
  // A direct order needs no owner approval; a sub-contract has it only if the document shows it.
  const ownerApproval: 'Yes' | 'No' | 'NA' = isSubcontract === 'Yes' ? (statedApproval ?? 'No') : 'NA';

  // The extractor's documentary recommendation; similar nature and sub-contract are applied on top.
  const annualised = annualisedLacs(completed.lacs, months, ctx.isArcTender);
  // The value criterion is not judged here: it needs the bidder's other work orders
  // (evaluateBidderWorkOrders), which the sheet applies once the row is added.
  // A provisional completion certificate (final bill pending, work still in progress) does not
  // prove completion: query for the final one. The extractor already treats an ARC completed for
  // its awarded / extended period as completed even while it runs on under extension.
  const provisionalCert = /provisional|interim/i.test(String(raw?.completionCertType || ''));
  const extractionStatus: WoStatus = provisionalCert ? 'Query to be raised' : normaliseWoStatus(raw?.woStatus || raw?.cvcRecommendation);
  const extractionRemarks = provisionalCert
    ? `Provisional completion certificate${raw?.completionCertNote ? ` (${String(raw.completionCertNote).trim()})` : ''}: bidder to submit the final completion certificate with the executed value.`
    : String(raw?.remarks || '').trim();
  const similarVerdict: SimilarNatureVerdict = yesNo(raw?.meetsSimilarNature) ?? 'To verify';
  const { status: suggestedStatus, remarks: suggestedRemarks } = suggestionWithSubcontract(
    suggestionWithSimilarNature(
      { status: extractionStatus, remarks: extractionRemarks },
      similarVerdict,
      raw?.similarNatureReason,
      { woNumberAndDate, clause: ctx.similarNatureClause || '' }
    ),
    isSubcontract,
    ownerApproval
  );
  const nilDev = yesNo(raw?.nilDeviationSheet) ?? 'Query to be raised';
  const remarksWithValueBasis = valueNotes.length
    ? `${suggestedRemarks ? `${suggestedRemarks} ` : ''}${valueNotes.join(' ')}`
    : suggestedRemarks;

  return {
    subIndex: raw?.subIndex ? String(raw.subIndex) : undefined,
    woNumberAndDate,
    issuingOrg,
    jobName,
    meetsSimilarNature: similarVerdict,
    similarNatureReason: String(raw?.similarNatureReason || '').trim() || undefined,
    similarNatureConfidence: ['high', 'medium', 'low'].includes(raw?.similarNatureConfidence) ? raw.similarNatureConfidence : undefined,
    similarNatureDefinition: ctx.similarNatureDefinition || undefined,
    compCertSubmitted,
    completionCertType: provisionalCert ? 'Provisional' : undefined,
    isSubcontract,
    subcontractReason: subcontract.reason,
    ownerApprovalSubmitted: ownerApproval,
    startDate: formatTbaDate(start),
    compDate: formatTbaDate(comp),
    durationMonths: months !== null ? String(months) : '',
    woValueLacs: wo.lacs,
    woValueBaseLacs: wo.baseLacs,
    woValueGstBasis: woGst,
    compValueLacs: completed.lacs,
    compValueBaseLacs: completed.baseLacs,
    compValueGstBasis: compGst,
    ownPlantWork: yesNo(raw?.ownPlantWork) === 'Yes' ? 'Yes' : undefined,
    jvSharePercent: hasJvShare ? (jvShare as number) : undefined,
    valueBasisNote: valueNotes.length ? valueNotes.join(' ') : undefined,
    annualisedValueLacs: annualised,
    nilDeviationSheet: nilDev,
    woStatus: suggestedStatus,
    finalPosition: finalPositionForStatus(suggestedStatus),
    remarks: remarksWithValueBasis,
    aiSuggestedStatus: suggestedStatus,
    aiSuggestedRemarks: remarksWithValueBasis,
    aiExtractionStatus: extractionStatus,
    aiExtractionRemarks: extractionRemarks,
    rawPdfDocName: ctx.docName,
    rawPdfUrl: ctx.rawPdfUrl,
    fileData: ctx.fileData,
    storageUrl: ctx.storageUrl,
    sourceDocId: ctx.sourceDocId,
    sourceDocPath: ctx.sourceDocPath,
    sourcePageStart: toNumber(raw?.sourcePageStart ?? raw?.startPage) ?? undefined,
    sourcePageEnd: toNumber(raw?.sourcePageEnd ?? raw?.endPage) ?? undefined,
    rawPdfSnippet: raw?.rawPdfSnippet
      ? {
          pageNumber: Number(raw.rawPdfSnippet.pageNumber) || 1,
          quoteText: String(raw.rawPdfSnippet.quoteText || ''),
          fieldMatch: String(raw.rawPdfSnippet.fieldMatch || ''),
        }
      : undefined,
    confidenceScore: toNumber(raw?.confidenceScore) ?? undefined,
  };
}

// Work orders in an /api/extract-document response, wherever the server placed them.
export function extractedWorkOrdersFrom(json: any): any[] {
  const candidates = [json?.data?.workOrders, json?.workOrders, json?.data?.allWorkOrders, json?.allWorkOrders];
  const found = candidates.find((c) => Array.isArray(c) && c.length > 0);
  if (found) return found;
  // The server reported a list and it is empty: the document holds no work order. The summary
  // fields beside it ("Work Order Credentials Ingested") are not one, so nothing is made up here.
  if (candidates.some(Array.isArray) || json?.noWorkOrdersReason) return [];
  return json?.data && (json.data.woNumberAndDate || json.data.woValueLacs != null) ? [json.data] : [];
}

// The message for an upload in which no work order was found.
export function noWorkOrdersMessage(json: any, fileName: string): string {
  const why = String(json?.noWorkOrdersReason || '').trim();
  return `No work order found in ${fileName}${why ? `: ${why}` : '.'} Nothing was added for this bidder. Upload the bidder's work orders / completion certificates, or paste their text.`;
}

// ---------------------------------------------------------------------------------------------
// Duplicate work orders. Bidders often submit the same work order in more than one PDF (or twice
// in one): the WO copy in one file and its completion certificate in another. A row is the same
// work order when its number matches and the issuers do not contradict each other.
// ---------------------------------------------------------------------------------------------

// "Work Order No. 27244562 Dt: 25-09-2021" -> "27244562". Null when no usable number is found.
export function workOrderNumberOf(woNumberAndDate: string): string | null {
  const text = String(woNumberAndDate || '').replace(/\s+/g, ' ');
  const labelled = /(?:work\s*order|purchase\s*order|contract|agreement|\bwo|\bpo|\bloa|\bloi)\s*(?:no\.?|number|#)?\s*[:.-]?\s*([A-Za-z0-9][A-Za-z0-9/_-]*\d[A-Za-z0-9/_-]*)/i.exec(text);
  const candidate = labelled?.[1] ?? /\b(\d{5,})\b/.exec(text)?.[1] ?? null;
  if (!candidate) return null;
  const key = candidate.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return key.length >= 4 ? key : null;
}

const issuerTokens = (org: string) =>
  new Set(
    String(org || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !['ltd', 'limited', 'the', 'and', 'pvt', 'private', 'corporation', 'company', 'india'].includes(t))
  );

// Same plant owner, or one issuer's name contained in the other's ("IOCL" vs "Indian Oil
// Corporation Ltd, Haldia Refinery"). An issuer that was not read contradicts nothing.
function sameIssuer(a: string, b: string): boolean {
  if (!String(a || '').trim() || !String(b || '').trim()) return true;
  const ownerA = PLANT_OWNERS.find((o) => o.pattern.test(a))?.name;
  const ownerB = PLANT_OWNERS.find((o) => o.pattern.test(b))?.name;
  if (ownerA || ownerB) return ownerA === ownerB;
  const ta = issuerTokens(a);
  return [...issuerTokens(b)].some((t) => ta.has(t));
}

export function isSameWorkOrder(
  a: Pick<IoclWorkOrderEntry, 'woNumberAndDate' | 'issuingOrg'>,
  b: Pick<IoclWorkOrderEntry, 'woNumberAndDate' | 'issuingOrg'>
): boolean {
  const na = workOrderNumberOf(a.woNumberAndDate);
  return Boolean(na && na === workOrderNumberOf(b.woNumberAndDate) && sameIssuer(a.issuingOrg, b.issuingOrg));
}

type WoFields = Omit<IoclWorkOrderEntry, 'id'>;
const isBlank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && !v.trim()) || v === '-';

// Fields a later copy of the same work order can fill in when the kept row lacks them. Dates and
// the completed value usually come from the completion certificate, which may arrive separately.
const MERGEABLE_FIELDS: Array<keyof WoFields> = [
  'issuingOrg', 'jobName', 'startDate', 'compDate', 'durationMonths',
  'woValueLacs', 'woValueBaseLacs', 'woValueGstBasis',
  'compValueLacs', 'compValueBaseLacs', 'compValueGstBasis', 'annualisedValueLacs',
];

// The kept row, with whatever it lacked filled in from the duplicate. A completion certificate in
// the duplicate also answers column 6.
export function mergeDuplicateWorkOrder<T extends WoFields>(kept: T, duplicate: WoFields): T {
  const merged: any = { ...kept };
  for (const key of MERGEABLE_FIELDS) {
    if (isBlank(merged[key]) && !isBlank((duplicate as any)[key])) merged[key] = (duplicate as any)[key];
  }
  if (kept.compCertSubmitted !== 'Yes' && duplicate.compCertSubmitted === 'Yes') merged.compCertSubmitted = 'Yes';
  return merged;
}

export interface DuplicateSplit<T extends WoFields> {
  fresh: T[];
  // Incoming rows that repeat a work order already present (existingId) or earlier in the same batch.
  duplicates: Array<{ row: T; existingId?: string; label: string }>;
}

// Splits newly extracted rows into genuinely new work orders and repeats of ones already listed
// for this bidder (or repeated within the batch itself).
export function splitDuplicateWorkOrders<T extends WoFields>(existing: IoclWorkOrderEntry[], incoming: T[]): DuplicateSplit<T> {
  const fresh: T[] = [];
  const duplicates: DuplicateSplit<T>['duplicates'] = [];
  for (const row of incoming) {
    const label = workOrderRef(row.woNumberAndDate);
    const match = existing.find((e) => isSameWorkOrder(e, row));
    if (match) {
      duplicates.push({ row, existingId: match.id, label });
      continue;
    }
    const earlier = fresh.findIndex((f) => isSameWorkOrder(f, row));
    if (earlier >= 0) {
      fresh[earlier] = mergeDuplicateWorkOrder(fresh[earlier], row);
      duplicates.push({ row, label });
      continue;
    }
    fresh.push(row);
  }
  return { fresh, duplicates };
}

export interface DuplicateFinding {
  // Work order rows that are the same work order as another row.
  sameBidder: Record<string, string>;
  // The same work order number submitted by more than one bidder.
  acrossBidders: Record<string, string>;
}

// Duplicates among the rows already in the sheet, whenever they got there: two rows of one bidder
// for the same work order (usually a WO copy and its completion certificate extracted separately),
// and the same work order submitted by two bidders, which is worth a second look.
export function findDuplicateWorkOrders(bidders: IoclBidderEvaluation[]): DuplicateFinding {
  const sameBidder: Record<string, string> = {};
  const acrossBidders: Record<string, string> = {};
  const seen: Array<{ bidderName: string; wo: IoclWorkOrderEntry }> = [];

  for (const b of bidders) {
    const rows = b.workOrders || [];
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        if (!isSameWorkOrder(rows[i], rows[j])) continue;
        sameBidder[rows[i].id] = `Same work order as row ${j + 1} of this bidder (WO No. ${workOrderRef(rows[j].woNumberAndDate)}).`;
        sameBidder[rows[j].id] = `Same work order as row ${i + 1} of this bidder (WO No. ${workOrderRef(rows[i].woNumberAndDate)}).`;
      }
      const other = seen.find((s) => s.bidderName !== b.bidderName && isSameWorkOrder(s.wo, rows[i]));
      if (other) {
        acrossBidders[rows[i].id] = `The same work order number is also submitted by ${other.bidderName}.`;
        acrossBidders[other.wo.id] = `The same work order number is also submitted by ${b.bidderName}.`;
      }
      seen.push({ bidderName: b.bidderName, wo: rows[i] });
    }
  }
  return { sameBidder, acrossBidders };
}

// Message asking the engineer to confirm merging, e.g. "2 duplicate work orders found: WO No. X, Y".
export function duplicateMergePrompt(duplicates: Array<{ label: string }>): string {
  const labels = [...new Set(duplicates.map((d) => d.label))];
  return (
    `${duplicates.length} duplicate work order${duplicates.length === 1 ? '' : 's'} found in this upload ` +
    `(WO No. ${labels.join('; ')}), already extracted for this bidder.\n\n` +
    'OK: merge them - keep one row per work order and fill in any details the existing row is missing.\n' +
    'Cancel: add them as separate rows anyway.'
  );
}

// ---------------------------------------------------------------------------------------------
// Corrigenda. A corrigendum / addendum / clarification amends the NIT: only the values and clauses
// it changes are replaced, everything else stays as read from the NIT, and each clause records the
// document it now comes from.
// ---------------------------------------------------------------------------------------------

const hasValue = (v: unknown) =>
  v !== null && v !== undefined && !(typeof v === 'string' && !v.trim()) && !(typeof v === 'number' && !(v > 0) && v !== 0);

// The NIT form fields a corrigendum may change, by the name the extractor returns them under.
// The job title, client and location are left out: a corrigendum names them only to identify the
// tender, often shortened, and taking them as changes would overwrite the NIT's full wording.
const CORRIGENDUM_FORM_FIELDS = [
  'dateOfBidOpening', 'estimatedCostCr',
  'optionASingleWorkCr', 'optionBTwoWorksCr', 'optionCThreeWorksCr', 'minAnnualTurnoverCr',
  'similarWorkDefinition', 'similarWorkClause', 'additionalPqc',
] as const;

// The bid submission date is not among them: NITs count the experience window from the ORIGINAL
// last date of submission, so an extension in a corrigendum is recorded but does not move it.
const CORRIGENDUM_CONDITION_FIELDS = [
  'experienceWindowYears', 'experienceWindowText', 'annualisationApplicable', 'valueBasisText',
] as const;

export interface CorrigendumMerge<F> {
  form: F;
  conditions: Partial<IoclTenderMetadata>;
  // What changed, for the engineer to check before saving.
  changes: string[];
}

export function mergeNitCorrigendum<F extends Record<string, any>>(
  form: F,
  conditions: Partial<IoclTenderMetadata>,
  corrigendum: any,
  documentName: string
): CorrigendumMerge<F> {
  const title = String(corrigendum?.documentTitle || '').trim() || documentName;
  const changes: string[] = [];
  const nextForm: Record<string, any> = { ...form };
  for (const key of CORRIGENDUM_FORM_FIELDS) {
    const v = corrigendum?.[key];
    if (!hasValue(v) || !(key in nextForm) || nextForm[key] === v) continue;
    changes.push(`${key}: ${String(nextForm[key] ?? '') || '(blank)'} -> ${v}`);
    nextForm[key] = v;
  }
  if (typeof corrigendum?.hasApqc === 'boolean' && 'hasApqc' in nextForm && nextForm.hasApqc !== corrigendum.hasApqc) {
    changes.push(`hasApqc: ${nextForm.hasApqc} -> ${corrigendum.hasApqc}`);
    nextForm.hasApqc = corrigendum.hasApqc;
  }

  const nextConditions: Partial<IoclTenderMetadata> = { ...conditions };
  for (const key of CORRIGENDUM_CONDITION_FIELDS) {
    const v = corrigendum?.[key];
    if (key === 'annualisationApplicable' ? typeof v !== 'boolean' : !hasValue(v)) continue;
    if ((nextConditions as any)[key] === v) continue;
    changes.push(`${key}: ${String((nextConditions as any)[key] ?? '') || '(blank)'} -> ${v}`);
    (nextConditions as any)[key] = v;
  }

  const extendedTo = String(corrigendum?.bidSubmissionDate || '').trim();
  if (extendedTo && extendedTo !== conditions.bidSubmissionDate) {
    changes.push(
      `Bid submission extended to ${extendedTo}; the experience window still counts from the original date${conditions.bidSubmissionDate ? ` (${conditions.bidSubmissionDate})` : ''}`
    );
  }

  // Clauses: an amended clause replaces the NIT's clause of the same number (or, when either is
  // unnumbered, the same topic); a new one is added. Each keeps the document it came from.
  const clauses = [...(conditions.nitClauses || [])];
  for (const raw of Array.isArray(corrigendum?.pqcClauses) ? corrigendum.pqcClauses : []) {
    const clause: NitClause = { ...raw, source: title };
    const at = clauses.findIndex((c) => (clause.no && c.no ? c.no === clause.no : c.topic === clause.topic));
    if (at >= 0) {
      clauses[at] = clause;
      changes.push(`Clause ${clause.no || clause.topic} amended`);
    } else {
      clauses.push(clause);
      changes.push(`Clause ${clause.no || clause.topic} added`);
    }
  }
  nextConditions.nitClauses = clauses;
  nextConditions.nitDocuments = [
    ...(conditions.nitDocuments || []),
    {
      name: documentName,
      kind: 'Corrigendum',
      title,
      readAt: new Date().toISOString(),
      summary: String(corrigendum?.changeSummary || '').trim() || changes.join('; '),
    },
  ];
  return { form: nextForm as F, conditions: nextConditions, changes };
}

// ---------------------------------------------------------------------------------------------
// The bidder's own list of claimed orders (performance statement, CA / auditor certificate). Each
// claimed order is checked against the work orders actually extracted, so an order the bidder
// relies on but did not document - or that the extraction missed - is put in front of the engineer.
// ---------------------------------------------------------------------------------------------

// Compact order-number key: "4700111095/102" -> "4700111095102".
const orderKey = (no: unknown) => String(no ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Same order when the keys match, or one is the other plus a suffix ("4700111095" and
// "4700111095/102", "GS5/230146694" and "GS5230146694"). Both need at least 6 characters.
export function isSameOrderNumber(a: unknown, b: unknown): boolean {
  const ka = orderKey(a);
  const kb = orderKey(b);
  if (ka.length < 6 || kb.length < 6) return false;
  if (ka === kb || ka.startsWith(kb) || kb.startsWith(ka)) return true;
  // A reference printed in front of the order number ("CPCLV24075/ 29989899" for PO 29989899):
  // the shorter number, if long enough to be distinctive, closes the longer one.
  const [short, long] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  return short.length >= 8 && long.endsWith(short);
}

// Order number of an extracted row, as printed ("Work Order No. RD:MPX: 53265001 Dt: ..." -> the number).
const rowOrderNo = (wo: Pick<IoclWorkOrderEntry, 'woNumberAndDate'>) => workOrderNumberOf(wo.woNumberAndDate) ?? orderKey(wo.woNumberAndDate);

// The claimed orders in an /api/extract-document response, tagged with the file they came from.
export function claimedOrdersFrom(json: any, docName: string): ClaimedOrder[] {
  const list = Array.isArray(json?.claimedOrders) ? json.claimedOrders : Array.isArray(json?.data?.claimedOrders) ? json.data.claimedOrders : [];
  return list
    .filter((c: any) => c && orderKey(c.orderNo).length >= 5)
    .map((c: any) => ({ ...c, source: String(c.source || 'other'), docName }));
}

// Adds newly read claimed orders to a bidder's list: one entry per order and source, a later read
// filling in what an earlier one lacked.
export function mergeClaimedOrders(existing: ClaimedOrder[] | undefined, incoming: ClaimedOrder[] | undefined): ClaimedOrder[] {
  const out = [...(existing || [])];
  for (const c of incoming || []) {
    if (orderKey(c.orderNo).length < 5) continue;
    const at = out.findIndex((e) => e.source === c.source && isSameOrderNumber(e.orderNo, c.orderNo));
    if (at < 0) {
      out.push(c);
      continue;
    }
    const merged: any = { ...out[at] };
    for (const [k, v] of Object.entries(c)) {
      if ((merged[k] === null || merged[k] === undefined || merged[k] === '') && v !== null && v !== undefined && v !== '') merged[k] = v;
    }
    out[at] = merged;
  }
  return out;
}

export interface ClaimedOrderGroup {
  orderNo: string;
  client: string;
  sources: string[];
}

// Orders the bidder claims (in any list) for which no work-order row exists: undocumented, or
// missed by the extraction. One entry per order, naming every list that claims it.
export function claimedOrdersWithoutDocuments(claimed: ClaimedOrder[] | undefined, workOrders: IoclWorkOrderEntry[]): ClaimedOrderGroup[] {
  const groups: ClaimedOrderGroup[] = [];
  for (const c of claimed || []) {
    if (workOrders.some((wo) => isSameOrderNumber(rowOrderNo(wo), c.orderNo))) continue;
    const g = groups.find((x) => isSameOrderNumber(x.orderNo, c.orderNo));
    const source = c.issuedBy || c.source;
    if (g) {
      if (!g.sources.includes(source)) g.sources.push(source);
      if (!g.client && c.client) g.client = c.client;
    } else {
      groups.push({ orderNo: c.orderNo, client: c.client || '', sources: [source] });
    }
  }
  return groups;
}

// For a row without the end client's completion certificate: what a CA / auditor certificate in
// the bid says was executed. Stated for the engineer; it does not replace the client's certificate.
export function caCertifiedNote(wo: IoclWorkOrderEntry, claimed: ClaimedOrder[] | undefined): string | null {
  const noClientProof = wo.compCertSubmitted !== 'Yes' || typeof wo.compValueLacs !== 'number';
  if (!noClientProof) return null;
  const ca = (claimed || []).find(
    (c) => c.source === 'CA certificate' && isSameOrderNumber(c.orderNo, rowOrderNo(wo)) && (c.executedValueLacs || c.actualEnd || c.status)
  );
  if (!ca) return null;
  const parts: string[] = [];
  if (ca.executedValueLacs) parts.push(`executed value Rs. ${ca.executedValueLacs.toFixed(2)} Lacs`);
  if (ca.actualStart || ca.actualEnd) parts.push(`actual period ${ca.actualStart || '?'} to ${ca.actualEnd || '?'}`);
  if (ca.status) parts.push(`status "${ca.status}"`);
  const who = ca.issuedBy || 'a chartered accountant';
  return (
    `${who}${ca.page ? ` (p. ${ca.page})` : ''} certifies ${parts.join(', ')}; ` +
    `the end client's completion certificate for this order is not in the documents.`
  );
}

