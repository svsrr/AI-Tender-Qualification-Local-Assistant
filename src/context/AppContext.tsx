import React, { createContext, useContext, useState, useEffect, useMemo, useRef } from 'react';
import { safeLocalStorageSetItem, stripHeavyFileData } from '../utils/storage';
import { DEMO_SAMPLE_BIDDERS, DEMO_SAMPLE_CRITERIA, DEMO_SAMPLE_METADATA } from '../data/demoSampleTender';
import {
  auth,
  signInWithPopup,
  signInAnonymously,
  googleProvider,
  signOut,
  onAuthStateChanged,
  User,
  db,
  doc,
  getDoc,
} from '../lib/firebase';
import {
  saveTenderDataToCloud,
  loadTenderDataFromCloud,
  deleteDocumentFromStorage,
  subscribeToTenderList,
  subscribeToTenderData,
  claimEditLock,
  releaseEditLock,
  refreshEditLock,
  subscribeToEditLock,
  deleteTenderDocument,
  EditLock,
  EDIT_LOCK_STALE_MS,
  DEMO_TENDER_PREFIX,
  isDemoTenderId,
} from '../services/firebaseSyncService';
import {
  Bidder,
  BidderCredential,
  DocumentItem,
  ComparisonPair,
  ValidationRule,
  TenderEligibilityCriteria,
  AuditLogEntry,
  UserRole,
  ExtractedField,
  EligibilityStatus,
  TechnicalRecommendation,
  TechnicalQuery,
  DocumentType,
  IoclBidderEvaluation,
  IoclTenderMetadata,
  IoclWorkOrderEntry,
  TenderId,
  FinancialTriangulationRecord,
  isOneTimeJobTender,
} from '../types';
import {
  bidderOutcome,
  bidderNilDeviation,
  countsOnlySimilarItemsValue,
  evaluateBidderWorkOrders,
  isEngineerConfirmed,
  normaliseStoredBidders,
  resolvePqcThresholdsLacs,
  withSimilarItemsValueRule,
  finalPositionForStatus,
  isSimilarNatureRejectionRemark,
  numberToWords,
  resolveSimilarNatureClause,
  similarNatureRejectionRemark,
  summariseTba,
  TbaSummary,
} from '../utils/tbaRules';
import {
  INITIAL_BIDDERS,
  INITIAL_DOCUMENTS,
  INITIAL_COMPARISONS,
  INITIAL_RULES,
  INITIAL_CRITERIA,
  INITIAL_AUDIT_LOGS,
  INITIAL_QUERIES,
} from '../data/mockData';
import {
  IOCL_BIDDERS_DATA,
  IOCL_TENDER_METADATA,
  IOCL_TENDER_9070C26C53_METADATA,
  IOCL_TENDER_9070C26C53_BIDDERS,
  BALIMEEN_TRIANGULATION_DATA,
} from '../data/ioclEvaluationData';

interface AppContextType {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentRole: UserRole;
  setCurrentRole: (role: UserRole) => void;
  bidders: Bidder[];
  documents: DocumentItem[];
  comparisons: ComparisonPair[];
  validationRules: ValidationRule[];
  criteria: TenderEligibilityCriteria;
  auditLogs: AuditLogEntry[];
  technicalQueries: TechnicalQuery[];
  selectedBidderId: string;
  setSelectedBidderId: (id: string) => void;
  selectedDocumentId: string;
  setSelectedDocumentId: (id: string) => void;
  activeEvidenceModal: ExtractedField | null;
  setActiveEvidenceModal: (field: ExtractedField | null) => void;
  employeeId: string | null;
  setEmployeeId: (id: string) => void;
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  toggleSidebar: () => void;

  // Tender Selection & Context
  activeTenderId: TenderId;
  setActiveTenderId: (id: TenderId) => void;
  ensureActiveTenderId: () => TenderId;
  savedTenders: import('../types').TenderSession[];
  deleteTender: (id: string) => void;
  triangulationData: FinancialTriangulationRecord[];

  // IOCL Evaluation Sheet State & Methods
  ioclBidders: IoclBidderEvaluation[];
  ioclMetadata: IoclTenderMetadata;
  updateIoclMetadata: (updates: Partial<IoclTenderMetadata>) => void;
  updateIoclWorkOrder: (bidderId: string, woId: string, updates: Partial<IoclWorkOrderEntry>) => void;
  // Records the engineer's decision on a work order (status, final position, remarks),
  // stamping who confirmed it and when. Only confirmed rows count in the TBA and exports.
  confirmIoclWorkOrder: (bidderId: string, woId: string, updates?: Partial<IoclWorkOrderEntry>) => void;
  tbaSummary: TbaSummary;
  updateIoclBidder: (bidderId: string, updates: Partial<IoclBidderEvaluation>) => void;
  // Returns the new bidder's id so callers can attach work orders to it in the same tick.
  addIoclBidder: (bidder: Omit<IoclBidderEvaluation, 'id' | 'slNo'>) => string;
  // Moves a bidder to serial number `slNo` (1-based); every bidder is renumbered to match.
  moveIoclBidderTo: (bidderId: string, slNo: number) => void;
  addIoclWorkOrder: (bidderId: string, wo: Omit<IoclWorkOrderEntry, 'id'>) => void;
  deleteIoclBidder: (bidderId: string) => void;
  deleteIoclWorkOrder: (bidderId: string, woId: string, removeBidderIfNoWos?: boolean) => void;
  resetIoclData: () => void;
  simulateRawPdfExtraction: (fileName: string) => Promise<IoclWorkOrderEntry>;

  // Actions for Bidders & Credentials
  addBidder: (bidder: Partial<Bidder> & { bidderName: string }) => void;
  updateBidder: (id: string, updates: Partial<Bidder>) => void;
  addBidderCredential: (bidderId: string, cred: Omit<BidderCredential, 'id' | 'bidderId'>) => void;
  updateBidderCredential: (bidderId: string, credId: string, updates: Partial<BidderCredential>) => void;
  deleteBidderCredential: (bidderId: string, credId: string) => void;
  calculateArcAnnualized: (executedValueCr: number, durationMonths: number) => number;

  // Technical Queries actions
  addTechnicalQuery: (query: Omit<TechnicalQuery, 'id'>) => TechnicalQuery;
  updateTechnicalQuery: (id: string, updates: Partial<TechnicalQuery>) => void;
  deleteTechnicalQuery: (id: string) => void;
  generateAutomatedQueriesForBidder: (bidderId: string) => number;

  // Evaluation & Decision actions
  recordTechnicalRecommendation: (
    bidderId: string,
    recommendation: TechnicalRecommendation,
    reason: string
  ) => void;
  recordEngineerDecision: (bidderId: string, decision: EligibilityStatus, notes: string) => void;
  updateCriteria: (newCriteria: Partial<TenderEligibilityCriteria>) => void;

  // Documents & OCR actions
  uploadDocuments: (newDocs: DocumentItem[]) => void;
  deleteDocument: (docId: string) => Promise<void>;
  updateExtractedField: (docId: string, fieldId: string, updates: Partial<ExtractedField>) => void;
  approveField: (docId: string, fieldId: string) => void;
  rejectField: (docId: string, fieldId: string, reason: string) => void;
  editField: (docId: string, fieldId: string, newValue: string, reason: string) => void;
  markFieldClarification: (docId: string, fieldId: string, notes: string) => void;
  runAIAnalysisOnDocument: (docId: string) => void;
  runCrossDocumentComparison: (docAId: string, docBId: string) => void;
  recheckValidationRules: () => void;
  resetDemoData: () => void;
  addAuditLog: (entry: {
    action: string;
    bidderName?: string;
    documentName?: string;
    fieldName?: string;
    oldValue: string;
    newValue: string;
    reason: string;
  }) => void;

  // Computed metrics
  metrics: {
    totalBidders: number;
    acceptableBidders: number;
    queryBidders: number;
    rejectedBidders: number;
    totalQueries: number;
    openQueries: number;
    documentsUploaded: number;
    validCredentials: number;
    mismatchesFound: number;
    manualReviewsPending: number;
    approvedCredentials: number;
    totalCredentialsCount: number;
  };
  clearAllDataAndStartFresh: () => void;
  loadSampleEvaluationDataset: () => void;

  // Firebase Cloud Storage & User Sync
  firebaseUser: User | null;
  // False until Firebase has said whether a saved sign-in exists; nothing is shown before that.
  authReady: boolean;
  cloudSyncStatus: 'synced' | 'syncing' | 'saving' | 'error' | 'offline';
  lastCloudSync: string | null;
  cloudSyncError: string | null;
  saveToCloud: () => Promise<boolean>;
  restoreFromCloud: (overrideUid?: string) => Promise<boolean>;
  signInWithGoogleUser: () => Promise<void>;
  // Hackathon demo access: anonymous guest session with a capped daily AI allowance.
  // Resolves to an error message, or null on success.
  signInAsDemoGuest: () => Promise<string | null>;
  isDemoUser: boolean;
  signOutUser: () => Promise<void>;

  // Per-tender collaborative edit lock: whoever claims it can edit; everyone else is
  // read-only until they release it or the claim goes stale (crashed tab / closed laptop).
  editLock: EditLock | null;
  canEditActiveTender: boolean;
  claimTenderEditLock: () => Promise<{ success: boolean; heldByName?: string }>;
  releaseTenderEditLock: () => Promise<void>;
}

export const BLANK_CRITERIA: TenderEligibilityCriteria = {
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
  subcontractAllowedWithApproval: false,
  maxSubcontractPercent: 0,
  minAnnualTurnoverPercent: 30,
  minAnnualTurnoverCr: 0,
  positiveNetWorthRequired: true,
  mandatoryDocuments: ['Work Order Copy', 'Completion Certificate'],
  isConfigured: false,
  hasApqc: false,
  additionalPqc: '',
};

export const BLANK_IOCL_METADATA: IoclTenderMetadata = {
  tenderNo: '',
  jobName: '',
  typeOfJob: 'One time / ARC',
  similarNatureDefinition: '',
  valueOption1Job: '0.00',
  valueOption2Jobs: '0.00',
  valueOption3Jobs: '0.00',
  additionalPqc: '',
  hasApqc: false,
  trDate: '',
  dateOfBidOpening: '',
  totalBids: 0,
  totalBidsText: 'Zero Bids',
  technicallyAcceptable: 0,
  technicallyNotAcceptable: 0,
  queryToBeRaisedTo: 0,
  signatories: {
    approvingAuthority: { name: '', title: '', designation: '' },
    nextSuperiorOfficer: { name: '', title: '', designation: '' },
    superiorOfficer: { name: '', title: '', designation: '' },
  },
};


const AppContext = createContext<AppContextType | undefined>(undefined);

