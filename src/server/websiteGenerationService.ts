import { Schema, Type } from '@google/genai';
import {
  compileWebsitePreview,
  CompilationDiagnostic,
  normalizeGeneratedSourceCode,
  validateJsxAndSyntax,
} from '../utils/reactPreviewCompiler';
import {
  GeminiRequestError,
  GeminiRequestManager,
  getErrorStatusCode,
  isTransientRetryableGeminiError,
  normalizeGeminiError,
  parseRetryAfterMs,
} from './geminiRequestManager';

export { getErrorStatusCode };

/**
 * Verified official Gemini 4 model identifiers per @google/genai SDK specification:
 * - 'gemini-4-hydrogen': Primary Flash model for Code Generator and Website Generator.
 * - 'gemini-4-argon': Optional override/fallback model identifier (not default primary).
 */
export const ARGON_MODEL_ID = 'gemini-4-argon';
export const HYDROGEN_MODEL_ID = 'gemini-4-hydrogen';

export interface WebsiteManifestFile {
  path: string;
  content: string;
  type: 'source' | 'config' | 'style' | 'markup' | 'doc' | string;
}

export interface WebsiteManifestPayload {
  websiteName: string;
  framework: string;
  category: string;
  technology: string;
  designDirection: string;
  summary: string;
  entryHtml?: string;
  dependencies?: string[];
  fileManifest: WebsiteManifestFile[];
}

export interface WebsiteGenerationInput {
  websiteName: string;
  category: string;
  technology?: string;
  designDirection?: string;
  description: string;
  requirements?: string;
}

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  jitterMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/**
 * Gemini structured JSON response schema matching WebsiteManifestPayload.
 * Conforms to @google/genai Type enum.
 */
export const WEBSITE_MANIFEST_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: [
    'websiteName',
    'category',
    'technology',
    'designDirection',
    'summary',
    'fileManifest',
  ],
  properties: {
    websiteName: {
      type: Type.STRING,
      description: 'Display name of the generated website project.',
    },
    framework: {
      type: Type.STRING,
      description: 'Framework identifier (e.g., React 19 + Vite or HTML5/CSS3/ES6).',
    },
    category: {
      type: Type.STRING,
      description: 'Website category (e.g., SaaS, Portfolio, Business).',
    },
    technology: {
      type: Type.STRING,
      description: 'Technology stack (e.g., React or HTML / CSS / JS).',
    },
    designDirection: {
      type: Type.STRING,
      description: 'Visual design direction (e.g., Dark, Modern, Minimal).',
    },
    summary: {
      type: Type.STRING,
      description: 'Brief architectural summary of the generated project.',
    },
    entryHtml: {
      type: Type.STRING,
      description: 'Optional root HTML entry content (index.html).',
    },
    dependencies: {
      type: Type.ARRAY,
      description: 'List of npm package dependencies used by the project (e.g. react, react-dom, lucide-react).',
      items: {
        type: Type.STRING,
      },
    },
    fileManifest: {
      type: Type.ARRAY,
      description: 'Complete list of project files in the website manifest.',
      items: {
        type: Type.OBJECT,
        required: ['path', 'content', 'type'],
        properties: {
          path: {
            type: Type.STRING,
            description: 'Relative POSIX file path (e.g., src/App.jsx).',
          },
          content: {
            type: Type.STRING,
            description: 'Complete file source code or markup.',
          },
          type: {
            type: Type.STRING,
            enum: ['source', 'config', 'style', 'markup', 'doc'],
            description: 'Manifest file category.',
          },
        },
      },
    },
  },
};

/**
 * Schema for targeted single-file syntax repair.
 */
export const WEBSITE_FILE_REPAIR_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ['path', 'content', 'fixSummary'],
  properties: {
    path: {
      type: Type.STRING,
      description: 'Exact file path of the repaired source file.',
    },
    content: {
      type: Type.STRING,
      description: 'Complete corrected source code for this file with valid JSX and JavaScript syntax.',
    },
    fixSummary: {
      type: Type.STRING,
      description: 'Concise description of the syntax correction applied.',
    },
  },
};

/**
 * Sanitizes a virtual project file path against traversal and normalization issues.
 */
export function sanitizeManifestFilePath(filePath: string): string {
  const normalized = String(filePath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^\.\//, '')
    .trim();

  const safeSegments: string[] = [];
  for (const segment of normalized.split('/')) {
    if (!segment || segment === '.' || segment === '..') {
      continue;
    }
    safeSegments.push(segment);
  }
  return safeSegments.join('/');
}

/**
 * Strips ONLY an outer markdown code fence wrapping the entire payload.
 * Preserves any inner ``` fences contained inside JSON string literals (e.g., README.md).
 */
export function stripOuterCodeFence(rawText: string): string {
  const trimmed = rawText.trim();
  const openMatch = trimmed.match(/^```(?:json)?[ \t]*\r?\n/i);
  if (!openMatch) {
    return trimmed;
  }
  const withoutOpen = trimmed.slice(openMatch[0].length);
  const closeMatch = withoutOpen.match(/\r?\n```[ \t]*$/);
  if (!closeMatch) {
    return trimmed;
  }
  return withoutOpen.slice(0, withoutOpen.length - closeMatch[0].length).trim();
}

/**
 * Extracts the top-level balanced JSON object from model output using a string-aware
 * brace scanner (never corrupting braces or fences inside string literals).
 */
export function extractBalancedJsonObject(rawText: string): {
  json: string | null;
  truncated: boolean;
} {
  const text = stripOuterCodeFence(rawText);
  const start = text.indexOf('{');
  if (start === -1) {
    return { json: null, truncated: false };
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return { json: text.slice(start, i + 1), truncated: false };
      }
    }
  }

  return { json: text.slice(start), truncated: true };
}

