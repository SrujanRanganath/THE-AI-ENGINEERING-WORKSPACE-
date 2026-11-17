import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { verifyFirebaseIdToken } from '../src/server/firebaseAuth.ts';
import {
  createWorkspaceApp,
  isAllowedCorsOrigin,
  sanitizePublicErrorMessage,
} from '../server.ts';
import {
  FirestoreLookupOutcome,
  FirestoreRestAdapter,
  PublishedSnapshotStore,
} from '../src/server/publishedSnapshotStore.ts';
import {
  createPublishedWebsiteSnapshot,
  PublishedWebsiteSnapshot,
} from '../src/utils/publishPreview.ts';
import { getSampleReactWebsiteManifest } from '../src/utils/reactPreviewCompiler.ts';
import {
  getOtpHmacSecret,
  getOtpSecurityStatus,
  OtpManager,
  processOtpSendRequest,
  signOtpVerificationToken,
  verifyOtpVerificationToken,
} from '../src/server/otpService.ts';

function signRs256Jwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  privateKeyPem: string
): string {
  const h = Buffer.from(JSON.stringify(header)).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${h}.${p}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const sig = signer.sign(privateKeyPem).toString('base64url');
  return `${signingInput}.${sig}`;
}

function makeSnapshot(overrides: Partial<PublishedWebsiteSnapshot> = {}): PublishedWebsiteSnapshot {
  const manifest = getSampleReactWebsiteManifest(overrides.name || 'Security Audit Site');
  const res = createPublishedWebsiteSnapshot(
    {
      id: overrides.projectId || 'proj_sec_01',
      ownerId: overrides.ownerId || 'uid_user_a',
      name: overrides.name || 'Security Audit Site',
      category: 'SaaS',
      technology: 'React',
      designDirection: 'Dark',
      description: 'Security test preview',
      summary: 'Summary',
      fileManifest: manifest,
    },
    {
      isPublic: overrides.isPublic ?? true,
      snapshotVersion: overrides.snapshotVersion ?? 1,
    }
  );
  if (!res.success) {
    assert.fail(res.error);
  }
  return { ...res.snapshot, ...overrides };
}

function createInMemoryFirestoreAdapter(): {
  adapter: FirestoreRestAdapter;
  db: Map<string, PublishedWebsiteSnapshot>;
} {
  const db = new Map<string, PublishedWebsiteSnapshot>();
  const adapter: FirestoreRestAdapter = {
    async getDocument(projectId: string, bearerToken?: string): Promise<FirestoreLookupOutcome> {
      const doc = db.get(projectId) || null;
      if (!doc) {
        return { snapshot: null, status: 404, error: 'Published preview not found.' };
      }
      if (doc.isPublic === false && bearerToken !== `valid_token_${doc.ownerId}`) {
        return {
          snapshot: null,
          status: 403,
          error: 'Cloud Firestore denied read access.',
        };
      }
      return { snapshot: doc, status: 200 };
    },
    async upsertDocument(snapshot: PublishedWebsiteSnapshot, bearerToken?: string) {
      if (!bearerToken) {
        return { saved: false, status: 401, error: 'Missing bearer token.' };
      }
      if (bearerToken !== `valid_token_${snapshot.ownerId}`) {
        return { saved: false, status: 403, error: 'Owner mismatch.' };
      }
      db.set(snapshot.projectId, snapshot);
      return { saved: true, status: 200 };
    },
  };
  return { adapter, db };
}

async function withServer(
  app: ReturnType<typeof createWorkspaceApp>,
  fn: (baseUrl: string) => Promise<void>
): Promise<void> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