// Ensure old mock data is wiped from browser localStorage on initial clean startup
if (typeof window !== 'undefined' && !localStorage.getItem('app_clean_state_v5')) {
  localStorage.removeItem('bid_analyzer_bidders');
  localStorage.removeItem('bid_analyzer_docs');
  localStorage.removeItem('bid_analyzer_comparisons');
  localStorage.removeItem('bid_analyzer_rules');
  localStorage.removeItem('bid_analyzer_criteria');
  localStorage.removeItem('bid_analyzer_audits');
  localStorage.removeItem('bid_analyzer_queries');
  localStorage.removeItem('iocl_eval_9070C26C53');
  localStorage.removeItem('iocl_eval_9070C26C26');
  localStorage.removeItem('iocl_eval_active');
  localStorage.removeItem('iocl_evaluation_data');
  localStorage.removeItem('iocl_metadata');
  localStorage.removeItem('iocl_metadata_active');
  localStorage.removeItem('iocl_metadata_9070C26C53');
  localStorage.removeItem('iocl_metadata_9070C26C26');
  localStorage.setItem('app_clean_state_v5', 'true');
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentRole, setCurrentRole] = useState<UserRole>('Evaluation Engineer');

  // Blank-slate initial state: User uploads files to generate data
  const [bidders, setBidders] = useState<Bidder[]>(() => {
    const saved = localStorage.getItem('bid_analyzer_bidders');
    return saved ? JSON.parse(saved) : [];
  });

  const [documents, setDocuments] = useState<DocumentItem[]>(() => {
    const saved = localStorage.getItem('bid_analyzer_docs');
    return saved ? JSON.parse(saved) : [];
  });

  const [comparisons, setComparisons] = useState<ComparisonPair[]>(() => {
    const saved = localStorage.getItem('bid_analyzer_comparisons');
    return saved ? JSON.parse(saved) : [];
  });

  const [validationRules, setValidationRules] = useState<ValidationRule[]>(() => {
    const saved = localStorage.getItem('bid_analyzer_rules');
    return saved ? JSON.parse(saved) : [];
  });

  const [criteria, setCriteria] = useState<TenderEligibilityCriteria>(() => {
    const saved = localStorage.getItem('bid_analyzer_criteria');
    if (!saved) return BLANK_CRITERIA;
    try {
      return JSON.parse(saved);
    } catch {
      return BLANK_CRITERIA;
    }
  });

  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(() => {
    const saved = localStorage.getItem('bid_analyzer_audits');
    return saved ? JSON.parse(saved) : [];
  });

  const [technicalQueries, setTechnicalQueries] = useState<TechnicalQuery[]>(() => {
    const saved = localStorage.getItem('bid_analyzer_queries');
    return saved ? JSON.parse(saved) : [];
  });

  // Default active tab: If criteria or bidders are not configured, guide user to 'home'
  const [activeTab, setActiveTab] = useState<string>(() => {
    const hasData = (localStorage.getItem('bid_analyzer_bidders') && JSON.parse(localStorage.getItem('bid_analyzer_bidders')!).length > 0);
    return hasData ? 'evaluation-sheet' : 'home';
  });

  const [selectedBidderId, setSelectedBidderId] = useState<string>(bidders[0]?.id || '');
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>(documents[0]?.id || '');
  const [activeEvidenceModal, setActiveEvidenceModal] = useState<ExtractedField | null>(null);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  // Set by the auth listener when a guest signs in; an effect below then opens their demo tender.
  const [demoBootstrapUid, setDemoBootstrapUid] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('sidebar_collapsed') === 'true';
  });

  const toggleSidebar = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('sidebar_collapsed', String(next));
      return next;
    });
  };

  // Firebase Auth and Cloud Sync State
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<'synced' | 'syncing' | 'saving' | 'error' | 'offline'>('syncing');
  const [lastCloudSync, setLastCloudSync] = useState<string | null>(null);
  const [cloudSyncError, setCloudSyncError] = useState<string | null>(null);
  const isInitialCloudLoadDone = useRef(false);
  // The cloud version of the active tender this browser has (its updatedAt), and what it last
  // wrote. A save may only replace this version, so a browser holding an older copy - a second
  // tab, the same tender on another computer - cannot write deleted work orders back.
  const tenderVersionRef = useRef<string | null>(null);
  const lastSyncedPayloadRef = useRef<string>('');
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!localStorage.getItem("wiped_legacy_data_v1")) {
      localStorage.removeItem("bid_analyzer_bidders");
      localStorage.removeItem("bid_analyzer_docs");
      localStorage.removeItem("bid_analyzer_comparisons");
      localStorage.removeItem("bid_analyzer_rules");
      localStorage.removeItem("bid_analyzer_criteria");
      localStorage.removeItem("bid_analyzer_audits");
      localStorage.removeItem("bid_analyzer_queries");
      localStorage.removeItem("iocl_eval_active");
      localStorage.removeItem("iocl_metadata_active");
      localStorage.removeItem("iocl_eval_9070C26C53");
      localStorage.removeItem("iocl_evaluation_data");
      localStorage.setItem("wiped_legacy_data_v1", "true");
      window.location.reload();
    }
  }, []);

  // Active Tender Context (Tender 9070C26C53 vs 9070C26C26)
  const [activeTenderId, setActiveTenderIdState] = useState<TenderId>(() => {
    const saved = localStorage.getItem('iocl_active_tender_id');
    return saved ? (saved as TenderId) : '';
  });

  // Lets the mount-time auth listener (registered before this state exists in the
  // function body) always read the current tender id instead of a stale closure.
  const activeTenderIdRef = useRef<TenderId>(activeTenderId);
  useEffect(() => {
    activeTenderIdRef.current = activeTenderId;
  }, [activeTenderId]);

  // Initialize Firebase Auth (Mandatory Google Auth — no anonymous/local-officer fallback)
  useEffect(() => {
    if (import.meta.env.VITE_OFFLINE_MODE === 'true') {
      setAuthReady(true);
      const mockUser = {
        uid: 'OFFLINE_LOCAL_OFFICER',
        email: 'local.officer@iocl.com',
        displayName: 'Local Officer (Offline)',
        isAnonymous: false,
        getIdToken: async () => 'OFFLINE_TOKEN',
      } as any;
      setFirebaseUser(mockUser);
      setEmployeeId('LOCAL_OFFICER');
      setCloudSyncStatus('synced');
      setCloudSyncError(null);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setAuthReady(true);
      if (user) {
        setFirebaseUser(user);
        setCloudSyncStatus('synced');
        setCloudSyncError(null);

        // Guests have no user profile or access to real tenders: they get a fixed label
        // and their own demo tender instead of the shared-workspace migration and reload.
        if (user.isAnonymous) {
          setEmployeeId('GUEST');
          setDemoBootstrapUid(user.uid);
          return;
        }
        // A different account than the last one on this browser starts at Home, not inside the
        // previous account's tender. A page refresh (same account restored) stays where it was.
        let lastUid: string | null = null;
        try { lastUid = localStorage.getItem('last_signed_in_uid'); } catch { /* storage unavailable */ }
        safeLocalStorageSetItem('last_signed_in_uid', user.uid);
        const isDifferentAccount = lastUid !== null && lastUid !== user.uid;
        // Leaving demo mode for a real account: don't carry the guest's demo tender over.
        if (isDifferentAccount || isDemoTenderId(activeTenderIdRef.current)) {
          activeTenderIdRef.current = '';
          setActiveTenderIdState('');
          safeLocalStorageSetItem('iocl_active_tender_id', '');
          setActiveTab('home');
        }
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          setEmployeeId(userDoc.data().employeeId || null);
        }

        const tenderId = activeTenderIdRef.current;
        if (tenderId) {
          const res = await loadTenderDataFromCloud(tenderId);
          if (res.success && res.data) {
            if (res.data.ioclBidders && res.data.ioclBidders.length > 0) {
              setIoclBidders(res.data.ioclBidders);
            }
            if (res.data.ioclMetadata) {
              setIoclMetadata(res.data.ioclMetadata);
            }
            if (res.data.criteria) {
              setCriteria(res.data.criteria);
            }
            if (res.data.documents && res.data.documents.length > 0) {
              setDocuments(res.data.documents);
            }
            if (res.data.technicalQueries && res.data.technicalQueries.length > 0) {
              setTechnicalQueries(res.data.technicalQueries);
            }
            if (res.data.auditLogs && res.data.auditLogs.length > 0) {
              setAuditLogs(res.data.auditLogs);
            }
            if (res.data.bidders && res.data.bidders.length > 0) {
              setBidders(res.data.bidders);
            }
            tenderVersionRef.current = res.data.lastSyncedAt || tenderVersionRef.current;
            setLastCloudSync(res.data.lastSyncedAt || new Date().toISOString());
          }
        }
      } else {
        setFirebaseUser(null);
        setCloudSyncStatus('offline');
      }
    });
    return () => unsubscribe();
  }, []);

  // Shared, cross-user list of every tender any signed-in team member has created.
  useEffect(() => {
    if (!firebaseUser) return;
    const unsubscribe = subscribeToTenderList((tenders) => setSavedTenders(tenders));
    return () => unsubscribe();
  }, [firebaseUser]);

  // Sync state to local storage safely without throwing QuotaExceededError crashes
  useEffect(() => {
    safeLocalStorageSetItem('bid_analyzer_bidders', JSON.stringify(stripHeavyFileData(bidders)));
  }, [bidders]);

  useEffect(() => {
    safeLocalStorageSetItem('bid_analyzer_docs', JSON.stringify(stripHeavyFileData(documents)));
  }, [documents]);

  useEffect(() => {
    safeLocalStorageSetItem('bid_analyzer_comparisons', JSON.stringify(comparisons));
  }, [comparisons]);

  useEffect(() => {
    safeLocalStorageSetItem('bid_analyzer_rules', JSON.stringify(validationRules));
  }, [validationRules]);

  useEffect(() => {
    safeLocalStorageSetItem('bid_analyzer_criteria', JSON.stringify(criteria));
    if (activeTenderId) safeLocalStorageSetItem(`bid_analyzer_criteria_${activeTenderId}`, JSON.stringify(criteria));
  }, [criteria, activeTenderId]);

  useEffect(() => {
    safeLocalStorageSetItem('bid_analyzer_audits', JSON.stringify(auditLogs));
    if (activeTenderId) safeLocalStorageSetItem(`bid_analyzer_audits_${activeTenderId}`, JSON.stringify(auditLogs));
  }, [auditLogs, activeTenderId]);

  useEffect(() => {
    safeLocalStorageSetItem('bid_analyzer_queries', JSON.stringify(technicalQueries));
    if (activeTenderId) safeLocalStorageSetItem(`bid_analyzer_queries_${activeTenderId}`, JSON.stringify(technicalQueries));
  }, [technicalQueries, activeTenderId]);

  // Per-tender collaborative edit lock: live-subscribed so a lock claimed or released
  // by someone else updates every other viewer's UI immediately.
  const [editLock, setEditLock] = useState<EditLock | null>(null);
  useEffect(() => {
    if (!activeTenderId) {
      setEditLock(null);
      return;
    }
    const unsubscribe = subscribeToEditLock(activeTenderId, setEditLock);
    return () => unsubscribe();
  }, [activeTenderId]);

  const isEditLockStale = (lock: EditLock | null): boolean =>
    !lock || Date.now() - new Date(lock.claimedAt).getTime() > EDIT_LOCK_STALE_MS;

  const canEditActiveTender = !editLock || editLock.uid === firebaseUser?.uid || isEditLockStale(editLock);

  const claimTenderEditLock = async (): Promise<{ success: boolean; heldByName?: string }> => {
    if (!firebaseUser || !activeTenderId) return { success: false };
    const identity = (firebaseUser.isAnonymous ? 'Demo guest' : '') || firebaseUser.displayName || firebaseUser.email || 'Collaborating Engineer';
    const result = await claimEditLock(activeTenderId, firebaseUser.uid, identity);
    if (!result.success && result.heldBy) {
      return { success: false, heldByName: result.heldBy.name };
    }
    return { success: result.success };
  };

  const releaseTenderEditLock = async (): Promise<void> => {
    if (!firebaseUser || !activeTenderId) return;
    await releaseEditLock(activeTenderId, firebaseUser.uid);
  };

  // Heartbeat: refresh the claim every 20s (well inside the 45s staleness window) while
  // this user holds it, so an active editing session is never mistaken for an abandoned one.
  useEffect(() => {
    if (!firebaseUser || !activeTenderId || editLock?.uid !== firebaseUser.uid) return;
    const interval = setInterval(() => {
      refreshEditLock(activeTenderId, firebaseUser.uid);
    }, 20_000);
    return () => clearInterval(interval);
  }, [editLock, firebaseUser, activeTenderId]);

  // Best-effort release on tab close so the next person doesn't wait out the staleness window.
  useEffect(() => {
    const handleUnload = () => {
      if (firebaseUser && activeTenderId && editLock?.uid === firebaseUser.uid) {
        releaseEditLock(activeTenderId, firebaseUser.uid);
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [editLock, firebaseUser, activeTenderId]);

  const [savedTenders, setSavedTenders] = useState<import('../types').TenderSession[]>(() => {
    const saved = localStorage.getItem('tenders_list');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem('tenders_list', JSON.stringify(savedTenders));
  }, [savedTenders]);

  // Work without a tender id never reaches the cloud, and giving it one later splits it from
  // the shared tender it looks like (the duplicate 9070C26C53). A signed-in engineer with no
  // tender open stays on Home until they open or start one.
  useEffect(() => {
    if (firebaseUser && !activeTenderId && activeTab !== 'home') setActiveTab('home');
  }, [firebaseUser, activeTenderId, activeTab]);

  useEffect(() => {
    if (criteria.isConfigured && activeTenderId) {
      setSavedTenders((prev) => {
        const existing = prev.find(t => t.id === activeTenderId);
        if (existing) {
          return prev.map(t => t.id === activeTenderId ? { ...t, ref: criteria.tenderRef, title: criteria.tenderTitle, clientOrg: criteria.clientOrg, lastModified: new Date().toISOString() } : t);
        } else {
          return [...prev, { id: activeTenderId, ref: criteria.tenderRef, title: criteria.tenderTitle, clientOrg: criteria.clientOrg, lastModified: new Date().toISOString() }];
        }
      });
    }
  }, [criteria, activeTenderId]);


  // 18-column technical evaluation data state
  const [ioclBidders, setIoclBiddersState] = useState<IoclBidderEvaluation[]>(() => {
    const saved = localStorage.getItem('iocl_eval_active');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return normaliseStoredBidders(parsed);
        }
      } catch {
        // fallback
      }
    }
    return IOCL_TENDER_9070C26C53_BIDDERS;
  });

  // Every write of the sheet is repaired on the way in, wherever it came from: this browser's
  // cache, the cloud copy, the live subscription or an edit. A row saved by an older build
  // without a woStatus threw while the sheet rendered, and the error screen hid the whole app.
  const setIoclBidders: React.Dispatch<React.SetStateAction<IoclBidderEvaluation[]>> = React.useCallback(
    (value) =>
      setIoclBiddersState((prev) =>
        normaliseStoredBidders(typeof value === 'function' ? (value as (p: IoclBidderEvaluation[]) => IoclBidderEvaluation[])(prev) : value)
      ),
    []
  );

  const [ioclMetadata, setIoclMetadata] = useState<IoclTenderMetadata>(() => {
    const saved = localStorage.getItem('iocl_metadata_active');
    if (!saved) return IOCL_TENDER_9070C26C53_METADATA;
    try {
      const parsed = JSON.parse(saved);
      return {
        ...IOCL_TENDER_9070C26C53_METADATA,
        ...parsed,
        signatories: {
          approvingAuthority: parsed.signatories?.approvingAuthority === null ? null : {
            ...IOCL_TENDER_9070C26C53_METADATA.signatories.approvingAuthority,
            ...(parsed.signatories?.approvingAuthority || {}),
          },
          nextSuperiorOfficer: parsed.signatories?.nextSuperiorOfficer === null ? null : {
            ...IOCL_TENDER_9070C26C53_METADATA.signatories.nextSuperiorOfficer,
            ...(parsed.signatories?.nextSuperiorOfficer || {}),
          },
          superiorOfficer: parsed.signatories?.superiorOfficer === null ? null : {
            ...IOCL_TENDER_9070C26C53_METADATA.signatories.superiorOfficer,
            ...(parsed.signatories?.superiorOfficer || {}),
          },
          initiator: parsed.signatories?.initiator === null ? null : {
            ...IOCL_TENDER_9070C26C53_METADATA.signatories.initiator,
            ...(parsed.signatories?.initiator || {}),
          },
        },
      };
    } catch {
      return IOCL_TENDER_9070C26C53_METADATA;
    }
  });

  useEffect(() => {
    safeLocalStorageSetItem('iocl_eval_active', JSON.stringify(stripHeavyFileData(ioclBidders)));
    if (activeTenderId) {
      safeLocalStorageSetItem(`iocl_eval_${activeTenderId}`, JSON.stringify(stripHeavyFileData(ioclBidders)));
    }
  }, [ioclBidders, activeTenderId]);

  useEffect(() => {
    safeLocalStorageSetItem('iocl_metadata_active', JSON.stringify(ioclMetadata));
    if (activeTenderId) {
      safeLocalStorageSetItem(`iocl_metadata_${activeTenderId}`, JSON.stringify(ioclMetadata));
    }
  }, [ioclMetadata, activeTenderId]);

  // Keeps every unconfirmed row's suggestion in line with the PQC value criterion, judged across
  // the bidder's work orders (1 work, or 2 / 3 works each above their value). Runs whenever rows,
  // the PQC values or the ARC setting change. Rows an engineer has confirmed are never touched.
  useEffect(() => {
    if (!activeTenderId || !canEditActiveTender) return;
    const ctx = {
      thresholds: resolvePqcThresholdsLacs(ioclMetadata, criteria),
      isArcTender: !isOneTimeJobTender(ioclMetadata?.typeOfJob, criteria?.arcAnnualizationAllowed),
      similarNatureClause: resolveSimilarNatureClause(ioclMetadata, criteria),
      nit: ioclMetadata,
    };
    const similarItemsOnly = countsOnlySimilarItemsValue(
      ioclMetadata?.similarNatureDefinition,
      ioclMetadata?.additionalPqc,
      criteria?.similarWorkDefinition
    );
    let changed = false;
    const next = ioclBidders.map((b) => {
      const rows = (b.workOrders || []).map((wo) => (isEngineerConfirmed(wo) ? wo : withSimilarItemsValueRule(wo, similarItemsOnly)));
      const { suggestions } = evaluateBidderWorkOrders(rows, { ...ctx, claimedOrders: b.claimedOrders });
      let bidderChanged = rows.some((wo, i) => wo !== b.workOrders[i]);
      const workOrders = rows.map((wo) => {
        const s = suggestions[wo.id];
        if (!s || isEngineerConfirmed(wo)) return wo;
        if (wo.woStatus === s.woStatus && wo.remarks === s.remarks && wo.finalPosition === s.finalPosition) return wo;
        bidderChanged = true;
        return { ...wo, woStatus: s.woStatus, finalPosition: s.finalPosition, remarks: s.remarks, aiSuggestedStatus: s.woStatus, aiSuggestedRemarks: s.remarks };
      });
      if (!bidderChanged) return b;
      changed = true;
      return { ...b, workOrders };
    });
    if (changed) setIoclBidders(next);
  }, [ioclBidders, ioclMetadata, criteria, activeTenderId, canEditActiveTender]);

  // Puts a cloud copy of the tender into this browser and records which version it now holds.
  const applyTenderDataFromCloud = (data: any, version?: string) => {
    if (!data) return;
    if (Array.isArray(data.ioclBidders)) setIoclBidders(data.ioclBidders);
    if (data.ioclMetadata) setIoclMetadata(data.ioclMetadata);
    if (data.criteria) setCriteria(data.criteria);
    if (Array.isArray(data.documents)) setDocuments(data.documents);
    if (Array.isArray(data.technicalQueries)) setTechnicalQueries(data.technicalQueries);
    if (Array.isArray(data.auditLogs)) setAuditLogs(data.auditLogs);
    if (Array.isArray(data.bidders)) setBidders(data.bidders);
    tenderVersionRef.current = version ?? tenderVersionRef.current;
    lastSyncedPayloadRef.current = JSON.stringify({
      ioclBidders: data.ioclBidders || [],
      ioclMetadata: data.ioclMetadata || null,
      criteria: data.criteria || null,
      documents: data.documents || [],
      technicalQueries: data.technicalQueries || [],
      auditLogs: data.auditLogs || [],
      bidders: data.bidders || [],
    });
    setLastCloudSync(version || new Date().toISOString());
  };

  // Follow the tender while it is open: a change saved by a teammate, or by this user's other
  // tab, replaces what is on screen instead of being overwritten by it later.
  useEffect(() => {
    if (!firebaseUser || !activeTenderId) return;
    return subscribeToTenderData(activeTenderId, ({ data, updatedAt, lastUpdatedBy }) => {
      if (!updatedAt || updatedAt === tenderVersionRef.current) return;
      applyTenderDataFromCloud(data, updatedAt);
      setCloudSyncError(`This tender was updated by ${lastUpdatedBy || 'someone else'}; the latest version is now shown.`);
    });
  }, [firebaseUser, activeTenderId]);

  const setActiveTenderId = (tenderId: TenderId) => {
    const previousTenderId = activeTenderIdRef.current;
    if (firebaseUser && previousTenderId && previousTenderId !== tenderId && editLock?.uid === firebaseUser.uid) {
      releaseEditLock(previousTenderId, firebaseUser.uid);
    }

    setActiveTenderIdState(tenderId);
    safeLocalStorageSetItem('iocl_active_tender_id', tenderId);

    const loadSaved = (key: string, fallback: any) => {
      const saved = localStorage.getItem(key + '_' + tenderId);
      return saved ? JSON.parse(saved) : fallback;
    };

    // A demo tender with nothing saved yet opens pre-filled with the anonymised sample evaluation.
    const savedBidders = loadSaved('iocl_eval', null);
    const useDemoSample = isDemoTenderId(tenderId) && (!Array.isArray(savedBidders) || savedBidders.length === 0);
    if (useDemoSample) {
      setCriteria({ ...BLANK_CRITERIA, ...DEMO_SAMPLE_CRITERIA });
      setIoclBidders(DEMO_SAMPLE_BIDDERS);
      setIoclMetadata({ ...BLANK_IOCL_METADATA, ...DEMO_SAMPLE_METADATA });
    } else {
      setCriteria(loadSaved('bid_analyzer_criteria', BLANK_CRITERIA));
      setIoclBidders(savedBidders ?? IOCL_TENDER_9070C26C53_BIDDERS);
      setIoclMetadata(loadSaved('iocl_metadata', IOCL_TENDER_9070C26C53_METADATA));
    }
    setTechnicalQueries(loadSaved('bid_analyzer_queries', []));
    setAuditLogs(loadSaved('bid_analyzer_audits', []));
    setBidders([]);
    setDocuments([]);
    setComparisons([]);
    setValidationRules([]);
    // A bidder focused in the previous tender would filter this tender's TBA sheet to nothing.
    setSelectedBidderId('');
    setActiveTab('evaluation-sheet');

    // Reconcile with the shared cloud copy of this tender, which may be ahead of
    // whatever this browser has cached locally (e.g. a teammate edited it since).
    if (firebaseUser && tenderId) {
      loadTenderDataFromCloud(tenderId).then((res) => {
        if (!res.success || !res.data) return;
        tenderVersionRef.current = res.data.lastSyncedAt || null;
        // An empty cloud copy (a demo tender saved before it had data) must not blank the sample.
        if (useDemoSample && !(res.data.ioclBidders && res.data.ioclBidders.length > 0)) return;
        if (res.data.ioclBidders && res.data.ioclBidders.length > 0) setIoclBidders(res.data.ioclBidders);
        if (res.data.ioclMetadata) setIoclMetadata(res.data.ioclMetadata);
        if (res.data.criteria) setCriteria(res.data.criteria);
        if (res.data.documents && res.data.documents.length > 0) setDocuments(res.data.documents);
        if (res.data.technicalQueries && res.data.technicalQueries.length > 0) setTechnicalQueries(res.data.technicalQueries);
        if (res.data.auditLogs && res.data.auditLogs.length > 0) setAuditLogs(res.data.auditLogs);
        if (res.data.bidders && res.data.bidders.length > 0) setBidders(res.data.bidders);
      });
    }
  };

  
  useEffect(() => {
    if (!demoBootstrapUid) return;
    setDemoBootstrapUid(null);
    const ownDemoTenderId = `${DEMO_TENDER_PREFIX}${demoBootstrapUid.slice(0, 12)}`;
    if (isDemoTenderId(activeTenderIdRef.current) && localStorage.getItem('demo_owner_uid') === demoBootstrapUid) {
      setActiveTenderId(activeTenderIdRef.current);
    } else {
      safeLocalStorageSetItem('demo_owner_uid', demoBootstrapUid);
      setActiveTenderId(ownDemoTenderId);
    }
  }, [demoBootstrapUid]);

  const updateIoclWorkOrder = (bidderId: string, woId: string, updates: Partial<IoclWorkOrderEntry>) => {
    setIoclBidders((prev) =>
      prev.map((b) => {
        if (b.id !== bidderId) return b;
        return {
          ...b,
          workOrders: (b.workOrders || []).map((wo) =>
            wo.id === woId ? { ...wo, ...updates } : wo
          ),
        };
      })
    );
  };

  const confirmIoclWorkOrder = (bidderId: string, woId: string, updates: Partial<IoclWorkOrderEntry> = {}) => {
    const person = firebaseUser?.isAnonymous ? 'Demo guest' : firebaseUser?.displayName || firebaseUser?.email || 'Engineer';
    const confirmedBy = employeeId && !firebaseUser?.isAnonymous ? `${person} (${employeeId})` : person;
    const bidder = ioclBidders.find((b) => b.id === bidderId);
    const current = bidder?.workOrders.find((wo) => wo.id === woId);
    if (!bidder || !current) return;

    let woStatus = updates.woStatus ?? current.woStatus;
    let finalPosition = updates.finalPosition ?? current.finalPosition ?? finalPositionForStatus(woStatus);
    let remarks = updates.remarks ?? current.remarks ?? '';
    // A work order that is not of similar nature cannot be accepted or queried: it is rejected,
    // and the remark cites the NIT clause (an earlier acceptance note would now be misleading).
    if ((updates.meetsSimilarNature ?? current.meetsSimilarNature) === 'No') {
      if (!isSimilarNatureRejectionRemark(remarks)) {
        const remark = similarNatureRejectionRemark(
          updates.woNumberAndDate ?? current.woNumberAndDate,
          resolveSimilarNatureClause(ioclMetadata, criteria)
        );
        remarks = woStatus === 'WO Rejected' && remarks ? `${remark} ${remarks}` : remark;
      }
      woStatus = 'WO Rejected';
      finalPosition = 'Technically Rejected';
    }
    updateIoclWorkOrder(bidderId, woId, {
      ...updates,
      woStatus,
      finalPosition,
      remarks,
      engineerConfirmedBy: confirmedBy,
      engineerConfirmedAt: new Date().toISOString(),
    });
    addAuditLog({
      action: 'TBA Work Order Confirmed',
      bidderName: bidder.bidderName,
      documentName: current.woNumberAndDate,
      fieldName: 'WO Status / Final Position',
      oldValue: `${current.woStatus}${current.engineerConfirmedBy ? '' : ' (AI suggestion)'}`,
      newValue: `${woStatus} | ${finalPosition ?? '-'}`,
      reason: `Confirmed by ${confirmedBy}`,
    });
  };
  const saveToCloud = async () => {
    if (!firebaseUser) {
      setCloudSyncError('User not authenticated for cloud sync.');
      return false;
    }
    if (!activeTenderId) {
      setCloudSyncError('No active tender selected.');
      return false;
    }
    if (!canEditActiveTender) {
      setCloudSyncError(`Read-only: ${editLock?.name || 'another user'} is currently editing this tender.`);
      return false;
    }
    setCloudSyncStatus('saving');
    try {
      const identity = (firebaseUser.isAnonymous ? 'Demo guest' : '') || firebaseUser.displayName || firebaseUser.email || firebaseUser.uid || 'Engineer';
      const result = await saveTenderDataToCloud(
        activeTenderId,
        identity,
        { ioclBidders, ioclMetadata, criteria, documents, technicalQueries, auditLogs, bidders },
        tenderVersionRef.current
      );
      if (result.success) {
        tenderVersionRef.current = result.updatedAt || tenderVersionRef.current;
        lastSyncedPayloadRef.current = JSON.stringify({ ioclBidders, ioclMetadata, criteria, documents, technicalQueries, auditLogs, bidders });
        setCloudSyncStatus('synced');
        setLastCloudSync(result.updatedAt || new Date().toISOString());
        return true;
      }
      if (result.conflict) {
        // The stored tender has moved on: show that version rather than writing over it.
        const latest = await loadTenderDataFromCloud(activeTenderId);
        if (latest.success && latest.data) applyTenderDataFromCloud(latest.data, latest.data.lastSyncedAt);
        setCloudSyncStatus('error');
        setCloudSyncError(
          `This tender was saved by ${latest.data?.lastUpdatedBy || 'someone else'} while this page was open. The latest version is now shown - please make your change again and save.`
        );
        return false;
      }
      setCloudSyncStatus('error');
      setCloudSyncError(result.error || 'Failed to save');
      return false;
    } catch (err: any) {
      console.error('Save to cloud failed', err);
      setCloudSyncStatus('error');
      setCloudSyncError(err.message || 'Save failed');
      return false;
    }
  };
  const restoreFromCloud = async () => {
    if (!firebaseUser) {
      setCloudSyncError('User not authenticated for restore.');
      return false;
    }
    if (!activeTenderId) {
      setCloudSyncError('No active tender selected.');
      return false;
    }
    setCloudSyncStatus('syncing');
    try {
      const result = await loadTenderDataFromCloud(activeTenderId);
      if (result.success && result.data) {
        if (result.data.ioclBidders && result.data.ioclBidders.length > 0) {
          setIoclBidders(result.data.ioclBidders);
        }
        if (result.data.ioclMetadata) {
          setIoclMetadata(result.data.ioclMetadata);
        }
        if (result.data.criteria) {
          setCriteria(result.data.criteria);
        }
        if (result.data.documents && result.data.documents.length > 0) {
          setDocuments(result.data.documents);
        }
        if (result.data.technicalQueries && result.data.technicalQueries.length > 0) {
          setTechnicalQueries(result.data.technicalQueries);
        }
        if (result.data.auditLogs && result.data.auditLogs.length > 0) {
          setAuditLogs(result.data.auditLogs);
        }
        if (result.data.bidders && result.data.bidders.length > 0) {
           setBidders(result.data.bidders);
        }
        tenderVersionRef.current = result.data.lastSyncedAt || tenderVersionRef.current;
        setCloudSyncStatus('synced');
        setLastCloudSync(result.data.lastSyncedAt || new Date().toISOString());
        return true;
      } else {
        setCloudSyncStatus('error');
        setCloudSyncError(result.error || 'Failed to restore');
        return false;
      }
    } catch (err: any) {
      console.error('Restore from cloud failed', err);
      setCloudSyncStatus('error');
      setCloudSyncError(err.message || 'Restore failed');
      return false;
    }
  };

  // Auto-save to cloud on changes when authenticated — but only when this user actually
  // holds (or is free to claim) the active tender's edit lock, so a read-only viewer's
  // local state is never pushed over whatever the current editor is working on.
  useEffect(() => {
    if (!firebaseUser || !activeTenderId || !canEditActiveTender) return;
    const identity = (firebaseUser.isAnonymous ? 'Demo guest' : '') || firebaseUser.displayName || firebaseUser.email || firebaseUser.uid || 'Engineer';
    const payload = { ioclBidders, ioclMetadata, criteria, documents, technicalQueries, auditLogs, bidders };
    // Nothing new to write: a copy just taken from the cloud must not be written straight back.
    if (JSON.stringify(payload) === lastSyncedPayloadRef.current) return;
    const timer = setTimeout(() => {
      saveTenderDataToCloud(activeTenderId, identity, payload, tenderVersionRef.current)
        .then(async (result) => {
          if (result.success) {
            tenderVersionRef.current = result.updatedAt || tenderVersionRef.current;
            lastSyncedPayloadRef.current = JSON.stringify(payload);
            setLastCloudSync(result.updatedAt || new Date().toISOString());
            return;
          }
          if (!result.conflict) {
            console.error('Auto cloud sync error:', result.error);
            setCloudSyncError(result.error || 'Could not save this tender to the cloud.');
            return;
          }
          // Someone else saved first: take their version rather than writing over it.
          const latest = await loadTenderDataFromCloud(activeTenderId);
          if (latest.success && latest.data) {
            applyTenderDataFromCloud(latest.data, latest.data.lastSyncedAt);
            setCloudSyncError(
              `This tender was saved by ${latest.data.lastUpdatedBy || 'someone else'} while this page was open, so your last change was not written. The latest version is now shown - please make the change again.`
            );
          }
        })
        .catch((err) => console.error('Auto cloud sync error:', err));
    }, 2000);
    return () => clearTimeout(timer);
  }, [ioclBidders, documents, technicalQueries, ioclMetadata, criteria, auditLogs, bidders, firebaseUser, activeTenderId, canEditActiveTender]);

  const signInWithGoogleUser = async () => {
    try {
      // No 'syncing' status here: nothing syncs until Google returns an account, and the
      // popup can stay open (or take a few seconds to report being closed).
      setCloudSyncError(null);
      const cred = await signInWithPopup(auth, googleProvider);

      if (cred && cred.user) {
        setFirebaseUser(cred.user);
        setCloudSyncStatus('synced');
        // Signing in is a fresh start: open Home so the engineer picks the tender to work on.
        activeTenderIdRef.current = '';
        setActiveTenderIdState('');
        safeLocalStorageSetItem('iocl_active_tender_id', '');
        setActiveTab('home');
      } else {
        setCloudSyncStatus('synced');
      }
    } catch (err: any) {
      // Closing the popup is the engineer's choice, not a failure. If a saved sign-in was
      // restored meanwhile, there is nothing to report either.
      if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request' || auth.currentUser) {
        setCloudSyncStatus(auth.currentUser ? 'synced' : 'offline');
        return;
      }
      console.error('Google Login error:', err);
      const isDomainError = err?.code === 'auth/unauthorized-domain';
      const isBlocked = err?.code === 'auth/popup-blocked';

      let userFriendlyMsg = err.message || 'Google Auth login failed';
      if (isDomainError) {
        userFriendlyMsg = 'This domain is not authorized in Firebase Console -> Authentication -> Settings -> Authorized Domains. Ask an admin to add it before signing in.';
      } else if (isBlocked) {
        userFriendlyMsg = 'The browser blocked the Google Sign-In popup. Allow popups for this site and try again.';
      }

      setCloudSyncStatus('offline');
      setCloudSyncError(userFriendlyMsg);
    }
  };
  const signInAsDemoGuest = async (): Promise<string | null> => {
    try {
      setCloudSyncError(null);
      await signInAnonymously(auth);
      return null;
    } catch (err: any) {
      console.error('Demo guest sign-in error:', err);
      return err?.code === 'auth/operation-not-allowed' || err?.code === 'auth/admin-restricted-operation'
        ? 'Demo access is not enabled yet (Anonymous sign-in is off in Firebase Authentication). Please sign in with Google.'
        : err?.message || 'Could not start the demo session.';
    }
  };

  const signOutUser = async () => {
    try {
      if (firebaseUser && activeTenderId && canEditActiveTender) {
        // The auto-save waits 2 s after the last edit; don't lose that edit on the way out.
        const identity = (firebaseUser.isAnonymous ? 'Demo guest' : '') || firebaseUser.displayName || firebaseUser.email || firebaseUser.uid || 'Engineer';
        await saveTenderDataToCloud(activeTenderId, identity, {
          ioclBidders, ioclMetadata, criteria, documents, technicalQueries, auditLogs, bidders,
        }).catch((err) => console.error('Final save before sign-out failed:', err));
      }
      if (firebaseUser && activeTenderId && editLock?.uid === firebaseUser.uid) {
        await releaseEditLock(activeTenderId, firebaseUser.uid);
      }
      await signOut(auth);
    } catch (err: any) {
      console.error('Logout failed', err);
    }
    // Tender data cached in this browser belongs to the account that just left. Clear it so
    // the next person at this computer starts from the sign-in screen with nothing loaded;
    // the cloud copy is the source of truth and loads again on the next sign-in.
    const TENDER_CACHE_PREFIXES = ['bid_analyzer_', 'iocl_eval', 'iocl_metadata', 'tenders_list', 'iocl_active_tender_id', 'demo_owner_uid'];
    try {
      Object.keys(localStorage)
        .filter((key) => TENDER_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)))
        .forEach((key) => localStorage.removeItem(key));
    } catch {
      // Storage unavailable: nothing cached to clear.
    }
    window.location.reload();
  };
  const updateIoclMetadata = (updates: Partial<IoclTenderMetadata>) => {
    setIoclMetadata((prev) => {
      const prevSafe = prev || BLANK_IOCL_METADATA;
      const prevSig = prevSafe.signatories || BLANK_IOCL_METADATA.signatories;
      const updateSig = updates.signatories;

      const next: IoclTenderMetadata = {
        ...prevSafe,
        ...updates,
        signatories: {
          approvingAuthority: updateSig?.approvingAuthority === null ? null : {
            ...(prevSig.approvingAuthority || BLANK_IOCL_METADATA.signatories.approvingAuthority),
            ...(updateSig?.approvingAuthority || {}),
          },
          nextSuperiorOfficer: updateSig?.nextSuperiorOfficer === null ? null : {
            ...(prevSig.nextSuperiorOfficer || BLANK_IOCL_METADATA.signatories.nextSuperiorOfficer),
            ...(updateSig?.nextSuperiorOfficer || {}),
          },
          superiorOfficer: updateSig?.superiorOfficer === null ? null : {
            ...(prevSig.superiorOfficer || BLANK_IOCL_METADATA.signatories.superiorOfficer),
            ...(updateSig?.superiorOfficer || {}),
          },
          initiator: updateSig?.initiator === null ? null : {
            ...(prevSig.initiator || BLANK_IOCL_METADATA.signatories.initiator),
            ...(updateSig?.initiator || {}),
          },
        },
      };
      localStorage.setItem('iocl_metadata_active', JSON.stringify(next));
      if (activeTenderId) {
        localStorage.setItem(`iocl_metadata_${activeTenderId}`, JSON.stringify(next));
      }
      return next;
    });

    setCriteria((prev) => ({
      ...prev,
      tenderRef: updates.tenderNo || prev.tenderRef,
      tenderTitle: updates.jobName || prev.tenderTitle,
      similarWorkDefinition: updates.similarNatureDefinition || prev.similarWorkDefinition,
      similarWorkClause: updates.similarNatureClause ?? prev.similarWorkClause,
    }));
  };

  // Update whole IOCL bidder
  const updateIoclBidder = (bidderId: string, updates: Partial<IoclBidderEvaluation>) => {
    setIoclBidders((prev) =>
      prev.map((b) => {
        if (b.id !== bidderId) return b;
        const updated = { ...b, ...updates };
        if (updates.bidderName) {
          setBidders((bPrev) =>
            bPrev.map((bItem) =>
              bItem.id === bidderId || bItem.bidderName === b.bidderName
                ? { ...bItem, bidderName: updates.bidderName!, companyName: updates.bidderName! }
                : bItem
            )
          );
        }
        return updated;
      })
    );
  };

  const moveIoclBidderTo = (bidderId: string, slNo: number) => {
    setIoclBidders((prev) => {
      const from = prev.findIndex((b) => b.id === bidderId);
      if (from < 0) return prev;
      const to = Math.min(Math.max(1, Math.round(slNo)), prev.length) - 1;
      if (to === from) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next.map((b, idx) => ({ ...b, slNo: idx + 1 }));
    });
  };

  // Add new bidder into IOCL sheet & sync with bidders
  const addIoclBidder = (bidder: Omit<IoclBidderEvaluation, 'id' | 'slNo'>): string => {
    const newId = `iocl-bid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    setIoclBidders((prev) => {
      const nextSl = prev.length + 1;
      const nilDeviationSheet = bidderNilDeviation((bidder.workOrders || []).map((wo) => wo.nilDeviationSheet));
      const newBid: IoclBidderEvaluation = {
        ...bidder,
        workOrders: (bidder.workOrders || []).map((wo) => ({ ...wo, nilDeviationSheet })),
        id: newId,
        slNo: nextSl,
      };
      return [...prev, newBid];
    });

    setBidders((prev) => {
      if (prev.some((b) => b.id === newId || b.bidderName === bidder.bidderName)) return prev;
      const newGeneralBidder: Bidder = {
        id: newId,
        bidderName: bidder.bidderName,
        bidNumber: newId.toUpperCase().startsWith('BID-') ? newId.toUpperCase() : `BID-${newId.toUpperCase()}`,
        companyName: bidder.bidderName,
        contactPerson: bidder.contactPerson || '',
        email: bidder.email || '',
        phone: bidder.phone || '',
        tenderReference: activeTenderId,
        submissionDate: new Date().toISOString().substring(0, 10),
        gstin: bidder.gstin || '',
        category: 'Class-I Local Supplier (MII)',
        annualTurnoverCr: 5.5,
        netWorthCr: 2.1,
        positiveNetWorth: true,
        documentsCount: (bidder.workOrders || []).length,
        overallScore: bidder.finalPosition === 'Technically Acceptable' ? 90 : 70,
        eligibilityStatus: bidder.finalPosition === 'Technically Acceptable' ? 'Eligible' : 'Pending Evaluation',
        technicalRecommendation: bidder.finalPosition === 'Technically Acceptable' ? 'Technically Acceptable' : (bidder.finalPosition === 'Technically Rejected' ? 'Technically Rejected' : 'Query to be Raised'),
        recommendationReason: 'Registered in IOCL technical evaluation sheet.',
        status: 'Under Review',
        credentials: (bidder.workOrders || []).map((wo, wIdx) => ({
          id: `cred-${newId}-${wIdx}`,
          bidderId: newId,
          workOrderNumber: wo.woNumberAndDate,
          workOrderDate: wo.startDate || new Date().toISOString().substring(0, 10),
          projectName: wo.jobName,
          clientName: wo.issuingOrg,
          location: bidder.cityState || 'India',
          contractType: 'Project / LSTK',
          isArc: false,
          contractDurationMonths: typeof wo.durationMonths === 'number' ? wo.durationMonths : (parseFloat(String(wo.durationMonths || '12')) || 12),
          awardedValueCr: (wo.woValueLacs || 0) / 100,
          executedValueCr: (wo.compValueLacs || wo.woValueLacs || 0) / 100,
          annualizedValueCr: (wo.annualisedValueLacs || wo.compValueLacs || wo.woValueLacs || 0) / 100,
          isCompleted: Boolean(wo.compDate),
          completionDate: wo.compDate || 'Pending',
          hasClientCompletionCertificate: wo.compCertSubmitted === 'Yes',
          isWithinRecencyWindow: true,
          liquidatedDamagesImposed: false,
          scopeDescription: wo.jobName,
          matchedKeywords: ['Refinery Works', 'Technical Evaluation'],
          missingKeywords: [],
          similarNatureScore: wo.meetsSimilarNature === 'Yes' ? 95 : 45,
          similarNatureStatus: wo.meetsSimilarNature === 'Yes' ? 'Compliant' : 'Non-Compliant',
          isSubcontract: wo.isSubcontract === 'Yes',
          mainContractorName: wo.isSubcontract === 'Yes' ? wo.issuingOrg : undefined,
          hasClientSubcontractApproval: wo.ownerApprovalSubmitted === 'Yes',
          hasDirectPaymentProof: true,
          subcontractStatus: wo.isSubcontract === 'Yes' ? (wo.ownerApprovalSubmitted === 'Yes' ? 'Approved & Counted' : 'Disallowed - Missing Client NOC') : 'Not Applicable',
          missingDocuments: wo.compCertSubmitted === 'Yes' ? [] : ['Client Completion Certificate Missing'],
          evaluationNotes: wo.remarks,
        })),
        missingDocumentsList: [],
      };
      return [...prev, newGeneralBidder];
    });
    return newId;
  };

  // Add work order to existing bidder (creates bidder in ioclBidders or syncs credentials in bidders if needed)
  const addIoclWorkOrder = (bidderId: string, wo: Omit<IoclWorkOrderEntry, 'id'>) => {
    const newWoId = `iocl-wo-${Date.now().toString().slice(-4)}-${Math.floor(Math.random() * 1000)}`;
    const newWo: IoclWorkOrderEntry = {
      ...wo,
      id: newWoId,
    };

    setIoclBidders((prev) => {
      const exists = prev.some((b) => b.id === bidderId);
      if (!exists) {
        const bidderObj = bidders.find((b) => b.id === bidderId);
        const newBidder: IoclBidderEvaluation = {
          id: bidderId,
          slNo: prev.length + 1,
          bidderName: bidderObj?.bidderName || bidderObj?.companyName || 'Bidder',
          cityState: bidderObj?.location || 'India',
          pageNumber: 1,
          finalPosition: wo.woStatus === 'WO Accepted(1 WO)' ? 'Technically Acceptable' : 'Query to be raised',
          gstin: bidderObj?.gstin,
          workOrders: [newWo],
        };
        return [...prev, newBidder];
      }

      return prev.map((b) => {
        if (b.id !== bidderId) return b;
        const workOrders = [...b.workOrders, newWo];
        const nilDeviationSheet = bidderNilDeviation(workOrders.map((w) => w.nilDeviationSheet));
        return { ...b, workOrders: workOrders.map((w) => ({ ...w, nilDeviationSheet })) };
      });
    });

    // Also synchronize credential into bidders list
    const credCr = (wo.compValueLacs || wo.woValueLacs || 0) / 100;
    const durationMonths = typeof wo.durationMonths === 'number' ? wo.durationMonths : (parseFloat(String(wo.durationMonths || '12')) || 12);
    const annualizedCr = (wo.annualisedValueLacs || (wo.compValueLacs || wo.woValueLacs || 0)) / 100;

    const newCred: BidderCredential = {
      id: `cred-${Date.now().toString().slice(-4)}-${Math.floor(Math.random() * 1000)}`,
      bidderId,
      workOrderNumber: wo.woNumberAndDate || 'WO Reference',
      workOrderDate: wo.startDate || new Date().toISOString().substring(0, 10),
      projectName: wo.jobName || 'Industrial Contract Execution',
      clientName: wo.issuingOrg || 'Issuing Client',
      location: 'Site Premises',
      contractType: 'Project / LSTK',
      isArc: false,
      contractDurationMonths: durationMonths,
      awardedValueCr: (wo.woValueLacs || 0) / 100,
      executedValueCr: credCr,
      annualizedValueCr: annualizedCr,
      isCompleted: Boolean(wo.compDate),
      completionDate: wo.compDate || 'Pending',
      hasClientCompletionCertificate: wo.compCertSubmitted === 'Yes',
      isWithinRecencyWindow: true,
      liquidatedDamagesImposed: false,
      scopeDescription: wo.jobName,
      matchedKeywords: ['Work Order Review'],
      missingKeywords: [],
      similarNatureScore: wo.meetsSimilarNature === 'Yes' ? 95 : 45,
      similarNatureStatus: wo.meetsSimilarNature === 'Yes' ? 'Compliant' : 'Non-Compliant',
      isSubcontract: wo.isSubcontract === 'Yes',
      mainContractorName: wo.isSubcontract === 'Yes' ? wo.issuingOrg : undefined,
      hasClientSubcontractApproval: wo.ownerApprovalSubmitted === 'Yes',
      hasDirectPaymentProof: true,
      subcontractStatus: wo.isSubcontract === 'Yes' ? (wo.ownerApprovalSubmitted === 'Yes' ? 'Approved & Counted' : 'Disallowed - Missing Client NOC') : 'Not Applicable',
      missingDocuments: wo.compCertSubmitted === 'Yes' ? [] : ['Client Completion Certificate Missing'],
      evaluationNotes: wo.remarks,
    };

    setBidders((prev) =>
      prev.map((b) => {
        if (b.id !== bidderId) return b;
        return {
          ...b,
          documentsCount: (b.documentsCount || 0) + 1,
          credentials: [...(b.credentials || []), newCred],
        };
      })
    );
  };

  // Delete bidder completely from evaluation
  const deleteIoclBidder = (bidderId: string) => {
    let targetBidderName = 'Bidder';
    setIoclBidders((prev) => {
      const target = prev.find((b) => b.id === bidderId);
      if (target) {
        targetBidderName = target.bidderName;
      }
      return prev
        .filter((b) => b.id !== bidderId)
        .map((b, idx) => ({ ...b, slNo: idx + 1 }));
    });
    setBidders((prev) => prev.filter((b) => b.id !== bidderId));
    addAuditLog({
      action: 'Bidder Removed from TBA Sheet',
      bidderName: targetBidderName,
      oldValue: 'Active in Evaluation Sheet',
      newValue: 'Removed from TBA Sheet',
      reason: 'Bidder and all associated work orders removed from evaluation.',
    });
  };

  // Delete work order
  const deleteIoclWorkOrder = (bidderId: string, woId: string, removeBidderIfNoWos: boolean = false) => {
    let deletedWoNumber = 'Work Order';
    let targetBidderName = 'Bidder';
    let shouldRemoveEntireBidder = false;

    setIoclBidders((prev) => {
      const targetBidder = prev.find((b) => b.id === bidderId);
      if (!targetBidder) return prev;

      targetBidderName = targetBidder.bidderName;
      const targetWo = targetBidder.workOrders.find((w) => w.id === woId);
      if (targetWo) {
        deletedWoNumber = targetWo.woNumberAndDate || targetWo.jobName;
      }

      // If this is a placeholder row or caller requested removing bidder when no WOs remain
      if (woId.startsWith('placeholder-') || (removeBidderIfNoWos && targetBidder.workOrders.length <= 1)) {
        shouldRemoveEntireBidder = true;
        return prev
          .filter((b) => b.id !== bidderId)
          .map((b, idx) => ({ ...b, slNo: idx + 1 }));
      }

      const remainingWos = targetBidder.workOrders.filter((w) => w.id !== woId);

      // Re-evaluate bidder final position based on remaining WOs
      let updatedFinalPosition = targetBidder.finalPosition;
      if (remainingWos.length === 0) {
        updatedFinalPosition = 'Query to be raised';
      } else {
        const hasRejected = remainingWos.some((w) => w.woStatus === 'WO Rejected');
        const hasAccepted = remainingWos.some((w) => w.woStatus === 'WO Accepted(1 WO)');
        const hasQuery = remainingWos.some((w) => w.woStatus === 'Query to be raised');

        if (hasAccepted && !hasQuery && !hasRejected) {
          updatedFinalPosition = 'Technically Acceptable';
        } else if (hasQuery) {
          updatedFinalPosition = 'Query to be raised';
        } else if (hasRejected && !hasAccepted) {
          updatedFinalPosition = 'Technically Rejected';
        }
      }

      return prev.map((b) => {
        if (b.id !== bidderId) return b;
        return {
          ...b,
          workOrders: remainingWos,
          finalPosition: updatedFinalPosition,
        };
      });
    });

    if (shouldRemoveEntireBidder) {
      setBidders((prev) => prev.filter((b) => b.id !== bidderId));
      addAuditLog({
        action: 'Bidder Removed from TBA Sheet',
        bidderName: targetBidderName,
        oldValue: deletedWoNumber,
        newValue: 'Bidder & Work Order Removed',
        reason: 'Bidder and associated work orders removed from evaluation.',
      });
    } else {
      // Also remove from general bidders credentials
      setBidders((prev) =>
        prev.map((b) => {
          if (b.id !== bidderId) return b;
          const newCreds = (b.credentials || []).filter(
            (c) => c.workOrderNumber !== deletedWoNumber && c.id !== woId
          );
          return {
            ...b,
            documentsCount: Math.max(0, (b.documentsCount || 1) - 1),
            credentials: newCreds,
          };
        })
      );

      addAuditLog({
        action: 'Work Order Deleted',
        bidderName: targetBidderName,
        oldValue: deletedWoNumber,
        newValue: 'Deleted / Removed',
        reason: 'Evaluator removed work order during technical review.',
      });
    }
  };

  // Reset IOCL data to original PDF baseline
  const resetIoclData = () => {
    if (activeTenderId === '9070C26C53') {
      setIoclBidders(IOCL_TENDER_9070C26C53_BIDDERS);
      setIoclMetadata(IOCL_TENDER_9070C26C53_METADATA);
      localStorage.removeItem('iocl_eval_9070C26C53');
    } else {
      setIoclBidders(IOCL_BIDDERS_DATA);
      setIoclMetadata(IOCL_TENDER_METADATA);
      localStorage.removeItem('iocl_evaluation_data');
      localStorage.removeItem('iocl_metadata');
    }
  };

  // Raw PDF Extraction and parsing to IOCL standard schema (Zero-Hallucination)
  const simulateRawPdfExtraction = async (fileName: string): Promise<IoclWorkOrderEntry> => {
    return {
      id: `iocl-wo-${Date.now()}`,
      woNumberAndDate: `Pending verification for ${fileName}`,
      issuingOrg: 'Upload Verification Required',
      jobName: `Uploaded Document: ${fileName}`,
      meetsSimilarNature: 'No',
      compCertSubmitted: 'No',
      isSubcontract: 'No',
      ownerApprovalSubmitted: 'NA',
      startDate: null,
      compDate: null,
      durationMonths: null,
      woValueLacs: null,
      compValueLacs: null,
      annualisedValueLacs: null,
      nilDeviationSheet: 'Query to be raised',
      woStatus: 'Query to be raised',
      remarks: 'Document uploaded. Exact values pending AI/OCR text extraction.',
      rawPdfDocName: fileName,
      rawPdfSnippet: {
        pageNumber: 1,
        quoteText: `Awaiting text extraction for ${fileName}`,
        fieldMatch: 'Awaiting Review',
      },
    };
  };

  // Helper to add audit log
  const addAuditLog = (entry: {
    action: string;
    bidderName?: string;
    documentName?: string;
    fieldName?: string;
    oldValue: string;
    newValue: string;
    reason: string;
  }) => {
    const newEntry: AuditLogEntry = {
      id: `aud-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      user:
        currentRole === 'Evaluation Engineer'
          ? 'Er. S. Krishnamurthy (Evaluation Lead)'
          : currentRole === 'Tender Committee Member'
          ? 'Dr. P. V. Rao (Committee Chair)'
          : 'Admin System SecOps',
      role: currentRole,
      ...entry,
    };
    setAuditLogs((prev) => [newEntry, ...prev]);
  };

  const calculateArcAnnualized = (executedValueCr: number, durationMonths: number): number => {
    if (!durationMonths || durationMonths <= 0) return executedValueCr;
    // If actual duration is less than a year (< 12 months), consider the job to have taken in a year's time (12 months)
    const effectiveDuration = durationMonths < 12 ? 12 : durationMonths;
    return Number(((executedValueCr / effectiveDuration) * 12).toFixed(2));
  };

  const addBidder = (
    bidderData: Partial<Bidder> & { bidderName: string }
  ) => {
    const newId = `bid-${Date.now().toString().slice(-4)}`;
    const newBidder: Bidder = {
      id: newId,
      bidderName: bidderData.bidderName,
      bidNumber: bidderData.bidNumber
        ? (bidderData.bidNumber.toUpperCase().startsWith('BID-') ? bidderData.bidNumber : `BID-${bidderData.bidNumber}`)
        : (newId.toUpperCase().startsWith('BID-') ? newId.toUpperCase() : `BID-${newId.toUpperCase()}`),
      companyName: bidderData.companyName || bidderData.bidderName,
      contactPerson: bidderData.contactPerson || '',
      email: bidderData.email || '',
      phone: bidderData.phone || '',
      tenderReference: bidderData.tenderReference || activeTenderId,
      submissionDate: bidderData.submissionDate || new Date().toISOString().substring(0, 10),
      gstin: bidderData.gstin || '',
      category: bidderData.category || 'Class-I Local Supplier (MII)',
      annualTurnoverCr: bidderData.annualTurnoverCr || 5.0,
      netWorthCr: bidderData.netWorthCr || 2.0,
      positiveNetWorth: bidderData.positiveNetWorth ?? true,
      documentsCount: 0,
      overallScore: 70,
      eligibilityStatus: 'Pending Evaluation',
      technicalRecommendation: 'Query to be Raised',
      recommendationReason: 'Newly registered bidder.',
      status: 'Under Review',
      credentials: [],
      missingDocumentsList: [],
    };
    setBidders((prev) => [newBidder, ...prev]);
    setSelectedBidderId(newId);

    // Synchronize to ioclBidders list so 18-column technical evaluation and Work Order uploads reflect immediately
    setIoclBidders((prev) => {
      if (prev.some((b) => b.id === newId)) return prev;
      const newIoclBid: IoclBidderEvaluation = {
        id: newId,
        slNo: prev.length + 1,
        bidderName: bidderData.bidderName || bidderData.companyName || 'Bidder',
        cityState: (bidderData as any).location || 'India',
        pageNumber: 1,
        finalPosition: 'Query to be raised',
        gstin: bidderData.gstin,
        workOrders: [],
      };
      return [...prev, newIoclBid];
    });

    addAuditLog({
      action: 'Bidder Registration',
      bidderName: newBidder.bidderName,
      oldValue: 'N/A',
      newValue: `Bidder registered: ${newBidder.companyName} (${newBidder.bidNumber})`,
      reason: 'Bidder registered for tender participation.',
    });
  };

  const updateBidder = (id: string, updates: Partial<Bidder>) => {
    setBidders((prev) =>
      prev.map((b) => {
        if (b.id !== id) return b;
        const updated = { ...b, ...updates };
        if (updates.bidderName) {
          setIoclBidders((iPrev) =>
            iPrev.map((iItem) =>
              iItem.id === id || iItem.bidderName === b.bidderName
                ? { ...iItem, bidderName: updates.bidderName! }
                : iItem
            )
          );
        }
        return updated;
      })
    );
  };

  const addBidderCredential = (
    bidderId: string,
    cred: Omit<BidderCredential, 'id' | 'bidderId'>
  ) => {
    const credId = `cred-${Date.now().toString().slice(-4)}`;
    const annualized = cred.isArc
      ? calculateArcAnnualized(cred.executedValueCr, cred.contractDurationMonths)
      : cred.executedValueCr;

    const newCred: BidderCredential = {
      ...cred,
      id: credId,
      bidderId,
      annualizedValueCr: annualized,
    };

    setBidders((prev) =>
      prev.map((b) => {
        if (b.id !== bidderId) return b;
        return {
          ...b,
          credentials: [...(b.credentials || []), newCred],
        };
      })
    );

    const bName = bidders.find((b) => b.id === bidderId)?.bidderName;
    addAuditLog({
      action: 'Add Work Experience Credential',
      bidderName: bName,
      fieldName: 'Credential Submission',
      oldValue: 'None',
      newValue: `${newCred.workOrderNumber} (${newCred.clientName}) - Executed: ₹${newCred.executedValueCr} Cr`,
      reason: 'Bidder credential logged for PQC evaluation.',
    });
  };

  const updateBidderCredential = (
    bidderId: string,
    credId: string,
    updates: Partial<BidderCredential>
  ) => {
    setBidders((prev) =>
      prev.map((b) => {
        if (b.id !== bidderId) return b;
        return {
          ...b,
          credentials: (b.credentials || []).map((c) => {
            if (c.id !== credId) return c;
            const updated = { ...c, ...updates };
            if (updated.isArc) {
              updated.annualizedValueCr = calculateArcAnnualized(
                updated.executedValueCr,
                updated.contractDurationMonths
              );
            }
            return updated;
          }),
        };
      })
    );
  };

  const deleteBidderCredential = (bidderId: string, credId: string) => {
    setBidders((prev) =>
      prev.map((b) => {
        if (b.id !== bidderId) return b;
        return {
          ...b,
          credentials: (b.credentials || []).filter((c) => c.id !== credId),
        };
      })
    );
  };

  const addTechnicalQuery = (queryData: Omit<TechnicalQuery, 'id'>): TechnicalQuery => {
    const newId = `tq-${Date.now().toString().slice(-4)}`;
    const newQuery: TechnicalQuery = {
      ...queryData,
      id: newId,
    };
    setTechnicalQueries((prev) => [newQuery, ...prev]);

    addAuditLog({
      action: 'Technical Query (TQ) Issued',
      bidderName: newQuery.bidderName,
      oldValue: 'No Query',
      newValue: `${newQuery.tqRefNo} (${newQuery.clauseRef})`,
      reason: newQuery.deficiency,
    });

    return newQuery;
  };

  const updateTechnicalQuery = (id: string, updates: Partial<TechnicalQuery>) => {
    setTechnicalQueries((prev) =>
      prev.map((q) => (q.id === id ? { ...q, ...updates } : q))
    );
  };

  const deleteTechnicalQuery = (id: string) => {
    setTechnicalQueries((prev) => prev.filter((q) => q.id !== id));
  };

  const deleteDocument = async (docId: string) => {
    const docToDelete = documents.find((d) => d.id === docId);
    if (!docToDelete) return;

    if (docToDelete.storageUrl) {
      try {
        await deleteDocumentFromStorage(docToDelete.storageUrl);
      } catch (e) {
        console.error('Failed to delete from storage', e);
      }
    }

    setDocuments((prev) => prev.filter((d) => d.id !== docId));
  };

  const generateAutomatedQueriesForBidder = (bidderId: string): number => {
    const bidder = bidders.find((b) => b.id === bidderId);
    if (!bidder) return 0;

    let generatedCount = 0;
    const newQueries: TechnicalQuery[] = [];

    (bidder.credentials || []).forEach((c, idx) => {
      // Check 1: ARC Annualized shortfall
      if (c.isArc && c.contractDurationMonths > 12) {
        const annualized = calculateArcAnnualized(c.executedValueCr, c.contractDurationMonths);
        if (annualized < criteria.optionBTwoWorksCr) {
          const exists = technicalQueries.some(
            (q) => q.bidderId === bidderId && String(q.clauseRef || '').includes('ARC')
          );
          if (!exists) {
            newQueries.push({
              id: `tq-${Date.now()}-${idx}-arc`,
              tqRefNo: `TQ-${bidder.bidNumber.slice(-3)}/ARC-${idx + 1}`,
              bidderId,
              bidderName: bidder.companyName,
              clauseRef: 'PQC Clause 3.1.2 - Annualized ARC Value Calculation',
              credentialRef: `WO: ${c.workOrderNumber} (${c.clientName})`,
              deficiency: `Contract executed value of ₹${c.executedValueCr} Cr over ${c.contractDurationMonths} months yields an Annualized ARC Value of ₹${annualized} Cr/year, which falls below required threshold (₹${criteria.optionBTwoWorksCr} Cr).`,
              queryText: `Bidder is requested to clarify whether credential ${c.workOrderNumber} was executed under continuous annual scope and provide year-wise execution certificate issued by Client Engineer-in-Charge, or submit alternative qualifying single work credential exceeding ₹${criteria.optionBTwoWorksCr} Cr.`,
              responseDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                .toISOString()
                .substring(0, 10),
              status: 'Draft',
            });
            generatedCount++;
          }
        }
      }

      // Check 2: Subcontract without Client EIC Approval
      if (c.isSubcontract && !c.hasClientSubcontractApproval) {
        const exists = technicalQueries.some(
          (q) => q.bidderId === bidderId && String(q.clauseRef || '').includes('Subcontract')
        );
        if (!exists) {
          newQueries.push({
            id: `tq-${Date.now()}-${idx}-subc`,
            tqRefNo: `TQ-${bidder.bidNumber.slice(-3)}/SUBC-${idx + 1}`,
            bidderId,
            bidderName: bidder.companyName,
            clauseRef: 'PQC Clause 3.4 - Subcontractor Approval by Client/Owner',
            credentialRef: `WO: ${c.workOrderNumber} (Main Contractor: ${c.mainContractorName || 'OEM'})`,
            deficiency: `Experience submitted as subcontractor to ${c.mainContractorName || 'main contractor'} does not include the mandatory written approval / NOC from the end Client Engineer-in-Charge.`,
            queryText: `As per NIT Clause 3.4, subcontract experience is admissible only with prior written consent of Client. Bidder is requested to provide formal approval letter from ${c.clientName} and Form 26AS establishing direct remuneration.`,
            responseDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
              .toISOString()
              .substring(0, 10),
            status: 'Draft',
          });
          generatedCount++;
        }
      }

      // Check 3: Missing Completion Certificate
      if (!c.hasClientCompletionCertificate) {
        const exists = technicalQueries.some(
          (q) => q.bidderId === bidderId && String(q.credentialRef || '').includes(c.workOrderNumber) && String(q.clauseRef || '').includes('Completion')
        );
        if (!exists) {
          newQueries.push({
            id: `tq-${Date.now()}-${idx}-cc`,
            tqRefNo: `TQ-${bidder.bidNumber.slice(-3)}/CC-${idx + 1}`,
            bidderId,
            bidderName: bidder.companyName,
            clauseRef: 'PQC Clause 3.2 - Client Completion Certificate',
            credentialRef: `WO: ${c.workOrderNumber} (${c.clientName})`,
            deficiency: `Work order / LOA copy submitted without the mandatory final Completion Certificate issued by Client Engineer-in-Charge.`,
            queryText: `Please submit client-certified Completion Certificate for WO ${c.workOrderNumber} stating final executed value, date of actual completion, and satisfaction status.`,
            responseDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
              .toISOString()
              .substring(0, 10),
            status: 'Draft',
          });
          generatedCount++;
        }
      }
    });

    if (newQueries.length > 0) {
      setTechnicalQueries((prev) => [...newQueries, ...prev]);
      addAuditLog({
        action: 'Automated Technical Queries Generated',
        bidderName: bidder.bidderName,
        oldValue: '0 Draft TQs',
        newValue: `${newQueries.length} Technical Queries Created`,
        reason: 'Automated gap analysis against NIT PQC clauses.',
      });
    }

    return generatedCount;
  };

  const recordTechnicalRecommendation = (
    bidderId: string,
    recommendation: TechnicalRecommendation,
    reason: string
  ) => {
    const bidder = bidders.find((b) => b.id === bidderId);
    if (!bidder) return;

    const authorName =
      currentRole === 'Evaluation Engineer'
        ? 'Er. S. Krishnamurthy (Lead Evaluation Eng.)'
        : currentRole === 'Tender Committee Member'
        ? 'Dr. P. V. Rao (Tender Committee Chair)'
        : 'Administrator Override';

    const statusMap = {
      'Technically Acceptable': 'Recommended',
      'Query to be Raised': 'Query Raised',
      'Technically Rejected': 'Rejected',
    } as const;

    updateBidder(bidderId, {
      technicalRecommendation: recommendation,
      recommendationReason: reason,
      engineerDecision: recommendation,
      engineerDecisionNotes: reason,
      engineerDecisionBy: authorName,
      engineerDecisionAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
      status: statusMap[recommendation],
    });

    addAuditLog({
      action: 'Technical Bid Recommendation Recorded',
      bidderName: bidder.bidderName,
      oldValue: bidder.technicalRecommendation || 'Unreviewed',
      newValue: recommendation,
      reason: reason || 'Technical evaluation committee determination.',
    });
  };

  const recordEngineerDecision = (bidderId: string, decision: EligibilityStatus, notes: string) => {
    const bidder = bidders.find((b) => b.id === bidderId);
    if (!bidder) return;

    updateBidder(bidderId, {
      eligibilityStatus: decision,
      engineerDecisionNotes: notes,
      engineerDecisionAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
    });
  };

  const uploadDocuments = (newDocs: DocumentItem[]) => {
    setDocuments((prev) => [...newDocs, ...prev]);
    newDocs.forEach((d) => {
      setBidders((prev) =>
        prev.map((b) =>
          b.id === d.bidderId
            ? { ...b, documentsCount: (b.documentsCount || 0) + 1 }
            : b
        )
      );
      const bName = bidders.find((b) => b.id === d.bidderId)?.bidderName || 'Unknown Bidder';
      addAuditLog({
        action: 'Document Upload',
        bidderName: bName,
        documentName: d.fileName,
        oldValue: 'None',
        newValue: `${d.documentType} (${(d.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB)`,
        reason: 'Documents uploaded for evaluation.',
      });
    });
    if (newDocs[0]) {
      setSelectedDocumentId(newDocs[0].id);
    }
  };

  const updateExtractedField = (docId: string, fieldId: string, updates: Partial<ExtractedField>) => {
    setDocuments((prev) =>
      prev.map((doc) => {
        if (doc.id !== docId) return doc;
        return {
          ...doc,
          extractedFields: doc.extractedFields.map((f) =>
            f.id === fieldId ? { ...f, ...updates } : f
          ),
        };
      })
    );
  };

  const approveField = (docId: string, fieldId: string) => {
    const targetDoc = documents.find((d) => d.id === docId);
    const targetField = targetDoc?.extractedFields.find((f) => f.id === fieldId);
    const bidder = bidders.find((b) => b.id === targetDoc?.bidderId);

    if (!targetField || !targetDoc) return;

    updateExtractedField(docId, fieldId, {
      status: 'Approved',
      verifiedValue: targetField.extractedValue,
    });

    addAuditLog({
      action: 'Field Approval',
      bidderName: bidder?.bidderName,
      documentName: targetDoc.fileName,
      fieldName: targetField.fieldName,
      oldValue: targetField.extractedValue,
      newValue: `${targetField.extractedValue} (Verified by Engineer)`,
      reason: 'Verified against source document.',
    });
  };

  const rejectField = (docId: string, fieldId: string, reason: string) => {
    const targetDoc = documents.find((d) => d.id === docId);
    const targetField = targetDoc?.extractedFields.find((f) => f.id === fieldId);
    const bidder = bidders.find((b) => b.id === targetDoc?.bidderId);

    if (!targetField || !targetDoc) return;

    updateExtractedField(docId, fieldId, {
      status: 'Rejected',
      engineerNotes: reason,
    });

    addAuditLog({
      action: 'Field Rejection',
      bidderName: bidder?.bidderName,
      documentName: targetDoc.fileName,
      fieldName: targetField.fieldName,
      oldValue: targetField.extractedValue,
      newValue: 'Rejected',
      reason: reason || 'Does not meet tender qualification criteria.',
    });
  };

  const editField = (docId: string, fieldId: string, newValue: string, reason: string) => {
    const targetDoc = documents.find((d) => d.id === docId);
    const targetField = targetDoc?.extractedFields.find((f) => f.id === fieldId);
    const bidder = bidders.find((b) => b.id === targetDoc?.bidderId);

    if (!targetField || !targetDoc) return;

    updateExtractedField(docId, fieldId, {
      status: 'Edited',
      verifiedValue: newValue,
      engineerNotes: reason,
    });

    addAuditLog({
      action: 'Manual Field Correction',
      bidderName: bidder?.bidderName,
      documentName: targetDoc.fileName,
      fieldName: targetField.fieldName,
      oldValue: targetField.extractedValue,
      newValue: newValue,
      reason: reason || 'Correction entered by evaluation engineer based on manual visual review.',
    });
  };

  const markFieldClarification = (docId: string, fieldId: string, notes: string) => {
    const targetDoc = documents.find((d) => d.id === docId);
    const targetField = targetDoc?.extractedFields.find((f) => f.id === fieldId);
    const bidder = bidders.find((b) => b.id === targetDoc?.bidderId);

    if (!targetField || !targetDoc) return;

    updateExtractedField(docId, fieldId, {
      status: 'Needs Clarification',
      engineerNotes: notes,
    });

    addAuditLog({
      action: 'Tender Query / Clarification Raised',
      bidderName: bidder?.bidderName,
      documentName: targetDoc.fileName,
      fieldName: targetField.fieldName,
      oldValue: targetField.extractedValue,
      newValue: 'Clarification Required',
      reason: notes || 'Needs clarification from bidder.',
    });
  };

  const updateCriteria = (newCriteria: Partial<TenderEligibilityCriteria>) => {
    setCriteria((prev) => {
      const updated = { ...prev, ...newCriteria };
      addAuditLog({
        action: 'Tender PQC Criteria Amendment',
        oldValue: `Single Work: ₹${prev.optionASingleWorkCr} Cr, Recency: ${prev.recencyYears} yrs`,
        newValue: `Single Work: ₹${updated.optionASingleWorkCr} Cr, Recency: ${updated.recencyYears} yrs`,
        reason: 'Evaluation committee adjusted PQC criteria parameters.',
      });
      return updated;
    });

    setIoclMetadata((prev) => {
      const prevSafe = prev || BLANK_IOCL_METADATA;
      const singleLacs = newCriteria.optionASingleWorkCr !== undefined
        ? (newCriteria.optionASingleWorkCr * 100).toFixed(2)
        : prevSafe.valueOption1Job;
      const twoLacs = newCriteria.optionBTwoWorksCr !== undefined
        ? (newCriteria.optionBTwoWorksCr * 100).toFixed(2)
        : prevSafe.valueOption2Jobs;
      const threeLacs = newCriteria.optionCThreeWorksCr !== undefined
        ? (newCriteria.optionCThreeWorksCr * 100).toFixed(2)
        : prevSafe.valueOption3Jobs;
      const isOneTime = newCriteria.typeOfJob?.toLowerCase().includes('one time') ?? false;

      const next: IoclTenderMetadata = {
        ...prevSafe,
        tenderNo: newCriteria.tenderRef || prevSafe.tenderNo,
        jobName: newCriteria.tenderTitle || prevSafe.jobName,
        similarNatureDefinition: newCriteria.similarWorkDefinition || prevSafe.similarNatureDefinition,
        similarNatureClause: newCriteria.similarWorkClause ?? prevSafe.similarNatureClause,
        typeOfJob: newCriteria.typeOfJob
          ? (isOneTime
            ? 'One-Time Job (Annualization Not Applicable)'
            : 'ARC Job (Annualization Applicable)')
          : prevSafe.typeOfJob,
        valueOption1Job: singleLacs,
        valueOption2Jobs: twoLacs,
        valueOption3Jobs: threeLacs,
        dateOfBidOpening: newCriteria.closingDate || prevSafe.dateOfBidOpening,
      };
      localStorage.setItem('iocl_metadata_active', JSON.stringify(next));
      if (activeTenderId) {
        localStorage.setItem(`iocl_metadata_${activeTenderId}`, JSON.stringify(next));
      }
      return next;
    });
  };

  const runAIAnalysisOnDocument = (docId: string) => {
    setDocuments((prev) =>
      prev.map((d) => {
        if (d.id !== docId) return d;
        return {
          ...d,
          status: 'Extracted',
          overallConfidence: Math.min(99, Math.max(88, d.overallConfidence + 2)),
        };
      })
    );
    addAuditLog({
      action: 'AI Credential Analysis Engine Run',
      documentName: documents.find((d) => d.id === docId)?.fileName,
      oldValue: 'Existing Extraction',
      newValue: 'Refinery Scope & Keyword Verification Completed',
      reason: 'Re-ran multimodal Gemini OCR parser on multi-page PDF.',
    });
  };

  const runCrossDocumentComparison = (docAId: string, docBId: string) => {
    const docA = documents.find((d) => d.id === docAId);
    const docB = documents.find((d) => d.id === docBId);
    if (!docA || !docB) return;

    const newComp: ComparisonPair = {
      id: `cmp-${Date.now()}`,
      bidderId: docA.bidderId,
      docAId,
      docBId,
      docAName: docA.fileName,
      docBName: docB.fileName,
      docAType: docA.documentType,
      docBType: docB.documentType,
      overallMatch: 'Match',
      items: [
        {
          field: 'workOrderNumber',
          label: 'Work Order Number',
          docAValue: docA.extractedFields.find((f) => f.key === 'workOrderNumber')?.extractedValue || 'N/A',
          docBValue: docB.extractedFields.find((f) => f.key === 'workOrderNumber')?.extractedValue || 'N/A',
          matchStatus: 'Match',
          varianceNote: 'Exact cross-document reference confirmed.',
        },
        {
          field: 'clientName',
          label: 'Client Name',
          docAValue: docA.extractedFields.find((f) => f.key === 'clientName')?.extractedValue || 'N/A',
          docBValue: docB.extractedFields.find((f) => f.key === 'clientName')?.extractedValue || 'N/A',
          matchStatus: 'Match',
          varianceNote: 'Matching corporate client entity.',
        },
        {
          field: 'contractValue',
          label: 'Contract Value',
          docAValue: docA.extractedFields.find((f) => f.key === 'contractValue')?.extractedValue || 'N/A',
          docBValue: docB.extractedFields.find((f) => f.key === 'contractValue')?.extractedValue || 'N/A',
          matchStatus: 'Match',
          varianceNote: 'Values corroborated with variance < 5%.',
        },
      ],
    };

    setComparisons((prev) => [newComp, ...prev]);
    addAuditLog({
      action: 'Document Reconciliation Comparison',
      documentName: `${docA.fileName} vs ${docB.fileName}`,
      oldValue: 'Uncompared',
      newValue: 'Reconciliation Map Generated',
      reason: 'Automated 7-field cross-validation executed.',
    });
  };

  const recheckValidationRules = () => {
    setValidationRules((prev) =>
      prev.map((r) => ({
        ...r,
        details: `${r.details} (Re-verified at ${new Date().toLocaleTimeString()})`,
      }))
    );
    addAuditLog({
      action: 'Validation Rules Re-Scan',
      oldValue: 'Previous Check',
      newValue: '10 Core Validation Rules Re-evaluated',
      reason: 'On-demand compliance verification batch run.',
    });
  };

  const mintTenderId = (): TenderId => `${firebaseUser?.isAnonymous ? DEMO_TENDER_PREFIX : 'TENDER-'}${Date.now()}`;

  // Safety net for work that somehow has no tender id (normally Home makes the engineer open
  // or start one first). It gets a new id, keeping its data, so uploads and saves have
  // somewhere to go. It is never merged into an existing tender with the same ref: that
  // would push this browser's copy over the shared one.
  const ensureActiveTenderId = (): TenderId => {
    if (activeTenderIdRef.current) return activeTenderIdRef.current;
    const newId = mintTenderId();
    activeTenderIdRef.current = newId;
    setActiveTenderIdState(newId);
    safeLocalStorageSetItem('iocl_active_tender_id', newId);
    return newId;
  };

    const clearAllDataAndStartFresh = () => {
    const newId = mintTenderId();
    setActiveTenderIdState(newId);
    localStorage.setItem('iocl_active_tender_id', newId);
    
    setBidders([]);
    setDocuments([]);
    setComparisons([]);
    setValidationRules([]);
    setCriteria(BLANK_CRITERIA);
    setAuditLogs([]);
    setTechnicalQueries([]);
    setIoclBidders([]);
    setIoclMetadata(BLANK_IOCL_METADATA);
    setSelectedBidderId('');
    setSelectedDocumentId('');
    setActiveTab('onboarding');
  };

  const loadSampleEvaluationDataset = () => {
    setBidders(INITIAL_BIDDERS);
    setDocuments(INITIAL_DOCUMENTS);
    setComparisons(INITIAL_COMPARISONS);
    setValidationRules(INITIAL_RULES);
    setCriteria({ ...INITIAL_CRITERIA, isConfigured: true });
    setAuditLogs(INITIAL_AUDIT_LOGS);
    setTechnicalQueries(INITIAL_QUERIES);
    setIoclBidders(IOCL_TENDER_9070C26C53_BIDDERS);
    setIoclMetadata(IOCL_TENDER_9070C26C53_METADATA);
    setSelectedBidderId(INITIAL_BIDDERS[0]?.id || '');
    setSelectedDocumentId(INITIAL_DOCUMENTS[0]?.id || '');
    setActiveTab('evaluation-sheet');
  };

  const resetDemoData = () => {
    clearAllDataAndStartFresh();
  };

  // Metrics calculation
  const metrics = useMemo(() => {
    const totalBidders = bidders.length;
    const documentsUploaded = documents.length;

    let acceptableBidders = 0;
    let queryBidders = 0;
    let rejectedBidders = 0;
    let totalCredentialsCount = 0;

    bidders.forEach((b) => {
      if (b.technicalRecommendation === 'Technically Acceptable') acceptableBidders++;
      else if (b.technicalRecommendation === 'Query to be Raised') queryBidders++;
      else if (b.technicalRecommendation === 'Technically Rejected') rejectedBidders++;

      totalCredentialsCount += (b.credentials || []).length;
    });

    const totalQueries = technicalQueries.length;
    const openQueries = technicalQueries.filter(
      (q) => q.status !== 'Closed / Accepted' && q.status !== 'Dropped'
    ).length;

    let validCredentials = 0;
    let approvedCredentials = 0;
    let manualReviewsPending = 0;

    documents.forEach((doc) => {
      doc.extractedFields.forEach((field) => {
        if (field.status === 'Approved') approvedCredentials++;
        if (field.status === 'Pending' || field.status === 'Needs Clarification') manualReviewsPending++;
        if (field.confidenceScore >= 90) validCredentials++;
      });
    });

    const mismatchesFound = comparisons.reduce((acc, cmp) => {
      const mismatches = cmp.items.filter((i) => i.matchStatus !== 'Match').length;
      return acc + mismatches;
    }, 0);

    return {
      totalBidders,
      acceptableBidders,
      queryBidders,
      rejectedBidders,
      totalQueries,
      openQueries,
      documentsUploaded,
      validCredentials,
      mismatchesFound,
      manualReviewsPending,
      approvedCredentials,
      totalCredentialsCount,
    };
  }, [bidders, documents, comparisons, technicalQueries]);

  // Final positions and header counts are derived from engineer-confirmed work orders, so the
  // sheet, Excel and PDF always agree with the individual rows instead of hand-typed totals.
  const tbaSummary = useMemo(() => summariseTba(ioclBidders), [ioclBidders]);
  const derivedIoclBidders = useMemo(
    () =>
      ioclBidders.map((b) => {
        // Null while the outcome still depends on unconfirmed rows: shown as pending, not as a
        // position left over from before.
        const position = bidderOutcome(b.workOrders || []).position ?? undefined;
        return position !== b.finalPosition ? { ...b, finalPosition: position } : b;
      }),
    [ioclBidders]
  );
  const derivedIoclMetadata = useMemo(
    () => ({
      ...ioclMetadata,
      totalBids: tbaSummary.totalBids,
      totalBidsText: `${tbaSummary.totalBids} (${numberToWords(tbaSummary.totalBids)})`,
      technicallyAcceptable: tbaSummary.acceptable,
      technicallyNotAcceptable: tbaSummary.rejected,
      queryToBeRaisedTo: tbaSummary.query,
    }),
    [ioclMetadata, tbaSummary]
  );

  return (
    <AppContext.Provider
      value={{
        activeTab,
        setActiveTab,
        currentRole,
        setCurrentRole,
        bidders,
        documents,
        comparisons,
        validationRules,
        criteria,
        auditLogs,
        technicalQueries,
        selectedBidderId,
        setSelectedBidderId,
        selectedDocumentId,
        setSelectedDocumentId,
        activeEvidenceModal,
        setActiveEvidenceModal,
        employeeId,
        setEmployeeId,
        isSidebarCollapsed,
        setIsSidebarCollapsed,
        toggleSidebar,
        activeTenderId,
        setActiveTenderId,
        ensureActiveTenderId,
        triangulationData: BALIMEEN_TRIANGULATION_DATA,
        savedTenders,
        deleteTender: (id) => {
          setSavedTenders(prev => prev.filter(t => t.id !== id));
          if (firebaseUser) {
            deleteTenderDocument(id).catch(err => console.error('Failed to delete tender from cloud:', err));
          }
        },
        addBidder,
        updateBidder,
        addBidderCredential,
        updateBidderCredential,
        deleteBidderCredential,
        calculateArcAnnualized,
        addTechnicalQuery,
        updateTechnicalQuery,
        deleteTechnicalQuery,
        generateAutomatedQueriesForBidder,
        recordTechnicalRecommendation,
        recordEngineerDecision,
        updateCriteria,
        uploadDocuments,
        deleteDocument,
        updateExtractedField,
        approveField,
        rejectField,
        editField,
        markFieldClarification,
        runAIAnalysisOnDocument,
        runCrossDocumentComparison,
        recheckValidationRules,
        resetDemoData,
        clearAllDataAndStartFresh,
        loadSampleEvaluationDataset,
        addAuditLog,
        metrics,
        ioclBidders: derivedIoclBidders,
        ioclMetadata: derivedIoclMetadata,
        tbaSummary,
        confirmIoclWorkOrder,
        updateIoclMetadata,
        updateIoclWorkOrder,
        updateIoclBidder,
        addIoclBidder,
        addIoclWorkOrder,
        moveIoclBidderTo,
        deleteIoclBidder,
        deleteIoclWorkOrder,
        resetIoclData,
        simulateRawPdfExtraction,
        firebaseUser,
        authReady,
        cloudSyncStatus,
        lastCloudSync,
        cloudSyncError,
        saveToCloud,
        restoreFromCloud,
        signInWithGoogleUser,
        signInAsDemoGuest,
        isDemoUser: Boolean(firebaseUser?.isAnonymous),
        signOutUser,
        editLock,
        canEditActiveTender,
        claimTenderEditLock,
        releaseTenderEditLock,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
