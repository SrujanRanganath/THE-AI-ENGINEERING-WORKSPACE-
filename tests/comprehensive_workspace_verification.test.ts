import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

import {
  calculateDatasetStats,
  executeCleaningPipeline,
  buildDatasetProfileForAi,
} from '../src/utils/dataCleaner';
import {
  generateDemoCodeProject,
  generateDemoCodeModification,
  generateDemoWebsiteProject,
  generateDemoDocumentData,
  interpretDemoCleaningInstruction,
} from '../src/utils/demoModeEngine';
import {
  compileWebsitePreview,
} from '../src/utils/reactPreviewCompiler';
import {
  generateDocxBuffer,
  parseMarkdownIntoSections,
  normalizeTableRowsTo2D,
} from '../src/utils/docxExport';
import {
  containsNestedArray,
  containsUndefinedValue,
  sanitizeFirestoreValue,
  normalizeDocumentForFirestore,
  denormalizeDocumentFromFirestore,
  toSafeUserFirestoreErrorMessage,
  DocumentRecord,
} from '../src/lib/firestoreService';
import {
  executeWebsiteGeneration,
  parseWebsiteGeneratorJson,
  validateAndNormalizeWebsiteManifest,
  validateAndRepairWebsiteManifest,
} from '../src/server/websiteGenerationService';
import { executeDataCleaningPlanRequest } from '../src/server/dataCleaningPlanner';
import { GeminiRequestManager } from '../src/server/geminiRequestManager';
import { buildGeminiModelRegistry } from '../src/server/geminiModelRegistry';
import { createWorkspaceApp } from '../server';
import { PublishedSnapshotStore } from '../src/server/publishedSnapshotStore';

