import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

import {
  compileWebsitePreview,
  getSampleReactWebsiteManifest,
  PREVIEW_COMPILER_CAPABILITIES,
} from '../src/utils/reactPreviewCompiler';
import {
  OtpManager,
  OTP_TTL_MS,
  OTP_RESEND_COOLDOWN_MS,
  maskEmailAddress,
  verifyOtpVerificationToken,
  dispatchTransactionalOtpEmail,
  getEmailProviderStatus,
  isDevOtpHelperEnabled,
  processOtpSendRequest,
} from '../src/server/otpService';
import {
  migrateGuestToAuthenticatedAccount,
  StorageLike,
} from '../src/utils/guestMigration';
import {
  sanitizeArchivePath,
  createProjectZipBuffer,
} from '../src/utils/zipExport';
import {
  generateDocxBuffer,
  parseMarkdownIntoSections,
} from '../src/utils/docxExport';
import {
  calculateDatasetStats,
  executeCleaningPipeline,
  CleaningOperation,
} from '../src/utils/dataCleaner';

// In-memory StorageLike helper for deterministic migration testing
class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

// ============================================================================
// PHASE 2.1 — PREVIEW SANDBOX SECURITY HARDENING TESTS
// ============================================================================
test('Phase 2.1.1: Compiled preview enforces strict CSP (img-src data: blob: only, connect-src none) and embeds previewToken', () => {
  const manifest = getSampleReactWebsiteManifest('SecurePreviewApp');
  const secretToken = 'ptok_unit_test_998877';
  const result = compileWebsitePreview(manifest, 'React', 'SecurePreviewApp', secretToken);

  assert.equal(result.success, true);
  assert.ok(result.compiledHtml.includes("default-src 'none'"));
  assert.ok(result.compiledHtml.includes("connect-src 'none'"));
  assert.ok(result.compiledHtml.includes('img-src data: blob:;'));
  assert.equal(
    result.compiledHtml.includes('img-src data: https:'),
    false,
    'External HTTPS image exfiltration must be blocked in CSP'
  );
  assert.ok(result.compiledHtml.includes("base-uri 'none'"));
  assert.ok(result.compiledHtml.includes( JSON.stringify(secretToken) ));
  assert.ok(PREVIEW_COMPILER_CAPABILITIES.supportedHooks.includes('useState'));
});

test('Phase 2.1.2: Inline </script> and </style> breakout attempts in untrusted code/CSS are neutralized', () => {
  const manifest = getSampleReactWebsiteManifest('BreakoutTest');
  const appIdx = manifest.findIndex((f) => f.path === 'src/App.jsx');
  manifest[appIdx] = {
    ...manifest[appIdx],
    content: `import React from 'react';
export default function App() {
  const payload = "</script><script>window.pwned = true;</script>";
  return <div>{payload}</div>;
}`,
  };
  const cssIdx = manifest.findIndex((f) => f.path === 'src/index.css');
  manifest[cssIdx] = {
    ...manifest[cssIdx],
    content: `.box { content: "</style><script>alert(1)</script>"; }`,
  };

  const result = compileWebsitePreview(manifest, 'React', 'BreakoutTest', 'tok_1');
  assert.equal(result.success, true);
  assert.equal(result.compiledHtml.includes('</script><script>window.pwned'), false);
  assert.equal(result.compiledHtml.includes('</style><script>alert(1)'), false);
});

