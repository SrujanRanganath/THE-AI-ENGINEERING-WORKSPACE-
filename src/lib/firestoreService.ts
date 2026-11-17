import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocFromServer,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  limit,
} from 'firebase/firestore';
import type { PublishedWebsiteSnapshot } from '../utils/publishPreview';
import { db, auth } from './firebase';
import {
  migrateGuestToAuthenticatedAccount,
  MigrationResult,
  WorkspaceCollectionName,
  OwnedWorkspaceRecord,
} from '../utils/guestMigration';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function isFirestoreOfflineError(error: unknown): boolean {
  const code = (error as any)?.code;
  if (code === 'unavailable') return true;
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    msg.includes('the client is offline') ||
    msg.includes('could not reach cloud firestore backend') ||
    msg.includes('unavailable')
  );
}

/**
 * Checks whether direct Cloud Firestore read/write is permitted for the given ownerId.
 * `firestore.rules` enforces `request.auth != null && request.auth.uid == ownerId`
 * (without requiring `token.email_verified`), so both Google accounts and OTP-verified
 * email/password accounts sync directly to Cloud Firestore.
 */
function canSyncWithCloudFirestore(ownerId: string): boolean {
  if (!auth.currentUser || !ownerId || ownerId.startsWith('guest_') || auth.currentUser.uid !== ownerId) {
    return false;
  }
  return true;
}

