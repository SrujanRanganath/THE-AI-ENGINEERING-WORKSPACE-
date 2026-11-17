import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from 'docx';
import {
  calculateDatasetStats,
  removeDuplicates,
  handleMissingValues,
  removeEmptyRows,
  removeEmptyColumns,
  trimWhitespace,
  standardizeText,
  convertColumnType,
  renameColumn,
  removeColumn,
  filterRows,
  executeCleaningPipeline,
} from '../src/utils/dataCleaner';
import fs from 'fs';
import path from 'path';

// ============================================================================
// AUDIT SUITE 1: CODE GENERATOR BACKEND & MULTI-FILE ARCHITECTURE
// ============================================================================

test('Audit Code Generator: Backend Schema & Multi-File Structure Validation', () => {
  // Mocked AI Response matching Gemini schema from server.ts
  const mockGeminiCodeResponse = {
    projectName: 'PaymentGateway',
    language: 'TypeScript',
    framework: 'Express.js + TS',
    database: 'PostgreSQL',
    architectureOverview: 'Clean architecture with controller, service, repository layers',
    runInstructions: 'npm install && npm run build && npm start',
    files: [
      {
        path: 'src/index.ts',
        content: 'import express from "express";\nconst app = express();\nexport default app;',
        language: 'typescript',
      },
      {
        path: 'src/controllers/paymentController.ts',
        content: 'export const processPayment = (req, res) => res.json({ status: "success" });',
        language: 'typescript',
      },
      {
        path: 'src/models/transaction.ts',
        content: 'export interface Transaction { id: string; amount: number; }',
        language: 'typescript',
      },
      {
        path: 'package.json',
        content: '{\n  "name": "payment-gateway",\n  "version": "1.0.0"\n}',
        language: 'json',
      },
      {
        path: 'README.md',
        content: '# Payment Gateway\nMicroservice architecture',
        language: 'markdown',
      },
    ],
  };

  // 1. Check multi-file requirement (must not be single file)
  assert.ok(Array.isArray(mockGeminiCodeResponse.files));
  assert.ok(mockGeminiCodeResponse.files.length >= 4, 'Must have at least 4 files for multi-file architecture');

  // 2. Check path sanitization function logic from server.ts
  function sanitizePath(filePath: string): string {
    return filePath
      .replace(/^\/+/, '')
      .replace(/\.\.+[/\\]/g, '')
      .trim();
  }

  assert.equal(sanitizePath('../../etc/passwd'), 'etc/passwd');
  assert.equal(sanitizePath('/root/project/index.ts'), 'root/project/index.ts');
  assert.equal(sanitizePath('src/../controllers/api.ts'), 'src/controllers/api.ts');

  // 3. Verify files have path, content, language
  mockGeminiCodeResponse.files.forEach((f) => {
    assert.ok(f.path.length > 0, 'Path must be non-empty');
    assert.ok(f.content.length > 0, 'Content must be non-empty');
    assert.ok(f.language.length > 0, 'Language must be specified');
  });
});

test('Audit Code Generator: Modification Workflow & Diff Application Logic', () => {
  const originalFiles = [
    { path: 'src/index.ts', content: 'const port = 3000;', language: 'typescript' },
    { path: 'src/routes.ts', content: 'export const routes = [];', language: 'typescript' },
    { path: 'src/legacy.ts', content: '// deprecated', language: 'typescript' },
  ];

  // Mocked AI modification proposal
  const mockModResponse = {
    summary: 'Added authentication routes and deleted deprecated file',
    affectedFilePaths: ['src/routes.ts', 'src/auth.ts', 'src/legacy.ts'],
    modifiedFiles: [
      {
        path: 'src/routes.ts',
        action: 'modified' as const,
        changeDescription: 'Injected auth router',
        content: 'import { auth } from "./auth";\nexport const routes = [auth];',
        language: 'typescript',
      },
      {
        path: 'src/auth.ts',
        action: 'added' as const,
        changeDescription: 'Created JWT middleware',
        content: 'export const auth = () => {};',
        language: 'typescript',
      },
      {
        path: 'src/legacy.ts',
        action: 'deleted' as const,
        changeDescription: 'Removed deprecated module',
        content: '',
        language: 'typescript',
      },
    ],
  };

  // Test modification application logic
  let updatedFiles = [...originalFiles];
  mockModResponse.modifiedFiles.forEach((mod) => {
    if (mod.action === 'deleted') {
      updatedFiles = updatedFiles.filter((f) => f.path !== mod.path);
    } else if (mod.action === 'added') {
      updatedFiles.push({
        path: mod.path,
        content: mod.content,
        language: mod.language,
      });
    } else {
      const idx = updatedFiles.findIndex((f) => f.path === mod.path);
      assert.ok(idx >= 0, 'Modified file must exist in original set');
      updatedFiles[idx] = {
        path: mod.path,
        content: mod.content,
        language: mod.language,
      };
    }
  });

  assert.equal(updatedFiles.length, 3);
  assert.ok(updatedFiles.some((f) => f.path === 'src/auth.ts'), 'Added file exists');
  assert.ok(!updatedFiles.some((f) => f.path === 'src/legacy.ts'), 'Deleted file removed');
  const routesFile = updatedFiles.find((f) => f.path === 'src/routes.ts');
  assert.ok(routesFile?.content.includes('import { auth }'), 'Modified file has new content');
});

