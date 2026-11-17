import {
  compileWebsitePreview,
  ManifestFile,
  PreviewCompilationResult,
} from './reactPreviewCompiler';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PublishableProjectInput {
  id: string;
  ownerId: string;
  name: string;
  category: string;
  technology: string;
  framework?: string;
  designDirection: string;
  description: string;
  summary?: string;
  fileManifest: ManifestFile[];
}

export interface PublishedWebsiteSnapshot {
  projectId: string;
  ownerId: string;
  name: string;
  category: string;
  framework: string;
  technology: string;
  designDirection: string;
  description: string;
  summary?: string;
  fileManifest: ManifestFile[];
  entryHtml: string;
  dependencies: Record<string, string>;
  compiledHtml: string;
  publishedAt: string;
  publishedUrl: string;
  snapshotVersion: number;
  isPublic: boolean;
}

export type PublishWebsiteResult =
  | {
      success: true;
      snapshot: PublishedWebsiteSnapshot;
    }
  | {
      success: false;
      code: 'INVALID_PROJECT' | 'COMPILATION_FAILED' | 'RUNTIME_ERROR';
      error: string;
    };

/**
 * Resolves the active application origin dynamically.
 * - When running locally (e.g. `http://localhost:3000` or `http://127.0.0.1:5173`), returns the exact local origin.
 * - When running in a hosted environment (e.g. `https://ais-dev-...run.app`), returns the exact hosted origin.
 * - Never forces localhost URLs on remote users.
 */
export function resolveApplicationOrigin(customOrigin?: string): string {
  const raw =
    typeof customOrigin === 'string' && customOrigin.trim()
      ? customOrigin.trim()
      : typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://localhost:3000';

  return raw.replace(/\/+$/, '');
}

/**
 * Builds the canonical in-application Published Preview route URL (`<origin>/published/<project-id>`).
 */
export function buildPublishedPreviewUrl(projectId: string, customOrigin?: string): string {
  const cleanId = String(projectId || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '');

  if (!cleanId) {
    throw new Error('Cannot build published preview URL without a valid project ID.');
  }

  const origin = resolveApplicationOrigin(customOrigin);
  return `${origin}/published/${encodeURIComponent(cleanId)}`;
}

/**
 * Extracts package.json dependencies cleanly from a project manifest.
 */
export function extractWebsiteDependencies(manifest: ManifestFile[]): Record<string, string> {
  const pkgFile = manifest.find(
    (f) => f.path.replace(/^\/+/, '').toLowerCase() === 'package.json'
  );
  if (!pkgFile) return {};
  try {
    const parsed = JSON.parse(pkgFile.content);
    const deps = parsed?.dependencies;
    if (!deps || typeof deps !== 'object' || Array.isArray(deps)) return {};
    const normalized: Record<string, string> = {};
    for (const [key, val] of Object.entries(deps)) {
      if (typeof key === 'string' && typeof val === 'string') {
        normalized[key] = val;
      }
    }
    return normalized;
  } catch {
    return {};
  }
}

/**
 * Extracts the entry HTML source file from a project manifest.
 */
export function extractEntryHtml(manifest: ManifestFile[]): string {
  const htmlFile =
    manifest.find((f) => f.path.replace(/^\/+/, '').toLowerCase() === 'index.html') ||
    manifest.find((f) => f.path.toLowerCase().endsWith('.html'));
  return htmlFile ? String(htmlFile.content || '') : '';
}

/**
 * Determines whether a Website Generator project is eligible to be published.
 * Enforces that:
 * 1. A project and non-empty file manifest exist.
 * 2. The preview compiler succeeded with zero syntax/import/dependency/manifest errors.
 * 3. Non-empty compiled HTML exists.
 * 4. No runtime execution error occurred in the preview sandbox.
 */
export function canPublishWebsiteProject(
  project:
    | {
        id?: string;
        fileManifest?: ManifestFile[];
      }
    | null
    | undefined,
  compileResult: PreviewCompilationResult | null | undefined,
  runtimeError?: { message: string } | null
): { canPublish: boolean; reason?: string } {
  if (!project || !project.id || !project.id.trim()) {
    return {
      canPublish: false,
      reason: 'No active website project to publish.',
    };
  }

  if (!Array.isArray(project.fileManifest) || project.fileManifest.length === 0) {
    return {
      canPublish: false,
      reason: 'Website project manifest is empty.',
    };
  }

  if (!compileResult) {
    return {
      canPublish: false,
      reason: 'Preview has not finished compiling yet.',
    };
  }

  if (!compileResult.success || compileResult.errors.length > 0) {
    const firstErr = compileResult.errors[0];
    return {
      canPublish: false,
      reason: firstErr
        ? `Cannot publish while compilation errors exist (${firstErr.file}: ${firstErr.message}).`
        : 'Cannot publish a project that failed preview compilation.',
    };
  }

  if (!compileResult.compiledHtml || !compileResult.compiledHtml.trim()) {
    return {
      canPublish: false,
      reason: 'Compiled preview HTML is empty.',
    };
  }

  if (runtimeError) {
    return {
      canPublish: false,
      reason: `Cannot publish while preview has a runtime error: ${runtimeError.message}`,
    };
  }

  return { canPublish: true };
}

