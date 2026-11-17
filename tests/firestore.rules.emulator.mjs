/**
 * Ready-to-run Firebase Emulator Rules Test Suite (`firestore.rules`).
 *
 * Prerequisites on test host:
 *   1. Java 11+ JRE installed (`java -version`)
 *   2. Dev dependency installed: `npm install -D @firebase/rules-unit-testing`
 *
 * Run with:
 *   firebase emulators:exec --only firestore "node --test tests/firestore.rules.emulator.mjs"
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore';

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'omega-ripsaw-l7c1c';

let testEnv;

before(async () => {
  const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules },
  });
});

after(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe('Firestore Security Rules Emulator Verification (14 Required Scenarios)', () => {
  it('1. Unauthenticated read of users/{uid} -> DENY', async () => {
    const anonDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anonDb, 'users', 'user_a')));
  });

  it('2. Unauthenticated read of private codeProjects/{id} -> DENY', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'codeProjects', 'proj_1'), {
        id: 'proj_1',
        ownerId: 'user_a',
        name: 'App',
        language: 'TypeScript',
        files: [],
      });
    });
    const anonDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anonDb, 'codeProjects', 'proj_1')));
  });

  it('3. Unauthenticated read of public publishedWebsites/{id} -> ALLOW', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'publishedWebsites', 'pub_1'), {
        projectId: 'pub_1',
        ownerId: 'user_a',
        name: 'Public Site',
        fileManifest: [{ path: 'index.html', content: '<h1>Hi</h1>', type: 'markup' }],
        compiledHtml: '<html></html>',
        publishedAt: '2026-01-01T00:00:00.000Z',
        snapshotVersion: 1,
        isPublic: true,
      });
    });
    const anonDb = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(anonDb, 'publishedWebsites', 'pub_1')));
  });

  it('4. Unauthenticated read of private publishedWebsites/{id} -> DENY', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'publishedWebsites', 'priv_1'), {
        projectId: 'priv_1',
        ownerId: 'user_a',
        name: 'Private Site',
        fileManifest: [{ path: 'index.html', content: '<h1>Hi</h1>', type: 'markup' }],
        compiledHtml: '<html></html>',
        publishedAt: '2026-01-01T00:00:00.000Z',
        snapshotVersion: 1,
        isPublic: false,
      });
    });
    const anonDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anonDb, 'publishedWebsites', 'priv_1')));
  });

  it('5. Unauthenticated list on publishedWebsites -> DENY', async () => {
    const anonDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDocs(collection(anonDb, 'publishedWebsites')));
  });

  it('6. Authenticated user A reads own document in each private collection -> ALLOW', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'users', 'user_a'), { uid: 'user_a', email: 'a@example.com' });
      await setDoc(doc(db, 'codeProjects', 'cp_a'), {
        id: 'cp_a',
        ownerId: 'user_a',
        name: 'A Code',
        language: 'TS',
        files: [],
      });
      await setDoc(doc(db, 'websiteProjects', 'wp_a'), {
        id: 'wp_a',
        ownerId: 'user_a',
        name: 'A Web',
        category: 'SaaS',
        fileManifest: [],
      });
      await setDoc(doc(db, 'documents', 'doc_a'), {
        id: 'doc_a',
        ownerId: 'user_a',
        title: 'A Doc',
        category: 'Report',
        content: 'Body',
      });
      await setDoc(doc(db, 'datasets', 'ds_a'), {
        id: 'ds_a',
        ownerId: 'user_a',
        filename: 'a.csv',
        format: 'csv',
        rowCount: 1,
        columnCount: 1,
      });
      await setDoc(doc(db, 'activityLogs', 'log_a'), {
        id: 'log_a',
        ownerId: 'user_a',
        activityType: 'code',
        description: 'Created',
      });
    });

    const userADb = testEnv.authenticatedContext('user_a').firestore();
    await assertSucceeds(getDoc(doc(userADb, 'users', 'user_a')));
    await assertSucceeds(getDocs(query(collection(userADb, 'codeProjects'), where('ownerId', '==', 'user_a'))));
    await assertSucceeds(getDocs(query(collection(userADb, 'websiteProjects'), where('ownerId', '==', 'user_a'))));
    await assertSucceeds(getDocs(query(collection(userADb, 'documents'), where('ownerId', '==', 'user_a'))));
    await assertSucceeds(getDocs(query(collection(userADb, 'datasets'), where('ownerId', '==', 'user_a'))));
    await assertSucceeds(getDocs(query(collection(userADb, 'activityLogs'), where('ownerId', '==', 'user_a'))));
  });

  it('7. Authenticated user A reads user B document -> DENY', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'documents', 'doc_b'), {
        id: 'doc_b',
        ownerId: 'user_b',
        title: 'B Doc',
        category: 'Report',
        content: 'Secret',
      });
    });
    const userADb = testEnv.authenticatedContext('user_a').firestore();
    await assertFails(getDoc(doc(userADb, 'documents', 'doc_b')));
  });

  it('8. Authenticated user A creates doc with ownerId = B -> DENY', async () => {
    const userADb = testEnv.authenticatedContext('user_a').firestore();
    await assertFails(
      setDoc(doc(userADb, 'codeProjects', 'spoof_1'), {
        id: 'spoof_1',
        ownerId: 'user_b',
        name: 'Spoofed',
        language: 'JS',
        files: [],
      })
    );
  });

  it('9. Authenticated user A updates own doc attempting to change ownerId -> DENY', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'codeProjects', 'cp_own'), {
        id: 'cp_own',
        ownerId: 'user_a',
        name: 'Own',
        language: 'JS',
        files: [],
      });
    });
    const userADb = testEnv.authenticatedContext('user_a').firestore();
    await assertFails(updateDoc(doc(userADb, 'codeProjects', 'cp_own'), { ownerId: 'user_b' }));
  });

  it('10. Authenticated user A deletes user B publishedWebsites doc -> DENY', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'publishedWebsites', 'pub_b'), {
        projectId: 'pub_b',
        ownerId: 'user_b',
        name: 'B Site',
        fileManifest: [{ path: 'index.html', content: '<h1>B</h1>', type: 'markup' }],
        compiledHtml: '<html></html>',
        publishedAt: '2026-01-01T00:00:00.000Z',
        snapshotVersion: 1,
        isPublic: true,
      });
    });
    const userADb = testEnv.authenticatedContext('user_a').firestore();
    await assertFails(deleteDoc(doc(userADb, 'publishedWebsites', 'pub_b')));
  });

  it('11. User creates doc with unexpected arbitrary field -> DENY', async () => {
    const userADb = testEnv.authenticatedContext('user_a').firestore();
    await assertFails(
      setDoc(doc(userADb, 'users', 'user_a'), {
        uid: 'user_a',
        email: 'a@example.com',
        role: 'superadmin',
      })
    );
  });

  it('12. User creates publishedWebsites doc with compiledHtml > 850000 bytes -> DENY', async () => {
    const userADb = testEnv.authenticatedContext('user_a').firestore();
    await assertFails(
      setDoc(doc(userADb, 'publishedWebsites', 'pub_huge'), {
        projectId: 'pub_huge',
        ownerId: 'user_a',
        name: 'Huge',
        fileManifest: [{ path: 'index.html', content: '<h1>H</h1>', type: 'markup' }],
        compiledHtml: 'x'.repeat(850_005),
        publishedAt: '2026-01-01T00:00:00.000Z',
        snapshotVersion: 1,
        isPublic: true,
      })
    );
  });

  it('13. User creates users/{uid} with non-boolean tourCompleted -> DENY', async () => {
    const userADb = testEnv.authenticatedContext('user_a').firestore();
    await assertFails(
      setDoc(doc(userADb, 'users', 'user_a'), {
        uid: 'user_a',
        email: 'a@example.com',
        tourCompleted: 'yes',
      })
    );
  });

  it('14. Authenticated user A writes activityLogs then attempts update -> DENY', async () => {
    const userADb = testEnv.authenticatedContext('user_a').firestore();
    await assertSucceeds(
      setDoc(doc(userADb, 'activityLogs', 'log_imm'), {
        id: 'log_imm',
        ownerId: 'user_a',
        activityType: 'code',
        description: 'Created project',
      })
    );
    await assertFails(
      updateDoc(doc(userADb, 'activityLogs', 'log_imm'), { description: 'Tampered' })
    );
  });
});
