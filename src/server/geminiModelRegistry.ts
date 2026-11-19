export type ModelAvailabilityState =
  | 'available'
  | 'cooldown'
  | 'unavailable'
  | 'unconfigured'
  | 'disabled_paid';

export type ModelAccessVerificationStatus =
  | 'verified'
  | 'unavailable'
  | 'quota_exhausted'
  | 'unsupported'
  | 'disabled_paid'
  | 'not_tested';

export type ModelCapability =
  | 'code_generation'
  | 'code_modification'
  | 'website_generation'
  | 'website_repair'
  | 'document_generation'
  | 'data_cleaning';

export type ModelTier = 'lightweight' | 'standard' | 'strong' | 'paid_disabled';

export interface ModelRateLimits {
  rpm: number;
  tpm: number;
  rpd: number;
}

export interface ModelUsageWindow {
  requestsInLastMinute: number;
  tokensInLastMinute: number;
  requestsToday: number;
}

export interface CandidateModelDefinition {
  modelId: string;
  displayName: string;
  aiStudioLabel: string;
  tier: ModelTier;
  paidOnly: boolean;
  rateLimits: ModelRateLimits;
  recommendedAgents: ModelCapability[];
  capabilities: ModelCapability[];
  notes: string;
}

export interface GeminiModelStatusEntry {
  modelId: string;
  role: 'primary' | 'fallback' | 'disabled';
  displayName: string;
  aiStudioLabel: string;
  tier: ModelTier;
  paidOnly: boolean;
  configured: boolean;
  eligible: boolean;
  availabilityState: ModelAvailabilityState;
  accessStatus: ModelAccessVerificationStatus;
  capabilities: ModelCapability[];
  recommendedAgents: ModelCapability[];
  rateLimits: ModelRateLimits;
  usage: ModelUsageWindow;
  lastSuccessIso?: string;
  lastError?: string;
  lastErrorCode?: string;
  lastErrorStatus?: number;
  retryAfterSeconds?: number;
  retryUntilIso?: string;
  lastUpdatedIso?: string;
  notes?: string;
}

export const ALL_WORKSPACE_CAPABILITIES: ModelCapability[] = [
  'code_generation',
  'code_modification',
  'website_generation',
  'website_repair',
  'document_generation',
  'data_cleaning',
];

/**
 * Complete catalog of candidate Gemini models mapped to Google AI Studio Build Mode
 * and @google/genai v1beta API identifiers.
 * Note: gemini-4-carbon is explicitly marked paidOnly=true and never invoked.
 */
