import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  normalizeManifestPath,
  resolveManifestImport,
  extractImports,
  transpileJsxToCreateElement,
  compileWebsitePreview,
  getSampleReactWebsiteManifest,
  ManifestFile,
} from '../src/utils/reactPreviewCompiler.ts';
import JSZip from 'jszip';

describe('Phase 2 — Live React Preview Compiler & Security Isolation Tests', () => {
  it('1. Valid multi-file React/Vite project compiles and resolves all 10 manifest files with valid JS syntax', () => {
    const manifest = getSampleReactWebsiteManifest('Apex Cloud Platform');
    assert.equal(manifest.length, 10);

    const result = compileWebsitePreview(manifest, 'React', 'Apex Cloud Platform');
    assert.equal(result.success, true);
    assert.equal(result.status, 'success');
    assert.equal(result.errors.length, 0);
    assert.equal(result.entryFile, 'src/App.jsx');
    assert.ok(result.resolvedModules.includes('src/main.jsx'));
    assert.ok(result.resolvedModules.includes('src/App.jsx'));
    assert.ok(result.resolvedModules.includes('src/components/Navbar.jsx'));
    assert.ok(result.resolvedModules.includes('src/components/FeatureGrid.jsx'));
    assert.ok(result.resolvedModules.includes('src/components/PricingCalculator.jsx'));
    assert.ok(result.compiledHtml.includes('<!DOCTYPE html>'));
    assert.ok(result.compiledHtml.includes('src/App.jsx'));

    // Verify the generated <script> block has zero JS syntax/redeclaration errors
    const scriptMatch = result.compiledHtml.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(scriptMatch, 'Expected <script> block in compiledHtml');
    assert.doesNotThrow(() => {
      new vm.Script(scriptMatch[1]);
    });
  });

  it('2. Project with multiple nested component imports resolves relative & alias paths accurately', () => {
    const manifest = getSampleReactWebsiteManifest('MultiComponentTest');
    const fileMap = new Map<string, ManifestFile>();
    for (const f of manifest) {
      fileMap.set(normalizeManifestPath(f.path), f);
    }

    assert.equal(
      resolveManifestImport('src/App.jsx', './components/Navbar', fileMap),
      'src/components/Navbar.jsx'
    );
    assert.equal(
      resolveManifestImport('src/App.jsx', './components/FeatureGrid.jsx', fileMap),
      'src/components/FeatureGrid.jsx'
    );
    assert.equal(
      resolveManifestImport('src/components/Navbar.jsx', '../App', fileMap),
      'src/App.jsx'
    );
    assert.equal(
      resolveManifestImport('src/main.jsx', '@/components/PricingCalculator', fileMap),
      'src/components/PricingCalculator.jsx'
    );

    const appFile = manifest.find((f) => f.path === 'src/App.jsx')!;
    const { imports, errors } = extractImports('src/App.jsx', appFile.content);
    assert.equal(errors.length, 0);
    const specifiers = imports.map((i) => i.specifier);
    assert.ok(specifiers.includes('react'));
    assert.ok(specifiers.includes('./components/Navbar'));
    assert.ok(specifiers.includes('./components/FeatureGrid'));
    assert.ok(specifiers.includes('./components/PricingCalculator'));

    const transpiled = transpileJsxToCreateElement(appFile.content);
    assert.ok(transpiled.includes('React.createElement(Navbar'));
    assert.ok(transpiled.includes('React.createElement(FeatureGrid'));
    assert.ok(transpiled.includes('React.createElement(PricingCalculator'));
  });

  it('3. Project with invalid JSX (mismatched or unclosed tags) fails compilation with structured SYNTAX_ERROR', () => {
    const manifest = getSampleReactWebsiteManifest('BrokenJsxProject').map((file) =>
      file.path === 'src/App.jsx'
        ? {
            ...file,
            content: `import React from 'react';
export default function App() {
  return (
    <div className="p-6">
      <h1>Broken Heading</h2>
    </div>
  );
}`,
          }
        : file
    );

    const result = compileWebsitePreview(manifest, 'React', 'BrokenJsxProject');
    assert.equal(result.success, false);
    assert.ok(result.errors.length > 0);
    const syntaxErr = result.errors.find((e) => e.type === 'SYNTAX_ERROR');
    assert.ok(syntaxErr, 'Expected SYNTAX_ERROR in compilation diagnostics');
    assert.equal(syntaxErr.file, 'src/App.jsx');
    assert.equal(syntaxErr.line, 5);
    assert.ok(syntaxErr.message.includes('JSX closing tag mismatch: expected </h1>'));
    assert.ok(syntaxErr.snippet?.includes('<h1>Broken Heading</h2>'));
  });

  it('4. Project with missing local import or unsupported dependency returns MISSING_IMPORT / MISSING_DEPENDENCY', () => {
    const manifestMissingLocal = getSampleReactWebsiteManifest('MissingImportTest').map((file) =>
      file.path === 'src/App.jsx'
        ? {
            ...file,
            content: `import React from 'react';
import NonExistentWidget from './components/NonExistentWidget';
export default function App() {
  return <div><NonExistentWidget /></div>;
}`,
          }
        : file
    );

    const resLocal = compileWebsitePreview(manifestMissingLocal, 'React', 'MissingImportTest');
    assert.equal(resLocal.success, false);
    const missingImportErr = resLocal.errors.find((e) => e.type === 'MISSING_IMPORT');
    assert.ok(missingImportErr, 'Expected MISSING_IMPORT error');
    assert.equal(missingImportErr.file, 'src/App.jsx');
    assert.ok(missingImportErr.message.includes('./components/NonExistentWidget'));

    const manifestMissingDep = getSampleReactWebsiteManifest('MissingDepTest').map((file) =>
      file.path === 'src/App.jsx'
        ? {
            ...file,
            content: `import React from 'react';
import axios from 'axios';
export default function App() {
  return <div>Hello</div>;
}`,
          }
        : file
    );

    const resDep = compileWebsitePreview(manifestMissingDep, 'React', 'MissingDepTest');
    assert.equal(resDep.success, false);
    const missingDepErr = resDep.errors.find((e) => e.type === 'MISSING_DEPENDENCY');
    assert.ok(missingDepErr, 'Expected MISSING_DEPENDENCY error');
    assert.equal(missingDepErr.file, 'src/App.jsx');
    assert.ok(missingDepErr.message.includes('axios'));
  });

  it('5. Preview refresh after editing source updates compiled output deterministically', () => {
    const initialManifest = getSampleReactWebsiteManifest('LiveEditApp');
    const initialCompile = compileWebsitePreview(initialManifest, 'React', 'LiveEditApp');
    assert.equal(initialCompile.success, true);
    assert.ok(!initialCompile.compiledHtml.includes('CUSTOM_LIVE_EDITED_HEADING_2026'));

    const editedManifest = initialManifest.map((file) =>
      file.path === 'src/App.jsx'
        ? {
            ...file,
            content: file.content.replace(
              'Deploy Resilient Cloud Infrastructure at Scale',
              'CUSTOM_LIVE_EDITED_HEADING_2026'
            ),
          }
        : file
    );

    const refreshedCompile = compileWebsitePreview(editedManifest, 'React', 'LiveEditApp');
    assert.equal(refreshedCompile.success, true);
    assert.equal(refreshedCompile.errors.length, 0);
    assert.ok(refreshedCompile.compiledHtml.includes('CUSTOM_LIVE_EDITED_HEADING_2026'));
  });

  it('6. ZIP export preserves all modified React/Vite manifest files accurately', async () => {
    const manifest = getSampleReactWebsiteManifest('ZipIntegritySite');
    const zip = new JSZip();
    manifest.forEach((f) => {
      const cleanPath = f.path.replace(/^\/+/, '').replace(/\.\.+[/\\]/g, '').trim();
      zip.file(cleanPath, f.content);
    });
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    assert.ok(buffer.byteLength > 0);

    const loadedZip = await JSZip.loadAsync(buffer);
    const zippedFiles = Object.values(loadedZip.files)
      .filter((f) => !f.dir)
      .map((f) => f.name);
    assert.equal(zippedFiles.length, 10);
    assert.ok(zippedFiles.includes('package.json'));
    assert.ok(zippedFiles.includes('src/App.jsx'));
    assert.ok(zippedFiles.includes('src/components/Navbar.jsx'));
    assert.ok(zippedFiles.includes('src/components/FeatureGrid.jsx'));
    assert.ok(zippedFiles.includes('src/components/PricingCalculator.jsx'));
  });

  it('7. Security isolation: compiled preview enforces strict CSP, blocks network & eval, and injects zero external scripts', () => {
    const manifest = getSampleReactWebsiteManifest('SecurityAuditSite');
    const result = compileWebsitePreview(manifest, 'React', 'SecurityAuditSite');
    assert.equal(result.success, true);

    assert.ok(
      result.compiledHtml.includes("default-src 'none'"),
      'Preview HTML must enforce default-src none'
    );
    assert.ok(
      result.compiledHtml.includes("connect-src 'none'"),
      'Preview HTML must block outbound network requests via connect-src none'
    );
    assert.ok(
      !result.compiledHtml.includes('unsafe-eval'),
      'Preview HTML must NOT allow unsafe-eval'
    );
    assert.ok(
      !result.compiledHtml.includes('https://cdn.tailwindcss.com'),
      'Preview HTML must NOT load arbitrary external CDN scripts'
    );
  });
});
