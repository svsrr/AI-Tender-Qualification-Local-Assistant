export type UserRole = 'Evaluation Engineer' | 'Tender Committee Member' | 'Administrator';

export type DocumentType =
  | 'Work Orders'
  | 'Completion Certificates'
  | 'Annual Turnover (ATO) / CA Certificates'
  | 'Undertakings & Declarations (Nil Deviation, MII, etc.)'
  | 'Statutory & Tax (Form 26AS, GST, PAN)'
  | 'Combined / Mixed Dossier'
  | 'Experience Certificates'
  | 'Letters of Award'
  | 'Contract Agreements'
  | 'Performance Certificates'
  | 'Client Certificates'
  | 'Other Supporting Documents';

export type BoundingBoxCategory =
  | 'monetary'
  | 'signature_stamp'
  | 'scope_similar_nature'
  | 'date_duration'
  | 'subcontract_eic'
  | 'statutory_tax'
  | 'general';

export interface PdfBoundingBox {
  id: string;
  pageNumber: number;
  label: string;
  fieldKey: string;
  category: BoundingBoxCategory;
  // Normalized coordinates in range [0, 1000] (ymin, xmin, ymax, xmax) for responsive visual canvas rendering
  box2d: [number, number, number, number];
  extractedValue: string;
  confidenceScore: number; // 0-100 (e.g. 98.8)
  // How the position was found on the original PDF: an exact match in the PDF's text layer,
  // or Gemini reading the rendered page image. Boxes without it are not tied to a real position.
  locatedBy?: 'text-layer' | 'ai-vision';
  ocrQuote: string;
  pqcClauseRef?: string;
  verifiedAgainst?: string;
  riskNote?: string;
}

// Option lists match the dropdowns in the committee's TBA Excel template.
export const WO_STATUS_OPTIONS = [
  'WO Accepted(1 WO)',
  'WO Accepted(2 WO)',
  'WO Accepted(3 WO)',
  'Query to be raised',
  'Not Evaluated',
  'WO Rejected',
] as const;
export type WoStatus = (typeof WO_STATUS_OPTIONS)[number];

export const FINAL_POSITION_OPTIONS = ['Technically Acceptable', 'Technically Rejected', 'Query to be raised'] as const;
export type FinalPosition = (typeof FINAL_POSITION_OPTIONS)[number];

export type GstBasis = 'Incl. GST' | 'Excl. GST' | 'Not stated';

// One order from the bidder's own list of experience: a performance statement or a chartered
// accountant's certificate. Kept per bidder and checked against the work orders extracted.
export interface ClaimedOrder {
  orderNo: string;
  client?: string;
  orderDate?: string;
  valueLacs?: number | null;
  valueGstBasis?: string;
  executedValueLacs?: number | null;
  actualStart?: string;
  actualEnd?: string;
  status?: string;
  source: string; // 'performance statement' | 'CA certificate' | 'experience list' | 'other'
  issuedBy?: string;
  page?: number | null;
  docName?: string;
}

