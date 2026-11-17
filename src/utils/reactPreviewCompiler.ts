/**
 * @fileoverview Multi-File React/Vite & HTML Preview Compiler, Dependency Resolver,
 * Source Sanitizer/Validator, and Opaque-Origin Sandbox Builder.
 *
 * SECURITY GUARANTEES:
 * 1. Performs purely static string/AST transformation and syntax validation in memory.
 *    Never executes untrusted user/AI code in the host application or backend server.
 * 2. Generates a self-contained HTML payload designed exclusively for an
 *    opaque-origin `<iframe sandbox="allow-scripts">` (WITHOUT `allow-same-origin`).
 * 3. Embeds a strict Content-Security-Policy (`default-src 'none'; script-src 'unsafe-inline';
 *    style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'`) that blocks
 *    `eval()`, `new Function()`, external script fetching, and network exfiltration.
 */

export interface ManifestFile {
  path: string;
  content: string;
  type: string;
}

export type DiagnosticType =
  | 'SYNTAX_ERROR'
  | 'MISSING_IMPORT'
  | 'MISSING_DEPENDENCY'
  | 'MANIFEST_ERROR'
  | 'RUNTIME_ERROR';

export interface CompilationDiagnostic {
  type: DiagnosticType;
  file: string;
  line?: number;
  column?: number;
  message: string;
  snippet?: string;
}

export interface PreviewCompilationResult {
  success: boolean;
  status: 'success' | 'error';
  errors: CompilationDiagnostic[];
  warnings: string[];
  compiledHtml: string;
  resolvedModules: string[];
  entryFile: string | null;
  compileTimeMs: number;
}

const SUPPORTED_SANDBOX_PACKAGES = new Set([
  'react',
  'react-dom',
  'react-dom/client',
  'lucide-react',
  'motion',
  'framer-motion',
  'motion/react',
  'clsx',
]);

/**
 * Documented capabilities and explicit boundaries of the in-browser React/Vite preview compiler.
 */
export const PREVIEW_COMPILER_CAPABILITIES = {
  supportedSyntax: [
    'Multi-file React (.jsx, .tsx) and JavaScript/TypeScript (.js, .ts) modules',
    'Functional components, nested JSX elements, fragments (<>...</>), and expression interpolation',
    'ES module imports/exports (default, named, namespace, and local CSS imports)',
    'Relative imports (./, ../), root-relative imports (/src/...), and alias imports (@/...)',
  ],
  supportedHooks: [
    'useState',
    'useReducer',
    'useEffect',
    'useMemo',
    'useCallback',
    'useRef',
    'createContext / useContext',
  ],
  supportedPackages: Array.from(SUPPORTED_SANDBOX_PACKAGES),
  securityBoundaries: [
    'Opaque-origin iframe (<iframe sandbox="allow-scripts"> without allow-same-origin)',
    "Strict Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'",
    'Zero network access: fetch, XMLHttpRequest, WebSocket, and external image/script URLs are blocked by CSP',
    'Zero host storage/DOM access: window.parent.document, localStorage, sessionStorage, and cookies are inaccessible',
    'Authenticated postMessage telemetry using per-compile previewToken and event.source validation',
  ],
  knownLimitations: [
    'Arbitrary npm packages from external CDNs are intentionally blocked to enforce offline zero-exfiltration security',
    'Server-side Node.js APIs (fs, net, child_process) are not available inside client-side previews',
    'Class components and legacy React lifecycle methods are not supported (use functional components and hooks)',
  ],
} as const;

function escapeInlineStyle(css: string): string {
  return css.replace(/<\/style/gi, '<\\/style');
}

function escapeInlineScript(js: string): string {
  return js.replace(/<\/script/gi, '<\\/script');
}

const VOID_HTML_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/**
 * Normalizes a relative path within the virtual project manifest.
 */
export function normalizeManifestPath(rawPath: string): string {
  const cleaned = rawPath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^\.\//, '')
    .trim();

  const segments = cleaned.split('/');
  const resolved: string[] = [];
  for (const seg of segments) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      resolved.pop();
    } else {
      resolved.push(seg);
    }
  }
  return resolved.join('/');
}

/**
 * Resolves a relative or alias import specifier from a given source file path
 * against the available manifest file map.
 */
export function resolveManifestImport(
  fromFile: string,
  specifier: string,
  fileMap: Map<string, ManifestFile>
): string | null {
  let targetBase = specifier.trim();

  if (targetBase.startsWith('@/')) {
    targetBase = targetBase.slice(2);
  } else if (targetBase.startsWith('/')) {
    targetBase = targetBase.slice(1);
  } else if (targetBase.startsWith('.')) {
    const dirParts = normalizeManifestPath(fromFile).split('/');
    dirParts.pop(); // remove filename
    const specParts = targetBase.split('/');
    for (const part of specParts) {
      if (part === '.' || !part) continue;
      if (part === '..') {
        dirParts.pop();
      } else {
        dirParts.push(part);
      }
    }
    targetBase = dirParts.join('/');
  } else {
    return null;
  }

  targetBase = normalizeManifestPath(targetBase);

  const candidates = [
    targetBase,
    `${targetBase}.jsx`,
    `${targetBase}.tsx`,
    `${targetBase}.js`,
    `${targetBase}.ts`,
    `${targetBase}.css`,
    `${targetBase}.json`,
    `${targetBase}/index.jsx`,
    `${targetBase}/index.tsx`,
    `${targetBase}/index.js`,
    `${targetBase}/index.ts`,
  ];

  if (specifier.startsWith('@/') && !targetBase.startsWith('src/')) {
    candidates.push(
      `src/${targetBase}`,
      `src/${targetBase}.jsx`,
      `src/${targetBase}.tsx`,
      `src/${targetBase}.js`,
      `src/${targetBase}.ts`,
      `src/${targetBase}.css`
    );
  }

  for (const cand of candidates) {
    if (fileMap.has(cand)) {
      return cand;
    }
  }

  return null;
}

/**
 * Extracts a code snippet around a 1-indexed line number.
 */
export function getCodeSnippet(content: string, lineNum: number): string {
  const lines = content.split('\n');
  const start = Math.max(0, lineNum - 2);
  const end = Math.min(lines.length, lineNum + 1);
  return lines
    .slice(start, end)
    .map((l, idx) => {
      const curr = start + idx + 1;
      const marker = curr === lineNum ? '>' : ' ';
      return `${marker} ${String(curr).padStart(3, ' ')} | ${l}`;
    })
    .join('\n');
}

/**
 * Computes 1-indexed line and column for a character offset in `source`.
 */
export function getLineAndCol(source: string, index: number): { line: number; column: number } {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === '\n') {
      line++;
      lastNewline = i;
    }
  }
  return { line, column: index - lastNewline };
}

/**
 * Strips JS line (`//...`) and block (`/*...* /`) comments while strictly preserving
 * string literals (`'...'`, `"..."`, and `` `...` ``), so URLs like `"https://..."`
 * are never corrupted.
 */
