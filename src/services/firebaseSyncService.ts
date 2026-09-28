import {
  db,
  auth,
  collection,
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  runTransaction,
  serverTimestamp,
  storage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from '../lib/firebase';
import {
  IoclBidderEvaluation,
  IoclTenderMetadata,
  TenderEligibilityCriteria,
  DocumentItem,
  TechnicalQuery,
  AuditLogEntry,
  Bidder,
  TenderSession,
} from '../types';

export interface TenderCloudData {
  ioclBidders: IoclBidderEvaluation[];
  ioclMetadata: IoclTenderMetadata | null;
  criteria: TenderEligibilityCriteria | null;
  documents: DocumentItem[];
  technicalQueries: TechnicalQuery[];
  auditLogs: AuditLogEntry[];
  bidders: Bidder[];
}

export interface EditLock {
  uid: string;
  name: string;
  claimedAt: string;
}

// A claim older than this is treated as abandoned (crashed tab, closed laptop) and can be
// taken over by someone else; the holder refreshes it well within this window (see
// EDIT_LOCK_HEARTBEAT_MS in AppContext) so an active editor never loses it involuntarily.
export const EDIT_LOCK_STALE_MS = 45_000;

const TENDERS_COLLECTION = 'tenders';

const tenderDocRef = (tenderId: string) => doc(db, TENDERS_COLLECTION, tenderId);

// Guest (demo) sessions work in their own DEMO- tenders, owned by the guest's uid.
// firestore.rules only lets a guest touch tender docs carrying their own demoOwner, and
// every write re-sends it because a merge write must still satisfy that rule.
export const DEMO_TENDER_PREFIX = 'DEMO-';
export const isDemoTenderId = (tenderId: string | null | undefined) => String(tenderId || '').startsWith(DEMO_TENDER_PREFIX);
const demoOwnerFields = (tenderId: string) => {
  const user = auth.currentUser;
  return user?.isAnonymous && isDemoTenderId(tenderId) ? { isDemo: true, demoOwner: user.uid } : {};
};

function removeUndefined<T>(obj: T): T {
  if (obj === undefined) return null as any;
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map(removeUndefined) as unknown as T;
  }
  const clone: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    const val = (obj as Record<string, any>)[key];
    if (val !== undefined) {
      clone[key] = removeUndefined(val);
    }
  }
  return clone as T;
}

import { stripHeavyFileData } from '../utils/storage';

