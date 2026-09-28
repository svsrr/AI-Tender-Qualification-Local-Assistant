import { FinancialTriangulationRecord, TriangulatedCredentialItem } from '../types';

export interface IoclWorkOrderEntry {
  id: string;
  subIndex?: string;
  woNumberAndDate: string;
  issuingOrg: string;
  jobName: string;
  meetsSimilarNature: 'Yes' | 'No';
  compCertSubmitted: 'Yes' | 'No';
  isSubcontract: 'Yes' | 'No';
  ownerApprovalSubmitted: 'Yes' | 'No' | 'NA';
  startDate: string;
  compDate: string;
  durationMonths: string;
  woValueLacs: number | null;
  woValueNote?: string;
  compValueLacs: number | null;
  compValueNote?: string;
  annualisedValueLacs: number | null;
  nilDeviationSheet: 'Yes' | 'No' | 'Query to be raised';
  woStatus: 'WO Accepted(1 WO)' | 'WO Rejected' | 'Query to be raised';
  remarks: string;
  rawPdfDocName?: string;
  rawPdfSnippet?: {
    pageNumber: number;
    quoteText: string;
    fieldMatch: string;
  };
}

export interface IoclBidderEvaluation {
  slNo: number;
  id: string;
  bidderName: string;
  cityState: string;
  workOrders: IoclWorkOrderEntry[];
  finalPosition: 'Technically Acceptable' | 'Technically Rejected' | 'Query to be raised';
  pageNumber: number;
  gstin?: string;
  contactPerson?: string;
  rawPdfsCount?: number;
}

export interface IoclTenderMetadata {
  tenderNo: string;
  jobName: string;
  typeOfJob: string;
  similarNatureDefinition: string;
  valueOption1Job: string;
  valueOption2Jobs: string;
  valueOption3Jobs: string;
  additionalPqc: string;
  trDate: string;
  dateOfBidOpening: string;
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
}

export const IOCL_TENDER_9070C26C53_METADATA: IoclTenderMetadata = {
  tenderNo: '',
  jobName: '',
  typeOfJob: '',
  similarNatureDefinition: '',
  valueOption1Job: '',
  valueOption2Jobs: '',
  valueOption3Jobs: '',
  additionalPqc: '',
  trDate: '',
  dateOfBidOpening: '',
  totalBids: 0,
  totalBidsText: '',
  technicallyAcceptable: 0,
  technicallyNotAcceptable: 0,
  queryToBeRaisedTo: 0,
  signatories: {
    approvingAuthority: { name: '', title: '', designation: '' },
    nextSuperiorOfficer: { name: '', title: '', designation: '' },
    superiorOfficer: { name: '', title: '', designation: '' },
    initiator: { name: '', title: '', designation: '' },
  },
};

export const IOCL_TENDER_METADATA: IoclTenderMetadata = IOCL_TENDER_9070C26C53_METADATA;

export const IOCL_TENDER_9070C26C53_BIDDERS: IoclBidderEvaluation[] = [];

export const IOCL_BIDDERS_DATA: IoclBidderEvaluation[] = [];

export interface TriangulationSummary {
  bidderName: string;
  pan: string;
  gstin: string;
  bankAccount: string;
  caUdin: string;
  financialYear: string;
  auditedTurnoverLacs: number;
  gstReportedTurnoverLacs: number;
  tdsReconciledTurnoverLacs: number;
  bankCreditsReconciledLacs: number;
  totalSubcontractValueLacs: number;
  subcontractWithoutClientNocLacs: number;
  overallReconciliationScore: number;
  records: FinancialTriangulationRecord[];
}

export const BALIMEEN_TRIANGULATION_DATA: TriangulationSummary = {
  bidderName: '',
  pan: '',
  gstin: '',
  bankAccount: '',
  caUdin: '',
  financialYear: '',
  auditedTurnoverLacs: 0,
  gstReportedTurnoverLacs: 0,
  tdsReconciledTurnoverLacs: 0,
  bankCreditsReconciledLacs: 0,
  totalSubcontractValueLacs: 0,
  subcontractWithoutClientNocLacs: 0,
  overallReconciliationScore: 0,
  records: [],
};

export const BALIMEEN_CREDENTIAL_RECORDS: TriangulatedCredentialItem[] = [];