export interface IoclWorkOrderEntry {
  id: string;
  subIndex?: string; // e.g. "1", "2", "3" or undefined for single WO
  woNumberAndDate: string;
  issuingOrg: string;
  jobName: string;
  meetsSimilarNature: 'Yes' | 'No' | 'To verify';
  // Why the AI suggested the column 5 value, and the NIT definition it was judged against
  // (a changed definition makes the suggestion stale).
  similarNatureReason?: string;
  similarNatureConfidence?: 'high' | 'medium' | 'low';
  similarNatureDefinition?: string;
  // The extractor's status/remarks before the similar-nature verdict was applied, so a re-check
  // can recompute the suggestion.
  aiExtractionStatus?: WoStatus;
  aiExtractionRemarks?: string;
  compCertSubmitted: 'Yes' | 'No';
  // Set when the only completion certificate is provisional (final bill pending / job ongoing).
  completionCertType?: 'Provisional';
  // Work the bidder executed for its own plant or group: not counted as experience.
  ownPlantWork?: 'Yes' | 'No';
  // The bidder's share of a JV / consortium work order; the value counts in that proportion.
  jvSharePercent?: number;
  // Why the completed value differs from the certificate's headline figure (JV share, the
  // supply-and-installation part of a composite order, items of similar nature only).
  valueBasisNote?: string;
  isSubcontract: 'Yes' | 'No';
  // Why column 7 says Yes (issuer vs plant owner, or the document's wording), for the engineer to check.
  subcontractReason?: string;
  ownerApprovalSubmitted: 'Yes' | 'No' | 'NA';
  startDate: string;
  compDate: string;
  durationMonths: string;
  // woValueLacs / compValueLacs are always the incl.-GST figures used for evaluation.
  // When the document states an ex-GST figure, it is kept in *BaseLacs so exports can
  // show the auditable formula (e.g. =102.57*1.18) instead of only the result.
  woValueLacs: number | null;
  woValueBaseLacs?: number | null;
  woValueGstBasis?: GstBasis;
  woValueNote?: string;
  compValueLacs: number | null;
  compValueBaseLacs?: number | null;
  compValueGstBasis?: GstBasis;
  compValueNote?: string;
  annualisedValueLacs: number | null;
  // Values held back while a row counts as zero because it is not of similar nature and the NIT
  // counts only the value of items meeting similar nature; restored if column 5 goes back to Yes.
  valuesBeforeSimilarNo?: { compValueLacs: number | null; compValueBaseLacs: number | null; annualisedValueLacs: number | null };
  apqcDocumentNo?: string;
  meetsApqc?: 'Yes' | 'No' | 'NA';
  nilDeviationSheet: 'Yes' | 'No' | 'Query to be raised';
  woStatus: WoStatus;
  finalPosition?: FinalPosition;
  remarks: string;
  // The AI only suggests a status; the export uses woStatus/finalPosition/remarks once an
  // engineer has confirmed them (engineerConfirmedBy set). Unconfirmed rows export as pending.
  aiSuggestedStatus?: WoStatus;
  aiSuggestedRemarks?: string;
  engineerConfirmedBy?: string;
  engineerConfirmedAt?: string;
  rawPdfDocName?: string;
  rawPdfSnippet?: {
    pageNumber: number;
    quoteText: string;
    fieldMatch: string;
  };
  boundingBoxes?: PdfBoundingBox[];
  // Version of the evidence locator that produced boundingBoxes; older caches are recomputed.
  boundingBoxesVersion?: number;
  confidenceScore?: number;
  // The original uploaded PDF: SHA-256 content id (IndexedDB key) and its Firebase Storage path.
  sourceDocId?: string;
  sourceDocPath?: string;
  // Pages of the source PDF this work order spans, as reported by the extractor.
  sourcePageStart?: number;
  sourcePageEnd?: number;
  storageUrl?: string;
  rawPdfUrl?: string;
  fileData?: string;
}

export interface IoclBidderEvaluation {
  slNo: number;
  id: string;
  bidderName: string;
  cityState: string;
  workOrders: IoclWorkOrderEntry[];
  // Orders the bidder lists in its own performance statement / CA certificate, read from its PDFs.
  claimedOrders?: ClaimedOrder[];
  finalPosition: FinalPosition;
  pageNumber: number;
  gstin?: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  rawPdfsCount?: number;
}

export interface CommitteeMember {
  id: string;
  name: string;
  designation: string;
  role: string;
  department: string;
  signDate?: string;
  status: 'Approved' | 'Concurred' | 'Initiated & Evaluated' | 'Signed' | 'Pending Review';
  employeeId?: string;
  notes?: string;
}

// One condition of this tender's NIT, as read from the document. The NIT decides: where a clause
// exists, the rules quote it, and where a clause allows a relaxation the engineer is asked rather
// than the built-in rule being applied silently.
export type NitClauseTopic =
  | 'similar-nature' | 'value' | 'annualisation' | 'experience-window' | 'subcontract' | 'own-plant'
  | 'joint-venture' | 'executed-value' | 'composite-work' | 'gst' | 'completion-proof'
  | 'rate-contract-extension' | 'turnover' | 'relaxation' | 'other';

export interface NitClause {
  no: string;
  title: string;
  topic: NitClauseTopic;
  requirement: string;
  relaxation?: string;
  text?: string;
  // The document the clause now comes from: the NIT, or the corrigendum that amended it.
  source?: string;
}

// A document read for the tender's conditions: the NIT and any corrigenda / addenda after it.
export interface NitDocumentRecord {
  name: string;
  kind: 'NIT' | 'Corrigendum';
  title?: string;
  readAt: string;
  summary?: string;
}

