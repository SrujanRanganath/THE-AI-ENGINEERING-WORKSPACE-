import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARGON_MODEL_ID,
  HYDROGEN_MODEL_ID,
  WEBSITE_MANIFEST_RESPONSE_SCHEMA,
  WEBSITE_FILE_REPAIR_SCHEMA,
  sanitizeManifestFilePath,
  parseWebsiteGeneratorJson,
  validateAndNormalizeWebsiteManifest,
  applyDeterministicManifestRepairs,
  validateAndRepairWebsiteManifest,
  executeWebsiteGeneration,
  callWithBoundedRetry,
} from '../src/server/websiteGenerationService';
import {
  compileWebsitePreview,
  validateJsxAndSyntax,
  normalizeGeneratedSourceCode,
  getSampleReactWebsiteManifest,
} from '../src/utils/reactPreviewCompiler';
import {
  buildPublishedPreviewUrl,
  canPublishWebsiteProject,
  createPublishedWebsiteSnapshot,
  savePublishedWebsiteSnapshot,
  getPublishedWebsiteSnapshot,
} from '../src/utils/publishPreview';

function buildValidReactManifestObject(overrides: Record<string, unknown> = {}) {
  return {
    websiteName: 'Nova Analytics',
    framework: 'React 19 + Vite',
    category: 'SaaS',
    technology: 'React',
    designDirection: 'Dark',
    summary: 'Analytics SaaS landing application.',
    entryHtml: 'index.html',
    dependencies: {
      react: '^19.0.0',
      'react-dom': '^19.0.0',
      'lucide-react': '^0.546.0',
    },
    fileManifest: [
      {
        path: 'package.json',
        type: 'config',
        content: JSON.stringify(
          {
            name: 'nova-analytics',
            dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0', 'lucide-react': '^0.546.0' },
          },
          null,
          2
        ),
      },
      {
        path: 'index.html',
        type: 'markup',
        content:
          '<!DOCTYPE html><html><head><title>Nova Analytics</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>',
      },
      {
        path: 'vite.config.js',
        type: 'config',
        content:
          'import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\nexport default defineConfig({ plugins: [react()] });',
      },
      {
        path: 'src/main.jsx',
        type: 'source',
        content:
          'import React from "react";\nimport ReactDOM from "react-dom/client";\nimport App from "./App.jsx";\nimport "./index.css";\nReactDOM.createRoot(document.getElementById("root")).render(<App />);',
      },
      {
        path: 'src/App.jsx',
        type: 'source',
        content:
          'import React from "react";\nimport Navbar from "./components/Navbar.jsx";\nimport Hero from "./components/Hero.jsx";\nexport default function App() { return <div><Navbar /><Hero /><main>Nova Analytics</main></div>; }',
      },
      {
        path: 'src/components/Navbar.jsx',
        type: 'source',
        content:
          'import React from "react";\nexport default function Navbar() { return <nav><span>Nova</span><button>Let\'s Talk</button></nav>; }',
      },
      {
        path: 'src/components/Hero.jsx',
        type: 'source',
        content:
          'import React from "react";\nexport default function Hero() { return <section><h1>We\'re building tomorrow\'s cloud</h1><p>Fast &amp; reliable</p></section>; }',
      },
      {
        path: 'src/index.css',
        type: 'style',
        content: 'body { margin: 0; background: #050811; color: #f8fafc; }',
      },
      {
        path: 'README.md',
        type: 'doc',
        content: '# Nova Analytics\n\n```bash\nnpm install && npm run dev\n```',
      },
    ],
    ...overrides,
  };
}