export const CANDIDATE_GEMINI_MODELS: readonly CandidateModelDefinition[] = [
  {
    modelId: 'gemini-3.1-flash-lite',
    displayName: 'Gemini 3.1 Flash Lite',
    aiStudioLabel: 'Gemini 3.1 Flash Lite (Lightweight Primary)',
    tier: 'lightweight',
    paidOnly: false,
    rateLimits: { rpm: 15, tpm: 250_000, rpd: 500 },
    recommendedAgents: ['data_cleaning', 'website_repair', 'document_generation'],
    capabilities: [...ALL_WORKSPACE_CAPABILITIES],
    notes: 'Preferred lightweight model for structured data-cleaning planning, JSX repair, and fast fallback.',
  },
  {
    modelId: 'gemini-3.5-flash-lite',
    displayName: 'Gemini 3.5 Flash Lite',
    aiStudioLabel: 'Gemini 3.5 Flash Lite',
    tier: 'lightweight',
    paidOnly: false,
    rateLimits: { rpm: 15, tpm: 250_000, rpd: 500 },
    recommendedAgents: ['data_cleaning', 'website_repair', 'document_generation', 'code_modification'],
    capabilities: [...ALL_WORKSPACE_CAPABILITIES],
    notes: 'High-speed low-latency Flash-Lite model available in AI Studio Build Mode.',
  },
  {
    modelId: 'gemini-flash-lite-latest',
    displayName: 'Gemini Flash-Lite Latest',
    aiStudioLabel: 'Gemini Flash-Lite Latest',
    tier: 'lightweight',
    paidOnly: false,
    rateLimits: { rpm: 15, tpm: 250_000, rpd: 500 },
    recommendedAgents: ['data_cleaning', 'website_repair', 'document_generation'],
    capabilities: [...ALL_WORKSPACE_CAPABILITIES],
    notes: 'Rolling alias for the latest accessible Flash-Lite model.',
  },
  {
    modelId: 'gemini-3-flash-preview',
    displayName: 'Gemini 3 Flash Preview',
    aiStudioLabel: 'Gemini 3 Flash (gemini-3-flash-preview)',
    tier: 'strong',
    paidOnly: false,
    rateLimits: { rpm: 10, tpm: 250_000, rpd: 250 },
    recommendedAgents: ['code_generation', 'code_modification', 'website_generation', 'document_generation'],
    capabilities: [...ALL_WORKSPACE_CAPABILITIES],
    notes: 'High-capability synthesis model for multi-file code, React/Vite websites, and technical documents.',
  },
  {
    modelId: 'gemini-4-hydrogen',
    displayName: 'Gemini 4 Hydrogen (Primary Economical)',
    aiStudioLabel: 'Default (Gemini 4 Hydrogen)',
    tier: 'strong',
    paidOnly: false,
    rateLimits: { rpm: 10, tpm: 250_000, rpd: 250 },
    recommendedAgents: ['code_generation', 'code_modification', 'website_generation', 'document_generation'],
    capabilities: [...ALL_WORKSPACE_CAPABILITIES],
    notes: 'Default AI Studio Build Mode synthesis model; automatically fails over on HTTP 503 high demand.',
  },
  {
    modelId: 'gemini-3.8-flash',
    displayName: 'Gemini 3.8 Flash',
    aiStudioLabel: 'Gemini 3.8 Flash',
    tier: 'strong',
    paidOnly: false,
    rateLimits: { rpm: 10, tpm: 250_000, rpd: 250 },
    recommendedAgents: ['code_generation', 'website_generation', 'document_generation'],
    capabilities: [...ALL_WORKSPACE_CAPABILITIES],
    notes: 'Full Flash synthesis model; routes to verified fallbacks during temporary 503 load spikes.',
  },
  {
    modelId: 'gemini-flash-latest',
    displayName: 'Gemini Flash Latest',
    aiStudioLabel: 'Gemini Flash Latest',
    tier: 'standard',
    paidOnly: false,
    rateLimits: { rpm: 10, tpm: 250_000, rpd: 250 },
    recommendedAgents: ['code_generation', 'website_generation', 'document_generation'],
    capabilities: [...ALL_WORKSPACE_CAPABILITIES],
    notes: 'Rolling alias for the latest Flash model in AI Studio.',
  },
  {
    modelId: 'gemini-4-argon',
    displayName: 'Gemini 4 Argon (Complex Reasoning)',
    aiStudioLabel: 'Gemini 4 Argon',
    tier: 'strong',
    paidOnly: false,
    rateLimits: { rpm: 5, tpm: 250_000, rpd: 50 },
    recommendedAgents: ['code_generation', 'website_generation'],
    capabilities: [...ALL_WORKSPACE_CAPABILITIES],
    notes: 'Deep reasoning model; automatically bypassed when free-tier quota is 0 (HTTP 429).',
  },
  {
    modelId: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    aiStudioLabel: 'Gemini 2.5 Flash (Legacy Candidate)',
    tier: 'standard',
    paidOnly: false,
    rateLimits: { rpm: 10, tpm: 250_000, rpd: 250 },
    recommendedAgents: ['code_generation', 'website_generation', 'document_generation'],
    capabilities: [...ALL_WORKSPACE_CAPABILITIES],
    notes: 'Legacy candidate; marked unsupported if runtime returns HTTP 404 for newer API keys.',
  },
  {
    modelId: 'gemini-2.5-flash-lite',
    displayName: 'Gemini 2.5 Flash Lite',
    aiStudioLabel: 'Gemini 2.5 Flash Lite (Legacy Candidate)',
    tier: 'lightweight',
    paidOnly: false,
    rateLimits: { rpm: 15, tpm: 250_000, rpd: 500 },
    recommendedAgents: ['data_cleaning', 'website_repair'],
    capabilities: [...ALL_WORKSPACE_CAPABILITIES],
    notes: 'Legacy candidate; marked unsupported if runtime returns HTTP 404 in favor of gemini-3.5-flash-lite.',
  },
  {
    modelId: 'gemini-4-carbon',
    displayName: 'Gemini 4 Carbon (Paid — Do Not Use)',
    aiStudioLabel: 'Gemini 4 Carbon (Paid — Disabled)',
    tier: 'paid_disabled',
    paidOnly: true,
    rateLimits: { rpm: 0, tpm: 0, rpd: 0 },
    recommendedAgents: [],
    capabilities: [],
    notes: 'Strictly disabled by cost-control policy (paid-only model). Never probed or selected.',
  },
];