// ============================================================================
// PHASE 3 — SERVER-SIDE 6-DIGIT EMAIL OTP & GUEST-TO-ACCOUNT MIGRATION TESTS
// ============================================================================
test('Phase 3.1: Server-side OTP manager hashes codes with salted HMAC-SHA256, never stores plaintext, and verifies valid code', () => {
  const manager = new OtpManager();
  const now = 1_700_000_000_000;
  const email = 'srujanranganath2005@gmail.com';
  const uid = 'usr_otp_01';

  const issued = manager.issueOtp(email, uid, now, true);
  assert.equal(issued.success, true);
  assert.ok(issued.devTestOtpCode && /^\d{6}$/.test(issued.devTestOtpCode));
  assert.equal(issued.maskedEmail, maskEmailAddress(email));

  // Inspect internal record to prove plaintext OTP is never stored
  const stored = manager.getStoredRecordForInspection(email);
  assert.ok(stored);
  assert.notEqual(stored.codeHash, issued.devTestOtpCode);
  assert.equal(stored.codeHash.length, 64); // SHA-256 hex digest length
  assert.ok(stored.salt.length >= 32);
  assert.equal(JSON.stringify(stored).includes(issued.devTestOtpCode), false);

  // Verify wrong code fails and decrements remainingAttempts
  const wrongAttempt = manager.verifyOtp(email, uid, '000000', now + 1000);
  assert.equal(wrongAttempt.success, false);
  assert.equal(wrongAttempt.code, 'INVALID_CODE');
  assert.equal(wrongAttempt.remainingAttempts, 4);

  // Verify correct code succeeds, wipes hash, and issues a signed HMAC verification token
  const validAttempt = manager.verifyOtp(email, uid, issued.devTestOtpCode!, now + 2000);
  assert.equal(validAttempt.success, true);
  assert.equal(validAttempt.verified, true);
  assert.ok(validAttempt.verificationToken && validAttempt.verificationToken.includes('.'));
  assert.equal(
    verifyOtpVerificationToken(email, uid, validAttempt.verificationToken!),
    true
  );
  // Tampered token or mismatched UID/email must be rejected
  assert.equal(
    verifyOtpVerificationToken(email, uid, validAttempt.verificationToken! + 'x'),
    false
  );
  assert.equal(
    verifyOtpVerificationToken(email, 'wrong_uid', validAttempt.verificationToken!),
    false
  );
  // Production mode must never emit devTestOtpCode
  const prodIssued = manager.issueOtp('prod@user.io', 'uid_prod', now + 70_000, false);
  assert.equal(prodIssued.success, true);
  assert.equal(prodIssued.devTestOtpCode, undefined);
});

