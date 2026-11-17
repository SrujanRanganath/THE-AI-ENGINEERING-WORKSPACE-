import fs from 'fs';
import path from 'path';
import {
  extractEntryHtml,
  extractWebsiteDependencies,
  PublishedWebsiteSnapshot,
} from '../utils/publishPreview';

const VALID_PROJECT_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
export const MAX_FIRESTORE_COMPILED_HTML_BYTES = 850_000;

export type SnapshotPersistenceMode = 'production_firestore' | 'development';

export interface FirestoreLookupOutcome {
  snapshot: PublishedWebsiteSnapshot | null;
  status: number;
  error?: string;
}

export interface FirestoreRestAdapter {
  getDocument(projectId: string, bearerToken?: string): Promise<FirestoreLookupOutcome>;
  upsertDocument(
    snapshot: PublishedWebsiteSnapshot,
    bearerToken?: string
  ): Promise<{ saved: boolean; status: number; error?: string }>;
}

export interface SnapshotSaveResult {
  success: boolean;
  status: number;
  error?: string;
  snapshot?: PublishedWebsiteSnapshot;
  persistence?: {
    mode: SnapshotPersistenceMode;
    disk: boolean;
    firestoreRest: boolean;
    verifiedReadBack: boolean;
  };
}

export interface SnapshotLookupResult {
  found: boolean;
  status: number;
  error?: string;
  snapshot?: PublishedWebsiteSnapshot;
}

/**
 * Validates and normalizes a snapshot payload before durable storage.
 */
export function normalizePublishedSnapshot(
  raw: Partial<PublishedWebsiteSnapshot> & { projectId?: string }
): PublishedWebsiteSnapshot | null {
  const projectId = String(raw.projectId || '').trim();
  const ownerId = String(raw.ownerId || '').trim();
  const compiledHtml = String(raw.compiledHtml || '');

  if (
    !VALID_PROJECT_ID_RE.test(projectId) ||
    !ownerId ||
    !compiledHtml.trim() ||
    !Array.isArray(raw.fileManifest) ||
    raw.fileManifest.length === 0
  ) {
    return null;
  }

  const manifest = raw.fileManifest.slice(0, 100).map((f) => ({
    path: String(f.path),
    content: String(f.content),
    type: String(f.type || 'source'),
  }));

  const technology = String(raw.technology || 'React').slice(0, 64);
  const framework = (
    String(raw.framework || '').trim() ||
    (technology.toLowerCase().includes('react') ? 'React 19 + Vite' : 'Static HTML / CSS / JS')
  ).slice(0, 64);

  const snapshotVersion =
    typeof raw.snapshotVersion === 'number' && Number.isFinite(raw.snapshotVersion) && raw.snapshotVersion >= 1
      ? Math.floor(raw.snapshotVersion)
      : 1;

  const safeName = (String(raw.name || 'Published Website').trim() || 'Published Website').slice(0, 128);

  return {
    projectId,
    ownerId: ownerId.slice(0, 128),
    name: safeName,
    category: String(raw.category || 'SaaS').slice(0, 64),
    framework,
    technology,
    designDirection: String(raw.designDirection || 'Modern').slice(0, 64),
    description: String(raw.description || '').slice(0, 2048),
    summary: typeof raw.summary === 'string' ? raw.summary.slice(0, 2048) : '',
    fileManifest: manifest,
    entryHtml:
      typeof raw.entryHtml === 'string' && raw.entryHtml.length > 0
        ? raw.entryHtml
        : extractEntryHtml(manifest),
    dependencies:
      raw.dependencies && typeof raw.dependencies === 'object' && !Array.isArray(raw.dependencies)
        ? { ...raw.dependencies }
        : extractWebsiteDependencies(manifest),
    compiledHtml,
    publishedAt: String(raw.publishedAt || new Date().toISOString()),
    publishedUrl: String(raw.publishedUrl || `/published/${encodeURIComponent(projectId)}`).slice(0, 512),
    snapshotVersion,
    isPublic: typeof raw.isPublic === 'boolean' ? raw.isPublic : true,
  };
}

