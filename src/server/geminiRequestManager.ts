import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildGeminiModelRegistry,
  CANDIDATE_GEMINI_MODELS,
  DEFAULT_ROUTING_ORDER_BY_AGENT,
  GeminiModelStatusEntry,
  getCandidateModelMetadata,
  ModelAccessVerificationStatus,
  ModelUsageWindow,
} from './geminiModelRegistry';

export function getErrorStatusCode(error: unknown): number | undefined {
  const err = error as any;
  const rawStatus =
    err?.status ?? err?.statusCode ?? err?.response?.status ?? err?.error?.code;
  if (typeof rawStatus === 'number' && Number.isFinite(rawStatus)) {
    return rawStatus;
  }
  const msg = err instanceof Error ? err.message : String(error || '');
  if (/\b503\b|UNAVAILABLE|temporarily unavailable|overloaded|high demand/i.test(msg)) {
    return 503;
  }
  if (/\b429\b|RESOURCE_EXHAUSTED|rate limit|quota/i.test(msg)) {
    return 429;
  }
  if (/\b403\b|PERMISSION_DENIED|ACCESS_DENIED/i.test(msg)) {
    return 403;
  }
  if (/\b404\b|NOT_FOUND|no longer available|not found for API version/i.test(msg)) {
    return 404;
  }
  if (/\b400\b|INVALID_ARGUMENT|API_KEY_INVALID/i.test(msg)) {
    return 400;
  }
  return undefined;
}

export type GeminiAgentType =
  | 'code_generation'
  | 'code_modification'
  | 'website_generation'
  | 'website_repair'
  | 'document_generation'
  | 'data_cleaning';

export type NormalizedGeminiErrorCode =
  | 'API_KEY_MISSING'
  | 'QUOTA_EXHAUSTED'
  | 'MODEL_UNAVAILABLE'
  | 'MODEL_UNSUPPORTED'
  | 'INVALID_MODEL_RESPONSE'
  | 'AI_TIMEOUT'
  | 'INVALID_REQUEST'
  | 'PROVIDER_ERROR';

export interface ModelAttributionLogEntry {
  timestampIso: string;
  agentType: GeminiAgentType;
  requestedModel: string;
  modelUsed: string;
  fallbackUsed: boolean;
  attemptedModels: string[];
  status: 'success' | 'failed';
  latencyMs: number;
  errorReason?: string;
}

export interface GeminiManagerDiagnostics {
  requestManagerEnabled: true;
  responseCacheEnabled: boolean;
  duplicateRequestGuardEnabled: true;
  timeoutMs: number;
  maxTransientRetries: number;
  maxOutputTokensByAgent: Record<GeminiAgentType, number>;
  activeCacheEntries: number;
  inFlightRequests: number;
  modelCooldowns: Record<string, { cooldownRemainingSeconds: number; cooldownUntilIso: string }>;
  aiServiceStatus: 'available' | 'cooldown' | 'unavailable' | 'unconfigured';
  currentSelectedModel: string;
  lightweightPlanningModel: string;
  fallbackModelSelected: string;
  eligibleModelCount: number;
  verifiedModelCount: number;
  recommendDemoMode: boolean;
  lastStartupCheckIso?: string;
  recentAttributions: ModelAttributionLogEntry[];
}

export interface GeminiManagerExecuteOptions {
  agentType: GeminiAgentType;
  scopeKey: string;
  model: string;
  contents: string;
  config?: Record<string, any>;
  skipCache?: boolean;
  timeoutMs?: number;
  maxOutputTokens?: number;
  generateContent: (params: any) => Promise<{ text?: string }>;
}

export interface GeminiManagerRoutedExecuteOptions {
  agentType: GeminiAgentType;
  scopeKey: string;
  preferredModel?: string;
  candidateModels?: string[];
  contents: string;
  config?: Record<string, any>;
  skipCache?: boolean;
  timeoutMs?: number;
  maxOutputTokens?: number;
  maxModelsToTry?: number;
  validateResponse?: (text: string | undefined) => { valid: boolean; reason?: string };
  generateContent: (params: any) => Promise<{ text?: string }>;
}

export interface GeminiManagerExecuteResult {
  response: { text?: string };
  cacheHit: boolean;
  deduplicated: boolean;
  modelUsed: string;
  requestedModel?: string;
  attemptedModels?: string[];
  fallbackUsed?: boolean;
  modelFallbackNotice?: string;
}

export class GeminiRequestError extends Error {
  public readonly status: number;
  public readonly code: NormalizedGeminiErrorCode;
  public readonly retryAfterSeconds?: number;
  public readonly retryable: boolean;
  public readonly demoModeAvailable = true;
  public readonly attemptedModels?: string[];
  public readonly allModelsExhausted?: boolean;
  public readonly recommendDemoMode?: boolean;

  constructor(options: {
    message: string;
    status: number;
    code: NormalizedGeminiErrorCode;
    retryAfterSeconds?: number;
    retryable?: boolean;
    attemptedModels?: string[];
    allModelsExhausted?: boolean;
    recommendDemoMode?: boolean;
    cause?: unknown;
  }) {
    super(options.message);
    this.name = 'GeminiRequestError';
    this.status = options.status;
    this.code = options.code;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.retryable = Boolean(options.retryable);
    this.attemptedModels = options.attemptedModels;
    this.allModelsExhausted = options.allModelsExhausted;
    this.recommendDemoMode = options.recommendDemoMode;
    if (options.cause !== undefined) {
      (this as any).cause = options.cause;
    }
  }
}

export const DEFAULT_AGENT_MAX_OUTPUT_TOKENS: Record<GeminiAgentType, number> = {
  code_generation: Number(process.env.GEMINI_MAX_TOKENS_CODE) || 8192,
  code_modification: Number(process.env.GEMINI_MAX_TOKENS_MODIFY) || 8192,
  website_generation: Number(process.env.GEMINI_MAX_TOKENS_WEBSITE) || 8192,
  website_repair: Number(process.env.GEMINI_MAX_TOKENS_WEBSITE_REPAIR) || 4096,
  document_generation: Number(process.env.GEMINI_MAX_TOKENS_DOCUMENT) || 8192,
  data_cleaning: Number(process.env.GEMINI_MAX_TOKENS_CLEANING) || 2048,
};