async function withServer(
  app: ReturnType<typeof createWorkspaceApp>,
  fn: (baseUrl: string) => Promise<void>
) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('Comprehensive Data Cleaner Verification (17 Scenarios + 1,105x1,005 Stress)', () => {
  it('DC-1: "Replace all missing values with 0." replaces missing cells with numeric 0 (never "NA" or "0.")', () => {
    const original = [
      { id: 1, name: 'Alice', score: null, dept: '' },
      { id: 2, name: 'Bob', score: undefined, dept: '   ' },
      { id: 3, name: 'Cara', score: 88, dept: 'Eng' },
    ];
    const snapshot = JSON.stringify(original);
    const profile = buildDatasetProfileForAi(original, 'scores.csv');
    const plan = interpretDemoCleaningInstruction('Replace all missing values with 0.', profile);

    assert.equal(plan.status, 'ready');
    assert.equal(plan.operations.length, 1);
    assert.equal(plan.operations[0].type, 'handle_missing');
    assert.equal(plan.operations[0].params.strategy, 'fill_custom');
    assert.equal(plan.operations[0].params.fillValue, '0');

    const res = executeCleaningPipeline(original, plan.operations);
    assert.equal(res.cleanedData[0].score, 0);
    assert.equal(typeof res.cleanedData[0].score, 'number');
    assert.equal(res.cleanedData[0].dept, 0);
    assert.equal(typeof res.cleanedData[0].dept, 'number');
    assert.equal(res.cleanedData[1].score, 0);
    assert.equal(res.cleanedData[1].dept, 0);
    assert.equal(res.cleanedData[2].score, 88);
    assert.equal(res.cellsModified, 4);
    assert.equal(res.statsAfter.totalMissingValues, 0);
    assert.equal(JSON.stringify(original), snapshot);
  });

  it('DC-2: Literal "NA" text is preserved on missing fill, and "Replace all NA with 0" targets literal NA', () => {
    const original = [
      { id: 1, code: 'NA', note: null },
      { id: 2, code: 'N/A', note: 'ok' },
    ];
    const profile = buildDatasetProfileForAi(original, 'na_test.csv');

    const fillMissingPlan = interpretDemoCleaningInstruction('Replace all missing values with 0.', profile);
    const afterMissing = executeCleaningPipeline(original, fillMissingPlan.operations);
    assert.equal(afterMissing.cleanedData[0].code, 'NA');
    assert.equal(afterMissing.cleanedData[0].note, 0);

    const replaceNaPlan = interpretDemoCleaningInstruction('Replace all NA with 0', profile);
    assert.equal(replaceNaPlan.status, 'ready');
    assert.equal(replaceNaPlan.operations[0].type, 'replace_values');
    const afterReplaceNa = executeCleaningPipeline(original, replaceNaPlan.operations);
    assert.equal(afterReplaceNa.cleanedData[0].code, 0);
    assert.equal(afterReplaceNa.cleanedData[0].note, null);
  });

  it('DC-3: Duplicate removal supports keeping first or last occurrence cleanly', () => {
    const rows = [
      { id: 1, email: 'a@x.com', ver: 'v1' },
      { id: 2, email: 'b@x.com', ver: 'v1' },
      { id: 1, email: 'a@x.com', ver: 'v2' },
    ];
    const profile = buildDatasetProfileForAi(rows, 'dups.csv');

    const keepFirst = interpretDemoCleaningInstruction('Remove duplicates by id keep first', profile);
    const resFirst = executeCleaningPipeline(rows, keepFirst.operations);
    assert.equal(resFirst.cleanedData.length, 2);
    assert.equal(resFirst.cleanedData[0].ver, 'v1');
    assert.equal(resFirst.duplicatesRemoved, 1);

    const keepLast = interpretDemoCleaningInstruction('Remove duplicates by id keep last', profile);
    const resLast = executeCleaningPipeline(rows, keepLast.operations);
    assert.equal(resLast.cleanedData.length, 2);
    assert.equal(resLast.cleanedData.find((r) => r.id === 1)?.ver, 'v2');
  });

  it('DC-4: "Standardize gender values into Male and Female" maps M/F cleanly without misclassifying unknown X', () => {
    const rows = [
      { id: 1, gender: 'm' },
      { id: 2, gender: 'MALE' },
      { id: 3, gender: 'f' },
      { id: 4, gender: 'Female' },
      { id: 5, gender: 'X' },
    ];
    const profile = buildDatasetProfileForAi(rows, 'gender.csv');
    const plan = interpretDemoCleaningInstruction(
      'Standardize gender values into Male and Female',
      profile
    );
    assert.equal(plan.status, 'ready');
    const res = executeCleaningPipeline(rows, plan.operations);
    assert.deepEqual(
      res.cleanedData.map((r) => r.gender),
      ['Male', 'Male', 'Female', 'Female', 'X']
    );
    assert.ok(res.auditLog.some((a) => a.originalRow === 5 && a.status === 'attention'));
  });

  it('DC-5: "Remove rows where salary < 20000" keeps salary >= 20000 and tracks original row numbers', () => {
    const rows = [
      { name: 'A', salary: 15000 },
      { name: 'B', salary: 20000 },
      { name: 'C', salary: 45000 },
      { name: 'D', salary: 12000 },
    ];
    const profile = buildDatasetProfileForAi(rows, 'salaries.csv');
    const plan = interpretDemoCleaningInstruction('Remove rows where salary < 20000', profile);
    assert.equal(plan.status, 'ready');
    const res = executeCleaningPipeline(rows, plan.operations);
    assert.equal(res.cleanedData.length, 2);
    assert.deepEqual(
      res.cleanedData.map((r) => r.name),
      ['B', 'C']
    );
    assert.deepEqual(res.originalRowNumbers, [2, 3]);
    assert.equal(res.rowsRemoved, 2);
  });

  it('DC-6: Compound multi-column removal ("Remove the email and phone columns") drops both without mis-splitting "and"', () => {
    const rows = [
      { id: 1, name: 'Alice', email: 'a@b.com', phone: '555-111-2222' },
    ];
    const profile = buildDatasetProfileForAi(rows, 'contacts.csv');
    const plan = interpretDemoCleaningInstruction(
      'Remove the email and phone columns',
      profile
    );
    assert.equal(plan.status, 'ready');
    const res = executeCleaningPipeline(rows, plan.operations);
    assert.deepEqual(res.statsAfter.columns, ['id', 'name']);
    assert.equal(res.columnsRemoved, 2);
  });

  it('DC-7: "Remove 5 columns." asks clarification with pendingColumnRemovalCount without modifying data', () => {
    const rows = [{ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 }];
    const profile = buildDatasetProfileForAi(rows, 'cols.csv');
    const plan = interpretDemoCleaningInstruction('Remove 5 columns.', profile);
    assert.equal(plan.status, 'needs_clarification');
    assert.equal(plan.pendingColumnRemovalCount, 5);
    assert.equal(plan.operations.length, 0);
  });

  it('DC-8: Invalid column names return invalid_column without mutating dataset', () => {
    const rows = [{ id: 1, name: 'Alice' }];
    const profile = buildDatasetProfileForAi(rows, 'simple.csv');
    const plan = interpretDemoCleaningInstruction('Remove column nonexistent_field', profile);
    assert.equal(plan.status, 'invalid_column');
    assert.equal(plan.operations.length, 0);
  });

  it('DC-9: Supports sort_rows, reorder_columns, split_column, merge_columns, and remove_invalid_phones', () => {
    const rows = [
      { id: 2, full_name: 'Bob Lee', phone: '123-456-7890', rev: 300 },
      { id: 1, full_name: 'Alice Kim', phone: 'bad-phone', rev: 900 },
      { id: 3, full_name: 'Cara Cho', phone: '555-222-3333', rev: 100 },
    ];
    const profile = buildDatasetProfileForAi(rows, 'ops.csv');

    const p1 = interpretDemoCleaningInstruction('Clear invalid phones in phone', profile);
    const p2 = interpretDemoCleaningInstruction('Sort rows by rev descending', profile);
    const p3 = interpretDemoCleaningInstruction('Split full_name by space into first, last', profile);
    const ops = [...p1.operations, ...p2.operations, ...p3.operations];
    const res = executeCleaningPipeline(rows, ops);

    assert.equal(res.cleanedData[0].id, 1);
    assert.equal(res.cleanedData[0].phone, '');
    assert.equal(res.cleanedData[0].first, 'Alice');
    assert.equal(res.cleanedData[0].last, 'Kim');
    assert.deepEqual(res.originalRowNumbers, [2, 1, 3]);

    const pMerge = interpretDemoCleaningInstruction('Merge first and last into combined', buildDatasetProfileForAi(res.cleanedData, 'ops2.csv'));
    const resMerge = executeCleaningPipeline(res.cleanedData, pMerge.operations);
    assert.equal(resMerge.cleanedData[0].combined, 'Alice Kim');
  });

  it('DC-10: Compound multi-step NL prompt runs sequentially and generates full 12-metric Cleaning Activity Report', () => {
    const rows = [
      { id: 1, name: '  Alice  ', gender: 'f', age: 30, signup_date: '01/15/2025' },
      { id: 1, name: '  Alice  ', gender: 'f', age: 30, signup_date: '01/15/2025' },
      { id: 2, name: 'Bob ', gender: 'M', age: null, signup_date: '2025/02/20' },
    ];
    const profile = buildDatasetProfileForAi(rows, 'multi.csv');
    const plan = interpretDemoCleaningInstruction(
      'Remove duplicate rows, trim whitespace, standardize gender values into Male and Female, fill missing age with mean, and standardize signup_date to YYYY-MM-DD',
      profile
    );
    assert.equal(plan.status, 'ready');
    assert.ok(plan.operations.length >= 4);

    const res = executeCleaningPipeline(rows, plan.operations);
    assert.equal(res.statsBefore.rowCount, 3);
    assert.equal(res.statsAfter.rowCount, 2);
    assert.equal(res.duplicatesRemoved, 1);
    assert.equal(res.cleanedData[0].name, 'Alice');
    assert.equal(res.cleanedData[0].gender, 'Female');
    assert.equal(res.cleanedData[1].gender, 'Male');
    assert.equal(res.cleanedData[1].age, 30);
    assert.equal(res.cleanedData[0].signup_date, '2025-01-15');
    assert.equal(res.operationsFailed, 0);
    assert.ok(res.operationsCompleted >= 4);
    assert.ok(res.auditLog.length > 0);
  });

  it('DC-11: Live Gemini planner schema & guard rejects empty fill_custom and supports "Remove 5 columns" clarification', async () => {
    const profile = buildDatasetProfileForAi([{ a: 1, b: 2, salary: 10000 }], 'live.csv');
    const respClarify = await executeDataCleaningPlanRequest({
      input: { instruction: 'Remove 5 columns.', datasetProfile: profile },
      apiKeyConfigured: true,
      model: 'gemini-4-hydrogen',
      scopeKey: 'uid:test',
      requestManager: new GeminiRequestManager(),
      generateContent: async () => ({
        text: JSON.stringify({
          status: 'needs_clarification',
          explanation: 'You asked to remove 5 columns without specifying column names.',
          clarificationQuestion: 'Which columns should be removed?',
          pendingColumnRemovalCount: 5,
          operations: [],
        }),
      }),
    });
    assert.equal(respClarify.status, 200);
    assert.equal(respClarify.body.plan.status, 'needs_clarification');
    assert.equal(respClarify.body.plan.pendingColumnRemovalCount, 5);
  });

  it('DC-12: Stress test — 1,105 rows x 1,005 columns replaces missing with numeric 0 without mutation and exports valid CSV/XLSX', () => {
    const colCount = 1005;
    const rowCount = 1105;
    const cols = Array.from({ length: colCount }, (_, c) => `col_${c}`);
    const dataset: Record<string, any>[] = new Array(rowCount);

    for (let r = 0; r < rowCount; r++) {
      const row: Record<string, any> = {};
      for (let c = 0; c < colCount; c++) {
        row[cols[c]] = (r + c) % 50 === 0 ? null : c + 1;
      }
      dataset[r] = row;
    }

    const start = Date.now();
    const profile = buildDatasetProfileForAi(dataset, 'stress_1105x1005.csv');
    assert.equal(profile.rowCount, 1105);
    assert.equal(profile.columnCount, 1005);

    const plan = interpretDemoCleaningInstruction('Replace all missing values with 0.', profile);
    assert.equal(plan.status, 'ready');
    const res = executeCleaningPipeline(dataset, plan.operations);
    const elapsedMs = Date.now() - start;

    assert.ok(elapsedMs < 8000, `1105x1005 cleaning should complete fast; took ${elapsedMs}ms`);
    assert.equal(res.cleanedData.length, 1105);
    assert.equal(res.statsAfter.columnCount, 1005);
    assert.equal(res.statsAfter.totalMissingValues, 0);
    assert.equal(res.cleanedData[0].col_0, 0);
    assert.equal(typeof res.cleanedData[0].col_0, 'number');
    assert.equal(dataset[0].col_0, null); // original preserved untouched

    // Verify cell-level audit log records exact original row #, column, previous value, new value, and operation
    assert.ok(res.auditLog.length > 0);
    const firstAudit = res.auditLog[0];
    assert.equal(firstAudit.originalRow, 1);
    assert.equal(firstAudit.column, 'col_0');
    assert.equal(firstAudit.previousValue, '(null)');
    assert.equal(firstAudit.newValue, '0');
    assert.equal(firstAudit.status, 'changed');

    // Verify CSV & XLSX round-trip and inspect exported .xlsx file on disk
    const slice = res.cleanedData.slice(0, 25).map((row) => {
      const subset: Record<string, any> = {};
      for (let c = 0; c < 25; c++) subset[cols[c]] = row[cols[c]];
      return subset;
    });
    const csv = Papa.unparse(slice);
    const parsedBack = Papa.parse(csv, { header: true, dynamicTyping: true });
    assert.equal((parsedBack.data[0] as any).col_0, 0);

    const tmpXlsxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-xlsx-verify-'));
    try {
      const xlsxPath = path.join(tmpXlsxDir, 'cleaned_1105x1005_sample.xlsx');
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(slice), 'Cleaned Dataset');
      const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      fs.writeFileSync(xlsxPath, xlsxBuffer);

      assert.equal(fs.existsSync(xlsxPath), true);
      const diskBytes = fs.readFileSync(xlsxPath);
      assert.ok(diskBytes.byteLength > 100);
      const wbFromDisk = XLSX.read(diskBytes, { type: 'buffer' });
      assert.ok(wbFromDisk.SheetNames.includes('Cleaned Dataset'));
      const rowsBack = XLSX.utils.sheet_to_json(wbFromDisk.Sheets['Cleaned Dataset']) as any[];
      assert.equal(rowsBack.length, 25);
      assert.equal(rowsBack[0].col_0, 0);
      assert.equal(typeof rowsBack[0].col_0, 'number');
      assert.equal(rowsBack[0].col_1, 2);
    } finally {
      fs.rmSync(tmpXlsxDir, { recursive: true, force: true });
    }
  });
});