/**
 * Lightweight Firestore REST adapter using `firebase-applet-config.json` (no Admin secrets required).
 * Reads public snapshots without credentials, reads private snapshots with owner Bearer token,
 * and writes exclusively with the authenticated owner's Firebase ID Bearer token (validated by firestore.rules).
 */
export function createFirestoreRestAdapter(config: {
  projectId: string;
  firestoreDatabaseId?: string;
  apiKey?: string;
}): FirestoreRestAdapter {
  const dbId = config.firestoreDatabaseId || '(default)';
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    config.projectId
  )}/databases/${encodeURIComponent(dbId)}/documents/publishedWebsites`;

  return {
    async getDocument(projectId: string, bearerToken?: string): Promise<FirestoreLookupOutcome> {
      if (!VALID_PROJECT_ID_RE.test(projectId)) {
        return { snapshot: null, status: 400, error: 'Invalid published website project ID.' };
      }
      const url = `${baseUrl}/${encodeURIComponent(projectId)}${
        config.apiKey ? `?key=${encodeURIComponent(config.apiKey)}` : ''
      }`;
      const headers: Record<string, string> = {};
      if (bearerToken) {
        headers.Authorization = `Bearer ${bearerToken}`;
      }
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        if (res.status === 401 || res.status === 403) {
          return {
            snapshot: null,
            status: 403,
            error:
              'Cloud Firestore denied read access (preview may be Owner Only or publishedWebsites rules await deployment).',
          };
        }
        if (res.status === 404) {
          return { snapshot: null, status: 404, error: 'Published preview not found.' };
        }
        return {
          snapshot: null,
          status: res.status,
          error: `Firestore REST HTTP ${res.status}: ${text.slice(0, 180)}`,
        };
      }
      const docJson = await res.json();
      const fields = docJson?.fields;
      if (!fields) {
        return { snapshot: null, status: 404, error: 'Published preview document has no fields.' };
      }
      const parsed = fromFirestoreFields(fields);
      const normalized = normalizePublishedSnapshot(parsed);
      if (!normalized) {
        return { snapshot: null, status: 500, error: 'Stored snapshot document is malformed.' };
      }
      return { snapshot: normalized, status: 200 };
    },

    async upsertDocument(snapshot: PublishedWebsiteSnapshot, bearerToken?: string) {
      if (!bearerToken) {
        return {
          saved: false,
          status: 401,
          error: 'Authentication required: missing Firebase ID token for Cloud Firestore write.',
        };
      }
      const url = `${baseUrl}/${encodeURIComponent(snapshot.projectId)}${
        config.apiKey ? `?key=${encodeURIComponent(config.apiKey)}` : ''
      }`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearerToken}`,
        },
        body: JSON.stringify({
          fields: toFirestoreFields(snapshot),
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          saved: false,
          status: res.status,
          error:
            res.status === 403
              ? 'Cloud Firestore permission denied (ensure you own this project and publishedWebsites rules are deployed).'
              : `Firestore REST HTTP ${res.status}: ${text.slice(0, 200)}`,
        };
      }
      return { saved: true, status: 200 };
    },
  };
}

function toFirestoreValue(val: unknown): Record<string, unknown> {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.map((item) => toFirestoreValue(item)),
      },
    };
  }
  if (typeof val === 'object') {
    return {
      mapValue: {
        fields: toFirestoreFields(val as Record<string, unknown>),
      },
    };
  }
  return { stringValue: String(val) };
}

function toFirestoreFields(obj: Record<string, any>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      fields[k] = toFirestoreValue(v);
    }
  }
  return fields;
}

function fromFirestoreValue(v: any): any {
  if (!v || typeof v !== 'object') return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) {
    return Array.isArray(v.arrayValue?.values)
      ? v.arrayValue.values.map((item: any) => fromFirestoreValue(item))
      : [];
  }
  if ('mapValue' in v) {
    return fromFirestoreFields(v.mapValue?.fields || {});
  }
  return undefined;
}