const DEFAULT_TIMEOUT_MS = Number(process.env.GEMINI_REQUEST_TIMEOUT_MS) || 45_000;
const DEFAULT_CACHE_TTL_MS = Number(process.env.GEMINI_RESPONSE_CACHE_TTL_MS) || 5 * 60 * 1000;
const DEFAULT_MAX_CACHE_ENTRIES = 120;
const DEFAULT_COOLDOWN_MS = 30_000;
const DEFAULT_503_COOLDOWN_MS = 20_000;
const MAX_TRANSIENT_RETRIES = 2;
const MAX_RESPECTED_RETRY_AFTER_MS = 10_000;

export function sanitizeModelErrorSummary(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || 'Provider error');
  const cleaned = raw
    .replace(/AIza[0-9A-Za-z_-]{16,}/g, '[REDACTED_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/([?&]key=)[^&\s]+/gi, '$1[REDACTED]');

  try {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const innerMsg = parsed?.error?.message || parsed?.message;
      if (typeof innerMsg === 'string' && innerMsg.trim()) {
        return innerMsg.trim().slice(0, 200);
      }
    }
  } catch {
    // Use raw cleaned string
  }

  return cleaned.trim().slice(0, 200);
}

/**
 * Extracts HTTP Retry-After duration (in milliseconds) from header objects or provider messages.
 */
export function parseRetryAfterMs(error: unknown, nowMs: number = Date.now()): number | undefined {
  const err = error as any;
  const headerCandidates = [
    typeof err?.headers?.get === 'function' ? err.headers.get('retry-after') : undefined,
    err?.headers?.['retry-after'],
    err?.headers?.['Retry-After'],
    err?.response?.headers?.get?.('retry-after'),
    err?.response?.headers?.['retry-after'],
    err?.response?.headers?.['Retry-After'],
    err?.retryAfter,
    err?.retryAfterSeconds,
  ];

  for (const raw of headerCandidates) {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      return Math.min(120_000, Math.max(1000, Math.ceil(raw * 1000)));
    }
    if (typeof raw === 'string' && raw.trim()) {
      const num = Number(raw.trim());
      if (Number.isFinite(num) && num > 0) {
        return Math.min(120_000, Math.max(1000, Math.ceil(num * 1000)));
      }
      const parsedDate = Date.parse(raw.trim());
      if (Number.isFinite(parsedDate) && parsedDate > nowMs) {
        return Math.min(120_000, Math.max(1000, parsedDate - nowMs));
      }
    }
  }

  const msg = err instanceof Error ? err.message : String(error || '');
  const msgMatch = msg.match(/retry\s*(?:in|after)\s*(\d+(?:\.\d+)?)\s*s/i);
  if (msgMatch) {
    const secs = Number(msgMatch[1]);
    if (Number.isFinite(secs) && secs > 0) {
      return Math.min(120_000, Math.max(1000, Math.ceil(secs * 1000)));
    }
  }

  return undefined;
}

/**
 * Classifies whether a provider failure is a transient 503/network error eligible for bounded retry.
 * HTTP 429 (quota exhausted) and AI_TIMEOUT are strictly NOT retried on the same model.
 */
export function isTransientRetryableGeminiError(error: unknown): boolean {
  if (error instanceof GeminiRequestError) {
    return error.code === 'MODEL_UNAVAILABLE';
  }
  const status = getErrorStatusCode(error);
  if (status === 429) {
    return false;
  }
  if (status === 503) {
    return true;
  }
  if (status && status >= 400 && status < 500) {
    return false;
  }
  const msg = error instanceof Error ? error.message : String(error || '');
  if (/timed\s*out|AI_TIMEOUT|RESOURCE_EXHAUSTED|quota|\b429\b/i.test(msg)) {
    return false;
  }
  return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|UNAVAILABLE|temporarily unavailable/i.test(
    msg
  );
}

/**
 * Normalizes raw Gemini SDK / HTTP errors into safe, actionable user-facing responses.
 */
export function normalizeGeminiError(error: unknown): GeminiRequestError {
  if (error instanceof GeminiRequestError) {
    return error;
  }

  const retryAfterMs = parseRetryAfterMs(error);
  const retryAfterSeconds = retryAfterMs ? Math.ceil(retryAfterMs / 1000) : undefined;
  const status = getErrorStatusCode(error);

  if (status === 429) {
    return new GeminiRequestError({
      message:
        'Live Gemini API quota or rate limit was reached (HTTP 429). Wait for the cooldown or switch to Demo Mode to continue without API calls.',
      status: 429,
      code: 'QUOTA_EXHAUSTED',
      retryAfterSeconds: retryAfterSeconds ?? 30,
      retryable: false,
      cause: error,
    });
  }

  if (status === 503) {
    return new GeminiRequestError({
      message:
        'Live Gemini service is temporarily overloaded (HTTP 503). Please retry shortly or switch to Demo Mode.',
      status: 503,
      code: 'MODEL_UNAVAILABLE',
      retryAfterSeconds: retryAfterSeconds ?? 10,
      retryable: true,
      cause: error,
    });
  }

  if (status === 404) {
    return new GeminiRequestError({
      message:
        'Requested Gemini model is not supported or unavailable for this API key (HTTP 404). Switch to Demo Mode or use a verified model.',
      status: 404,
      code: 'INVALID_REQUEST',
      retryable: false,
      cause: error,
    });
  }

  if (status === 400 || status === 403) {
    return new GeminiRequestError({
      message:
        'Live AI request could not be completed with the current model or parameters. You can switch to Demo Mode or adjust inputs.',
      status,
      code: 'INVALID_REQUEST',
      retryable: false,
      cause: error,
    });
  }

  const msg = error instanceof Error ? error.message : String(error || '');
  if (/timed\s*out|abort/i.test(msg)) {
    return new GeminiRequestError({
      message:
        'Live AI request timed out before completing. Retry or switch to Demo Mode for instant local execution.',
      status: 504,
      code: 'AI_TIMEOUT',
      retryAfterSeconds: 5,
      retryable: false,
      cause: error,
    });
  }

  return new GeminiRequestError({
    message:
      'Live AI service encountered an unexpected error. Retry shortly or switch to Demo Mode.',
    status: 500,
    code: 'PROVIDER_ERROR',
    retryable: false,
    cause: error,
  });
}