/**
 * Validates, compiles, and creates an immutable PublishedWebsiteSnapshot that renders
 * independently of subsequent unsaved editor changes in the generator.
 */
export function createPublishedWebsiteSnapshot(
  project: PublishableProjectInput,
  optionsOrOrigin:
    | string
    | {
        origin?: string;
        runtimeError?: { message: string } | null;
        nowIso?: string;
        snapshotVersion?: number;
        isPublic?: boolean;
      } = {}
): PublishWebsiteResult {
  const options =
    typeof optionsOrOrigin === 'string' ? { origin: optionsOrOrigin } : optionsOrOrigin;

  if (
    !project ||
    !project.id?.trim() ||
    !project.ownerId?.trim() ||
    !Array.isArray(project.fileManifest) ||
    project.fileManifest.length === 0
  ) {
    return {
      success: false,
      code: 'INVALID_PROJECT',
      error: 'Cannot publish an empty or uninitialized website project.',
    };
  }

  if (options.runtimeError) {
    return {
      success: false,
      code: 'RUNTIME_ERROR',
      error: `Cannot publish project with runtime error: ${options.runtimeError.message}`,
    };
  }

  const frozenManifest: ManifestFile[] = project.fileManifest.map((f) => ({
    path: String(f.path),
    content: String(f.content),
    type: String(f.type || 'source'),
  }));

  const previewToken = `pubtok_${project.id}_${Date.now()}`;
  const compiled = compileWebsitePreview(
    frozenManifest,
    project.technology || 'React',
    project.name || 'Published Website',
    previewToken
  );

  const gate = canPublishWebsiteProject(project, compiled, options.runtimeError);
  if (!gate.canPublish) {
    return {
      success: false,
      code: 'COMPILATION_FAILED',
      error: gate.reason || 'Project failed compilation validation and cannot be published.',
    };
  }

  const publishedUrl = buildPublishedPreviewUrl(project.id, options.origin);
  const publishedAt = options.nowIso || new Date().toISOString();
  const technology = project.technology || 'React';
  const framework =
    project.framework ||
    (technology.toLowerCase().includes('react') ? 'React 19 + Vite' : 'Static HTML / CSS / JS');

  const snapshotVersion =
    typeof options.snapshotVersion === 'number' && options.snapshotVersion >= 1
      ? Math.floor(options.snapshotVersion)
      : 1;

  const isPublic = typeof options.isPublic === 'boolean' ? options.isPublic : true;

  return {
    success: true,
    snapshot: {
      projectId: project.id.trim(),
      ownerId: project.ownerId.trim(),
      name: project.name.trim() || 'Published Website',
      category: project.category || 'SaaS',
      framework,
      technology,
      designDirection: project.designDirection || 'Modern',
      description: project.description || '',
      summary: project.summary || '',
      fileManifest: frozenManifest,
      entryHtml: extractEntryHtml(frozenManifest),
      dependencies: extractWebsiteDependencies(frozenManifest),
      compiledHtml: compiled.compiledHtml,
      publishedAt,
      publishedUrl,
      snapshotVersion,
      isPublic,
    },
  };
}

const memoryFallbackMap = new Map<string, string>();
const memoryFallbackStorage: StorageLike = {
  getItem(key: string) {
    return memoryFallbackMap.has(key) ? memoryFallbackMap.get(key)! : null;
  },
  setItem(key: string, value: string) {
    memoryFallbackMap.set(key, value);
  },
  removeItem(key: string) {
    memoryFallbackMap.delete(key);
  },
};

function getDefaultStorage(): StorageLike {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      return localStorage;
    }
  } catch {
    // Ignore storage access errors in non-browser contexts
  }
  return memoryFallbackStorage;
}

function getOwnerSnapshotsKey(ownerId: string): string {
  return `ws_publishedPreviews_${ownerId}`;
}

/**
 * Persists a published website snapshot under the authenticated owner's local cache namespace.
 */
export function savePublishedWebsiteSnapshot(
  snapshot: PublishedWebsiteSnapshot,
  storage: StorageLike | null = getDefaultStorage()
): void {
  if (!storage || !snapshot.ownerId || !snapshot.projectId) return;

  const key = getOwnerSnapshotsKey(snapshot.ownerId);
  let list: PublishedWebsiteSnapshot[] = [];
  try {
    const raw = storage.getItem(key);
    list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) list = [];
  } catch {
    list = [];
  }

  const filtered = list.filter((item) => item.projectId !== snapshot.projectId);
  filtered.unshift(snapshot);

  try {
    storage.setItem(key, JSON.stringify(filtered));
  } catch (err) {
    console.warn('Could not save published website snapshot to storage:', err);
  }
}

/**
 * Loads a published website snapshot by projectId, enforcing strict owner-scoped isolation
 * for browser-local cache lookups.
 */
export function getPublishedWebsiteSnapshot(
  projectId: string,
  ownerId: string,
  storage: StorageLike | null = getDefaultStorage()
): PublishedWebsiteSnapshot | null {
  if (!storage || !projectId || !ownerId) return null;

  const key = getOwnerSnapshotsKey(ownerId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return null;
    const match = list.find(
      (item: PublishedWebsiteSnapshot) =>
        item && item.projectId === projectId && item.ownerId === ownerId
    );
    return match || null;
  } catch {
    return null;
  }
}