function fromFirestoreFields(fields: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = fromFirestoreValue(v);
  }
  return out;
}

/**
 * Snapshot store supporting:
 * - `'production_firestore'`: Strictly uses Firebase Firestore as durable persistence
 *   (no local JSON file or in-memory persistence across restarts/instances).
 * - `'development'`: Uses Firestore when configured/authorized, with atomic local JSON
 *   fallback strictly for local development & offline test harnesses.
 */
export class PublishedSnapshotStore {
  private readonly mode: SnapshotPersistenceMode;
  private readonly storageFilePath: string;
  private readonly firestoreAdapter?: FirestoreRestAdapter;
  private cache = new Map<string, PublishedWebsiteSnapshot>();

  constructor(options?: {
    persistenceMode?: SnapshotPersistenceMode;
    storageFilePath?: string;
    firestoreAdapter?: FirestoreRestAdapter;
  }) {
    this.mode =
      options?.persistenceMode ||
      (process.env.NODE_ENV === 'production' ? 'production_firestore' : 'development');
    this.storageFilePath =
      options?.storageFilePath ||
      path.resolve(process.cwd(), '.data', 'published-previews.json');
    this.firestoreAdapter = options?.firestoreAdapter;

    if (this.mode === 'development') {
      this.loadFromDisk();
    }
  }

  private loadFromDisk(): void {
    if (this.mode !== 'development') return;
    try {
      if (!fs.existsSync(this.storageFilePath)) return;
      const raw = fs.readFileSync(this.storageFilePath, 'utf-8');
      if (!raw.trim()) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      for (const [projectId, snap] of Object.entries(parsed)) {
        const normalized = normalizePublishedSnapshot({
          ...(snap as any),
          projectId,
        });
        if (normalized) {
          this.cache.set(projectId, normalized);
        }
      }
    } catch (err) {
      console.warn('Could not read development published previews from disk:', err);
    }
  }