describe('Phase 1-3 Security Audit: Server Firebase ID Token Verification', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const projectId = 'omega-ripsaw-l7c1c';
  const nowSec = 1_800_000_000;
  const certs = { key_1: publicKey };

  it('1. Verifies valid RS256 Firebase ID tokens and rejects tampered, expired, wrong-aud, and alg-confusion tokens', async () => {
    const validToken = signRs256Jwt(
      { alg: 'RS256', kid: 'key_1', typ: 'JWT' },
      {
        aud: projectId,
        iss: `https://securetoken.google.com/${projectId}`,
        sub: 'uid_alice_123',
        user_id: 'uid_alice_123',
        email: 'alice@example.com',
        email_verified: false,
        iat: nowSec - 30,
        exp: nowSec + 3600,
      },
      privateKey
    );

    const ok = await verifyFirebaseIdToken(validToken, {
      expectedProjectId: projectId,
      nowSec,
      getCerts: async () => certs,
    });
    assert.equal(ok.valid, true);
    if (ok.valid) {
      assert.equal(ok.uid, 'uid_alice_123');
      assert.equal(ok.emailVerified, false);
    }

    // Tampered payload
    const parts = validToken.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({
        aud: projectId,
        iss: `https://securetoken.google.com/${projectId}`,
        sub: 'uid_victim_999',
        iat: nowSec - 30,
        exp: nowSec + 3600,
      })
    ).toString('base64url');
    const tampered = await verifyFirebaseIdToken(`${parts[0]}.${forgedPayload}.${parts[2]}`, {
      expectedProjectId: projectId,
      nowSec,
      getCerts: async () => certs,
    });
    assert.equal(tampered.valid, false);
    if (!tampered.valid) assert.equal(tampered.code, 'INVALID_SIGNATURE');

    // Expired token
    const expiredToken = signRs256Jwt(
      { alg: 'RS256', kid: 'key_1' },
      {
        aud: projectId,
        iss: `https://securetoken.google.com/${projectId}`,
        sub: 'uid_alice_123',
        iat: nowSec - 4000,
        exp: nowSec - 120,
      },
      privateKey
    );
    const expRes = await verifyFirebaseIdToken(expiredToken, {
      expectedProjectId: projectId,
      nowSec,
      getCerts: async () => certs,
    });
    assert.equal(expRes.valid, false);
    if (!expRes.valid) assert.equal(expRes.code, 'EXPIRED_TOKEN');

    // alg:none confusion attack
    const algNoneToken = `${Buffer.from(JSON.stringify({ alg: 'none', kid: 'key_1' })).toString(
      'base64url'
    )}.${parts[1]}.sig`;
    const algRes = await verifyFirebaseIdToken(algNoneToken, {
      expectedProjectId: projectId,
      nowSec,
      getCerts: async () => certs,
    });
    assert.equal(algRes.valid, false);
    if (!algRes.valid) assert.equal(algRes.code, 'UNSUPPORTED_ALG');

    // Wrong audience
    const wrongAudToken = signRs256Jwt(
      { alg: 'RS256', kid: 'key_1' },
      {
        aud: 'evil-project',
        iss: `https://securetoken.google.com/${projectId}`,
        sub: 'uid_alice_123',
        iat: nowSec - 10,
        exp: nowSec + 3600,
      },
      privateKey
    );
    const audRes = await verifyFirebaseIdToken(wrongAudToken, {
      expectedProjectId: projectId,
      nowSec,
      getCerts: async () => certs,
    });
    assert.equal(audRes.valid, false);
    if (!audRes.valid) assert.equal(audRes.code, 'INVALID_CLAIMS');
  });
});

