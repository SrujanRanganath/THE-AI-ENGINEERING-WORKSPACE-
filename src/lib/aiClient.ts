import { auth } from './firebase';

let memorySessionId: string | null = null;

function getWorkspaceSessionId(): string {
  if (memorySessionId) return memorySessionId;
  const fallback = `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      const existing = window.sessionStorage.getItem('ws_ai_session_id');
      if (existing) {
        memorySessionId = existing;
        return existing;
      }
      window.sessionStorage.setItem('ws_ai_session_id', fallback);
    } catch {
      // Ignore storage access restriction
    }
  }
  memorySessionId = fallback;
  return fallback;
}

/**
 * Builds request headers for AI endpoints including verified Firebase ID token (when signed in)
 * and a stable per-tab workspace session identifier so server-side caches and duplicate guards
 * stay strictly isolated per user/session.
 */
export async function getAiRequestHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Workspace-Session': getWorkspaceSessionId(),
  };
  if (auth.currentUser) {
    try {
      const idToken = await auth.currentUser.getIdToken();
      if (idToken) {
        headers.Authorization = `Bearer ${idToken}`;
      }
    } catch {
      // Proceed with session scope if ID token fetch fails
    }
  }
  return headers;
}

export interface ParsedAiErrorInfo {
  message: string;
  code?: string;
  status: number;
  retryAfterSeconds?: number;
  demoModeAvailable: boolean;
  isQuotaOrTransient: boolean;
  attemptedModels?: string[];
  allModelsExhausted?: boolean;
  recommendDemoMode?: boolean;
}

export function parseAiFailure(
  status: number,
  payload: Record<string, any> | null | undefined,
  fallbackMessage: string
): ParsedAiErrorInfo {
  const code = typeof payload?.code === 'string' ? payload.code : undefined;
  const retryAfterSeconds =
    typeof payload?.retryAfterSeconds === 'number' && payload.retryAfterSeconds > 0
      ? Math.ceil(payload.retryAfterSeconds)
      : status === 429
      ? 30
      : status === 503 || status === 504
      ? 10
      : undefined;

  const allModelsExhausted = Boolean(payload?.allModelsExhausted);
  const recommendDemoMode = Boolean(payload?.recommendDemoMode || allModelsExhausted);
  const attemptedModels = Array.isArray(payload?.attemptedModels)
    ? payload.attemptedModels.map((m: any) => String(m))
    : undefined;

  const isQuotaOrTransient =
    status === 429 ||
    status === 503 ||
    status === 504 ||
    code === 'QUOTA_EXHAUSTED' ||
    code === 'MODEL_UNAVAILABLE' ||
    code === 'AI_TIMEOUT' ||
    allModelsExhausted;

  const defaultMsgByStatus =
    status === 429
      ? 'Live Gemini API quota or rate limit was reached (HTTP 429). Your inputs are preserved—retry after cooldown or switch to Demo Mode.'
      : status === 503
      ? 'Live Gemini AI is temporarily unavailable (HTTP 503). Your inputs are preserved—retry shortly or switch to Demo Mode.'
      : status === 504
      ? 'Live Gemini request timed out (HTTP 504). Your inputs are preserved—retry or switch to Demo Mode.'
      : fallbackMessage;

  return {
    message: (typeof payload?.error === 'string' && payload.error.trim()) || defaultMsgByStatus,
    code,
    status,
    retryAfterSeconds,
    demoModeAvailable: payload?.demoModeAvailable !== false,
    isQuotaOrTransient,
    attemptedModels,
    allModelsExhausted,
    recommendDemoMode,
  };
}