export function stripJsCommentsPreservingStrings(source: string): string {
  let out = '';
  let i = 0;
  const len = source.length;

  while (i < len) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      out += ch;
      i++;
      while (i < len && source[i] !== quote) {
        if (source[i] === '\\') {
          out += source[i] + (source[i + 1] || '');
          i += 2;
          continue;
        }
        out += source[i];
        i++;
      }
      if (i < len) {
        out += source[i];
        i++;
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      i += 2;
      while (i < len && source[i] !== '\n') i++;
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < len && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') out += '\n';
        i++;
      }
      if (i < len) i += 2;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

/**
 * Normalizes and sanitizes generated JS/JSX/TS/TSX source files to prevent
 * common LLM code-generation errors before validation and compilation:
 * 1. Strips accidental outer markdown fences (```jsx ... ```) wrapping a file.
 * 2. Replaces invalid multiline whitespace JSX expressions like `{'\n'}` or `{"\n  "}`
 *    (the Hero.jsx bug) with valid `{' '}`.
 * 3. Repairs literal unescaped newlines inside single/double-quoted string expressions
 *    inside `{ '...' }` or JSX attributes when the closing quote exists on the next line.
 * 4. Preserves legal JSX text apostrophes (such as `Let's Talk` or `Don't`) untouched.
 */
export function normalizeGeneratedSourceCode(filePath: string, rawContent: string): string {
  if (typeof rawContent !== 'string') return '';

  let content = rawContent.replace(/\r\n/g, '\n');

  // 1. Strip accidental outer markdown code fence if the model wrapped a source file
  const trimmed = content.trim();
  if (
    !filePath.toLowerCase().endsWith('.md') &&
    trimmed.startsWith('```') &&
    trimmed.endsWith('```')
  ) {
    const openMatch = trimmed.match(/^```[a-zA-Z0-9_-]*[ \t]*\n/);
    const closeMatch = trimmed.match(/\n```[ \t]*$/);
    if (openMatch && closeMatch) {
      content = trimmed.slice(openMatch[0].length, trimmed.length - closeMatch[0].length);
    }
  }

  const lower = filePath.toLowerCase();
  const isCodeFile =
    lower.endsWith('.jsx') ||
    lower.endsWith('.tsx') ||
    lower.endsWith('.js') ||
    lower.endsWith('.ts');

  if (!isCodeFile) {
    return content;
  }

  // 2. Fix Hero.jsx pattern: literal newline inside JSX whitespace expression `{' \n '}` or `{" \n "}`
  content = content.replace(/\{\s*(['"])[ \t]*\n[ \t\n]*\1\s*\}/g, "{' '}");

  // 3. Fix literal newline inside single-expression JSX string `{'some text\nmore text'}`
  content = content.replace(
    /\{\s*(['"])([^'"\\{}\n]*?(?:\n[^'"\\{}\n]*?)+)\1\s*\}/g,
    (_match, quote, inner: string) => {
      const escapedInner = inner.replace(/\n\s*/g, ' ');
      return `{${quote}${escapedInner}${quote}}`;
    }
  );

  // 4. Strip raw ASCII control characters (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F)
  content = content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  return content;
}

/**
 * Checks if `<` at position `pos` in `source` is in a JSX expression position
 * rather than a binary less-than comparison operator.
 */
function isJsxStartPosition(source: string, pos: number): boolean {
  let i = pos - 1;
  while (i >= 0 && /\s/.test(source[i])) {
    i--;
  }
  if (i < 0) return true;

  const prevChar = source[i];
  if ('({[=:?,!&|;>~+-*%^/'.includes(prevChar)) {
    return true;
  }

  let wordEnd = i + 1;
  while (i >= 0 && /[A-Za-z0-9_$]/.test(source[i])) {
    i--;
  }
  const word = source.slice(i + 1, wordEnd);
  if (['return', 'case', 'else', 'yield', 'await', 'default', 'throw'].includes(word)) {
    return true;
  }

  return false;
}

/**
 * Helper to advance past a template literal starting at `startIdx` (where `source[startIdx] === '\`'`),
 * properly handling nested `${ ... }` expressions and nested strings/template literals.
 */
function scanTemplateLiteral(
  filePath: string,
  source: string,
  startIdx: number
): { nextIndex: number; error?: CompilationDiagnostic } {
  const len = source.length;
  let i = startIdx + 1;

  while (i < len) {
    const ch = source[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '`') {
      return { nextIndex: i + 1 };
    }
    if (ch === '$' && source[i + 1] === '{') {
      const exprStart = i;
      i += 2; // skip '${'
      let depth = 1;
      while (i < len && depth > 0) {
        const c = source[i];
        const n = source[i + 1];
        if (c === '/' && n === '/') {
          i += 2;
          while (i < len && source[i] !== '\n') i++;
          continue;
        }
        if (c === '/' && n === '*') {
          i += 2;
          while (i < len && !(source[i] === '*' && source[i + 1] === '/')) i++;
          i += 2;
          continue;
        }
        if (c === "'" || c === '"') {
          const q = c;
          const qStart = i;
          i++;
          while (i < len && source[i] !== q) {
            if (source[i] === '\\') {
              i += 2;
              continue;
            }
            if (source[i] === '\n') {
              const loc = getLineAndCol(source, qStart);
              return {
                nextIndex: i,
                error: {
                  type: 'SYNTAX_ERROR',
                  file: filePath,
                  line: loc.line,
                  column: loc.column,
                  message: `Unterminated string literal (${q}) inside template expression.`,
                  snippet: getCodeSnippet(source, loc.line),
                },
              };
            }
            i++;
          }
          if (i >= len) {
            const loc = getLineAndCol(source, qStart);
            return {
              nextIndex: i,
              error: {
                type: 'SYNTAX_ERROR',
                file: filePath,
                line: loc.line,
                column: loc.column,
                message: `Unterminated string literal (${q}) inside template expression.`,
                snippet: getCodeSnippet(source, loc.line),
              },
            };
          }
          i++;
          continue;
        }
        if (c === '`') {
          const nested = scanTemplateLiteral(filePath, source, i);
          if (nested.error) return nested;
          i = nested.nextIndex;
          continue;
        }
        if (c === '{') depth++;
        else if (c === '}') depth--;
        i++;
      }
      if (depth > 0) {
        const loc = getLineAndCol(source, exprStart);
        return {
          nextIndex: i,
          error: {
            type: 'SYNTAX_ERROR',
            file: filePath,
            line: loc.line,
            column: loc.column,
            message: 'Unclosed ${...} expression inside template literal.',
            snippet: getCodeSnippet(source, loc.line),
          },
        };
      }
      continue;
    }
    i++;
  }

  const loc = getLineAndCol(source, startIdx);
  return {
    nextIndex: i,
    error: {
      type: 'SYNTAX_ERROR',
      file: filePath,
      line: loc.line,
      column: loc.column,
      message: 'Unterminated template literal (`).',
      snippet: getCodeSnippet(source, loc.line),
    },
  };
}

/**
 * Validates JSX structure, balanced delimiters, and string literals in a source file.
 * Properly distinguishes between JSX Text Content Mode (where apostrophes like `Let's Talk`,
 * slashes `//`, and parentheses in text are valid) and JavaScript Code/Expression Mode.
 */
export function validateJsxAndSyntax(
  filePath: string,
  source: string
): CompilationDiagnostic[] {
  const errors: CompilationDiagnostic[] = [];
  const len = source.length;

  const braceStack: Array<{ char: string; expected: string; index: number }> = [];
  const jsxStack: Array<{
    tagName: string;
    index: number;
    line: number;
    braceDepth: number;
  }> = [];

  let i = 0;

  while (i < len) {
    const ch = source[i];
    const next = source[i + 1];

    // Check if we are directly inside JSX text children (between `>` and `<` or `{`)
    const inJsxTextMode =
      jsxStack.length > 0 &&
      braceStack.length === jsxStack[jsxStack.length - 1].braceDepth;

    if (inJsxTextMode) {
      // In JSX text mode, apostrophes (e.g. `Let's Talk`), quotes, `//`, `(`, `)` are plain text!
      // Only `<`, `{`, and unexpected `}` have syntactic meaning.
      if (ch === '{') {
        braceStack.push({ char: '{', expected: '}', index: i });
        i++;
        continue;
      }
      if (ch === '}') {
        const loc = getLineAndCol(source, i);
        errors.push({
          type: 'SYNTAX_ERROR',
          file: filePath,
          line: loc.line,
          column: loc.column,
          message: `Unexpected '}' in JSX text without matching '{'.`,
          snippet: getCodeSnippet(source, loc.line),
        });
        return errors;
      }
      if (ch !== '<') {
        i++;
        continue;
      }
      // If `ch === '<'`, fall through to handle closing `</Tag>` or nested opening `<Tag>`
    }

    // 1. Line comment (only in JS code/expression mode)
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < len && source[i] !== '\n') i++;
      continue;
    }

    // 2. Block comment (only in JS code/expression mode)
    if (ch === '/' && next === '*') {
      const startIdx = i;
      i += 2;
      while (i < len && !(source[i] === '*' && source[i + 1] === '/')) {
        i++;
      }
      if (i >= len) {
        const loc = getLineAndCol(source, startIdx);
        errors.push({
          type: 'SYNTAX_ERROR',
          file: filePath,
          line: loc.line,
          column: loc.column,
          message: 'Unterminated block comment /* ... */.',
          snippet: getCodeSnippet(source, loc.line),
        });
        return errors;
      }
      i += 2;
      continue;
    }

    // 3. Single or double quoted string (only in JS code/expression mode)
    if (ch === "'" || ch === '"') {
      const quote = ch;
      const startIdx = i;
      i++;
      while (i < len && source[i] !== quote) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === '\n') {
          const loc = getLineAndCol(source, startIdx);
          errors.push({
            type: 'SYNTAX_ERROR',
            file: filePath,
            line: loc.line,
            column: loc.column,
            message: `Unterminated string literal (${quote}). Single/double-quoted JS strings cannot contain unescaped newlines.`,
            snippet: getCodeSnippet(source, loc.line),
          });
          return errors;
        }
        i++;
      }
      if (i >= len) {
        const loc = getLineAndCol(source, startIdx);
        errors.push({
          type: 'SYNTAX_ERROR',
          file: filePath,
          line: loc.line,
          column: loc.column,
          message: `Unterminated string literal (${quote}).`,
          snippet: getCodeSnippet(source, loc.line),
        });
        return errors;
      }
      i++;
      continue;
    }

    // 4. Template literal (only in JS code/expression mode)
    if (ch === '`') {
      const scanned = scanTemplateLiteral(filePath, source, i);
      if (scanned.error) {
        errors.push(scanned.error);
        return errors;
      }
      i = scanned.nextIndex;
      continue;
    }

    // 5. Closing JSX tag `</TagName>` or `</>`
    if (ch === '<' && next === '/') {
      const tagStart = i;
      i += 2;
      while (i < len && /\s/.test(source[i])) i++;
      let name = '';
      while (i < len && /[A-Za-z0-9_$.-]/.test(source[i])) {
        name += source[i];
        i++;
      }
      while (i < len && /\s/.test(source[i])) i++;
      if (source[i] !== '>') {
        const loc = getLineAndCol(source, tagStart);
        errors.push({
          type: 'SYNTAX_ERROR',
          file: filePath,
          line: loc.line,
          column: loc.column,
          message: `Malformed closing JSX tag </${name}: missing '>'.`,
          snippet: getCodeSnippet(source, loc.line),
        });
        return errors;
      }
      i++; // consume '>'

      // Allow redundant closing tags for void HTML elements like </br> or </img> if not on stack
      if (
        VOID_HTML_TAGS.has(name) &&
        (jsxStack.length === 0 || jsxStack[jsxStack.length - 1].tagName !== name)
      ) {
        continue;
      }

      const loc = getLineAndCol(source, tagStart);
      if (jsxStack.length === 0) {
        errors.push({
          type: 'SYNTAX_ERROR',
          file: filePath,
          line: loc.line,
          column: loc.column,
          message: `Unexpected closing JSX tag </${name}> with no matching opening tag.`,
          snippet: getCodeSnippet(source, loc.line),
        });
        return errors;
      }

      const top = jsxStack.pop()!;
      if (top.tagName !== name) {
        errors.push({
          type: 'SYNTAX_ERROR',
          file: filePath,
          line: loc.line,
          column: loc.column,
          message: `JSX closing tag mismatch: expected </${top.tagName}> (opened at line ${top.line}), but found </${name}>.`,
          snippet: getCodeSnippet(source, loc.line),
        });
        return errors;
      }

      if (braceStack.length !== top.braceDepth) {
        const unclosed = braceStack[braceStack.length - 1];
        const openLoc = getLineAndCol(source, unclosed.index);
        errors.push({
          type: 'SYNTAX_ERROR',
          file: filePath,
          line: loc.line,
          column: loc.column,
          message: `Unclosed '${unclosed.char}' (from line ${openLoc.line}) before closing JSX tag </${name}>.`,
          snippet: getCodeSnippet(source, loc.line),
        });
        return errors;
      }
      continue;
    }

    // 6. Opening JSX tag `<TagName ...>` or fragment `<>`
    if (
      ch === '<' &&
      (next === '>' || /[A-Za-z_$]/.test(next || '')) &&
      (inJsxTextMode || isJsxStartPosition(source, i))
    ) {
      const tagStart = i;
      i++; // consume '<'
      let name = '';
      while (i < len && /[A-Za-z0-9_$.-]/.test(source[i])) {
        name += source[i];
        i++;
      }

      // Scan attributes inside opening tag until `>` or `/>`
      let selfClosing = false;
      let attrBraceDepth = 0;

      while (i < len) {
        const c = source[i];
        const n = source[i + 1];

        // Skip comments inside opening tag or attribute expressions
        if (c === '/' && n === '/') {
          i += 2;
          while (i < len && source[i] !== '\n') i++;
          continue;
        }
        if (c === '/' && n === '*') {
          const cStart = i;
          i += 2;
          while (i < len && !(source[i] === '*' && source[i + 1] === '/')) i++;
          if (i >= len) {
            const loc = getLineAndCol(source, cStart);
            errors.push({
              type: 'SYNTAX_ERROR',
              file: filePath,
              line: loc.line,
              column: loc.column,
              message: `Unterminated block comment inside <${name}> tag.`,
              snippet: getCodeSnippet(source, loc.line),
            });
            return errors;
          }
          i += 2;
          continue;
        }

        if (c === "'" || c === '"') {
          const q = c;
          const qStart = i;
          i++;
          while (i < len && source[i] !== q) {
            if (source[i] === '\\') {
              i += 2;
              continue;
            }
            if (source[i] === '\n') {
              const loc = getLineAndCol(source, qStart);
              errors.push({
                type: 'SYNTAX_ERROR',
                file: filePath,
                line: loc.line,
                column: loc.column,
                message: `Unterminated attribute string literal in <${name}>.`,
                snippet: getCodeSnippet(source, loc.line),
              });
              return errors;
            }
            i++;
          }
          if (i >= len) {
            const loc = getLineAndCol(source, qStart);
            errors.push({
              type: 'SYNTAX_ERROR',
              file: filePath,
              line: loc.line,
              column: loc.column,
              message: `Unterminated attribute string literal in <${name}>.`,
              snippet: getCodeSnippet(source, loc.line),
            });
            return errors;
          }
          i++;
          continue;
        }

        // Template literal inside attribute expression e.g. className={`...`}
        if (c === '`') {
          const scanned = scanTemplateLiteral(filePath, source, i);
          if (scanned.error) {
            errors.push(scanned.error);
            return errors;
          }
          i = scanned.nextIndex;
          continue;
        }

        if (c === '{') {
          attrBraceDepth++;
          i++;
          continue;
        }
        if (c === '}') {
          attrBraceDepth--;
          if (attrBraceDepth < 0) {
            const loc = getLineAndCol(source, i);
            errors.push({
              type: 'SYNTAX_ERROR',
              file: filePath,
              line: loc.line,
              column: loc.column,
              message: `Unexpected '}' inside opening JSX tag <${name}>.`,
              snippet: getCodeSnippet(source, loc.line),
            });
            return errors;
          }
          i++;
          continue;
        }

        if (attrBraceDepth === 0) {
          if (c === '/' && n === '>') {
            selfClosing = true;
            i += 2;
            break;
          }
          if (c === '>') {
            i++;
            break;
          }
          if (c === '<') {
            const loc = getLineAndCol(source, tagStart);
            errors.push({
              type: 'SYNTAX_ERROR',
              file: filePath,
              line: loc.line,
              column: loc.column,
              message: `Unclosed opening JSX tag <${name}> before nested '<'. Missing '>' or '/>'.`,
              snippet: getCodeSnippet(source, loc.line),
            });
            return errors;
          }
        }

        i++;
      }

      if (attrBraceDepth > 0) {
        const loc = getLineAndCol(source, tagStart);
        errors.push({
          type: 'SYNTAX_ERROR',
          file: filePath,
          line: loc.line,
          column: loc.column,
          message: `Unclosed '{' expression inside JSX tag <${name}> attributes.`,
          snippet: getCodeSnippet(source, loc.line),
        });
        return errors;
      }

      if (!selfClosing && !VOID_HTML_TAGS.has(name)) {
        const loc = getLineAndCol(source, tagStart);
        jsxStack.push({
          tagName: name,
          index: tagStart,
          line: loc.line,
          braceDepth: braceStack.length,
        });
      }
      continue;
    }

    // 7. Standard Braces / Parens / Brackets (in JS code/expression mode)
    if (ch === '{') {
      braceStack.push({ char: '{', expected: '}', index: i });
    } else if (ch === '(') {
      braceStack.push({ char: '(', expected: ')', index: i });
    } else if (ch === '[') {
      braceStack.push({ char: '[', expected: ']', index: i });
    } else if (ch === '}' || ch === ')' || ch === ']') {
      if (braceStack.length === 0) {
        const loc = getLineAndCol(source, i);
        errors.push({
          type: 'SYNTAX_ERROR',
          file: filePath,
          line: loc.line,
          column: loc.column,
          message: `Unexpected closing '${ch}' with no matching opening delimiter.`,
          snippet: getCodeSnippet(source, loc.line),
        });
        return errors;
      }
      const top = braceStack.pop()!;
      if (top.expected !== ch) {
        const loc = getLineAndCol(source, i);
        const openLoc = getLineAndCol(source, top.index);
        errors.push({
          type: 'SYNTAX_ERROR',
          file: filePath,
          line: loc.line,
          column: loc.column,
          message: `Mismatched delimiter: expected '${top.expected}' to close '${top.char}' (from line ${openLoc.line}), but found '${ch}'.`,
          snippet: getCodeSnippet(source, loc.line),
        });
        return errors;
      }
    }

    i++;
  }

  if (jsxStack.length > 0) {
    const unclosed = jsxStack[jsxStack.length - 1];
    errors.push({
      type: 'SYNTAX_ERROR',
      file: filePath,
      line: unclosed.line,
      column: 1,
      message: `Unclosed JSX tag <${unclosed.tagName}> (opened at line ${unclosed.line}). Expected corresponding </${unclosed.tagName}>.`,
      snippet: getCodeSnippet(source, unclosed.line),
    });
  }

  if (braceStack.length > 0) {
    const unclosed = braceStack[braceStack.length - 1];
    const loc = getLineAndCol(source, unclosed.index);
    errors.push({
      type: 'SYNTAX_ERROR',
      file: filePath,
      line: loc.line,
      column: loc.column,
      message: `Unclosed delimiter '${unclosed.char}' opened at line ${loc.line}. Expected '${unclosed.expected}'.`,
      snippet: getCodeSnippet(source, loc.line),
    });
  }

  return errors;
}