  private writeDiskAtomic(nextMap: Map<string, PublishedWebsiteSnapshot>): void {
    if (this.mode !== 'development') return;
    const dir = path.dirname(this.storageFilePath);
    fs.mkdirSync(dir, { recursive: true });
    const serialized: Record<string, PublishedWebsiteSnapshot> = {};
    for (const [k, v] of nextMap.entries()) {
      serialized[k] = v;
    }
    const payload = JSON.stringify(serialized, null, 2);
    const tmpPath = `${this.storageFilePath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmpPath, payload, 'utf-8');
    fs.renameSync(tmpPath, this.storageFilePath);

    const verifyRaw = fs.readFileSync(this.storageFilePath, 'utf-8');
    JSON.parse(verifyRaw);
  }

  async saveSnapshot(
    rawInput: Partial<PublishedWebsiteSnapshot> & { projectId: string },
    options?: { bearerToken?: string; callerOwnerId?: string }
  ): Promise<SnapshotSaveResult> {
    const projectId = String(rawInput?.projectId || '').trim();
    if (!VALID_PROJECT_ID_RE.test(projectId)) {
      return {
        success: false,
        status: 400,
        error: 'Invalid published website project ID.',
      };
    }

    const normalized = normalizePublishedSnapshot(rawInput);
    if (!normalized) {
      return {
        success: false,
        status: 400,
        error:
          'Invalid published website snapshot payload: projectId, ownerId, compiledHtml, and non-empty fileManifest are required.',
      };
    }

    if (Buffer.byteLength(normalized.compiledHtml, 'utf-8') > MAX_FIRESTORE_COMPILED_HTML_BYTES) {
      return {
        success: false,
        status: 413,
        error:
          'Compiled website bundle exceeds the 850 KB Firestore document safety limit. Reduce embedded assets or files and retry.',
      };
    }

    if (options?.callerOwnerId && options.callerOwnerId !== normalized.ownerId) {
      return {
        success: false,
        status: 403,
        error: 'Access denied: caller identity does not match snapshot ownerId.',
      };
    }

    if (this.mode === 'production_firestore') {
      if (!this.firestoreAdapter) {
        return {
          success: false,
          status: 503,
          error: 'Cloud Firestore adapter is not configured on the production server.',
        };
      }
      if (!options?.bearerToken) {
        return {
          success: false,
          status: 401,
          error:
            'Sign in with an authenticated account to publish persistently to Cloud Firestore.',
        };
      }
    }

    // Look up existing version & owner lock directly from Firestore first (then dev disk cache)
    let existing: PublishedWebsiteSnapshot | null = null;
    if (this.firestoreAdapter) {
      try {
        const lookup = await this.firestoreAdapter.getDocument(projectId, options?.bearerToken);
        if (lookup.snapshot) {
          existing = lookup.snapshot;
        }
      } catch {
        // Proceed cleanly
      }
    }
    if (!existing && this.mode === 'development') {
      existing = this.cache.get(projectId) || null;
    }

    if (existing && existing.ownerId !== normalized.ownerId) {
      return {
        success: false,
        status: 403,
        error: 'Access denied: cannot overwrite a published preview owned by another user.',
      };
    }

    const isIdempotentReplay = Boolean(
      existing &&
        existing.publishedAt === normalized.publishedAt &&
        existing.compiledHtml === normalized.compiledHtml &&
        existing.isPublic === normalized.isPublic
    );

    const nextVersion = isIdempotentReplay
      ? Math.max(normalized.snapshotVersion, existing!.snapshotVersion)
      : Math.max(normalized.snapshotVersion, (existing?.snapshotVersion || 0) + 1);

    const finalSnapshot: PublishedWebsiteSnapshot = {
      ...normalized,
      snapshotVersion: nextVersion,
    };

    // 1. Write to Firebase Firestore when adapter + bearerToken are present
    let firestoreSaved = false;
    let firestoreVerified = false;
    let firestoreError: string | undefined;
    let firestoreStatus = 503;

    if (this.firestoreAdapter && options?.bearerToken) {
      try {
        const res = await this.firestoreAdapter.upsertDocument(
          finalSnapshot,
          options.bearerToken
        );
        firestoreSaved = res.saved;
        firestoreStatus = res.status;
        firestoreError = res.error;

        if (firestoreSaved) {
          const readBack = await this.firestoreAdapter.getDocument(projectId, options.bearerToken);
          firestoreVerified = Boolean(
            readBack.snapshot &&
              readBack.snapshot.snapshotVersion === finalSnapshot.snapshotVersion &&
              readBack.snapshot.compiledHtml === finalSnapshot.compiledHtml
          );
          if (!firestoreVerified) {
            firestoreSaved = false;
            firestoreError =
              'Cloud Firestore write completed but read-back verification failed.';
          }
        }
      } catch (err: any) {
        firestoreSaved = false;
        firestoreError = err?.message || 'Unexpected Cloud Firestore REST failure.';
      }
    }

    // Production mode: MUST succeed in Cloud Firestore; never fall back to local JSON/memory
    if (this.mode === 'production_firestore') {
      if (!firestoreSaved || !firestoreVerified) {
        return {
          success: false,
          status: firestoreStatus >= 400 ? firestoreStatus : 503,
          error:
            firestoreError ||
            'Failed to durably persist published website snapshot to Cloud Firestore.',
        };
      }
      return {
        success: true,
        status: 200,
        snapshot: finalSnapshot,
        persistence: {
          mode: this.mode,
          disk: false,
          firestoreRest: true,
          verifiedReadBack: true,
        },
      };
    }

    // 2. Development-only local disk fallback (never executed in production)
    const nextMap = new Map(this.cache);
    nextMap.set(projectId, finalSnapshot);

    let diskSaved = false;
    try {
      this.writeDiskAtomic(nextMap);
      this.cache = nextMap;
      diskSaved = true;
    } catch (err: any) {
      console.error('Failed to persist development published snapshot to disk:', err);
    }

    if (!diskSaved && !firestoreSaved) {
      return {
        success: false,
        status: 500,
        error: firestoreError || 'Failed to persist published website snapshot.',
      };
    }

    let diskVerified = false;
    if (diskSaved) {
      try {
        const diskJson = JSON.parse(fs.readFileSync(this.storageFilePath, 'utf-8'));
        diskVerified = Boolean(
          diskJson &&
            diskJson[projectId] &&
            diskJson[projectId].snapshotVersion === finalSnapshot.snapshotVersion &&
            diskJson[projectId].compiledHtml === finalSnapshot.compiledHtml
        );
      } catch {
        diskVerified = false;
      }
    }

    return {
      success: true,
      status: 200,
      snapshot: finalSnapshot,
      persistence: {
        mode: this.mode,
        disk: diskSaved,
        firestoreRest: firestoreSaved,
        verifiedReadBack: firestoreVerified || diskVerified,
      },
    };
  }

  async getSnapshot(
    projectId: string,
    options?: { ownerId?: string; verifiedUid?: string | null; bearerToken?: string }
  ): Promise<SnapshotLookupResult> {
    const cleanId = String(projectId || '').trim();
    if (!VALID_PROJECT_ID_RE.test(cleanId)) {
      return {
        found: false,
        status: 400,
        error: 'Invalid published website project ID.',
      };
    }

    let snapshot: PublishedWebsiteSnapshot | null = null;
    let firestoreForbiddenError: string | null = null;

    // Query authoritative Cloud Firestore first so cross-instance updates (e.g., v2) are always fresh
    if (this.firestoreAdapter) {
      try {
        const remote = await this.firestoreAdapter.getDocument(cleanId, options?.bearerToken);
        if (remote.snapshot) {
          snapshot = remote.snapshot;
        } else if (remote.status === 403) {
          firestoreForbiddenError =
            remote.error ||
            'This published preview is set to Owner Only. Sign in with the owner account to view it.';
        }
      } catch {
        // Continue to dev fallback if allowed
      }
    }

    // In production, never serve from local JSON disk or stale memory cache
    if (this.mode === 'production_firestore') {
      if (!snapshot) {
        if (firestoreForbiddenError) {
          return {
            found: false,
            status: 403,
            error: firestoreForbiddenError,
          };
        }
        return {
          found: false,
          status: 404,
          error: 'Published preview not found.',
        };
      }

      // Strictly require verified Firebase UID (or verified bearerToken + ownerId in unit harness)
      const effectiveProdOwner =
        options?.verifiedUid !== undefined
          ? options.verifiedUid || ''
          : options?.bearerToken
          ? options?.ownerId?.trim() || ''
          : '';
      const isOwner = Boolean(effectiveProdOwner && effectiveProdOwner === snapshot.ownerId);
      if (snapshot.isPublic === false && !isOwner) {
        return {
          found: false,
          status: 403,
          error:
            'This published preview is set to Owner Only. Sign in with the owner account to view it.',
        };
      }

      return {
        found: true,
        status: 200,
        snapshot,
      };
    }

    // Development-only cache / disk lookup
    if (!snapshot) {
      snapshot = this.cache.get(cleanId) || null;
      if (!snapshot) {
        this.loadFromDisk();
        snapshot = this.cache.get(cleanId) || null;
      }
    }

    if (!snapshot) {
      if (firestoreForbiddenError) {
        return {
          found: false,
          status: 403,
          error: firestoreForbiddenError,
        };
      }
      return {
        found: false,
        status: 404,
        error: 'Published preview not found.',
      };
    }

    const viewerOwnerId =
      options?.verifiedUid !== undefined
        ? options.verifiedUid ||
          (options.ownerId?.trim() === 'guest_engineer_demo' ? 'guest_engineer_demo' : '')
        : options?.ownerId?.trim() || '';
    const isOwner = Boolean(viewerOwnerId && viewerOwnerId === snapshot.ownerId);

    if (snapshot.isPublic === false && !isOwner) {
      return {
        found: false,
        status: 403,
        error:
          'This published preview is set to Owner Only. Sign in with the owner account to view it.',
      };
    }

    return {
      found: true,
      status: 200,
      snapshot,
    };
  }
}