test('WG-1: Parses raw multiline strings and unescaped control characters inside JSON string literals safely', () => {
  const malformedJson =
    '{\n' +
    '  "websiteName": "ControlCharSite",\n' +
    '  "category": "SaaS",\n' +
    '  "technology": "React",\n' +
    '  "designDirection": "Dark",\n' +
    '  "summary": "Line 1\nLine 2\tTabbed\r\nLine 3\x01End",\n' +
    '  "fileManifest": [\n' +
    '    {"path": "package.json", "type": "config", "content": "{\\"dependencies\\":{\\"react\\":\\"^19.0.0\\"}}"},\n' +
    '    {"path": "index.html", "type": "markup", "content": "<!DOCTYPE html>\n<html>\n<body><div id=\\"root\\"></div></body>\n</html>"},\n' +
    '    {"path": "src/App.jsx", "type": "source", "content": "export default function App() {\n\tconst s = \\"escaped quote\\\\path\\";\n\treturn <div>{s}</div>;\n}"}\n' +
    '  ]\n' +
    '}';

  assert.throws(() => JSON.parse(malformedJson), /control character/i);

  const parsed = parseWebsiteGeneratorJson(malformedJson);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    const obj = parsed.data as any;
    assert.equal(obj.websiteName, 'ControlCharSite');
    assert.ok(obj.summary.includes('Line 1\nLine 2\tTabbed'));
    const appFile = obj.fileManifest.find((f: any) => f.path === 'src/App.jsx');
    assert.ok(appFile.content.includes('escaped quote\\path'));
    assert.ok(appFile.content.includes('return <div>{s}</div>;'));
  }
});

test('WG-2: Preserves escaped quotes, backslashes, tabs, and inner markdown fences inside README/code strings', () => {
  const validManifest = buildValidReactManifestObject();
  const rawJson = JSON.stringify(validManifest);

  const wrappedResponse = `Here is your generated site:\n\`\`\`json\n${rawJson}\n\`\`\`\nEnjoy!`;

  const parsed = parseWebsiteGeneratorJson(wrappedResponse);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    const obj = parsed.data as any;
    const readme = obj.fileManifest.find((f: any) => f.path === 'README.md');
    assert.ok(
      readme.content.includes('```bash\nnpm install && npm run dev\n```'),
      'Inner markdown ``` fences inside README.md must NOT be stripped or corrupted'
    );
  }
});

test('WG-3: Returns clean, actionable errors for truncated or non-JSON model output (no raw JSON.parse crash)', () => {
  const truncated = '{"websiteName": "Test", "fileManifest": [{"path": "index.html", "content": "<html';
  const truncatedRes = parseWebsiteGeneratorJson(truncated);
  assert.equal(truncatedRes.success, false);
  if (!truncatedRes.success) {
    assert.equal(truncatedRes.code, 'TRUNCATED_AI_OUTPUT');
    assert.equal(truncatedRes.error.includes('position'), false);
    assert.ok(truncatedRes.error.toLowerCase().includes('truncated'));
  }

  const nonJson = 'Sorry, I cannot build that right now without more context.';
  const nonJsonRes = parseWebsiteGeneratorJson(nonJson);
  assert.equal(nonJsonRes.success, false);
  if (!nonJsonRes.success) {
    assert.equal(nonJsonRes.code, 'INVALID_AI_JSON');
  }

  const emptyRes = parseWebsiteGeneratorJson('   ');
  assert.equal(emptyRes.success, false);
  if (!emptyRes.success) {
    assert.equal(emptyRes.code, 'EMPTY_AI_RESPONSE');
  }
});