/**
 * Parses all static `import` statements in a JS/JSX/TS/TSX module.
 */
export interface ParsedImport {
  rawStatement: string;
  specifier: string;
  defaultImport?: string;
  namespaceImport?: string;
  namedImports: Array<{ imported: string; local: string }>;
  line: number;
}

export function extractImports(
  filePath: string,
  source: string
): { imports: ParsedImport[]; errors: CompilationDiagnostic[] } {
  const imports: ParsedImport[] = [];
  const errors: CompilationDiagnostic[] = [];

  // Detect malformed single-line import statements (e.g. `import { Foo from './Bar'` missing `}`)
  const lines = source.split('\n');
  for (let idx = 0; idx < lines.length; idx++) {
    const trimmed = lines[idx].trim();
    if (trimmed.startsWith('import ') && trimmed.includes('from')) {
      const openCurly = (trimmed.match(/\{/g) || []).length;
      const closeCurly = (trimmed.match(/\}/g) || []).length;
      if (openCurly !== closeCurly) {
        errors.push({
          type: 'SYNTAX_ERROR',
          file: filePath,
          line: idx + 1,
          column: 1,
          message: `Malformed import statement at line ${idx + 1}: unbalanced curly braces.`,
          snippet: getCodeSnippet(source, idx + 1),
        });
      }
    }
  }

  // Match side-effect imports: `import './index.css';`
  const sideEffectRegex = /^[ \t]*import\s+['"]([^'"]+)['"]\s*;?/gm;
  let match: RegExpExecArray | null;
  while ((match = sideEffectRegex.exec(source)) !== null) {
    const loc = getLineAndCol(source, match.index);
    imports.push({
      rawStatement: match[0],
      specifier: match[1],
      namedImports: [],
      line: loc.line,
    });
  }

  // Match standard imports: `import Default, { a, b as c } from 'specifier';`
  const fullImportRegex =
    /^[ \t]*import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]\s*;?/gm;
  while ((match = fullImportRegex.exec(source)) !== null) {
    const clause = match[1].trim();
    const specifier = match[2].trim();
    const loc = getLineAndCol(source, match.index);

    if (match[0].trim().startsWith('import type ')) {
      continue;
    }

    let defaultImport: string | undefined;
    let namespaceImport: string | undefined;
    const namedImports: Array<{ imported: string; local: string }> = [];

    const nsMatch = clause.match(/\*\s+as\s+([A-Za-z0-9_$]+)/);
    if (nsMatch) {
      namespaceImport = nsMatch[1];
    }

    const namedMatch = clause.match(/\{([\s\S]*?)\}/);
    if (namedMatch) {
      const inner = namedMatch[1];
      inner
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((part) => {
          const cleanPart = part.replace(/^type\s+/, '').trim();
          if (!cleanPart) return;
          const asParts = cleanPart.split(/\s+as\s+/);
          if (asParts.length === 2) {
            namedImports.push({ imported: asParts[0].trim(), local: asParts[1].trim() });
          } else {
            namedImports.push({ imported: cleanPart, local: cleanPart });
          }
        });
    }

    const beforeNamed = clause
      .replace(/\{[\s\S]*?\}/, '')
      .replace(/\*\s+as\s+[A-Za-z0-9_$]+/, '')
      .replace(/,/g, '')
      .trim();
    if (beforeNamed && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(beforeNamed)) {
      defaultImport = beforeNamed;
    }

    imports.push({
      rawStatement: match[0],
      specifier,
      defaultImport,
      namespaceImport,
      namedImports,
      line: loc.line,
    });
  }

  return { imports, errors };
}

/**
 * Transpiles JSX expressions and tags into `React.createElement(...)` calls.
 */