/**
 * Escapes raw unescaped ASCII control characters (0x00–0x1F, including literal
 * newlines, carriage returns, and tabs) ONLY inside JSON string literals.
 * Valid JSON already using \\n, \\t, \\", \\\\ is preserved without alteration.
 */
export function sanitizeControlCharsInJsonStrings(jsonText: string): string {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < jsonText.length; i++) {
    const ch = jsonText[i];
    const code = ch.charCodeAt(0);

    if (!inString) {
      if (ch === '"') {
        inString = true;
      }
      out += ch;
      continue;
    }

    if (escaped) {
      escaped = false;
      if (code < 0x20) {
        out += escapeControlChar(code);
      } else {
        out += ch;
      }
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      out += ch;
      continue;
    }

    if (ch === '"') {
      inString = false;
      out += ch;
      continue;
    }

    if (code < 0x20) {
      out += escapeControlChar(code);
      continue;
    }

    out += ch;
  }

  return out;
}

function escapeControlChar(code: number): string {
  switch (code) {
    case 0x08:
      return '\\b';
    case 0x09:
      return '\\t';
    case 0x0a:
      return '\\n';
    case 0x0c:
      return '\\f';
    case 0x0d:
      return '\\r';
    default:
      return `\\u${code.toString(16).padStart(4, '0')}`;
  }
}

export type ParseWebsiteJsonResult =
  | { success: true; data: unknown }
  | {
      success: false;
      code: 'EMPTY_AI_RESPONSE' | 'TRUNCATED_AI_OUTPUT' | 'INVALID_AI_JSON';
      error: string;
    };

/**
 * Robustly extracts and parses JSON from Gemini Website Generator responses.
 * Never throws raw JSON.parse SyntaxErrors to callers.
 */
export function parseWebsiteGeneratorJson(rawText: string | undefined | null): ParseWebsiteJsonResult {
  const raw = typeof rawText === 'string' ? rawText.trim() : '';
  if (!raw) {
    return {
      success: false,
      code: 'EMPTY_AI_RESPONSE',
      error: 'The AI model returned an empty response. Please try generating again.',
    };
  }

  // Pass 1: Direct parse for strictly valid JSON
  try {
    return { success: true, data: JSON.parse(raw) };
  } catch {
    // Continue to extraction & control-character sanitization
  }

  // Pass 2: Extract balanced JSON object (handling outer markdown fences or prose)
  const { json: extracted, truncated } = extractBalancedJsonObject(raw);
  if (!extracted) {
    return {
      success: false,
      code: 'INVALID_AI_JSON',
      error:
        'The AI model returned output without a valid JSON website manifest. Please retry generation.',
    };
  }

  if (!truncated) {
    try {
      return { success: true, data: JSON.parse(extracted) };
    } catch {
      // Fall through to control-character sanitization
    }
  }

  // Pass 3: Sanitize literal control characters inside string literals
  const sanitized = sanitizeControlCharsInJsonStrings(extracted);
  try {
    return { success: true, data: JSON.parse(sanitized) };
  } catch {
    if (truncated) {
      return {
        success: false,
        code: 'TRUNCATED_AI_OUTPUT',
        error:
          'The AI response was truncated before completing the website manifest. Please retry with a slightly shorter specification.',
      };
    }
    return {
      success: false,
      code: 'INVALID_AI_JSON',
      error:
        'The AI response contained malformed JSON that could not be safely parsed into a website manifest. Please retry generation.',
    };
  }
}

export type ManifestValidationResult =
  | { valid: true; data: WebsiteManifestPayload }
  | { valid: false; code: 'INVALID_MANIFEST' | 'INCOMPLETE_MANIFEST'; error: string };

function inferManifestFileType(
  filePath: string,
  providedType: unknown
): WebsiteManifestFile['type'] {
  const allowed = new Set(['source', 'config', 'style', 'markup', 'doc']);
  if (typeof providedType === 'string' && allowed.has(providedType.trim())) {
    return providedType.trim();
  }
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.html')) return 'markup';
  if (lower.endsWith('.css') || lower.endsWith('.scss')) return 'style';
  if (lower.endsWith('.md') || lower.endsWith('.txt')) return 'doc';
  if (
    lower === 'package.json' ||
    lower.startsWith('vite.config.') ||
    lower.startsWith('tsconfig') ||
    lower.endsWith('.json')
  ) {
    return 'config';
  }
  return 'source';
}