test('WG-4: Validates website manifest structure, sanitizes paths, and rejects incomplete manifests before preview compilation', () => {
  assert.equal(sanitizeManifestFilePath('../../etc/passwd'), 'etc/passwd');
  assert.equal(sanitizeManifestFilePath('/src\\components\\Hero.jsx'), 'src/components/Hero.jsx');

  const emptyManifest = validateAndNormalizeWebsiteManifest(
    { websiteName: 'Empty', fileManifest: [] },
    { websiteName: 'Empty', category: 'SaaS', technology: 'React', designDirection: 'Dark' }
  );
  assert.equal(emptyManifest.valid, false);

  const missingHtml = validateAndNormalizeWebsiteManifest(
    {
      websiteName: 'NoHTML',
      technology: 'React',
      fileManifest: [
        { path: 'package.json', content: '{"dependencies":{"react":"^19.0.0"}}', type: 'config' },
        { path: 'src/App.jsx', content: 'export default function App(){return <div/>;}', type: 'source' },
      ],
    },
    { websiteName: 'NoHTML', category: 'SaaS', technology: 'React', designDirection: 'Dark' }
  );
  assert.equal(missingHtml.valid, false);
  if (!missingHtml.valid) {
    assert.ok(missingHtml.error.includes('index.html'));
  }

  const badPkg = validateAndNormalizeWebsiteManifest(
    {
      websiteName: 'BadPkg',
      technology: 'React',
      fileManifest: [
        { path: 'package.json', content: '{not-valid-json', type: 'config' },
        { path: 'index.html', content: '<html><body><div id="root"></div></body></html>', type: 'markup' },
        { path: 'src/App.jsx', content: 'export default function App(){return <div/>;}', type: 'source' },
      ],
    },
    { websiteName: 'BadPkg', category: 'SaaS', technology: 'React', designDirection: 'Dark' }
  );
  assert.equal(badPkg.valid, false);
  if (!badPkg.valid) {
    assert.ok(badPkg.error.includes('package.json'));
  }

  // Valid HTML / CSS / JS manifest normalizes and compiles cleanly
  const htmlValidated = validateAndNormalizeWebsiteManifest(
    {
      websiteName: 'StaticPortfolio',
      technology: 'HTML / CSS / JS',
      fileManifest: [
        {
          path: 'index.html',
          type: 'markup',
          content: '<!DOCTYPE html><html><head><link rel="stylesheet" href="styles.css"></head><body><h1>Static Portfolio</h1><script src="app.js"></script></body></html>',
        },
        {
          path: 'styles.css',
          type: 'style',
          content: 'body { background: #0f172a; color: white; }',
        },
        {
          path: 'app.js',
          type: 'source',
          content: 'console.log("Portfolio loaded");',
        },
      ],
    },
    { websiteName: 'StaticPortfolio', category: 'Portfolio', technology: 'HTML / CSS / JS', designDirection: 'Minimal' }
  );
  assert.equal(htmlValidated.valid, true);
  if (htmlValidated.valid) {
    const htmlCompiled = compileWebsitePreview(
      htmlValidated.data.fileManifest,
      htmlValidated.data.technology,
      htmlValidated.data.websiteName,
      'tok_static'
    );
    assert.equal(htmlCompiled.success, true);
    assert.ok(htmlCompiled.compiledHtml.includes('Static Portfolio'));
  }
  const emptySourceFile = validateAndNormalizeWebsiteManifest(
    {
      websiteName: 'StubSite',
      technology: 'React',
      fileManifest: [
        { path: 'package.json', content: '{"dependencies":{"react":"^19.0.0"}}', type: 'config' },
        { path: 'index.html', content: '<html><body><div id="root"></div></body></html>', type: 'markup' },
        { path: 'src/App.jsx', content: '   \n  ', type: 'source' },
      ],
    },
    { websiteName: 'StubSite', category: 'SaaS', technology: 'React', designDirection: 'Dark' }
  );
  assert.equal(emptySourceFile.valid, false);
  if (!emptySourceFile.valid) {
    assert.equal(emptySourceFile.code, 'INCOMPLETE_MANIFEST');
  }
});

