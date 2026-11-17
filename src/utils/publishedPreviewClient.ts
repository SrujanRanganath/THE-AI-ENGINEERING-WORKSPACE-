import { compileWebsitePreview } from './reactPreviewCompiler';
import {
  buildPublishedPreviewUrl,
  getPublishedWebsiteSnapshot,
  PublishedWebsiteSnapshot,
  savePublishedWebsiteSnapshot,
  StorageLike,
} from './publishPreview';

export interface PublishedLookupDeps {
  projectId: string;
  viewerOwnerId?: string | null;
  origin?: string;
  fetchServerSnapshot: (
    projectId: string,
    viewerOwnerId?: string
  ) => Promise<{
    status: number;
    snapshot?: PublishedWebsiteSnapshot | null;
    error?: string;
  }>;
  fetchFirestoreSnapshot: (projectId: string) => Promise<{
    snapshot: PublishedWebsiteSnapshot | null;
    permissionDenied?: boolean;
  }>;
  fetchOwnerWebsiteProjects: (ownerId: string) => Promise<
    Array<{
      id: string;
      ownerId: string;
      name: string;
      category: string;
      technology: string;
      designDirection: string;
      description: string;
      summary?: string;
      fileManifest: Array<{ path: string; content: string; type: string }>;
      isPublished?: boolean;
      publishedAt?: string;
      publishedManifest?: Array<{ path: string; content: string; type: string }>;
      snapshotVersion?: number;
      isPublic?: boolean;
      updatedAt: string;
    }>
  >;
  localCacheStorage?: StorageLike | null;
}

export type PublishedLookupOutcome =
  | {
      status: 'found';
      source: 'server' | 'firestore' | 'owner_project' | 'local_cache';
      snapshot: PublishedWebsiteSnapshot;
    }
  | {
      status: 'forbidden';
      requiresSignIn: boolean;
      error: string;
    }
  | {
      status: 'not_found' | 'compile_error';
      error: string;
    };

/**
 * Resolves a published website snapshot across durable backend store, Cloud Firestore,
 * authenticated owner projects, and browser-local cache without failing prematurely
 * when opening a share URL in a new browser tab or incognito session.
 */