/**
 * Validates and normalizes a parsed AI website manifest before passing it
 * to source-code validation or preview compilation.
 */
export function validateAndNormalizeWebsiteManifest(
  parsed: unknown,
  fallbackMeta: {
    websiteName: string;
    category: string;
    technology: string;
    designDirection: string;
  }
): ManifestValidationResult {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      valid: false,
      code: 'INVALID_MANIFEST',
      error: 'The AI returned an invalid website manifest structure. Please retry generation.',
    };
  }

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.fileManifest) || obj.fileManifest.length === 0) {
    return {
      valid: false,
      code: 'INCOMPLETE_MANIFEST',
      error:
        'The AI generated an incomplete website manifest with no project files. Please retry generation.',
    };
  }

  const fileMap = new Map<string, WebsiteManifestFile>();
  for (let i = 0; i < obj.fileManifest.length; i++) {
    const rawEntry = obj.fileManifest[i];
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      return {
        valid: false,
        code: 'INVALID_MANIFEST',
        error: `Manifest entry #${i + 1} is malformed. Please retry generation.`,
      };
    }

    const entry = rawEntry as Record<string, unknown>;
    if (typeof entry.path !== 'string' || !entry.path.trim()) {
      return {
        valid: false,
        code: 'INVALID_MANIFEST',
        error: `Manifest entry #${i + 1} is missing a valid file path. Please retry generation.`,
      };
    }
    if (typeof entry.content !== 'string') {
      return {
        valid: false,
        code: 'INVALID_MANIFEST',
        error: `Manifest file "${entry.path}" is missing string content. Please retry generation.`,
      };
    }

    const safePath = sanitizeManifestFilePath(entry.path);
    if (!safePath) {
      return {
        valid: false,
        code: 'INVALID_MANIFEST',
        error: `Manifest entry "${entry.path}" resolved to an unsafe or empty path.`,
      };
    }

    const inferredType = inferManifestFileType(safePath, entry.type);
    if (
      inferredType !== 'doc' &&
      entry.content.trim().length === 0
    ) {
      return {
        valid: false,
        code: 'INCOMPLETE_MANIFEST',
        error: `Manifest file "${safePath}" has empty content. Please retry generation.`,
      };
    }

    const normalizedContent = normalizeGeneratedSourceCode(safePath, entry.content);

    fileMap.set(safePath, {
      path: safePath,
      content: normalizedContent,
      type: inferredType,
    });
  }

  // If top-level `entryHtml` was provided and `index.html` is missing, synthesize `index.html`
  if (
    !fileMap.has('index.html') &&
    typeof obj.entryHtml === 'string' &&
    obj.entryHtml.trim().length > 0
  ) {
    fileMap.set('index.html', {
      path: 'index.html',
      content: obj.entryHtml.trim(),
      type: 'markup',
    });
  }

  const normalizedFiles = Array.from(fileMap.values());
  const byLowerPath = new Map(normalizedFiles.map((f) => [f.path.toLowerCase(), f]));

  const resolvedTechnology =
    typeof obj.technology === 'string' && obj.technology.trim()
      ? obj.technology.trim()
      : fallbackMeta.technology;
  const isReact = resolvedTechnology.toLowerCase().includes('react');

  // Verify HTML entry point exists and is non-empty
  const htmlEntry =
    byLowerPath.get('index.html') ||
    normalizedFiles.find((f) => f.path.toLowerCase().endsWith('.html'));
  if (!htmlEntry || !htmlEntry.content.trim()) {
    return {
      valid: false,
      code: 'INCOMPLETE_MANIFEST',
      error:
        'The generated website manifest is missing a non-empty index.html entry file. Please retry generation.',
    };
  }

  let dependenciesList: string[] = Array.isArray(obj.dependencies)
    ? obj.dependencies.filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
    : [];

  if (isReact) {
    const pkgFile = byLowerPath.get('package.json');
    if (!pkgFile || !pkgFile.content.trim()) {
      return {
        valid: false,
        code: 'INCOMPLETE_MANIFEST',
        error:
          'The generated React project manifest is missing package.json. Please retry generation.',
      };
    }

    try {
      const parsedPkg = JSON.parse(pkgFile.content);
      if (!parsedPkg || typeof parsedPkg !== 'object' || Array.isArray(parsedPkg)) {
        throw new Error('package.json must be a JSON object');
      }
      if (dependenciesList.length === 0 && parsedPkg.dependencies) {
        dependenciesList = Object.keys(parsedPkg.dependencies);
      }
    } catch {
      return {
        valid: false,
        code: 'INCOMPLETE_MANIFEST',
        error:
          'The generated React project contains an invalid package.json file. Please retry generation.',
      };
    }

    const hasReactAppOrMain = [
      'src/app.jsx',
      'src/app.tsx',
      'src/main.jsx',
      'src/main.tsx',
      'app.jsx',
      'app.tsx',
      'main.jsx',
      'main.tsx',
    ].some((candidate) => {
      const file = byLowerPath.get(candidate);
      return Boolean(file && file.content.trim().length > 0);
    });

    if (!hasReactAppOrMain) {
      return {
        valid: false,
        code: 'INCOMPLETE_MANIFEST',
        error:
          'The generated React project manifest is missing an application entry file (such as src/App.jsx or src/main.jsx). Please retry generation.',
      };
    }
  }

  const resolvedWebsiteName =
    typeof obj.websiteName === 'string' && obj.websiteName.trim()
      ? obj.websiteName.trim()
      : fallbackMeta.websiteName;

  return {
    valid: true,
    data: {
      websiteName: resolvedWebsiteName,
      framework:
        typeof obj.framework === 'string' && obj.framework.trim()
          ? obj.framework.trim()
          : isReact
          ? 'React 19 + Vite'
          : 'HTML5 / CSS3 / ES6',
      category:
        typeof obj.category === 'string' && obj.category.trim()
          ? obj.category.trim()
          : fallbackMeta.category,
      technology: resolvedTechnology,
      designDirection:
        typeof obj.designDirection === 'string' && obj.designDirection.trim()
          ? obj.designDirection.trim()
          : fallbackMeta.designDirection,
      summary:
        typeof obj.summary === 'string' && obj.summary.trim()
          ? obj.summary.trim()
          : `Generated ${resolvedTechnology} multi-file website project.`,
      entryHtml: htmlEntry.content,
      dependencies: dependenciesList,
      fileManifest: normalizedFiles,
    },
  };
}

