import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/authContext';
import { useGuidedTour } from '../../lib/guidedTour';
import {
  getCodeProjects,
  getWebsiteProjects,
  getDocuments,
  getDatasets,
  getActivityLogs,
  deleteCodeProject,
  deleteWebsiteProject,
  deleteDocument,
  deleteDataset,
  logActivity,
  CodeProjectRecord,
  WebsiteProjectRecord,
  DocumentRecord,
  DatasetRecord,
  ActivityLogRecord,
} from '../../lib/firestoreService';
import { ConfirmModal } from '../../components/common/ModalPrimitives';
import {
  Code2,
  Globe,
  FileText,
  Table2,
  FolderGit2,
  ArrowRight,
  Activity,
  AlertCircle,
  Loader2,
  Compass,
  Trash2,
  ExternalLink,
} from 'lucide-react';

interface RecentProjectItem {
  id: string;
  title: string;
  type: 'Code' | 'Website' | 'Document' | 'Dataset';
  modified: string;
  link: string;
  meta: string;
}

export const DashboardPage: React.FC = () => {
  const { currentUser } = useAuth();
  const { startTour } = useGuidedTour();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [codeProjects, setCodeProjects] = useState<CodeProjectRecord[]>([]);
  const [websiteProjects, setWebsiteProjects] = useState<WebsiteProjectRecord[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);
  const [activities, setActivities] = useState<ActivityLogRecord[]>([]);

  const [deletingItem, setDeletingItem] = useState<RecentProjectItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    async function loadWorkspaceData() {
      if (!currentUser?.uid) return;
      setLoading(true);
      setError(null);
      try {
        const [codes, webs, docs, data, acts] = await Promise.allSettled([
          getCodeProjects(currentUser.uid),
          getWebsiteProjects(currentUser.uid),
          getDocuments(currentUser.uid),
          getDatasets(currentUser.uid),
          getActivityLogs(currentUser.uid, 6),
        ]);

        if (codes.status === 'fulfilled') setCodeProjects(codes.value);
        if (webs.status === 'fulfilled') setWebsiteProjects(webs.value);
        if (docs.status === 'fulfilled') setDocuments(docs.value);
        if (data.status === 'fulfilled') setDatasets(data.value);
        if (acts.status === 'fulfilled') setActivities(acts.value);
      } catch (err: any) {
        console.error('Error loading dashboard:', err);
        setError('Could not load some workspace records. Please refresh or check connection.');
      } finally {
        setLoading(false);
      }
    }

    loadWorkspaceData();
  }, [currentUser?.uid]);

  const totalProjects =
    codeProjects.length + websiteProjects.length + documents.length + datasets.length;

  const allRecentProjects: RecentProjectItem[] = [
    ...codeProjects.map((p) => ({
      id: p.id,
      title: p.name,
      type: 'Code' as const,
      modified: p.updatedAt || p.createdAt,
      link: `/code-generator?id=${p.id}`,
      meta: `${p.language} · ${p.files?.length || 0} files`,
    })),
    ...websiteProjects.map((p) => ({
      id: p.id,
      title: p.name,
      type: 'Website' as const,
      modified: p.updatedAt || p.createdAt,
      link: `/website-generator?id=${p.id}`,
      meta: `${p.technology} · ${p.fileManifest?.length || 0} files`,
    })),
    ...documents.map((p) => ({
      id: p.id,
      title: p.title,
      type: 'Document' as const,
      modified: p.updatedAt || p.createdAt,
      link: `/document-generator?id=${p.id}`,
      meta: `${p.category} · ${p.tone}`,
    })),
    ...datasets.map((p) => ({
      id: p.id,
      title: p.filename,
      type: 'Dataset' as const,
      modified: p.updatedAt || p.createdAt,
      link: `/data-cleaner?id=${p.id}`,
      meta: `${p.rowCount} rows · ${p.columnCount} cols`,
    })),
  ].sort((a, b) => b.modified.localeCompare(a.modified));

  const recentProjects = allRecentProjects.slice(0, 6);

  const handleConfirmDelete = async () => {
    if (!deletingItem) return;
    setIsDeleting(true);
    try {
      if (deletingItem.type === 'Code') {
        await deleteCodeProject(deletingItem.id);
        setCodeProjects((prev) => prev.filter((p) => p.id !== deletingItem.id));
      } else if (deletingItem.type === 'Website') {
        await deleteWebsiteProject(deletingItem.id, currentUser?.uid);
        setWebsiteProjects((prev) => prev.filter((p) => p.id !== deletingItem.id));
      } else if (deletingItem.type === 'Document') {
        await deleteDocument(deletingItem.id);
        setDocuments((prev) => prev.filter((p) => p.id !== deletingItem.id));
      } else if (deletingItem.type === 'Dataset') {
        await deleteDataset(deletingItem.id);
        setDatasets((prev) => prev.filter((p) => p.id !== deletingItem.id));
      }

      if (currentUser?.uid) {
        await logActivity(
          currentUser.uid,
          deletingItem.type.toLowerCase() as ActivityLogRecord['activityType'],
          `Deleted ${deletingItem.type.toLowerCase()} project '${deletingItem.title}'`,
          deletingItem.id,
          deletingItem.type.toLowerCase()
        );
      }
      setDeletingItem(null);
    } catch {
      setError(`Failed to delete '${deletingItem.title}'.`);
    } finally {
      setIsDeleting(false);
    }
  };

  const agentCards = [
    {
      id: 'code',
      name: 'AI Code Generator',
      description:
        'Generate complete multi-file software repositories with file explorer, diff modification previews, immutable snapshots, and ZIP export.',
      count: codeProjects.length,
      unit: codeProjects.length === 1 ? 'project' : 'projects',
      path: '/code-generator',
      icon: Code2,
      iconTone: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
    },
    {
      id: 'website',
      name: 'AI Website Builder',
      description:
        'Build production React/Vite and HTML/CSS sites using Hydrogen, edit source files live, inspect compiler diagnostics, and publish previews.',
      count: websiteProjects.length,
      unit: websiteProjects.length === 1 ? 'site' : 'sites',
      path: '/website-generator',
      icon: Globe,
      iconTone: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
    },
    {
      id: 'data',
      name: 'AI Data Cleaner',
      description:
        'Profile CSV and Excel datasets statistically, run plain-English cleaning instructions safely, and export verified spreadsheets.',
      count: datasets.length,
      unit: datasets.length === 1 ? 'dataset' : 'datasets',
      path: '/data-cleaner',
      icon: Table2,
      iconTone: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    },
    {
      id: 'document',
      name: 'AI Document Generator',
      description:
        'Describe your document goals in plain English, edit live Markdown with tables and lists, and export native OpenXML .docx files.',
      count: documents.length,
      unit: documents.length === 1 ? 'document' : 'documents',
      path: '/document-generator',
      icon: FileText,
      iconTone: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
    },
  ];

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Clean Emergent Welcome Header */}
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-zinc-800/80">
        <div className="space-y-1.5">
          <h2 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">
            Welcome to your Engineering Workspace
          </h2>
          <p className="text-xs sm:text-sm text-zinc-400 max-w-2xl">
            Signed in as{' '}
            <span className="text-zinc-200 font-medium">
              {currentUser?.displayName || 'Engineer'}
            </span>
            . Launch any of the four intelligent agents below or resume work on your saved
            projects.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => startTour(0)}
            data-testid="dashboard-guided-tour-button"
            className="px-3.5 py-2 rounded-lg border border-zinc-800 bg-[#111116] hover:bg-zinc-800/80 text-zinc-200 text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Compass size={14} className="text-violet-400" />
            <span>Guided Tour</span>
          </button>

          <Link
            to="/projects"
            className="px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium inline-flex items-center gap-1.5 transition-colors shadow-sm shadow-violet-600/25 whitespace-nowrap shrink-0 tabular-nums"
          >
            <FolderGit2 size={14} />
            <span>My Projects ({totalProjects})</span>
          </Link>
        </div>
      </section>

      {error && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2.5"
        >
          <AlertCircle size={16} className="text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 2x2 Agent Cards Grid */}
      <section data-tour="dashboard-agents" className="space-y-3.5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-100">Intelligent Agents</h3>
          <span className="text-xs text-zinc-500 tabular-nums">
            {totalProjects} total saved artifacts
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {agentCards.map((agent) => {
            const Icon = agent.icon;
            return (
              <div
                key={agent.id}
                data-testid={`dashboard-agent-card-${agent.id}`}
                className="p-6 rounded-2xl bg-[#111116] border border-zinc-800/80 hover:border-violet-500/40 transition-colors flex flex-col justify-between gap-5"
              >
                <div className="space-y-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div
                      className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${agent.iconTone}`}
                    >
                      <Icon size={19} />
                    </div>
                    <span
                      data-testid={`agent-count-${agent.id}`}
                      className="px-2.5 py-1 rounded-md bg-[#09090b] border border-zinc-800/90 text-[11px] font-mono text-zinc-300 tabular-nums"
                    >
                      {loading ? '—' : `${agent.count} ${agent.unit}`}
                    </span>
                  </div>

                  <div>
                    <h4 className="text-base font-semibold text-white">{agent.name}</h4>
                    <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                      {agent.description}
                    </p>
                  </div>
                </div>

                <div className="pt-3 border-t border-zinc-800/70 flex items-center justify-end">
                  <Link
                    to={agent.path}
                    className="px-3.5 py-2 rounded-lg bg-zinc-900 hover:bg-violet-600 border border-zinc-800 hover:border-violet-500 text-zinc-200 hover:text-white text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
                  >
                    <span>Open Agent</span>
                    <ArrowRight size={13} />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Bottom Split: Recent Work (8 cols) & Recent Activity (4 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Recent Work */}
        <section
          data-testid="dashboard-recent-work"
          className="lg:col-span-8 p-5 sm:p-6 rounded-2xl bg-[#111116] border border-zinc-800/80 flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-zinc-800/80">
              <div className="flex items-center gap-2">
                <FolderGit2 size={16} className="text-violet-400" />
                <h3 className="text-sm font-semibold text-white">Recent Work</h3>
              </div>
              <Link
                to="/projects"
                className="text-xs text-violet-400 hover:text-violet-300 font-medium tabular-nums"
              >
                View all ({allRecentProjects.length})
              </Link>
            </div>

            {loading ? (
              <div className="py-12 flex flex-col items-center justify-center text-zinc-400 gap-2">
                <Loader2 size={20} className="animate-spin text-violet-400" />
                <span className="text-xs">Loading saved projects...</span>
              </div>
            ) : recentProjects.length === 0 ? (
              <div
                data-testid="recent-work-empty"
                className="py-12 text-center border border-dashed border-zinc-800 rounded-xl p-6"
              >
                <p className="text-xs font-medium text-zinc-200">No saved work yet.</p>
                <p className="text-xs text-zinc-400 mt-1 max-w-sm mx-auto">
                  Open any of the four intelligent agents above to create your first project,
                  website, document, or cleaned dataset.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/70">
                {recentProjects.map((proj) => (
                  <div
                    key={`${proj.type}-${proj.id}`}
                    className="py-3 flex items-center justify-between gap-3 hover:bg-zinc-900/50 -mx-2 px-2 rounded-lg transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                          proj.type === 'Code'
                            ? 'bg-violet-500/10 text-violet-400'
                            : proj.type === 'Website'
                            ? 'bg-indigo-500/10 text-indigo-400'
                            : proj.type === 'Document'
                            ? 'bg-sky-500/10 text-sky-400'
                            : 'bg-emerald-500/10 text-emerald-400'
                        }`}
                      >
                        {proj.type === 'Code' && <Code2 size={15} />}
                        {proj.type === 'Website' && <Globe size={15} />}
                        {proj.type === 'Document' && <FileText size={15} />}
                        {proj.type === 'Dataset' && <Table2 size={15} />}
                      </div>
                      <div className="min-w-0">
                        <Link
                          to={proj.link}
                          className="text-xs font-semibold text-zinc-100 hover:text-violet-300 truncate block"
                        >
                          {proj.title}
                        </Link>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400 font-mono tabular-nums mt-0.5">
                          <span>{proj.type}</span>
                          <span aria-hidden="true">·</span>
                          <span>{proj.meta}</span>
                          <span aria-hidden="true">·</span>
                          <span>{new Date(proj.modified).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <Link
                        to={proj.link}
                        className="px-2.5 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-xs font-medium inline-flex items-center gap-1 transition-colors"
                      >
                        <span>Open</span>
                        <ExternalLink size={12} />
                      </Link>
                      <button
                        type="button"
                        onClick={() => setDeletingItem(proj)}
                        aria-label={`Delete '${proj.title}'`}
                        title="Delete project"
                        className="p-1.5 rounded-lg border border-transparent hover:border-rose-500/30 hover:bg-rose-500/10 text-zinc-500 hover:text-rose-400 transition-colors cursor-pointer"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Recent Activity */}
        <section className="lg:col-span-4 p-5 sm:p-6 rounded-2xl bg-[#111116] border border-zinc-800/80 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-zinc-800/80">
              <div className="flex items-center gap-2">
                <Activity size={16} className="text-indigo-400" />
                <h3 className="text-sm font-semibold text-white">Recent Activity</h3>
              </div>
              <Link
                to="/activity"
                className="text-xs text-violet-400 hover:text-violet-300 font-medium"
              >
                Full Log
              </Link>
            </div>

            {loading ? (
              <div className="py-12 flex flex-col items-center justify-center text-zinc-400 gap-2">
                <Loader2 size={20} className="animate-spin text-indigo-400" />
                <span className="text-xs">Loading activity stream...</span>
              </div>
            ) : activities.length === 0 ? (
              <div className="py-12 text-center text-zinc-400 border border-dashed border-zinc-800 rounded-xl p-4">
                <p className="text-xs font-medium text-zinc-300">No activity recorded yet.</p>
                <p className="text-[11px] text-zinc-500 mt-1">
                  Generations, publishes, and exports appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-3.5">
                {activities.map((act) => (
                  <div
                    key={act.id}
                    className="pb-3 border-b border-zinc-800/60 last:border-none last:pb-0 text-xs"
                  >
                    <p className="text-zinc-200 leading-snug">{act.description}</p>
                    <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-500 mt-1 tabular-nums">
                      <span>{act.activityType.toUpperCase()}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {new Date(act.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <ConfirmModal
        isOpen={Boolean(deletingItem)}
        onClose={() => setDeletingItem(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Saved Project"
        message={`Are you sure you want to permanently delete '${deletingItem?.title || ''}'?`}
        confirmLabel="Delete Project"
        cancelLabel="Cancel"
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
};