test('Phase 3.1b: Resend delivers OTP without SMTP_WEBHOOK_URL; webhook is optional fallback; missing both reports clear configuration error', async () => {
  const prevResend = process.env.RESEND_API_KEY;
  const prevWebhook = process.env.SMTP_WEBHOOK_URL;
  const prevFrom = process.env.OTP_EMAIL_FROM;
  const originalFetch = globalThis.fetch;

  const restore = () => {
    globalThis.fetch = originalFetch;
    if (prevResend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevResend;
    if (prevWebhook === undefined) delete process.env.SMTP_WEBHOOK_URL;
    else process.env.SMTP_WEBHOOK_URL = prevWebhook;
    if (prevFrom === undefined) delete process.env.OTP_EMAIL_FROM;
    else process.env.OTP_EMAIL_FROM = prevFrom;
  };

  try {
    // 1. RESEND_API_KEY alone (no SMTP_WEBHOOK_URL) must be sufficient
    process.env.RESEND_API_KEY = 're_test_key_only';
    delete process.env.SMTP_WEBHOOK_URL;
    process.env.OTP_EMAIL_FROM = 'AI Engineering Workspace <verify@example.com>';

    assert.deepEqual(getEmailProviderStatus(), { configured: true, provider: 'resend' });

    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ id: 'email_123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const resendOnlyResult = await dispatchTransactionalOtpEmail('srujanranganath2005@gmail.com', '654321');
    assert.equal(resendOnlyResult.delivered, true);
    assert.equal(resendOnlyResult.provider, 'resend');
    assert.equal(resendOnlyResult.detail, 'Dispatched via Resend transactional email API.');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.resend.com/emails');

    // 2. When both RESEND_API_KEY and SMTP_WEBHOOK_URL exist, Resend is used and webhook is NOT called
    process.env.SMTP_WEBHOOK_URL = 'https://webhook.example.com/otp';
    calls.length = 0;
    const bothSetResult = await dispatchTransactionalOtpEmail('srujanranganath2005@gmail.com', '112233');
    assert.equal(bothSetResult.delivered, true);
    assert.equal(bothSetResult.provider, 'resend');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.resend.com/emails');

    // 3. When Resend is unavailable (unset) and SMTP_WEBHOOK_URL IS explicitly set, webhook is used
    delete process.env.RESEND_API_KEY;
    assert.deepEqual(getEmailProviderStatus(), { configured: true, provider: 'webhook' });
    calls.length = 0;
    const webhookResult = await dispatchTransactionalOtpEmail('srujanranganath2005@gmail.com', '998877');
    assert.equal(webhookResult.delivered, true);
    assert.equal(webhookResult.provider, 'webhook');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://webhook.example.com/otp');

    // 4. Missing both providers produces the existing clear configuration error without any network call
    delete process.env.SMTP_WEBHOOK_URL;
    assert.deepEqual(getEmailProviderStatus(), { configured: false, provider: 'unconfigured' });
    calls.length = 0;
    const unconfiguredResult = await dispatchTransactionalOtpEmail('srujanranganath2005@gmail.com', '123456');
    assert.equal(unconfiguredResult.delivered, false);
    assert.equal(unconfiguredResult.provider, 'unconfigured');
    assert.equal(
      unconfiguredResult.detail,
      'External transactional email provider (RESEND_API_KEY or SMTP_WEBHOOK_URL) is not configured in environment variables.'
    );
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test('Phase 3.1c: Production locks out dev OTP helpers, strips OTPs from API responses/errors, and requires real Resend delivery', async () => {
  // 1. isDevOtpHelperEnabled must ONLY return true when NODE_ENV === 'development' AND ALLOW_SANDBOX_OTP === 'true'
  assert.equal(isDevOtpHelperEnabled({ NODE_ENV: 'production', ALLOW_SANDBOX_OTP: 'true' }), false);
  assert.equal(isDevOtpHelperEnabled({ NODE_ENV: 'production' }), false);
  assert.equal(isDevOtpHelperEnabled({ NODE_ENV: 'staging', ALLOW_SANDBOX_OTP: 'true' }), false);
  assert.equal(isDevOtpHelperEnabled({ ALLOW_SANDBOX_OTP: 'true' }), false);
  assert.equal(isDevOtpHelperEnabled({ NODE_ENV: 'development' }), false);
  assert.equal(isDevOtpHelperEnabled({ NODE_ENV: 'development', ALLOW_SANDBOX_OTP: 'false' }), false);
  assert.equal(isDevOtpHelperEnabled({ NODE_ENV: 'development', ALLOW_SANDBOX_OTP: 'true' }), true);

  // 2. OtpManager under NODE_ENV=production never leaks devTestOtpCode even if caller passes true
  const prevNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    const prodManager = new OtpManager();
    const forced = prodManager.issueOtp('prod-lock@example.com', 'uid_prod_lock', 1_700_000_000_000, true);
    assert.equal(forced.success, true);
    assert.equal(forced.devTestOtpCode, undefined);
  } finally {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  }

  // 3. processOtpSendRequest in production (even with ALLOW_SANDBOX_OTP=true) delivers via Resend and omits OTP from JSON
  const manager = new OtpManager();
  let capturedOtpFromResend = '';
  const prodRes = await processOtpSendRequest({
    email: 'realuser@example.com',
    uid: 'uid_real_1',
    otpManager: manager,
    nowMs: 1_700_000_000_000,
    env: { NODE_ENV: 'production', ALLOW_SANDBOX_OTP: 'true', RESEND_API_KEY: 're_live_123' },
    sendEmail: async (_email, code) => {
      capturedOtpFromResend = code;
      return {
        delivered: true,
        provider: 'resend',
        detail: 'Dispatched via Resend transactional email API.',
      };
    },
  });

  assert.equal(prodRes.status, 200);
  assert.equal(prodRes.body.success, true);
  assert.equal(prodRes.body.devTestOtpCode, undefined);
  assert.ok(/^\d{6}$/.test(capturedOtpFromResend));
  assert.equal(JSON.stringify(prodRes.body).includes(capturedOtpFromResend), false);

  // Real code sent via Resend verifies cleanly
  const verified = manager.verifyOtp('realuser@example.com', 'uid_real_1', capturedOtpFromResend, 1_700_000_005_000);
  assert.equal(verified.success, true);
  assert.equal(verified.verified, true);

  // 4. processOtpSendRequest in production fails closed (503 EMAIL_DELIVERY_FAILED) if Resend delivery fails, without leaking OTP
  let failedOtp = '';
  const failRes = await processOtpSendRequest({
    email: 'failuser@example.com',
    uid: 'uid_fail_1',
    otpManager: manager,
    nowMs: 1_700_000_000_000,
    env: { NODE_ENV: 'production', ALLOW_SANDBOX_OTP: 'true' },
    sendEmail: async (_email, code) => {
      failedOtp = code;
      return {
        delivered: false,
        provider: 'unconfigured',
        detail: 'External transactional email provider (RESEND_API_KEY or SMTP_WEBHOOK_URL) is not configured in environment variables.',
      };
    },
  });

  assert.equal(failRes.status, 503);
  assert.equal(failRes.body.success, false);
  assert.equal(failRes.body.code, 'EMAIL_DELIVERY_FAILED');
  assert.equal(failRes.body.devTestOtpCode, undefined);
  assert.equal(JSON.stringify(failRes.body).includes(failedOtp), false);
  assert.equal(manager.getStoredRecordForInspection('failuser@example.com'), undefined);

  // 5. Default development (without ALLOW_SANDBOX_OTP=true) must NOT return devTestOtpCode
  const defaultDevRes = await processOtpSendRequest({
    email: 'devdefault@example.com',
    uid: 'uid_dev_1',
    otpManager: manager,
    nowMs: 1_700_000_000_000,
    env: { NODE_ENV: 'development' },
    sendEmail: async () => ({
      delivered: true,
      provider: 'resend',
      detail: 'Dispatched via Resend transactional email API.',
    }),
  });
  assert.equal(defaultDevRes.status, 200);
  assert.equal(defaultDevRes.body.devTestOtpCode, undefined);

  // 6. Explicit development (NODE_ENV=development AND ALLOW_SANDBOX_OTP=true) enables helper
  const explicitDevRes = await processOtpSendRequest({
    email: 'devexplicit@example.com',
    uid: 'uid_dev_2',
    otpManager: manager,
    nowMs: 1_700_000_000_000,
    env: { NODE_ENV: 'development', ALLOW_SANDBOX_OTP: 'true' },
    sendEmail: async () => ({
      delivered: false,
      provider: 'unconfigured',
      detail: 'Unconfigured in test',
    }),
  });
  assert.equal(explicitDevRes.status, 200);
  assert.ok(explicitDevRes.body.devTestOtpCode && /^\d{6}$/.test(explicitDevRes.body.devTestOtpCode));
});

test('Phase 3.1d: Production client code and compiled Vite bundle strip Dev Sandbox OTP banner and Fill Code helper', () => {
  const verifyPageSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/pages/auth/VerifyOtpPage.tsx'),
    'utf-8'
  );
  const authContextSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/lib/authContext.tsx'),
    'utf-8'
  );

  assert.ok(verifyPageSrc.includes('!import.meta.env.PROD'));
  assert.ok(verifyPageSrc.includes("import.meta.env.VITE_ENABLE_DEV_OTP_HELPER === 'true'"));
  assert.ok(authContextSrc.includes('!import.meta.env.PROD'));
  assert.ok(authContextSrc.includes("import.meta.env.VITE_ENABLE_DEV_OTP_HELPER === 'true'"));

  // Ensure neither client file logs OTPs or stores raw OTP codes in localStorage/sessionStorage
  assert.equal(verifyPageSrc.includes('localStorage'), false);
  assert.equal(verifyPageSrc.includes('sessionStorage'), false);
  assert.equal(/console\.(log|warn|error|info|debug)\([^)]*(testCode|devTestOtpCode|fullCode)/i.test(verifyPageSrc), false);
  assert.equal(/localStorage\.setItem\([^)]*(devTestOtpCode|rawCode|otpCode)/i.test(authContextSrc), false);

  // If production dist/assets exists, verify compiled JS chunks do NOT contain the Dev Sandbox OTP UI
  const distAssetsDir = path.resolve(process.cwd(), 'dist/assets');
  if (fs.existsSync(distAssetsDir)) {
    const jsFiles = fs.readdirSync(distAssetsDir).filter((f) => f.endsWith('.js'));
    assert.ok(jsFiles.length > 0, 'Production dist/assets must contain compiled JS files');
    for (const file of jsFiles) {
      const content = fs.readFileSync(path.join(distAssetsDir, file), 'utf-8');
      assert.equal(content.includes('Dev Sandbox OTP'), false, `${file} leaked Dev Sandbox OTP banner`);
      assert.equal(content.includes('dev-otp-banner'), false, `${file} leaked dev-otp-banner testid`);
      assert.equal(content.includes('dev-otp-code'), false, `${file} leaked dev-otp-code testid`);
    }
  }
});

test('Phase 3.2: OTP enforces 60s resend cooldown, 10m expiration, 5-attempt lockout, and rate limiting', () => {
  const manager = new OtpManager();
  let clock = 1_700_000_000_000;
  const email = 'cooldown@company.com';
  const uid = 'usr_otp_02';

  const first = manager.issueOtp(email, uid, clock, true);
  assert.equal(first.success, true);

  // Immediate resend within 60s must be blocked by cooldown
  const blockedResend = manager.issueOtp(email, uid, clock + 15_000, true);
  assert.equal(blockedResend.success, false);
  assert.equal(blockedResend.code, 'COOLDOWN_ACTIVE');
  assert.equal(blockedResend.cooldownSeconds, 45);

  // After 61s, resend succeeds
  clock += OTP_RESEND_COOLDOWN_MS + 1000;
  const second = manager.issueOtp(email, uid, clock, true);
  assert.equal(second.success, true);

  // Exhaust 5 failed verification attempts -> brute-force lockout
  for (let i = 1; i <= 5; i++) {
    const res = manager.verifyOtp(email, uid, '999999', clock + i * 100);
    assert.equal(res.success, false);
    if (i === 5) {
      assert.equal(res.code, 'MAX_ATTEMPTS_EXCEEDED');
      assert.equal(res.remainingAttempts, 0);
    }
  }

  // Even the valid code must now be rejected because max attempts were exceeded
  const afterLockout = manager.verifyOtp(email, uid, second.devTestOtpCode!, clock + 1000);
  assert.equal(afterLockout.success, false);
  assert.equal(afterLockout.code, 'MAX_ATTEMPTS_EXCEEDED');

  // Issue a 3rd code after cooldown and test 10-minute expiration
  clock += OTP_RESEND_COOLDOWN_MS + 1000;
  const third = manager.issueOtp(email, uid, clock, true);
  assert.equal(third.success, true);

  const expiredAttempt = manager.verifyOtp(
    email,
    uid,
    third.devTestOtpCode!,
    clock + OTP_TTL_MS + 1000
  );
  assert.equal(expiredAttempt.success, false);
  assert.equal(expiredAttempt.code, 'EXPIRED');
});

test('Phase 3.3: Guest-to-Account migration transfers ownership, ignores foreign records, prevents duplicates, and recovers from partial failure', async () => {
  const storage = new MemoryStorage();
  const guestUid = 'guest_engineer_demo';
  const authUid = 'user_verified_999';

  // Seed guest code projects (2 owned by guest, 1 owned by a foreign UID)
  storage.setItem(
    `ws_codeProjects_${guestUid}`,
    JSON.stringify([
      { id: 'code_g1', ownerId: guestUid, name: 'Guest API 1', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'code_g2', ownerId: guestUid, name: 'Guest API 2', updatedAt: '2026-01-02T00:00:00Z' },
      { id: 'code_foreign', ownerId: 'someone_else', name: 'Foreign Project' },
    ])
  );

  // Simulate partial failure on 'code_g2' during first migration attempt
  let failOnSecond = true;
  const persistedToCloud: string[] = [];

  const firstRun = await migrateGuestToAuthenticatedAccount({
    guestUid,
    targetUid: authUid,
    storage,
    persistTargetRecord: async (_col, rec) => {
      if (failOnSecond && rec.id === 'code_g2') {
        throw new Error('Simulated transient network interruption');
      }
      persistedToCloud.push(rec.id);
    },
  });

  assert.equal(firstRun.migratedCount, 1);
  assert.equal(firstRun.failedCount, 1);
  assert.equal(firstRun.skippedForeignOwnerCount, 1);

  // Verify 'code_g1' is now in target storage with ownerId === authUid
  const targetAfterFirst = JSON.parse(storage.getItem(`ws_codeProjects_${authUid}`) || '[]');
  assert.equal(targetAfterFirst.length, 1);
  assert.equal(targetAfterFirst[0].id, 'code_g1');
  assert.equal(targetAfterFirst[0].ownerId, authUid);

  // Verify 'code_g2' and 'code_foreign' remained in guest storage
  const guestAfterFirst = JSON.parse(storage.getItem(`ws_codeProjects_${guestUid}`) || '[]');
  assert.equal(guestAfterFirst.length, 2);

  // Retry migration with network restored -> 'code_g2' migrates and 'code_g1' is not duplicated
  failOnSecond = false;
  const secondRun = await migrateGuestToAuthenticatedAccount({
    guestUid,
    targetUid: authUid,
    storage,
    persistTargetRecord: async (_col, rec) => {
      persistedToCloud.push(rec.id);
    },
  });

  assert.equal(secondRun.migratedCount, 1);
  assert.equal(secondRun.failedCount, 0);

  const targetAfterSecond = JSON.parse(storage.getItem(`ws_codeProjects_${authUid}`) || '[]');
  assert.equal(targetAfterSecond.length, 2);
  assert.deepEqual(
    targetAfterSecond.map((r: any) => r.id).sort(),
    ['code_g1', 'code_g2']
  );

  // Running a 3rd time is a complete no-op for guest records
  const thirdRun = await migrateGuestToAuthenticatedAccount({
    guestUid,
    targetUid: authUid,
    storage,
  });
  assert.equal(thirdRun.migratedCount, 0);
});

// ============================================================================
// PHASE 4 — FOUR-AGENT FUNCTIONAL & EXPORT INTEGRITY TESTS
// ============================================================================
test('Phase 4.1 (Agent 1 & Agent 2): ZIP export sanitizes path traversal and packs valid multi-file archives', async () => {
  assert.equal(sanitizeArchivePath('../../etc/passwd'), 'etc/passwd');
  assert.equal(sanitizeArchivePath('/src/../src/index.ts'), 'src/src/index.ts');

  const files = [
    { path: 'package.json', content: '{"name":"demo"}' },
    { path: '../unsafe/src/index.ts', content: 'console.log("ok");' },
  ];

  const buffer = await createProjectZipBuffer(files);
  assert.ok(buffer.byteLength > 50);

  const zip = await JSZip.loadAsync(buffer);
  const entryNames = Object.keys(zip.files);
  assert.ok(entryNames.includes('package.json'));
  assert.ok(entryNames.includes('unsafe/src/index.ts'));
  assert.equal(
    entryNames.some((n) => n.includes('..')),
    false
  );
  const pkgText = await zip.file('package.json')!.async('string');
  assert.equal(pkgText, '{"name":"demo"}');
});

test('Phase 4.2 (Agent 3 · Document Generator): Compiles real OpenXML .docx binary containing edited markdown sections', async () => {
  const editedMarkdown = `# 1. Executive Summary\n\nPlatform reliability reached 99.99% in Q4.\n\n- Zero data loss\n- Sub-10ms latency\n\n## 2. Security Audit\n\nAll sandboxes enforce strict CSP headers.`;
  const parsedSections = parseMarkdownIntoSections(editedMarkdown);
  assert.equal(parsedSections.length, 2);
  assert.equal(parsedSections[0].heading, '1. Executive Summary');
  assert.equal(parsedSections[0].bullets?.length, 2);

  const docxBuffer = await generateDocxBuffer({
    title: 'Q4 Architecture Audit',
    subtitle: 'Technical Documentation',
    category: 'Technical documentation',
    tone: 'Professional',
    author: 'QA Automation',
    sections: [],
    fullMarkdown: editedMarkdown,
  });

  assert.ok(docxBuffer.byteLength > 1000, 'DOCX buffer must be a non-empty binary archive');

  // Verify OpenXML structure inside the .docx ZIP container
  const docxZip = await JSZip.loadAsync(docxBuffer);
  assert.ok(docxZip.file('[Content_Types].xml'));
  assert.ok(docxZip.file('word/document.xml'));

  const documentXml = await docxZip.file('word/document.xml')!.async('string');
  assert.ok(documentXml.includes('Q4 Architecture Audit'));
  assert.ok(documentXml.includes('Platform reliability reached 99.99% in Q4.'));
  assert.ok(documentXml.includes('All sandboxes enforce strict CSP headers.'));
});

test('Phase 4.3 (Agent 4 · Data Cleaner): Executes all 10 deterministic cleaning operations, preserves original dataset, and exports valid CSV/XLSX', () => {
  const rawDataset = [
    {
      id: '1',
      full_name: '  alice WONDERLAND ',
      joined_date: '2025-03-15',
      score: '$1,250.50',
      category: 'vip',
      empty_col: '',
      temp_col: 'discard',
    },
    {
      id: '1',
      full_name: '  alice WONDERLAND ',
      joined_date: '2025-03-15',
      score: '$1,250.50',
      category: 'vip',
      empty_col: '',
      temp_col: 'discard',
    }, // exact duplicate
    {
      id: '',
      full_name: '',
      joined_date: '',
      score: '',
      category: '',
      empty_col: '',
      temp_col: '',
    }, // empty row
    {
      id: '2',
      full_name: 'bob builder',
      joined_date: '2025-04-01',
      score: '', // missing score to be filled by handle_missing
      category: 'standard',
      empty_col: '',
      temp_col: 'discard',
    },
    {
      id: '4',
      full_name: 'charlie chaplin',
      joined_date: '2025-05-20',
      score: '3000',
      category: 'churned', // will be filtered out by filter_rows
      empty_col: '',
      temp_col: 'discard',
    },
  ];

  const snapshotBefore = JSON.stringify(rawDataset);
  const initialStats = calculateDatasetStats(rawDataset);
  assert.equal(initialStats.rowCount, 5);
  assert.equal(initialStats.duplicateRowCount, 1);
  assert.ok(initialStats.totalMissingValues >= 6);
  assert.equal(initialStats.columnTypes['empty_col'], 'empty');

  const operations: CleaningOperation[] = [
    { id: 'op1', type: 'remove_duplicates', params: {}, description: 'Remove duplicates' },
    { id: 'op2', type: 'remove_empty_rows', params: {}, description: 'Remove empty rows' },
    { id: 'op3', type: 'remove_empty_columns', params: {}, description: 'Remove empty columns' },
    { id: 'op4', type: 'trim_whitespace', params: { column: 'ALL' }, description: 'Trim strings' },
    {
      id: 'op5',
      type: 'standardize_text',
      params: { column: 'full_name', caseType: 'titlecase' },
      description: 'Title case names',
    },
    {
      id: 'op6',
      type: 'handle_missing',
      params: { column: 'score', strategy: 'fill_custom', fillValue: '900' },
      description: 'Fill missing score with 900',
    },
    {
      id: 'op7',
      type: 'convert_type',
      params: { column: 'score', targetType: 'number' },
      description: 'Convert score to number',
    },
    {
      id: 'op8',
      type: 'filter_rows',
      params: { column: 'score', operator: 'less_than', value: 2000 },
      description: 'Retain rows with score < 2000',
    },
    {
      id: 'op9',
      type: 'remove_column',
      params: { columnName: 'temp_col' },
      description: 'Remove temporary column',
    },
    {
      id: 'op10',
      type: 'rename_column',
      params: { oldName: 'full_name', newName: 'customer_name' },
      description: 'Rename full_name to customer_name',
    },
  ];

  const result = executeCleaningPipeline(rawDataset, operations);

  // 1. Original dataset immutability check
  assert.equal(
    JSON.stringify(rawDataset),
    snapshotBefore,
    'Original dataset must never be mutated in place'
  );

  // 2. Verify cleaned rows after all 10 operations
  assert.equal(result.cleanedData.length, 2);
  assert.equal(result.cleanedData[0].customer_name, 'Alice Wonderland');
  assert.equal(result.cleanedData[0].joined_date, '2025-03-15');
  assert.equal(result.cleanedData[0].score, 1250.5);
  assert.equal('empty_col' in result.cleanedData[0], false);
  assert.equal('temp_col' in result.cleanedData[0], false);

  assert.equal(result.cleanedData[1].customer_name, 'Bob Builder');
  assert.equal(result.cleanedData[1].joined_date, '2025-04-01');
  assert.equal(result.cleanedData[1].score, 900);

  // 3. Verify CSV & XLSX round-trip serialization
  const csvString = Papa.unparse(result.cleanedData);
  const reparsedCsv = Papa.parse(csvString, { header: true });
  assert.equal(reparsedCsv.data.length, 2);

  const worksheet = XLSX.utils.json_to_sheet(result.cleanedData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Cleaned_Data');
  const xlsxBuf = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const readWb = XLSX.read(xlsxBuf, { type: 'buffer' });
  const xlsxRows = XLSX.utils.sheet_to_json<Record<string, any>>(
    readWb.Sheets[readWb.SheetNames[0]]
  );
  assert.equal(xlsxRows.length, 2);
  assert.equal(xlsxRows[0].customer_name, 'Alice Wonderland');
});
