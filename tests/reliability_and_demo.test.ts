import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

import { createWorkspaceApp } from '../server';
import { PublishedSnapshotStore } from '../src/server/publishedSnapshotStore';
import {
  GeminiRequestManager,
  DEFAULT_AGENT_MAX_OUTPUT_TOKENS,
  parseRetryAfterMs,
} from '../src/server/geminiRequestManager';
import {
  executeWebsiteGeneration,
  HYDROGEN_MODEL_ID,
} from '../src/server/websiteGenerationService';
import {
  generateDemoCodeProject,
  generateDemoCodeModification,
  generateDemoWebsiteProject,
  generateDemoDocumentData,
  interpretDemoCleaningInstruction,
} from '../src/utils/demoModeEngine';
import { compileWebsitePreview } from '../src/utils/reactPreviewCompiler';
import { createProjectZipBuffer } from '../src/utils/zipExport';
import { generateDocxBuffer } from '../src/utils/docxExport';
import {
  buildDatasetProfileForAi,
  calculateDatasetStats,
  executeCleaningPipeline,
} from '../src/utils/dataCleaner';

async function withServer(
  app: ReturnType<typeof createWorkspaceApp>,
  fn: (baseUrl: string) => Promise<void>
) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  try {
    await fn(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('Quota-Safe Gemini Request Manager & API Reliability', () => {
  it('1. Fails fast on HTTP 429 (0 retries), records passive cooldown, and never switches fallback models on 429', async () => {
    let nowMs = 1_700_000_000_000;
    const sleeps: number[] = [];
    const manager = new GeminiRequestManager({
      now: () => nowMs,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      maxTransientRetries: 2,
    });

    let callCount = 0;
    const modelsAttempted: string[] = [];

    const result = await executeWebsiteGeneration({
      input: {
        websiteName: 'QuotaGuardApp',
        category: 'SaaS',
        technology: 'React',
        designDirection: 'Dark',
        description: 'Verify 429 fail-fast behavior.',
      },
      apiKeyConfigured: true,
      model: HYDROGEN_MODEL_ID,
      fallbackModel: 'gemini-4-argon',
      requestManager: manager,
      scopeKey: 'uid:user_429_test',
      generateContent: async (params) => {
        callCount += 1;
        modelsAttempted.push(params.model);
        const err: any = new Error('Quota exhausted 429');
        err.status = 429;
        err.headers = { 'retry-after': '42' };
        throw err;
      },
    });

    assert.equal(result.status, 429);
    assert.equal(result.body.code, 'QUOTA_EXHAUSTED');
    assert.equal(result.body.demoModeAvailable, true);
    assert.equal(result.body.retryAfterSeconds, 42);
    assert.equal(callCount, 1, 'Must never retry or call fallback model on HTTP 429');
    assert.deepEqual(modelsAttempted, [HYDROGEN_MODEL_ID]);
    assert.equal(sleeps.length, 0);

    const diagnostics = manager.getDiagnostics(true);
    assert.equal(diagnostics.aiServiceStatus, 'cooldown');
    assert.ok(diagnostics.modelCooldowns[HYDROGEN_MODEL_ID]);
    assert.equal(diagnostics.modelCooldowns[HYDROGEN_MODEL_ID].cooldownRemainingSeconds, 42);

    // Advance clock past cooldown
    nowMs += 43_000;
    const afterCooldown = manager.getDiagnostics(true);
    assert.equal(afterCooldown.aiServiceStatus, 'available');
  });

  it('2. Performs bounded retry on transient 503 and respects Retry-After cap', async () => {
    const sleeps: number[] = [];
    const manager = new GeminiRequestManager({
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random: () => 0,
      maxTransientRetries: 2,
      baseRetryDelayMs: 250,
    });

    let attempts = 0;
    const res = await manager.execute({
      agentType: 'code_generation',
      scopeKey: 'uid:retry_user',
      model: HYDROGEN_MODEL_ID,
      contents: 'Generate app',
      generateContent: async () => {
        attempts += 1;
        if (attempts === 1) {
          const err: any = new Error('Service Unavailable 503');
          err.status = 503;
          err.headers = { 'retry-after': '2' };
          throw err;
        }
        return { text: '{"ok":true}' };
      },
    });

    assert.equal(attempts, 2);
    assert.deepEqual(sleeps, [2000]);
    assert.equal(res.response.text, '{"ok":true}');

    // Retry-After > 10s must fail quickly without holding HTTP request open
    const longRetryManager = new GeminiRequestManager({
      sleep: async () => {
        throw new Error('Should not sleep >10s');
      },
      maxTransientRetries: 2,
    });

    await assert.rejects(
      () =>
        longRetryManager.execute({
          agentType: 'document_generation',
          scopeKey: 'uid:long_retry',
          model: HYDROGEN_MODEL_ID,
          contents: 'Generate doc',
          generateContent: async () => {
            const err: any = new Error('503 overloaded');
            err.status = 503;
            err.headers = { 'retry-after': '90' };
            throw err;
          },
        }),
      (err: any) => err.status === 503 && err.code === 'MODEL_UNAVAILABLE'
    );

    assert.equal(parseRetryAfterMs({ headers: { 'retry-after': '15' } }), 15_000);
  });

  it('3. Coalesces concurrent identical requests within the same user scope', async () => {
    const manager = new GeminiRequestManager({ enableCache: true });
    let providerCalls = 0;

    let releaseProvider!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });

    const p1 = manager.execute({
      agentType: 'document_generation',
      scopeKey: 'uid:same_user',
      model: HYDROGEN_MODEL_ID,
      contents: 'Same architecture prompt',
      generateContent: async () => {
        providerCalls += 1;
        await gate;
        return { text: '{"title":"Same"}' };
      },
    });

    const p2 = manager.execute({
      agentType: 'document_generation',
      scopeKey: 'uid:same_user',
      model: HYDROGEN_MODEL_ID,
      contents: 'Same architecture prompt',
      generateContent: async () => {
        providerCalls += 1;
        return { text: '{"title":"Duplicate"}' };
      },
    });

    releaseProvider();
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(providerCalls, 1);
    assert.equal(r1.response.text, '{"title":"Same"}');
    assert.equal(r2.response.text, '{"title":"Same"}');
    assert.equal(r2.deduplicated, true);
  });

  it('4. Enforces request timeout and maps to HTTP 504 AI_TIMEOUT with demoModeAvailable', async () => {
    const manager = new GeminiRequestManager({ timeoutMs: 80, maxTransientRetries: 0 });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-timeout-test-'));

    try {
      const app = createWorkspaceApp({
        isProduction: false,
        apiKey: 'test-key',
        requestManager: manager,
        publishedSnapshotStore: new PublishedSnapshotStore({
          persistenceMode: 'development',
          storageFilePath: path.join(tmpDir, 'unused.json'),
        }),
        generateContent: async () => {
          await new Promise((resolve) => setTimeout(resolve, 250));
          return { text: '{}' };
        },
      });

      await withServer(app, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/ai/generate-document`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Timeout Check',
            documentType: 'Technical Project Report',
            pageCount: 'Brief (1-2 pages)',
            prompt: 'Verify timeout mapping.',
          }),
        });
        assert.equal(res.status, 504);
        const body = await res.json();
        assert.equal(body.code, 'AI_TIMEOUT');
        assert.equal(body.demoModeAvailable, true);
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('5. Strictly isolates response cache across verified users and guest sessions', async () => {
    const manager = new GeminiRequestManager({ enableCache: true, cacheTtlMs: 60_000 });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-cache-iso-'));
    let calls = 0;

    try {
      const app = createWorkspaceApp({
        isProduction: false,
        apiKey: 'test-key',
        requestManager: manager,
        verifyToken: async (token) => {
          if (token === 'token_user_a') {
            return { valid: true, uid: 'uid_alpha', email: 'a@test.io', emailVerified: true };
          }
          if (token === 'token_user_b') {
            return { valid: true, uid: 'uid_beta', email: 'b@test.io', emailVerified: true };
          }
          return { valid: false, code: 'INVALID_CLAIMS', error: 'Invalid token' };
        },
        publishedSnapshotStore: new PublishedSnapshotStore({
          persistenceMode: 'development',
          storageFilePath: path.join(tmpDir, 'unused.json'),
        }),
        generateContent: async () => {
          calls += 1;
          return {
            text: JSON.stringify({
              title: `Doc Call #${calls}`,
              subtitle: 'Sub',
              sections: [{ heading: 'Overview', subsections: [{ paragraphs: ['ok'] }] }],
              fullMarkdown: `## Overview\n\nCall ${calls}`,
            }),
          };
        },
      });

      await withServer(app, async (baseUrl) => {
        const payload = JSON.stringify({
          title: 'Identical Title',
          documentType: 'Technical Project Report',
          pageCount: 'Brief (1-2 pages)',
          prompt: 'Identical prompt text.',
        });

        // User A initial request -> provider call #1
        const rA1 = await fetch(`${baseUrl}/api/ai/generate-document`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer token_user_a',
          },
          body: payload,
        });
        const bA1 = await rA1.json();
        assert.equal(rA1.status, 200);
        assert.equal(bA1.cacheHit, false);
        assert.equal(bA1.data.title, 'Doc Call #1');

        // User A repeat -> cache hit (no provider call)
        const rA2 = await fetch(`${baseUrl}/api/ai/generate-document`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer token_user_a',
          },
          body: payload,
        });
        const bA2 = await rA2.json();
        assert.equal(bA2.cacheHit, true);
        assert.equal(bA2.data.title, 'Doc Call #1');
        assert.equal(calls, 1);

        // User B same prompt -> MUST NOT share User A cache (provider call #2)
        const rB1 = await fetch(`${baseUrl}/api/ai/generate-document`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer token_user_b',
          },
          body: payload,
        });
        const bB1 = await rB1.json();
        assert.equal(bB1.cacheHit, false);
        assert.equal(bB1.data.title, 'Doc Call #2');
        assert.equal(calls, 2);

        // Distinct guest sessions do not share cache
        const rG1 = await fetch(`${baseUrl}/api/ai/generate-document`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Workspace-Session': 'guest_tab_1',
          },
          body: payload,
        });
        const bG1 = await rG1.json();
        assert.equal(bG1.cacheHit, false);
        assert.equal(calls, 3);

        const rG2 = await fetch(`${baseUrl}/api/ai/generate-document`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Workspace-Session': 'guest_tab_2',
          },
          body: payload,
        });
        const bG2 = await rG2.json();
        assert.equal(bG2.cacheHit, false);
        assert.equal(calls, 4);
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('6. Bounds /api/ai/modify-code prompt context, configures maxOutputTokens, and exposes passive /api/health diagnostics without secrets', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-health-bounds-'));
    let capturedParams: any = null;

    try {
      const app = createWorkspaceApp({
        isProduction: false,
        apiKey: 'AIzaTestFakeSecretValue123456789',
        publishedSnapshotStore: new PublishedSnapshotStore({
          persistenceMode: 'development',
          storageFilePath: path.join(tmpDir, 'unused.json'),
        }),
        generateContent: async (params) => {
          capturedParams = params;
          return {
            text: JSON.stringify({
              summary: 'Bounded context update',
              affectedFilePaths: ['src/file0.ts'],
              modifiedFiles: [
                {
                  path: 'src/file0.ts',
                  action: 'modified',
                  changeDescription: 'Updated header',
                  content: 'export const v = 2;',
                  language: 'typescript',
                },
              ],
            }),
          };
        },
      });

      await withServer(app, async (baseUrl) => {
        const healthRes = await fetch(`${baseUrl}/api/health`);
        assert.equal(healthRes.status, 200);
        const healthText = await healthRes.text();
        assert.equal(healthText.includes('AIzaTestFakeSecretValue'), false);
        const health = JSON.parse(healthText);
        assert.equal(health.demoModeAvailable, true);
        assert.equal(health.aiServiceStatus, 'available');
        assert.equal(health.aiDiagnostics.requestManagerEnabled, true);
        assert.equal(
          health.aiDiagnostics.maxOutputTokensByAgent.data_cleaning,
          DEFAULT_AGENT_MAX_OUTPUT_TOKENS.data_cleaning
        );

        // Create oversized 20-file payload (~100KB) and verify prompt context stays bounded
        const bigFiles = Array.from({ length: 20 }, (_, i) => ({
          path: `src/file${i}.ts`,
          language: 'typescript',
          content: `// File ${i}\n` + 'x'.repeat(5000),
        }));

        const modRes = await fetch(`${baseUrl}/api/ai/modify-code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectName: 'HugeProject',
            instruction: 'Add audit constant',
            files: bigFiles,
          }),
        });
        assert.equal(modRes.status, 200);
        assert.ok(capturedParams);
        assert.equal(
          capturedParams.config.maxOutputTokens,
          DEFAULT_AGENT_MAX_OUTPUT_TOKENS.code_modification
        );
        assert.ok(
          String(capturedParams.contents).length < 28_000,
          `Expected bounded prompt length < 28000, got ${String(capturedParams.contents).length}`
        );
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Offline Demo Mode Across All Four Agents (Zero Live Gemini Calls)', () => {
  it('7. Code Generator Demo Mode generates multi-file projects across languages, computes diff mods, and exports valid ZIP', async () => {
    const tsProj = generateDemoCodeProject({
      projectName: 'LedgerAPI',
      language: 'TypeScript',
      framework: 'Express.js + TS',
      database: 'PostgreSQL',
    });
    assert.ok(tsProj.files.length >= 5);
    assert.ok(tsProj.files.some((f) => f.path === 'src/index.ts'));

    const pyProj = generateDemoCodeProject({
      projectName: 'FastBilling',
      language: 'Python',
      framework: 'FastAPI',
      database: 'SQLite',
    });
    assert.ok(pyProj.files.some((f) => f.path === 'app/main.py'));
    assert.ok(pyProj.files.some((f) => f.path === 'requirements.txt'));

    const diff = generateDemoCodeModification({
      instruction: 'Add rate limiter guard',
      files: tsProj.files,
    });
    assert.equal(diff.modifiedFiles.length, 2);
    assert.ok(diff.summary.includes('[Demo Mode]'));

    // Simulate file edit + ZIP archive verification
    const editedFiles = tsProj.files.map((f) =>
      f.path === 'src/index.ts' ? { ...f, content: `${f.content}\n// edited\n` } : f
    );
    const zipBytes = await createProjectZipBuffer(editedFiles);
    const loadedZip = await JSZip.loadAsync(zipBytes);
    assert.ok(loadedZip.file('src/index.ts'));
    const unzippedIndex = await loadedZip.file('src/index.ts')!.async('string');
    assert.ok(unzippedIndex.includes('// edited'));
  });

  it('8. Website Generator Demo Mode builds valid React/Vite & HTML/CSS/JS bundles that compile cleanly and export valid ZIP', async () => {
    const reactDemo = generateDemoWebsiteProject({
      websiteName: 'DemoCloudReact',
      category: 'SaaS',
      technology: 'React',
      designDirection: 'Dark',
    });
    const reactCompiled = compileWebsitePreview(
      reactDemo.fileManifest,
      reactDemo.technology,
      reactDemo.websiteName,
      'tok_react_demo'
    );
    assert.equal(reactCompiled.success, true, `Errors: ${JSON.stringify(reactCompiled.errors)}`);
    assert.ok(reactCompiled.compiledHtml.includes('DemoCloudReact'));

    const htmlDemo = generateDemoWebsiteProject({
      websiteName: 'DemoStaticSite',
      category: 'Portfolio',
      technology: 'HTML / CSS / JS',
      designDirection: 'Light',
    });
    assert.equal(htmlDemo.technology, 'HTML / CSS / JS');
    const htmlCompiled = compileWebsitePreview(
      htmlDemo.fileManifest,
      htmlDemo.technology,
      htmlDemo.websiteName,
      'tok_html_demo'
    );
    assert.equal(htmlCompiled.success, true, `Errors: ${JSON.stringify(htmlCompiled.errors)}`);
    assert.ok(htmlCompiled.compiledHtml.includes('DemoStaticSite'));
    // Zero external HTTP asset leaks in demo static bundle
    assert.equal(/https?:\/\//i.test(htmlDemo.fileManifest.map((f) => f.content).join('\n')), false);

    const zipBytes = await createProjectZipBuffer(htmlDemo.fileManifest);
    const zip = await JSZip.loadAsync(zipBytes);
    assert.ok(zip.file('index.html'));
    assert.ok(zip.file('styles.css'));
    assert.ok(zip.file('app.js'));
  });

  it('9. Document Generator Demo Mode adapts to Brief vs Detailed length and compiles valid OpenXML .docx archive', async () => {
    const briefDoc = generateDemoDocumentData({
      title: 'Quick Status Memo',
      documentType: 'Project Proposal',
      pageCount: 'Brief (1-2 pages)',
      prompt: 'Summarize Q3 deliverables.',
    });
    const detailedDoc = generateDemoDocumentData({
      title: 'Comprehensive Cloud Spec',
      documentType: 'System Architecture Document',
      pageCount: 'Detailed (6-10 pages)',
      prompt: 'Cover security, failover, and trade-offs.',
    });

    assert.ok(detailedDoc.fullMarkdown.length > briefDoc.fullMarkdown.length);
    assert.ok(detailedDoc.fullMarkdown.includes('## 4. Reliability'));

    const editedMd = `${detailedDoc.fullMarkdown}\n\n## 6. Reviewer Sign-off\n\nApproved in Demo Mode.`;
    const docxBuf = await generateDocxBuffer({
      title: detailedDoc.title,
      subtitle: detailedDoc.subtitle,
      category: detailedDoc.category,
      tone: detailedDoc.length,
      sections: [],
      fullMarkdown: editedMd,
    });
    const zip = await JSZip.loadAsync(docxBuf);
    const xml = await zip.file('word/document.xml')!.async('string');
    assert.ok(xml.includes('Approved in Demo Mode.'));
    assert.ok(xml.includes('<w:tbl>'));
  });

  it('10. Data Cleaner Demo Mode interprets commands deterministically, guards columns/ambiguity, preserves originalData, and exports CSV/XLSX', () => {
    const rawRows = [
      { id: 1, customer_name: '  Alice  ', age: 30, status: 'active', email: 'alice@ok.io' },
      { id: 1, customer_name: '  Alice  ', age: 30, status: 'active', email: 'alice@ok.io' },
      { id: 2, customer_name: '  Bob ', age: null, status: 'in-active', email: 'bad-email' },
    ];
    const snapshot = JSON.stringify(rawRows);
    const stats = calculateDatasetStats(rawRows);
    const profile = buildDatasetProfileForAi(rawRows, 'customers.csv', 6, stats);

    // Rejects vague prompt without changing data
    const vague = interpretDemoCleaningInstruction('clean the data', profile);
    assert.equal(vague.status, 'needs_clarification');
    assert.equal(vague.operations.length, 0);

    // Rejects nonexistent column cleanly
    const missingCol = interpretDemoCleaningInstruction('fill missing salary with mean', profile);
    assert.equal(missingCol.status, 'invalid_column');
    assert.ok(missingCol.explanation.includes('salary'));
    assert.equal(missingCol.operations.length, 0);

    // Executes compound command
    const ready = interpretDemoCleaningInstruction(
      'Remove duplicate rows, trim whitespace, fill missing age with mean',
      profile
    );
    assert.equal(ready.status, 'ready');
    assert.equal(ready.executionMode, 'demo');
    assert.equal(ready.operations.length, 3);

    const cleaned = executeCleaningPipeline(rawRows, ready.operations);
    assert.equal(JSON.stringify(rawRows), snapshot, 'Original dataset must remain untouched');
    assert.equal(cleaned.duplicatesRemoved, 1);
    assert.equal(cleaned.cleanedData.length, 2);
    assert.equal(cleaned.cleanedData[0].customer_name, 'Alice');
    assert.equal(cleaned.cleanedData[1].age, 30);

    // Valid CSV & XLSX export checks
    const csv = Papa.unparse(cleaned.cleanedData);
    assert.ok(csv.includes('Alice'));
    const ws = XLSX.utils.json_to_sheet(cleaned.cleanedData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Cleaned');
    const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    assert.ok(xlsxBuf.byteLength > 400);
  });

  it('11. Demo Mode engine never invokes global fetch or Gemini API endpoints', () => {
    const originalFetch = globalThis.fetch;
    let fetchInvoked = false;
    globalThis.fetch = (async () => {
      fetchInvoked = true;
      throw new Error('fetch must not be called in Demo Mode');
    }) as typeof fetch;

    try {
      generateDemoCodeProject({ projectName: 'OfflineCode', language: 'JavaScript' });
      generateDemoWebsiteProject({ websiteName: 'OfflineWeb', technology: 'React' });
      generateDemoDocumentData({ title: 'OfflineDoc', prompt: 'Offline test' });
      interpretDemoCleaningInstruction('trim whitespace', {
        columns: ['name'],
        columnTypes: { name: 'string' },
        sampleRows: [{ name: ' test ' }],
      });
      assert.equal(fetchInvoked, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