describe('Phase 3 & 4 Security Audit: Express Endpoints & Spoofing Prevention', () => {
  it('2. Blocks ?ownerId= / x-owner-id spoofing on GET/POST /api/published/:projectId and enforces cross-owner 403', async () => {
    const { adapter } = createInMemoryFirestoreAdapter();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-audit-store-'));
    try {
      const store = new PublishedSnapshotStore({
        persistenceMode: 'production_firestore',
        storageFilePath: path.join(tmpDir, 'unused.json'),
        firestoreAdapter: adapter,
      });

      const app = createWorkspaceApp({
        isProduction: true,
        apiKey: 'test-key-never-called',
        publishedSnapshotStore: store,
        verifyToken: async (token) => {
          if (token === 'valid_token_uid_user_a') {
            return { valid: true, uid: 'uid_user_a', emailVerified: false };
          }
          if (token === 'valid_token_uid_user_b') {
            return { valid: true, uid: 'uid_user_b', emailVerified: false };
          }
          return { valid: false, code: 'INVALID_SIGNATURE', error: 'Invalid token.' };
        },
      });

      await withServer(app, async (baseUrl) => {
        const privSnap = makeSnapshot({
          projectId: 'proj_private_sec',
          ownerId: 'uid_user_a',
          isPublic: false,
        });

        // Unauthenticated POST in production -> 401
        const unauthPost = await fetch(`${baseUrl}/api/published/proj_private_sec`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(privSnap),
        });
        assert.equal(unauthPost.status, 401);

        // Forged token POST -> 401
        const forgedPost = await fetch(`${baseUrl}/api/published/proj_private_sec`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer forged_jwt_token',
          },
          body: JSON.stringify(privSnap),
        });
        assert.equal(forgedPost.status, 401);

        // User B attempting to publish under User A's ownerId -> 403
        const crossOwnerPost = await fetch(`${baseUrl}/api/published/proj_private_sec`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid_token_uid_user_b',
          },
          body: JSON.stringify(privSnap),
        });
        assert.equal(crossOwnerPost.status, 403);

        // User A publishes private snapshot -> 200 v1
        const okPost = await fetch(`${baseUrl}/api/published/proj_private_sec`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid_token_uid_user_a',
          },
          body: JSON.stringify(privSnap),
        });
        assert.equal(okPost.status, 200);
        const okBody = await okPost.json();
        assert.equal(okBody.snapshotVersion, 1);

        // Idempotent replay with identical timestamp/compiledHtml/isPublic stays v1 (no double bump)
        const replayPost = await fetch(`${baseUrl}/api/published/proj_private_sec`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid_token_uid_user_a',
          },
          body: JSON.stringify(okBody.snapshot),
        });
        assert.equal(replayPost.status, 200);
        const replayBody = await replayPost.json();
        assert.equal(replayBody.snapshotVersion, 1);

        // Attacker tries ?ownerId=uid_user_a + x-owner-id spoofing WITHOUT token -> 403!
        const spoofedGet = await fetch(
          `${baseUrl}/api/published/proj_private_sec?ownerId=uid_user_a`,
          {
            headers: { 'x-owner-id': 'uid_user_a' },
          }
        );
        assert.equal(spoofedGet.status, 403);

        // User B with valid token tries to read User A's private snapshot -> 403!
        const userBGet = await fetch(`${baseUrl}/api/published/proj_private_sec`, {
          headers: { Authorization: 'Bearer valid_token_uid_user_b' },
        });
        assert.equal(userBGet.status, 403);

        // User A with valid token reads own private snapshot -> 200!
        const ownerGet = await fetch(`${baseUrl}/api/published/proj_private_sec`, {
          headers: { Authorization: 'Bearer valid_token_uid_user_a' },
        });
        assert.equal(ownerGet.status, 200);
        const ownerGetBody = await ownerGet.json();
        assert.equal(ownerGetBody.snapshot.projectId, 'proj_private_sec');
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('3. Blocks ?ownerId=uid_real spoofing even in development mode', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-audit-dev-'));
    try {
      const store = new PublishedSnapshotStore({
        persistenceMode: 'development',
        storageFilePath: path.join(tmpDir, 'dev-previews.json'),
      });
      await store.saveSnapshot(
        makeSnapshot({
          projectId: 'dev_priv_site',
          ownerId: 'uid_real_dev_user',
          isPublic: false,
        })
      );

      const app = createWorkspaceApp({
        isProduction: false,
        apiKey: 'test-key-never-called',
        publishedSnapshotStore: store,
      });

      await withServer(app, async (baseUrl) => {
        // Spoofed real UID via query param/header must fail in dev too!
        const spoofed = await fetch(
          `${baseUrl}/api/published/dev_priv_site?ownerId=uid_real_dev_user`,
          { headers: { 'x-owner-id': 'uid_real_dev_user' } }
        );
        assert.equal(spoofed.status, 403);

        // Unauthenticated POST claiming a real UID must be rejected in dev too
        const unauthRealPost = await fetch(`${baseUrl}/api/published/dev_real_spoof`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            makeSnapshot({ projectId: 'dev_real_spoof', ownerId: 'uid_real_dev_user' })
          ),
        });
        assert.equal(unauthRealPost.status, 401);
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('4. AI endpoints never leak raw output or secrets on errors, enforce bounds, and sanitize file paths', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-audit-ai-'));
    try {
      const app = createWorkspaceApp({
        isProduction: true,
        apiKey: 'AIzaTestFakeSecretKeyShouldNeverAppear12345',
        publishedSnapshotStore: new PublishedSnapshotStore({
          persistenceMode: 'development',
          storageFilePath: path.join(tmpDir, 'unused.json'),
        }),
        generateContent: async ({ contents }) => {
          if (String(contents).includes('TRIGGER_RAW_MALFORMED')) {
            return { text: 'SECRET_RAW_MODEL_DUMP {{{ not valid json' };
          }
          if (String(contents).includes('TRIGGER_SECRET_THROW')) {
            throw new Error(
              'Upstream failed at https://api.example.com?key=AIzaFakeLeak999999999999999999 with Authorization Bearer eyJhbGciOiJIUzI1NiJ9.secret'
            );
          }
          return {
            text: JSON.stringify({
              files: [
                {
                  path: '../../../etc/passwd',
                  content: 'console.log("safe")',
                  language: 'javascript',
                },
              ],
            }),
          };
        },
      });

      await withServer(app, async (baseUrl) => {
        // Malformed AI output -> 502 with NO raw field
        const malformedRes = await fetch(`${baseUrl}/api/ai/generate-code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectName: 'Test',
            language: 'TypeScript',
            description: 'TRIGGER_RAW_MALFORMED',
          }),
        });
        assert.equal(malformedRes.status, 502);
        const malformedJson = await malformedRes.json();
        assert.equal('raw' in malformedJson, false);
        assert.equal(JSON.stringify(malformedJson).includes('SECRET_RAW_MODEL_DUMP'), false);

        // Upstream thrown error -> 500 with redacted key/token message
        const throwRes = await fetch(`${baseUrl}/api/ai/generate-document`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Spec',
            category: 'Technical',
            description: 'TRIGGER_SECRET_THROW',
          }),
        });
        assert.equal(throwRes.status, 500);
        const throwText = await throwRes.text();
        assert.equal(throwText.includes('AIzaFakeLeak'), false);
        assert.equal(throwText.includes('eyJhbGci'), false);

        // Path traversal sanitized
        const safePathRes = await fetch(`${baseUrl}/api/ai/generate-code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectName: 'SafeApp',
            language: 'JavaScript',
            description: 'Normal valid request',
          }),
        });
        assert.equal(safePathRes.status, 200);
        const safePathJson = await safePathRes.json();
        assert.equal(safePathJson.data.files[0].path, 'etc/passwd');
        assert.equal(safePathJson.data.files[0].path.includes('..'), false);

        // Oversized payload rejected (400)
        const hugeRes = await fetch(`${baseUrl}/api/ai/generate-website`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            websiteName: 'BigSite',
            category: 'SaaS',
            description: 'a'.repeat(20_000),
          }),
        });
        assert.equal(hugeRes.status, 400);
      });

      const sanitized = sanitizePublicErrorMessage(
        new Error('Bad token Bearer abc.def.ghi and AIzaSecretKeyValue123456789012'),
        'fallback'
      );
      assert.equal(sanitized.includes('abc.def.ghi'), false);
      assert.equal(sanitized.includes('AIzaSecretKeyValue'), false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('5. Production OTP flow never exposes devTestOtpCode even when ALLOW_SANDBOX_OTP=true', async () => {
    const manager = new OtpManager();
    const res = await processOtpSendRequest({
      email: 'security@example.com',
      uid: 'uid_sec_otp',
      otpManager: manager,
      env: { NODE_ENV: 'production', ALLOW_SANDBOX_OTP: 'true' },
      sendEmail: async () => ({
        delivered: true,
        provider: 'resend',
        detail: 'Sent via mock Resend',
      }),
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal('devTestOtpCode' in res.body, false);
    assert.equal(res.body.devTestOtpCode, undefined);
  });

  it('6. Resolves OTP_HMAC_SECRET dynamically for persistent token signing and never exposes secret values in status', () => {
    const prevSecret = process.env.OTP_HMAC_SECRET;
    const prevNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      process.env.OTP_HMAC_SECRET = 'persistent_prod_secret_example_123456';

      assert.equal(getOtpHmacSecret(), 'persistent_prod_secret_example_123456');
      const token = signOtpVerificationToken('otp@example.com', 'uid_persist_1', 1_700_000_000_000);
      assert.equal(
        verifyOtpVerificationToken('otp@example.com', 'uid_persist_1', token),
        true
      );
      assert.equal(
        verifyOtpVerificationToken(
          'otp@example.com',
          'uid_persist_1',
          token,
          'wrong_other_secret'
        ),
        false
      );

      const status = getOtpSecurityStatus();
      assert.equal(status.otpHmacSecretConfigured, true);
      assert.equal(status.sandboxOtpEnabled, false);
      assert.equal(JSON.stringify(status).includes('persistent_prod_secret_example_123456'), false);
    } finally {
      if (prevSecret === undefined) delete process.env.OTP_HMAC_SECRET;
      else process.env.OTP_HMAC_SECRET = prevSecret;
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
    }
  });
});

