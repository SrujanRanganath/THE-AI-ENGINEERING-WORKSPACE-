import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../lib/authContext';
import { useGuidedTour } from '../../lib/guidedTour';
import { db } from '../../lib/firebase';
import {
  Settings,
  Database,
  Cpu,
  CheckCircle2,
  Save,
  AlertCircle,
  Mail,
  Compass,
  RotateCcw,
  RefreshCw,
  ShieldCheck,
  Activity,
} from 'lucide-react';

interface CandidateModelStatus {
  modelId: string;
  displayName: string;
  tier: string;
  role: string;
  paidOnly: boolean;
  accessStatus: string;
  availabilityState: string;
  eligible: boolean;
  retryAfterSeconds?: number;
  rateLimits?: { rpm: number; tpm: number; rpd: number };
  usage?: { requestsInLastMinute: number; tokensInLastMinute: number; requestsToday: number };
  lastSuccessIso?: string;
  lastError?: string;
  lastErrorStatus?: number;
  recommendedAgents?: string[];
  notes?: string;
}

interface SystemHealthInfo {
  status: string;
  service?: string;
  primaryModel: string;
  websiteGeneratorModel?: string;
  currentSelectedModel?: string;
  fallbackModelSelected?: string | null;
  lightweightPlanningModel?: string;
  hasGeminiKey: boolean;
  emailDeliveryConfigured: boolean;
  emailProvider: string;
  aiServiceStatus?: string;
  verifiedAccessibleModels?: string[];
  coolingDownModels?: string[];
  lastSuccessfulModelRequest?: {
    modelId: string;
    agent: string;
    timestamp: string;
    fallbackUsed: boolean;
  } | null;
  lastFailureReason?: string | null;
  modelRegistry?: CandidateModelStatus[];
}