export const CANDIDATE_MODEL_MAP: ReadonlyMap<string, CandidateModelDefinition> = new Map(
  CANDIDATE_GEMINI_MODELS.map((m) => [m.modelId, m])
);

/**
 * Default preference chains by task complexity:
 * - Lightweight structured planning (`data_cleaning`, `website_repair`) prefers Gemini 3.1 Flash Lite & 3.5 Flash Lite first.
 * - Heavy multi-file synthesis (`code_generation`, `code_modification`, `website_generation`, `document_generation`)
 *   prefers stronger verified synthesis models (`gemini-3-flash-preview`, `gemini-4-hydrogen`, `gemini-3.8-flash`)
 *   followed by fast verified Flash-Lite models (`gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-flash-lite-latest`).
 */
export const DEFAULT_ROUTING_ORDER_BY_AGENT: Record<ModelCapability, string[]> = {
  data_cleaning: [
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-3-flash-preview',
    'gemini-4-hydrogen',
    'gemini-3.8-flash',
    'gemini-flash-latest',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-4-argon',
  ],
  website_repair: [
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-3-flash-preview',
    'gemini-4-hydrogen',
    'gemini-3.8-flash',
    'gemini-flash-latest',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
  ],
  code_generation: [
    'gemini-3-flash-preview',
    'gemini-4-hydrogen',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-3.8-flash',
    'gemini-flash-latest',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-4-argon',
  ],
  code_modification: [
    'gemini-3-flash-preview',
    'gemini-4-hydrogen',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-3.8-flash',
    'gemini-flash-latest',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-4-argon',
  ],
  website_generation: [
    'gemini-3-flash-preview',
    'gemini-4-hydrogen',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-3.8-flash',
    'gemini-flash-latest',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-4-argon',
  ],
  document_generation: [
    'gemini-3-flash-preview',
    'gemini-4-hydrogen',
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-3.8-flash',
    'gemini-flash-latest',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-4-argon',
  ],
};

export interface ModelRegistrySnapshotOptions {
  apiKeyConfigured: boolean;
  primaryModel?: string;
  fallbackModel?: string;
  includeAllCandidates?: boolean;
  cooldowns?: Record<string, { cooldownRemainingSeconds: number; cooldownUntilIso: string }>;
  accessStatuses?: Record<string, ModelAccessVerificationStatus>;
  lastSuccesses?: Record<string, string>;
  usageByModel?: Record<string, ModelUsageWindow>;
  lastErrors?: Record<
    string,
    {
      code: string;
      message: string;
      status?: number;
      timestampIso: string;
      unavailable?: boolean;
    }
  >;
  nowMs?: number;
}

export function getCandidateModelMetadata(modelId: string): CandidateModelDefinition {
  const existing = CANDIDATE_MODEL_MAP.get(modelId);
  if (existing) return existing;
  return {
    modelId,
    displayName: modelId,
    aiStudioLabel: modelId,
    tier: 'standard',
    paidOnly: modelId === 'gemini-4-carbon',
    rateLimits: { rpm: 10, tpm: 250_000, rpd: 250 },
    recommendedAgents: [...ALL_WORKSPACE_CAPABILITIES],
    capabilities: [...ALL_WORKSPACE_CAPABILITIES],
    notes: 'Custom or environment-specified Gemini model.',
  };
}

/**
 * Builds a secret-free model registry status report combining candidate model metadata,
 * runtime verification status, rate-limit counters, cooldowns, and last error/success timestamps.
 */