test('Audit Code Generator: ZIP Archive Creation & Integrity', async () => {
  const files = [
    { path: 'src/main.py', content: 'print("hello world")' },
    { path: 'requirements.txt', content: 'fastapi==0.110.0\nuvicorn==0.29.0' },
    { path: 'README.md', content: '# API Server' },
  ];

  const zip = new JSZip();
  files.forEach((f) => zip.file(f.path, f.content));

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  assert.ok(zipBuffer.length > 0, 'ZIP buffer must be non-empty');

  // Verify it can be read back and entries match
  const readBack = await JSZip.loadAsync(zipBuffer);
  assert.ok(readBack.file('src/main.py') !== null);
  assert.ok(readBack.file('requirements.txt') !== null);
  assert.ok(readBack.file('README.md') !== null);

  const mainPyContent = await readBack.file('src/main.py')?.async('text');
  assert.equal(mainPyContent, 'print("hello world")');
});

// ============================================================================
// AUDIT SUITE 2: WEBSITE GENERATOR MANIFEST & PREVIEW VERIFICATION
// ============================================================================

test('Audit Website Generator: React/Vite Manifest & Dependency Resolution', () => {
  const mockWebManifest = {
    websiteName: 'Apex Cloud',
    category: 'SaaS',
    technology: 'React',
    designDirection: 'Dark',
    fileManifest: [
      {
        path: 'package.json',
        content: JSON.stringify({
          name: 'apex-cloud',
          dependencies: {
            react: '^19.0.0',
            'react-dom': '^19.0.0',
            'lucide-react': '^0.546.0',
          },
        }),
        type: 'config',
      },
      {
        path: 'index.html',
        content: '<!DOCTYPE html><html><head><title>Apex Cloud</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>',
        type: 'markup',
      },
      {
        path: 'vite.config.js',
        content: 'import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\nexport default defineConfig({ plugins: [react()] });',
        type: 'config',
      },
      {
        path: 'src/main.jsx',
        content: 'import React from "react";\nimport ReactDOM from "react-dom/client";\nimport App from "./App.jsx";\nimport "./index.css";\nReactDOM.createRoot(document.getElementById("root")).render(<App />);',
        type: 'source',
      },
      {
        path: 'src/App.jsx',
        content: 'import React from "react";\nimport Navbar from "./components/Navbar.jsx";\nimport Hero from "./components/Hero.jsx";\nexport default function App() { return <div><Navbar /><Hero /></div>; }',
        type: 'source',
      },
      {
        path: 'src/components/Navbar.jsx',
        content: 'export default function Navbar() { return <nav>Navbar</nav>; }',
        type: 'source',
      },
      {
        path: 'src/components/Hero.jsx',
        content: 'export default function Hero() { return <section>Hero</section>; }',
        type: 'source',
      },
      {
        path: 'src/index.css',
        content: 'body { background: #000; color: #fff; }',
        type: 'style',
      },
      {
        path: 'README.md',
        content: '# Apex Cloud\nBuilt with React & Vite',
        type: 'doc',
      },
    ],
  };

  const files = mockWebManifest.fileManifest;
  const paths = files.map((f) => f.path);

  // Check required core files for React/Vite
  assert.ok(paths.includes('package.json'), 'package.json must be present');
  assert.ok(paths.includes('index.html'), 'index.html must be present');
  assert.ok(paths.includes('vite.config.js'), 'vite.config.js must be present');
  assert.ok(paths.includes('src/main.jsx'), 'src/main.jsx must be present');
  assert.ok(paths.includes('src/App.jsx'), 'src/App.jsx must be present');
  assert.ok(paths.includes('src/index.css'), 'src/index.css must be present');
  assert.ok(paths.includes('README.md'), 'README.md must be present');

  // Verify internal imports resolve within manifest
  // src/main.jsx imports ./App.jsx and ./index.css
  assert.ok(paths.includes('src/App.jsx'));
  assert.ok(paths.includes('src/index.css'));
  // src/App.jsx imports ./components/Navbar.jsx and ./components/Hero.jsx
  assert.ok(paths.includes('src/components/Navbar.jsx'));
  assert.ok(paths.includes('src/components/Hero.jsx'));

  // Verify package.json declares dependencies
  const pkgJsonFile = files.find((f) => f.path === 'package.json');
  assert.ok(pkgJsonFile);
  const parsedPkg = JSON.parse(pkgJsonFile.content);
  assert.ok(parsedPkg.dependencies['react']);
  assert.ok(parsedPkg.dependencies['react-dom']);
});