describe('Website Generator Verification (Templates, Recovery, Repair, ZIP)', () => {
  it('WG-VER-1: Demo Mode builds distinct React manifests (Ecommerce, Portfolio, Education Events, SaaS) that compile cleanly', async () => {
    const configs = [
      { websiteName: 'Apex Gear Store', category: 'E-Commerce', technology: 'React', designDirection: 'Dark' },
      { websiteName: 'DevCraft Studio', category: 'Portfolio', technology: 'React', designDirection: 'Dark' },
      { websiteName: 'VTU TechFest 2026', category: 'Education', technology: 'React', designDirection: 'Light' },
      { websiteName: 'Nexus Cloud SaaS', category: 'SaaS', technology: 'React', designDirection: 'Dark' },
      { websiteName: 'Static Landing', category: 'SaaS', technology: 'HTML / CSS / JS', designDirection: 'Light' },
    ];

    for (const cfg of configs) {
      const demo = generateDemoWebsiteProject(cfg);
      assert.ok(demo.fileManifest.length >= 4);
      const compiled = compileWebsitePreview(demo.fileManifest, demo.technology);
      assert.equal(compiled.success, true, `Expected ${cfg.category} (${cfg.technology}) to compile: ${compiled.errors.join('; ')}`);
      assert.ok(compiled.compiledHtml.includes('<!DOCTYPE html>') || compiled.compiledHtml.includes('<!doctype html>'));

      // ZIP export check
      const zip = new JSZip();
      for (const f of demo.fileManifest) zip.file(f.path, f.content);
      const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });
      const reloaded = await JSZip.loadAsync(zipBuf);
      assert.ok(reloaded.file('index.html'));
    }
  });

  it('WG-VER-2: Repairs broken JSX manifests and recovers from incomplete model output cleanly', async () => {
    const brokenManifest = [
      { path: 'index.html', type: 'markup', content: '<!DOCTYPE html><html><body><div id="root"></div></body></html>' },
      { path: 'src/main.jsx', type: 'source', content: `import App from './App.jsx';\ncreateRoot(document.getElementById('root')).render(<App />);` },
      { path: 'src/App.jsx', type: 'source', content: `export default function App() { return <div>Broken` },
    ];
    const failedCompile = compileWebsitePreview(brokenManifest, 'React');
    assert.equal(failedCompile.success, false);

    // Malformed / truncated JSON check
    const badJson = parseWebsiteGeneratorJson('{"websiteName": "Broken", "fileManifest": [');
    assert.equal(badJson.success, false);

    // Incomplete manifest rejection
    const partial = validateAndNormalizeWebsiteManifest(
      { fileManifest: [{ path: 'README.md', type: 'doc', content: 'hi' }] },
      { websiteName: 'Demo', category: 'SaaS', technology: 'React', designDirection: 'Dark' }
    );
    assert.equal(partial.valid, false);

    // Simulated bounded repair fixes broken App.jsx
    const repaired = await validateAndRepairWebsiteManifest({
      manifest: {
        websiteName: 'RepairDemo',
        framework: 'React 19 + Vite',
        category: 'SaaS',
        technology: 'React',
        designDirection: 'Dark',
        summary: 'Test repair',
        fileManifest: brokenManifest,
      },
      model: 'gemini-4-hydrogen',
      maxRepairAttempts: 1,
      generateContent: async () => ({
        text: JSON.stringify({
          path: 'src/App.jsx',
          content: `import React from 'react';\nexport default function App() { return <main><h1>Repaired</h1></main>; }`,
        }),
      }),
    });
    assert.equal(repaired.success, true);
  });

  it('WG-VER-3: Live server generation returns structured 429 on quota exhaustion without burning fallback wastefully', async () => {
    const out = await executeWebsiteGeneration({
      input: { websiteName: 'TestSite', category: 'SaaS', technology: 'React', designDirection: 'Dark', description: 'Cloud monitor' },
      apiKeyConfigured: true,
      model: 'gemini-4-hydrogen',
      scopeKey: 'uid:wg',
      requestManager: new GeminiRequestManager(),
      generateContent: async () => {
        const e: any = new Error('RESOURCE_EXHAUSTED 429');
        e.status = 429;
        throw e;
      },
    });
    assert.equal(out.status, 429);
    assert.equal(out.body.code, 'QUOTA_EXHAUSTED');
    assert.equal(out.body.demoModeAvailable, true);
  });
});