interface CacheEntry {
  response: { text?: string };
  modelUsed: string;
  expiresAtMs: number;
}

interface ModelUsageEvent {
  timestampMs: number;
  tokens: number;
}

export interface GeminiRequestManagerConfig {
  timeoutMs?: number;
  cacheTtlMs?: number;
  maxCacheEntries?: number;
  enableCache?: boolean;
  maxTransientRetries?: number;
  baseRetryDelayMs?: number;
  retryJitterMs?: number;
  maxRetryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
  maxOutputTokensByAgent?: Partial<Record<GeminiAgentType, number>>;
}

/**
 * Centralized Server-Side Gemini Request & Intelligent Model Router:
 * - Tracks candidate model health, access verification status, RPM/TPM/RPD usage, and cooldowns
 * - Prefers Gemini 3.1 Flash Lite for lightweight structured planning and stronger models for synthesis
 * - Automatically fails over to the next eligible model on 429, 503, 404, 403, timeout, or invalid response
 * - Never calls paid-only models (`gemini-4-carbon`) or retries exhausted models
 * - Signals automatic Demo Mode transition when all eligible models are unavailable/quota-limited
 */
export class GeminiRequestManager {
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly maxCacheEntries: number;
  private readonly enableCache: boolean;
  private readonly maxTransientRetries: number;
  private readonly baseRetryDelayMs: number;
  private readonly retryJitterMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly maxOutputTokensByAgent: Record<GeminiAgentType, number>;

  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<GeminiManagerExecuteResult>>();
  private readonly modelCooldownUntil = new Map<string, number>();
  private readonly modelAccessStatus = new Map<string, ModelAccessVerificationStatus>();
  private readonly modelLastSuccessIso = new Map<string, string>();
  private readonly modelUsageHistory = new Map<string, ModelUsageEvent[]>();
  private readonly modelLastErrors = new Map<
    string,
    {
      code: string;
      message: string;
      status?: number;
      timestampIso: string;
      unavailable?: boolean;
    }
  >();

  private lastStartupCheckIso?: string;
  private lastSelectedSynthesisModel: string = 'gemini-4-hydrogen';
  private lastSelectedPlanningModel: string = 'gemini-3.1-flash-lite';
  private lastFallbackModel: string = 'gemini-3.5-flash-lite';
  private readonly attributionLogs: ModelAttributionLogEntry[] = [];