/**
 * Deterministic fast local repair for common source issues before invoking any AI repair call:
 * 1. Normalizes multiline JSX expressions like `{'\n'}` -> `{' '}`.
 * 2. If `MISSING_DEPENDENCY` is reported for a sandbox-supported package (e.g. `lucide-react`, `clsx`, `framer-motion`)
 *    that was omitted from `package.json`, adds it to `package.json`.
 */
export function applyDeterministicManifestRepairs(
  manifest: WebsiteManifestPayload,
  diagnostics: CompilationDiagnostic[] = []
): WebsiteManifestPayload {
  const updatedFiles = manifest.fileManifest.map((f) => ({
    ...f,
    content: normalizeGeneratedSourceCode(f.path, f.content),
  }));

  // Check if any MISSING_DEPENDENCY is for a supported sandbox package missing from package.json
  const supportedSandboxDeps = new Set([
    'react',
    'react-dom',
    'lucide-react',
    'motion',
    'framer-motion',
    'clsx',
  ]);
  const missingSupportedDeps = new Set<string>();
  for (const diag of diagnostics) {
    if (diag.type === 'MISSING_DEPENDENCY' && diag.message.includes('in package.json')) {
      const m = diag.message.match(/Missing dependency '([^']+)' in package\.json/);
      if (m && supportedSandboxDeps.has(m[1])) {
        missingSupportedDeps.add(m[1]);
      }
    }
  }

  if (missingSupportedDeps.size > 0) {
    const pkgIdx = updatedFiles.findIndex((f) => f.path.toLowerCase() === 'package.json');
    if (pkgIdx >= 0) {
      try {
        const pkgObj = JSON.parse(updatedFiles[pkgIdx].content);
        pkgObj.dependencies = pkgObj.dependencies || {};
        for (const dep of missingSupportedDeps) {
          pkgObj.dependencies[dep] = pkgObj.dependencies[dep] || '^1.0.0';
        }
        updatedFiles[pkgIdx] = {
          ...updatedFiles[pkgIdx],
          content: JSON.stringify(pkgObj, null, 2),
        };
      } catch {
        // Ignore if package.json is not valid JSON
      }
    }
  }

  return {
    ...manifest,
    fileManifest: updatedFiles,
  };
}

/**
 * Bounded automatic source-code repair pipeline (Requirement 3C).
 * When a generated file fails syntax or import validation:
 * 1. Identifies the exact file and compiler diagnostic.
 * 2. Sends ONLY the affected file source and diagnostic to the repair prompt.
 * 3. Requests a minimal syntax correction.
 * 4. Revalidates the corrected source and never replaces valid source with broken source.
 * 5. Repeats within a strict retry limit (`maxRepairAttempts`, default 2).
 */