function getLocalItems<T>(col: string, ownerId: string): T[] {
  try {
    const raw = localStorage.getItem(`ws_${col}_${ownerId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function setLocalItems<T>(col: string, ownerId: string, items: T[]): void {
  try {
    localStorage.setItem(`ws_${col}_${ownerId}`, JSON.stringify(items));
  } catch (err) {
    console.warn('LocalStorage quota or write error:', err);
  }
}

function upsertLocalItem<T extends { id: string }>(col: string, ownerId: string, item: T): void {
  const items = getLocalItems<T>(col, ownerId).filter((existing) => existing.id !== item.id);
  items.unshift(item);
  setLocalItems(col, ownerId, items);
}

function updateLocalItemById<T extends { id: string }>(
  col: string,
  ownerId: string,
  id: string,
  updates: Partial<T>
): void {
  const items = getLocalItems<T>(col, ownerId);
  const idx = items.findIndex((item) => item.id === id);
  if (idx >= 0) {
    items[idx] = { ...items[idx], ...updates, updatedAt: new Date().toISOString() };
    setLocalItems(col, ownerId, items);
  }
}

function deleteLocalItemById<T extends { id: string }>(
  col: string,
  ownerId: string,
  id: string
): void {
  const items = getLocalItems<T>(col, ownerId).filter((item) => item.id !== id);
  setLocalItems(col, ownerId, items);
}

function mergeById<T extends { id: string; updatedAt?: string; createdAt?: string }>(
  cloudItems: T[],
  localItems: T[]
): T[] {
  const map = new Map<string, T>();
  for (const item of localItems) {
    map.set(item.id, item);
  }
  for (const item of cloudItems) {
    map.set(item.id, item);
  }
  return Array.from(map.values()).sort((a, b) =>
    (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')
  );
}

/**
 * Safely migrates guest-created records across all workspace collections to an
 * authenticated user account.
 */
export async function migrateGuestWorkspaceData(
  guestUid: string,
  targetUid: string
): Promise<MigrationResult> {
  return migrateGuestToAuthenticatedAccount({
    guestUid,
    targetUid,
    storage: localStorage,
    persistTargetRecord: async (col: WorkspaceCollectionName, record: OwnedWorkspaceRecord) => {
      if (canSyncWithCloudFirestore(targetUid)) {
        const docRef = doc(db, col, record.id);
        await setDoc(docRef, record);
      }
    },
  });
}

// ---------------------------------------------
// CODE PROJECTS
// ---------------------------------------------
export interface CodeProjectRecord {
  id: string;
  ownerId: string;
  name: string;
  language: string;
  framework: string;
  database: string;
  description: string;
  requirements: string;
  architectureOverview?: string;
  runInstructions?: string;
  files: Array<{ path: string; content: string; language: string }>;
  versions?: Array<{
    id: string;
    timestamp: string;
    note: string;
    files: Array<{ path: string; content: string; language: string }>;
  }>;
  createdAt: string;
  updatedAt: string;
}

function clampCodeProject(project: CodeProjectRecord): CodeProjectRecord {
  return {
    ...project,
    name: String(project.name || 'Untitled Project').slice(0, 128),
    language: String(project.language || 'TypeScript').slice(0, 64),
    framework: String(project.framework || 'Standard / None').slice(0, 64),
    database: String(project.database || 'None').slice(0, 64),
    description: String(project.description || '').slice(0, 4096),
    requirements: String(project.requirements || '').slice(0, 8192),
    architectureOverview: project.architectureOverview
      ? String(project.architectureOverview).slice(0, 8192)
      : undefined,
    runInstructions: project.runInstructions
      ? String(project.runInstructions).slice(0, 4096)
      : undefined,
    files: Array.isArray(project.files) ? project.files.slice(0, 100) : [],
    versions: Array.isArray(project.versions) ? project.versions.slice(-50) : undefined,
  };
}

export async function saveCodeProject(project: CodeProjectRecord): Promise<void> {
  const colPath = 'codeProjects';
  const normalized = clampCodeProject(project);
  upsertLocalItem(colPath, normalized.ownerId, normalized);
  if (!canSyncWithCloudFirestore(normalized.ownerId)) {
    return;
  }
  try {
    const docRef = doc(db, colPath, normalized.id);
    await setDoc(docRef, normalized);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `${colPath}/${normalized.id}`);
  }
}

export async function getCodeProjects(ownerId: string): Promise<CodeProjectRecord[]> {
  const colPath = 'codeProjects';
  const localItems = getLocalItems<CodeProjectRecord>(colPath, ownerId);
  if (!canSyncWithCloudFirestore(ownerId)) {
    return localItems;
  }
  try {
    const q = query(collection(db, colPath), where('ownerId', '==', ownerId));
    const snapshot = await getDocs(q);
    const results: CodeProjectRecord[] = [];
    snapshot.forEach((d) => results.push(d.data() as CodeProjectRecord));
    return mergeById(results, localItems);
  } catch (err) {
    if (isFirestoreOfflineError(err)) {
      console.warn('Cloud Firestore unavailable; using owner-scoped local cache for codeProjects.');
      return localItems;
    }
    handleFirestoreError(err, OperationType.LIST, colPath);
  }
}

export async function updateCodeProject(
  projectId: string,
  updates: Partial<CodeProjectRecord>
): Promise<void> {
  const colPath = 'codeProjects';
  const ownerId = auth.currentUser?.uid || 'guest_engineer_demo';
  const safeUpdates: Partial<CodeProjectRecord> = { ...updates };
  if (typeof safeUpdates.name === 'string') safeUpdates.name = safeUpdates.name.slice(0, 128);
  if (typeof safeUpdates.description === 'string') {
    safeUpdates.description = safeUpdates.description.slice(0, 4096);
  }
  if (typeof safeUpdates.requirements === 'string') {
    safeUpdates.requirements = safeUpdates.requirements.slice(0, 8192);
  }
  if (typeof safeUpdates.architectureOverview === 'string') {
    safeUpdates.architectureOverview = safeUpdates.architectureOverview.slice(0, 8192);
  }
  if (typeof safeUpdates.runInstructions === 'string') {
    safeUpdates.runInstructions = safeUpdates.runInstructions.slice(0, 4096);
  }
  if (Array.isArray(safeUpdates.files)) safeUpdates.files = safeUpdates.files.slice(0, 100);
  if (Array.isArray(safeUpdates.versions)) safeUpdates.versions = safeUpdates.versions.slice(-50);
  delete safeUpdates.createdAt;

  updateLocalItemById<CodeProjectRecord>(colPath, ownerId, projectId, safeUpdates);
  if (!canSyncWithCloudFirestore(ownerId)) {
    return;
  }
  const path = `codeProjects/${projectId}`;
  try {
    const docRef = doc(db, 'codeProjects', projectId);
    await updateDoc(docRef, {
      ...safeUpdates,
      updatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    if (isFirestoreOfflineError(err)) {
      return;
    }
    if (err?.code === 'not-found') {
      const localMatch = getLocalItems<CodeProjectRecord>(colPath, ownerId).find(
        (p) => p.id === projectId
      );
      if (localMatch) {
        await setDoc(doc(db, 'codeProjects', projectId), clampCodeProject(localMatch));
        return;
      }
    }
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteCodeProject(projectId: string): Promise<void> {
  const colPath = 'codeProjects';
  const ownerId = auth.currentUser?.uid || 'guest_engineer_demo';
  deleteLocalItemById<CodeProjectRecord>(colPath, ownerId, projectId);
  if (!canSyncWithCloudFirestore(ownerId)) {
    return;
  }
  const path = `codeProjects/${projectId}`;
  try {
    const docRef = doc(db, 'codeProjects', projectId);
    await deleteDoc(docRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// ---------------------------------------------
// WEBSITE PROJECTS
// ---------------------------------------------
export interface WebsiteProjectRecord {
  id: string;
  ownerId: string;
  name: string;
  category: string;
  technology: string;
  designDirection: string;
  description: string;
  requirements: string;
  summary?: string;
  fileManifest: Array<{ path: string; content: string; type: string }>;
  isPublished?: boolean;
  publishedAt?: string;
  publishedUrl?: string;
  publishedManifest?: Array<{ path: string; content: string; type: string }>;
  snapshotVersion?: number;
  isPublic?: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function saveWebsiteProject(project: WebsiteProjectRecord): Promise<void> {
  const colPath = 'websiteProjects';
  upsertLocalItem(colPath, project.ownerId, project);
  if (!canSyncWithCloudFirestore(project.ownerId)) {
    return;
  }
  try {
    const docRef = doc(db, colPath, project.id);
    await setDoc(docRef, project);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `${colPath}/${project.id}`);
  }
}

export async function getWebsiteProjects(ownerId: string): Promise<WebsiteProjectRecord[]> {
  const colPath = 'websiteProjects';
  const localItems = getLocalItems<WebsiteProjectRecord>(colPath, ownerId);
  if (!canSyncWithCloudFirestore(ownerId)) {
    return localItems;
  }
  try {
    const q = query(collection(db, colPath), where('ownerId', '==', ownerId));
    const snapshot = await getDocs(q);
    const results: WebsiteProjectRecord[] = [];
    snapshot.forEach((d) => results.push(d.data() as WebsiteProjectRecord));
    return mergeById(results, localItems);
  } catch (err) {
    if (isFirestoreOfflineError(err)) {
      console.warn('Cloud Firestore unavailable; using owner-scoped local cache for websiteProjects.');
      return localItems;
    }
    handleFirestoreError(err, OperationType.LIST, colPath);
  }
}

export async function updateWebsiteProject(
  projectId: string,
  updates: Partial<WebsiteProjectRecord>,
  explicitOwnerId?: string
): Promise<void> {
  const colPath = 'websiteProjects';
  const ownerId = explicitOwnerId || auth.currentUser?.uid || 'guest_engineer_demo';
  updateLocalItemById<WebsiteProjectRecord>(colPath, ownerId, projectId, updates);
  if (!canSyncWithCloudFirestore(ownerId)) {
    return;
  }
  const path = `websiteProjects/${projectId}`;
  try {
    const docRef = doc(db, 'websiteProjects', projectId);
    const localMatch = getLocalItems<WebsiteProjectRecord>(colPath, ownerId).find(
      (p) => p.id === projectId
    );
    await setDoc(
      docRef,
      {
        ...(localMatch || {}),
        ...updates,
        id: projectId,
        ownerId,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (err) {
    if (isFirestoreOfflineError(err)) {
      return;
    }
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteWebsiteProject(
  projectId: string,
  explicitOwnerId?: string
): Promise<void> {
  const colPath = 'websiteProjects';
  const ownerId = explicitOwnerId || auth.currentUser?.uid || 'guest_engineer_demo';
  deleteLocalItemById<WebsiteProjectRecord>(colPath, ownerId, projectId);
  if (!canSyncWithCloudFirestore(ownerId)) {
    return;
  }
  const path = `websiteProjects/${projectId}`;
  try {
    const docRef = doc(db, 'websiteProjects', projectId);
    await deleteDoc(docRef);
    // Clean up associated published snapshot if one exists
    try {
      await deleteDoc(doc(db, 'publishedWebsites', projectId));
    } catch {
      // Ignore if not published or rules restrict deletion
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// ---------------------------------------------
// PUBLISHED WEBSITES (DURABLE SNAPSHOTS)
// ---------------------------------------------
export interface PublishedFirestoreSaveResult {
  firestoreSaved: boolean;
  pendingRulesDeployment?: boolean;
  error?: string;
}

function isFirestorePermissionError(error: unknown): boolean {
  const code = (error as any)?.code || '';
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return code === 'permission-denied' || msg.includes('missing or insufficient permissions');
}

export async function savePublishedWebsiteToFirestore(
  snapshot: PublishedWebsiteSnapshot
): Promise<PublishedFirestoreSaveResult> {
  if (!canSyncWithCloudFirestore(snapshot.ownerId)) {
    return {
      firestoreSaved: false,
      error: 'Authentication required to persist published website snapshots to Cloud Firestore.',
    };
  }
  if (new TextEncoder().encode(snapshot.compiledHtml || '').length > 850_000) {
    return {
      firestoreSaved: false,
      error:
        'Compiled website bundle exceeds the 850 KB Firestore document safety limit. Reduce embedded assets or files and retry.',
    };
  }
  const colPath = 'publishedWebsites';
  const docPath = `${colPath}/${snapshot.projectId}`;
  try {
    const docRef = doc(db, colPath, snapshot.projectId);
    await setDoc(docRef, {
      ...snapshot,
      updatedAt: snapshot.publishedAt,
    });
    // Verify write succeeded directly against Cloud Firestore server
    let verified;
    try {
      verified = await getDocFromServer(docRef);
    } catch {
      verified = await getDoc(docRef);
    }
    if (!verified.exists()) {
      return {
        firestoreSaved: false,
        error: 'Firestore write succeeded but read-back verification returned empty document.',
      };
    }
    return { firestoreSaved: true };
  } catch (err: any) {
    if (isFirestorePermissionError(err)) {
      return {
        firestoreSaved: false,
        pendingRulesDeployment: true,
        error:
          'Cloud Firestore publishedWebsites rule is not yet deployed; snapshot saved to persistent server store.',
      };
    }
    if (isFirestoreOfflineError(err)) {
      return {
        firestoreSaved: false,
        error: 'Cloud Firestore backend is temporarily unreachable.',
      };
    }
    handleFirestoreError(err, OperationType.WRITE, docPath);
  }
}

export async function getPublishedWebsiteFromFirestore(projectId: string): Promise<{
  snapshot: PublishedWebsiteSnapshot | null;
  permissionDenied?: boolean;
}> {
  if (!projectId || !projectId.trim()) {
    return { snapshot: null };
  }
  try {
    const docRef = doc(db, 'publishedWebsites', projectId);
    let snap;
    try {
      snap = await getDocFromServer(docRef);
    } catch (serverErr) {
      if (isFirestorePermissionError(serverErr)) {
        return { snapshot: null, permissionDenied: true };
      }
      snap = await getDoc(docRef);
    }
    if (!snap.exists()) {
      return { snapshot: null };
    }
    return { snapshot: snap.data() as PublishedWebsiteSnapshot };
  } catch (err) {
    if (isFirestorePermissionError(err)) {
      return { snapshot: null, permissionDenied: true };
    }
    return { snapshot: null };
  }
}

// ---------------------------------------------
// USER PREFERENCES (GUIDED TOUR PERSISTENCE)
// ---------------------------------------------
export interface UserWorkspacePreferences {
  tourCompleted: boolean;
  tourSkipped: boolean;
  tourUpdatedAt?: string;
}

export async function getUserPreferences(uid: string): Promise<UserWorkspacePreferences> {
  const defaultPrefs: UserWorkspacePreferences = {
    tourCompleted: false,
    tourSkipped: false,
  };
  if (!uid) return defaultPrefs;

  let localPrefs = defaultPrefs;
  try {
    const raw = localStorage.getItem(`ws_prefs_${uid}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      localPrefs = {
        tourCompleted: Boolean(parsed?.tourCompleted),
        tourSkipped: Boolean(parsed?.tourSkipped),
        tourUpdatedAt: parsed?.tourUpdatedAt,
      };
    }
  } catch {
    // Ignore localStorage parse errors
  }

  if (!canSyncWithCloudFirestore(uid)) {
    return localPrefs;
  }

  try {
    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const data = snap.data();
      const merged: UserWorkspacePreferences = {
        tourCompleted: Boolean(data?.tourCompleted) || localPrefs.tourCompleted,
        tourSkipped: Boolean(data?.tourSkipped) || localPrefs.tourSkipped,
        tourUpdatedAt: data?.tourUpdatedAt || localPrefs.tourUpdatedAt,
      };
      try {
        localStorage.setItem(`ws_prefs_${uid}`, JSON.stringify(merged));
      } catch {
        // Ignore
      }
      return merged;
    }
  } catch {
    // Return localPrefs on offline/transient read issue
  }
  return localPrefs;
}

