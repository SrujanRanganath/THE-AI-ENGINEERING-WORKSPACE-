import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/authContext';
import {
  getCodeProjects,
  getWebsiteProjects,
  getDocuments,
  getDatasets,
  deleteCodeProject,
  deleteWebsiteProject,
  deleteDocument,
  deleteDataset,
  updateCodeProject,
  updateWebsiteProject,
  updateDocument,
  logActivity,
  CodeProjectRecord,
  WebsiteProjectRecord,
  DocumentRecord,
  DatasetRecord,
} from '../../lib/firestoreService';
import { downloadProjectZip } from '../../utils/zipExport';
import { downloadDocx } from '../../utils/docxExport';
import { exportToCsv } from '../../utils/sheetExport';
import {
  FolderGit2,
  Code2,
  Globe,
  FileText,
  Table2,
  Search,
  Trash2,
  Edit2,
  ExternalLink,
  Plus,
  Loader2,
  AlertCircle,
  Download,
} from 'lucide-react';
import { ModalDialog, ConfirmModal } from '../../components/common/ModalPrimitives';

type ProjectType = 'all' | 'code' | 'website' | 'document' | 'dataset';

interface UnifiedProject {
  id: string;
  name: string;
  type: 'code' | 'website' | 'document' | 'dataset';
  description: string;
  createdAt: string;
  updatedAt: string;
  meta: string;
  openUrl: string;
  rawRecord: CodeProjectRecord | WebsiteProjectRecord | DocumentRecord | DatasetRecord;
}