export interface IoclTenderMetadata {
  tenderNo: string;
  jobName: string;
  typeOfJob: string;
  similarNatureDefinition: string;
  // NIT clause number holding that definition (e.g. "11.3"), quoted in rejection remarks.
  similarNatureClause?: string;
  valueOption1Job: string;
  valueOption2Jobs: string;
  valueOption3Jobs: string;
  additionalPqc: string;
  hasApqc?: boolean;
  trDate: string;
  dateOfBidOpening: string;
  // Read from the NIT (editable in the TBA header): the original last date of bid submission and
  // the experience window that goes with it, e.g. 7 years ending with the month before it.
  bidSubmissionDate?: string;
  experienceWindowYears?: number | null;
  experienceWindowText?: string;
  // The NIT's own word on annualisation and on which value counts; null/'' when it is silent.
  annualisationApplicable?: boolean | null;
  valueBasisText?: string;
  nitClauses?: NitClause[];
  nitDocuments?: NitDocumentRecord[];
  totalBids: number;
  totalBidsText: string;
  technicallyAcceptable: number;
  technicallyNotAcceptable: number;
  queryToBeRaisedTo: number;
  signatories: {
    approvingAuthority?: { name: string; title: string; designation: string; department?: string; signDate?: string; status?: string } | null;
    nextSuperiorOfficer?: { name: string; title: string; designation: string; department?: string; signDate?: string; status?: string } | null;
    superiorOfficer?: { name: string; title: string; designation: string; department?: string; signDate?: string; status?: string } | null;
    initiator?: { name: string; title: string; designation: string; department?: string; signDate?: string; status?: string } | null;
  };
  committeeMembers?: CommitteeMember[];
}


export type VerificationStatus = 'Pending' | 'Approved' | 'Edited' | 'Rejected' | 'Needs Clarification';

export type MatchStatus = 'Match' | 'Partial Match' | 'Mismatch';

export type EligibilityStatus = 'Eligible' | 'Conditionally Eligible' | 'Not Eligible' | 'Pending Evaluation';

export type TechnicalRecommendation =
  | 'Technically Acceptable'
  | 'Query to be Raised'
  | 'Technically Rejected';

export type SimilarNatureStatus = 'Compliant' | 'Partially Compliant' | 'Non-Compliant';

export type SubcontractStatus = 'Approved & Counted' | 'Disallowed - Missing Client NOC' | 'Not Applicable';

export interface EvidenceSource {
  pageNumber: number;
  snippet: string;
  confidenceScore: number;
  highlightCoordinates?: { x: number; y: number; width: number; height: number };
}

export interface ExtractedField {
  id: string;
  fieldName: string;
  key: string;
  extractedValue: string;
  verifiedValue?: string;
  confidenceScore: number; // 0-100
  pageNumber: number;
  evidenceSnippet: string;
  status: VerificationStatus;
  engineerNotes?: string;
  isMandatory?: boolean;
  boundingBox?: PdfBoundingBox;
}

export interface DossierExhibit {
  id: string;
  type: 'Work Order' | 'Completion Certificate' | 'Invoice' | 'Turnover Certificate' | 'Form 26AS' | 'Bank Statement' | 'GST Return' | 'Measurement Sheet' | 'Undertaking' | 'Other';
  title: string;
  startPage: number;
  endPage: number;
  referenceNo?: string;
  issuingOrg?: string;
  valueLacs?: number;
  certPage?: number;
  summary?: string;
  rawSnippet?: string;
  status?: 'Extracted' | 'Pending' | 'Verified';
}

export interface FinancialTriangulationSummary {
  annualTurnover?: Array<{ financialYear: string; turnoverLacs: number; caUdin?: string }>;
  form26AsRecords?: Array<{ deductorName: string; tan: string; totalAmountPaidLacs: number; totalTdsLacs: number }>;
  bankCredits?: Array<{ date: string; remitter: string; amountLacs: number; utrRef?: string; matchedWoNo?: string }>;
  triangulationStatus: 'Corroborated' | 'Partial Mismatch' | 'Pending Review';
  triangulationNotes: string;
}

export interface DocumentItem {
  id: string;
  bidderId: string;
  fileName: string;
  uploadTime: string;
  documentType: DocumentType;
  fileSizeBytes: number;
  pageCount: number;
  status: 'Processing' | 'Extracted' | 'Verified' | 'Discrepancy Flagged';
  overallConfidence: number;
  extractedFields: ExtractedField[];
  previewUrl?: string;
  authenticityScore: number;
  riskFlags: string[];
  rawTextPreview?: string;
  storageUrl?: string;
  fileData?: string;
  dossierManifest?: DossierExhibit[];
  allWorkOrders?: any[];
  financialTriangulation?: FinancialTriangulationSummary;
}