export function buildGeminiModelRegistry(
  options: ModelRegistrySnapshotOptions
): GeminiModelStatusEntry[] {
  const seen = new Set<string>();
  const orderedIds: Array<{ id: string; role: 'primary' | 'fallback' | 'disabled' }> = [];

  if (options.primaryModel && options.primaryModel.trim()) {
    const id = options.primaryModel.trim();
    seen.add(id);
    orderedIds.push({ id, role: 'primary' });
  }

  if (
    options.fallbackModel &&
    options.fallbackModel.trim() &&
    !seen.has(options.fallbackModel.trim())
  ) {
    const id = options.fallbackModel.trim();
    seen.add(id);
    orderedIds.push({ id, role: 'fallback' });
  }

  const includeAll = options.includeAllCandidates ?? true;
  if (includeAll) {
    for (const candidate of CANDIDATE_GEMINI_MODELS) {
      if (!seen.has(candidate.modelId)) {
        seen.add(candidate.modelId);
        orderedIds.push({
          id: candidate.modelId,
          role: candidate.paidOnly
            ? 'disabled'
            : orderedIds.length === 0
            ? 'primary'
            : 'fallback',
        });
      }
    }
  }

  return orderedIds.map(({ id, role }) => {
    const meta = getCandidateModelMetadata(id);
    const cooldown = options.cooldowns?.[id];
    const lastErr = options.lastErrors?.[id];
    const lastSuccessIso = options.lastSuccesses?.[id];
    const usage = options.usageByModel?.[id] || {
      requestsInLastMinute: 0,
      tokensInLastMinute: 0,
      requestsToday: 0,
    };

    let accessStatus: ModelAccessVerificationStatus =
      options.accessStatuses?.[id] || (meta.paidOnly ? 'disabled_paid' : 'not_tested');

    if (meta.paidOnly) {
      accessStatus = 'disabled_paid';
    } else if (!options.accessStatuses?.[id]) {
      if (lastErr?.status === 404 || lastErr?.code === 'MODEL_UNSUPPORTED') {
        accessStatus = 'unsupported';
      } else if (lastErr?.status === 429 || lastErr?.code === 'QUOTA_EXHAUSTED') {
        accessStatus = 'quota_exhausted';
      } else if (lastErr?.unavailable) {
        accessStatus = 'unavailable';
      } else if (lastSuccessIso) {
        accessStatus = 'verified';
      }
    }

    let availabilityState: ModelAvailabilityState = 'available';
    let eligible = true;

    const rateLimitReached =
      !meta.paidOnly &&
      (usage.requestsInLastMinute >= meta.rateLimits.rpm ||
        usage.tokensInLastMinute >= meta.rateLimits.tpm ||
        usage.requestsToday >= meta.rateLimits.rpd);

    if (meta.paidOnly || accessStatus === 'disabled_paid') {
      availabilityState = 'disabled_paid';
      eligible = false;
    } else if (!options.apiKeyConfigured) {
      availabilityState = 'unconfigured';
      eligible = false;
    } else if (accessStatus === 'unsupported') {
      availabilityState = 'unavailable';
      eligible = false;
    } else if ((cooldown && cooldown.cooldownRemainingSeconds > 0) || rateLimitReached) {
      availabilityState = 'cooldown';
      eligible = false;
    } else if (lastErr?.unavailable || accessStatus === 'unavailable') {
      availabilityState = 'unavailable';
      eligible = false;
    }

    return {
      modelId: id,
      role: meta.paidOnly ? 'disabled' : role,
      displayName: meta.displayName,
      aiStudioLabel: meta.aiStudioLabel,
      tier: meta.tier,
      paidOnly: meta.paidOnly,
      configured: options.apiKeyConfigured && !meta.paidOnly,
      eligible,
      availabilityState,
      accessStatus,
      capabilities: [...meta.capabilities],
      recommendedAgents: [...meta.recommendedAgents],
      rateLimits: { ...meta.rateLimits },
      usage,
      notes: meta.notes,
      ...(lastSuccessIso ? { lastSuccessIso } : {}),
      ...(lastErr
        ? {
            lastError: lastErr.message,
            lastErrorCode: lastErr.code,
            ...(lastErr.status ? { lastErrorStatus: lastErr.status } : {}),
            lastUpdatedIso: lastErr.timestampIso,
          }
        : {}),
      ...(cooldown && cooldown.cooldownRemainingSeconds > 0
        ? {
            retryAfterSeconds: cooldown.cooldownRemainingSeconds,
            retryUntilIso: cooldown.cooldownUntilIso,
          }
        : {}),
    };
  });
}