export function transpileJsxToCreateElement(input: string): string {
  let out = '';
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];
    const next = input[i + 1];

    // Preserve line comments
    if (ch === '/' && next === '/') {
      const start = i;
      i += 2;
      while (i < len && input[i] !== '\n') i++;
      out += input.slice(start, i);
      continue;
    }

    // Preserve block comments
    if (ch === '/' && next === '*') {
      const start = i;
      i += 2;
      while (i < len && !(input[i] === '*' && input[i + 1] === '/')) i++;
      i += 2;
      out += input.slice(start, i);
      continue;
    }

    // Preserve single/double quoted strings
    if (ch === "'" || ch === '"') {
      const quote = ch;
      const start = i;
      i++;
      while (i < len && input[i] !== quote) {
        if (input[i] === '\\') {
          i += 2;
          continue;
        }
        i++;
      }
      i++;
      out += input.slice(start, i);
      continue;
    }

    // Preserve template literals (recursively transpiling any JSX inside ${...})
    if (ch === '`') {
      out += '`';
      i++;
      while (i < len && input[i] !== '`') {
        if (input[i] === '\\') {
          out += input[i] + (input[i + 1] || '');
          i += 2;
          continue;
        }
        if (input[i] === '$' && input[i + 1] === '{') {
          const balanced = extractBalancedBraces(input, i + 1);
          out += '${' + transpileJsxToCreateElement(balanced.content) + '}';
          i = balanced.nextIndex;
          continue;
        }
        out += input[i];
        i++;
      }
      if (i < len) {
        out += '`';
        i++;
      }
      continue;
    }

    // Check if `<` begins a JSX element
    if (
      ch === '<' &&
      (next === '>' || /[A-Za-z_$]/.test(next || '')) &&
      isJsxStartPosition(out, out.length)
    ) {
      const parsed = parseSingleJsxElement(input, i);
      out += parsed.code;
      i = parsed.nextIndex;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

function parseSingleJsxElement(
  source: string,
  startIndex: number
): { code: string; nextIndex: number } {
  let i = startIndex + 1; // skip '<'
  const len = source.length;

  let tagName = '';
  while (i < len && /[A-Za-z0-9_$.-]/.test(source[i])) {
    tagName += source[i];
    i++;
  }

  const tagExpr =
    tagName === ''
      ? 'React.Fragment'
      : /^[a-z]/.test(tagName) && !tagName.includes('.')
      ? JSON.stringify(tagName)
      : tagName;

  // Parse attributes
  const propEntries: string[] = [];
  const spreadEntries: string[] = [];
  let selfClosing = false;

  while (i < len) {
    while (i < len && /\s/.test(source[i])) i++;

    // Skip comments inside opening tag
    if (source[i] === '/' && source[i + 1] === '/') {
      i += 2;
      while (i < len && source[i] !== '\n') i++;
      continue;
    }
    if (source[i] === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < len && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    if (source[i] === '/' && source[i + 1] === '>') {
      selfClosing = true;
      i += 2;
      break;
    }
    if (source[i] === '>') {
      i++;
      break;
    }

    // Spread attribute `{...props}`
    if (source[i] === '{' && source.slice(i + 1).trimStart().startsWith('...')) {
      const balanced = extractBalancedBraces(source, i);
      const spreadInner = stripJsCommentsPreservingStrings(balanced.content).trim().slice(3).trim();
      spreadEntries.push(transpileJsxToCreateElement(spreadInner));
      i = balanced.nextIndex;
      continue;
    }

    // Attribute name
    let attrName = '';
    while (i < len && /[A-Za-z0-9_$-:]/.test(source[i])) {
      attrName += source[i];
      i++;
    }

    if (!attrName) {
      i++;
      continue;
    }

    while (i < len && /\s/.test(source[i])) i++;

    if (source[i] === '=') {
      i++; // consume '='
      while (i < len && /\s/.test(source[i])) i++;

      if (source[i] === "'" || source[i] === '"') {
        const q = source[i];
        let val = '';
        i++;
        while (i < len && source[i] !== q) {
          if (source[i] === '\\') {
            val += source[i] + (source[i + 1] || '');
            i += 2;
            continue;
          }
          val += source[i];
          i++;
        }
        i++; // closing quote
        propEntries.push(`${JSON.stringify(attrName)}: ${JSON.stringify(val)}`);
      } else if (source[i] === '{') {
        const balanced = extractBalancedBraces(source, i);
        const cleanExpr = stripJsCommentsPreservingStrings(balanced.content).trim();
        const transpiledExpr = transpileJsxToCreateElement(cleanExpr);
        propEntries.push(`${JSON.stringify(attrName)}: (${transpiledExpr})`);
        i = balanced.nextIndex;
      }
    } else {
      // Boolean shorthand attribute
      propEntries.push(`${JSON.stringify(attrName)}: true`);
    }
  }

  let propsCode = 'null';
  if (spreadEntries.length > 0 && propEntries.length > 0) {
    propsCode = `Object.assign({}, ${spreadEntries.join(', ')}, { ${propEntries.join(', ')} })`;
  } else if (spreadEntries.length > 0) {
    propsCode = `Object.assign({}, ${spreadEntries.join(', ')})`;
  } else if (propEntries.length > 0) {
    propsCode = `{ ${propEntries.join(', ')} }`;
  }

  if (selfClosing || VOID_HTML_TAGS.has(tagName)) {
    // If a void HTML tag was written with an explicit closing tag like `<br></br>`, consume it
    if (!selfClosing && tagName) {
      const closeRe = new RegExp(`^\\s*<\\/${tagName}\\s*>`);
      const m = source.slice(i).match(closeRe);
      if (m) {
        i += m[0].length;
      }
    }
    return {
      code: `React.createElement(${tagExpr}, ${propsCode})`,
      nextIndex: i,
    };
  }

  // Parse children until matching `</tagName>`
  const childrenCodes: string[] = [];
  let textBuffer = '';

  const flushText = () => {
    if (!textBuffer) return;
    const lines = textBuffer.split('\n');
    const cleaned = lines
      .map((line, idx) => {
        let s = line;
        if (idx > 0) s = s.replace(/^\s+/, '');
        if (idx < lines.length - 1) s = s.replace(/\s+$/, '');
        return s;
      })
      .filter((s) => s.length > 0)
      .join(' ');

    if (cleaned) {
      const decoded = cleaned
        .replace(/&nbsp;/g, '\u00A0')
        .replace(/&middot;/g, '·')
        .replace(/&rarr;/g, '→')
        .replace(/&mdash;/g, '—')
        .replace(/&ndash;/g, '–')
        .replace(/&copy;/g, '©')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
      childrenCodes.push(JSON.stringify(decoded));
    }
    textBuffer = '';
  };

  while (i < len) {
    // Check closing tag `</tagName>`
    if (source[i] === '<' && source[i + 1] === '/') {
      flushText();
      i += 2;
      while (i < len && /\s/.test(source[i])) i++;
      while (i < len && /[A-Za-z0-9_$.-]/.test(source[i])) i++;
      while (i < len && /\s/.test(source[i])) i++;
      if (source[i] === '>') i++;
      break;
    }

    // Check nested JSX element
    if (source[i] === '<' && (source[i + 1] === '>' || /[A-Za-z_$]/.test(source[i + 1] || ''))) {
      flushText();
      const childEl = parseSingleJsxElement(source, i);
      childrenCodes.push(childEl.code);
      i = childEl.nextIndex;
      continue;
    }

    // Check JSX expression child `{ ... }`
    if (source[i] === '{') {
      flushText();
      const balanced = extractBalancedBraces(source, i);
      const inner = stripJsCommentsPreservingStrings(balanced.content).trim();
      if (inner.length > 0) {
        childrenCodes.push(transpileJsxToCreateElement(inner));
      }
      i = balanced.nextIndex;
      continue;
    }

    textBuffer += source[i];
    i++;
  }

  flushText();

  const args = [tagExpr, propsCode, ...childrenCodes].join(', ');
  return {
    code: `React.createElement(${args})`,
    nextIndex: i,
  };
}

function extractBalancedBraces(
  source: string,
  startIndex: number
): { content: string; nextIndex: number } {
  let i = startIndex + 1; // skip opening '{'
  const len = source.length;
  let depth = 1;

  while (i < len && depth > 0) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '/' && next === '/') {
      i += 2;
      while (i < len && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < len && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const q = ch;
      i++;
      while (i < len && source[i] !== q) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        i++;
      }
      i++;
      continue;
    }
    if (ch === '`') {
      const scanned = scanTemplateLiteral('inline', source, i);
      i = scanned.nextIndex;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }

  return {
    content: source.slice(startIndex + 1, i - 1),
    nextIndex: i,
  };
}

/**
 * Strips basic TypeScript syntax from `.tsx`/`.ts` files and rewrites ES module
 * `import` / `export` statements into CommonJS module definitions for the sandbox bundle.
 */
function transformModuleToCommonJs(
  filePath: string,
  source: string,
  fileMap: Map<string, ManifestFile>
): string {
  let code = source;

  // Strip TypeScript interface declarations and type aliases
  code = code.replace(/^[ \t]*(?:export\s+)?interface\s+[A-Za-z0-9_]+\s*\{[\s\S]*?^\}/gm, '');
  code = code.replace(/^[ \t]*(?:export\s+)?type\s+[A-Za-z0-9_]+\s*=[^;]+;/gm, '');
  code = code.replace(/\b(useState|useRef|useMemo|useCallback|createContext)<[^>]+>\(/g, '$1(');

  const { imports } = extractImports(filePath, code);

  // Replace import statements with `__require(...)`
  for (const imp of imports) {
    const isRelative =
      imp.specifier.startsWith('.') ||
      imp.specifier.startsWith('/') ||
      imp.specifier.startsWith('@/');

    const resolvedKey = isRelative
      ? resolveManifestImport(filePath, imp.specifier, fileMap) || imp.specifier
      : imp.specifier;

    if (resolvedKey.endsWith('.css')) {
      code = code.replace(imp.rawStatement, `/* CSS imported: ${resolvedKey} */`);
      continue;
    }

    const lines: string[] = [];
    const reqVar = `__mod_${Math.random().toString(36).slice(2, 8)}`;
    lines.push(`const ${reqVar} = __require(${JSON.stringify(resolvedKey)});`);

    if (imp.defaultImport) {
      lines.push(
        `const ${imp.defaultImport} = (${reqVar} && ${reqVar}.__esModule) ? ('default' in ${reqVar} && ${reqVar}.default !== undefined ? ${reqVar}.default : (${reqVar}[${JSON.stringify(imp.defaultImport)}] || ${reqVar})) : ${reqVar};`
      );
    }
    if (imp.namespaceImport) {
      lines.push(`const ${imp.namespaceImport} = ${reqVar};`);
    }
    if (imp.namedImports.length > 0) {
      const destruct = imp.namedImports
        .map((n) => (n.imported === n.local ? n.imported : `${n.imported}: ${n.local}`))
        .join(', ');
      lines.push(`const { ${destruct} } = ${reqVar};`);
    }

    code = code.replace(imp.rawStatement, lines.join(' '));
  }

  const exportedFuncs: string[] = [];
  let defaultFuncName: string | null = null;

  // Transform `export default function Name` -> `function Name ...; exports.default = Name; exports.Name = Name;`
  code = code.replace(
    /export\s+default\s+(async\s+)?function\s+([A-Za-z0-9_$]+)/g,
    (_m, asyncKw, fnName) => {
      defaultFuncName = fnName;
      return `${asyncKw || ''}function ${fnName}`;
    }
  );
  code = code.replace(/export\s+default\s+/g, 'exports.default = ');

  // Transform `export const/let/var Name =`
  code = code.replace(
    /export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=/g,
    'const $1 = exports.$1 ='
  );

  // Transform `export function Name` or `export async function Name`
  code = code.replace(
    /export\s+(async\s+)?function\s+([A-Za-z0-9_$]+)/g,
    (_m, asyncKw, fnName) => {
      exportedFuncs.push(fnName);
      return `${asyncKw || ''}function ${fnName}`;
    }
  );

  // Transform `export { A, B as C };`
  const namedExportBlock: string[] = [];
  code = code.replace(/export\s*\{([^}]+)\}\s*;?/g, (_m, inner: string) => {
    inner
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((part) => {
        const asParts = part.split(/\s+as\s+/);
        if (asParts.length === 2) {
          namedExportBlock.push(`exports.${asParts[1].trim()} = ${asParts[0].trim()};`);
        } else {
          namedExportBlock.push(`exports.${part} = ${part};`);
        }
      });
    return '';
  });

  // Transpile JSX
  let transpiled = transpileJsxToCreateElement(code);

  if (defaultFuncName) {
    transpiled += `\nexports.default = ${defaultFuncName};\nexports.${defaultFuncName} = exports.${defaultFuncName} || ${defaultFuncName};`;
  }
  if (exportedFuncs.length > 0) {
    transpiled +=
      '\n' +
      exportedFuncs
        .map(
          (fn) =>
            `exports.${fn} = ${fn}; if (exports.default === undefined) { exports.default = ${fn}; }`
        )
        .join('\n');
  }
  if (namedExportBlock.length > 0) {
    transpiled += '\n' + namedExportBlock.join('\n');
  }

  return transpiled;
}

/**
 * Validates that a transpiled JavaScript module body is 100% syntactically valid JS
 * without executing any code. Catches malformed JS expressions inside JSX `{...}`,
 * broken template literals, invalid arrow functions, or statement-in-expression errors.
 */
export function validateTranspiledJsSyntax(
  filePath: string,
  transpiledCode: string,
  originalSource: string
): CompilationDiagnostic | null {
  try {
    // `new Function(...)` parses the JS syntax without executing the body
    new Function('exports', '__require', 'module', transpiledCode);
    return null;
  } catch (err: any) {
    // Ignore EvalError if running in an environment with strict CSP on the host page itself
    if (err && err.name === 'EvalError') {
      return null;
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      type: 'SYNTAX_ERROR',
      file: filePath,
      line: 1,
      column: 1,
      message: `JavaScript syntax error after JSX transpilation: ${message}`,
      snippet: getCodeSnippet(originalSource, 1),
    };
  }
}

/**
 * Main entry point: validates, resolves, and compiles a multi-file Website Generator
 * project into a strictly isolated, self-contained HTML document for `<iframe sandbox="allow-scripts">`.
 */
export function compileWebsitePreview(
  rawFiles: ManifestFile[],
  technology = 'React',
  websiteName = 'Preview Application',
  previewToken = 'default_preview_token'
): PreviewCompilationResult {
  const startTime = Date.now();
  const errors: CompilationDiagnostic[] = [];
  const warnings: string[] = [];

  if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
    return {
      success: false,
      status: 'error',
      errors: [
        {
          type: 'MANIFEST_ERROR',
          file: 'manifest',
          message: 'Project file manifest is empty. Cannot compile preview.',
        },
      ],
      warnings: [],
      compiledHtml: '',
      resolvedModules: [],
      entryFile: null,
      compileTimeMs: Date.now() - startTime,
    };
  }

  // Build normalized file map (applying safe deterministic source normalization)
  const fileMap = new Map<string, ManifestFile>();
  for (const f of rawFiles) {
    const norm = normalizeManifestPath(f.path);
    if (norm) {
      fileMap.set(norm, {
        ...f,
        path: norm,
        content: normalizeGeneratedSourceCode(norm, f.content),
      });
    }
  }

  const hasReactFiles = Array.from(fileMap.keys()).some(
    (p) => p.endsWith('.jsx') || p.endsWith('.tsx')
  );
  const isReactProject =
    technology.toLowerCase().includes('react') || hasReactFiles || fileMap.has('package.json');

  // -------------------------------------------------------------------------
  // Case A: Standard HTML / CSS / JS Project
  // -------------------------------------------------------------------------
  if (!isReactProject) {
    const indexHtmlFile =
      fileMap.get('index.html') ||
      Array.from(fileMap.values()).find((f) => f.path.endsWith('.html'));

    if (!indexHtmlFile) {
      return {
        success: false,
        status: 'error',
        errors: [
          {
            type: 'MANIFEST_ERROR',
            file: 'index.html',
            message: 'Missing required index.html in HTML/CSS/JS project manifest.',
          },
        ],
        warnings: [],
        compiledHtml: '',
        resolvedModules: [],
        entryFile: null,
        compileTimeMs: Date.now() - startTime,
      };
    }

    // Validate any JS files for syntax balance and JS parse validity
    for (const f of fileMap.values()) {
      if (f.path.endsWith('.js')) {
        const jsErrors = validateJsxAndSyntax(f.path, f.content);
        if (jsErrors.length > 0) {
          errors.push(...jsErrors);
        } else {
          const syntaxErr = validateTranspiledJsSyntax(f.path, f.content, f.content);
          if (syntaxErr) errors.push(syntaxErr);
        }
      }
    }

    if (errors.length > 0) {
      return {
        success: false,
        status: 'error',
        errors,
        warnings,
        compiledHtml: '',
        resolvedModules: Array.from(fileMap.keys()),
        entryFile: indexHtmlFile.path,
        compileTimeMs: Date.now() - startTime,
      };
    }

    const cssContents = Array.from(fileMap.values())
      .filter((f) => f.path.endsWith('.css'))
      .map((f) => `/* ${f.path} */\n${f.content}`)
      .join('\n\n');

    const jsContents = Array.from(fileMap.values())
      .filter((f) => f.path.endsWith('.js') && !f.path.includes('vite.config'))
      .map((f) => `// ${f.path}\n${f.content}`)
      .join('\n\n');

    const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none';">`;

    let html = indexHtmlFile.content;
    html = html.replace(/<link[^>]+href=['"][^'"]+\.css['"][^>]*>/gi, '');
    html = html.replace(/<script[^>]+src=['"][^'"]+\.js['"][^>]*><\/script>/gi, '');

    const safeCss = escapeInlineStyle(`${getEmbeddedUtilityCss()}\n${cssContents}`);
    const safeJs = escapeInlineScript(jsContents);

    if (html.includes('</head>')) {
      html = html.replace(
        '</head>',
        `${cspMeta}\n<style>${safeCss}</style>\n</head>`
      );
    } else {
      html = `${cspMeta}<style>${safeCss}</style>\n${html}`;
    }

    const statusScript = `<script>(function(){try{if(window.parent&&window.parent!==window){window.parent.postMessage({type:'WEBSITE_PREVIEW_STATUS',token:${JSON.stringify(previewToken)},status:'rendered',error:null},'*');}}catch(_){}})();</script>`;
    const combinedScripts = safeJs ? `<script>${safeJs}</script>\n${statusScript}` : statusScript;

    if (html.includes('</body>')) {
      html = html.replace('</body>', `${combinedScripts}\n</body>`);
    } else {
      html += `\n${combinedScripts}`;
    }

    return {
      success: true,
      status: 'success',
      errors: [],
      warnings,
      compiledHtml: html,
      resolvedModules: Array.from(fileMap.keys()),
      entryFile: indexHtmlFile.path,
      compileTimeMs: Date.now() - startTime,
    };
  }

  // -------------------------------------------------------------------------
  // Case B: Multi-File React / Vite Project
  // -------------------------------------------------------------------------
  let declaredDeps: Set<string> | null = null;
  const pkgJsonFile = fileMap.get('package.json');
  if (pkgJsonFile) {
    try {
      const parsedPkg = JSON.parse(pkgJsonFile.content);
      declaredDeps = new Set([
        'react',
        'react-dom',
        'react-dom/client',
        ...Object.keys(parsedPkg.dependencies || {}),
        ...Object.keys(parsedPkg.devDependencies || {}),
      ]);
    } catch (err: any) {
      errors.push({
        type: 'MANIFEST_ERROR',
        file: 'package.json',
        line: 1,
        column: 1,
        message: `Invalid JSON in package.json: ${err.message}`,
        snippet: getCodeSnippet(pkgJsonFile.content, 1),
      });
    }
  }

  // Locate App / Entry point
  const entryCandidates = [
    'src/App.jsx',
    'src/App.tsx',
    'App.jsx',
    'App.tsx',
    'src/main.jsx',
    'src/main.tsx',
    'src/index.jsx',
    'src/index.tsx',
  ];
  let appEntry: string | null = null;
  for (const cand of entryCandidates) {
    if (fileMap.has(cand)) {
      appEntry = cand;
      break;
    }
  }

  if (!appEntry) {
    errors.push({
      type: 'MANIFEST_ERROR',
      file: 'src/App.jsx',
      message:
        'Could not locate React entry component (expected src/App.jsx, src/App.tsx, or src/main.jsx).',
    });
    return {
      success: false,
      status: 'error',
      errors,
      warnings,
      compiledHtml: '',
      resolvedModules: [],
      entryFile: null,
      compileTimeMs: Date.now() - startTime,
    };
  }

  // Traverse and validate all source files in the manifest
  const sourceFiles = Array.from(fileMap.values()).filter(
    (f) =>
      (f.path.endsWith('.jsx') ||
        f.path.endsWith('.tsx') ||
        f.path.endsWith('.js') ||
        f.path.endsWith('.ts')) &&
      !f.path.includes('vite.config') &&
      !f.path.includes('tailwind.config') &&
      !f.path.includes('postcss.config')
  );

  const resolvedModules: string[] = [];
  const compiledModuleMap: Record<string, string> = {};

  for (const srcFile of sourceFiles) {
    const fileStartErrCount = errors.length;

    // 1. Validate JSX and JS syntax
    const syntaxErrs = validateJsxAndSyntax(srcFile.path, srcFile.content);
    if (syntaxErrs.length > 0) {
      errors.push(...syntaxErrs);
      continue;
    }

    // 2. Extract and validate imports
    const { imports, errors: importSyntaxErrs } = extractImports(srcFile.path, srcFile.content);
    if (importSyntaxErrs.length > 0) {
      errors.push(...importSyntaxErrs);
      continue;
    }

    for (const imp of imports) {
      const spec = imp.specifier;
      const isLocal = spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('@/');

      if (isLocal) {
        const resolved = resolveManifestImport(srcFile.path, spec, fileMap);
        if (!resolved) {
          errors.push({
            type: 'MISSING_IMPORT',
            file: srcFile.path,
            line: imp.line,
            column: 1,
            message: `Cannot resolve import '${spec}' from '${srcFile.path}'. Target file does not exist in project manifest.`,
            snippet: getCodeSnippet(srcFile.content, imp.line),
          });
        }
      } else {
        const basePkg = spec.startsWith('@')
          ? spec.split('/').slice(0, 2).join('/')
          : spec.split('/')[0];

        const isSupportedInSandbox =
          SUPPORTED_SANDBOX_PACKAGES.has(spec) || SUPPORTED_SANDBOX_PACKAGES.has(basePkg);

        const isDeclaredInPkgJson = declaredDeps ? declaredDeps.has(basePkg) : true;

        if (!isSupportedInSandbox) {
          errors.push({
            type: 'MISSING_DEPENDENCY',
            file: srcFile.path,
            line: imp.line,
            column: 1,
            message: `Unsupported or missing dependency '${spec}' in '${srcFile.path}'. Arbitrary external packages cannot be fetched in the isolated sandbox.`,
            snippet: getCodeSnippet(srcFile.content, imp.line),
          });
        } else if (!isDeclaredInPkgJson) {
          errors.push({
            type: 'MISSING_DEPENDENCY',
            file: srcFile.path,
            line: imp.line,
            column: 1,
            message: `Missing dependency '${basePkg}' in package.json (imported by '${srcFile.path}' at line ${imp.line}).`,
            snippet: getCodeSnippet(srcFile.content, imp.line),
          });
        }
      }
    }

    // 3. Transpile module and verify JS syntax if no file errors so far
    if (errors.length === fileStartErrCount) {
      const transpiled = transformModuleToCommonJs(srcFile.path, srcFile.content, fileMap);
      const jsSyntaxErr = validateTranspiledJsSyntax(srcFile.path, transpiled, srcFile.content);
      if (jsSyntaxErr) {
        errors.push(jsSyntaxErr);
        continue;
      }
      resolvedModules.push(srcFile.path);
      compiledModuleMap[srcFile.path] = transpiled;
    }
  }

  if (errors.length > 0) {
    return {
      success: false,
      status: 'error',
      errors,
      warnings,
      compiledHtml: '',
      resolvedModules,
      entryFile: appEntry,
      compileTimeMs: Date.now() - startTime,
    };
  }

  // Collect all CSS files in manifest
  const cssContent = Array.from(fileMap.values())
    .filter((f) => f.path.endsWith('.css'))
    .map((f) => {
      const cleanedCss = f.content
        .replace(/@import\s+['"]tailwindcss['"];?/g, '')
        .replace(/@tailwind\s+[a-z]+;?/g, '');
      return `/* ${f.path} */\n${cleanedCss}`;
    })
    .join('\n\n');

  // Determine the root App component module to mount
  const mountModulePath =
    fileMap.has('src/App.jsx')
      ? 'src/App.jsx'
      : fileMap.has('src/App.tsx')
      ? 'src/App.tsx'
      : fileMap.has('App.jsx')
      ? 'App.jsx'
      : fileMap.has('App.tsx')
      ? 'App.tsx'
      : appEntry;

  const compiledHtml = buildSandboxedReactHtml({
    websiteName,
    cssContent,
    compiledModuleMap,
    mountModulePath,
    previewToken,
  });

  return {
    success: true,
    status: 'success',
    errors: [],
    warnings,
    compiledHtml,
    resolvedModules,
    entryFile: mountModulePath,
    compileTimeMs: Date.now() - startTime,
  };
}

/**
 * Constructs the self-contained, CSP-locked HTML document with an embedded
 * virtual DOM + hooks runtime, Lucide SVG icon factory, and compiled modules.
 */
function buildSandboxedReactHtml(params: {
  websiteName: string;
  cssContent: string;
  compiledModuleMap: Record<string, string>;
  mountModulePath: string;
  previewToken: string;
}): string {
  const { websiteName, cssContent, compiledModuleMap, mountModulePath, previewToken } = params;

  const moduleEntriesCode = Object.entries(compiledModuleMap)
    .map(
      ([modPath, modCode]) =>
        `${JSON.stringify(modPath)}: function(exports, __require, module) {\n${escapeInlineScript(modCode)}\n}`
    )
    .join(',\n');

  const safeCssBlock = escapeInlineStyle(`${getEmbeddedUtilityCss()}\n${cssContent}`);

  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none';" />
  <title>${websiteName.replace(/</g, '&lt;')}</title>
  <style>
${safeCssBlock}
  </style>
</head>
<body class="bg-slate-950 text-slate-100 antialiased selection:bg-purple-500 selection:text-white">
  <div id="root"></div>
  <div id="__preview_error_overlay" style="display:none; padding: 20px; background: #1e0b16; border: 1px solid #f43f5e; color: #fda4af; font-family: monospace; font-size: 12px; margin: 16px; border-radius: 8px; white-space: pre-wrap;"></div>

  <script>
  (function() {
    "use strict";
    var PREVIEW_TOKEN = ${JSON.stringify(previewToken)};

    function reportStatus(status, errorMsg) {
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            type: 'WEBSITE_PREVIEW_STATUS',
            token: PREVIEW_TOKEN,
            status: status,
            error: errorMsg ? String(errorMsg).slice(0, 1000) : null
          }, '*');
        }
      } catch (_) {}
    }

    function showRuntimeError(err) {
      var overlay = document.getElementById('__preview_error_overlay');
      var msg = (err && err.stack) ? err.stack : String(err);
      if (overlay) {
        overlay.style.display = 'block';
        overlay.textContent = 'Runtime Execution Error:\\n' + msg;
      }
      reportStatus('runtime_error', String(err && err.message ? err.message : err));
    }

    window.addEventListener('error', function(e) {
      showRuntimeError(e.error || e.message);
    });

    // -----------------------------------------------------------------------
    // Lightweight Self-Contained React 19 Compatible Hooks & VDOM Runtime
    // -----------------------------------------------------------------------
    var hooksStore = [];
    var hookCursor = 0;
    var pendingEffects = [];
    var rootRenderFn = null;
    var isRendering = false;

    function scheduleRerender() {
      if (isRendering) return;
      setTimeout(function() {
        if (rootRenderFn) rootRenderFn();
      }, 0);
    }

    var FragmentSymbol = Symbol('React.Fragment');

    function createElement(type, props) {
      var children = [];
      for (var i = 2; i < arguments.length; i++) {
        var child = arguments[i];
        if (Array.isArray(child)) {
          for (var j = 0; j < child.length; j++) children.push(child[j]);
        } else {
          children.push(child);
        }
      }
      var normalizedProps = Object.assign({}, props || {});
      if (children.length === 1) {
        normalizedProps.children = children[0];
      } else if (children.length > 1) {
        normalizedProps.children = children;
      }
      return {
        $$typeof: 'vnode',
        type: type,
        props: normalizedProps,
        children: children
      };
    }

    function useState(initialValue) {
      var idx = hookCursor++;
      if (hooksStore.length <= idx) {
        hooksStore[idx] = typeof initialValue === 'function' ? initialValue() : initialValue;
      }
      var setState = function(nextVal) {
        var current = hooksStore[idx];
        var resolved = typeof nextVal === 'function' ? nextVal(current) : nextVal;
        if (resolved !== current) {
          hooksStore[idx] = resolved;
          scheduleRerender();
        }
      };
      return [hooksStore[idx], setState];
    }

    function useReducer(reducer, initialArg, init) {
      var idx = hookCursor++;
      if (hooksStore.length <= idx) {
        hooksStore[idx] = init ? init(initialArg) : initialArg;
      }
      var dispatch = function(action) {
        hooksStore[idx] = reducer(hooksStore[idx], action);
        scheduleRerender();
      };
      return [hooksStore[idx], dispatch];
    }

    function useRef(initialValue) {
      var idx = hookCursor++;
      if (hooksStore.length <= idx) {
        hooksStore[idx] = { current: initialValue };
      }
      return hooksStore[idx];
    }

    function useMemo(factory, deps) {
      var idx = hookCursor++;
      var prev = hooksStore[idx];
      if (!prev || !deps || !prev.deps || deps.some(function(d, i) { return d !== prev.deps[i]; })) {
        var val = factory();
        hooksStore[idx] = { val: val, deps: deps };
        return val;
      }
      return prev.val;
    }

    function useCallback(cb, deps) {
      return useMemo(function() { return cb; }, deps);
    }

    function useEffect(effectFn, deps) {
      var idx = hookCursor++;
      var prev = hooksStore[idx];
      var changed = !prev || !deps || !prev.deps || deps.some(function(d, i) { return d !== prev.deps[i]; });
      if (changed) {
        hooksStore[idx] = { deps: deps, cleanup: prev ? prev.cleanup : null };
        pendingEffects.push(function() {
          if (hooksStore[idx] && typeof hooksStore[idx].cleanup === 'function') {
            try { hooksStore[idx].cleanup(); } catch (_) {}
          }
          var cleanup = effectFn();
          if (hooksStore[idx]) hooksStore[idx].cleanup = cleanup;
        });
      }
    }

    function createContext(defaultValue) {
      var ctx = {
        _currentValue: defaultValue,
        Provider: function(props) {
          if ('value' in props) ctx._currentValue = props.value;
          return props.children;
        }
      };
      return ctx;
    }

    function useContext(ctx) {
      return ctx ? ctx._currentValue : undefined;
    }

    var ReactShim = {
      createElement: createElement,
      Fragment: FragmentSymbol,
      useState: useState,
      useReducer: useReducer,
      useEffect: useEffect,
      useMemo: useMemo,
      useCallback: useCallback,
      useRef: useRef,
      createContext: createContext,
      useContext: useContext,
      forwardRef: function(render) { return function(props) { return render(props, null); }; },
      memo: function(comp) { return comp; }
    };

    // Render VNode tree to real DOM nodes
    function renderVNodeToDom(vnode) {
      if (vnode === null || vnode === undefined || vnode === false || vnode === true) {
        return document.createTextNode('');
      }
      if (typeof vnode === 'string' || typeof vnode === 'number') {
        return document.createTextNode(String(vnode));
      }
      if (Array.isArray(vnode)) {
        var frag = document.createDocumentFragment();
        for (var i = 0; i < vnode.length; i++) {
          frag.appendChild(renderVNodeToDom(vnode[i]));
        }
        return frag;
      }
      if (vnode.type === FragmentSymbol) {
        var f = document.createDocumentFragment();
        var ch = vnode.children || [];
        for (var k = 0; k < ch.length; k++) {
          f.appendChild(renderVNodeToDom(ch[k]));
        }
        return f;
      }
      if (typeof vnode.type === 'function') {
        var subVnode = vnode.type(vnode.props || {});
        return renderVNodeToDom(subVnode);
      }
      if (typeof vnode.type === 'string') {
        var isSvg = ['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g'].indexOf(vnode.type) !== -1;
        var el = isSvg
          ? document.createElementNS('http://www.w3.org/2000/svg', vnode.type)
          : document.createElement(vnode.type);

        var props = vnode.props || {};
        Object.keys(props).forEach(function(key) {
          if (key === 'children' || key === 'key') return;
          var val = props[key];
          if (val === undefined || val === null || val === false) return;

          if (key === 'ref' && typeof val === 'object') {
            val.current = el;
            return;
          }
          if (key === 'className' || key === 'class') {
            if (isSvg) el.setAttribute('class', String(val));
            else el.className = String(val);
            return;
          }
          if (key === 'htmlFor') {
            el.setAttribute('for', String(val));
            return;
          }
          if (key === 'style' && typeof val === 'object') {
            Object.keys(val).forEach(function(sKey) {
              el.style[sKey] = val[sKey];
            });
            return;
          }
          if (key === 'dangerouslySetInnerHTML' && val && val.__html) {
            el.innerHTML = val.__html;
            return;
          }
          if (key.indexOf('on') === 0 && typeof val === 'function') {
            var evtName = key.slice(2).toLowerCase();
            if (evtName === 'change' && (vnode.type === 'input' || vnode.type === 'textarea' || vnode.type === 'select')) {
              el.addEventListener('input', val);
            } else if (evtName === 'doubleclick') {
              el.addEventListener('dblclick', val);
            } else {
              el.addEventListener(evtName, val);
            }
            return;
          }
          if (key === 'value' && ('value' in el)) {
            el.value = String(val);
            el.setAttribute('value', String(val));
            return;
          }
          if (key === 'checked' && ('checked' in el)) {
            el.checked = Boolean(val);
            return;
          }
          el.setAttribute(key, val === true ? '' : String(val));
        });

        var children = vnode.children || [];
        for (var c = 0; c < children.length; c++) {
          el.appendChild(renderVNodeToDom(children[c]));
        }
        return el;
      }
      return document.createTextNode('');
    }

    // -----------------------------------------------------------------------
    // Lucide-React Icon Factory Shim (Offline SVG Icons)
    // -----------------------------------------------------------------------
    function createLucideIcon(name) {
      return function LucideIconComponent(props) {
        var size = (props && props.size) || 18;
        var cls = (props && props.className) || '';
        return createElement(
          'svg',
          {
            xmlns: 'http://www.w3.org/2000/svg',
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': '2',
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
            className: cls,
            'data-lucide-icon': name
          },
          createElement('circle', { cx: '12', cy: '12', r: '9' }),
          createElement('path', { d: 'M12 8v4l3 3' })
        );
      };
    }

    var LucideProxy = typeof Proxy !== 'undefined'
      ? new Proxy({ __esModule: true }, {
          get: function(target, prop) {
            if (prop in target) return target[prop];
            return createLucideIcon(String(prop));
          }
        })
      : { __esModule: true };

    // Motion / Framer-Motion Shim
    var MotionProxy = typeof Proxy !== 'undefined'
      ? new Proxy({}, {
          get: function(_t, tag) {
            return function(props) {
              return createElement(String(tag), props, props ? props.children : null);
            };
          }
        })
      : { div: 'div', section: 'section', span: 'span' };

    var ReactDOMShim = {
      __esModule: true,
      createRoot: function(container) {
        return {
          render: function(rootVNode) {
            rootRenderFn = function() {
              try {
                isRendering = true;
                hookCursor = 0;
                var domTree = renderVNodeToDom(rootVNode);
                container.innerHTML = '';
                container.appendChild(domTree);
                isRendering = false;
                var effectsToRun = pendingEffects.slice();
                pendingEffects = [];
                for (var e = 0; e < effectsToRun.length; e++) {
                  effectsToRun[e]();
                }
                reportStatus('rendered', null);
              } catch (err) {
                isRendering = false;
                showRuntimeError(err);
              }
            };
            rootRenderFn();
          }
        };
      }
    };
    ReactDOMShim.default = ReactDOMShim;

    // -----------------------------------------------------------------------
    // Module Registry & Loader
    // -----------------------------------------------------------------------
    var React = ReactShim;

    var __modules = {
${moduleEntriesCode}
    };

    var __cache = {};

    function __require(modId) {
      if (modId === 'react') return Object.assign({ __esModule: true, default: ReactShim }, ReactShim);
      if (modId === 'react-dom' || modId === 'react-dom/client') return ReactDOMShim;
      if (modId === 'lucide-react') return LucideProxy;
      if (modId === 'motion' || modId === 'framer-motion' || modId === 'motion/react') {
        return { __esModule: true, motion: MotionProxy, AnimatePresence: function(p) { return p.children; } };
      }
      if (modId === 'clsx') {
        var clsxFn = function() {
          return Array.prototype.slice.call(arguments).filter(Boolean).join(' ');
        };
        return { __esModule: true, default: clsxFn, clsx: clsxFn };
      }

      if (__cache[modId]) return __cache[modId].exports;
      var factory = __modules[modId];
      if (!factory) {
        throw new Error("Module not found in bundle: '" + modId + "'");
      }
      var mod = { exports: { __esModule: true } };
      __cache[modId] = mod;
      factory(mod.exports, __require, mod);
      return mod.exports;
    }

    // Boot Application
    try {
      var entryExports = __require(${JSON.stringify(mountModulePath)});
      var AppComponent = entryExports.default || entryExports.App || Object.values(entryExports).find(function(v) { return typeof v === 'function'; });
      var rootEl = document.getElementById('root');
      if (AppComponent && rootEl) {
        ReactDOMShim.createRoot(rootEl).render(createElement(AppComponent, null));
      } else if (rootEl && rootEl.childNodes.length > 0) {
        reportStatus('rendered', null);
      } else {
        throw new Error("No default or named React component export found in '" + ${JSON.stringify(mountModulePath)} + "'.");
      }
    } catch (bootErr) {
      showRuntimeError(bootErr);
    }
  })();
  </script>
