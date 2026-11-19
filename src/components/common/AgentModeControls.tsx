import React, { useEffect, useState } from 'react';
import { AlertTriangle, Cpu, FlaskConical, RefreshCw, Sparkles, X } from 'lucide-react';
import { AgentExecutionMode } from '../../utils/demoModeEngine';
import { ParsedAiErrorInfo } from '../../lib/aiClient';

interface AgentModeBarProps {
  mode: AgentExecutionMode;
  onModeChange: (mode: AgentExecutionMode) => void;
  modelLabel?: string;
  agentRole?: 'synthesis' | 'lightweight';
  disabled?: boolean;
  accentColor?: 'violet' | 'indigo' | 'emerald';
}

/**
 * Shared Live AI vs Demo Mode selector rendered across all 4 agents.
 * Guarantees users always know whether Gemini Live AI or Offline Demo Mode is executing.
 */
export const AgentModeBar: React.FC<AgentModeBarProps> = ({
  mode,
  onModeChange,
  modelLabel,
  agentRole = 'synthesis',
  disabled = false,
  accentColor = 'violet',
}) => {
  const [passiveStatus, setPassiveStatus] = useState<'available' | 'cooldown' | 'unconfigured' | null>(null);
  const [serverSelectedModel, setServerSelectedModel] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!active || !data) return;
        const st = data.aiServiceStatus;
        if (st === 'available' || st === 'cooldown' || st === 'unconfigured') {
          setPassiveStatus(st);
        }
        const dynamicModel =
          agentRole === 'lightweight'
            ? data.lightweightPlanningModel || data.currentSelectedModel
            : data.currentSelectedModel || data.primaryModel;
        if (typeof dynamicModel === 'string' && dynamicModel.trim()) {
          setServerSelectedModel(dynamicModel.trim());
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [agentRole]);

  const displayedModel =
    modelLabel ||
    serverSelectedModel ||
    (agentRole === 'lightweight' ? 'gemini-3.1-flash-lite' : 'gemini-3-flash-preview');

  const activeColorClass =
    accentColor === 'emerald'
      ? 'bg-emerald-600 text-white shadow-sm'
      : accentColor === 'indigo'
      ? 'bg-indigo-600 text-white shadow-sm'
      : 'bg-violet-600 text-white shadow-sm';

  return (
    <div
      data-testid="agent-mode-bar"
      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-xl bg-[#111116] border border-zinc-800/80"
    >
      <div className="flex items-center gap-2 text-xs min-w-0">
        {mode === 'live' ? (
          <>
            <Cpu size={14} className="text-violet-400 shrink-0" />
            <span className="font-semibold text-zinc-100" data-testid="active-mode-badge">
              LIVE AI MODE
            </span>
            <span
              data-testid="active-model-label"
              className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-300 truncate"
            >
              {displayedModel}
            </span>
            {passiveStatus && (
              <span
                data-testid="passive-model-status"
                className={`px-2 py-0.5 rounded border text-[10px] font-mono uppercase shrink-0 ${
                  passiveStatus === 'available'
                    ? 'bg-emerald-950/50 border-emerald-500/30 text-emerald-300'
                    : passiveStatus === 'cooldown'
                    ? 'bg-amber-950/50 border-amber-500/30 text-amber-300'
                    : 'bg-zinc-900 border-zinc-700 text-zinc-400'
                }`}
              >
                {passiveStatus === 'available'
                  ? 'Multi-Model Router Ready'
                  : passiveStatus === 'cooldown'
                  ? 'Cooldown'
                  : 'Demo Recommended'}
              </span>
            )}
          </>
        ) : (
          <>
            <FlaskConical size={14} className="text-amber-400 shrink-0" />
            <span className="font-semibold text-amber-300" data-testid="active-mode-badge">
              DEMO MODE (Offline)
            </span>
            <span className="text-[11px] text-zinc-400 truncate">
              Deterministic local templates — zero Gemini API calls used
            </span>
          </>
        )}
      </div>

      <div
        role="group"
        aria-label="Execution mode"
        className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#09090b] border border-zinc-800 self-start sm:self-auto shrink-0"
      >
        <button
          type="button"
          data-testid="mode-toggle-live"
          disabled={disabled}
          onClick={() => onModeChange('live')}
          className={`px-3 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 ${
            mode === 'live' ? activeColorClass : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Sparkles size={12} />
          <span>Live AI</span>
        </button>
        <button
          type="button"
          data-testid="mode-toggle-demo"
          disabled={disabled}
          onClick={() => onModeChange('demo')}
          className={`px-3 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 ${
            mode === 'demo'
              ? 'bg-amber-600 text-white shadow-sm'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          <FlaskConical size={12} />
          <span>Demo Mode</span>
        </button>
      </div>
    </div>
  );
};

interface AiUnavailableBannerProps {
  errorInfo: ParsedAiErrorInfo;
  onRetryLive: () => void;
  onSwitchToDemoAndRun?: () => void;
  onDismiss: () => void;
  isBusy?: boolean;
}

/**
 * Recovery banner displayed on Live AI 429 quota, 503 unavailable, or timeout errors.
 * Preserves all user inputs/uploads and provides cooldown-guarded Retry + 1-click Demo Mode switch.
 */
export const AiUnavailableBanner: React.FC<AiUnavailableBannerProps> = ({
  errorInfo,
  onRetryLive,
  onSwitchToDemoAndRun,
  onDismiss,
  isBusy = false,
}) => {
  const [secondsLeft, setSecondsLeft] = useState<number>(errorInfo.retryAfterSeconds ?? 0);

  useEffect(() => {
    setSecondsLeft(errorInfo.retryAfterSeconds ?? 0);
  }, [errorInfo]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [secondsLeft > 0]);

  return (
    <div
      role="alert"
      data-testid="ai-unavailable-banner"
      className="p-4 rounded-xl bg-amber-950/35 border border-amber-500/40 text-amber-100 text-xs space-y-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-semibold text-amber-200">
              {errorInfo.allModelsExhausted
                ? 'All Eligible Gemini Models Unavailable or Quota-Limited — Demo Mode Activated'
                : errorInfo.code === 'QUOTA_EXHAUSTED' || errorInfo.status === 429
                ? 'Live AI Quota Reached (HTTP 429) — Inputs Preserved'
                : errorInfo.status === 504 || errorInfo.code === 'AI_TIMEOUT'
                ? 'Live AI Request Timed Out — Inputs Preserved'
                : 'Live AI Temporarily Unavailable — Inputs Preserved'}
            </div>
            <p className="text-zinc-300 leading-relaxed">{errorInfo.message}</p>
            {errorInfo.attemptedModels && errorInfo.attemptedModels.length > 0 && (
              <p className="text-[11px] font-mono text-amber-300/90">
                Attempted models: {errorInfo.attemptedModels.join(' → ')}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-amber-300 hover:text-white p-1"
          aria-label="Dismiss alert"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="retry-live-ai-button"
          disabled={isBusy || secondsLeft > 0}
          onClick={onRetryLive}
          className="px-3.5 py-1.5 rounded-lg border border-zinc-700 bg-[#09090b] hover:bg-zinc-900 text-zinc-200 text-xs font-medium inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw size={12} />
          <span>
            {secondsLeft > 0 ? `Retry Live AI (${secondsLeft}s)` : 'Retry Live AI'}
          </span>
        </button>

        {onSwitchToDemoAndRun && (
          <button
            type="button"
            data-testid="switch-to-demo-button"
            disabled={isBusy}
            onClick={onSwitchToDemoAndRun}
            className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
          >
            <FlaskConical size={13} />
            <span>Switch to Demo Mode</span>
          </button>
        )}
      </div>
    </div>
  );
};