export interface BidderCredential {
  id: string;
  bidderId: string;
  workOrderNumber: string;
  workOrderDate: string;
  projectName: string;
  clientName: string;
  location: string;
  contractType: 'Project / LSTK' | 'Turnaround / Shutdown' | 'ARC / AMC Rate Contract' | 'Subcontract';
  isArc: boolean;
  contractDurationMonths: number;
  awardedValueCr: number;
  executedValueCr: number;
  annualizedValueCr: number; // For ARC: (executedValueCr / durationMonths) * 12
  isCompleted: boolean;
  completionDate: string;
  hasClientCompletionCertificate: boolean;
  isWithinRecencyWindow: boolean; // within 7 years
  liquidatedDamagesImposed: boolean;
  scopeDescription: string;
  similarNatureScore: number; // 0-100
  similarNatureStatus: SimilarNatureStatus;
  matchedKeywords: string[];
  missingKeywords: string[];
  isSubcontract: boolean;
  mainContractorName?: string;
  hasClientSubcontractApproval: boolean;
  hasDirectPaymentProof: boolean; // TDS Form 26AS / GST invoices
  subcontractStatus: SubcontractStatus;
  missingDocuments: string[];
  evaluationNotes?: string;
}

export interface TechnicalQuery {
  id: string;
  tqRefNo: string;
  bidderId: string;
  bidderName: string;
  clauseRef: string;
  credentialRef?: string;
  deficiency: string;
  queryText: string;
  responseDeadline: string;
  status: 'Draft' | 'Issued to Bidder' | 'Response Received' | 'Closed / Accepted' | 'Dropped';
  issuedAt?: string;
  bidderResponse?: string;
  bidderResponseDate?: string;
  evaluatorRemarks?: string;
}

export interface Bidder {
  id: string;
  bidderName: string;
  bidNumber: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  tenderReference: string;
  submissionDate: string;
  gstin: string;
  category: string;
  annualTurnoverCr: number;
  netWorthCr: number;
  positiveNetWorth: boolean;
  status: 'Under Review' | 'In Scrutiny' | 'Recommended' | 'Rejected' | 'Query Raised';
  overallScore: number;
  eligibilityStatus: EligibilityStatus;
  technicalRecommendation: TechnicalRecommendation;
  recommendationReason: string;
  engineerDecision?: TechnicalRecommendation;
  engineerDecisionNotes?: string;
  engineerDecisionBy?: string;
  engineerDecisionAt?: string;
  documentsCount: number;
  credentials: BidderCredential[];
  missingDocumentsList: string[];
}

export interface DocumentComparisonItem {
  field: string;
  label: string;
  docAValue: string;
  docBValue: string;
  matchStatus: MatchStatus;
  varianceNote?: string;
}

export interface ComparisonPair {
  id: string;
  bidderId: string;
  docAId: string;
  docBId: string;
  docAName: string;
  docBName: string;
  docAType: DocumentType;
  docBType: DocumentType;
  overallMatch: MatchStatus;
  items: DocumentComparisonItem[];
}

export interface ValidationRule {
  id: string;
  ruleNumber: number;
  ruleName: string;
  description: string;
  category: 'Integrity' | 'Temporal' | 'Scope & Value' | 'Compliance' | 'Authenticity';
  severity: 'Critical' | 'Major' | 'Minor';
  status: 'PASS' | 'WARNING' | 'FAIL';
  details: string;
  affectedBidderId: string;
  affectedBidderName: string;
  documentRef?: string;
  suggestedAction: string;
}

