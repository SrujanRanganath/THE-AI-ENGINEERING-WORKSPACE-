import express, { Express, Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  defaultOtpManager,
  getEmailProviderStatus,
  getOtpSecurityStatus,
  processOtpSendRequest,
} from './src/server/otpService';
import {
  HYDROGEN_MODEL_ID,
  callWithBoundedRetry,
  executeWebsiteGeneration,
  getErrorStatusCode,
  parseWebsiteGeneratorJson,
  sanitizeManifestFilePath,
} from './src/server/websiteGenerationService';
import { executeDataCleaningPlanRequest } from './src/server/dataCleaningPlanner';
import { PublishedWebsiteSnapshot } from './src/utils/publishPreview';
import {
  createFirestoreRestAdapter,
  PublishedSnapshotStore,
} from './src/server/publishedSnapshotStore';
import {
  extractBearerToken,
  FirebaseTokenVerificationResult,
  verifyFirebaseIdToken,
} from './src/server/firebaseAuth';
import firebaseConfig from './firebase-applet-config.json';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Verified official Gemini model identifiers (per @google/genai specification)
// - 'gemini-4-hydrogen': Primary economical Flash model used across Code, Website, and Document generators.
// - 'gemini-4-argon': Optional fallback/legacy model identifier (not primary).
const DEFAULT_ECONOMICAL_MODEL = HYDROGEN_MODEL_ID;
const PRIMARY_MODEL = process.env.GEMINI_MODEL || DEFAULT_ECONOMICAL_MODEL;
// Website Generator shares the same Hydrogen model configuration as Code Generator
// so stale runtime WEBSITE_GENERATOR_MODEL=gemini-4-argon overrides cannot force Argon.
const WEBSITE_GENERATOR_MODEL = PRIMARY_MODEL;
const WEBSITE_FALLBACK_MODEL =
  process.env.WEBSITE_FALLBACK_MODEL &&
  process.env.WEBSITE_FALLBACK_MODEL !== WEBSITE_GENERATOR_MODEL
    ? process.env.WEBSITE_FALLBACK_MODEL
    : undefined;

const GUEST_DEMO_UID = 'guest_engineer_demo';
const MAX_PROMPT_FIELD_CHARS = 16_000;
const MAX_CODE_MODIFY_FILES = 100;

/**
 * Redacts potential secrets, API keys, or stack traces before returning errors to clients.
 */
export function sanitizePublicErrorMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!raw) return fallback;
  const cleaned = raw
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/([?&]key=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/re_[0-9A-Za-z_]{16,}/g, '[REDACTED_KEY]');
  return cleaned.length > 260 ? `${cleaned.slice(0, 260)}...` : cleaned;
}

export interface WorkspaceAppDependencies {
  isProduction?: boolean;
  apiKey?: string;
  publishedSnapshotStore?: PublishedSnapshotStore;
  verifyToken?: (token: string | undefined) => Promise<FirebaseTokenVerificationResult>;
  generateContent?: (params: any) => Promise<{ text?: string }>;
}