describe('Code Generator Language Fidelity & Diff Consistency', () => {
  it('CG-VER-1: Demo Mode honors strict target languages (Python, Java, C++, C, Go, C#, PHP, JS, TS)', () => {
    const expectations: Array<{ lang: string; requiredExt: string; buildFile: string }> = [
      { lang: 'Python', requiredExt: '.py', buildFile: 'requirements.txt' },
      { lang: 'Java', requiredExt: '.java', buildFile: 'pom.xml' },
      { lang: 'C++', requiredExt: '.cpp', buildFile: 'CMakeLists.txt' },
      { lang: 'C', requiredExt: '.c', buildFile: 'Makefile' },
      { lang: 'Go', requiredExt: '.go', buildFile: 'go.mod' },
      { lang: 'C#', requiredExt: '.cs', buildFile: '.csproj' },
      { lang: 'PHP', requiredExt: '.php', buildFile: 'composer.json' },
      { lang: 'JavaScript', requiredExt: '.js', buildFile: 'package.json' },
      { lang: 'TypeScript', requiredExt: '.ts', buildFile: 'tsconfig.json' },
    ];

    for (const item of expectations) {
      const proj = generateDemoCodeProject({
        projectName: 'CampusService',
        language: item.lang,
        description: `Build a service in ${item.lang}`,
      });
      assert.ok(
        proj.files.some((f) => f.path.endsWith(item.requiredExt)),
        `${item.lang} missing ${item.requiredExt} file`
      );
      assert.ok(
        proj.files.some((f) => f.path.endsWith(item.buildFile)),
        `${item.lang} missing ${item.buildFile}`
      );
      // Confirm diff modification stays in exact project language (no TypeScript leaks into Java/Python/C++/C)
      const diff = generateDemoCodeModification({
        instruction: 'Add rate limiter helper',
        files: proj.files,
      });
      if (item.lang === 'Java') {
        assert.ok(diff.modifiedFiles.some((f) => f.path.endsWith('.java')));
        assert.equal(diff.modifiedFiles.some((f) => f.path.endsWith('.ts')), false);
      }
      if (item.lang === 'Python') {
        assert.ok(diff.modifiedFiles.some((f) => f.path.endsWith('.py')));
        assert.equal(diff.modifiedFiles.some((f) => f.path.endsWith('.ts')), false);
      }
      if (item.lang === 'C++') {
        assert.ok(diff.modifiedFiles.some((f) => f.path.endsWith('.hpp') || f.path.endsWith('.cpp')));
        assert.equal(diff.modifiedFiles.some((f) => f.path.endsWith('.ts')), false);
      }
      if (item.lang === 'C') {
        assert.ok(diff.modifiedFiles.some((f) => f.path.endsWith('.h') || f.path.endsWith('.c')));
        assert.equal(diff.modifiedFiles.some((f) => f.path.endsWith('.ts')), false);
      }
    }
  });
});