export async function resolvePublishedPreviewSnapshot(
  deps: PublishedLookupDeps
): Promise<PublishedLookupOutcome> {
  const projectId = String(deps.projectId || '').trim();
  const viewerOwnerId = deps.viewerOwnerId ? String(deps.viewerOwnerId).trim() : '';

  if (!projectId) {
    return {
      status: 'not_found',
      error: 'Missing project identifier in URL.',
    };
  }

  // 1. Authoritative Server Durable Store (survives new tabs, incognito, refreshes & restarts)
  let serverForbiddenError: string | null = null;
  try {
    const serverRes = await deps.fetchServerSnapshot(projectId, viewerOwnerId || undefined);
    if (serverRes.status === 200 && serverRes.snapshot && serverRes.snapshot.compiledHtml) {
      const normalized: PublishedWebsiteSnapshot = {
        ...serverRes.snapshot,
        publishedUrl: buildPublishedPreviewUrl(projectId, deps.origin),
      };
      if (viewerOwnerId && normalized.ownerId === viewerOwnerId) {
        savePublishedWebsiteSnapshot(normalized, deps.localCacheStorage);
      }
      return {
        status: 'found',
        source: 'server',
        snapshot: normalized,
      };
    }
    if (serverRes.status === 403) {
      serverForbiddenError =
        serverRes.error ||
        'This published preview is set to Owner Only. Sign in with the owner account to view it.';
    }
  } catch {
    // Fall through to Cloud Firestore & owner lookup
  }

  if (serverForbiddenError && !viewerOwnerId) {
    return {
      status: 'forbidden',
      requiresSignIn: true,
      error: serverForbiddenError,
    };
  }

  // 2. Cloud Firestore `publishedWebsites/{projectId}` (cross-instance persistence)
  let firestorePermissionDenied = false;
  try {
    const fsRes = await deps.fetchFirestoreSnapshot(projectId);
    if (fsRes.snapshot && fsRes.snapshot.compiledHtml) {
      const fsSnap = fsRes.snapshot;
      const isAllowed =
        fsSnap.isPublic !== false || (viewerOwnerId && fsSnap.ownerId === viewerOwnerId);
      if (!isAllowed) {
        return {
          status: 'forbidden',
          requiresSignIn: !viewerOwnerId,
          error:
            'This published preview is restricted to its owner. Please sign in with the owning account.',
        };
      }
      const normalized: PublishedWebsiteSnapshot = {
        ...fsSnap,
        publishedUrl: buildPublishedPreviewUrl(projectId, deps.origin),
      };
      if (viewerOwnerId && normalized.ownerId === viewerOwnerId) {
        savePublishedWebsiteSnapshot(normalized, deps.localCacheStorage);
      }
      return {
        status: 'found',
        source: 'firestore',
        snapshot: normalized,
      };
    }
    if (fsRes.permissionDenied) {
      firestorePermissionDenied = true;
    }
  } catch {
    // Continue to owner fallback
  }

  if (serverForbiddenError) {
    return {
      status: 'forbidden',
      requiresSignIn: !viewerOwnerId,
      error: serverForbiddenError,
    };
  }

  // 3. Authenticated / Active Owner Cache & WebsiteProject Reconstruction
  const lookupOwnerId = viewerOwnerId || 'guest_engineer_demo';
  const localCached = getPublishedWebsiteSnapshot(
    projectId,
    lookupOwnerId,
    deps.localCacheStorage
  );
  if (localCached && localCached.compiledHtml) {
    return {
      status: 'found',
      source: 'local_cache',
      snapshot: {
        ...localCached,
        publishedUrl: buildPublishedPreviewUrl(projectId, deps.origin),
      },
    };
  }

  try {
    const projects = await deps.fetchOwnerWebsiteProjects(lookupOwnerId);
    const match = projects.find((p) => p.id === projectId && p.ownerId === lookupOwnerId);
    if (match) {
      const manifestToCompile =
        Array.isArray(match.publishedManifest) && match.publishedManifest.length > 0
          ? match.publishedManifest
          : match.fileManifest;

      const compiled = compileWebsitePreview(
        manifestToCompile,
        match.technology || 'React',
        match.name || 'Published Website',
        `pub_reopen_${projectId}`
      );

      if (!compiled.success || !compiled.compiledHtml) {
        return {
          status: 'compile_error',
          error:
            'This website project has compilation errors and cannot be rendered as a published preview.',
        };
      }

      const reconstructed: PublishedWebsiteSnapshot = {
        projectId: match.id,
        ownerId: match.ownerId,
        name: match.name,
        category: match.category,
        framework: match.technology?.toLowerCase().includes('react')
          ? 'React 19 + Vite'
          : 'Static HTML / CSS / JS',
        technology: match.technology,
        designDirection: match.designDirection,
        description: match.description,
        summary: match.summary || '',
        fileManifest: manifestToCompile,
        entryHtml:
          manifestToCompile.find((f) => f.path.toLowerCase() === 'index.html')?.content || '',
        dependencies: {},
        compiledHtml: compiled.compiledHtml,
        publishedAt: match.publishedAt || match.updatedAt,
        publishedUrl: buildPublishedPreviewUrl(match.id, deps.origin),
        snapshotVersion: match.snapshotVersion || 1,
        isPublic: typeof match.isPublic === 'boolean' ? match.isPublic : true,
      };

      savePublishedWebsiteSnapshot(reconstructed, deps.localCacheStorage);
      return {
        status: 'found',
        source: 'owner_project',
        snapshot: reconstructed,
      };
    }
  } catch {
    // Fall through
  }

  if (firestorePermissionDenied && !viewerOwnerId) {
    return {
      status: 'forbidden',
      requiresSignIn: true,
      error:
        'This published preview requires owner authentication or updated Firestore public read rules.',
    };
  }

  return {
    status: 'not_found',
    error: 'Published preview not found or you do not have access to this website project.',
  };
}