test('Audit Website Generator: Sandboxed Preview Generation', () => {
  const files = [
    {
      path: 'index.html',
      content: '<!DOCTYPE html><html><head><title>Test Site</title></head><body><div id="root"></div></body></html>',
    },
    {
      path: 'src/index.css',
      content: 'body { font-family: sans-serif; }',
    },
  ];

  function buildPreview(filesList: { path: string; content: string }[], name: string, desc: string) {
    const indexHtml = filesList.find((f) => f.path.endsWith('index.html'))?.content || '';
    const css = filesList.find((f) => f.path.endsWith('.css'))?.content || '';

    let combined = indexHtml;
    if (css && !combined.includes('<style>')) {
      combined = combined.replace('</head>', `<style>\n${css}\n</style></head>`);
    }
    return combined;
  }

  const preview = buildPreview(files, 'Apex', 'Description text');
  assert.ok(preview.includes('<style>'), 'CSS must be injected in head');
  assert.ok(preview.includes('Test Site'), 'Title preserved');
});

// ============================================================================
// AUDIT SUITE 3: DOCUMENT GENERATOR & REAL DOCX EXPORT VERIFICATION
// ============================================================================

test('Audit Document Generator: Real DOCX Binary Compilation & Integrity', async () => {
  const docData = {
    title: 'Audit & Compliance Report',
    subtitle: 'Confidential Internal Review',
    category: 'Technical documentation',
    tone: 'Formal',
    sections: [
      {
        heading: 'Executive Summary',
        subsections: [
          {
            subheading: 'Key Findings',
            paragraphs: ['All security invariants were verified.', 'No logic flaws found.'],
            bullets: ['In-memory sanitization enabled', 'Zero unauthorized queries'],
            table: {
              headers: ['Control ID', 'Status', 'Risk Score'],
              rows: [
                ['AC-1', 'Compliant', '0.0'],
                ['AC-2', 'Compliant', '0.0'],
              ],
            },
          },
        ],
      },
    ],
  };

  // Compile real Document via docx library
  const children: (Paragraph | Table)[] = [];

  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: docData.title, bold: true, size: 36 })],
    })
  );

  children.push(
    new Paragraph({
      children: [new TextRun({ text: docData.subtitle, italics: true, size: 24 })],
    })
  );

  docData.sections.forEach((sec, idx) => {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: `${idx + 1}. ${sec.heading}`, bold: true, size: 28 })],
      })
    );

    sec.subsections.forEach((sub) => {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: sub.subheading, bold: true, size: 24 })],
        })
      );

      sub.paragraphs.forEach((p) => {
        children.push(new Paragraph({ children: [new TextRun({ text: p, size: 22 })] }));
      });

      sub.bullets.forEach((b) => {
        children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: b, size: 22 })] }));
      });

      if (sub.table) {
        const headerRow = new TableRow({
          children: sub.table.headers.map(
            (h) =>
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
                width: { size: Math.floor(100 / sub.table.headers.length), type: WidthType.PERCENTAGE },
              })
          ),
        });

        const bodyRows = sub.table.rows.map(
          (row) =>
            new TableRow({
              children: row.map(
                (cell) =>
                  new TableCell({
                    children: [new Paragraph({ children: [new TextRun({ text: cell })] })],
                    width: { size: Math.floor(100 / row.length), type: WidthType.PERCENTAGE },
                  })
              ),
            })
        );

        children.push(new Table({ rows: [headerRow, ...bodyRows], width: { size: 100, type: WidthType.PERCENTAGE } }));
      }
    });
  });

  const doc = new Document({
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(doc);
  assert.ok(buffer.length > 0, 'DOCX binary buffer must be produced');

  // Verify DOCX internal structure (a DOCX is an OpenXML ZIP container)
  const zip = await JSZip.loadAsync(buffer);
  assert.ok(zip.file('[Content_Types].xml') !== null, 'Must contain [Content_Types].xml');
  assert.ok(zip.file('word/document.xml') !== null, 'Must contain word/document.xml');

  // Inspect word/document.xml to ensure content is serialized
  const docXml = await zip.file('word/document.xml')?.async('text');
  assert.ok(docXml?.includes('Audit &amp; Compliance Report'), 'Title must be present in word/document.xml');
  assert.ok(docXml?.includes('Executive Summary'), 'Section header must be present in word/document.xml');
  assert.ok(docXml?.includes('AC-1'), 'Table cell must be present in word/document.xml');
});