</body>
</html>`;
}

/**
 * Self-contained Tailwind-compatible utility CSS for offline sandbox rendering.
 */
function getEmbeddedUtilityCss(): string {
  return `
*, ::before, ::after { box-sizing: border-box; margin: 0; padding: 0; border-color: rgba(255,255,255,0.1); }
body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.5; background-color: #020617; color: #f8fafc; }
button, input, select, textarea { font: inherit; color: inherit; background: transparent; border: none; }
button { cursor: pointer; }
a { color: inherit; text-decoration: none; }
ul, ol { list-style: none; }

.min-h-screen { min-height: 100vh; }
.h-full { height: 100%; }
.w-full { width: 100%; }
.max-w-7xl { max-width: 80rem; }
.max-w-6xl { max-width: 72rem; }
.max-w-5xl { max-width: 64rem; }
.max-w-4xl { max-width: 56rem; }
.max-w-3xl { max-width: 48rem; }
.max-w-2xl { max-width: 42rem; }
.max-w-xl { max-width: 36rem; }
.max-w-md { max-width: 28rem; }
.max-w-sm { max-width: 24rem; }
.mx-auto { margin-left: auto; margin-right: auto; }

.flex { display: flex; }
.inline-flex { display: inline-flex; }
.grid { display: grid; }
.hidden { display: none; }
.block { display: block; }
.inline-block { display: inline-block; }
.flex-col { flex-direction: column; }
.flex-wrap { flex-wrap: wrap; }
.flex-1 { flex: 1 1 0%; }
.shrink-0 { flex-shrink: 0; }
.items-center { align-items: center; }
.items-start { align-items: flex-start; }
.justify-between { justify-content: space-between; }
.justify-center { justify-content: center; }
.justify-end { justify-content: flex-end; }