export async function validateAndRepairWebsiteManifest(options: {
  manifest: WebsiteManifestPayload;
  model: string;
  generateContent: (params: {
    model: string;
    contents: string;
    config: {
      systemInstruction: string;
      responseMimeType: string;
      responseSchema: Schema;
    };
  }) => Promise<{ text?: string }>;
  maxRepairAttempts?: number;
  retryOptions?: RetryOptions;
  requestManager?: GeminiRequestManager;
  scopeKey?: string;
}): Promise<{
  success: boolean;
  manifest: WebsiteManifestPayload;
  diagnostics: CompilationDiagnostic[];
  repairAttemptsUsed: number;
}> {
  const { manifest, model, generateContent, retryOptions, requestManager, scopeKey } = options;
  const maxRepairAttempts = Math.max(0, Math.min(2, options.maxRepairAttempts ?? 1));

  let currentManifest = manifest;
  let compileResult = compileWebsitePreview(
    currentManifest.fileManifest,
    currentManifest.technology,
    currentManifest.websiteName,
    'server_gate_initial'
  );

  if (compileResult.success && compileResult.errors.length === 0) {
    return {
      success: true,
      manifest: currentManifest,
      diagnostics: [],
      repairAttemptsUsed: 0,
    };
  }

  // Step 1: Try deterministic zero-cost local repair first
  currentManifest = applyDeterministicManifestRepairs(currentManifest, compileResult.errors);
  compileResult = compileWebsitePreview(
    currentManifest.fileManifest,
    currentManifest.technology,
    currentManifest.websiteName,
    'server_gate_deterministic'
  );

  if (compileResult.success && compileResult.errors.length === 0) {
    return {
      success: true,
      manifest: currentManifest,
      diagnostics: [],
      repairAttemptsUsed: 0,
    };
  }

  // Step 2: Bounded AI targeted file repair for remaining failing files
  let repairAttemptsUsed = 0;

  for (let attempt = 0; attempt < maxRepairAttempts; attempt++) {
    if (compileResult.success && compileResult.errors.length === 0) {
      break;
    }

    // Group diagnostics by file path
    const errorsByFile = new Map<string, CompilationDiagnostic[]>();
    for (const err of compileResult.errors) {
      if (!errorsByFile.has(err.file)) {
        errorsByFile.set(err.file, []);
      }
      errorsByFile.get(err.file)!.push(err);
    }

    let anyFileImproved = false;

    for (const [targetFilePath, fileDiags] of errorsByFile.entries()) {
      const fileEntry = currentManifest.fileManifest.find((f) => f.path === targetFilePath);
      if (!fileEntry) continue;

      repairAttemptsUsed++;
      const manifestPathsList = currentManifest.fileManifest.map((f) => f.path).join(', ');
      const diagText = fileDiags
        .map(
          (d, i) =>
            `${i + 1}. [${d.type}] ${d.file}${d.line ? `:${d.line}` : ''}${
              d.column ? `:${d.column}` : ''
            } — ${d.message}${d.snippet ? `\nSnippet:\n${d.snippet}` : ''}`
        )
        .join('\n\n');

      const repairSystemPrompt = `You are a Principal React/JavaScript Compiler Engineer performing a minimal syntax repair on a single source file.
Rules:
1. Fix ONLY the reported compiler diagnostics in the provided file.
2. Preserve all component functionality, props, exports, and styling.
3. Never use raw unescaped newlines inside single-quoted ('...') or double-quoted ("...") JavaScript string literals or JSX expressions like {'\\n'}; use {' '} for inline spacing.
4. Keep valid JSX text apostrophes (such as Let's Talk or Don't) as normal JSX text.
5. Ensure all imports reference only files in the project manifest (${manifestPathsList}) or supported packages (react, react-dom, lucide-react, clsx).
6. Return the COMPLETE repaired file content in JSON matching the schema.`;

      const repairUserPrompt = `Target File: ${targetFilePath}
Available Manifest Files: ${manifestPathsList}

Compiler Diagnostics to Fix:
${diagText}

Current Source Code of ${targetFilePath}:
\`\`\`
${fileEntry.content}
\`\`\``;

      try {
        const repairRes = requestManager
          ? (
              await requestManager.execute({
                agentType: 'website_repair',
                scopeKey: scopeKey || 'guest:anon',
                model,
                contents: repairUserPrompt,
                config: {
                  systemInstruction: repairSystemPrompt,
                  responseMimeType: 'application/json',
                  responseSchema: WEBSITE_FILE_REPAIR_SCHEMA,
                },
                skipCache: true,
                generateContent,
              })
            ).response
          : await callWithBoundedRetry(
              () =>
                generateContent({
                  model,
                  contents: repairUserPrompt,
                  config: {
                    systemInstruction: repairSystemPrompt,
                    responseMimeType: 'application/json',
                    responseSchema: WEBSITE_FILE_REPAIR_SCHEMA,
                  },
                }),
              retryOptions
            );

        const parsedRepair = parseWebsiteGeneratorJson(repairRes.text);
        if (!parsedRepair.success || !parsedRepair.data || typeof parsedRepair.data !== 'object') {
          continue;
        }

        const repairedObj = parsedRepair.data as Record<string, unknown>;
        const rawCandidate =
          typeof repairedObj.content === 'string'
            ? repairedObj.content
            : typeof repairedObj.correctedContent === 'string'
            ? repairedObj.correctedContent
            : '';
        if (!rawCandidate.trim()) {
          continue;
        }

        const candidateContent = normalizeGeneratedSourceCode(targetFilePath, rawCandidate);

        // Verify candidate file has zero syntax errors before accepting it
        const candidateSyntaxErrors = validateJsxAndSyntax(targetFilePath, candidateContent);
        if (candidateSyntaxErrors.length > 0) {
          continue;
        }

        const candidateManifest: WebsiteManifestPayload = {
          ...currentManifest,
          fileManifest: currentManifest.fileManifest.map((f) =>
            f.path === targetFilePath ? { ...f, content: candidateContent } : f
          ),
        };

        const candidateCompile = compileWebsitePreview(
          candidateManifest.fileManifest,
          candidateManifest.technology,
          candidateManifest.websiteName,
          `server_gate_repair_${repairAttemptsUsed}`
        );

        const remainingErrorsForFile = candidateCompile.errors.filter(
          (e) => e.file === targetFilePath
        );

        // Never replace valid/better source with worse source: only accept if file errors decreased
        if (
          remainingErrorsForFile.length < fileDiags.length &&
          candidateCompile.errors.length <= compileResult.errors.length
        ) {
          currentManifest = candidateManifest;
          compileResult = candidateCompile;
          anyFileImproved = true;
        }
      } catch (repairErr) {
        const repairStatus = getErrorStatusCode(repairErr);
        // Never keep firing additional repair calls on quota/429, 503, 403, or timeout
        if (
          repairStatus === 429 ||
          repairStatus === 503 ||
          repairStatus === 403 ||
          (repairErr instanceof GeminiRequestError &&
            (repairErr.code === 'QUOTA_EXHAUSTED' ||
              repairErr.code === 'AI_TIMEOUT' ||
              repairErr.code === 'MODEL_UNAVAILABLE'))
        ) {
          throw repairErr;
        }
        // Otherwise stop extra repair attempts cleanly and report original diagnostics
      }
      // Cap total AI repair calls per website generation to prevent quota burn
      if (repairAttemptsUsed >= 2) {
        break;
      }
    }

    if (!anyFileImproved || repairAttemptsUsed >= 2) {
      break;
    }
  }

  return {
    success: compileResult.success && compileResult.errors.length === 0,
    manifest: currentManifest,
    diagnostics: compileResult.errors,
    repairAttemptsUsed,
  };
}

