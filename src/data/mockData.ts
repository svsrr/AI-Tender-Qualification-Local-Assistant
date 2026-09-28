import {
  Bidder,
  DocumentItem,
  ComparisonPair,
  ValidationRule,
  TenderEligibilityCriteria,
  AuditLogEntry,
  TechnicalQuery,
} from '../types';

export const INITIAL_CRITERIA: TenderEligibilityCriteria = {
  tenderTitle: '',
  tenderRef: '',
  clientOrg: '',
  location: '',
  estimatedCostCr: 0,
  closingDate: '',
  minWorkExperienceYears: 7,
  optionASingleWorkPercent: 80,
  optionASingleWorkCr: 0,
  optionBTwoWorksPercent: 50,
  optionBTwoWorksCr: 0,
  optionCThreeWorksPercent: 40,
  optionCThreeWorksCr: 0,
  recencyYears: 7,
  similarWorkDefinition: '',
  requiredScopeKeywords: [],
  arcAnnualizationAllowed: true,
  subcontractAllowedWithApproval: true,
  maxSubcontractPercent: 25,
  minAnnualTurnoverPercent: 30,
  minAnnualTurnoverCr: 0,
  positiveNetWorthRequired: true,
  mandatoryDocuments: [],
  minSingleContractValueCr: 0,
  relevantIndustry: '',
  similarWorkRequirement: '',
  completionWithinLastNYears: 7,
  minCompletedProjects: 1,
  provisionMethod: 'upload-nit',
  uploadedNitDocName: '',
  additionalPqc: '',
  commercialPqc: '',
  specialClauses: '',
  subcontractRequirements: '',
  completionCriteria: '',
  requireCompletionCertificate: true,
  arcAnnualizationRequirements: '',
};

export const INITIAL_QUERIES: TechnicalQuery[] = [];
export const INITIAL_BIDDERS: Bidder[] = [];
export const INITIAL_DOCUMENTS: DocumentItem[] = [];
export const INITIAL_COMPARISONS: ComparisonPair[] = [];
export const INITIAL_RULES: ValidationRule[] = [];
export const INITIAL_AUDIT_LOGS: AuditLogEntry[] = [];