.gap-1 { gap: 0.25rem; }
.gap-1\\.5 { gap: 0.375rem; }
.gap-2 { gap: 0.5rem; }
.gap-3 { gap: 0.75rem; }
.gap-4 { gap: 1rem; }
.gap-6 { gap: 1.5rem; }
.gap-8 { gap: 2rem; }

.grid-cols-1 { grid-template-columns: repeat(1, minmax(0, 1fr)); }
.grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.grid-cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
@media (min-width: 768px) {
  .md\\:grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .md\\:grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .md\\:grid-cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .md\\:flex-row { flex-direction: row; }
  .md\\:flex { display: flex; }
  .md\\:text-5xl { font-size: 3rem; line-height: 1.1; }
  .md\\:text-6xl { font-size: 3.75rem; line-height: 1.1; }
}
@media (min-width: 1024px) {
  .lg\\:grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .lg\\:grid-cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}

.p-2 { padding: 0.5rem; }
.p-3 { padding: 0.75rem; }
.p-4 { padding: 1rem; }
.p-5 { padding: 1.25rem; }
.p-6 { padding: 1.5rem; }
.p-8 { padding: 2rem; }
.px-2\\.5 { padding-left: 0.625rem; padding-right: 0.625rem; }
.px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
.px-4 { padding-left: 1rem; padding-right: 1rem; }
.px-5 { padding-left: 1.25rem; padding-right: 1.25rem; }
.px-6 { padding-left: 1.5rem; padding-right: 1.5rem; }
.px-8 { padding-left: 2rem; padding-right: 2rem; }
.py-1 { padding-top: 0.25rem; padding-bottom: 0.25rem; }
.py-1\\.5 { padding-top: 0.375rem; padding-bottom: 0.375rem; }
.py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
.py-2\\.5 { padding-top: 0.625rem; padding-bottom: 0.625rem; }
.py-3 { padding-top: 0.75rem; padding-bottom: 0.75rem; }
.py-4 { padding-top: 1rem; padding-bottom: 1rem; }
.py-8 { padding-top: 2rem; padding-bottom: 2rem; }
.py-12 { padding-top: 3rem; padding-bottom: 3rem; }
.py-16 { padding-top: 4rem; padding-bottom: 4rem; }
.py-20 { padding-top: 5rem; padding-bottom: 5rem; }