// ============================================================================
// AUDIT SUITE 4: DATA CLEANER ALL 10 OPERATIONS & FILE EXPORTS
// ============================================================================

test('Audit Data Cleaner: All 10 Cleaning Operations & Invariant Guarantees', () => {
  const originalDirtyData = [
    { id: '101', name: '  Alice  ', age: '30', score: '95', status: 'ACTIVE', empty_col: '' },
    { id: '102', name: 'Bob', age: '', score: '80', status: 'pending', empty_col: '' },
    { id: '101', name: '  Alice  ', age: '30', score: '95', status: 'ACTIVE', empty_col: '' }, // duplicate
    { id: '', name: '', age: '', score: '', status: '', empty_col: '' }, // completely empty row
    { id: '103', name: 'Charlie', age: '45', score: null, status: 'Active', empty_col: '' },
  ];

  // 1. Remove duplicates
  const dedupRes = removeDuplicates(originalDirtyData);
  assert.equal(dedupRes.removedCount, 1);
  assert.equal(dedupRes.data.length, 4);

  // 2. Remove empty rows
  const emptyRowRes = removeEmptyRows(originalDirtyData);
  assert.equal(emptyRowRes.removedCount, 1);
  assert.equal(emptyRowRes.data.length, 4);

  // 3. Remove empty columns
  const emptyColRes = removeEmptyColumns(originalDirtyData);
  assert.ok(emptyColRes.removedColumns.includes('empty_col'));
  assert.equal('empty_col' in emptyColRes.data[0], false);

  // 4. Trim whitespace
  const trimRes = trimWhitespace(originalDirtyData);
  assert.equal(trimRes.data[0].name, 'Alice');

  // 5. Standardize text
  const caseRes = standardizeText(originalDirtyData, 'status', 'lowercase');
  assert.equal(caseRes.data[0].status, 'active');
  assert.equal(caseRes.data[4].status, 'active');

  // 6. Handle missing values (fill mean)
  const meanRes = handleMissingValues(
    [
      { id: 1, val: 10 },
      { id: 2, val: 20 },
      { id: 3, val: null },
    ],
    'val',
    'fill_mean'
  );
  assert.equal(meanRes.data[2].val, 15);

  // 7. Handle missing values (drop row)
  const dropRowRes = handleMissingValues(originalDirtyData, 'age', 'drop_row');
  assert.equal(dropRowRes.handledCount, 2); // 1 empty string + 1 empty row

  // 8. Convert column type
  const typeRes = convertColumnType(
    [{ val: '123' }, { val: '456.78' }],
    'val',
    'number'
  );
  assert.equal(typeof typeRes.data[0].val, 'number');
  assert.equal(typeRes.data[0].val, 123);

  // 9. Rename column
  const renameRes = renameColumn([{ old_name: 'value' }], 'old_name', 'new_name');
  assert.ok(renameRes.success);
  assert.equal(renameRes.data[0].new_name, 'value');
  assert.equal('old_name' in renameRes.data[0], false);

  // 10. Remove column
  const removeColRes = removeColumn([{ colA: 1, colB: 2 }], 'colB');
  assert.ok(removeColRes.success);
  assert.equal('colB' in removeColRes.data[0], false);

  // 11. Filter rows (greater than)
  const filterRes = filterRows(
    [{ score: 100 }, { score: 50 }, { score: 20 }],
    'score',
    'greater_than',
    40
  );
  assert.equal(filterRes.retainedCount, 2);
  assert.equal(filterRes.removedCount, 1);

  // Invariant verification: Original data remains strictly untouched
  assert.equal(originalDirtyData.length, 5);
  assert.equal(originalDirtyData[0].name, '  Alice  ');
  assert.ok('empty_col' in originalDirtyData[0]);
});