describe('Phase 1 & 2 Static Firestore Rules & Client Persistence Audit', () => {
  it('6. Enforces default-deny, all 8 collections, hasOnly allowlists, immutability, and OTP email compatibility in firestore.rules', () => {
    const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');

    // Default deny catch-all
    assert.match(rules, /match \/\s*\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);

    // Every collection present
    const collections = [
      'users',
      'codeProjects',
      'websiteProjects',
      'publishedWebsites',
      'documents',
      'datasets',
      'cleaningJobs',
      'activityLogs',
    ];
    for (const col of collections) {
      assert.ok(rules.includes(`match /${col}/`), `Missing rules block for ${col}`);
    }

    // Strict allowlists (hasOnly) on all 8 collections
    const hasOnlyMatches = rules.match(/hasOnly\(/g) || [];
    assert.equal(hasOnlyMatches.length, 8, 'Every collection must enforce strict field allowlisting');

    // Users cannot be listed; activityLogs are immutable
    assert.match(rules, /match \/users\/\{userId\}[\s\S]*?allow list: if false;/);
    assert.match(rules, /match \/activityLogs\/\{logId\}[\s\S]*?allow update: if false;/);

    // Guest migration fields included cleanly so migration never fails rules
    assert.ok(rules.includes("'migratedFromGuestId'"));
    assert.ok(rules.includes("'migratedAt'"));

    // publishedWebsites allows public get only when isPublic == true, private only for owner
    assert.match(
      rules,
      /match \/publishedWebsites\/\{projectId\}[\s\S]*?resource\.data\.isPublic == true[\s\S]*?resource\.data\.ownerId == request\.auth\.uid/
    );

    // Immutability checks on ownerId & snapshotVersion monotonicity
    assert.ok(rules.includes('request.resource.data.ownerId == resource.data.ownerId'));
    assert.ok(
      rules.includes('request.resource.data.snapshotVersion >= resource.data.snapshotVersion')
    );

    // Must NOT block Resend-OTP verified email users who have token.email_verified == false
    assert.equal(rules.includes('email_verified'), false);
  });

  it('7. Verifies Express security headers, safe CORS origin checks, AI bounded retry, and DataCleaner createdAt + cleaningJobs compliance', async () => {
    // 1. CORS origin allowlist checks
    assert.equal(isAllowedCorsOrigin('http://localhost:3000'), true);
    assert.equal(
      isAllowedCorsOrigin('https://ais-pre-46dahe63go5tnfkp23syj5-275316904505.asia-east1.run.app'),
      true
    );
    assert.equal(isAllowedCorsOrigin('https://evil-phishing.example.com'), false);
    assert.equal(isAllowedCorsOrigin('javascript:alert(1)'), false);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-audit-headers-'));
    try {
      let attempts = 0;
      const app = createWorkspaceApp({
        isProduction: true,
        apiKey: 'test-key',
        publishedSnapshotStore: new PublishedSnapshotStore({
          persistenceMode: 'development',
          storageFilePath: path.join(tmpDir, 'unused.json'),
        }),
        generateContent: async () => {
          attempts += 1;
          if (attempts === 1) {
            const err: any = new Error('503 Service Unavailable');
            err.status = 503;
            throw err;
          }
          return {
            text: JSON.stringify({
              files: [{ path: 'src/index.ts', content: 'export const ok = true;', language: 'ts' }],
            }),
          };
        },
      });

      await withServer(app, async (baseUrl) => {
        // Security headers on GET /api/health
        const healthRes = await fetch(`${baseUrl}/api/health`, {
          headers: { Origin: 'https://ais-pre-example.run.app' },
        });
        assert.equal(healthRes.status, 200);
        assert.equal(healthRes.headers.get('x-powered-by'), null);
        assert.equal(healthRes.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(healthRes.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
        assert.equal(healthRes.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
        assert.equal(healthRes.headers.get('x-frame-options'), null); // Must not block AI Studio iframe
        assert.equal(healthRes.headers.get('access-control-allow-origin'), 'https://ais-pre-example.run.app');

        // Untrusted origin receives no ACAO header
        const evilOriginRes = await fetch(`${baseUrl}/api/health`, {
          headers: { Origin: 'https://untrusted.attacker.invalid' },
        });
        assert.equal(evilOriginRes.headers.get('access-control-allow-origin'), null);

        // OPTIONS preflight returns 204
        const preflight = await fetch(`${baseUrl}/api/ai/generate-code`, { method: 'OPTIONS' });
        assert.equal(preflight.status, 204);

        // Bounded retry recovers from single 503 on /api/ai/generate-code
        const codeRes = await fetch(`${baseUrl}/api/ai/generate-code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectName: 'RetryTest',
            language: 'TypeScript',
            description: 'Verify retry resilience',
          }),
        });
        assert.equal(codeRes.status, 200);
        assert.equal(attempts, 2);
      });

      // Verify DataCleanerPage persists cleaningJobs and updates existing datasets via updateDataset (preserving createdAt)
      const dataCleanerSrc = fs.readFileSync(
        path.resolve(process.cwd(), 'src/pages/workspace/DataCleanerPage.tsx'),
        'utf8'
      );
      assert.ok(dataCleanerSrc.includes('saveCleaningJob'));
      assert.ok(dataCleanerSrc.includes('updateDataset'));
      assert.ok(dataCleanerSrc.includes('activeDatasetCreatedAt'));

      const firestoreSvcSrc = fs.readFileSync(
        path.resolve(process.cwd(), 'src/lib/firestoreService.ts'),
        'utf8'
      );
      assert.ok(firestoreSvcSrc.includes('buildFirestoreCleaningJobPayload'));
      assert.ok(firestoreSvcSrc.includes('delete safeUpdates.createdAt'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