export const ProjectsPage: React.FC = () => {
  const { currentUser } = useAuth();
  const [projects, setProjects] = useState<UnifiedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Search
  const [filterType, setFilterType] = useState<ProjectType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name'>('newest');

  // Rename & Delete modal state
  const [renamingProject, setRenamingProject] = useState<UnifiedProject | null>(null);
  const [newName, setNewName] = useState('');
  const [deletingProject, setDeletingProject] = useState<UnifiedProject | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadProjects = async () => {
    if (!currentUser?.uid) return;
    setLoading(true);
    setError(null);
    try {
      const [codes, webs, docs, data] = await Promise.all([
        getCodeProjects(currentUser.uid),
        getWebsiteProjects(currentUser.uid),
        getDocuments(currentUser.uid),
        getDatasets(currentUser.uid),
      ]);

      const unified: UnifiedProject[] = [
        ...codes.map((c) => ({
          id: c.id,
          name: c.name,
          type: 'code' as const,
          description: c.description,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt || c.createdAt,
          meta: `${c.language} · ${c.framework}`,
          openUrl: `/code-generator?id=${c.id}`,
          rawRecord: c,
        })),
        ...webs.map((w) => ({
          id: w.id,
          name: w.name,
          type: 'website' as const,
          description: w.description,
          createdAt: w.createdAt,
          updatedAt: w.updatedAt || w.createdAt,
          meta: `${w.technology} · ${w.category}`,
          openUrl: `/website-generator?id=${w.id}`,
          rawRecord: w,
        })),
        ...docs.map((d) => ({
          id: d.id,
          name: d.title,
          type: 'document' as const,
          description: d.category,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt || d.createdAt,
          meta: `${d.category} · ${d.tone}`,
          openUrl: `/document-generator?id=${d.id}`,
          rawRecord: d,
        })),
        ...data.map((ds) => ({
          id: ds.id,
          name: ds.filename,
          type: 'dataset' as const,
          description: `${ds.rowCount} rows across ${ds.columnCount} columns`,
          createdAt: ds.createdAt,
          updatedAt: ds.updatedAt || ds.createdAt,
          meta: `${ds.rowCount} rows · ${ds.format.toUpperCase()}`,
          openUrl: `/data-cleaner?id=${ds.id}`,
          rawRecord: ds,
        })),
      ];

      setProjects(unified);
    } catch (err: any) {
      console.error(err);
      setError('Failed to fetch projects from workspace storage.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, [currentUser?.uid]);

  // Direct Export from Project Card
  const handleExportProject = async (proj: UnifiedProject) => {
    try {
      if (proj.type === 'code') {
        const rec = proj.rawRecord as CodeProjectRecord;
        await downloadProjectZip(rec.name, rec.files || []);
      } else if (proj.type === 'website') {
        const rec = proj.rawRecord as WebsiteProjectRecord;
        await downloadProjectZip(rec.name, rec.fileManifest || []);
      } else if (proj.type === 'document') {
        const rec = proj.rawRecord as DocumentRecord;
        await downloadDocx({
          title: rec.title,
          subtitle: rec.subtitle,
          category: rec.category,
          tone: rec.tone,
          sections: rec.sections || [],
          fullMarkdown: rec.content,
          author: currentUser?.displayName || 'AI Engineering Workspace',
        });
      } else if (proj.type === 'dataset') {
        const rec = proj.rawRecord as DatasetRecord;
        await exportToCsv(rec.previewData || [], rec.filename);
      }
    } catch (err: any) {
      setError(err.message || `Failed to export ${proj.name}.`);
    }
  };

  // Handle Confirmed Deletion
  const handleConfirmDelete = async () => {
    if (!deletingProject) return;
    setIsDeleting(true);

    try {
      if (deletingProject.type === 'code') await deleteCodeProject(deletingProject.id);
      if (deletingProject.type === 'website')
        await deleteWebsiteProject(deletingProject.id, currentUser?.uid);
      if (deletingProject.type === 'document') await deleteDocument(deletingProject.id);
      if (deletingProject.type === 'dataset') await deleteDataset(deletingProject.id);

      if (currentUser?.uid) {
        await logActivity(
          currentUser.uid,
          deletingProject.type,
          `Deleted ${deletingProject.type} project '${deletingProject.name}'`,
          deletingProject.id,
          deletingProject.type
        );
      }
      setProjects((prev) => prev.filter((p) => p.id !== deletingProject.id));
      setDeletingProject(null);
    } catch {
      setError(`Failed to delete ${deletingProject.name}.`);
    } finally {
      setIsDeleting(false);
    }
  };

  // Handle Rename
  const handleRename = async () => {
    if (!renamingProject || !newName.trim()) return;

    try {
      if (renamingProject.type === 'code') {
        await updateCodeProject(renamingProject.id, { name: newName.trim() });
      } else if (renamingProject.type === 'website') {
        await updateWebsiteProject(
          renamingProject.id,
          { name: newName.trim() },
          currentUser?.uid
        );
      } else if (renamingProject.type === 'document') {
        await updateDocument(renamingProject.id, { title: newName.trim() });
      }

      setProjects((prev) =>
        prev.map((p) => (p.id === renamingProject.id ? { ...p, name: newName.trim() } : p))
      );
      setRenamingProject(null);
    } catch {
      setError(`Failed to rename project.`);
    }
  };

  // Filter and Sort Logic
  const filtered = projects
    .filter((p) => (filterType === 'all' ? true : p.type === filterType))
    .filter(
      (p) =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.meta.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.description.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'oldest') return a.createdAt.localeCompare(b.createdAt);
      return b.updatedAt.localeCompare(a.updatedAt);
    });

  return (
    <div data-tour="projects-repository" className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-zinc-800/80">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-violet-400 uppercase tracking-wider mb-1">
            <FolderGit2 size={16} />
            <span>Project Management</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            Centralized Workspace Projects
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            Unified repository across all four agent types. Scoped strictly to your authenticated
            account.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/code-generator"
            className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-violet-500/40 text-zinc-200 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-colors"
          >
            <Plus size={14} />
            <span>New Code</span>
          </Link>
          <Link
            to="/website-generator"
            className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium flex items-center gap-1.5 transition-colors"
          >
            <Plus size={14} />
            <span>New Site</span>
          </Link>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2.5">
          <AlertCircle size={16} className="text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="p-4 rounded-2xl bg-[#111116] border border-zinc-800/80 flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Type Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto w-full md:w-auto p-1 bg-[#09090b] border border-zinc-800/80 rounded-lg">
          {(
            [
              { id: 'all', label: 'All Projects' },
              { id: 'code', label: 'Code' },
              { id: 'website', label: 'Websites' },
              { id: 'document', label: 'Documents' },
              { id: 'dataset', label: 'Datasets' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterType(tab.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                filterType === tab.id
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search & Sort */}
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search projects by name..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-200 text-xs focus:outline-none focus:border-violet-500"
            />
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="px-2.5 py-1.5 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-300 text-xs focus:outline-none focus:border-violet-500"
          >
            <option value="newest">Recently Modified</option>
            <option value="oldest">Oldest First</option>
            <option value="name">Alphabetical</option>
          </select>
        </div>
      </div>

      {/* Projects List */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center text-zinc-500 gap-2">
          <Loader2 size={24} className="animate-spin text-violet-500" />
          <span className="text-xs">Loading projects...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center rounded-2xl bg-[#111116] border border-dashed border-zinc-800 p-8">
          <FolderGit2 size={36} className="text-zinc-600 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-white">No projects found</h3>
          <p className="text-xs text-zinc-400 max-w-sm mx-auto mt-1">
            {searchQuery
              ? `No project matching "${searchQuery}". Try clearing search.`
              : `You haven't generated any ${filterType === 'all' ? '' : filterType} projects yet.`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((proj) => (
            <div
              key={`${proj.type}-${proj.id}`}
              className="p-5 rounded-2xl bg-[#111116] border border-zinc-800/80 hover:border-violet-500/40 transition-all flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      proj.type === 'code'
                        ? 'bg-violet-500/10 text-violet-400'
                        : proj.type === 'website'
                        ? 'bg-indigo-500/10 text-indigo-400'
                        : proj.type === 'document'
                        ? 'bg-sky-500/10 text-sky-400'
                        : 'bg-emerald-500/10 text-emerald-400'
                    }`}
                  >
                    {proj.type === 'code' && <Code2 size={16} />}
                    {proj.type === 'website' && <Globe size={16} />}
                    {proj.type === 'document' && <FileText size={16} />}
                    {proj.type === 'dataset' && <Table2 size={16} />}
                  </div>

                  <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleExportProject(proj)}
                      className="p-1 rounded text-zinc-500 hover:text-emerald-400"
                      title="Export / Download"
                      aria-label={`Export ${proj.name}`}
                    >
                      <Download size={13} />
                    </button>
                    {proj.type !== 'dataset' && (
                      <button
                        onClick={() => {
                          setRenamingProject(proj);
                          setNewName(proj.name);
                        }}
                        className="p-1 rounded text-zinc-500 hover:text-zinc-200"
                        title="Rename"
                        aria-label={`Rename ${proj.name}`}
                      >
                        <Edit2 size={13} />
                      </button>
                    )}
                    <button
                      onClick={() => setDeletingProject(proj)}
                      className="p-1 rounded text-zinc-500 hover:text-rose-400"
                      title="Delete"
                      aria-label={`Delete ${proj.name}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                <Link
                  to={proj.openUrl}
                  className="text-sm font-semibold text-white hover:text-violet-400 transition-colors block truncate"
                >
                  {proj.name}
                </Link>

                <p className="text-xs text-zinc-400 mt-1 line-clamp-2 leading-relaxed">
                  {proj.description || 'No description provided.'}
                </p>
              </div>

              <div className="mt-5 pt-3 border-t border-zinc-800/70 flex items-center justify-between text-[11px] text-zinc-500">
                <span>{proj.meta}</span>
                <Link
                  to={proj.openUrl}
                  className="text-violet-400 hover:text-violet-300 font-medium inline-flex items-center gap-1"
                >
                  <span>Open</span>
                  <ExternalLink size={12} />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Accessible Rename Modal */}
      <ModalDialog
        isOpen={Boolean(renamingProject)}
        onClose={() => setRenamingProject(null)}
        title="Rename Project"
        description="Enter a new title for this workspace project."
        footer={
          <>
            <button
              type="button"
              onClick={() => setRenamingProject(null)}
              className="px-3.5 py-1.5 rounded-lg border border-zinc-800 text-zinc-300 hover:text-white text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRename}
              className="px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium"
            >
              Save
            </button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-medium text-zinc-300 mb-1.5">Project Name</label>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-200 text-xs focus:outline-none focus:border-violet-500"
          />
        </div>
      </ModalDialog>

      {/* Accessible Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={Boolean(deletingProject)}
        onClose={() => setDeletingProject(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Workspace Project"
        message={`Are you sure you want to permanently delete '${deletingProject?.name || ''}'?`}
        confirmLabel="Delete Project"
        cancelLabel="Cancel"
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
};
