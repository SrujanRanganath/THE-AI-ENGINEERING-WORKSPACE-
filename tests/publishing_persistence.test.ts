import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FirestoreLookupOutcome,
  FirestoreRestAdapter,
  MAX_FIRESTORE_COMPILED_HTML_BYTES,
  PublishedSnapshotStore,
} from '../src/server/publishedSnapshotStore.ts';
import {
  ARGON_MODEL_ID,
  executeWebsiteGeneration,
  HYDROGEN_MODEL_ID,
} from '../src/server/websiteGenerationService.ts';
import {
  createPublishedWebsiteSnapshot,
  PublishedWebsiteSnapshot,
  StorageLike,
} from '../src/utils/publishPreview.ts';
import { getSampleReactWebsiteManifest } from '../src/utils/reactPreviewCompiler.ts';
import { resolvePublishedPreviewSnapshot } from '../src/utils/publishedPreviewClient.ts';
import { GUIDED_TOUR_STEPS } from '../src/lib/guidedTourSteps.ts';

function createTempStorePath(suffix: string): { dir: string; filePath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ws-pub-test-${suffix}-`));
  return { dir, filePath: path.join(dir, 'published-previews.json') };
}

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

function makeSnapshot(overrides: Partial<PublishedWebsiteSnapshot> = {}): PublishedWebsiteSnapshot {
  const manifest = getSampleReactWebsiteManifest('Nova Analytics');
  const created = createPublishedWebsiteSnapshot(
    {
      id: overrides.projectId || 'site_nova_01',
      ownerId: overrides.ownerId || 'uid_owner_alpha',
      name: overrides.name || 'Nova Analytics',
      category: 'SaaS',
      technology: 'React',
      designDirection: 'Modern',
      description: 'AI metrics platform landing page',
      summary: 'Generated SaaS website',
      fileManifest: manifest,
    },
    {
      origin: 'https://workspace.example.app',
      isPublic: overrides.isPublic ?? true,
      snapshotVersion: overrides.snapshotVersion ?? 1,
    }
  );
  if (!created.success) {
    assert.fail(`Expected sample snapshot compilation to succeed: ${created.error}`);
  }
  return {
    ...created.snapshot,
    ...overrides,
  };
}

function createMockFirestoreAdapter(initial?: Map<string, PublishedWebsiteSnapshot>): FirestoreRestAdapter {
  const db = initial || new Map<string, PublishedWebsiteSnapshot>();
  return {
    async getDocument(projectId: string, bearerToken?: string): Promise<FirestoreLookupOutcome> {
      const doc = db.get(projectId) || null;
      if (!doc) {
        return { snapshot: null, status: 404, error: 'Published preview not found.' };
      }
      if (doc.isPublic === false && bearerToken !== `token_for_${doc.ownerId}`) {
        return {
          snapshot: null,
          status: 403,
          error: 'Cloud Firestore denied read access for Owner Only preview.',
        };
      }
      return { snapshot: doc, status: 200 };
    },
    async upsertDocument(snapshot: PublishedWebsiteSnapshot, bearerToken?: string) {
      if (!bearerToken) {
        return { saved: false, status: 401, error: 'Missing bearer token' };
      }
      if (bearerToken !== `token_for_${snapshot.ownerId}`) {
        return { saved: false, status: 403, error: 'Firestore owner mismatch' };
      }
      db.set(snapshot.projectId, snapshot);
      return { saved: true, status: 200 };
    },
  };
}

describe('Published Website Durable Persistence & Authorization', () => {
  it('1. Saves public preview with full manifest metadata and survives server restart (development mode)', async () => {
    const { dir, filePath } = createTempStorePath('restart');
    try {
      const store1 = new PublishedSnapshotStore({
        persistenceMode: 'development',
        storageFilePath: filePath,
      });
      const snap = makeSnapshot({ projectId: 'proj_restart_1', ownerId: 'user_alice', isPublic: true });

      const saveRes = await store1.saveSnapshot(snap);
      assert.equal(saveRes.success, true);
      assert.equal(saveRes.status, 200);
      assert.equal(saveRes.snapshot?.snapshotVersion, 1);
      assert.equal(saveRes.snapshot?.framework, 'React 19 + Vite');
      assert.ok(
        saveRes.snapshot?.entryHtml.includes('<!DOCTYPE html>') ||
          saveRes.snapshot?.entryHtml.includes('<html')
      );
      assert.ok(Object.keys(saveRes.snapshot?.dependencies || {}).length > 0);
      assert.equal(saveRes.persistence?.disk, true);
      assert.equal(saveRes.persistence?.verifiedReadBack, true);

      const store2 = new PublishedSnapshotStore({
        persistenceMode: 'development',
        storageFilePath: filePath,
      });
      const anonLookup = await store2.getSnapshot('proj_restart_1');
      assert.equal(anonLookup.found, true);
      assert.equal(anonLookup.status, 200);
      assert.equal(anonLookup.snapshot?.projectId, 'proj_restart_1');
      assert.equal(anonLookup.snapshot?.compiledHtml, snap.compiledHtml);
      assert.equal(anonLookup.snapshot?.fileManifest.length, snap.fileManifest.length);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('2. Falls back to Firestore REST adapter when a separate instance has an empty disk cache', async () => {
    const { dir: dir1, filePath: file1 } = createTempStorePath('inst1');
    const { dir: dir2, filePath: file2 } = createTempStorePath('inst2');
    const adapter = createMockFirestoreAdapter();

    try {
      const storeA = new PublishedSnapshotStore({
        persistenceMode: 'development',
        storageFilePath: file1,
        firestoreAdapter: adapter,
      });
      const snap = makeSnapshot({ projectId: 'proj_cloudrun_cross', ownerId: 'user_bob' });
      const saved = await storeA.saveSnapshot(snap, { bearerToken: 'token_for_user_bob' });
      assert.equal(saved.success, true);
      assert.equal(saved.persistence?.firestoreRest, true);

      const storeB = new PublishedSnapshotStore({
        persistenceMode: 'development',
        storageFilePath: file2,
        firestoreAdapter: adapter,
      });
      const lookup = await storeB.getSnapshot('proj_cloudrun_cross');
      assert.equal(lookup.found, true);
      assert.equal(lookup.status, 200);
      assert.equal(lookup.snapshot?.name, snap.name);
      assert.equal(lookup.snapshot?.compiledHtml, snap.compiledHtml);
    } finally {
      fs.rmSync(dir1, { recursive: true, force: true });
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });

  it('3. Private previews (isPublic: false) deny unauthenticated/other-user reads (403) and allow owner reads (200)', async () => {
    const { dir, filePath } = createTempStorePath('private');
    try {
      const store = new PublishedSnapshotStore({
        persistenceMode: 'development',
        storageFilePath: filePath,
      });
      const snap = makeSnapshot({
        projectId: 'proj_private_99',
        ownerId: 'owner_real',
        isPublic: false,
      });
      await store.saveSnapshot(snap);

      const anonRes = await store.getSnapshot('proj_private_99');
      assert.equal(anonRes.found, false);
      assert.equal(anonRes.status, 403);

      const strangerRes = await store.getSnapshot('proj_private_99', { ownerId: 'other_user' });
      assert.equal(strangerRes.found, false);
      assert.equal(strangerRes.status, 403);

      const ownerRes = await store.getSnapshot('proj_private_99', { ownerId: 'owner_real' });
      assert.equal(ownerRes.found, true);
      assert.equal(ownerRes.status, 200);
      assert.equal(ownerRes.snapshot?.isPublic, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('4. Blocks cross-owner overwrite attempts (403) while incrementing snapshotVersion on owner republish', async () => {
    const { dir, filePath } = createTempStorePath('versioning');
    try {
      const store = new PublishedSnapshotStore({
        persistenceMode: 'development',
        storageFilePath: filePath,
      });
      const v1 = makeSnapshot({ projectId: 'proj_ver_1', ownerId: 'owner_1', name: 'Site v1' });
      const res1 = await store.saveSnapshot(v1);
      assert.equal(res1.success, true);
      assert.equal(res1.snapshot?.snapshotVersion, 1);

      const hijacker = makeSnapshot({
        projectId: 'proj_ver_1',
        ownerId: 'owner_hijack',
        name: 'Hijacked',
      });
      const hijackRes = await store.saveSnapshot(hijacker);
      assert.equal(hijackRes.success, false);
      assert.equal(hijackRes.status, 403);

      const v2 = makeSnapshot({ projectId: 'proj_ver_1', ownerId: 'owner_1', name: 'Site v2' });
      const res2 = await store.saveSnapshot(v2);
      assert.equal(res2.success, true);
      assert.equal(res2.snapshot?.snapshotVersion, 2);
      assert.equal(res2.snapshot?.name, 'Site v2');

      const fetched = await store.getSnapshot('proj_ver_1');
      assert.equal(fetched.found, true);
      assert.equal(fetched.snapshot?.snapshotVersion, 2);
      assert.equal(fetched.snapshot?.name, 'Site v2');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('5. Rejects invalid fields (400), oversized HTML (>850KB -> 413), and surfaces durable write failure (500)', async () => {
    const { dir, filePath } = createTempStorePath('errors');
    try {
      const store = new PublishedSnapshotStore({
        persistenceMode: 'development',
        storageFilePath: filePath,
      });

      const badId = await store.saveSnapshot({
        projectId: '../evil',
        ownerId: 'owner_1',
        compiledHtml: '<html></html>',
        fileManifest: [{ path: 'index.html', content: '<html></html>', type: 'html' }],
      });
      assert.equal(badId.success, false);
      assert.equal(badId.status, 400);

      const oversized = await store.saveSnapshot({
        projectId: 'valid_id_big',
        ownerId: 'owner_1',
        compiledHtml: 'x'.repeat(MAX_FIRESTORE_COMPILED_HTML_BYTES + 100),
        fileManifest: [{ path: 'index.html', content: '<html></html>', type: 'html' }],
      });
      assert.equal(oversized.success, false);
      assert.equal(oversized.status, 413);

      const blockerFile = path.join(dir, 'not-a-directory');
      fs.writeFileSync(blockerFile, 'blocked', 'utf-8');
      const brokenStore = new PublishedSnapshotStore({
        persistenceMode: 'development',
        storageFilePath: path.join(blockerFile, 'child.json'),
        firestoreAdapter: {
          async getDocument() {
            return { snapshot: null, status: 404 };
          },
          async upsertDocument() {
            return { saved: false, status: 503, error: 'Simulated remote failure' };
          },
        },
      });
      const failSave = await brokenStore.saveSnapshot(
        makeSnapshot({ projectId: 'proj_fail_write' }),
        { bearerToken: 'tok' }
      );
      assert.equal(failSave.success, false);
      assert.equal(failSave.status, 500);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('6. Production mode uses Firestore exclusively: never writes local disk, requires bearer token (401), propagates 403/503, and reads fresh updates across instances', async () => {
    const { dir, filePath } = createTempStorePath('prod');
    const sharedRemoteDb = new Map<string, PublishedWebsiteSnapshot>();
    const adapter = createMockFirestoreAdapter(sharedRemoteDb);

    try {
      const prodInstanceA = new PublishedSnapshotStore({
        persistenceMode: 'production_firestore',
        storageFilePath: filePath,
        firestoreAdapter: adapter,
      });
      const prodInstanceB = new PublishedSnapshotStore({
        persistenceMode: 'production_firestore',
        storageFilePath: filePath,
        firestoreAdapter: adapter,
      });

      const snap = makeSnapshot({ projectId: 'proj_prod_1', ownerId: 'uid_prod', isPublic: false });

      // Missing Firebase ID token is rejected (401), zero disk written
      const unauthSave = await prodInstanceA.saveSnapshot(snap);
      assert.equal(unauthSave.success, false);
      assert.equal(unauthSave.status, 401);
      assert.equal(fs.existsSync(filePath), false);

      // Authenticated save persists cleanly to Firestore only (disk: false)
      const okSave = await prodInstanceA.saveSnapshot(snap, { bearerToken: 'token_for_uid_prod' });
      assert.equal(okSave.success, true);
      assert.equal(okSave.persistence?.mode, 'production_firestore');
      assert.equal(okSave.persistence?.disk, false);
      assert.equal(okSave.persistence?.firestoreRest, true);
      assert.equal(okSave.persistence?.verifiedReadBack, true);
      assert.equal(fs.existsSync(filePath), false);

      // Private preview denies unauthenticated read cleanly with 403 (never 404)
      const anonPrivate = await prodInstanceB.getSnapshot('proj_prod_1');
      assert.equal(anonPrivate.found, false);
      assert.equal(anonPrivate.status, 403);

      // Owner read succeeds on fresh Instance B
      const ownerPrivate = await prodInstanceB.getSnapshot('proj_prod_1', {
        ownerId: 'uid_prod',
        bearerToken: 'token_for_uid_prod',
      });
      assert.equal(ownerPrivate.found, true);
      assert.equal(ownerPrivate.status, 200);

      // Instance A republishes as Public v2; Instance B immediately sees v2 (no stale cache)
      const v2Public = makeSnapshot({
        projectId: 'proj_prod_1',
        ownerId: 'uid_prod',
        name: 'Production Public v2',
        isPublic: true,
      });
      const v2Save = await prodInstanceA.saveSnapshot(v2Public, { bearerToken: 'token_for_uid_prod' });
      assert.equal(v2Save.success, true);
      assert.equal(v2Save.snapshot?.snapshotVersion, 2);

      const publicReadB = await prodInstanceB.getSnapshot('proj_prod_1');
      assert.equal(publicReadB.found, true);
      assert.equal(publicReadB.snapshot?.snapshotVersion, 2);
      assert.equal(publicReadB.snapshot?.name, 'Production Public v2');

      // Firestore outage in production must fail loudly (never pretend local success)
      const failingProd = new PublishedSnapshotStore({
        persistenceMode: 'production_firestore',
        storageFilePath: filePath,
        firestoreAdapter: {
          async getDocument() {
            return { snapshot: null, status: 503, error: 'Firestore down' };
          },
          async upsertDocument() {
            return { saved: false, status: 503, error: 'Firestore unavailable' };
          },
        },
      });
      const outageSave = await failingProd.saveSnapshot(snap, { bearerToken: 'token_for_uid_prod' });
      assert.equal(outageSave.success, false);
      assert.equal(outageSave.status, 503);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Published Preview Client Resolution Chain', () => {
  it('7. Resolves directly from server (200) in a fresh incognito browser with empty local cache', async () => {
    const serverSnap = makeSnapshot({ projectId: 'proj_incognito', ownerId: 'uid_owner' });
    const emptyStorage = createMemoryStorage();

    const outcome = await resolvePublishedPreviewSnapshot({
      projectId: 'proj_incognito',
      viewerOwnerId: null,
      origin: 'https://preview.example.com',
      localCacheStorage: emptyStorage,
      fetchServerSnapshot: async () => ({ status: 200, snapshot: serverSnap }),
      fetchFirestoreSnapshot: async () => ({ snapshot: null }),
      fetchOwnerWebsiteProjects: async () => [],
    });

    assert.equal(outcome.status, 'found');
    if (outcome.status === 'found') {
      assert.equal(outcome.source, 'server');
      assert.equal(
        outcome.snapshot.publishedUrl,
        'https://preview.example.com/published/proj_incognito'
      );
      assert.equal(outcome.snapshot.compiledHtml, serverSnap.compiledHtml);
    }
  });

  it('8. Returns requiresSignIn forbidden status on 403 private preview when signed out', async () => {
    const outcome = await resolvePublishedPreviewSnapshot({
      projectId: 'proj_locked',
      viewerOwnerId: null,
      localCacheStorage: createMemoryStorage(),
      fetchServerSnapshot: async () => ({
        status: 403,
        error: 'This published preview is set to Owner Only.',
      }),
      fetchFirestoreSnapshot: async () => ({ snapshot: null, permissionDenied: true }),
      fetchOwnerWebsiteProjects: async () => [],
    });

    assert.equal(outcome.status, 'forbidden');
    if (outcome.status === 'forbidden') {
      assert.equal(outcome.requiresSignIn, true);
    }
  });

  it('9. Falls back to Firestore publishedWebsites when server returns 404, preserving immutable snapshot over draft edits', async () => {
    const publishedSnap = makeSnapshot({
      projectId: 'proj_fs_fallback',
      ownerId: 'uid_alice',
      name: 'Immutable Published Title',
    });

    const outcome = await resolvePublishedPreviewSnapshot({
      projectId: 'proj_fs_fallback',
      viewerOwnerId: 'uid_alice',
      localCacheStorage: createMemoryStorage(),
      fetchServerSnapshot: async () => ({ status: 404 }),
      fetchFirestoreSnapshot: async () => ({ snapshot: publishedSnap }),
      fetchOwnerWebsiteProjects: async () => [
        {
          id: 'proj_fs_fallback',
          ownerId: 'uid_alice',
          name: 'Unsaved Draft Title',
          category: 'SaaS',
          technology: 'React',
          designDirection: 'Modern',
          description: 'Draft edit',
          fileManifest: [],
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    assert.equal(outcome.status, 'found');
    if (outcome.status === 'found') {
      assert.equal(outcome.source, 'firestore');
      assert.equal(outcome.snapshot.name, 'Immutable Published Title');
    }
  });

  it('10. Reconstructs from authenticated owner websiteProjects when server & Firestore miss, and returns not_found when absent everywhere', async () => {
    const manifest = getSampleReactWebsiteManifest('Owner Fallback Site');

    const reconstructed = await resolvePublishedPreviewSnapshot({
      projectId: 'proj_owner_reconstruct',
      viewerOwnerId: 'uid_bob',
      localCacheStorage: createMemoryStorage(),
      fetchServerSnapshot: async () => ({ status: 404 }),
      fetchFirestoreSnapshot: async () => ({ snapshot: null }),
      fetchOwnerWebsiteProjects: async () => [
        {
          id: 'proj_owner_reconstruct',
          ownerId: 'uid_bob',
          name: 'Owner Fallback Site',
          category: 'SaaS',
          technology: 'React',
          designDirection: 'Modern',
          description: 'Site description',
          fileManifest: manifest,
          isPublished: true,
          snapshotVersion: 3,
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    assert.equal(reconstructed.status, 'found');
    if (reconstructed.status === 'found') {
      assert.equal(reconstructed.source, 'owner_project');
      assert.equal(reconstructed.snapshot.snapshotVersion, 3);
      assert.ok(reconstructed.snapshot.compiledHtml.includes('<!DOCTYPE html>'));
    }

    const missing = await resolvePublishedPreviewSnapshot({
      projectId: 'proj_does_not_exist',
      viewerOwnerId: null,
      localCacheStorage: createMemoryStorage(),
      fetchServerSnapshot: async () => ({ status: 404 }),
      fetchFirestoreSnapshot: async () => ({ snapshot: null }),
      fetchOwnerWebsiteProjects: async () => [],
    });

    assert.equal(missing.status, 'not_found');
  });
});

describe('Website Generator Argon -> Hydrogen Fallback & Guided Tour', () => {
  it('11. Falls back transparently from gemini-4-argon to gemini-4-hydrogen when Argon is restricted/unavailable', async () => {
    const validManifest = getSampleReactWebsiteManifest('Hydrogen Fallback App');
    const modelsCalled: string[] = [];

    const result = await executeWebsiteGeneration({
      input: {
        websiteName: 'Hydrogen Fallback App',
        category: 'SaaS',
        technology: 'React',
        designDirection: 'Dark',
        description: 'Fallback verification landing page',
      },
      apiKeyConfigured: true,
      model: ARGON_MODEL_ID,
      fallbackModel: HYDROGEN_MODEL_ID,
      retryOptions: { sleep: async () => {} },
      generateContent: async ({ model }) => {
        modelsCalled.push(model);
        if (model === ARGON_MODEL_ID) {
          const err: any = new Error('Model unavailable');
          err.status = 403;
          throw err;
        }
        return {
          text: JSON.stringify({
            websiteName: 'Hydrogen Fallback App',
            framework: 'React 19 + Vite',
            category: 'SaaS',
            technology: 'React',
            designDirection: 'Dark',
            summary: 'Fallback verified',
            fileManifest: validManifest,
          }),
        };
      },
    });

    assert.equal(result.status, 200);
    assert.equal(modelsCalled[0], ARGON_MODEL_ID);
    assert.equal(modelsCalled[1], HYDROGEN_MODEL_ID);
    assert.equal(result.body.modelUsed, HYDROGEN_MODEL_ID);
    assert.match(String(result.body.modelFallbackNotice || ''), /gemini-4-hydrogen/);
  });

  it('12. Defines exactly 9 ordered Guided Tour steps covering every workspace route with valid selectors', () => {
    assert.equal(GUIDED_TOUR_STEPS.length, 9);

    const expectedRoutes = [
      '/dashboard',
      '/code-generator',
      '/website-generator',
      '/document-generator',
      '/data-cleaner',
      '/projects',
      '/activity',
      '/settings',
      '/help',
    ];

    const actualRoutes = GUIDED_TOUR_STEPS.map((s) => s.route);
    assert.deepEqual(actualRoutes, expectedRoutes);

    GUIDED_TOUR_STEPS.forEach((step, idx) => {
      assert.equal(step.stepNumber, idx + 1);
      assert.ok(step.title.trim().length > 0);
      assert.ok(step.description.trim().length > 10);
      assert.match(step.targetSelector, /^\[data-tour="[a-z0-9-]+"\]$/);
      assert.ok(Array.isArray(step.highlights) && step.highlights.length >= 1);
    });
  });
});
