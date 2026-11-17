import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';

interface SystemHealthInfo {
  status: string;
  service?: string;
  primaryModel: string;
  websiteGeneratorModel?: string;
  hasGeminiKey: boolean;
  emailDeliveryConfigured: boolean;
  emailProvider: string;
}

export const SettingsPage: React.FC = () => {
  const { currentUser, updateUserProfile } = useAuth();
  const { startTour, resetTourPreferences, preferences } = useGuidedTour();
  const [displayName, setDisplayName] = useState(currentUser?.displayName || '');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<SystemHealthInfo | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((data) => setHealth(data))
      .catch(() => {});
  }, []);

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
    <div data-tour="settings-overview" className="space-y-6 max-w-4xl mx-auto">
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
          Manage your developer profile, guided onboarding preferences, and inspect connected server configuration.
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
              <span className="text-zinc-500">Primary Model:</span>{' '}
              {health?.primaryModel || 'gemini-4-hydrogen'}
            </div>
            <div className="text-zinc-300">
              <span className="text-zinc-500">Website Model:</span>{' '}
              {health?.websiteGeneratorModel || 'gemini-4-hydrogen'}
            </div>
            <div className="text-zinc-300">
              <span className="text-zinc-500">API Key Configured:</span>{' '}
              {health ? (health.hasGeminiKey ? 'Yes' : 'No (Sample Mode Ready)') : 'Checking...'}
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