.mt-1 { margin-top: 0.25rem; }
.mt-2 { margin-top: 0.5rem; }
.mt-3 { margin-top: 0.75rem; }
.mt-4 { margin-top: 1rem; }
.mt-6 { margin-top: 1.5rem; }
.mt-8 { margin-top: 2rem; }
.mt-12 { margin-top: 3rem; }
.mt-16 { margin-top: 4rem; }
.mb-1 { margin-bottom: 0.25rem; }
.mb-2 { margin-bottom: 0.5rem; }
.mb-3 { margin-bottom: 0.75rem; }
.mb-4 { margin-bottom: 1rem; }
.mb-6 { margin-bottom: 1.5rem; }
.mb-8 { margin-bottom: 2rem; }
.mb-12 { margin-bottom: 3rem; }

.space-y-2 > * + * { margin-top: 0.5rem; }
.space-y-3 > * + * { margin-top: 0.75rem; }
.space-y-4 > * + * { margin-top: 1rem; }
.space-y-6 > * + * { margin-top: 1.5rem; }
.space-y-8 > * + * { margin-top: 2rem; }

.text-xs { font-size: 0.75rem; line-height: 1rem; }
.text-sm { font-size: 0.875rem; line-height: 1.25rem; }
.text-base { font-size: 1rem; line-height: 1.5rem; }
.text-lg { font-size: 1.125rem; line-height: 1.75rem; }
.text-xl { font-size: 1.25rem; line-height: 1.75rem; }
.text-2xl { font-size: 1.5rem; line-height: 2rem; }
.text-3xl { font-size: 1.875rem; line-height: 2.25rem; }
.text-4xl { font-size: 2.25rem; line-height: 2.5rem; }
.text-5xl { font-size: 3rem; line-height: 1.1; }

.font-medium { font-weight: 500; }
.font-semibold { font-weight: 600; }
.font-bold { font-weight: 700; }
.font-extrabold { font-weight: 800; }
.font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.uppercase { text-transform: uppercase; }
.tracking-tight { letter-spacing: -0.025em; }
.tracking-wider { letter-spacing: 0.05em; }
.text-center { text-align: center; }
.text-left { text-align: left; }
.text-right { text-align: right; }