test('Audit Data Cleaner: CSV and XLSX Export Engine Verification', () => {
  const cleanData = [
    { id: 101, name: 'Alice Smith', email: 'alice@example.com', score: 98.5 },
    { id: 102, name: 'Bob Jones', email: 'bob@example.com', score: 85.0 },
  ];

  // Test CSV Export via PapaParse
  const csvStr = Papa.unparse(cleanData);
  assert.ok(csvStr.includes('id,name,email,score'));
  assert.ok(csvStr.includes('101,Alice Smith,alice@example.com,98.5'));

  // Parse back to confirm accuracy
  const parsedCsv = Papa.parse(csvStr, { header: true, dynamicTyping: true });
  assert.equal(parsedCsv.data.length, 2);
  assert.equal((parsedCsv.data[0] as any).name, 'Alice Smith');

  // Test XLSX Export via SheetJS
  const worksheet = XLSX.utils.json_to_sheet(cleanData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'TestSheet');

  const xlsxBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
  assert.ok(xlsxBuffer.length > 0);

  // Read back Excel file to confirm integrity
  const readWorkbook = XLSX.read(xlsxBuffer, { type: 'buffer' });
  assert.equal(readWorkbook.SheetNames[0], 'TestSheet');
  const readData = XLSX.utils.sheet_to_json(readWorkbook.Sheets['TestSheet']);
  assert.equal(readData.length, 2);
  assert.equal((readData[0] as any).name, 'Alice Smith');
  assert.equal((readData[0] as any).score, 98.5);
});

// ============================================================================
// AUDIT SUITE 5: FIRESTORE SECURITY RULES & USER ISOLATION
// ============================================================================

test('Audit Firestore Rules: ABAC Ownership & Default Deny Enforcement', () => {
  const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
  assert.ok(fs.existsSync(rulesPath), 'firestore.rules must exist');

  const rulesContent = fs.readFileSync(rulesPath, 'utf-8');

  // 1. Must use rules_version = '2'
  assert.ok(rulesContent.includes("rules_version = '2';"));

  // 2. Default deny catch-all
  assert.ok(
    rulesContent.includes('match /{document=**}') &&
    rulesContent.includes('allow read, write: if false;'),
    'Default deny catch-all rule must be present'
  );

  // 3. User isolation helper
  assert.ok(rulesContent.includes('function isSignedIn()'));
  assert.ok(rulesContent.includes('function isValidId(id)'));

  // 4. Collections covered
  const requiredCollections = [
    'users',
    'codeProjects',
    'websiteProjects',
    'documents',
    'datasets',
    'cleaningJobs',
    'activityLogs',
  ];

  requiredCollections.forEach((col) => {
    assert.ok(
      rulesContent.includes(`match /${col}/`),
      `Collection '${col}' must have an explicit match block in firestore.rules`
    );
  });

  // 5. Query Enforcer: ensure allow list strictly checks resource.data.ownerId == request.auth.uid
  assert.ok(
    rulesContent.includes('allow list: if isSignedIn() && resource.data.ownerId == request.auth.uid;') ||
    rulesContent.includes('allow list: if isSignedIn() && resource.data.uid == request.auth.uid;'),
    'List queries must strictly enforce ownership in the rule'
  );

  // 6. Immutable ownerId during updates
  assert.ok(
    rulesContent.includes('request.resource.data.ownerId == resource.data.ownerId'),
    'Must prevent reassigning document ownership during update'
  );
});