export async function saveUserPreferences(
  uid: string,
  prefs: Partial<UserWorkspacePreferences>
): Promise<void> {
  if (!uid) return;
  const current = await getUserPreferences(uid).catch(() => ({
    tourCompleted: false,
    tourSkipped: false,
  }));
  const next: UserWorkspacePreferences = {
    tourCompleted: prefs.tourCompleted ?? current.tourCompleted,
    tourSkipped: prefs.tourSkipped ?? current.tourSkipped,
    tourUpdatedAt: new Date().toISOString(),
  };

  try {
    localStorage.setItem(`ws_prefs_${uid}`, JSON.stringify(next));
  } catch {
    // Ignore
  }

  if (!canSyncWithCloudFirestore(uid)) {
    return;
  }

  try {
    const userRef = doc(db, 'users', uid);
    await setDoc(
      userRef,
      {
        uid,
        email: auth.currentUser?.email || '',
        tourCompleted: next.tourCompleted,
        tourSkipped: next.tourSkipped,
        tourUpdatedAt: next.tourUpdatedAt,
        updatedAt: next.tourUpdatedAt,
      },
      { merge: true }
    );
  } catch (err) {
    console.warn('Could not sync user tour preferences to Firestore:', err);
  }
}

// ---------------------------------------------
// DOCUMENTS
// ---------------------------------------------
export interface DocumentRecord {
  id: string;
  ownerId: string;
  title: string;
  subtitle?: string;
  category: string;
  tone: string;
  length: string;
  sections: any[];
  content: string;
  createdAt: string;
  updatedAt: string;
}