export function isRetryableGeminiError(error: unknown): boolean {
  return isTransientRetryableGeminiError(error);
}

/**
 * Executes an async Gemini API call with bounded exponential backoff and jitter
 * for transient HTTP 503 / network failures (HTTP 429 fails fast immediately).
 */
export async function callWithBoundedRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = Math.max(0, Math.min(3, options.maxRetries ?? 2));
  const baseDelayMs = options.baseDelayMs ?? 800;
  const jitterMs = options.jitterMs ?? 400;
  const maxDelayMs = options.maxDelayMs ?? 4000;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (attempt >= maxRetries || !isRetryableGeminiError(err)) {
        throw err;
      }
      const retryAfterMs = parseRetryAfterMs(err);
      if (retryAfterMs && retryAfterMs > 10_000) {
        throw err;
      }
      const exponential = baseDelayMs * Math.pow(2, attempt);
      const jitter = Math.floor(random() * jitterMs);
      const delay = retryAfterMs
        ? Math.min(10_000, retryAfterMs)
        : Math.min(maxDelayMs, exponential + jitter);
      await sleep(delay);
    }
  }
  throw lastError;
}

export function buildWebsiteGenerationPrompts(input: WebsiteGenerationInput) {
  const category = input.category;
  const technology = input.technology || 'React';
  const designDirection = input.designDirection || 'Modern';
  const requirements = input.requirements || '';

  const systemPrompt = `You are a World-Class Principal Frontend Architect and Web Designer.
You build complete, responsive, zero-error web applications that compile and render cleanly.

CRITICAL ARCHITECTURAL & SYNTAX CONSTRAINTS:
1. For React projects, generate ALL of the following files in fileManifest:
   - package.json (valid JSON declaring react, react-dom, and lucide-react in dependencies)
   - index.html (with <div id="root"></div> and <script type="module" src="/src/main.jsx"></script>)
   - vite.config.js
   - src/main.jsx (mounting App into #root)
   - src/App.jsx (complete interactive application coordinating navigation, state, sections, and footer)
   - src/index.css (clean responsive utility CSS and custom theme classes)
   - src/components/Navbar.jsx (responsive navigation bar with section switching and CTA buttons)
   - src/components/Hero.jsx (high-impact hero section with interactive CTAs and visual metrics/illustrations)
   - src/components/FeatureGrid.jsx (interactive feature/content cards with filtering or selection state)
   - README.md (project setup and architecture overview)
2. For HTML/CSS/JS projects, generate:
   - index.html (complete semantic HTML5 with responsive navigation, hero, content sections, validated form, and footer)
   - styles.css (modern responsive CSS with flex/grid and custom properties)
   - app.js (clean ES6 JavaScript with interactive state and form validation)
   - README.md
3. STRICT JSX & JAVASCRIPT CORRECTNESS:
   - NEVER insert raw unescaped newlines inside single-quoted ('...') or double-quoted ("...") JS string literals or JSX expressions such as {'\\n'}. Use {' '} for inline JSX spaces.
   - Keep natural apostrophes in JSX text content (e.g., Let's Talk, Don't, We're) directly as JSX text.
   - Close every JSX tag, brace, parenthesis, string literal, and template literal properly.
   - ALL imports must resolve to files present in fileManifest or supported packages (react, react-dom, lucide-react, clsx).
   - Every component imported in src/App.jsx MUST exist in fileManifest with matching default/named exports.
4. ASSET & UX INTEGRITY:
   - Do NOT use external HTTP/HTTPS image URLs (the isolated sandbox blocks external network requests via CSP); use Lucide icons, inline SVGs, or CSS gradients/illustrations so there are zero broken images.
   - Include interactive forms with real client-side validation. For contact/inquiry forms, state clearly that input was validated locally in preview mode rather than faking backend message delivery.
   - Output strictly valid JSON conforming to the response schema.`;

  const userPrompt = `Website Name: ${input.websiteName}
Category: ${category}
Technology: ${technology}
Design Direction: ${designDirection}
Description: ${input.description}
Requirements: ${requirements}`;

  return { systemPrompt, userPrompt };
}