export interface TenderEligibilityCriteria {
  tenderTitle: string;
  tenderRef: string;
  clientOrg: string;
  location: string;
  estimatedCostCr: number;
  closingDate: string;
  minWorkExperienceYears: number;
  // PSU 3-tier formula
  optionASingleWorkPercent: number; // e.g. 80%
  optionASingleWorkCr: number; // e.g. 36.00 Cr
  optionBTwoWorksPercent: number; // e.g. 50%
  optionBTwoWorksCr: number; // e.g. 22.50 Cr
  optionCThreeWorksPercent: number; // e.g. 40%
  optionCThreeWorksCr: number; // e.g. 18.00 Cr
  recencyYears: number; // 7 years
  similarWorkDefinition: string;
  similarWorkClause?: string;
  requiredScopeKeywords: string[];
  arcAnnualizationAllowed: boolean;
  typeOfJob?: 'One time' | 'ARC' | string;
  subcontractAllowedWithApproval: boolean;
  maxSubcontractPercent: number;
  minAnnualTurnoverPercent: number; // 30%
  minAnnualTurnoverCr: number; // 13.50 Cr
  positiveNetWorthRequired: boolean;
  mandatoryDocuments: string[];
  isConfigured?: boolean;
  // Evaluator alias fields
  minSingleContractValueCr?: number;
  relevantIndustry?: string;
  similarWorkRequirement?: string;
  completionWithinLastNYears?: number;
  minCompletedProjects?: number;

  // Option A & Option B PQC fields
  provisionMethod?: 'upload-nit' | 'manual-form' | 'refinery-preset';
  uploadedNitDocName?: string;
  hasApqc?: boolean;
  additionalPqc?: string;
  commercialPqc?: string;
  specialClauses?: string;
  subcontractRequirements?: string;
  completionCriteria?: string;
  requireCompletionCertificate?: boolean;
  arcAnnualizationRequirements?: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  user: string;
  role: UserRole;
  action: string;
  bidderName?: string;
  documentName?: string;
  fieldName?: string;
  oldValue: string;
  newValue: string;
  reason: string;
}

export type TenderId = string;

export interface FinancialTriangulationRecord {
  id: string;
  documentType: 'Work Order' | 'Bank Statement' | 'Form 26AS' | 'GSTR-3B' | 'CA Certificate';
  referenceNo: string;
  date: string;
  counterparty: string;
  amountClaimed: number;
  amountVerified: number;
  transactionRef?: string;
  tdsSection?: string;
  status: 'Reconciled' | 'Verified' | 'Discrepancy' | 'Subcontract NOC Missing';
  notes: string;
  sourceDocPage: number;
}

export interface TriangulatedCredentialItem {
  id: string;
  workOrderNo: string;
  clientName: string;
  clientType: 'PSU_DIRECT' | 'SUBCONTRACT';
  scopeSummary: string;
  awardDate: string;
  completionDate: string;
  claimedCompletionValueLacs: number;
  bankCreditedAmountLacs: number;
  bankStatementAccountNo: string;
  bankTxnDetails: string;
  form26AsDeductorTan: string;
  form26AsDeductorName: string;
  form26AsAmountLacs: number;
  form26AsTdsDeductedLacs: number;
  gstr3bTaxableTurnoverLacs: number;
  subcontractEndClientApproval: boolean;
  reconciliationStatus: 'MATCHED' | 'PARTIAL_MATCH' | 'FLAGGED_DISCREPANCY';
  discrepancyNotes: string;
}

export interface HackathonGate {
  gateNumber: number;
  gateName: string;
  description: string;
  status: 'Cleared' | 'Ready to Pitch';
  metrics: { label: string; value: string; detail?: string }[];
  keyPoints: string[];
}

/**
 * Helper to determine if the NIT is for a One-Time Job (versus an Annual Rate Contract / ARC)
 * Rule: If NIT is for a One-Time job, the annualized WO value criteria is NOT invoked and kept as 'NA'.
 */
export function isOneTimeJobTender(
  typeOfJob?: string,
  arcAnnualizationAllowed?: boolean
): boolean {
  if (arcAnnualizationAllowed === false) return true;
  if (!typeOfJob || typeof typeOfJob !== 'string') return false;
  const lower = typeOfJob.toLowerCase().trim();
  if (
    lower.startsWith('one time') ||
    lower.startsWith('one-time') ||
    lower === 'one time' ||
    lower === 'one-time' ||
    lower.includes('one time job') ||
    lower.includes('one-time job') ||
    lower.includes('one time / project') ||
    lower.includes('one-time / project') ||
    lower.includes('project job') ||
    lower.includes('shutdown') ||
    lower.includes('turnaround')
  ) {
    if (lower.includes('arc job') && arcAnnualizationAllowed === true) {
      return false;
    }
    return true;
  }
  return false;
}


export interface TenderSession {
  id: string;
  ref: string;
  title: string;
  clientOrg: string;
  lastModified: string;
  biddersCount?: number;
}