// A tender is saved whole, so a browser holding an older copy of it - a second tab, the same
// tender open on another computer - used to write its rows back over newer ones, and deleted work
// orders reappeared. The save therefore says which version it is updating: if the stored copy has
// moved on since, nothing is written and the caller is told to take the newer copy first.
export const saveTenderDataToCloud = async (
  tenderId: string,
  userIdentity: string,
  data: TenderCloudData,
  expectedUpdatedAt?: string | null
): Promise<{ success: boolean; error?: string; conflict?: boolean; updatedAt?: string; currentUpdatedAt?: string }> => {
  if (!tenderId) return { success: false, error: 'No active tender selected' };
  try {
    const nowIso = new Date().toISOString();
    const cleanData = stripHeavyFileData(data);
    const payload = removeUndefined({
      ref: cleanData.criteria?.tenderRef || '',
      title: cleanData.criteria?.tenderTitle || cleanData.ioclMetadata?.jobName || '',
      clientOrg: cleanData.criteria?.clientOrg || '',
      ioclBidders: cleanData.ioclBidders || [],
      ioclMetadata: cleanData.ioclMetadata || null,
      criteria: cleanData.criteria || null,
      documents: cleanData.documents || [],
      technicalQueries: cleanData.technicalQueries || [],
      auditLogs: cleanData.auditLogs || [],
      bidders: cleanData.bidders || [],
      updatedAt: nowIso,
      lastModified: nowIso,
      lastUpdatedBy: userIdentity || 'Collaborating Engineer',
      lastSyncTimestamp: import.meta.env.VITE_OFFLINE_MODE === 'true' ? nowIso : serverTimestamp(),
      ...demoOwnerFields(tenderId),
    });

    if (import.meta.env.VITE_OFFLINE_MODE === 'true') {
      const res = await fetch(`/api/local-tenders/${tenderId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Failed to save to local persistence');
      const result = await res.json();
      return { success: true, updatedAt: result.updatedAt };
    }

    if (expectedUpdatedAt === undefined) {
      await setDoc(tenderDocRef(tenderId), payload, { merge: true });
      return { success: true, updatedAt: nowIso };
    }
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(tenderDocRef(tenderId));
      const currentUpdatedAt: string | undefined = snap.exists() ? snap.data().updatedAt : undefined;
      if (currentUpdatedAt && expectedUpdatedAt && currentUpdatedAt !== expectedUpdatedAt) {
        return { success: false, conflict: true, currentUpdatedAt };
      }
      if (currentUpdatedAt && !expectedUpdatedAt) {
        return { success: false, conflict: true, currentUpdatedAt };
      }
      tx.set(tenderDocRef(tenderId), payload, { merge: true });
      return { success: true, updatedAt: nowIso };
    });
  } catch (err: any) {
    console.error('Tender cloud save error:', err);
    return { success: false, error: err?.message || 'Failed to save tender to cloud' };
  }
};

export const loadTenderDataFromCloud = async (
  tenderId: string
): Promise<{ success: boolean; data?: TenderCloudData & { lastSyncedAt?: string; lastUpdatedBy?: string }; error?: string }> => {
  if (!tenderId) return { success: true, data: undefined };
  try {
    let d: any;
    if (import.meta.env.VITE_OFFLINE_MODE === 'true') {
      const res = await fetch(`/api/local-tenders/${tenderId}`);
      if (!res.ok) {
        if (res.status === 404) return { success: true, data: undefined };
        throw new Error('Failed to load from local persistence');
      }
      d = await res.json();
    } else {
      const snap = await getDoc(tenderDocRef(tenderId));
      if (!snap.exists()) return { success: true, data: undefined };
      d = snap.data();
    }
    
    return {
      success: true,
      data: {
        ioclBidders: d.ioclBidders || [],
        ioclMetadata: d.ioclMetadata || null,
        criteria: d.criteria || null,
        documents: d.documents || [],
        technicalQueries: d.technicalQueries || [],
        auditLogs: d.auditLogs || [],
        bidders: d.bidders || [],
        lastSyncedAt: d.updatedAt,
        lastUpdatedBy: d.lastUpdatedBy,
      },
    };
  } catch (err: any) {
    console.error('Tender cloud load error:', err);
    return { success: false, error: err?.message || 'Failed to load tender from cloud' };
  }
};

// The tender's data as it changes in the cloud, so a browser showing it follows what a teammate
// (or this user's other tab) saves instead of holding a stale copy that it may later write back.
export const subscribeToTenderData = (
  tenderId: string,
  callback: (snapshot: { data: TenderCloudData; updatedAt?: string; lastUpdatedBy?: string }) => void
): (() => void) => {
  if (!tenderId) return () => {};
  
  if (import.meta.env.VITE_OFFLINE_MODE === 'true') {
    let active = true;
    const poll = async () => {
      if (!active) return;
      try {
        const res = await fetch(`/api/local-tenders/${tenderId}`);
        if (res.ok) {
          const d = await res.json();
          callback({
            data: {
              ioclBidders: d.ioclBidders || [],
              ioclMetadata: d.ioclMetadata || null,
              criteria: d.criteria || null,
              documents: d.documents || [],
              technicalQueries: d.technicalQueries || [],
              auditLogs: d.auditLogs || [],
              bidders: d.bidders || [],
            },
            updatedAt: d.updatedAt,
            lastUpdatedBy: d.lastUpdatedBy,
          });
        }
      } catch (err) {}
      if (active) setTimeout(poll, 3000);
    };
    poll();
    return () => { active = false; };
  }

  return onSnapshot(
    tenderDocRef(tenderId),
    (snap) => {
      if (!snap.exists() || snap.metadata.hasPendingWrites) return;
      const d = snap.data();
      callback({
        data: {
          ioclBidders: d.ioclBidders || [],
          ioclMetadata: d.ioclMetadata || null,
          criteria: d.criteria || null,
          documents: d.documents || [],
          technicalQueries: d.technicalQueries || [],
          auditLogs: d.auditLogs || [],
          bidders: d.bidders || [],
        },
        updatedAt: d.updatedAt,
        lastUpdatedBy: d.lastUpdatedBy,
      });
    },
    (err) => console.warn('Tender data subscription error:', err?.message || err)
  );
};

// Live index of every tender any signed-in team member has created, so a second
// evaluator sees tenders started by someone else instead of only their own browser's list.
// Guests only see their own demo tenders; signed-in users see every real tender, without guests' demo ones.
export const subscribeToTenderList = (callback: (tenders: TenderSession[]) => void): (() => void) => {
  if (import.meta.env.VITE_OFFLINE_MODE === 'true') {
    let active = true;
    const poll = async () => {
      if (!active) return;
      try {
        const res = await fetch(`/api/local-tenders`);
        if (res.ok) {
          const tenders = await res.json();
          callback(tenders);
        }
      } catch (err) {}
      if (active) setTimeout(poll, 3000);
    };
    poll();
    return () => { active = false; };
  }

  const user = auth.currentUser;
  const source = user?.isAnonymous
    ? query(collection(db, TENDERS_COLLECTION), where('demoOwner', '==', user.uid))
    : collection(db, TENDERS_COLLECTION);
  return onSnapshot(source, (snap) => {
    const docs = user?.isAnonymous ? snap.docs : snap.docs.filter((d) => !d.data().isDemo);
    const tenders: TenderSession[] = docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ref: data.ref || '',
        title: data.title || '',
        clientOrg: data.clientOrg || '',
        lastModified: data.lastModified || data.updatedAt || '',
        biddersCount: Array.isArray(data.ioclBidders) ? data.ioclBidders.length : undefined,
      };
    });
    callback(tenders);
  }, (err) => console.error('Tender list subscription error:', err));
};

const isLockStale = (lock: EditLock | null | undefined): boolean => {
  if (!lock) return true;
  return Date.now() - new Date(lock.claimedAt).getTime() > EDIT_LOCK_STALE_MS;
};

// Claims the per-tender edit lock via a transaction so two simultaneous "Claim Edit" clicks
// can't both succeed. Succeeds if the lock is empty, already held by this uid, or stale.
export const claimEditLock = async (
  tenderId: string,
  uid: string,
  name: string
): Promise<{ success: boolean; heldBy?: EditLock }> => {
  const ref = tenderDocRef(tenderId);
  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const current: EditLock | null = snap.exists() ? snap.data().editLock || null : null;
      if (current && current.uid !== uid && !isLockStale(current)) {
        return { success: false, heldBy: current };
      }
      const newLock: EditLock = { uid, name, claimedAt: new Date().toISOString() };
      tx.set(ref, { editLock: newLock, ...demoOwnerFields(tenderId) }, { merge: true });
      return { success: true };
    });
  } catch (err) {
    console.error('claimEditLock failed:', err);
    return { success: false };
  }
};

export const refreshEditLock = async (tenderId: string, uid: string): Promise<void> => {
  const ref = tenderDocRef(tenderId);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const current: EditLock | null = snap.exists() ? snap.data().editLock || null : null;
      if (!current || current.uid !== uid) return;
      tx.set(ref, { editLock: { ...current, claimedAt: new Date().toISOString() }, ...demoOwnerFields(tenderId) }, { merge: true });
    });
  } catch (err) {
    console.error('refreshEditLock failed:', err);
  }
};

export const releaseEditLock = async (tenderId: string, uid: string): Promise<void> => {
  const ref = tenderDocRef(tenderId);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const current: EditLock | null = snap.exists() ? snap.data().editLock || null : null;
      if (!current || current.uid !== uid) return;
      tx.set(ref, { editLock: null, ...demoOwnerFields(tenderId) }, { merge: true });
    });
  } catch (err) {
    console.error('releaseEditLock failed:', err);
  }
};

export const subscribeToEditLock = (
  tenderId: string,
  callback: (lock: EditLock | null) => void
): (() => void) => {
  if (!tenderId) {
    callback(null);
    return () => {};
  }
  return onSnapshot(tenderDocRef(tenderId), (snap) => {
    callback(snap.exists() ? snap.data().editLock || null : null);
  }, (err) => console.error('Edit lock subscription error:', err));
};

export const deleteTenderDocument = async (tenderId: string): Promise<void> => {
  if (!tenderId) return;
  if (import.meta.env.VITE_OFFLINE_MODE === 'true') {
    const res = await fetch(`/api/local-tenders/${tenderId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete local tender');
    return;
  }
  await deleteDoc(tenderDocRef(tenderId));
};

export const uploadDocumentToStorage = async (
  fileOrBlob: File | Blob,
  userId?: string,
  docId?: string,
  customFileName?: string
): Promise<string> => {
  const uid = userId || auth.currentUser?.uid || 'anonymous_user';
  const fileName = customFileName || (fileOrBlob as File).name || `doc_${Date.now()}.pdf`;
  const safeDocId = docId || `doc_${Date.now()}`;
  const path = `users/${uid}/documents/${safeDocId}/${fileName}`;
  const storageRef = ref(storage, path);

  await uploadBytes(storageRef, fileOrBlob);
  const downloadUrl = await getDownloadURL(storageRef);
  return downloadUrl;
};

export const deleteDocumentFromStorage = async (url: string): Promise<void> => {
  const storageRef = ref(storage, url);
  await deleteObject(storageRef);
};