function clampDocument(docItem: DocumentRecord): DocumentRecord {
  return {
    ...docItem,
    title: String(docItem.title || 'Untitled Document').slice(0, 256),
    subtitle: docItem.subtitle ? String(docItem.subtitle).slice(0, 512) : undefined,
    category: String(docItem.category || 'Technical').slice(0, 64),
    tone: String(docItem.tone || 'Professional').slice(0, 64),
    length: String(docItem.length || 'Standard').slice(0, 64),
    sections: Array.isArray(docItem.sections) ? docItem.sections.slice(0, 100) : [],
    content: String(docItem.content || '').slice(0, 100000),
  };
}

export async function saveDocument(docItem: DocumentRecord): Promise<void> {
  const colPath = 'documents';
  const normalized = clampDocument(docItem);
  upsertLocalItem(colPath, normalized.ownerId, normalized);
  if (!canSyncWithCloudFirestore(normalized.ownerId)) {
    return;
  }
  try {
    const docRef = doc(db, colPath, normalized.id);
    await setDoc(docRef, normalized);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `${colPath}/${normalized.id}`);
  }
}

export async function getDocuments(ownerId: string): Promise<DocumentRecord[]> {
  const colPath = 'documents';
  const localItems = getLocalItems<DocumentRecord>(colPath, ownerId);
  if (!canSyncWithCloudFirestore(ownerId)) {
    return localItems;
  }
  try {
    const q = query(collection(db, colPath), where('ownerId', '==', ownerId));
    const snapshot = await getDocs(q);
    const results: DocumentRecord[] = [];
    snapshot.forEach((d) => results.push(d.data() as DocumentRecord));
    return mergeById(results, localItems);
  } catch (err) {
    if (isFirestoreOfflineError(err)) {
      console.warn('Cloud Firestore unavailable; using owner-scoped local cache for documents.');
      return localItems;
    }
    handleFirestoreError(err, OperationType.LIST, colPath);
  }
}