test('WG-5: Uses Hydrogen (gemini-4-hydrogen) by default, supports transparent model fallback, and retries 503/429 with bounded backoff', async () => {
  const sleepDelays: number[] = [];
  let attempts503 = 0;

  // Default model is HYDROGEN_MODEL_ID ('gemini-4-hydrogen')
  const recovered = await executeWebsiteGeneration({
    input: {
      websiteName: 'PulseOps',
      category: 'SaaS',
      technology: 'React',
      designDirection: 'Dark',
      description: 'Monitoring dashboard',
    },
    apiKeyConfigured: true,
    generateContent: async (params) => {
      assert.equal(params.model, HYDROGEN_MODEL_ID);
      assert.equal(params.config.responseMimeType, 'application/json');
      assert.equal(params.config.responseSchema, WEBSITE_MANIFEST_RESPONSE_SCHEMA);

      attempts503++;
      if (attempts503 < 3) {
        const err: any = new Error('model temporarily unavailable');
        err.status = 503;
        throw err;
      }
      return { text: JSON.stringify(buildValidReactManifestObject({ websiteName: 'PulseOps' })) };
    },
    retryOptions: {
      maxRetries: 2,
      baseDelayMs: 50,
      jitterMs: 20,
      random: () => 0.5,
      sleep: async (ms) => {
        sleepDelays.push(ms);
      },
    },
  });

  assert.equal(attempts503, 3);
  assert.deepEqual(sleepDelays, [60, 110]);
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.success, true);
  assert.equal(recovered.body.modelUsed, HYDROGEN_MODEL_ID);

  // Transparent fallback from Argon to Hydrogen when Argon is restricted/404 for the key
  const calledModels: string[] = [];
  const fallbackResult = await executeWebsiteGeneration({
    input: {
      websiteName: 'FallbackSite',
      category: 'SaaS',
      technology: 'React',
      designDirection: 'Dark',
      description: 'Fallback test',
    },
    apiKeyConfigured: true,
    model: ARGON_MODEL_ID,
    fallbackModel: HYDROGEN_MODEL_ID,
    generateContent: async (params) => {
      calledModels.push(params.model);
      if (params.model === ARGON_MODEL_ID) {
        const err: any = new Error('Model gemini-4-argon is not found or not supported');
        err.status = 404;
        throw err;
      }
      return { text: JSON.stringify(buildValidReactManifestObject({ websiteName: 'FallbackSite' })) };
    },
    retryOptions: { maxRetries: 1, sleep: async () => {} },
  });

  assert.deepEqual(calledModels, [ARGON_MODEL_ID, HYDROGEN_MODEL_ID]);
  assert.equal(fallbackResult.status, 200);
  assert.equal(fallbackResult.body.modelUsed, HYDROGEN_MODEL_ID);
  assert.ok(String(fallbackResult.body.modelFallbackNotice || '').includes(ARGON_MODEL_ID));

  // Non-retryable 400 error must NOT retry
  let attempts400 = 0;
  await assert.rejects(
    () =>
      callWithBoundedRetry(
        async () => {
          attempts400++;
          const err: any = new Error('INVALID_ARGUMENT');
          err.status = 400;
          throw err;
        },
        { maxRetries: 2, sleep: async () => {} }
      ),
    /INVALID_ARGUMENT/
  );
  assert.equal(attempts400, 1);
});

test('WG-6: Root-cause fix — Navbar.jsx with apostrophes ("Let\'s Talk") and Hero.jsx with multiline JSX expressions compile without false-positive or unterminated string errors', () => {
  // 1. Navbar.jsx containing legal JSX text apostrophes, quotes, URLs with https://, and template literals in attributes
  const navbarSource = `import React, { useState } from 'react';
import { Sparkles, Menu, X } from 'lucide-react';

export default function Navbar({ brand = "Apex Cloud" }) {
  const [open, setOpen] = useState(false);
  const docsUrl = "https://docs.apexcloud.example.com/v2 // reference";
  return (
    <header className={\`sticky top-0 \${open ? 'bg-slate-950' : 'bg-slate-900/80'}\`} title={\`Let's explore \${brand}\`}>
      <div className="max-w-7xl mx-auto flex items-center justify-between p-4">
        <a href="#hero">{brand} — Built for today's teams (v2.4) // Live</a>
        <nav>
          <a href="#features">What's Included</a>
          <a href={docsUrl}>Docs</a>
          <button onClick={() => setOpen(!open)}>Let's Talk</button>
        </nav>
      </div>
    </header>
  );
}`;

  const navbarDiag = validateJsxAndSyntax('src/components/Navbar.jsx', navbarSource);
  assert.equal(navbarDiag.length, 0, 'Navbar.jsx with apostrophes in JSX text ("Let\'s Talk") must pass syntax validation');

  // 2. Hero.jsx containing invalid multiline JSX expression {' \n '} that previously caused Unterminated string literal
  const brokenHeroRaw = `import React from 'react';
export default function Hero() {
  return (
    <section id="hero" className="py-20">
      <h1>Scale Your Platform{'
      '}Without Bottlenecks</h1>
      <p>Don't settle for legacy pipelines — we've automated 99.99% of deployments.</p>
    </section>
  );
}`;

  const normalizedHero = normalizeGeneratedSourceCode('src/components/Hero.jsx', brokenHeroRaw);
  assert.equal(
    normalizedHero.includes("{'\\n"),
    false,
    'Multiline whitespace expression inside JSX must be normalized to single-line space'
  );
  const heroDiag = validateJsxAndSyntax('src/components/Hero.jsx', normalizedHero);
  assert.equal(heroDiag.length, 0, 'Normalized Hero.jsx must pass syntax validation');

  // 3. Full compilation of manifest containing both Navbar.jsx and Hero.jsx
  const manifestObj = buildValidReactManifestObject();
  const files = manifestObj.fileManifest as any[];
  const navIdx = files.findIndex((f) => f.path === 'src/components/Navbar.jsx');
  const heroIdx = files.findIndex((f) => f.path === 'src/components/Hero.jsx');
  files[navIdx].content = navbarSource;
  files[heroIdx].content = brokenHeroRaw;

  const repairedManifest = applyDeterministicManifestRepairs(manifestObj as any);
  const compiled = compileWebsitePreview(
    repairedManifest.fileManifest,
    'React',
    'Nova Analytics',
    'tok_root_cause'
  );
  assert.equal(compiled.success, true, `Expected 0 compile errors, got: ${JSON.stringify(compiled.errors)}`);
  assert.equal(compiled.errors.length, 0);
  assert.ok(compiled.compiledHtml.includes("Let's Talk"));
});