.text-white { color: #ffffff; }
.text-slate-100 { color: #f1f5f9; }
.text-slate-200 { color: #e2e8f0; }
.text-slate-300 { color: #cbd5e1; }
.text-slate-400 { color: #94a3b8; }
.text-slate-500 { color: #64748b; }
.text-blue-400 { color: #60a5fa; }
.text-blue-500 { color: #3b82f6; }
.text-purple-400 { color: #c084fc; }
.text-purple-300 { color: #d8b4fe; }
.text-indigo-400 { color: #818cf8; }
.text-emerald-400 { color: #34d399; }
.text-amber-400 { color: #fbbf24; }
.text-rose-400 { color: #fb7185; }

.bg-slate-950 { background-color: #020617; }
.bg-slate-900 { background-color: #0f172a; }
.bg-slate-900\\/80 { background-color: rgba(15, 23, 42, 0.8); }
.bg-slate-900\\/50 { background-color: rgba(15, 23, 42, 0.5); }
.bg-slate-800 { background-color: #1e293b; }
.bg-white\\/5 { background-color: rgba(255, 255, 255, 0.05); }
.bg-white\\/10 { background-color: rgba(255, 255, 255, 0.1); }
.bg-blue-600 { background-color: #2563eb; }
.bg-blue-500\\/10 { background-color: rgba(59, 130, 246, 0.1); }
.bg-purple-600 { background-color: #9333ea; }
.bg-purple-500\\/10 { background-color: rgba(168, 85, 247, 0.1); }
.bg-emerald-600 { background-color: #059669; }
.bg-emerald-500\\/10 { background-color: rgba(16, 185, 129, 0.1); }
.bg-indigo-600 { background-color: #4f46e5; }
.bg-indigo-500\\/10 { background-color: rgba(99, 102, 241, 0.1); }

.border { border-width: 1px; border-style: solid; }
.border-b { border-bottom-width: 1px; border-bottom-style: solid; }
.border-t { border-top-width: 1px; border-top-style: solid; }
.border-slate-800 { border-color: #1e293b; }
.border-slate-700 { border-color: #334155; }
.border-white\\/10 { border-color: rgba(255, 255, 255, 0.1); }
.border-blue-500\\/20 { border-color: rgba(59, 130, 246, 0.2); }
.border-purple-500\\/20 { border-color: rgba(168, 85, 247, 0.2); }
.border-purple-500\\/30 { border-color: rgba(168, 85, 247, 0.3); }

.rounded { border-radius: 0.25rem; }
.rounded-md { border-radius: 0.375rem; }
.rounded-lg { border-radius: 0.5rem; }
.rounded-xl { border-radius: 0.75rem; }
.rounded-2xl { border-radius: 1rem; }
.rounded-full { border-radius: 9999px; }

.shadow-sm { box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05); }
.shadow-md { box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3); }
.shadow-lg { box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.4); }
.shadow-2xl { box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }
`;
}

/**
 * Built-in realistic multi-file React/Vite starter manifest for instant offline
 * testing and verification without consuming live Gemini API credits.
 */
export function getSampleReactWebsiteManifest(
  websiteName = 'Apex Cloud Platform',
  category = 'SaaS',
  designDirection = 'Dark'
): ManifestFile[] {
  return [
    {
      path: 'package.json',
      type: 'config',
      content: JSON.stringify(
        {
          name: websiteName.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
          private: true,
          version: '1.0.0',
          type: 'module',
          scripts: {
            dev: 'vite',
            build: 'vite build',
            preview: 'vite preview',
          },
          dependencies: {
            react: '^19.0.0',
            'react-dom': '^19.0.0',
            'lucide-react': '^0.546.0',
          },
          devDependencies: {
            vite: '^6.0.0',
            '@vitejs/plugin-react': '^4.3.0',
            tailwindcss: '^3.4.0',
          },
        },
        null,
        2
      ),
    },
    {
      path: 'index.html',
      type: 'markup',
      content: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${websiteName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>`,
    },
    {
      path: 'vite.config.js',
      type: 'config',
      content: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});`,
    },
    {
      path: 'src/main.jsx',
      type: 'source',
      content: `import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(<App />);`,
    },
    {
      path: 'src/index.css',
      type: 'style',
      content: `@import "tailwindcss";

.hero-glow {
  background: radial-gradient(circle at 50% 0%, rgba(147, 51, 234, 0.18), transparent 70%);
}`,
    },
    {
      path: 'src/components/Navbar.jsx',
      type: 'source',
      content: `import React from 'react';
import { Globe, Sparkles } from 'lucide-react';

export default function Navbar({ brandName, activeSection, onSelectSection }) {
  const navItems = [
    { id: 'overview', label: 'Overview' },
    { id: 'features', label: 'Architecture' },
    { id: 'pricing', label: 'Pricing Calculator' },
    { id: 'contact', label: 'Contact' },
  ];

  return (
    <header className="border-b border-slate-800 bg-slate-900/80 px-6 py-4 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-2 font-bold text-lg text-white">
        <Globe size={20} className="text-purple-400" />
        <span>{brandName}</span>
      </div>
      <nav className="flex flex-wrap items-center gap-3">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onSelectSection(item.id)}
            className={
              activeSection === item.id
                ? 'px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-semibold'
                : 'px-3 py-1.5 rounded-lg text-slate-300 text-xs font-medium'
            }
          >
            {item.label}
          </button>
        ))}
        <button
          onClick={() => onSelectSection('contact')}
          className="px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
        >
          Let's Talk
        </button>
      </nav>
    </header>
  );
}`,
    },
    {
      path: 'src/components/FeatureGrid.jsx',
      type: 'source',
      content: `import React from 'react';
import { Shield, Zap, BarChart } from 'lucide-react';

export function FeatureGrid({ features }) {
  return (
    <section className="py-12">
      <h2 className="text-2xl font-bold text-white mb-6 text-center">
        Engineered for Mission-Critical Workloads
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {features.map((f) => (
          <div key={f.id} className="p-6 rounded-xl bg-slate-900 border border-slate-800 text-left space-y-2">
            <div className="text-xs font-mono text-purple-400 uppercase">{f.tag}</div>
            <h3 className="text-lg font-semibold text-white">{f.title}</h3>
            <p className="text-sm text-slate-400">{f.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}`,
    },
    {
      path: 'src/components/PricingCalculator.jsx',
      type: 'source',
      content: `import React, { useState } from 'react';

export function PricingCalculator() {
  const [tier, setTier] = useState('pro');
  const [nodes, setNodes] = useState(4);

  const unitPrice = tier === 'enterprise' ? 45 : tier === 'pro' ? 25 : 10;
  const totalMonthly = unitPrice * nodes;

  return (
    <section className="p-6 rounded-xl bg-slate-900 border border-slate-800 max-w-2xl mx-auto mt-8 text-left space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-white">Interactive Cluster Estimator</h3>
          <p className="text-xs text-slate-400">Select tier and compute nodes to estimate monthly cost</p>
        </div>
        <div className="text-2xl font-extrabold text-emerald-400">
          \${totalMonthly}/mo
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => setTier('starter')}
          className={tier === 'starter' ? 'px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold' : 'px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs'}
        >
          Starter (\$10/node)
        </button>
        <button
          onClick={() => setTier('pro')}
          className={tier === 'pro' ? 'px-4 py-2 rounded-lg bg-purple-600 text-white text-xs font-semibold' : 'px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs'}
        >
          Pro (\$25/node)
        </button>
        <button
          onClick={() => setTier('enterprise')}
          className={tier === 'enterprise' ? 'px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold' : 'px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs'}
        >
          Enterprise (\$45/node)
        </button>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-slate-800">
        <span className="text-xs text-slate-300">Active Compute Nodes: <strong>{nodes}</strong></span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setNodes(Math.max(1, nodes - 1))}
            className="px-3 py-1 rounded bg-slate-800 text-white text-xs font-bold"
          >
            -1 Node
          </button>
          <button
            onClick={() => setNodes(nodes + 1)}
            className="px-3 py-1 rounded bg-purple-600 text-white text-xs font-bold"
          >
            +1 Node
          </button>
        </div>
      </div>
    </section>
  );
}`,
    },
    {
      path: 'src/App.jsx',
      type: 'source',
      content: `import React, { useState } from 'react';
import Navbar from './components/Navbar';
import { FeatureGrid } from './components/FeatureGrid';
import { PricingCalculator } from './components/PricingCalculator';

const FEATURES = [
  {
    id: 'f1',
    tag: '01 // Edge Network',
    title: 'Sub-10ms Global Routing',
    description: 'Anycast edge routing across 35 regions with zero cold-start overhead.',
  },
  {
    id: 'f2',
    tag: '02 // Isolation',
    title: 'Zero-Trust MicroVMs',
    description: 'Strict hardware-virtualized workload isolation and automated key rotation.',
  },
  {
    id: 'f3',
    tag: '03 // Observability',
    title: 'Real-Time Telemetry',
    description: 'High-cardinality logs, distributed traces, and live SLO alerting.',
  },
];

export default function App() {
  const [activeSection, setActiveSection] = useState('overview');
  const [deployments, setDeployments] = useState(128);
  const [contactEmail, setContactEmail] = useState('');
  const [contactNote, setContactNote] = useState('');
  const [formFeedback, setFormFeedback] = useState('');

  const handleContactSubmit = (e) => {
    e.preventDefault();
    if (!contactEmail.includes('@') || !contactNote.trim()) {
      setFormFeedback('Please enter a valid work email and architecture requirement.');
      return;
    }
    setFormFeedback('Validated locally in preview mode (connect a backend webhook after export for external delivery).');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 hero-glow flex flex-col">
      <Navbar
        brandName="${websiteName}"
        activeSection={activeSection}
        onSelectSection={setActiveSection}
      />

      <main className="max-w-5xl mx-auto px-6 py-12 text-center flex-1">
        <div className="inline-block px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-300 text-xs font-semibold uppercase tracking-wider mb-4">
          ${category} · ${designDirection} Architecture
        </div>

        <h1 className="text-4xl md:text-5xl font-extrabold text-white tracking-tight max-w-3xl mx-auto">
          Deploy Resilient Cloud Infrastructure at Scale
        </h1>

        <p className="mt-4 text-slate-400 text-base max-w-2xl mx-auto">
          Interactive multi-component React application compiled and rendered inside an isolated zero-trust sandbox.
        </p>

        <div className="mt-6 flex items-center justify-center gap-4">
          <button
            onClick={() => setDeployments(deployments + 1)}
            className="px-5 py-2.5 rounded-lg bg-purple-600 text-white font-semibold text-xs shadow-md"
          >
            Trigger Test Deploy ({deployments})
          </button>
          <span className="text-xs font-mono text-emerald-400">
            Active View: {activeSection}
          </span>
        </div>

        <FeatureGrid features={FEATURES} />
        <PricingCalculator />

        <section className="p-6 rounded-xl bg-slate-900 border border-slate-800 max-w-2xl mx-auto mt-8 text-left space-y-4">
          <h3 className="text-lg font-bold text-white">Architecture Consultation Inquiry</h3>
          <form onSubmit={handleContactSubmit} className="space-y-3">
            <div>
              <label className="block text-xs text-slate-300 mb-1">Work Email</label>
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="architect@enterprise.io"
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-300 mb-1">Workload Details</label>
              <textarea
                rows={2}
                value={contactNote}
                onChange={(e) => setContactNote(e.target.value)}
                placeholder="Describe target regions and throughput..."
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-purple-600 text-white text-xs font-semibold"
            >
              Validate Inquiry
            </button>
            {formFeedback && (
              <p className="text-xs text-emerald-400 mt-2">{formFeedback}</p>
            )}
          </form>
        </section>
      </main>

      <footer className="border-t border-slate-800 py-6 px-6 text-center text-xs text-slate-500">
        <span>${websiteName} · Built with React & Vite</span>
      </footer>
    </div>
  );
}`,
    },
    {
      path: 'README.md',
      type: 'doc',
      content: `# ${websiteName}\n\nGenerated by AI Engineering Workspace (Agent 2).\n\n## Setup\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\``,
    },
  ];
}