export async function updateDocument(
  docId: string,
  updates: Partial<DocumentRecord>
): Promise<void> {
  const colPath = 'documents';
  const ownerId = auth.currentUser?.uid || 'guest_engineer_demo';
  const safeUpdates: Partial<DocumentRecord> = { ...updates };
  if (typeof safeUpdates.title === 'string') safeUpdates.title = safeUpdates.title.slice(0, 256);
  if (typeof safeUpdates.subtitle === 'string') {
    safeUpdates.subtitle = safeUpdates.subtitle.slice(0, 512);
  }
  if (typeof safeUpdates.content === 'string') {
    safeUpdates.content = safeUpdates.content.slice(0, 100000);
  }
  if (Array.isArray(safeUpdates.sections)) safeUpdates.sections = safeUpdates.sections.slice(0, 100);
  delete safeUpdates.createdAt;

  updateLocalItemById<DocumentRecord>(colPath, ownerId, docId, safeUpdates);
  if (!canSyncWithCloudFirestore(ownerId)) {
    return;
  }
  const path = `documents/${docId}`;
  try {
    const docRef = doc(db, 'documents', docId);
    await updateDoc(docRef, {
      ...safeUpdates,
      updatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    if (isFirestoreOfflineError(err)) {
      return;
    }
    if (err?.code === 'not-found') {
      const localMatch = getLocalItems<DocumentRecord>(colPath, ownerId).find(
        (d) => d.id === docId
      );
      if (localMatch) {
        await setDoc(doc(db, 'documents', docId), clampDocument(localMatch));
        return;
      }
    }
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteDocument(docId: string): Promise<void> {
  const colPath = 'documents';
  const ownerId = auth.currentUser?.uid || 'guest_engineer_demo';
  deleteLocalItemById<DocumentRecord>(colPath, ownerId, docId);
  if (!canSyncWithCloudFirestore(ownerId)) {
    return;
  }
  const path = `documents/${docId}`;
  try {
    const docRef = doc(db, 'documents', docId);
    await deleteDoc(docRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// ---------------------------------------------
// DATASETS
// ---------------------------------------------
export interface DatasetRecord {
  id: string;
  ownerId: string;
  filename: string;
  format: 'csv' | 'xlsx';
  rowCount: number;
  columnCount: number;
  columns: string[];
  previewData: Record<string, any>[];
  metadata?: Record<string, any>;
  cleanedVersionsCount?: number;
  createdAt: string;
  updatedAt: string;
}

function clampDataset(dataset: DatasetRecord): DatasetRecord {
  return {
    ...dataset,
    filename: String(dataset.filename || 'dataset.csv').slice(0, 256),
    format: dataset.format === 'xlsx' ? 'xlsx' : 'csv',
    rowCount: Math.max(0, Math.floor(Number(dataset.rowCount) || 0)),
    columnCount: Math.max(0, Math.floor(Number(dataset.columnCount) || 0)),
    columns: Array.isArray(dataset.columns) ? dataset.columns.slice(0, 200) : [],
    previewData: Array.isArray(dataset.previewData) ? dataset.previewData.slice(0, 100) : [],
    ...(typeof dataset.cleanedVersionsCount === 'number'
      ? { cleanedVersionsCount: Math.max(0, Math.floor(dataset.cleanedVersionsCount)) }
      : {}),
  };
}

export async function saveDataset(dataset: DatasetRecord): Promise<void> {
  const colPath = 'datasets';
  const normalized = clampDataset(dataset);
  upsertLocalItem(colPath, normalized.ownerId, normalized);
  if (!canSyncWithCloudFirestore(normalized.ownerId)) {
    return;
  }
  try {
    const docRef = doc(db, colPath, normalized.id);
    await setDoc(docRef, normalized, { merge: true });
  } catch (err) {
    if (isFirestoreOfflineError(err)) {
      return;
    }
    handleFirestoreError(err, OperationType.WRITE, `${colPath}/${normalized.id}`);
  }
}

export async function getDatasets(ownerId: string): Promise<DatasetRecord[]> {
  const colPath = 'datasets';
  const localItems = getLocalItems<DatasetRecord>(colPath, ownerId);
  if (!canSyncWithCloudFirestore(ownerId)) {
    return localItems;
  }
  try {
    const q = query(collection(db, colPath), where('ownerId', '==', ownerId));
    const snapshot = await getDocs(q);
    const results: DatasetRecord[] = [];
    snapshot.forEach((d) => results.push(d.data() as DatasetRecord));
    return mergeById(results, localItems);
  } catch (err) {
    if (isFirestoreOfflineError(err)) {
      console.warn('Cloud Firestore unavailable; using owner-scoped local cache for datasets.');
      return localItems;
    }
    handleFirestoreError(err, OperationType.LIST, colPath);
  }
}

export async function updateDataset(
  datasetId: string,
  updates: Partial<DatasetRecord>
): Promise<void> {
  const colPath = 'datasets';
  const ownerId = auth.currentUser?.uid || 'guest_engineer_demo';
  const safeUpdates: Partial<DatasetRecord> = { ...updates };
  if (typeof safeUpdates.filename === 'string') {
    safeUpdates.filename = safeUpdates.filename.slice(0, 256);
  }
  if (Array.isArray(safeUpdates.columns)) safeUpdates.columns = safeUpdates.columns.slice(0, 200);
  if (Array.isArray(safeUpdates.previewData)) {
    safeUpdates.previewData = safeUpdates.previewData.slice(0, 100);
  }
  delete safeUpdates.createdAt;

  updateLocalItemById<DatasetRecord>(colPath, ownerId, datasetId, safeUpdates);
  if (!canSyncWithCloudFirestore(ownerId)) {
    return;
  }
  const path = `datasets/${datasetId}`;
  try {
    const docRef = doc(db, 'datasets', datasetId);
    await updateDoc(docRef, {
      ...safeUpdates,
      updatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    if (isFirestoreOfflineError(err)) {
      return;
    }
    if (err?.code === 'not-found') {
      const localMatch = getLocalItems<DatasetRecord>(colPath, ownerId).find(
        (d) => d.id === datasetId
      );
      if (localMatch) {
        await setDoc(doc(db, 'datasets', datasetId), clampDataset(localMatch));
        return;
      }
    }
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteDataset(datasetId: string): Promise<void> {
  const colPath = 'datasets';
  const ownerId = auth.currentUser?.uid || 'guest_engineer_demo';
  deleteLocalItemById<DatasetRecord>(colPath, ownerId, datasetId);
  if (!canSyncWithCloudFirestore(ownerId)) {
    return;
  }
  const path = `datasets/${datasetId}`;
  try {
    const docRef = doc(db, 'datasets', datasetId);
    await deleteDoc(docRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// ---------------------------------------------
// CLEANING JOBS (DATA CLEANER PIPELINE HISTORY)
// ---------------------------------------------
export interface CleaningJobRecord {
  id: string;
  ownerId: string;
  datasetId: string;
  operations: Array<{
    id: string;
    type: string;
    params: Record<string, any>;
    description: string;
  }>;
  stats: {
    originalRows: number;
    cleanedRows: number;
    rowsRemoved: number;
    duplicatesRemoved: number;
    missingValuesHandled: number;
    columnsModified: number;
  };
  createdAt: string;
  updatedAt: string;
}

export function buildFirestoreCleaningJobPayload(job: CleaningJobRecord): CleaningJobRecord {
  return {
    id: String(job.id).slice(0, 128),
    ownerId: String(job.ownerId).slice(0, 128),
    datasetId: String(job.datasetId).slice(0, 128),
    operations: Array.isArray(job.operations) ? job.operations.slice(0, 50) : [],
    stats: {
      originalRows: Math.max(0, Math.floor(Number(job.stats?.originalRows) || 0)),
      cleanedRows: Math.max(0, Math.floor(Number(job.stats?.cleanedRows) || 0)),
      rowsRemoved: Math.max(0, Math.floor(Number(job.stats?.rowsRemoved) || 0)),
      duplicatesRemoved: Math.max(0, Math.floor(Number(job.stats?.duplicatesRemoved) || 0)),
      missingValuesHandled: Math.max(0, Math.floor(Number(job.stats?.missingValuesHandled) || 0)),
      columnsModified: Math.max(0, Math.floor(Number(job.stats?.columnsModified) || 0)),
    },
    createdAt: String(job.createdAt || new Date().toISOString()).slice(0, 64),
    updatedAt: String(job.updatedAt || new Date().toISOString()).slice(0, 64),
  };
}

export async function saveCleaningJob(job: CleaningJobRecord): Promise<void> {
  const colPath = 'cleaningJobs';
  const payload = buildFirestoreCleaningJobPayload(job);
  upsertLocalItem(colPath, payload.ownerId, payload);
  if (!canSyncWithCloudFirestore(payload.ownerId)) {
    return;
  }
  try {
    const docRef = doc(db, colPath, payload.id);
    await setDoc(docRef, payload);
  } catch (err) {
    if (isFirestoreOfflineError(err)) {
      return;
    }
    handleFirestoreError(err, OperationType.WRITE, `${colPath}/${payload.id}`);
  }
}

export async function getCleaningJobs(ownerId: string): Promise<CleaningJobRecord[]> {
  const colPath = 'cleaningJobs';
  const localItems = getLocalItems<CleaningJobRecord>(colPath, ownerId);
  if (!canSyncWithCloudFirestore(ownerId)) {
    return localItems;
  }
  try {
    const q = query(collection(db, colPath), where('ownerId', '==', ownerId));
    const snapshot = await getDocs(q);
    const results: CleaningJobRecord[] = [];
    snapshot.forEach((d) => results.push(d.data() as CleaningJobRecord));
    return mergeById(results, localItems);
  } catch (err) {
    if (isFirestoreOfflineError(err)) {
      return localItems;
    }
    handleFirestoreError(err, OperationType.LIST, colPath);
  }
}

// ---------------------------------------------
// ACTIVITY LOGS
// ---------------------------------------------
export interface ActivityLogRecord {
  id: string;
  ownerId: string;
  activityType: 'code' | 'website' | 'document' | 'dataset' | 'auth' | 'settings';
  description: string;
  targetId?: string;
  targetType?: string;
  createdAt: string;
}

export async function logActivity(
  ownerId: string,
  activityType: ActivityLogRecord['activityType'],
  description: string,
  targetId?: string,
  targetType?: string
): Promise<void> {
  const colPath = 'activityLogs';
  const id = `act_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const record: ActivityLogRecord = {
    id,
    ownerId,
    activityType,
    description: String(description || '').slice(0, 1024),
    targetId: String(targetId || '').slice(0, 128),
    targetType: String(targetType || '').slice(0, 64),
    createdAt: new Date().toISOString(),
  };

  const items = getLocalItems<ActivityLogRecord>(colPath, ownerId);
  items.unshift(record);
  setLocalItems(colPath, ownerId, items.slice(0, 50));

  if (!canSyncWithCloudFirestore(ownerId)) {
    return;
  }

  try {
    const docRef = doc(db, colPath, id);
    await setDoc(docRef, record);
  } catch (err) {
    console.warn('Could not record activity log to Firestore:', err);
  }
}

export async function getActivityLogs(ownerId: string, maxLimit = 20): Promise<ActivityLogRecord[]> {
  const colPath = 'activityLogs';
  const localItems = getLocalItems<ActivityLogRecord>(colPath, ownerId);
  if (!canSyncWithCloudFirestore(ownerId)) {
    return localItems.slice(0, maxLimit);
  }
  try {
    const q = query(
      collection(db, colPath),
      where('ownerId', '==', ownerId),
      limit(maxLimit)
    );
    const snapshot = await getDocs(q);
    const results: ActivityLogRecord[] = [];
    snapshot.forEach((d) => results.push(d.data() as ActivityLogRecord));
    return mergeById(results, localItems).slice(0, maxLimit);
  } catch (err) {
    if (isFirestoreOfflineError(err)) {
      console.warn('Cloud Firestore unavailable; using owner-scoped local cache for activityLogs.');
      return localItems.slice(0, maxLimit);
    }
    handleFirestoreError(err, OperationType.LIST, colPath);
  }
}