test('WG-7: Automatic bounded repair loop fixes broken component files and rejects unrepairable code without replacing valid source with broken source', async () => {
  // Build a manifest where Hero.jsx has an unclosed <div> tag that requires AI single-file repair
  const brokenManifest = buildValidReactManifestObject();
  const files = brokenManifest.fileManifest as any[];
  const heroIdx = files.findIndex((f) => f.path === 'src/components/Hero.jsx');
  files[heroIdx].content =
    'import React from "react";\nexport default function Hero() {\n  return (\n    <section><div><h1>Unclosed Div</section>\n  );\n}';

  let repairCalls = 0;
  const result = await executeWebsiteGeneration({
    input: {
      websiteName: 'Nova Analytics',
      category: 'SaaS',
      technology: 'React',
      designDirection: 'Dark',
      description: 'Analytics SaaS landing application',
    },
    apiKeyConfigured: true,
    model: HYDROGEN_MODEL_ID,
    maxRepairAttempts: 2,
    generateContent: async (params) => {
      if (params.config.responseSchema === WEBSITE_MANIFEST_RESPONSE_SCHEMA) {
        return { text: JSON.stringify(brokenManifest) };
      }
      if (params.config.responseSchema === WEBSITE_FILE_REPAIR_SCHEMA) {
        repairCalls++;
        assert.ok(params.contents.includes('src/components/Hero.jsx'));
        return {
          text: JSON.stringify({
            path: 'src/components/Hero.jsx',
            explanation: 'Closed the inner <div> tag before </section>.',
            content:
              'import React from "react";\nexport default function Hero() {\n  return (\n    <section><div><h1>Fixed Hero Section</h1></div></section>\n  );\n}',
          }),
        };
      }
      throw new Error('Unexpected schema');
    },
    retryOptions: { maxRetries: 0, sleep: async () => {} },
  });

  assert.equal(repairCalls, 1);
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.repairAttemptsUsed, 1);
  const fixedHero = (result.body.data as any)?.fileManifest.find(
    (f: any) => f.path === 'src/components/Hero.jsx'
  );
  assert.ok(fixedHero?.content.includes('Fixed Hero Section'));

  // Verify that if repair returns still-broken code, generation fails the final acceptance gate (status 422)
  // and returns actionable diagnostics rather than pretending generation succeeded.
  const failedRepairResult = await executeWebsiteGeneration({
    input: {
      websiteName: 'BrokenSite',
      category: 'SaaS',
      technology: 'React',
      designDirection: 'Dark',
      description: 'Test unrepairable output',
    },
    apiKeyConfigured: true,
    model: HYDROGEN_MODEL_ID,
    maxRepairAttempts: 1,
    generateContent: async (params) => {
      if (params.config.responseSchema === WEBSITE_MANIFEST_RESPONSE_SCHEMA) {
        return { text: JSON.stringify(brokenManifest) };
      }
      // Return a broken repair candidate — must NOT overwrite with broken syntax or pass acceptance gate
      return {
        text: JSON.stringify({
          path: 'src/components/Hero.jsx',
          explanation: 'Still broken',
          correctedContent: 'export default function Hero() { return <section><div></section>; }',
        }),
      };
    },
    retryOptions: { maxRetries: 0, sleep: async () => {} },
  });

  assert.equal(failedRepairResult.status, 422);
  assert.equal(failedRepairResult.body.success, false);
  assert.equal(failedRepairResult.body.code, 'SOURCE_COMPILATION_FAILED');
  assert.ok(Array.isArray(failedRepairResult.body.diagnostics));
  assert.ok((failedRepairResult.body.diagnostics?.length || 0) > 0);
  assert.equal(failedRepairResult.body.diagnostics?.[0].file, 'src/components/Hero.jsx');
});

