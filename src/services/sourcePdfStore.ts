import { auth, storage, ref, uploadBytes, getBytes } from '../lib/firebase';
import { isDemoTenderId } from './firebaseSyncService';

// Keeps the original uploaded PDFs so the evidence viewer always shows the real document.
// Each file is identified by its SHA-256, cached in this browser's IndexedDB for instant
// reopening, and uploaded to Firebase Storage so teammates on other machines can open it too.

const DB_NAME = 'tba-source-pdfs';
const STORE = 'files';

export interface StoredSourcePdf {
  sourceDocId: string;
  sourceDocPath: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as ArrayBuffer) || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function idbPut(key: string, bytes: ArrayBuffer): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(bytes, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Private windows can block IndexedDB; Storage still has the file.
  }
}

export async function sourceDocIdFor(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 40);
}

// Demo guests can only write under their own uid (storage.rules); real tenders are shared.
function storagePathFor(tenderId: string, sourceDocId: string): string {
  const uid = auth.currentUser?.uid || 'unknown';
  const tender = (tenderId || 'no-tender').replace(/[^A-Za-z0-9_-]/g, '_');
  return isDemoTenderId(tenderId) || auth.currentUser?.isAnonymous
    ? `demo/${uid}/${tender}/${sourceDocId}.pdf`
    : `tenders/${tender}/sources/${sourceDocId}.pdf`;
}

const pendingUploads = new Map<string, Promise<boolean>>();

// Returns the file's ids straight away; the Storage upload continues in the background.
export async function storeSourcePdf(file: File | Blob, tenderId: string): Promise<StoredSourcePdf> {
  const bytes = await file.arrayBuffer();
  const sourceDocId = await sourceDocIdFor(bytes);
  const sourceDocPath = storagePathFor(tenderId, sourceDocId);
  await idbPut(sourceDocId, bytes);

  if (!pendingUploads.has(sourceDocPath)) {
    const upload = uploadBytes(ref(storage, sourceDocPath), bytes, {
      contentType: file.type || 'application/pdf',
      customMetadata: { fileName: (file as File).name || 'document.pdf' },
    })
      .then(() => true)
      .catch((err) => {
        console.warn('Original PDF could not be uploaded to Firebase Storage; it stays available in this browser only.', err);
        return false;
      });
    pendingUploads.set(sourceDocPath, upload);
  }
  return { sourceDocId, sourceDocPath };
}

export type SourcePdfLoadResult =
  | { bytes: Uint8Array; from: 'this-browser' | 'cloud' }
  | { bytes: null; reason: string };

export async function loadSourcePdf(sourceDocId?: string, sourceDocPath?: string): Promise<SourcePdfLoadResult> {
  if (sourceDocId) {
    const cached = await idbGet(sourceDocId);
    if (cached) return { bytes: new Uint8Array(cached), from: 'this-browser' };
  }
  if (sourceDocPath) {
    try {
      await pendingUploads.get(sourceDocPath);
      const buf = await getBytes(ref(storage, sourceDocPath), 60 * 1024 * 1024);
      if (sourceDocId) await idbPut(sourceDocId, buf);
      return { bytes: new Uint8Array(buf), from: 'cloud' };
    } catch (err: any) {
      return { bytes: null, reason: err?.code === 'storage/object-not-found' ? 'not-in-cloud' : `cloud-error: ${err?.code || err?.message || err}` };
    }
  }
  return { bytes: null, reason: 'no-reference' };
}

// Lets an engineer re-attach the original file to rows extracted before PDFs were kept.
export async function attachSourcePdf(file: File, tenderId: string): Promise<StoredSourcePdf & { bytes: Uint8Array }> {
  const stored = await storeSourcePdf(file, tenderId);
  return { ...stored, bytes: new Uint8Array(await file.arrayBuffer()) };
}