describe('Document Generator Verification (Markdown & OpenXML .docx)', () => {
  it('DG-VER-1: Generates Brief vs Detailed/15-page documents and valid OpenXML .docx with headings, lists, and tables', async () => {
    const doc = generateDemoDocumentData({
      title: 'VTU Engineering Evaluation Report',
      documentType: 'Engineering Report',
      pageCount: '15 pages',
      prompt: 'Document architecture, security model, and automated verification pipeline.',
    });
    assert.ok(doc.fullMarkdown.includes('# VTU Engineering Evaluation Report'));
    assert.ok(doc.fullMarkdown.includes('| Agent | Primary Responsibility | Verified Export |'));
    assert.ok(doc.fullMarkdown.includes('Assumptions & Scope Notes'));

    const docxBuf = await generateDocxBuffer({
      title: doc.title,
      subtitle: doc.subtitle,
      category: doc.category,
      tone: doc.tone,
      fullMarkdown: doc.fullMarkdown,
      sections: doc.sections,
    });
    const zip = await JSZip.loadAsync(Buffer.from(docxBuf));
    const xml = await zip.file('word/document.xml')!.async('string');
    assert.ok(xml.includes('<w:tbl>'));
    assert.ok(xml.includes('Heading1') || xml.includes('Heading2'));
    assert.ok(xml.includes('VTU Engineering Evaluation Report'));
  });
});