test('WG-8: Publish Preview URL generation, compilation gate, independent snapshot rendering, and owner-scoped persistence', () => {
  // 1. Dynamic URL resolution for local and hosted origins (never hardcodes localhost on hosted environments)
  assert.equal(
    buildPublishedPreviewUrl('web_12345', 'http://localhost:3000'),
    'http://localhost:3000/published/web_12345'
  );
  assert.equal(
    buildPublishedPreviewUrl('web_12345', 'https://ais-dev-example.run.app/'),
    'https://ais-dev-example.run.app/published/web_12345'
  );

  // 2. Sample React website manifest compiles cleanly and passes publish gate
  const sampleManifest = getSampleReactWebsiteManifest('Apex Cloud Platform');
  const compiledSample = compileWebsitePreview(
    sampleManifest,
    'React',
    'Apex Cloud Platform',
    'tok_pub_1'
  );
  assert.equal(compiledSample.success, true);

  const validProject = {
    id: 'web_pub_test_01',
    ownerId: 'user_alice',
    name: 'Apex Cloud Platform',
    category: 'SaaS',
    technology: 'React',
    designDirection: 'Dark',
    description: 'Cloud infrastructure platform',
    requirements: 'Hero, features, pricing, contact',
    summary: 'Complete React/Vite site',
    fileManifest: sampleManifest,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const canPubValid = canPublishWebsiteProject(validProject, compiledSample, null);
  assert.equal(canPubValid.canPublish, true);

  // 3. Invalid or runtime-errored projects are blocked from publishing
  const canPubRuntimeErr = canPublishWebsiteProject(validProject, compiledSample, {
    message: 'ReferenceError: foo is not defined',
  });
  assert.equal(canPubRuntimeErr.canPublish, false);

  const brokenManifest = sampleManifest.map((f) =>
    f.path === 'src/App.jsx' ? { ...f, content: 'export default function App() { return <div><span></div>; }' } : f
  );
  const compiledBroken = compileWebsitePreview(brokenManifest, 'React', 'Broken', 'tok_broken');
  assert.equal(compiledBroken.success, false);
  assert.equal(
    canPublishWebsiteProject({ ...validProject, fileManifest: brokenManifest }, compiledBroken, null)
      .canPublish,
    false
  );

  // 4. Create published snapshot and verify it renders independently even if editor manifest is later modified/broken
  const snapshotRes = createPublishedWebsiteSnapshot(validProject, 'http://localhost:3000');
  assert.equal(snapshotRes.success, true);
  if (snapshotRes.success) {
    savePublishedWebsiteSnapshot(snapshotRes.snapshot);

    // Mutate original project array in memory to simulate unsaved broken edits in the generator
    validProject.fileManifest[0] = {
      ...validProject.fileManifest[0],
      content: 'BROKEN_EDITOR_STATE',
    };

    const retrieved = getPublishedWebsiteSnapshot('web_pub_test_01', 'user_alice');
    assert.ok(retrieved, 'Owner must be able to retrieve published snapshot');
    assert.equal(retrieved?.publishedUrl, 'http://localhost:3000/published/web_pub_test_01');
    assert.notEqual(
      retrieved?.fileManifest[0].content,
      'BROKEN_EDITOR_STATE',
      'Published snapshot must remain independent of subsequent unsaved editor mutations'
    );

    const compiledSnapshot = compileWebsitePreview(
      retrieved!.fileManifest,
      retrieved!.technology,
      retrieved!.name,
      'tok_pub_render'
    );
    assert.equal(compiledSnapshot.success, true);
    assert.ok(compiledSnapshot.compiledHtml.includes('Deploy Resilient Cloud Infrastructure at Scale'));
    assert.ok(compiledSnapshot.compiledHtml.includes("Let's Talk"));

    // 5. Security: Another user ('user_mallory') cannot access 'user_alice' published snapshot
    const crossUserAttempt = getPublishedWebsiteSnapshot('web_pub_test_01', 'user_mallory');
    assert.equal(
      crossUserAttempt,
      null,
      'Cross-user access to another user\'s published preview snapshot must be rejected'
    );
  }
});