export interface WebsiteGenerationHttpResponse {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Orchestrates Website Generator AI synthesis using Hydrogen ('gemini-4-hydrogen') as default
 * primary model, bounded retry on 503/429, robust JSON parsing/sanitization, manifest validation,
 * full source-code compilation verification, and bounded automatic repair.
 */
export async function executeWebsiteGeneration(options: {
  input: WebsiteGenerationInput;
  apiKeyConfigured: boolean;
  model?: string;
  fallbackModel?: string;
  candidateModels?: string[];
  useModelRouter?: boolean;
  generateContent: (params: {
    model: string;
    contents: string;
    config: {
      systemInstruction: string;
      responseMimeType: string;
      responseSchema: Schema;
    };
  }) => Promise<{ text?: string }>;
  retryOptions?: RetryOptions;
  maxRepairAttempts?: number;
  requestManager?: GeminiRequestManager;
  scopeKey?: string;
  skipCache?: boolean;
}): Promise<WebsiteGenerationHttpResponse> {
  const {
    input,
    apiKeyConfigured,
    model = HYDROGEN_MODEL_ID,
    fallbackModel,
    candidateModels,
    useModelRouter = false,
    generateContent,
    retryOptions,
    maxRepairAttempts = 1,
    requestManager,
    scopeKey = 'guest:anon',
    skipCache = false,
  } = options;

  if (!input.websiteName?.trim() || !input.category?.trim() || !input.description?.trim()) {
    return {
      status: 400,
      body: {
        error: 'Missing required fields: websiteName, category, and description are required.',
      },
    };
  }

  if (!apiKeyConfigured) {
    return {
      status: 503,
      body: {
        code: 'API_KEY_MISSING',
        demoModeAvailable: true,
        recommendDemoMode: true,
        error: 'Gemini API key is not configured on the server.',
      },
    };
  }

  const technology = input.technology || 'React';
  const designDirection = input.designDirection || 'Modern';
  const { systemPrompt, userPrompt } = buildWebsiteGenerationPrompts({
    ...input,
    technology,
    designDirection,
  });

  const invokeModel = async (targetModel: string): Promise<{ text?: string }> => {
    if (requestManager) {
      const managed = await requestManager.execute({
        agentType: 'website_generation',
        scopeKey,
        model: targetModel,
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: 'application/json',
          responseSchema: WEBSITE_MANIFEST_RESPONSE_SCHEMA,
        },
        skipCache,
        generateContent: generateContent as any,
      });
      return managed.response;
    }
    return callWithBoundedRetry(
      () =>
        generateContent({
          model: targetModel,
          contents: userPrompt,
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: 'application/json',
            responseSchema: WEBSITE_MANIFEST_RESPONSE_SCHEMA,
          },
        }),
      retryOptions
    );
  };

  let activeModel = model;
  let modelFallbackNotice: string | undefined;
  let attemptedModels: string[] = [model];
  let fallbackUsed = false;
  let response: { text?: string };

  if (requestManager && (useModelRouter || (candidateModels && candidateModels.length > 0))) {
    try {
      const routed = await requestManager.executeWithRouting({
        agentType: 'website_generation',
        scopeKey,
        preferredModel: model,
        candidateModels,
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: 'application/json',
          responseSchema: WEBSITE_MANIFEST_RESPONSE_SCHEMA,
        },
        skipCache,
        validateResponse: (rawText) => {
          const parsed = parseWebsiteGeneratorJson(rawText);
          if (!parsed.success) {
            return { valid: false, reason: parsed.error };
          }
          const norm = validateAndNormalizeWebsiteManifest(parsed.data, {
            websiteName: input.websiteName.trim(),
            category: input.category.trim(),
            technology,
            designDirection,
          });
          return norm.valid ? { valid: true } : { valid: false, reason: norm.error };
        },
        generateContent: generateContent as any,
      });
      response = routed.response;
      activeModel = routed.modelUsed;
      attemptedModels = routed.attemptedModels || [activeModel];
      fallbackUsed = Boolean(routed.fallbackUsed);
      modelFallbackNotice = routed.modelFallbackNotice;
    } catch (routerErr) {
      return mapProviderErrorToHttpResponse(routerErr, activeModel);
    }
  } else {
    try {
      response = await invokeModel(activeModel);
    } catch (primaryError) {
      const primaryStatus = getErrorStatusCode(primaryError);

      if (
        fallbackModel &&
        fallbackModel !== activeModel &&
        (primaryStatus === 403 || primaryStatus === 404 || primaryStatus === 503)
      ) {
        try {
          activeModel = fallbackModel;
          attemptedModels = [model, fallbackModel];
          fallbackUsed = true;
          modelFallbackNotice = `Primary model '${model}' returned HTTP ${primaryStatus}; generated using configured fallback model '${fallbackModel}'.`;
          response = await invokeModel(activeModel);
        } catch (fallbackError) {
          return mapProviderErrorToHttpResponse(fallbackError, activeModel);
        }
      } else {
        return mapProviderErrorToHttpResponse(primaryError, activeModel);
      }
    }
  }

  const parsedResult = parseWebsiteGeneratorJson(response.text);
  if (!parsedResult.success) {
    return {
      status: 502,
      body: {
        code: parsedResult.code,
        modelUsed: activeModel,
        attemptedModels,
        demoModeAvailable: true,
        error: parsedResult.error,
      },
    };
  }

  const validated = validateAndNormalizeWebsiteManifest(parsedResult.data, {
    websiteName: input.websiteName.trim(),
    category: input.category.trim(),
    technology,
    designDirection,
  });

  if (!validated.valid) {
    return {
      status: 502,
      body: {
        code: validated.code,
        modelUsed: activeModel,
        attemptedModels,
        demoModeAvailable: true,
        error: validated.error,
      },
    };
  }

  // Final Source-Code Validation & Bounded Automatic Repair Gate (aborts cleanly on 429/503/timeout)
  let verification;
  try {
    verification = await validateAndRepairWebsiteManifest({
      manifest: validated.data,
      model: activeModel,
      generateContent: generateContent as any,
      maxRepairAttempts,
      retryOptions,
      requestManager,
      scopeKey,
    });
  } catch (repairErr) {
    return mapProviderErrorToHttpResponse(repairErr, activeModel);
  }

  if (!verification.success) {
    const firstDiag = verification.diagnostics[0];
    const locationStr = firstDiag
      ? `${firstDiag.file}${firstDiag.line ? ` (line ${firstDiag.line})` : ''}: ${firstDiag.message}`
      : 'Generated source files failed compilation validation.';

    return {
      status: 422,
      body: {
        success: false,
        code: 'SOURCE_COMPILATION_FAILED',
        modelUsed: activeModel,
        attemptedModels,
        repairAttemptsUsed: verification.repairAttemptsUsed,
        diagnostics: verification.diagnostics,
        demoModeAvailable: true,
        error: `Generated website source failed validation after ${verification.repairAttemptsUsed} repair attempt(s) — ${locationStr}`,
      },
    };
  }

  return {
    status: 200,
    body: {
      success: true,
      requestId: `req_web_${Date.now()}`,
      modelUsed: activeModel,
      requestedModel: model,
      attemptedModels,
      fallbackUsed,
      ...(modelFallbackNotice ? { modelFallbackNotice } : {}),
      repairAttemptsUsed: verification.repairAttemptsUsed,
      data: verification.manifest,
    },
  };
}

function mapProviderErrorToHttpResponse(
  error: unknown,
  attemptedModel: string
): WebsiteGenerationHttpResponse {
  const normalized = normalizeGeminiError(error);
  const attemptedModels =
    error instanceof GeminiRequestError && error.attemptedModels
      ? error.attemptedModels
      : [attemptedModel];
  const allModelsExhausted =
    error instanceof GeminiRequestError ? Boolean(error.allModelsExhausted) : false;
  const recommendDemoMode =
    error instanceof GeminiRequestError ? Boolean(error.recommendDemoMode) : false;

  return {
    status: normalized.status,
    body: {
      code: normalized.code,
      modelAttempted: attemptedModel,
      attemptedModels,
      ...(allModelsExhausted ? { allModelsExhausted: true } : {}),
      ...(recommendDemoMode ? { recommendDemoMode: true } : {}),
      demoModeAvailable: true,
      ...(normalized.retryAfterSeconds ? { retryAfterSeconds: normalized.retryAfterSeconds } : {}),
      error: normalized.message,
    },
  };
}