  constructor(config: GeminiRequestManagerConfig = {}) {
    this.timeoutMs = Math.max(100, config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.cacheTtlMs = Math.max(0, config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
    this.maxCacheEntries = Math.max(1, config.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES);
    this.enableCache = config.enableCache ?? this.cacheTtlMs > 0;
    this.maxTransientRetries = Math.max(
      0,
      Math.min(2, config.maxTransientRetries ?? MAX_TRANSIENT_RETRIES)
    );
    this.baseRetryDelayMs = Math.max(1, config.baseRetryDelayMs ?? 700);
    this.retryJitterMs = Math.max(0, config.retryJitterMs ?? 300);
    this.maxRetryDelayMs = Math.max(10, config.maxRetryDelayMs ?? 4000);
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = config.random ?? Math.random;
    this.now = config.now ?? (() => Date.now());
    this.maxOutputTokensByAgent = {
      ...DEFAULT_AGENT_MAX_OUTPUT_TOKENS,
      ...(config.maxOutputTokensByAgent || {}),
    };

    // Enforce paid-model block on gemini-4-carbon at initialization
    this.modelAccessStatus.set('gemini-4-carbon', 'disabled_paid');
  }

  public getMaxOutputTokens(agentType: GeminiAgentType): number {
    return this.maxOutputTokensByAgent[agentType] || 4096;
  }

  private pruneModelUsage(modelId: string, nowMs: number): ModelUsageWindow {
    const events = this.modelUsageHistory.get(modelId) || [];
    const dayAgo = nowMs - 86_400_000;
    const minAgo = nowMs - 60_000;
    const kept = events.filter((e) => e.timestampMs > dayAgo);
    if (kept.length !== events.length) {
      this.modelUsageHistory.set(modelId, kept);
    }

    let requestsInLastMinute = 0;
    let tokensInLastMinute = 0;
    for (const e of kept) {
      if (e.timestampMs > minAgo) {
        requestsInLastMinute += 1;
        tokensInLastMinute += e.tokens;
      }
    }

    return {
      requestsInLastMinute,
      tokensInLastMinute,
      requestsToday: kept.length,
    };
  }

  private recordModelUsage(modelId: string, estimatedTokens: number, nowMs: number): void {
    const events = this.modelUsageHistory.get(modelId) || [];
    events.push({
      timestampMs: nowMs,
      tokens: Math.max(1, Math.round(estimatedTokens)),
    });
    this.modelUsageHistory.set(modelId, events);
  }

  public isModelWithinRateLimits(modelId: string, estimatedTokens = 500): boolean {
    const meta = getCandidateModelMetadata(modelId);
    if (meta.paidOnly) return false;
    const nowMs = this.now();
    const usage = this.pruneModelUsage(modelId, nowMs);
    if (usage.requestsInLastMinute >= meta.rateLimits.rpm) return false;
    if (usage.tokensInLastMinute + estimatedTokens > meta.rateLimits.tpm) return false;
    if (usage.requestsToday >= meta.rateLimits.rpd) return false;
    return true;
  }

  public isModelEligible(modelId: string, estimatedTokens = 500): boolean {
    if (!modelId || typeof modelId !== 'string') return false;
    const trimmed = modelId.trim();
    const meta = getCandidateModelMetadata(trimmed);
    if (meta.paidOnly) return false;

    const access = this.modelAccessStatus.get(trimmed);
    if (access === 'unsupported' || access === 'disabled_paid') {
      return false;
    }

    const nowMs = this.now();
    const cooldownUntil = this.modelCooldownUntil.get(trimmed);
    if (cooldownUntil && cooldownUntil > nowMs) {
      return false;
    }
    if (cooldownUntil && cooldownUntil <= nowMs) {
      this.modelCooldownUntil.delete(trimmed);
    }

    const lastErr = this.modelLastErrors.get(trimmed);
    if (lastErr?.unavailable) {
      return false;
    }

    return this.isModelWithinRateLimits(trimmed, estimatedTokens);
  }

  /**
   * Computes the ordered list of eligible models for a given agent task.
   * - Respects task preference (Gemini 3.1 Flash Lite first for planning/cleaning; stronger synthesis models first for code/website/document).
   * - Prioritizes runtime-verified models ('verified') over untested models so requests route immediately to known-working models.
   * - Excludes models in cooldown, quota-exhausted, unsupported (404), or paid-disabled ('gemini-4-carbon').
   */
  public getRoutingChainForAgent(
    agentType: GeminiAgentType,
    options?: {
      preferredModel?: string;
      explicitCandidates?: string[];
      estimatedTokens?: number;
    }
  ): string[] {
    const estimatedTokens = options?.estimatedTokens ?? 600;
    const rawOrder: string[] = [];

    if (options?.explicitCandidates && options.explicitCandidates.length > 0) {
      rawOrder.push(...options.explicitCandidates);
    } else {
      const isLightweightTask =
        agentType === 'data_cleaning' || agentType === 'website_repair';
      if (!isLightweightTask && options?.preferredModel?.trim()) {
        rawOrder.push(options.preferredModel.trim());
      }
      rawOrder.push(...(DEFAULT_ROUTING_ORDER_BY_AGENT[agentType] || []));
      if (isLightweightTask && options?.preferredModel?.trim()) {
        rawOrder.push(options.preferredModel.trim());
      }
    }

    const uniqueEligible: string[] = [];
    const seen = new Set<string>();
    for (const id of rawOrder) {
      const cleanId = String(id || '').trim();
      if (!cleanId || seen.has(cleanId)) continue;
      seen.add(cleanId);
      if (this.isModelEligible(cleanId, estimatedTokens)) {
        uniqueEligible.push(cleanId);
      }
    }

    // If explicitCandidates was NOT passed and we have runtime verification data,
    // sort 'verified' models ahead of 'not_tested' while preserving relative task order.
    if (!options?.explicitCandidates) {
      const hasAnyVerified = uniqueEligible.some(
        (id) => this.modelAccessStatus.get(id) === 'verified'
      );
      if (hasAnyVerified) {
        const verified = uniqueEligible.filter(
          (id) => this.modelAccessStatus.get(id) === 'verified'
        );
        const others = uniqueEligible.filter(
          (id) => this.modelAccessStatus.get(id) !== 'verified'
        );
        return [...verified, ...others];
      }
    }

    return uniqueEligible;
  }

  public recordAttribution(entry: ModelAttributionLogEntry): void {
    this.attributionLogs.unshift(entry);
    if (this.attributionLogs.length > 30) {
      this.attributionLogs.length = 30;
    }
    if (entry.status === 'success') {
      if (entry.agentType === 'data_cleaning' || entry.agentType === 'website_repair') {
        this.lastSelectedPlanningModel = entry.modelUsed;
      } else {
        this.lastSelectedSynthesisModel = entry.modelUsed;
      }
      if (entry.fallbackUsed) {
        this.lastFallbackModel = entry.modelUsed;
      }
    }
  }

  public recordModelVerificationResult(
    modelId: string,
    result: {
      accessStatus: ModelAccessVerificationStatus;
      status?: number;
      errorReason?: string;
      cooldownSeconds?: number;
    }
  ): void {
    const nowMs = this.now();
    const nowIso = new Date(nowMs).toISOString();
    const meta = getCandidateModelMetadata(modelId);
    if (meta.paidOnly) {
      this.modelAccessStatus.set(modelId, 'disabled_paid');
      return;
    }

    this.modelAccessStatus.set(modelId, result.accessStatus);

    if (result.accessStatus === 'verified') {
      this.modelLastSuccessIso.set(modelId, nowIso);
      this.modelCooldownUntil.delete(modelId);
      this.modelLastErrors.delete(modelId);
    } else if (result.accessStatus === 'quota_exhausted') {
      const cooldownMs = (result.cooldownSeconds ?? 60) * 1000;
      this.modelCooldownUntil.set(modelId, nowMs + cooldownMs);
      this.modelLastErrors.set(modelId, {
        code: 'QUOTA_EXHAUSTED',
        status: result.status ?? 429,
        message: result.errorReason || 'HTTP 429: Quota or rate limit reached.',
        timestampIso: nowIso,
        unavailable: false,
      });
    } else if (result.accessStatus === 'unsupported') {
      this.modelLastErrors.set(modelId, {
        code: 'MODEL_UNSUPPORTED',
        status: result.status ?? 404,
        message: result.errorReason || 'HTTP 404: Model not supported for this API key.',
        timestampIso: nowIso,
        unavailable: true,
      });
    } else if (result.accessStatus === 'unavailable') {
      const is503 = result.status === 503;
      if (is503) {
        const cooldownMs = (result.cooldownSeconds ?? 30) * 1000;
        this.modelCooldownUntil.set(modelId, nowMs + cooldownMs);
      }
      this.modelLastErrors.set(modelId, {
        code: is503 ? 'MODEL_UNAVAILABLE' : 'INVALID_REQUEST',
        status: result.status,
        message: result.errorReason || 'Model unavailable.',
        timestampIso: nowIso,
        unavailable: !is503,
      });
    }
  }

  /**
   * Performs a safe, bounded capability check across candidate models.
   * Never exposes secrets, never calls paid-only models, and supports a local non-secret status cache
   * so restarts do not waste daily request quotas.
   */
  public async verifyRuntimeModelsAccess(options: {
    apiKeyConfigured: boolean;
    generateContent: (params: any) => Promise<{ text?: string }>;
    candidateModelIds?: string[];
    probeTimeoutMs?: number;
    cacheFilePath?: string;
    forceFreshProbe?: boolean;
  }): Promise<GeminiModelStatusEntry[]> {
    const nowMs = this.now();
    this.lastStartupCheckIso = new Date(nowMs).toISOString();

    if (!options.apiKeyConfigured) {
      return this.getModelRegistrySnapshot(false);
    }

    // Load recent cached verification snapshot if fresh (< 30 minutes) and not forced
    if (options.cacheFilePath && !options.forceFreshProbe) {
      try {
        if (fs.existsSync(options.cacheFilePath)) {
          const raw = JSON.parse(fs.readFileSync(options.cacheFilePath, 'utf8'));
          if (
            raw &&
            typeof raw.checkedAtMs === 'number' &&
            nowMs - raw.checkedAtMs < 30 * 60 * 1000 &&
            Array.isArray(raw.results)
          ) {
            for (const item of raw.results) {
              if (item && typeof item.modelId === 'string' && typeof item.accessStatus === 'string') {
                this.recordModelVerificationResult(item.modelId, {
                  accessStatus: item.accessStatus,
                  status: item.status,
                  errorReason: item.errorReason,
                  cooldownSeconds: item.cooldownSeconds,
                });
              }
            }
            this.lastStartupCheckIso = new Date(raw.checkedAtMs).toISOString();
            return this.getModelRegistrySnapshot(true);
          }
        }
      } catch {
        // Proceed with live probe
      }
    }

    const targetIds =
      options.candidateModelIds ??
      CANDIDATE_GEMINI_MODELS.filter((m) => !m.paidOnly).map((m) => m.modelId);
    const probeTimeoutMs = options.probeTimeoutMs ?? 7000;
    const persistedResults: Array<{
      modelId: string;
      accessStatus: ModelAccessVerificationStatus;
      status?: number;
      errorReason?: string;
      cooldownSeconds?: number;
    }> = [];

    for (const modelId of targetIds) {
      const meta = getCandidateModelMetadata(modelId);
      if (meta.paidOnly) {
        this.modelAccessStatus.set(modelId, 'disabled_paid');
        continue;
      }

      try {
        this.recordModelUsage(modelId, 24, this.now());
        await this.invokeWithTimeout(
          {
            model: modelId,
            contents: 'Reply with the single word OK.',
            config: { maxOutputTokens: 64 },
          },
          probeTimeoutMs,
          options.generateContent
        );
        this.recordModelVerificationResult(modelId, {
          accessStatus: 'verified',
          status: 200,
        });
        persistedResults.push({ modelId, accessStatus: 'verified', status: 200 });
      } catch (err) {
        const status = getErrorStatusCode(err);
        const summary = sanitizeModelErrorSummary(err);
        let accessStatus: ModelAccessVerificationStatus = 'unavailable';
        let cooldownSeconds: number | undefined;

        if (status === 429) {
          accessStatus = 'quota_exhausted';
          cooldownSeconds = 60;
        } else if (status === 404) {
          accessStatus = 'unsupported';
        } else if (status === 503 || status === 504) {
          accessStatus = 'unavailable';
          cooldownSeconds = 30;
        } else {
          accessStatus = 'unavailable';
        }

        this.recordModelVerificationResult(modelId, {
          accessStatus,
          status,
          errorReason: `HTTP ${status || 'ERR'}: ${summary}`,
          cooldownSeconds,
        });
        persistedResults.push({
          modelId,
          accessStatus,
          status,
          errorReason: `HTTP ${status || 'ERR'}: ${summary}`,
          cooldownSeconds,
        });
      }
    }

    if (options.cacheFilePath) {
      try {
        fs.mkdirSync(path.dirname(options.cacheFilePath), { recursive: true });
        fs.writeFileSync(
          options.cacheFilePath,
          JSON.stringify(
            {
              checkedAtMs: this.now(),
              checkedAtIso: new Date(this.now()).toISOString(),
              results: persistedResults,
            },
            null,
            2
          ),
          'utf8'
        );
      } catch {
        // Ignore cache write errors
      }
    }

    return this.getModelRegistrySnapshot(true);
  }

  private buildRequestKey(options: {
    agentType: GeminiAgentType;
    scopeKey: string;
    model: string;
    contents: string;
    config?: Record<string, any>;
    maxOutputTokens?: number;
  }): string {
    const safeScope = (options.scopeKey || 'guest:anon').trim();
    const payloadHash = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          agentType: options.agentType,
          model: options.model,
          contents: options.contents,
          systemInstruction: options.config?.systemInstruction || '',
          responseMimeType: options.config?.responseMimeType || '',
          hasSchema: Boolean(options.config?.responseSchema),
          maxOutputTokens:
            options.maxOutputTokens ?? this.getMaxOutputTokens(options.agentType),
        })
      )
      .digest('hex');