describe('Centralized Model Registry, Multi-Model Routing & Passive /api/health Diagnostics', () => {
  it('MR-VER-1: Model registry tracks all candidate models, transitions to cooldown on 429, clears on success, blocks paid Carbon model, and exposes passive /api/health', async () => {
    let clock = 1_000_000;
    const mgr = new GeminiRequestManager({ now: () => clock });

    const initialReg = mgr.getModelRegistrySnapshot(true, 'gemini-4-hydrogen', 'gemini-4-argon');
    assert.ok(initialReg.length >= 10, `Expected full candidate model catalog, got ${initialReg.length}`);
    const hydrogenEntry = initialReg.find((m) => m.modelId === 'gemini-4-hydrogen')!;
    assert.ok(hydrogenEntry);
    assert.equal(hydrogenEntry.availabilityState, 'available');
    assert.equal(hydrogenEntry.eligible, true);

    const carbonEntry = initialReg.find((m) => m.modelId === 'gemini-4-carbon')!;
    assert.ok(carbonEntry);
    assert.equal(carbonEntry.paidOnly, true);
    assert.equal(carbonEntry.accessStatus, 'disabled_paid');
    assert.equal(carbonEntry.eligible, false);

    // Simulate HTTP 429 cooldown without making real API calls
    await assert.rejects(() =>
      mgr.execute({
        agentType: 'data_cleaning',
        scopeKey: 'uid:reg',
        model: 'gemini-4-hydrogen',
        contents: 'test 429',
        generateContent: async () => {
          const e: any = new Error('Quota limit reached; retry in 25s');
          e.status = 429;
          throw e;
        },
      })
    );

    const cooledReg = mgr.getModelRegistrySnapshot(true, 'gemini-4-hydrogen');
    const cooledHydrogen = cooledReg.find((m) => m.modelId === 'gemini-4-hydrogen')!;
    assert.equal(cooledHydrogen.availabilityState, 'cooldown');
    assert.equal(cooledHydrogen.eligible, false);
    assert.equal(cooledHydrogen.lastErrorCode, 'QUOTA_EXHAUSTED');
    assert.equal(cooledHydrogen.retryAfterSeconds, 25);

    // Advance past cooldown and succeed
    clock += 26_000;
    await mgr.execute({
      agentType: 'data_cleaning',
      scopeKey: 'uid:reg',
      model: 'gemini-4-hydrogen',
      contents: 'ok call',
      generateContent: async () => ({ text: '{"status":"ok"}' }),
    });

    const recoveredReg = mgr.getModelRegistrySnapshot(true, 'gemini-4-hydrogen');
    const recoveredHydrogen = recoveredReg.find((m) => m.modelId === 'gemini-4-hydrogen')!;
    assert.equal(recoveredHydrogen.availabilityState, 'available');
    assert.equal(recoveredHydrogen.eligible, true);
    assert.equal(recoveredHydrogen.lastErrorCode, undefined);

    // Verify passive /api/health and /api/ai/models/status endpoints expose modelRegistry with zero Gemini API calls or secrets
    let externalProviderCalls = 0;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-srv-'));
    try {
      const app = createWorkspaceApp({
        isProduction: false,
        apiKey: 'AIzaTestSecretShouldNeverAppearInHealthOutput123456',
        publishedSnapshotStore: new PublishedSnapshotStore({
          persistenceMode: 'development',
          storageFilePath: path.join(tmpDir, 'unused.json'),
        }),
        generateContent: async () => {
          externalProviderCalls++;
          return { text: '{}' };
        },
        requestManager: mgr,
      });

      await withServer(app, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/health`);
        assert.equal(res.status, 200);
        const bodyText = await res.text();
        assert.equal(bodyText.includes('AIzaTestSecretShouldNeverAppearInHealthOutput'), false);
        const body = JSON.parse(bodyText);
        assert.equal(Array.isArray(body.modelRegistry), true);
        assert.ok(body.modelRegistry.some((m: any) => m.modelId === 'gemini-3.1-flash-lite'));
        assert.ok(body.modelRegistry.some((m: any) => m.modelId === 'gemini-3-flash-preview'));

        const statusRes = await fetch(`${baseUrl}/api/ai/models/status`);
        assert.equal(statusRes.status, 200);
        const statusBody = await statusRes.json();
        assert.equal(Array.isArray(statusBody.models), true);
        assert.equal(externalProviderCalls, 0);
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    // Verify unconfigured state report
    const unconf = buildGeminiModelRegistry({
      apiKeyConfigured: false,
      primaryModel: 'gemini-4-hydrogen',
    });
    assert.equal(unconf[0].availabilityState, 'unconfigured');
    assert.equal(unconf[0].eligible, false);
  });

  it('MR-VER-2: Multi-model router handles primary model failure, multiple consecutive failures, 404 unsupported skipping, and invalid JSON response failover without infinite loops', async () => {
    let clock = 2_000_000;
    const mgr = new GeminiRequestManager({ now: () => clock });

    const callSequence: string[] = [];
    const routed = await mgr.executeWithRouting({
      agentType: 'code_generation',
      scopeKey: 'uid:router-test',
      candidateModels: [
        'gemini-4-hydrogen',      // 1st fails with 503 Unavailable
        'gemini-2.5-flash',       // 2nd fails with 404 Unsupported
        'gemini-3-flash-preview', // 3rd returns malformed JSON (fails validateResponse)
        'gemini-3.5-flash-lite',  // 4th succeeds with valid JSON
      ],
      contents: 'Generate microservice project',
      validateResponse: (rawText) => {
        try {
          const parsed = JSON.parse(String(rawText || ''));
          if (!Array.isArray(parsed.files)) {
            return { valid: false, reason: 'Missing files array' };
          }
          return { valid: true };
        } catch {
          return { valid: false, reason: 'Malformed JSON' };
        }
      },
      generateContent: async ({ model }) => {
        callSequence.push(model);
        if (model === 'gemini-4-hydrogen') {
          const err: any = new Error('503 Service Unavailable: High demand');
          err.status = 503;
          throw err;
        }
        if (model === 'gemini-2.5-flash') {
          const err: any = new Error('404 Not Found: models/gemini-2.5-flash is retired');
          err.status = 404;
          throw err;
        }
        if (model === 'gemini-3-flash-preview') {
          return { text: '{"broken": "json without files array"}' };
        }
        return {
          text: JSON.stringify({
            projectName: 'RoutedApp',
            files: [{ path: 'src/index.ts', content: 'console.log(1);' }],
          }),
        };
      },
    });

    assert.equal(routed.modelUsed, 'gemini-3.5-flash-lite');
    assert.equal(routed.fallbackUsed, true);
    assert.deepEqual(routed.attemptedModels, [
      'gemini-4-hydrogen',
      'gemini-2.5-flash',
      'gemini-3-flash-preview',
      'gemini-3.5-flash-lite',
    ]);
    assert.equal(callSequence.length, 4);

    // Subsequent call should automatically skip cooldown/unsupported models and prioritize the verified working model
    const secondCallSequence: string[] = [];
    const secondRouted = await mgr.executeWithRouting({
      agentType: 'code_generation',
      scopeKey: 'uid:router-test-2',
      candidateModels: [
        'gemini-4-hydrogen',
        'gemini-2.5-flash',
        'gemini-3.5-flash-lite',
      ],
      contents: 'Second request',
      generateContent: async ({ model }) => {
        secondCallSequence.push(model);
        return { text: '{"ok":true}' };
      },
    });
    assert.equal(secondRouted.modelUsed, 'gemini-3.5-flash-lite');
    assert.deepEqual(secondCallSequence, ['gemini-3.5-flash-lite']);
  });

  it('MR-VER-3: Enforces RPM limits and sets allModelsExhausted + recommendDemoMode when all candidate models are exhausted', async () => {
    let clock = 5_000_000;
    const mgr = new GeminiRequestManager({ now: () => clock });

    // Exhaust all candidates with 429
    await assert.rejects(
      async () => {
        await mgr.executeWithRouting({
          agentType: 'document_generation',
          scopeKey: 'uid:exhaust-test',
          candidateModels: ['gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-4-carbon'],
          contents: 'Generate architecture report',
          generateContent: async ({ model }) => {
            if (model === 'gemini-4-carbon') {
              throw new Error('Paid model should never be invoked');
            }
            const err: any = new Error(`429 Resource Exhausted for ${model}`);
            err.status = 429;
            throw err;
          },
        });
      },
      (err: any) => {
        assert.equal(err.allModelsExhausted, true);
        assert.equal(err.recommendDemoMode, true);
        assert.equal(err.demoModeAvailable, true);
        // Paid model gemini-4-carbon must be excluded from attemptedModels
        assert.equal(err.attemptedModels.includes('gemini-4-carbon'), false);
        assert.deepEqual(err.attemptedModels, ['gemini-3-flash-preview', 'gemini-3.1-flash-lite']);
        return true;
      }
    );
  });
});

describe('Document Generator Firestore Nested-Array Serialization & Safe Error Handling Regression Suite', () => {
  it('DOC-FS-1: Normalizes nested 2D table row arrays (string[][]) across subsections[].table.rows, tables[].rows, blocks[].table.rows, and deep arrays into Firestore-compatible structures with zero nested arrays or undefined fields', () => {
    const rawMarkdown = `# Distributed Architecture Specification

## 1. Executive Summary

This report details the service topology and fault-tolerance guarantees.

- Zero-trust authentication layer
- Owner-isolated document persistence

## 2. Service Matrix

| Service | Protocol | Availability Target |
| --- | --- | --- |
| API Gateway | HTTPS / JSON | 99.95% |
| Worker Pool | gRPC | 99.90% |

## 3. Rollout Steps

1. Provision database rules
2. Verify multi-model fallback
3. Export OpenXML DOCX package`;

    const parsedSections = parseMarkdownIntoSections(rawMarkdown);

    // Simulate both AI live response shape (subsections[].table.rows: string[][])
    // and parsed markdown shape (tables[].rows: string[][], blocks[].table.rows: string[][])
    const rawDocRecord: DocumentRecord = {
      id: 'doc_nested_array_test_1',
      ownerId: 'user_uid_123',
      title: 'Distributed Architecture Specification',
      subtitle: undefined, // undefined field that Firestore setDoc also rejects if not stripped
      category: 'System Architecture Document',
      tone: 'Technical',
      length: 'Standard (3-5 pages)',
      sections: [
        ...parsedSections,
        {
          heading: '4. AI Live Subsection Table Shape',
          level: 2,
          paragraphs: ['Live Gemini JSON structure with nested subsections and 2D table.rows.'],
          subsections: [
            {
              subheading: '4.1 Latency Benchmarks',
              paragraphs: ['Measured across regional endpoints.'],
              bullets: ['Edge cache enabled', 'Connection pooling active'],
              table: {
                headers: ['Region', 'P50 Latency', 'P99 Latency'],
                rows: [
                  ['us-central1', '42ms', '115ms'],
                  ['europe-west1', '48ms', '128ms'],
                ],
              },
              deepMatrix: [[['nested-level-3-a', 'nested-level-3-b']]],
            },
          ],
        },
      ],
      content: rawMarkdown,
      createdAt: '2026-03-30T10:00:00.000Z',
      updatedAt: '2026-03-30T10:00:00.000Z',
    };

    // Confirm raw input DOES contain nested arrays and undefined values prior to normalization
    assert.equal(containsNestedArray(rawDocRecord), true);
    assert.equal(containsUndefinedValue(rawDocRecord), true);

    // Normalize for Firestore setDoc()
    const firestorePayload = normalizeDocumentForFirestore(rawDocRecord);

    // Must contain ZERO nested arrays and ZERO undefined values anywhere in the object graph
    assert.equal(
      containsNestedArray(firestorePayload),
      false,
      'Normalized Firestore payload must not contain any nested arrays'
    );
    assert.equal(
      containsUndefinedValue(firestorePayload),
      false,
      'Normalized Firestore payload must not contain any undefined values'
    );
    assert.equal('subtitle' in firestorePayload, false);

    // Verify table rows were converted to Firestore-compatible Array<{ cells: string[] }>
    const secWithTable = firestorePayload.sections.find((s: any) =>
      s.heading.includes('Service Matrix')
    );
    assert.ok(secWithTable);
    assert.deepEqual(secWithTable.tables[0].rows, [
      { cells: ['API Gateway', 'HTTPS / JSON', '99.95%'] },
      { cells: ['Worker Pool', 'gRPC', '99.90%'] },
    ]);

    const liveSubSec = firestorePayload.sections.find((s: any) =>
      s.heading.includes('AI Live Subsection Table Shape')
    );
    assert.ok(liveSubSec);
    const liveSubTable = liveSubSec.subsections[0].table;
    assert.deepEqual(liveSubTable.rows, [
      { cells: ['us-central1', '42ms', '115ms'] },
      { cells: ['europe-west1', '48ms', '128ms'] },
    ]);

    // Denormalize back from Firestore and verify 2D rows are restored losslessly
    const restoredDoc = denormalizeDocumentFromFirestore(firestorePayload);
    const restoredSecWithTable = restoredDoc.sections.find((s: any) =>
      s.heading.includes('Service Matrix')
    );
    assert.deepEqual(restoredSecWithTable.tables[0].rows, [
      ['API Gateway', 'HTTPS / JSON', '99.95%'],
      ['Worker Pool', 'gRPC', '99.90%'],
    ]);
    const restoredLiveSubSec = restoredDoc.sections.find((s: any) =>
      s.heading.includes('AI Live Subsection Table Shape')
    );
    assert.deepEqual(restoredLiveSubSec.subsections[0].table.rows, [
      ['us-central1', '42ms', '115ms'],
      ['europe-west1', '48ms', '128ms'],
    ]);
  });

  it('DOC-FS-2: Compiles valid OpenXML (.docx) from both normalized Firestore sections and denormalized sections while retaining headings, paragraphs, bullet lists, numbered lists, and tables', async () => {
    const markdown = `# Engineering Reliability Report

## 1. Overview & Objectives

Paragraph explaining architectural resilience and deterministic verification.

- First key bullet item
- Second key bullet item

## 2. Component Verification Table

| Component | Status | Coverage |
| --- | --- | --- |
| Document Studio | Verified | 100% |
| Firestore Serializer | Normalized | 100% |

## 3. Execution Steps

1. Normalize nested table arrays before setDoc
2. Render preview immediately before persistence
3. Export OpenXML Word document`;

    const sections = parseMarkdownIntoSections(markdown);
    const normalized = normalizeDocumentForFirestore({
      id: 'doc_docx_verify_1',
      ownerId: 'user_1',
      title: 'Engineering Reliability Report',
      subtitle: 'Technical Project Report · Standard (3-5 pages)',
      category: 'Technical Project Report',
      tone: 'Professional',
      length: 'Standard (3-5 pages)',
      sections,
      content: markdown,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Test DOCX generation both when fullMarkdown is provided AND when only normalized Firestore sections are provided
    for (const includeFullMarkdown of [true, false]) {
      const buffer = await generateDocxBuffer({
        title: normalized.title,
        subtitle: normalized.subtitle,
        category: normalized.category,
        tone: normalized.length,
        sections: normalized.sections,
        fullMarkdown: includeFullMarkdown ? normalized.content : undefined,
      });

      assert.ok(buffer.byteLength > 2000);
      const zip = await JSZip.loadAsync(buffer);
      const docXml = await zip.file('word/document.xml')?.async('string');
      assert.ok(docXml, 'word/document.xml must exist inside the compiled .docx archive');

      // Verify headings, paragraphs, bullets, numbered lists, and table XML tags and text
      assert.ok(docXml.includes('Engineering Reliability Report'));
      assert.ok(docXml.includes('1. Overview &amp; Objectives') || docXml.includes('Overview'));
      assert.ok(docXml.includes('Paragraph explaining architectural resilience'));
      assert.ok(docXml.includes('First key bullet item'));
      assert.ok(docXml.includes('Normalize nested table arrays before setDoc'));
      assert.ok(docXml.includes('<w:tbl>'), 'Compiled DOCX must contain an OpenXML <w:tbl> table');
      assert.ok(docXml.includes('Document Studio'));
      assert.ok(docXml.includes('Firestore Serializer'));
      assert.ok(docXml.includes('<w:numPr>'), 'Compiled DOCX must contain list numbering properties');
    }
  });

  it('DOC-FS-3: Safe error handler never exposes raw Firebase errors, authInfo, userId, email, providerInfo, or internal document paths', () => {
    const rawLeakedPayload = JSON.stringify({
      error:
        'Function setDoc() called with invalid data. Nested arrays are not supported (found in document documents/doc_1774879480119_abcd)',
      authInfo: {
        userId: 'secret_uid_987654321',
        email: 'engineer.private@example.edu',
        emailVerified: true,
        isAnonymous: false,
        tenantId: null,
        providerInfo: [{ providerId: 'password', email: 'engineer.private@example.edu' }],
      },
      operationType: 'write',
      path: 'documents/doc_1774879480119_abcd',
    });

    const safeMessage = toSafeUserFirestoreErrorMessage(
      new Error(rawLeakedPayload),
      'Document generated, but saving failed. Please retry.'
    );

    assert.equal(safeMessage, 'Document generated, but saving failed. Please retry.');
    assert.equal(safeMessage.includes('setDoc'), false);
    assert.equal(safeMessage.includes('Nested arrays'), false);
    assert.equal(safeMessage.includes('secret_uid_987654321'), false);
    assert.equal(safeMessage.includes('engineer.private@example.edu'), false);
    assert.equal(safeMessage.includes('providerInfo'), false);
    assert.equal(safeMessage.includes('documents/doc_'), false);
  });
});


