import test, { describe, it } from 'node:test';
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
  buildDatasetProfileForAi,
  calculateDatasetStats,
  executeCleaningPipeline,
  normalizeDateString,
  normalizeCategories,
  removeInvalidEmails,
  removeOutliers,
  standardizeDateColumn,
  trimWhitespace,
  CleaningOperation,
} from '../src/utils/dataCleaner';
import { validateCleaningPlan } from '../src/server/dataCleaningPlanner';
import { generateDocxBuffer, parseMarkdownIntoSections } from '../src/utils/docxExport';

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

describe('Natural-Language Data Cleaner Engine & Planner', () => {
  it('1. Trims whitespace ONLY when asked and preserves original dataset untouched', () => {
    const raw = [
      { id: 1, name: '  Alice  ', status: 'active', email: 'alice@example.com' },
      { id: 1, name: '  Alice  ', status: 'active', email: 'alice@example.com' }, // duplicate intentionally kept when only trim is requested
      { id: 2, name: '  Bob', status: 'ACTIVE', email: '' },
    ];
    const snapshot = JSON.stringify(raw);

    const plan = validateCleaningPlan(
      {
        status: 'ready',
        explanation: 'Trim leading and trailing whitespace from all text columns.',
        operations: [
          {
            type: 'trim_whitespace',
            description: 'Trim whitespace across text fields',
            column: 'ALL',
          },
        ],
      },
      ['id', 'name', 'status', 'email']
    );

    assert.equal(plan.status, 'ready');
    assert.equal(plan.operations.length, 1);
    assert.equal(plan.operations[0].type, 'trim_whitespace');

    const res = executeCleaningPipeline(raw, plan.operations);
    // Original preserved
    assert.equal(JSON.stringify(raw), snapshot);
    // Duplicates NOT removed because user only asked for whitespace trimming
    assert.equal(res.cleanedData.length, 3);
    assert.equal(res.duplicatesRemoved, 0);
    assert.equal(res.affectedCells, 3);
    assert.equal(res.cleanedData[0].name, 'Alice');
    assert.equal(res.cleanedData[2].name, 'Bob');
    // Casing untouched
    assert.equal(res.cleanedData[2].status, 'ACTIVE');
  });

  it('2. Rejects non-existent columns and handles ambiguous requests without mutating data', () => {
    const columns = ['id', 'customer_name', 'age', 'email'];

    const missingColPlan = validateCleaningPlan(
      {
        status: 'ready',
        explanation: 'Fill missing salary with mean.',
        operations: [
          {
            type: 'handle_missing',
            description: 'Fill missing salary with mean',
            column: 'salary',
            strategy: 'fill_mean',
          },
        ],
      },
      columns
    );
    assert.equal(missingColPlan.status, 'invalid_column');
    assert.equal(missingColPlan.operations.length, 0);
    assert.ok(missingColPlan.explanation.includes('salary'));
    assert.ok(missingColPlan.clarificationQuestion?.includes('customer_name'));

    const ambiguousPlan = validateCleaningPlan(
      {
        status: 'needs_clarification',
        explanation: 'The request is too broad to safely transform the dataset.',
        clarificationQuestion: 'Which columns and cleaning rules should be applied?',
        operations: [],
      },
      columns
    );
    assert.equal(ambiguousPlan.status, 'needs_clarification');
    assert.equal(ambiguousPlan.operations.length, 0);

    // Reject unknown/disallowed operation types
    const disallowedPlan = validateCleaningPlan(
      {
        status: 'ready',
        explanation: 'Run eval script',
        operations: [{ type: 'exec_js', description: 'bad', column: 'age' }],
      },
      columns
    );
    assert.equal(disallowedPlan.status, 'needs_clarification');
    assert.equal(disallowedPlan.operations.length, 0);
  });

  it('3. Executes median, mode, date standardization, category normalization, invalid emails, outliers, and expanded filters accurately', () => {
    // Date parsing without UTC off-by-one shift
    assert.equal(normalizeDateString('01/22/2025'), '2025-01-22');
    assert.equal(normalizeDateString('March 5, 2025'), '2025-03-05');
    assert.equal(normalizeDateString('2025/02/19'), '2025-02-19');

    const dataset = [
      { id: 1, age: 20, city: 'ny', status: 'active', email: 'a@test.com', signup_date: '01/22/2025', spend: 100 },
      { id: 2, age: 30, city: 'ny', status: 'ACTIVE', email: 'b@test.com', signup_date: 'March 5, 2025', spend: 110 },
      { id: 3, age: 40, city: 'la', status: 'in-active', email: 'bad-email', signup_date: '2025/02/19', spend: 105 },
      { id: 4, age: 50, city: 'ny', status: 'Active', email: 'd@test.com', signup_date: '2025-04-01', spend: 120 },
      { id: 5, age: null, city: '', status: 'active', email: 'e@test.com', signup_date: '2025-05-01', spend: 50000 }, // outlier + missing age/city
    ];

    // Invalid emails
    const emailRes = removeInvalidEmails(dataset, 'email', 'drop_row');
    assert.equal(emailRes.invalidCount, 1);
    assert.equal(emailRes.data.length, 4);

    // Date standardization
    const dateRes = standardizeDateColumn(dataset, 'signup_date');
    assert.equal(dateRes.data[0].signup_date, '2025-01-22');
    assert.equal(dateRes.data[1].signup_date, '2025-03-05');
    assert.equal(dateRes.data[2].signup_date, '2025-02-19');

    // Category normalization
    const catRes = normalizeCategories(dataset, 'status', {
      active: 'Active',
      'in-active': 'Inactive',
    });
    assert.equal(catRes.data[1].status, 'Active');
    assert.equal(catRes.data[2].status, 'Inactive');

    // Outlier removal (IQR)
    const outlierRes = removeOutliers(dataset, 'spend', 'iqr', 1.5);
    assert.equal(outlierRes.removedCount, 1);
    assert.equal(outlierRes.data.some((r) => r.spend === 50000), false);

    // Combined pipeline: fill_median on age, fill_mode on city, filter_rows >= 30
    const ops: CleaningOperation[] = [
      { id: '1', type: 'handle_missing', params: { column: 'age', strategy: 'fill_median' }, description: 'Median age' },
      { id: '2', type: 'handle_missing', params: { column: 'city', strategy: 'fill_mode' }, description: 'Mode city' },
      { id: '3', type: 'filter_rows', params: { column: 'age', operator: 'greater_or_equal', value: 35 }, description: 'age >= 35' },
    ];
    const pipelineRes = executeCleaningPipeline(dataset, ops);
    assert.equal(pipelineRes.cleanedData.length, 3); // ages 40, 50, and imputed median 35
    assert.equal(pipelineRes.cleanedData[2].age, 35);
    assert.equal(pipelineRes.cleanedData[2].city, 'ny');
  });

  it('4. Handles 5,000-row datasets efficiently and sends only bounded sample rows to AI planner endpoint', async () => {
    const bigRows = Array.from({ length: 5000 }, (_, i) => ({
      id: i + 1,
      customer_name: `  User ${i}  `,
      email: `user${i}@example.com`,
      score: i % 10 === 0 ? null : (i % 100) * 10,
    }));

    const stats = calculateDatasetStats(bigRows);
    const profile = buildDatasetProfileForAi(bigRows, 'large_dataset_5k.csv', 6, stats);
    assert.equal(profile.rowCount, 5000);
    assert.equal(profile.sampleRows.length, 6);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-cleaner-srv-'));
    let capturedPromptText = '';

    try {
      const app = createWorkspaceApp({
        isProduction: false,
        apiKey: 'test-key',
        publishedSnapshotStore: new PublishedSnapshotStore({
          persistenceMode: 'development',
          storageFilePath: path.join(tmpDir, 'unused.json'),
        }),
        generateContent: async (params: any) => {
          capturedPromptText = String(params.contents || '');
          return {
            text: JSON.stringify({
              status: 'ready',
              explanation: 'Trim whitespace across customer_name and fill missing score with mean.',
              operations: [
                {
                  type: 'trim_whitespace',
                  description: 'Trim whitespace on customer_name',
                  columns: ['customer_name'],
                },
                {
                  type: 'handle_missing',
                  description: 'Fill missing score with mean',
                  column: 'score',
                  strategy: 'fill_mean',
                },
              ],
            }),
          };
        },
      });

      await withServer(app, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/ai/plan-cleaning`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instruction: 'Trim whitespace on customer_name and fill missing score with mean',
            datasetProfile: profile,
          }),
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.success, true);
        assert.equal(body.plan.status, 'ready');
        assert.equal(body.plan.operations.length, 2);

        // Verify prompt did NOT embed 5000 rows
        assert.equal(capturedPromptText.includes('User 4999'), false);
        assert.ok(capturedPromptText.includes('User 0'));

        // Execute planned operations locally on 5,000 rows and measure speed
        const start = Date.now();
        const cleaned = executeCleaningPipeline(bigRows, body.plan.operations);
        const elapsedMs = Date.now() - start;
        assert.ok(elapsedMs < 1000, `Expected <1000ms for 5000 rows, took ${elapsedMs}ms`);
        assert.equal(cleaned.cleanedData.length, 5000);
        assert.equal(cleaned.cleanedData[0].customer_name, 'User 0');
        assert.equal(cleaned.missingValuesHandled, 500);

        // CSV & XLSX export sanity check
        const csvOut = Papa.unparse(cleaned.cleanedData.slice(0, 50));
        assert.ok(csvOut.includes('User 0'));

        const ws = XLSX.utils.json_to_sheet(cleaned.cleanedData.slice(0, 50));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Cleaned');
        const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        assert.ok(xlsxBuf.byteLength > 500);
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Prompt-Driven Document Generator & OpenXML DOCX Tables/Lists', () => {
  it('5. Generates structured DOCX with native Word tables, numbered lists, and bullets', async () => {
    const md = `# Architecture Review

## 1. System Modules

Overview of **AI Engineering Workspace** agents.

| Agent | Role | Output |
| --- | --- | --- |
| Code Generator | Multi-file software | ZIP |
| Data Cleaner | NL cleaning | CSV / XLSX |

## 2. Deployment Steps

1. Validate environment secrets on startup.
2. Compile TypeScript and Vite production bundles.

- Zero client API keys
- Owner-scoped Firestore rules`;

    const sections = parseMarkdownIntoSections(md);
    assert.equal(sections.length, 3);
    assert.equal(sections[1].tables?.length, 1);
    assert.deepEqual(sections[1].tables?.[0].headers, ['Agent', 'Role', 'Output']);
    assert.equal(sections[2].numberedItems?.length, 2);
    assert.equal(sections[2].bullets?.length, 2);

    const buf = await generateDocxBuffer({
      title: 'Architecture Review',
      subtitle: 'Technical Project Report',
      category: 'Technical Project Report',
      tone: 'Standard (3-5 pages)',
      sections: [],
      fullMarkdown: md,
    });

    const zip = await JSZip.loadAsync(buf);
    const docXml = await zip.file('word/document.xml')!.async('string');
    assert.ok(docXml.includes('<w:tbl>'), 'word/document.xml must contain native OpenXML <w:tbl>');
    assert.ok(docXml.includes('Code Generator'));
    assert.ok(docXml.includes('<w:numPr>'), 'word/document.xml must contain numbered/bullet list XML');
    assert.ok(docXml.includes('Validate environment secrets on startup.'));
  });

  it('6. Server /api/ai/generate-document accepts prompt-driven payload and validates required fields', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-doc-srv-'));
    try {
      const app = createWorkspaceApp({
        isProduction: false,
        apiKey: 'test-key',
        publishedSnapshotStore: new PublishedSnapshotStore({
          persistenceMode: 'development',
          storageFilePath: path.join(tmpDir, 'unused.json'),
        }),
        generateContent: async () => ({
          text: JSON.stringify({
            title: 'Cloud Migration Architecture',
            subtitle: 'System Architecture Document · Detailed (6-10 pages)',
            category: 'System Architecture Document',
            tone: 'AI-Directed',
            sections: [{ heading: '1. Overview', subsections: [{ paragraphs: ['Architecture prose.'] }] }],
            fullMarkdown: '## 1. Overview\n\nArchitecture prose.',
          }),
        }),
      });

      await withServer(app, async (baseUrl) => {
        const missingRes = await fetch(`${baseUrl}/api/ai/generate-document`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Only Title' }),
        });
        assert.equal(missingRes.status, 400);

        const okRes = await fetch(`${baseUrl}/api/ai/generate-document`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Cloud Migration Architecture',
            documentType: 'System Architecture Document',
            pageCount: 'Detailed (6-10 pages)',
            prompt: 'Document our migration architecture, failover tables, and assumptions.',
          }),
        });
        assert.equal(okRes.status, 200);
        const body = await okRes.json();
        assert.equal(body.success, true);
        assert.ok(body.data.fullMarkdown.includes('Architecture prose.'));
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