    return `${safeScope}:${options.agentType}:${options.model}:${payloadHash}`;
  }

  private pruneCache(nowMs: number) {
    for (const [k, entry] of this.cache.entries()) {
      if (nowMs >= entry.expiresAtMs) {
        this.cache.delete(k);
      }
    }
    while (this.cache.size >= this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (!oldestKey) break;
      this.cache.delete(oldestKey);
    }
  }

  private async invokeWithTimeout(
    params: any,
    timeoutMs: number,
    generateContent: (params: any) => Promise<{ text?: string }>
  ): Promise<{ text?: string }> {
    let timerId: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        generateContent(params),
        new Promise<never>((_resolve, reject) => {
          timerId = setTimeout(() => {
            reject(
              new GeminiRequestError({
                message:
                  'Live AI request timed out before completing. Retry or switch to Demo Mode.',
                status: 504,
                code: 'AI_TIMEOUT',
                retryAfterSeconds: 5,
                retryable: false,
              })
            );
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timerId !== undefined) {
        clearTimeout(timerId);
      }
    }
  }

  private async executeWithBoundedTransientRetry(
    params: any,
    timeoutMs: number,
    model: string,
    generateContent: (params: any) => Promise<{ text?: string }>,
    maxRetriesOverride?: number
  ): Promise<{ text?: string }> {
    const maxRetries =
      maxRetriesOverride !== undefined
        ? Math.max(0, Math.min(2, maxRetriesOverride))
        : this.maxTransientRetries;

    let lastError: unknown;
    const estTokens = Math.ceil(String(params?.contents || '').length / 4) + 256;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        this.recordModelUsage(model, estTokens, this.now());
        const res = await this.invokeWithTimeout(params, timeoutMs, generateContent);
        const nowIso = new Date(this.now()).toISOString();
        this.modelCooldownUntil.delete(model);
        this.modelLastErrors.delete(model);
        this.modelAccessStatus.set(model, 'verified');
        this.modelLastSuccessIso.set(model, nowIso);
        return res;
      } catch (err) {
        lastError = err;
        const status = getErrorStatusCode(err);
        const normalizedErr = normalizeGeminiError(err);
        const summary = sanitizeModelErrorSummary(err);
        const nowIso = new Date(this.now()).toISOString();

        // Fail fast on 429 and record passive cooldown without retrying the same model
        if (status === 429) {
          const retryAfterMs = parseRetryAfterMs(err, this.now()) ?? DEFAULT_COOLDOWN_MS;
          this.modelCooldownUntil.set(model, this.now() + retryAfterMs);
          this.modelAccessStatus.set(model, 'quota_exhausted');
          this.modelLastErrors.set(model, {
            code: normalizedErr.code,
            status: 429,
            message: `HTTP 429: ${summary}`,
            timestampIso: nowIso,
            unavailable: false,
          });
          throw normalizedErr;
        }

        // Fail fast on 404 (unsupported model ID) and mark permanently unsupported
        if (status === 404) {
          this.modelAccessStatus.set(model, 'unsupported');
          this.modelLastErrors.set(model, {
            code: 'MODEL_UNSUPPORTED',
            status: 404,
            message: `HTTP 404: ${summary}`,
            timestampIso: nowIso,
            unavailable: true,
          });
          throw normalizedErr;
        }

        if (attempt >= maxRetries || !isTransientRetryableGeminiError(err)) {
          if (status === 503) {
            this.modelCooldownUntil.set(model, this.now() + DEFAULT_503_COOLDOWN_MS);
            if (this.modelAccessStatus.get(model) !== 'verified') {
              this.modelAccessStatus.set(model, 'unavailable');
            }
          } else if (status === 403 || status === 400) {
            this.modelAccessStatus.set(model, 'unavailable');
          }
          this.modelLastErrors.set(model, {
            code: normalizedErr.code,
            status,
            message: status ? `HTTP ${status}: ${summary}` : summary,
            timestampIso: nowIso,
            unavailable: status === 403 || status === 404,
          });
          throw err;
        }

        const retryAfterMs = parseRetryAfterMs(err, this.now());
        if (retryAfterMs && retryAfterMs > MAX_RESPECTED_RETRY_AFTER_MS) {
          this.modelCooldownUntil.set(model, this.now() + retryAfterMs);
          this.modelLastErrors.set(model, {
            code: normalizedErr.code,
            status,
            message: `HTTP ${status || 503}: ${summary}`,
            timestampIso: nowIso,
            unavailable: false,
          });
          throw normalizedErr;
        }

        const exponential = this.baseRetryDelayMs * Math.pow(2, attempt);
        const jitter = Math.floor(this.random() * this.retryJitterMs);
        const delayMs = retryAfterMs
          ? Math.min(MAX_RESPECTED_RETRY_AFTER_MS, retryAfterMs)
          : Math.min(this.maxRetryDelayMs, exponential + jitter);
        await this.sleep(delayMs);
      }
    }
    throw lastError;
  }

  public async execute(options: GeminiManagerExecuteOptions): Promise<GeminiManagerExecuteResult> {
    const nowMs = this.now();
    const requestKey = this.buildRequestKey(options);

    // Block paid-only models strictly
    if (getCandidateModelMetadata(options.model).paidOnly) {
      throw new GeminiRequestError({
        message: `Model '${options.model}' is a paid-only model and is disabled by workspace policy.`,
        status: 403,
        code: 'INVALID_REQUEST',
        retryable: false,
      });
    }

    // 1. User-scoped cache lookup
    if (this.enableCache && !options.skipCache) {
      const cached = this.cache.get(requestKey);
      if (cached && nowMs < cached.expiresAtMs) {
        return {
          response: cached.response,
          cacheHit: true,
          deduplicated: false,
          modelUsed: cached.modelUsed,
          requestedModel: options.model,
          attemptedModels: [cached.modelUsed],
          fallbackUsed: false,
        };
      }
      if (cached) {
        this.cache.delete(requestKey);
      }
    }

    // 2. Concurrent in-flight request deduplication per user scope
    const existingFlight = this.inFlight.get(requestKey);
    if (existingFlight) {
      const res = await existingFlight;
      return {
        ...res,
        deduplicated: true,
      };
    }

    const timeoutMs = Math.max(50, options.timeoutMs ?? this.timeoutMs);
    const maxOutputTokens =
      options.maxOutputTokens ?? this.getMaxOutputTokens(options.agentType);
    const mergedConfig = {
      ...(options.config || {}),
      ...(options.config?.maxOutputTokens !== undefined
        ? {}
        : { maxOutputTokens }),
    };

    const requestParams = {
      model: options.model,
      contents: options.contents,
      config: mergedConfig,
    };

    const startMs = this.now();
    const flightPromise = (async (): Promise<GeminiManagerExecuteResult> => {
      try {
        const response = await this.executeWithBoundedTransientRetry(
          requestParams,
          timeoutMs,
          options.model,
          options.generateContent
        );

        if (
          this.enableCache &&
          !options.skipCache &&
          typeof response?.text === 'string' &&
          response.text.trim().length > 0
        ) {
          this.pruneCache(this.now());
          this.cache.set(requestKey, {
            response,
            modelUsed: options.model,
            expiresAtMs: this.now() + this.cacheTtlMs,
          });
        }

        this.recordAttribution({
          timestampIso: new Date(this.now()).toISOString(),
          agentType: options.agentType,
          requestedModel: options.model,
          modelUsed: options.model,
          fallbackUsed: false,
          attemptedModels: [options.model],
          status: 'success',
          latencyMs: Math.max(0, this.now() - startMs),
        });

        return {
          response,
          cacheHit: false,
          deduplicated: false,
          modelUsed: options.model,
          requestedModel: options.model,
          attemptedModels: [options.model],
          fallbackUsed: false,
        };
      } catch (err) {
        this.recordAttribution({
          timestampIso: new Date(this.now()).toISOString(),
          agentType: options.agentType,
          requestedModel: options.model,
          modelUsed: options.model,
          fallbackUsed: false,
          attemptedModels: [options.model],
          status: 'failed',
          latencyMs: Math.max(0, this.now() - startMs),
          errorReason: sanitizeModelErrorSummary(err),
        });
        throw err;
      }
    })();

    this.inFlight.set(requestKey, flightPromise);
    try {
      return await flightPromise;
    } finally {
      this.inFlight.delete(requestKey);
    }
  }

  /**
   * Executes an AI request using the centralized intelligent model router:
   * - Selects the ordered candidate chain for `agentType`
   * - Respects RPM/TPM/RPD limits, cooldowns, and paid-model exclusions
   * - Automatically falls back across eligible models on 429, 503, 404, 403, timeout, or invalid model response
   * - Never retries infinitely; signals `allModelsExhausted: true` and `recommendDemoMode: true` if all models fail
   */
  public async executeWithRouting(
    options: GeminiManagerRoutedExecuteOptions
  ): Promise<GeminiManagerExecuteResult> {
    const nowMs = this.now();
    const estTokens =
      Math.ceil(String(options.contents || '').length / 4) +
      Math.min(1024, this.getMaxOutputTokens(options.agentType));

    const routingChain = this.getRoutingChainForAgent(options.agentType, {
      preferredModel: options.preferredModel,
      explicitCandidates: options.candidateModels,
      estimatedTokens: estTokens,
    });

    const maxModelsToTry = Math.max(1, Math.min(6, options.maxModelsToTry ?? 5));
    const candidatesToTry = routingChain.slice(0, maxModelsToTry);

    const requestedPrimary =
      options.preferredModel ||
      options.candidateModels?.[0] ||
      candidatesToTry[0] ||
      'gemini-3.1-flash-lite';

    // Check user-scoped cache under the logical task key before invoking any model
    const logicalCacheKey = this.buildRequestKey({
      agentType: options.agentType,
      scopeKey: options.scopeKey,
      model: `routed:${options.agentType}`,
      contents: options.contents,
      config: options.config,
      maxOutputTokens: options.maxOutputTokens,
    });

    if (this.enableCache && !options.skipCache) {
      const cached = this.cache.get(logicalCacheKey);
      if (cached && nowMs < cached.expiresAtMs) {
        return {
          response: cached.response,
          cacheHit: true,
          deduplicated: false,
          modelUsed: cached.modelUsed,
          requestedModel: requestedPrimary,
          attemptedModels: [cached.modelUsed],
          fallbackUsed: cached.modelUsed !== requestedPrimary,
        };
      }
      if (cached) {
        this.cache.delete(logicalCacheKey);
      }
    }

    const existingFlight = this.inFlight.get(logicalCacheKey);
    if (existingFlight) {
      const res = await existingFlight;
      return {
        ...res,
        deduplicated: true,
      };
    }

    if (candidatesToTry.length === 0) {
      throw new GeminiRequestError({
        message:
          'All eligible Gemini models have exhausted their quotas or are currently in cooldown. Automatically entering Demo Mode.',
        status: 429,
        code: 'QUOTA_EXHAUSTED',
        retryAfterSeconds: 30,
        retryable: false,
        attemptedModels: [],
        allModelsExhausted: true,
        recommendDemoMode: true,
      });
    }

    const timeoutMs = Math.max(50, options.timeoutMs ?? this.timeoutMs);
    const maxOutputTokens =
      options.maxOutputTokens ?? this.getMaxOutputTokens(options.agentType);
    const mergedConfig = {
      ...(options.config || {}),
      ...(options.config?.maxOutputTokens !== undefined
        ? {}
        : { maxOutputTokens }),
    };

    const startMs = this.now();
    const flightPromise = (async (): Promise<GeminiManagerExecuteResult> => {
      const attemptedModels: string[] = [];
      const failureSummaries: string[] = [];
      let saw429 = false;
      let lastErr: unknown;

      for (let idx = 0; idx < candidatesToTry.length; idx++) {
        const candidateModel = candidatesToTry[idx];
        if (!this.isModelEligible(candidateModel, estTokens)) {
          continue;
        }

        attemptedModels.push(candidateModel);
        const hasMoreCandidates = idx < candidatesToTry.length - 1;

        try {
          // When fallback models exist, do 0 retries on 503 on the current model so we fail over fast
          const response = await this.executeWithBoundedTransientRetry(
            {
              model: candidateModel,
              contents: options.contents,
              config: mergedConfig,
            },
            timeoutMs,
            candidateModel,
            options.generateContent,
            hasMoreCandidates ? 0 : this.maxTransientRetries
          );

          if (options.validateResponse) {
            const check = options.validateResponse(response?.text);
            if (!check.valid) {
              const reason = check.reason || 'Invalid or incomplete model response structure.';
              const nowIso = new Date(this.now()).toISOString();
              this.modelCooldownUntil.set(candidateModel, this.now() + 15_000);
              this.modelLastErrors.set(candidateModel, {
                code: 'INVALID_MODEL_RESPONSE',
                status: 502,
                message: reason,
                timestampIso: nowIso,
                unavailable: false,
              });
              throw new GeminiRequestError({
                message: reason,
                status: 502,
                code: 'INVALID_MODEL_RESPONSE',
                retryable: false,
              });
            }
          }

          if (
            this.enableCache &&
            !options.skipCache &&
            typeof response?.text === 'string' &&
            response.text.trim().length > 0
          ) {
            this.pruneCache(this.now());
            this.cache.set(logicalCacheKey, {
              response,
              modelUsed: candidateModel,
              expiresAtMs: this.now() + this.cacheTtlMs,
            });
          }

          const fallbackUsed =
            attemptedModels.length > 1 || candidateModel !== requestedPrimary;
          const modelFallbackNotice = fallbackUsed
            ? failureSummaries.length > 0
              ? `Routed to '${candidateModel}' after fallback (${failureSummaries.join('; ')}).`
              : `Routed to verified eligible model '${candidateModel}'.`
            : undefined;

          this.recordAttribution({
            timestampIso: new Date(this.now()).toISOString(),
            agentType: options.agentType,
            requestedModel: requestedPrimary,
            modelUsed: candidateModel,
            fallbackUsed,
            attemptedModels: [...attemptedModels],
            status: 'success',
            latencyMs: Math.max(0, this.now() - startMs),
          });

          return {
            response,
            cacheHit: false,
            deduplicated: false,
            modelUsed: candidateModel,
            requestedModel: requestedPrimary,
            attemptedModels,
            fallbackUsed,
            ...(modelFallbackNotice ? { modelFallbackNotice } : {}),
          };
        } catch (err) {
          lastErr = err;
          const status = getErrorStatusCode(err);
          if (status === 429) saw429 = true;
          failureSummaries.push(
            `${candidateModel} (${status ? `HTTP ${status}` : sanitizeModelErrorSummary(err)})`
          );
        }
      }

      this.recordAttribution({
        timestampIso: new Date(this.now()).toISOString(),
        agentType: options.agentType,
        requestedModel: requestedPrimary,
        modelUsed: attemptedModels[attemptedModels.length - 1] || requestedPrimary,
        fallbackUsed: attemptedModels.length > 1,
        attemptedModels: [...attemptedModels],
        status: 'failed',
        latencyMs: Math.max(0, this.now() - startMs),
        errorReason: failureSummaries.join('; '),
      });

      const normalizedLast = normalizeGeminiError(lastErr);
      const finalStatus = saw429 ? 429 : normalizedLast.status;
      const finalCode: NormalizedGeminiErrorCode = saw429
        ? 'QUOTA_EXHAUSTED'
        : normalizedLast.code;

      throw new GeminiRequestError({
        message: `All eligible Gemini models (${attemptedModels.join(', ')}) were quota-limited or unavailable. Automatically entering Demo Mode.`,
        status: finalStatus,
        code: finalCode,
        retryAfterSeconds: normalizedLast.retryAfterSeconds ?? 30,
        retryable: false,
        attemptedModels,
        allModelsExhausted: true,
        recommendDemoMode: true,
        cause: lastErr,
      });
    })();

    this.inFlight.set(logicalCacheKey, flightPromise);
    try {
      return await flightPromise;
    } finally {
      this.inFlight.delete(logicalCacheKey);
    }
  }

  public getDiagnostics(apiKeyConfigured: boolean): GeminiManagerDiagnostics {
    const nowMs = this.now();
    this.pruneCache(nowMs);

    const modelCooldowns: Record<
      string,
      { cooldownRemainingSeconds: number; cooldownUntilIso: string }
    > = {};
    let hasActiveCooldown = false;

    for (const [model, untilMs] of this.modelCooldownUntil.entries()) {
      if (untilMs > nowMs) {
        hasActiveCooldown = true;
        modelCooldowns[model] = {
          cooldownRemainingSeconds: Math.ceil((untilMs - nowMs) / 1000),
          cooldownUntilIso: new Date(untilMs).toISOString(),
        };
      } else {
        this.modelCooldownUntil.delete(model);
      }
    }

    const synthesisChain = apiKeyConfigured
      ? this.getRoutingChainForAgent('code_generation')
      : [];
    const planningChain = apiKeyConfigured
      ? this.getRoutingChainForAgent('data_cleaning')
      : [];

    const currentSelectedModel =
      synthesisChain[0] || this.lastSelectedSynthesisModel || 'gemini-3-flash-preview';
    const lightweightPlanningModel =
      planningChain[0] || this.lastSelectedPlanningModel || 'gemini-3.1-flash-lite';
    const fallbackModelSelected =
      synthesisChain[1] || planningChain[1] || this.lastFallbackModel || 'gemini-3.5-flash-lite';

    let verifiedModelCount = 0;
    for (const status of this.modelAccessStatus.values()) {
      if (status === 'verified') verifiedModelCount += 1;
    }

    const eligibleModelCount = synthesisChain.length;

    let aiServiceStatus: 'available' | 'cooldown' | 'unavailable' | 'unconfigured' = 'available';
    if (!apiKeyConfigured) {
      aiServiceStatus = 'unconfigured';
    } else if (eligibleModelCount === 0) {
      aiServiceStatus = hasActiveCooldown ? 'cooldown' : 'unavailable';
    } else if (hasActiveCooldown && verifiedModelCount === 0) {
      aiServiceStatus = 'cooldown';
    }

    return {
      requestManagerEnabled: true,
      responseCacheEnabled: this.enableCache,
      duplicateRequestGuardEnabled: true,
      timeoutMs: this.timeoutMs,
      maxTransientRetries: this.maxTransientRetries,
      maxOutputTokensByAgent: { ...this.maxOutputTokensByAgent },
      activeCacheEntries: this.cache.size,
      inFlightRequests: this.inFlight.size,
      modelCooldowns,
      aiServiceStatus,
      currentSelectedModel,
      lightweightPlanningModel,
      fallbackModelSelected,
      eligibleModelCount,
      verifiedModelCount,
      recommendDemoMode: !apiKeyConfigured || eligibleModelCount === 0,
      ...(this.lastStartupCheckIso ? { lastStartupCheckIso: this.lastStartupCheckIso } : {}),
      recentAttributions: this.attributionLogs.slice(0, 15),
    };
  }

  public getModelRegistrySnapshot(
    apiKeyConfigured: boolean,
    primaryModel?: string,
    fallbackModel?: string,
    includeAllCandidates: boolean = true
  ): GeminiModelStatusEntry[] {
    const nowMs = this.now();
    const diagnostics = this.getDiagnostics(apiKeyConfigured);
    const lastErrors: Record<
      string,
      {
        code: string;
        message: string;
        status?: number;
        timestampIso: string;
        unavailable?: boolean;
      }
    > = {};
    for (const [model, errInfo] of this.modelLastErrors.entries()) {
      lastErrors[model] = errInfo;
    }

    const accessStatuses: Record<string, ModelAccessVerificationStatus> = {};
    for (const [model, st] of this.modelAccessStatus.entries()) {
      accessStatuses[model] = st;
    }

    const lastSuccesses: Record<string, string> = {};
    for (const [model, iso] of this.modelLastSuccessIso.entries()) {
      lastSuccesses[model] = iso;
    }

    const usageByModel: Record<string, ModelUsageWindow> = {};
    for (const candidate of CANDIDATE_GEMINI_MODELS) {
      usageByModel[candidate.modelId] = this.pruneModelUsage(candidate.modelId, nowMs);
    }

    return buildGeminiModelRegistry({
      apiKeyConfigured,
      primaryModel,
      fallbackModel,
      includeAllCandidates,
      cooldowns: diagnostics.modelCooldowns,
      accessStatuses,
      lastSuccesses,
      usageByModel,
      lastErrors,
      nowMs,
    });
  }
}

export const defaultGeminiRequestManager = new GeminiRequestManager();
