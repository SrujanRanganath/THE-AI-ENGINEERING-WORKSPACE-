import React, { useEffect, useState } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/authContext';
import { auth } from '../../lib/firebase';
import {
  getPublishedWebsiteFromFirestore,
  getWebsiteProjects,
} from '../../lib/firestoreService';
import {
  buildPublishedPreviewUrl,
  PublishedWebsiteSnapshot,
} from '../../utils/publishPreview';
import {
  PublishedLookupOutcome,
  resolvePublishedPreviewSnapshot,
} from '../../utils/publishedPreviewClient';
import {
  Globe,
  Copy,
  Check,
  ExternalLink,
  ArrowLeft,
  ShieldCheck,
  AlertCircle,
  Loader2,
  Lock,
  LogIn,
} from 'lucide-react';

export const PublishedWebsitePage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const { currentUser, loading: authLoading } = useAuth();

  const [snapshot, setSnapshot] = useState<PublishedWebsiteSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [outcomeError, setOutcomeError] = useState<{
    message: string;
    forbidden?: boolean;
    requiresSignIn?: boolean;
  } | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  const viewerOwnerId = currentUser?.uid || null;

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;

    async function loadPublishedSite() {
      if (!projectId || !projectId.trim()) {
        setOutcomeError({ message: 'Missing project identifier in URL.' });
        setLoading(false);
        return;
      }

      setLoading(true);
      setOutcomeError(null);

      try {
        const outcome: PublishedLookupOutcome = await resolvePublishedPreviewSnapshot({
          projectId,
          viewerOwnerId,
          fetchServerSnapshot: async (id, ownerId) => {
            const headers: Record<string, string> = {};
            try {
              const idToken = await auth.currentUser?.getIdToken();
              if (idToken) headers.Authorization = `Bearer ${idToken}`;
            } catch {
              // Anonymous/public share link lookup
            }
            const isGuestSession = ownerId === 'guest_engineer_demo';
            const qs = isGuestSession ? `?ownerId=${encodeURIComponent(ownerId)}` : '';
            const res = await fetch(`/api/published/${encodeURIComponent(id)}${qs}`, {
              headers,
            });
            const data = await res.json().catch(() => null);
            return {
              status: res.status,
              snapshot: data?.snapshot || null,
              error: data?.error,
            };
          },
          fetchFirestoreSnapshot: (id) => getPublishedWebsiteFromFirestore(id),
          fetchOwnerWebsiteProjects: (ownerId) => getWebsiteProjects(ownerId),
        });

        if (cancelled) return;

        if (outcome.status === 'found') {
          setSnapshot(outcome.snapshot);
        } else if (outcome.status === 'forbidden') {
          setOutcomeError({
            message: outcome.error,
            forbidden: true,
            requiresSignIn: outcome.requiresSignIn,
          });
        } else {
          setOutcomeError({ message: outcome.error });
        }
      } catch (err: any) {
        if (!cancelled) {
          setOutcomeError({
            message: err?.message || 'Failed to load published website preview.',
          });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadPublishedSite();
    return () => {
      cancelled = true;
    };
  }, [projectId, viewerOwnerId, authLoading]);

  const publishedUrl = projectId ? buildPublishedPreviewUrl(projectId) : window.location.href;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(publishedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading || authLoading) {
    return (
      <div className="min-h-screen bg-[#09090b] text-zinc-200 flex flex-col items-center justify-center p-6">
        <Loader2 size={28} className="text-violet-400 animate-spin mb-3" />
        <p className="text-xs font-mono text-zinc-400">Loading Published Website Preview...</p>
      </div>
    );
  }

  if (outcomeError || !snapshot) {
    const isForbidden = Boolean(outcomeError?.forbidden);
    return (
      <div className="min-h-screen bg-[#09090b] text-zinc-200 flex flex-col items-center justify-center p-6">
        <div
          className={`max-w-md w-full p-6 rounded-xl bg-[#111116] border ${
            isForbidden ? 'border-amber-500/30' : 'border-rose-500/30'
          } text-center space-y-4`}
        >
          <div
            className={`w-12 h-12 rounded-xl flex items-center justify-center mx-auto ${
              isForbidden
                ? 'bg-amber-500/10 text-amber-400'
                : 'bg-rose-500/10 text-rose-400'
            }`}
          >
            {isForbidden ? <Lock size={22} /> : <AlertCircle size={24} />}
          </div>
          <h1 className="text-base font-bold text-white">
            {isForbidden ? 'Owner Access Required' : 'Published Preview Unavailable'}
          </h1>
          <p className="text-xs text-zinc-400 leading-relaxed">
            {outcomeError?.message || 'Could not load published preview.'}
          </p>
          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            {outcomeError?.requiresSignIn && (
              <Link
                to="/signin"
                state={{ from: location }}
                className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
              >
                <LogIn size={14} />
                <span>Sign In as Owner</span>
              </Link>
            )}
            <Link
              to="/website-generator"
              data-testid="published-return-workspace"
              className="px-4 py-2 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
            >
              <ArrowLeft size={14} />
              <span>Return to Workspace</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#09090b] overflow-hidden">
      {/* Published Preview Control Bar */}
      <header
        data-testid="published-preview-header"
        className="h-12 px-4 bg-[#111116] border-b border-zinc-800/80 flex items-center justify-between gap-3 shrink-0"
      >
        <div className="flex items-center gap-3 min-w-0">
          <Link
            to={`/website-generator?id=${encodeURIComponent(snapshot.projectId)}`}
            data-testid="published-return-workspace"
            className="px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs font-medium inline-flex items-center gap-1.5 transition-colors shrink-0"
          >
            <ArrowLeft size={13} />
            <span>Return to Workspace</span>
          </Link>

          <div className="flex items-center gap-2 min-w-0">
            <Globe size={15} className="text-violet-400 shrink-0" />
            <span className="text-xs font-semibold text-white truncate">{snapshot.name}</span>
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[10px] font-medium font-mono">
              <ShieldCheck size={11} />
              <span>
                v{snapshot.snapshotVersion || 1} ·{' '}
                {snapshot.isPublic !== false ? 'Public Share' : 'Owner Only'}
              </span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            data-testid="published-preview-url"
            className="hidden md:inline-block px-2.5 py-1 rounded bg-[#09090b] border border-zinc-800 text-[11px] font-mono text-zinc-400 max-w-xs truncate"
            title={publishedUrl}
          >
            {publishedUrl}
          </span>

          <button
            type="button"
            onClick={handleCopyLink}
            data-testid="published-copy-link"
            className="px-2.5 py-1.5 rounded-lg border border-zinc-800 hover:bg-zinc-800/80 text-zinc-200 text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            {copied ? (
              <>
                <Check size={13} className="text-emerald-400" />
                <span className="text-emerald-400">Copied Link</span>
              </>
            ) : (
              <>
                <Copy size={13} />
                <span>Copy Link</span>
              </>
            )}
          </button>

          <a
            href={publishedUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="published-open-site"
            className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
          >
            <ExternalLink size={13} />
            <span>Open in New Tab</span>
          </a>
        </div>
      </header>

      {/* Full-Viewport Isolated Website Render Frame */}
      <main className="flex-1 w-full bg-zinc-950 relative overflow-hidden">
        <iframe
          title={`Published Preview — ${snapshot.name}`}
          srcDoc={snapshot.compiledHtml}
          sandbox="allow-scripts"
          className="w-full h-full border-none bg-zinc-950"
        />
      </main>
    </div>
  );
};