export function isAllowedCorsOrigin(originHeader: string | undefined, hostHeader?: string): boolean {
  if (!originHeader) return false;
  try {
    const parsed = new URL(originHeader);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (hostHeader && parsed.host === hostHeader) return true;
    const configuredAppUrl = process.env.APP_URL?.trim();
    if (configuredAppUrl) {
      try {
        if (new URL(configuredAppUrl).origin === parsed.origin) return true;
      } catch {
        // Ignore malformed APP_URL
      }
    }
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return true;
    }
    if (parsed.hostname.endsWith('.run.app') && parsed.protocol === 'https:') {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Builds the Express API application with injectable dependencies for deterministic security testing.
 */
export function createWorkspaceApp(deps: WorkspaceAppDependencies = {}): Express {
  const app = express();
  app.disable('x-powered-by');

  const isProduction = deps.isProduction ?? process.env.NODE_ENV === 'production';

  // Production HTTP security headers & safe CORS preflight
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    // Allows Google Sign-In popup auth while isolating cross-origin browsing context
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    if (
      isProduction &&
      (req.secure || req.headers['x-forwarded-proto'] === 'https')
    ) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    const host = typeof req.headers.host === 'string' ? req.headers.host : undefined;
    if (origin && isAllowedCorsOrigin(origin, host)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    next();
  });

  app.use(express.json({ limit: '15mb' }));
  const apiKey = deps.apiKey ?? (process.env.GEMINI_API_KEY || '');
  const verifyToken = deps.verifyToken ?? ((token) => verifyFirebaseIdToken(token));

  const ai = !deps.generateContent
    ? new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      })
    : null;

  const generateContent =
    deps.generateContent ?? ((params: any) => ai!.models.generateContent(params));

  // Persistent published snapshot store:
  // - production: strict Firebase Firestore persistence (no local JSON / in-memory storage)
  // - development: Firestore with atomic local JSON dev fallback
  const publishedSnapshotStore =
    deps.publishedSnapshotStore ??
    new PublishedSnapshotStore({
      persistenceMode: isProduction ? 'production_firestore' : 'development',
      firestoreAdapter: createFirestoreRestAdapter({
        projectId: firebaseConfig.projectId,
        firestoreDatabaseId: (firebaseConfig as any).firestoreDatabaseId,
        apiKey: firebaseConfig.apiKey,
      }),
    });

  // ----------------------------------------------------
  // Health Check Endpoint
  // ----------------------------------------------------
  app.get('/api/health', (_req: Request, res: Response) => {
    const emailStatus = getEmailProviderStatus();
    const otpSecurity = getOtpSecurityStatus();
    const distIndexExists = fs.existsSync(path.resolve(__dirname, 'dist', 'index.html'));
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      nodeEnv: isProduction ? 'production' : process.env.NODE_ENV || 'development',
      hasGeminiKey: Boolean(apiKey),
      primaryModel: PRIMARY_MODEL,
      websiteGeneratorModel: WEBSITE_GENERATOR_MODEL,
      emailDeliveryConfigured: emailStatus.configured,
      emailProvider: emailStatus.provider,
      otpHmacSecretConfigured: otpSecurity.otpHmacSecretConfigured,
      otpEmailFromConfigured: otpSecurity.otpEmailFromConfigured,
      usingResendDefaultSender: otpSecurity.usingResendDefaultSender,
      sandboxOtpEnabled: otpSecurity.sandboxOtpEnabled,
      distBuilt: distIndexExists,
    });
  });

  // ----------------------------------------------------
  // Server-Side 6-Digit Email OTP Verification Endpoints
  // ----------------------------------------------------
  app.post('/api/auth/otp/send', async (req: Request, res: Response) => {
    const { email, uid } = req.body || {};
    const { status, body } = await processOtpSendRequest({
      email: String(email || ''),
      uid: String(uid || ''),
    });
    return res.status(status).json(body);
  });

  app.post('/api/auth/otp/verify', (req: Request, res: Response) => {
    const { email, uid, code } = req.body || {};
    const result = defaultOtpManager.verifyOtp(
      String(email || ''),
      String(uid || ''),
      String(code || '')
    );
    if (!result.success) {
      const status =
        result.code === 'MAX_ATTEMPTS_EXCEEDED'
          ? 429
          : result.code === 'EXPIRED'
          ? 410
          : 400;
      return res.status(status).json(result);
    }
    return res.json(result);
  });

  app.get('/api/auth/otp/status', (req: Request, res: Response) => {
    const email = String(req.query.email || '');
    const uid = String(req.query.uid || '');
    const token = req.query.token ? String(req.query.token) : undefined;
    const status = defaultOtpManager.getStatus(email, uid, Date.now(), token);
    return res.json(status);
  });

  // ----------------------------------------------------
  // AGENT 1: Code Generator Endpoints
  // ----------------------------------------------------
  app.post('/api/ai/generate-code', async (req: Request, res: Response) => {
    try {
      const {
        projectName,
        language,
        framework = 'Standard / None',
        database = 'None',
        description,
        requirements = '',
        instructions = '',
      } = req.body || {};

      if (!projectName || !language || !description) {
        return res.status(400).json({
          error: 'Missing required fields: projectName, language, and description are required.',
        });
      }

      if (
        String(projectName).length > 256 ||
        String(language).length > 128 ||
        String(description).length > MAX_PROMPT_FIELD_CHARS ||
        String(requirements).length > MAX_PROMPT_FIELD_CHARS ||
        String(instructions).length > MAX_PROMPT_FIELD_CHARS
      ) {
        return res.status(400).json({
          error: 'One or more input fields exceed maximum allowed length.',
        });
      }

      if (!apiKey) {
        return res.status(503).json({
          error: 'Gemini API key is not configured on the server. Please check the Secrets panel in AI Studio.',
        });
      }

      const systemPrompt = `You are an expert Principal Software Engineer and System Architect.
Your task is to generate a complete, high-quality, production-ready multi-file software project based on the user's specification.

CRITICAL INSTRUCTIONS:
1. Generate REAL, functional source code across MULTIPLE files. Never combine everything into a single file.
2. Structure the files logically (e.g., config, entry points, business logic, models, controllers/routes, tests, README).
3. Do NOT invent fake imports or rely on phantom packages. Ensure all dependencies match the chosen language and framework.
4. Return ONLY a valid JSON object matching the requested schema. No conversational preamble, no markdown ticks around the JSON.`;

      const userPrompt = `Project Name: ${projectName}
Language: ${language}
Framework: ${framework}
Database: ${database}
Description: ${description}
Functional Requirements: ${requirements}
Additional Instructions: ${instructions}

Return a valid JSON object with the exact format:
{
  "projectName": "${projectName}",
  "language": "${language}",
  "framework": "${framework}",
  "database": "${database}",
  "architectureOverview": "Comprehensive overview of the system architecture",
  "runInstructions": "Step-by-step instructions on how to install dependencies and run the project",
  "files": [
    {
      "path": "relative/path/to/file.ext",
      "content": "Complete source code of the file",
      "language": "${String(language).toLowerCase()}"
    }
  ]
}`;

      const response = await callWithBoundedRetry(() =>
        generateContent({
          model: PRIMARY_MODEL,
          contents: userPrompt,
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: 'application/json',
          },
        })
      );

      const parsedResult = parseWebsiteGeneratorJson(response.text);
      if (!parsedResult.success || !parsedResult.data || typeof parsedResult.data !== 'object') {
        return res.status(502).json({
          error: 'AI generated an invalid file structure. Please retry or adjust requirements.',
        });
      }

      const parsed = parsedResult.data as Record<string, any>;
      if (!parsed.files || !Array.isArray(parsed.files) || parsed.files.length === 0) {
        return res.status(502).json({
          error: 'AI generated an invalid file structure. Please retry or adjust requirements.',
        });
      }

      // Sanitize all file paths
      parsed.files = parsed.files
        .slice(0, MAX_CODE_MODIFY_FILES)
        .map((file: any) => ({
          path: sanitizeManifestFilePath(file?.path || 'index.txt') || 'index.txt',
          content: String(file?.content || ''),
          language: String(file?.language || String(language).toLowerCase()),
        }));

      return res.json({
        success: true,
        requestId: `req_code_${Date.now()}`,
        data: parsed,
      });
    } catch (error: any) {
      console.error('Error generating code:', sanitizePublicErrorMessage(error, 'Unknown error'));
      const statusCode = getErrorStatusCode(error);
      if (statusCode === 429) {
        return res.status(429).json({
          error: 'Gemini rate limit or quota exceeded. Please wait a moment before trying again.',
        });
      }
      if (statusCode === 503) {
        return res.status(503).json({
          error: 'Gemini model is temporarily unavailable (HTTP 503). Please try again shortly.',
        });
      }
      return res.status(500).json({
        error: 'Failed to generate code project. Please retry.',
      });
    }
  });

  app.post('/api/ai/modify-code', async (req: Request, res: Response) => {
    try {
      const { projectName, instruction, files } = req.body || {};

      if (!instruction || !Array.isArray(files) || files.length === 0) {
        return res.status(400).json({
          error: 'Missing required fields: instruction and existing files array are required.',
        });
      }

      if (
        String(instruction).length > MAX_PROMPT_FIELD_CHARS ||
        files.length > MAX_CODE_MODIFY_FILES
      ) {
        return res.status(400).json({
          error: 'Modification request exceeds supported size limits.',
        });
      }

      if (!apiKey) {
        return res.status(503).json({
          error: 'Gemini API key is not configured on the server.',
        });
      }

      const filesManifest = files
        .map(
          (f: any, i: number) =>
            `[File ${i + 1}: ${sanitizeManifestFilePath(f?.path || `file_${i}.txt`)}]\n\`\`\`${
              f?.language || ''
            }\n${String(f?.content || '').slice(0, 3000)}\n\`\`\``
        )
        .join('\n\n');

      const systemPrompt = `You are a Principal Software Engineer performing a code modification on an existing project.
The user wants to apply specific changes to the codebase.
Analyze the existing codebase and provide the precise file modifications.

RULES:
1. Return ONLY a valid JSON object.
2. For each modified, added, or deleted file, specify action ('modified' | 'added' | 'deleted'), path, changeDescription, and the FULL updated content.
3. Never return partial diffs or placeholders; return the entire file content so it can be cleanly adopted.`;

      const userPrompt = `Project: ${projectName || 'Existing Project'}
Requested Modification: ${instruction}

Current Project Files:
${filesManifest}

Return JSON with exact shape:
{
  "summary": "High-level summary of what was changed and why",
  "affectedFilePaths": ["list", "of", "paths"],
  "modifiedFiles": [
    {
      "path": "relative/path/to/file.ext",
      "action": "modified",
      "changeDescription": "Explanation of changes made in this file",
      "content": "Complete full new content for this file",
      "language": "extension-or-lang"
    }
  ]
}`;

      const response = await callWithBoundedRetry(() =>
        generateContent({
          model: PRIMARY_MODEL,
          contents: userPrompt,
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: 'application/json',
          },
        })
      );

      const parsedResult = parseWebsiteGeneratorJson(response.text);
      if (!parsedResult.success || !parsedResult.data || typeof parsedResult.data !== 'object') {
        return res.status(502).json({
          error: 'Invalid response from AI for code modification.',
        });
      }

      const parsed = parsedResult.data as Record<string, any>;
      if (!parsed.modifiedFiles || !Array.isArray(parsed.modifiedFiles)) {
        return res.status(502).json({
          error: 'Invalid response from AI for code modification.',
        });
      }

      parsed.modifiedFiles = parsed.modifiedFiles.map((f: any) => ({
        ...f,
        path: sanitizeManifestFilePath(f?.path || 'index.txt') || 'index.txt',
      }));

      return res.json({
        success: true,
        requestId: `req_mod_${Date.now()}`,
        data: parsed,
      });
    } catch (error: any) {
      console.error('Error modifying code:', sanitizePublicErrorMessage(error, 'Unknown error'));
      const statusCode = getErrorStatusCode(error);
      if (statusCode === 429) {
        return res.status(429).json({
          error: 'Gemini rate limit or quota exceeded. Please wait a moment.',
        });
      }
      if (statusCode === 503) {
        return res.status(503).json({
          error: 'Gemini model is temporarily unavailable (HTTP 503). Please try again shortly.',
        });
      }
      return res.status(500).json({
        error: 'Failed to modify code project. Please retry.',
      });
    }
  });

  // ----------------------------------------------------
  // AGENT 2: Website Generator & Published Preview Endpoints
  // ----------------------------------------------------
  app.post('/api/ai/generate-website', async (req: Request, res: Response) => {
    try {
      const {
        websiteName = '',
        category = '',
        technology = 'React',
        designDirection = 'Modern',
        description = '',
        requirements = '',
      } = req.body || {};

      if (
        String(websiteName).length > 256 ||
        String(description).length > MAX_PROMPT_FIELD_CHARS ||
        String(requirements).length > MAX_PROMPT_FIELD_CHARS
      ) {
        return res.status(400).json({
          error: 'Website specification fields exceed maximum allowed length.',
        });
      }

      const { status, body } = await executeWebsiteGeneration({
        input: {
          websiteName: String(websiteName),
          category: String(category),
          technology: String(technology),
          designDirection: String(designDirection),
          description: String(description),
          requirements: String(requirements),
        },
        apiKeyConfigured: Boolean(apiKey),
        model: WEBSITE_GENERATOR_MODEL,
        fallbackModel: WEBSITE_FALLBACK_MODEL,
        generateContent: (params) => generateContent(params),
      });

      return res.status(status).json(body);
    } catch (error: any) {
      console.error('Error generating website:', sanitizePublicErrorMessage(error, 'Unknown error'));
      return res.status(500).json({
        error: 'Failed to generate website due to an unexpected server error.',
      });
    }
  });

  app.post('/api/published/:projectId', async (req: Request, res: Response) => {
    try {
      const projectId = String(req.params.projectId || '').trim();
      const body = (req.body || {}) as Partial<PublishedWebsiteSnapshot>;
      const bearerToken = extractBearerToken(req.headers.authorization);

      let callerOwnerId: string | undefined;
      if (bearerToken) {
        const verified = await verifyToken(bearerToken);
        if (!verified.valid) {
          return res.status(401).json({
            error: 'Invalid or expired Firebase authentication token.',
          });
        }
        callerOwnerId = verified.uid;
      } else if (isProduction) {
        return res.status(401).json({
          error: 'Authentication required: valid Firebase ID token is required to publish.',
        });
      } else {
        // In local development, unauthenticated publishes are strictly limited to the Guest Demo identity.
        const requestedOwner = String(body.ownerId || '').trim();
        if (requestedOwner !== GUEST_DEMO_UID) {
          return res.status(401).json({
            error:
              'Authentication required: provide a valid Firebase ID token to publish under an authenticated user account.',
          });
        }
        callerOwnerId = GUEST_DEMO_UID;
      }

      const result = await publishedSnapshotStore.saveSnapshot(
        {
          ...body,
          projectId,
        },
        { bearerToken, callerOwnerId }
      );

      if (!result.success || !result.snapshot) {
        return res.status(result.status).json({
          error: result.error || 'Failed to register published website preview.',
        });
      }

      return res.json({
        success: true,
        projectId,
        snapshotVersion: result.snapshot.snapshotVersion,
        publishedAt: result.snapshot.publishedAt,
        snapshot: result.snapshot,
        persistence: result.persistence,
      });
    } catch (error: any) {
      console.error(
        'Error saving published preview:',
        sanitizePublicErrorMessage(error, 'Unknown error')
      );
      return res.status(500).json({
        error: 'Failed to register published website preview.',
      });
    }
  });

  app.get('/api/published/:projectId', async (req: Request, res: Response) => {
    try {
      const projectId = String(req.params.projectId || '').trim();
      if (!projectId) {
        return res.status(400).json({
          error: 'Project ID is required to access a published preview.',
        });
      }

      const bearerToken = extractBearerToken(req.headers.authorization);
      let verifiedUid: string | null = null;
      let validBearerToken: string | undefined;

      if (bearerToken) {
        const verified = await verifyToken(bearerToken);
        if (verified.valid) {
          verifiedUid = verified.uid;
          validBearerToken = bearerToken;
        }
      }

      // Never trust client-supplied ?ownerId= or x-owner-id headers for real user accounts.
      // Only permit explicit guest demo lookup in non-production development mode.
      const requestedOwnerId = String(
        req.query.ownerId || req.headers['x-owner-id'] || ''
      ).trim();
      const devGuestOwnerId =
        !isProduction && requestedOwnerId === GUEST_DEMO_UID ? GUEST_DEMO_UID : undefined;

      const result = await publishedSnapshotStore.getSnapshot(projectId, {
        ownerId: devGuestOwnerId,
        verifiedUid,
        bearerToken: validBearerToken,
      });

      if (!result.found || !result.snapshot) {
        return res.status(result.status).json({
          error: result.error || 'Published preview not found.',
        });
      }

      return res.json({
        success: true,
        snapshot: result.snapshot,
      });
    } catch (error: any) {
      console.error(
        'Error loading published preview:',
        sanitizePublicErrorMessage(error, 'Unknown error')
      );
      return res.status(500).json({
        error: 'Failed to load published website preview.',
      });
    }
  });

  // ----------------------------------------------------
  // AGENT 3: Document Generator Endpoints (Prompt-Driven)
  // ----------------------------------------------------
  app.post('/api/ai/generate-document', async (req: Request, res: Response) => {
    try {
      const {
        title,
        documentType,
        category,
        pageCount,
        length,
        prompt,
        description,
        tone = 'Professional',
        requiredSections = '',
        instructions = '',
      } = req.body || {};

      const effectiveTitle = String(title || '').trim();
      const effectiveType = String(documentType || category || '').trim();
      const effectiveLength = String(pageCount || length || 'Standard (3-5 pages)').trim();
      const effectivePrompt = String(prompt || description || '').trim();

      if (!effectiveTitle || !effectiveType || !effectivePrompt) {
        return res.status(400).json({
          error:
            'Missing required fields: Document Title, Document Type, and Main Content / Instructions are required.',
        });
      }

      if (
        effectiveTitle.length > 256 ||
        effectiveType.length > 128 ||
        effectiveLength.length > 128 ||
        effectivePrompt.length > MAX_PROMPT_FIELD_CHARS ||
        String(requiredSections).length > MAX_PROMPT_FIELD_CHARS ||
        String(instructions).length > MAX_PROMPT_FIELD_CHARS
      ) {
        return res.status(400).json({
          error: 'One or more document fields exceed maximum allowed length.',
        });
      }

      if (!apiKey) {
        return res.status(503).json({
          error: 'Gemini API key is not configured on the server.',
        });
      }

      const systemPrompt = `You are an elite Technical Writer, Principal Systems Architect, and Executive Documentation Author.
Create a well-structured, publication-quality document tailored directly to the user's title, document type, requested page count/length, and prompt instructions.

CRITICAL AUTHORING RULES:
1. INFER STRUCTURE AUTOMATICALLY: Determine the logical sections, subsections, heading hierarchy (#, ##, ###), paragraphs, bulleted lists, numbered lists, and Markdown tables directly from the user's prompt and document type. If the user's prompt specifies particular sections, structure, audience, or tone, follow the prompt even if it overrides the general document type defaults.
2. SCALE TO REQUESTED PAGE COUNT / LENGTH:
   - Brief (1-2 pages): Focused executive summary, concise key points, crisp action table.
   - Standard (3-5 pages): Thorough section breakdown, architecture/design rationale, structured tables and lists.
   - Detailed (6-10 pages) or Comprehensive (12-15+ pages) or explicit higher page counts (e.g., "15 pages"): Produce substantially deeper multi-section prose, detailed technical subsections, numbered workflows, and comparative tables proportionate to the requested scope.
3. HONESTY & NO FABRICATION: NEVER invent fake experimental measurements, fabricated user survey numbers, fake citations/DOIs, or made-up benchmarks. Whenever specific quantitative metrics or project details are missing from the user's prompt, explicitly state assumptions or mark them as "[Assumption / Project Detail Needed]" or include an "Assumptions & Scope Notes" subsection.
4. OUTPUT COMPATIBILITY: Populate BOTH 'fullMarkdown' (using clean Markdown #, ##, ### headings, paragraphs, - bullets, 1. numbered lists, and | Col | Col | tables) AND 'sections' JSON for downstream compatibility.`;

      const extraContext = [
        requiredSections ? `Explicit Sections Requested:\n${requiredSections}` : '',
        instructions ? `Additional Guidance:\n${instructions}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      const userPrompt = `Document Title: ${effectiveTitle}
Document Type: ${effectiveType}
Requested Page Count / Length: ${effectiveLength}
Main Content & Instructions:
${effectivePrompt}${extraContext ? `\n\n${extraContext}` : ''}

Return ONLY a valid JSON object with the exact structure:
{
  "title": "${effectiveTitle.replace(/"/g, '\\"')}",
  "subtitle": "Concise subtitle reflecting document type and scope",
  "category": "${effectiveType.replace(/"/g, '\\"')}",
  "tone": "${String(tone).replace(/"/g, '\\"')}",
  "length": "${effectiveLength.replace(/"/g, '\\"')}",
  "metadata": {
    "author": "AI Engineering Workspace",
    "version": "1.0",
    "date": "${new Date().toISOString().split('T')[0]}"
  },
  "sections": [
    {
      "heading": "Section Heading",
      "subsections": [
        {
          "subheading": "Optional Subheading",
          "paragraphs": ["Detailed prose paragraphs."],
          "bullets": ["Key point 1", "Key point 2"],
          "table": {
            "headers": ["Column 1", "Column 2"],
            "rows": [["Value 1", "Value 2"]]
          }
        }
      ]
    }
  ],
  "fullMarkdown": "Complete formatted Markdown document with ## Sections, ### Subsections, paragraphs, bullet/numbered lists, and Markdown tables (| Col1 | Col2 |)."
}`;

      const response = await callWithBoundedRetry(() =>
        generateContent({
          model: PRIMARY_MODEL,
          contents: userPrompt,
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: 'application/json',
          },
        })
      );

      const parsedResult = parseWebsiteGeneratorJson(response.text);
      if (!parsedResult.success || !parsedResult.data || typeof parsedResult.data !== 'object') {
        return res.status(502).json({
          error: 'AI generated invalid document structure. Please retry.',
        });
      }

      const parsed = parsedResult.data as Record<string, any>;
      if (!parsed.sections || !Array.isArray(parsed.sections)) {
        return res.status(502).json({
          error: 'AI generated invalid document structure. Please retry.',
        });
      }

      return res.json({
        success: true,
        requestId: `req_doc_${Date.now()}`,
        data: parsed,
      });
    } catch (error: any) {
      console.error(
        'Error generating document:',
        sanitizePublicErrorMessage(error, 'Unknown error')
      );
      const statusCode = getErrorStatusCode(error);
      if (statusCode === 429) {
        return res.status(429).json({
          error: 'Gemini quota or rate limit exceeded. Please wait a moment.',
        });
      }
      if (statusCode === 503) {
        return res.status(503).json({
          error: 'Gemini model is temporarily unavailable (HTTP 503). Please try again shortly.',
        });
      }
      return res.status(500).json({
        error: 'Failed to generate document. Please retry.',
      });
    }
  });

  // ----------------------------------------------------
  // AGENT 4: Natural-Language Data Cleaning Planner
  // ----------------------------------------------------
  app.post('/api/ai/plan-cleaning', async (req: Request, res: Response) => {
    try {
      const { instruction = '', datasetProfile } = req.body || {};

      if (String(instruction).length > MAX_PROMPT_FIELD_CHARS) {
        return res.status(400).json({
          error: 'Cleaning instruction exceeds maximum allowed length.',
        });
      }

      const { status, body } = await executeDataCleaningPlanRequest({
        input: {
          instruction: String(instruction),
          datasetProfile,
        },
        apiKeyConfigured: Boolean(apiKey),
        model: PRIMARY_MODEL,
        generateContent: (params) => generateContent(params),
      });

      return res.status(status).json(body);
    } catch (error: any) {
      console.error(
        'Error planning data cleaning:',
        sanitizePublicErrorMessage(error, 'Unknown error')
      );
      return res.status(500).json({
        error: 'Failed to plan data cleaning operations. Please retry.',
      });
    }
  });

  return app;
}

// ----------------------------------------------------
// Production vs Development Serving
// ----------------------------------------------------
async function startServer() {
  const app = createWorkspaceApp();
  const isProduction = process.env.NODE_ENV === 'production';
  const PORT = Number(process.env.PORT) || 3000;

  if (isProduction) {
    const otpSecurity = getOtpSecurityStatus();
    if (!process.env.GEMINI_API_KEY?.trim()) {
      console.warn('[Startup Warning] GEMINI_API_KEY is not set in production.');
    }
    if (!otpSecurity.otpHmacSecretConfigured) {
      console.warn(
        '[Startup Warning] OTP_HMAC_SECRET is not set in production; ephemeral key will not persist across restarts/instances.'
      );
    }
    if (!otpSecurity.emailDeliveryConfigured) {
      console.warn(
        '[Startup Warning] RESEND_API_KEY is not set in production; email OTP verification will fail closed.'
      );
    }
    if (otpSecurity.usingResendDefaultSender) {
      console.warn(
        '[Startup Warning] OTP_EMAIL_FROM is not set; Resend defaults to onboarding@resend.dev (restricted recipient mode).'
      );
    }

    app.all('/api/*', (_req: Request, res: Response) => {
      res.status(404).json({ error: 'API endpoint not found.' });
    });

    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[AI Engineering Workspace] Server running on http://0.0.0.0:${PORT}`);
  });
}

const isDirectExecution =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  startServer().catch((err) => {
    console.error('Failed to start server:', sanitizePublicErrorMessage(err, 'Startup error'));
    process.exit(1);
  });
}