export const SettingsPage: React.FC = () => {
  const { currentUser, updateUserProfile } = useAuth();
  const { startTour, resetTourPreferences, preferences } = useGuidedTour();
  const [displayName, setDisplayName] = useState(currentUser?.displayName || '');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<SystemHealthInfo | null>(null);
  const [verifyingModels, setVerifyingModels] = useState(false);

  const loadSystemAndModelStatus = useCallback(async () => {
    try {
      const [healthRes, modelsRes] = await Promise.all([
        fetch('/api/health').then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch('/api/ai/models/status').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (healthRes || modelsRes) {
        setHealth({
          ...(healthRes || {}),
          ...(modelsRes || {}),
          modelRegistry: modelsRes?.models || healthRes?.modelRegistry || [],
        });
      }
    } catch {
      // Ignore network errors
    }
  }, []);

  useEffect(() => {
    void loadSystemAndModelStatus();
  }, [loadSystemAndModelStatus]);

  const handleVerifyModels = async () => {
    setVerifyingModels(true);
    try {
      const res = await fetch('/api/ai/models/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: false }),
      });
      if (res.ok) {
        const data = await res.json();
        setHealth((prev) =>
          prev
            ? {
                ...prev,
                ...data,
                modelRegistry: data.models || prev.modelRegistry,
              }
            : data
        );
      }
    } catch {
      // Ignore verification trigger error
    } finally {
      setVerifyingModels(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await updateUserProfile(displayName.trim());
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to update profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-tour="settings-overview" className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="pb-4 border-b border-zinc-800/80">
        <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-violet-400 mb-1">
          <Settings size={15} />
          <span>System & Account</span>
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
          Workspace Settings
        </h2>
        <p className="text-xs text-zinc-400 mt-1">
          Manage your developer profile, guided onboarding preferences, and inspect the live Gemini multi-model registry and routing status.
        </p>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-rose-950/40 border border-rose-500/30 text-rose-200 text-xs flex items-center gap-2.5">
          <AlertCircle size={16} className="text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="p-3.5 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-emerald-200 text-xs flex items-center gap-2.5">
          <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
          <span>Profile updated successfully.</span>
        </div>
      )}

      {/* Profile Card */}
      <div className="p-6 rounded-2xl bg-[#111116] border border-zinc-800/80 space-y-5">
        <div className="flex items-center gap-3.5 border-b border-zinc-800/80 pb-4">
          <div className="w-11 h-11 rounded-xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-base font-bold text-violet-300">
            {currentUser?.displayName ? currentUser.displayName[0].toUpperCase() : 'E'}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">
              {currentUser?.displayName || 'Engineer'}
            </h3>
            <p className="text-xs text-zinc-400 font-mono">{currentUser?.email || 'guest@workspace'}</p>
          </div>
        </div>

        <form onSubmit={handleSaveProfile} className="space-y-4 max-w-md">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-200 text-xs focus:outline-none focus:border-violet-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Email Address</label>
            <input
              type="text"
              value={currentUser?.email || ''}
              disabled
              className="w-full px-3 py-2 rounded-lg bg-[#09090b]/60 border border-zinc-800/60 text-zinc-500 text-xs cursor-not-allowed font-mono"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            <Save size={14} />
            <span>{saving ? 'Saving...' : 'Save Profile Changes'}</span>
          </button>
        </form>
      </div>

      {/* Onboarding & Guided Tour Controls */}
      <div className="p-6 rounded-2xl bg-[#111116] border border-zinc-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-violet-400">
            <Compass size={15} />
            <span>Interactive Workspace Walkthrough</span>
          </div>
          <h3 className="text-sm font-semibold text-white">9-Step Guided Tour</h3>
          <p className="text-xs text-zinc-400 max-w-xl">
            Current onboarding status:{' '}
            <span className="font-mono text-zinc-200">
              {preferences.tourCompleted
                ? 'Completed'
                : preferences.tourSkipped
                ? 'Skipped'
                : 'Active for first visit'}
            </span>
            . Restart the step-by-step tour across all studios anytime.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void resetTourPreferences().then(() => startTour(0))}
            data-testid="settings-restart-tour-button"
            className="px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <RotateCcw size={13} />
            <span>Restart Guided Tour</span>
          </button>
        </div>
      </div>

      {/* Administrator Gemini Model Registry & Intelligent Routing Status */}
      <div
        data-testid="admin-model-registry-panel"
        className="p-6 rounded-2xl bg-[#111116] border border-zinc-800/80 space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-violet-400">
              <Activity size={15} />
              <span>Administrator Model Status & Intelligent Routing</span>
            </div>
            <h3 className="text-sm font-semibold text-white">
              Centralized Gemini Model Registry
            </h3>
            <p className="text-xs text-zinc-400">
              Live API capability verification, RPM/TPM/RPD rate-limit windows, automatic cooldown failover, and per-agent routing attribution. Secret keys are strictly server-isolated.
            </p>
          </div>
          <button
            type="button"
            data-testid="verify-models-button"
            disabled={verifyingModels}
            onClick={() => void handleVerifyModels()}
            className="px-3.5 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs font-medium inline-flex items-center gap-1.5 transition-colors self-start sm:self-auto shrink-0 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={13} className={verifyingModels ? 'animate-spin' : ''} />
            <span>{verifyingModels ? 'Verifying Models...' : 'Refresh Model Status'}</span>
          </button>
        </div>

        {/* Summary Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-xl bg-[#09090b] border border-zinc-800/80 space-y-1">
            <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              Current Selected Model
            </div>
            <div
              data-testid="status-current-selected-model"
              className="text-xs font-mono font-semibold text-emerald-400 truncate"
            >
              {health?.currentSelectedModel || health?.primaryModel || 'gemini-3-flash-preview'}
            </div>
            <div className="text-[11px] text-zinc-500 truncate">
              Planning: {health?.lightweightPlanningModel || 'gemini-3.1-flash-lite'}
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#09090b] border border-zinc-800/80 space-y-1">
            <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              Fallback Model Selected
            </div>
            <div
              data-testid="status-fallback-model"
              className="text-xs font-mono font-semibold text-violet-300 truncate"
            >
              {health?.fallbackModelSelected || 'gemini-3.5-flash-lite'}
            </div>
            <div className="text-[11px] text-zinc-500 truncate">
              Verified Accessible: {health?.verifiedAccessibleModels?.length ?? 0} models
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#09090b] border border-zinc-800/80 space-y-1">
            <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              Last Successful Request
            </div>
            <div
              data-testid="status-last-success"
              className="text-xs font-mono font-semibold text-zinc-200 truncate"
            >
              {health?.lastSuccessfulModelRequest
                ? `${health.lastSuccessfulModelRequest.modelId} (${health.lastSuccessfulModelRequest.agent})`
                : 'Ready — No live call in session yet'}
            </div>
            <div className="text-[11px] text-zinc-500 truncate">
              Cooling Down:{' '}
              {health?.coolingDownModels && health.coolingDownModels.length > 0
                ? health.coolingDownModels.join(', ')
                : 'None'}
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#09090b] border border-zinc-800/80 space-y-1">
            <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              Last Failure Reason
            </div>
            <div
              data-testid="status-last-failure"
              className="text-xs font-mono text-amber-300/90 truncate"
              title={health?.lastFailureReason || 'None'}
            >
              {health?.lastFailureReason || 'None'}
            </div>
            <div className="text-[11px] text-zinc-500 truncate">
              API Credential: {health?.hasGeminiKey ? 'Configured (Server Proxy)' : 'Demo Mode Only'}
            </div>
          </div>
        </div>

        {/* Verified Accessible Models Badges */}
        {health?.verifiedAccessibleModels && health.verifiedAccessibleModels.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[11px] font-mono text-zinc-400 flex items-center gap-1">
              <ShieldCheck size={13} className="text-emerald-400" />
              <span>Models Verified Accessible:</span>
            </span>
            {health.verifiedAccessibleModels.map((mId) => (
              <span
                key={mId}
                data-testid={`verified-model-badge-${mId}`}
                className="px-2 py-0.5 rounded-md bg-emerald-950/50 border border-emerald-500/30 text-emerald-300 font-mono text-[11px]"
              >
                {mId}
              </span>
            ))}
          </div>
        )}

        {/* Candidate Model Registry Table */}
        <div className="overflow-x-auto rounded-xl border border-zinc-800/80 bg-[#09090b]">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/60 text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                <th className="py-2.5 px-3">Model ID & Name</th>
                <th className="py-2.5 px-3">API Access Status</th>
                <th className="py-2.5 px-3">Health / Cooldown</th>
                <th className="py-2.5 px-3">Rate Limits (RPM / TPM / RPD)</th>
                <th className="py-2.5 px-3">Recommended Agent Assignment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-mono text-[11px]">
              {(health?.modelRegistry || []).map((entry) => {
                const accessBadgeClass =
                  entry.accessStatus === 'verified'
                    ? 'bg-emerald-950/60 border-emerald-500/30 text-emerald-300'
                    : entry.accessStatus === 'unavailable'
                    ? 'bg-amber-950/60 border-amber-500/30 text-amber-300'
                    : entry.accessStatus === 'quota_exhausted'
                    ? 'bg-rose-950/60 border-rose-500/30 text-rose-300'
                    : entry.accessStatus === 'disabled_paid'
                    ? 'bg-zinc-900 border-zinc-700 text-zinc-500'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-400';

                return (
                  <tr key={entry.modelId} className="hover:bg-zinc-900/30">
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-zinc-200">{entry.modelId}</div>
                      <div className="text-[10px] text-zinc-500 font-sans">{entry.displayName}</div>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`inline-block px-2 py-0.5 rounded border text-[10px] uppercase ${accessBadgeClass}`}>
                        {entry.accessStatus || entry.availabilityState}
                      </span>
                      {entry.lastErrorStatus && (
                        <span className="ml-1.5 text-[10px] text-zinc-500">
                          HTTP {entry.lastErrorStatus}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={
                          entry.availabilityState === 'available'
                            ? 'text-emerald-400'
                            : entry.availabilityState === 'cooldown'
                            ? 'text-amber-400'
                            : 'text-zinc-500'
                        }
                      >
                        {entry.availabilityState}
                        {entry.retryAfterSeconds && entry.retryAfterSeconds > 0
                          ? ` (${entry.retryAfterSeconds}s)`
                          : ''}
                      </span>
                      {entry.lastError && (
                        <div
                          className="text-[10px] text-zinc-500 truncate max-w-[210px] font-sans"
                          title={entry.lastError}
                        >
                          {entry.lastError}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-zinc-300">
                      {entry.paidOnly ? (
                        <span className="text-zinc-500">Paid Only — Disabled</span>
                      ) : (
                        <div>
                          <div>
                            {entry.usage?.requestsInLastMinute ?? 0}/{entry.rateLimits?.rpm ?? 15} RPM ·{' '}
                            {entry.usage?.requestsToday ?? 0}/{entry.rateLimits?.rpd ?? 500} RPD
                          </div>
                          <div className="text-[10px] text-zinc-500">
                            TPM Limit: {(((entry.rateLimits?.tpm ?? 250000) / 1000)).toFixed(0)}K
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-zinc-300 font-sans text-[11px]">
                      {entry.recommendedAgents && entry.recommendedAgents.length > 0
                        ? entry.recommendedAgents.join(', ')
                        : entry.role}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cloud & AI Infrastructure Status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Firebase Config Card */}
        <div className="p-5 rounded-2xl bg-[#111116] border border-zinc-800/80 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
            <Database size={15} />
            <span>Firebase Firestore & Auth</span>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Connected to your provisioned Firestore instance with owner-scoped access control.
          </p>
          <div className="p-3 rounded-lg bg-[#09090b] border border-zinc-800/80 space-y-1.5 font-mono text-[11px]">
            <div className="text-zinc-300 truncate">
              <span className="text-zinc-500">Project:</span>{' '}
              {db.app.options.projectId || 'omega-ripsaw-l7c1c'}
            </div>
            <div className="text-zinc-300 truncate">
              <span className="text-zinc-500">UID:</span> {currentUser?.uid || 'guest_session'}
            </div>
          </div>
        </div>

        {/* Gemini API Card */}
        <div className="p-5 rounded-2xl bg-[#111116] border border-zinc-800/80 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-violet-400">
            <Cpu size={15} />
            <span>Server-Side Gemini Proxy</span>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            All AI synthesis routes execute via Express server endpoints so API keys never enter browser bundles.
          </p>
          <div className="p-3 rounded-lg bg-[#09090b] border border-zinc-800/80 space-y-1.5 font-mono text-[11px]">
            <div className="text-zinc-300">
              <span className="text-zinc-500">Synthesis Model:</span>{' '}
              {health?.currentSelectedModel || health?.primaryModel || 'gemini-3-flash-preview'}
            </div>
            <div className="text-zinc-300">
              <span className="text-zinc-500">Planning Model:</span>{' '}
              {health?.lightweightPlanningModel || 'gemini-3.1-flash-lite'}
            </div>
            <div className="text-zinc-300">
              <span className="text-zinc-500">API Key Configured:</span>{' '}
              {health ? (health.hasGeminiKey ? 'Yes' : 'No (Demo Mode Ready)') : 'Checking...'}
            </div>
          </div>
        </div>

        {/* Transactional OTP Delivery Card */}
        <div className="p-5 rounded-2xl bg-[#111116] border border-zinc-800/80 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
            <Mail size={15} />
            <span>6-Digit OTP Verification</span>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Salted HMAC-SHA256 verification tokens signed on the backend with rate-limit protection.
          </p>
          <div className="p-3 rounded-lg bg-[#09090b] border border-zinc-800/80 space-y-1.5 font-mono text-[11px]">
            <div className="text-zinc-300">
              <span className="text-zinc-500">Email Provider:</span>{' '}
              {health?.emailProvider || 'unconfigured (sandbox)'}
            </div>
            <div className="text-zinc-300">
              <span className="text-zinc-500">Delivery Mode:</span>{' '}
              {health ? (health.emailDeliveryConfigured ? 'Active' : 'Sandbox Mode') : 'Checking...'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

