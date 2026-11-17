import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/authContext';
import { auth } from '../../lib/firebase';
import {
  saveWebsiteProject,
  getWebsiteProjects,
  updateWebsiteProject,
  deleteWebsiteProject,
  savePublishedWebsiteToFirestore,
  logActivity,
  WebsiteProjectRecord,
} from '../../lib/firestoreService';
import { downloadProjectZip, downloadSingleFile } from '../../utils/zipExport';
import {
  compileWebsitePreview,
  getSampleReactWebsiteManifest,
  PreviewCompilationResult,
} from '../../utils/reactPreviewCompiler';
import {
  buildPublishedPreviewUrl,
  canPublishWebsiteProject,
  createPublishedWebsiteSnapshot,
  extractEntryHtml,
  extractWebsiteDependencies,
  getPublishedWebsiteSnapshot,
  savePublishedWebsiteSnapshot,
  PublishedWebsiteSnapshot,
} from '../../utils/publishPreview';
import {
  ModalDialog,
  ConfirmModal,
  UnsavedChangesModal,
} from '../../components/common/ModalPrimitives';
import {
  Globe,
  Download,
  Copy,
  Check,
  Folder,
  FileCode,
  Eye,
  Code,
  Wand2,
  Trash2,
  Edit2,
  AlertCircle,
  Loader2,
  Sparkles,
  Laptop,
  Tablet,
  Smartphone,
  RefreshCw,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Play,
  Terminal,
  ExternalLink,
  Rocket,
  Link2,
  Lock,
  Unlock,
} from 'lucide-react';

const CATEGORIES = [
  'SaaS',
  'Portfolio',
  'Business',
  'E-commerce',
  'Blog',
  'Dashboard',
  'Education',
  'Startup',
  'Custom',
];

const TECHNOLOGIES = ['React', 'HTML / CSS / JS'];

const DESIGN_DIRECTIONS = [
  'Modern',
  'Minimal',
  'Corporate',
  'Creative',
  'Luxury',
  'Dark',
  'Light',
];

export const WebsiteGeneratorPage: React.FC = () => {
  const { currentUser } = useAuth();
  const [searchParams] = useSearchParams();
  const projectIdParam = searchParams.get('id');

  // Input Form State
  const [websiteName, setWebsiteName] = useState('Apex Cloud Platform');
  const [category, setCategory] = useState('SaaS');
  const [technology, setTechnology] = useState('React');
  const [designDirection, setDesignDirection] = useState('Dark');
  const [description, setDescription] = useState(
    'A high-conversion landing page and interactive portal for a developer cloud platform featuring metrics, live pricing calculator, feature cards, and testimonials.'
  );
  const [requirements, setRequirements] = useState(
    '1. Responsive hero with CTA\n2. Interactive feature grid\n3. Pricing tier selector\n4. Dark-first design with electric accents\n5. Clean navigation and footer'
  );

  // Generation & Status
  const [isGenerating, setIsGenerating] = useState(false);
  const generatingRef = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [lastModelUsed, setLastModelUsed] = useState<string>('gemini-4-hydrogen');
  const [lastRepairAttempts, setLastRepairAttempts] = useState<number>(0);

  // Active Project Data
  const [currentProject, setCurrentProject] = useState<WebsiteProjectRecord | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string>('');
  const [editedContent, setEditedContent] = useState<string>('');
  const [hasUnsavedEdits, setHasUnsavedEdits] = useState<boolean>(false);
  const [isSavingFile, setIsSavingFile] = useState<boolean>(false);

  const [viewMode, setViewMode] = useState<'preview' | 'code' | 'diagnostics'>('preview');
  const [previewViewport, setPreviewViewport] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [copied, setCopied] = useState(false);

  // Published Preview State
  const [publishedSnapshot, setPublishedSnapshot] = useState<PublishedWebsiteSnapshot | null>(null);
  const [isPublicShare, setIsPublicShare] = useState<boolean>(true);
  const [isPublishing, setIsPublishing] = useState(false);
  const [copiedPublishedLink, setCopiedPublishedLink] = useState(false);

  // Preview Compilation State
  const [compileResult, setCompileResult] = useState<PreviewCompilationResult | null>(null);
  const [isCompiling, setIsCompiling] = useState<boolean>(false);
  const [previewRefreshKey, setPreviewRefreshKey] = useState<number>(0);
  const [runtimeError, setRuntimeError] = useState<{ message: string; stack?: string } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const previewTokenRef = useRef<string>('');

  // Modal Primitives State
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [pendingFileSwitch, setPendingFileSwitch] = useState<string | null>(null);

  // Compile current project manifest whenever project changes or refresh is triggered
  const runPreviewCompiler = useCallback((project: WebsiteProjectRecord | null) => {
    if (!project) {
      setCompileResult(null);
      setRuntimeError(null);
      return;
    }
    setIsCompiling(true);
    setRuntimeError(null);
    const token = `ptok_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    previewTokenRef.current = token;
    const result = compileWebsitePreview(
      project.fileManifest,
      project.technology,
      project.name,
      token
    );
    setCompileResult(result);
    setIsCompiling(false);
  }, []);

  useEffect(() => {
    runPreviewCompiler(currentProject);
  }, [currentProject, previewRefreshKey, runPreviewCompiler]);

  // Sync published snapshot when active project changes
  useEffect(() => {
    if (!currentProject) {
      setPublishedSnapshot(null);
      return;
    }
    const ownerId = currentUser?.uid || currentProject.ownerId || 'guest_engineer_demo';
    const existing = getPublishedWebsiteSnapshot(currentProject.id, ownerId);
    if (existing) {
      setPublishedSnapshot(existing);
      setIsPublicShare(typeof existing.isPublic === 'boolean' ? existing.isPublic : true);
    } else if (currentProject.isPublished && currentProject.publishedManifest) {
      const publicFlag =
        typeof currentProject.isPublic === 'boolean' ? currentProject.isPublic : true;
      setIsPublicShare(publicFlag);
      setPublishedSnapshot({
        projectId: currentProject.id,
        ownerId,
        name: currentProject.name,
        category: currentProject.category,
        framework: currentProject.technology?.toLowerCase().includes('react')
          ? 'React 19 + Vite'
          : 'Static HTML / CSS / JS',
        technology: currentProject.technology,
        designDirection: currentProject.designDirection,
        description: currentProject.description,
        summary: currentProject.summary,
        fileManifest: currentProject.publishedManifest,
        entryHtml: extractEntryHtml(currentProject.publishedManifest),
        dependencies: extractWebsiteDependencies(currentProject.publishedManifest),
        compiledHtml: compileResult?.compiledHtml || '',
        publishedAt: currentProject.publishedAt || currentProject.updatedAt,
        publishedUrl: buildPublishedPreviewUrl(currentProject.id),
        snapshotVersion: currentProject.snapshotVersion || 1,
        isPublic: publicFlag,
      });
    } else {
      setPublishedSnapshot(null);
    }
  }, [currentProject, currentUser?.uid]);

  // Listen for sandboxed iframe runtime error/status telemetry with strict source & token validation
  useEffect(() => {
    const ALLOWED_STATUSES = new Set(['rendered', 'runtime_error', 'mounted', 'success']);

    const handleMessage = (event: MessageEvent) => {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) {
        return;
      }
      if (event.origin !== 'null' && event.origin !== window.location.origin) {
        return;
      }
      const data = event.data;
      if (!data || typeof data !== 'object' || data.type !== 'WEBSITE_PREVIEW_STATUS') {
        return;
      }
      if (typeof data.token !== 'string' || data.token !== previewTokenRef.current) {
        return;
      }
      if (typeof data.status !== 'string' || !ALLOWED_STATUSES.has(data.status)) {
        return;
      }

      if (data.status === 'runtime_error') {
        const safeMessage = String(data.error || data.message || 'Runtime exception in preview').slice(
          0,
          1000
        );
        const safeStack = data.stack ? String(data.stack).slice(0, 2000) : undefined;
        setRuntimeError({
          message: safeMessage,
          stack: safeStack,
        });
      } else if (
        data.status === 'rendered' ||
        data.status === 'mounted' ||
        data.status === 'success'
      ) {
        setRuntimeError(null);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Load project if requested via URL param
  useEffect(() => {
    async function fetchProject() {
      if (!projectIdParam || !currentUser?.uid) return;
      try {
        const list = await getWebsiteProjects(currentUser.uid);
        const match = list.find((p) => p.id === projectIdParam);
        if (match) {
          setCurrentProject(match);
          setWebsiteName(match.name);
          setCategory(match.category);
          setTechnology(match.technology);
          setDesignDirection(match.designDirection);
          setDescription(match.description);
          setRequirements(match.requirements);
          if (match.fileManifest.length > 0) {
            const defaultFile =
              match.fileManifest.find(
                (f) => f.path === 'src/App.jsx' || f.path === 'src/App.tsx'
              ) || match.fileManifest[0];
            setSelectedFilePath(defaultFile.path);
            setEditedContent(defaultFile.content);
            setHasUnsavedEdits(false);
          }
        }
      } catch (err) {
        console.warn('Could not load website project:', err);
      }
    }
    fetchProject();
  }, [projectIdParam, currentUser?.uid]);

  // Load Sample Multi-File React/Vite Project (Zero API Credits)
  const handleLoadSampleProject = async () => {
    if (generatingRef.current) return;
    generatingRef.current = true;
    setErrorMessage(null);
    setStatusBanner(null);
    setIsGenerating(true);
    try {
      const sampleName = websiteName.trim() || 'Apex Cloud Platform';
      const manifest = getSampleReactWebsiteManifest(sampleName);
      const now = new Date().toISOString();
      const newProjectId = `web_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

      const newRecord: WebsiteProjectRecord = {
        id: newProjectId,
        ownerId: currentUser?.uid || 'guest_engineer_demo',
        name: sampleName,
        category,
        technology: 'React',
        designDirection,
        description,
        requirements,
        summary:
          'Complete multi-file React 19 + Vite application with Navbar, interactive FeatureGrid, live PricingCalculator, Contact inquiry section, and Footer.',
        fileManifest: manifest,
        createdAt: now,
        updatedAt: now,
      };

      await saveWebsiteProject(newRecord);
      if (currentUser?.uid) {
        await logActivity(
          currentUser.uid,
          'website',
          `Loaded React/Vite multi-file project '${sampleName}'`,
          newProjectId,
          'websiteProject'
        );
      }

      setCurrentProject(newRecord);
      setPublishedSnapshot(null);
      const appFile = manifest.find((f) => f.path === 'src/App.jsx') || manifest[0];
      setSelectedFilePath(appFile.path);
      setEditedContent(appFile.content);
      setHasUnsavedEdits(false);
      setViewMode('preview');
      setStatusBanner(
        `Loaded ${manifest.length}-file React/Vite project "${sampleName}" and compiled preview.`
      );
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || 'Failed to load sample React project.');
    } finally {
      generatingRef.current = false;
      setIsGenerating(false);
    }
  };

  // Handle Website Generation via AI Endpoint (Hydrogen primary model + repair pipeline)
  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (generatingRef.current) return;

    if (!websiteName.trim() || !description.trim()) {
      setErrorMessage('Website name and description are required.');
      return;
    }

    generatingRef.current = true;
    setErrorMessage(null);
    setStatusBanner(null);
    setIsGenerating(true);

    try {
      const res = await fetch('/api/ai/generate-website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          websiteName: websiteName.trim(),
          category,
          technology,
          designDirection,
          description: description.trim(),
          requirements,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const fallbackMsg =
          res.status === 503
            ? 'The AI model is temporarily unavailable (HTTP 503). Please try again in a moment.'
            : res.status === 429
            ? 'Rate limit or quota reached (HTTP 429). Please wait a moment before trying again.'
            : 'Failed to generate website project. Please retry.';
        throw new Error(data?.error || fallbackMsg);
      }

      if (!data || typeof data !== 'object') {
        throw new Error(
          `Server returned an unexpected non-JSON response (HTTP ${res.status}). Please retry generation.`
        );
      }

      const generated = data?.data;
      if (
        !generated ||
        !Array.isArray(generated.fileManifest) ||
        generated.fileManifest.length === 0
      ) {
        throw new Error(
          'Received an incomplete website manifest from the server. Please retry generation.'
        );
      }

      const validManifest = generated.fileManifest.every(
        (f: any) =>
          f && typeof f.path === 'string' && f.path.trim() && typeof f.content === 'string'
      );
      if (!validManifest) {
        throw new Error(
          'Received malformed files in the website manifest. Please retry generation.'
        );
      }

      if (data?.modelUsed) {
        setLastModelUsed(data.modelUsed);
      }
      setLastRepairAttempts(Number(data?.repairAttemptsUsed || 0));

      const now = new Date().toISOString();
      const newProjectId = `web_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

      const newRecord: WebsiteProjectRecord = {
        id: newProjectId,
        ownerId: currentUser?.uid || 'guest_engineer_demo',
        name: websiteName.trim(),
        category,
        technology,
        designDirection,
        description: description.trim(),
        requirements,
        summary: generated.summary,
        fileManifest: generated.fileManifest,
        createdAt: now,
        updatedAt: now,
      };

      await saveWebsiteProject(newRecord);
      if (currentUser?.uid) {
        await logActivity(
          currentUser.uid,
          'website',
          `Generated website '${websiteName.trim()}' (${category}/${technology})`,
          newProjectId,
          'websiteProject'
        );
      }

      setCurrentProject(newRecord);
      setPublishedSnapshot(null);
      if (newRecord.fileManifest.length > 0) {
        const defaultFile =
          newRecord.fileManifest.find(
            (f) => f.path === 'src/App.jsx' || f.path === 'src/App.tsx'
          ) || newRecord.fileManifest[0];
        setSelectedFilePath(defaultFile.path);
        setEditedContent(defaultFile.content);
        setHasUnsavedEdits(false);
      }
      setViewMode('preview');

      const repairNote =
        Number(data?.repairAttemptsUsed || 0) > 0
          ? ` (${data.repairAttemptsUsed} auto-repair pass applied)`
          : '';
      const fallbackNote = data?.modelFallbackNotice ? ` · ${data.modelFallbackNotice}` : '';
      setStatusBanner(
        `Generated & verified ${newRecord.fileManifest.length}-file website "${newRecord.name}" using ${
          data?.modelUsed || 'gemini-4-hydrogen'
        }${repairNote}${fallbackNote}.`
      );
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || 'Error occurred while generating website.');
    } finally {
      generatingRef.current = false;
      setIsGenerating(false);
    }
  };

  // Publish Preview workflow: validates compiled preview, verifies durable persistence, and opens in new tab
  const handlePublishPreview = async (openInNewTab = true) => {
    if (!currentProject) return;
    const eligibility = canPublishWebsiteProject(currentProject, compileResult, runtimeError);
    if (!eligibility.canPublish) {
      setErrorMessage(
        eligibility.reason ||
          'Cannot publish preview until all compilation and runtime errors are resolved.'
      );
      return;
    }

    setIsPublishing(true);
    setErrorMessage(null);

    try {
      const ownerId = currentUser?.uid || currentProject.ownerId || 'guest_engineer_demo';
      const nextVersion =
        (publishedSnapshot?.snapshotVersion || currentProject.snapshotVersion || 0) + 1;

      const snapshotRes = createPublishedWebsiteSnapshot(
        {
          ...currentProject,
          ownerId,
        },
        {
          snapshotVersion: nextVersion,
          isPublic: isPublicShare,
        }
      );

      if (!snapshotRes.success) {
        throw new Error(snapshotRes.error);
      }

      const initialSnapshot = snapshotRes.snapshot;

      const isProductionBuild = Boolean(import.meta.env.PROD);

      if (isProductionBuild && (currentUser?.isGuest || !auth.currentUser)) {
        throw new Error(
          'Sign in with Google or Email to publish persistently to Cloud Firestore. Guest sessions cannot persist shared previews across deployed server instances.'
        );
      }

      // Obtain Firebase ID token when signed in so backend verifies caller identity
      const idToken = auth.currentUser
        ? await auth.currentUser.getIdToken().catch(() => null)
        : null;

      // 1. Register snapshot on backend API (verifies Firebase ID token, enforces ownership, persists to Firestore REST in prod)
      let serverSaved = false;
      let serverFirestoreSaved = false;
      let serverError: string | null = null;
      let finalSnapshot: PublishedWebsiteSnapshot = initialSnapshot;

      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (idToken) {
          headers.Authorization = `Bearer ${idToken}`;
        }

        const serverRes = await fetch(`/api/published/${encodeURIComponent(currentProject.id)}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ownerId: initialSnapshot.ownerId,
            name: initialSnapshot.name,
            category: initialSnapshot.category,
            framework: initialSnapshot.framework,
            technology: initialSnapshot.technology,
            designDirection: initialSnapshot.designDirection,
            description: initialSnapshot.description,
            summary: initialSnapshot.summary,
            fileManifest: initialSnapshot.fileManifest,
            entryHtml: initialSnapshot.entryHtml,
            dependencies: initialSnapshot.dependencies,
            compiledHtml: initialSnapshot.compiledHtml,
            publishedAt: initialSnapshot.publishedAt,
            publishedUrl: initialSnapshot.publishedUrl,
            snapshotVersion: initialSnapshot.snapshotVersion,
            isPublic: initialSnapshot.isPublic,
          }),
        });

        const serverPayload = await serverRes.json().catch(() => null);
        if (serverRes.ok && serverPayload?.snapshot) {
          serverSaved = true;
          serverFirestoreSaved = Boolean(serverPayload?.persistence?.firestoreRest);
          finalSnapshot = {
            ...initialSnapshot,
            ...serverPayload.snapshot,
            publishedUrl: initialSnapshot.publishedUrl,
          };
        } else {
          serverError =
            serverPayload?.error ||
            `Server returned HTTP ${serverRes.status} while storing published preview.`;
        }
      } catch (netErr: any) {
        serverError = netErr?.message || 'Network error saving published preview to server.';
      }

      // 2. If backend Firestore REST write did not run (e.g. offline/fallback), persist directly via client SDK
      const fsResult = serverFirestoreSaved
        ? { firestoreSaved: true as const }
        : await savePublishedWebsiteToFirestore(finalSnapshot);

      const firestorePersisted = serverFirestoreSaved || fsResult.firestoreSaved;

      // In production builds, require Cloud Firestore persistence explicitly (never accept local JSON/memory)
      if (isProductionBuild && !firestorePersisted) {
        throw new Error(
          fsResult.error ||
            serverError ||
            'Cloud Firestore failed to persist your published preview. Check Firestore rules deployment and authentication.'
        );
      }

      // In local development, still fail loudly unless either Firestore or dev server store confirmed persistence
      if (!firestorePersisted && !serverSaved) {
        throw new Error(
          fsResult.error ||
            serverError ||
            'Failed to durably persist published website snapshot. Please retry.'
        );
      }

      // 3. Persist published metadata on the owner's `websiteProjects` record
      const updatedRecord: WebsiteProjectRecord = {
        ...currentProject,
        isPublished: true,
        publishedAt: finalSnapshot.publishedAt,
        publishedUrl: finalSnapshot.publishedUrl,
        publishedManifest: finalSnapshot.fileManifest,
        snapshotVersion: finalSnapshot.snapshotVersion,
        isPublic: finalSnapshot.isPublic,
        updatedAt: finalSnapshot.publishedAt,
      };

      await updateWebsiteProject(
        currentProject.id,
        {
          isPublished: true,
          publishedAt: finalSnapshot.publishedAt,
          publishedUrl: finalSnapshot.publishedUrl,
          publishedManifest: finalSnapshot.fileManifest,
          snapshotVersion: finalSnapshot.snapshotVersion,
          isPublic: finalSnapshot.isPublic,
        },
        ownerId
      );

      // 4. Update owner browser cache as a local speed cache
      savePublishedWebsiteSnapshot(finalSnapshot);

      if (currentUser?.uid) {
        await logActivity(
          currentUser.uid,
          'website',
          `Published v${finalSnapshot.snapshotVersion} preview for '${currentProject.name}' (${
            finalSnapshot.isPublic ? 'Public Share' : 'Owner Only'
          }) at ${finalSnapshot.publishedUrl}`,
          currentProject.id,
          'websiteProject'
        );
      }

      setCurrentProject(updatedRecord);
      setPublishedSnapshot(finalSnapshot);

      const syncNote = firestorePersisted
        ? 'Verified on Cloud Firestore.'
        : fsResult.pendingRulesDeployment
        ? 'Saved in local dev store only (deploy Firestore publishedWebsites rules for production cloud persistence).'
        : 'Saved in local dev store only.';

      setStatusBanner(
        `Published v${finalSnapshot.snapshotVersion} (${
          finalSnapshot.isPublic ? 'Public Share' : 'Owner Only'
        }) ready at ${finalSnapshot.publishedUrl}. ${syncNote}`
      );

      if (openInNewTab && typeof window !== 'undefined') {
        try {
          const anchor = document.createElement('a');
          anchor.href = finalSnapshot.publishedUrl;
          anchor.target = '_blank';
          anchor.rel = 'noopener noreferrer';
          document.body.appendChild(anchor);
          anchor.click();
          document.body.removeChild(anchor);
        } catch {
          // Link also remains immediately clickable in the Published Preview banner
        }
      }
    } catch (err: any) {
      console.error('Publish preview failed:', err);
      setErrorMessage(err.message || 'Failed to publish website preview.');
    } finally {
      setIsPublishing(false);
    }
  };

  const handleCopyPublishedLink = () => {
    if (!publishedSnapshot) return;
    navigator.clipboard.writeText(publishedSnapshot.publishedUrl);
    setCopiedPublishedLink(true);
    setTimeout(() => setCopiedPublishedLink(false), 2000);
  };

  // Select a file in the explorer (with unsaved changes protection)
  const handleSelectFile = (targetPath: string) => {
    if (targetPath === selectedFilePath) return;
    if (hasUnsavedEdits) {
      setPendingFileSwitch(targetPath);
      return;
    }
    switchToFile(targetPath);
  };

  const switchToFile = (
    targetPath: string,
    manifestOverride?: WebsiteProjectRecord['fileManifest']
  ) => {
    const manifest = manifestOverride || currentProject?.fileManifest || [];
    const target = manifest.find((f) => f.path === targetPath);
    setSelectedFilePath(targetPath);
    setEditedContent(target ? target.content : '');
    setHasUnsavedEdits(false);
    setPendingFileSwitch(null);
  };

  // Save current file edits & re-compile preview
  const handleSaveFileChanges = async (switchAfterPath?: string | null) => {
    if (!currentProject || !selectedFilePath) return;
    setIsSavingFile(true);
    setErrorMessage(null);

    try {
      const updatedManifest = currentProject.fileManifest.map((file) =>
        file.path === selectedFilePath ? { ...file, content: editedContent } : file
      );

      await updateWebsiteProject(
        currentProject.id,
        {
          fileManifest: updatedManifest,
        },
        currentUser?.uid || currentProject.ownerId
      );

      const updatedProject: WebsiteProjectRecord = {
        ...currentProject,
        fileManifest: updatedManifest,
        updatedAt: new Date().toISOString(),
      };

      setCurrentProject(updatedProject);
      setHasUnsavedEdits(false);
      setPreviewRefreshKey((k) => k + 1);
      setStatusBanner(`Saved changes to ${selectedFilePath} and refreshed preview.`);

      if (switchAfterPath) {
        switchToFile(switchAfterPath, updatedManifest);
      }
    } catch (err: any) {
      console.error(err);
      setErrorMessage('Failed to save file modifications.');
    } finally {
      setIsSavingFile(false);
    }
  };

  // Jump from error panel directly to the file in editor
  const handleOpenErrorInEditor = (filePath: string) => {
    if (!currentProject) return;
    const match = currentProject.fileManifest.find((f) => f.path === filePath);
    if (match) {
      setSelectedFilePath(match.path);
      setEditedContent(match.content);
      setHasUnsavedEdits(false);
    }
    setViewMode('code');
  };

  // Handle Project Rename
  const handleRename = async () => {
    if (!currentProject || !newName.trim()) return;
    try {
      await updateWebsiteProject(
        currentProject.id,
        { name: newName.trim() },
        currentUser?.uid || currentProject.ownerId
      );
      setCurrentProject((prev) => (prev ? { ...prev, name: newName.trim() } : null));
      setWebsiteName(newName.trim());
      setIsRenaming(false);
    } catch (err: any) {
      setErrorMessage('Failed to rename project.');
    }
  };

  // Handle Project Deletion via ConfirmModal
  const handleConfirmDelete = async () => {
    if (!currentProject) return;
    setIsDeleting(true);
    try {
      await deleteWebsiteProject(
        currentProject.id,
        currentUser?.uid || currentProject.ownerId
      );
      if (currentUser?.uid) {
        await logActivity(
          currentUser.uid,
          'website',
          `Deleted website project '${currentProject.name}'`,
          currentProject.id,
          'websiteProject'
        );
      }
      setCurrentProject(null);
      setCompileResult(null);
      setPublishedSnapshot(null);
      setIsDeleteModalOpen(false);
    } catch (err: any) {
      setErrorMessage('Failed to delete project.');
    } finally {
      setIsDeleting(false);
    }
  };

  const selectedFile = currentProject?.fileManifest.find((f) => f.path === selectedFilePath);

  const handleCopyCode = () => {
    if (selectedFile) {
      navigator.clipboard.writeText(editedContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const hasCompilationErrors =
    (compileResult && (!compileResult.success || compileResult.errors.length > 0)) ||
    Boolean(runtimeError);

  const publishEligibility = canPublishWebsiteProject(currentProject, compileResult, runtimeError);
  const diagnosticCount = (compileResult?.errors.length || 0) + (runtimeError ? 1 : 0);

  return (
    <div data-tour="website-studio-panel" className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-zinc-800/80">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-violet-400 uppercase tracking-wider mb-1">
            <Globe size={16} />
            <span>Agent 02 · Website Builder</span>
            <span className="px-2 py-0.5 rounded bg-violet-500/15 border border-violet-500/30 text-violet-300 font-mono text-[10px] normal-case">
              Model: {lastModelUsed}
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            Web Application & Site Generator
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            Generate complete React/Vite and HTML/CSS web projects with Hydrogen structured
            synthesis, automatic source repair, isolated preview compilation, and durable Publish
            Preview.
          </p>
        </div>

        {currentProject && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                setNewName(currentProject.name);
                setIsRenaming(true);
              }}
              className="p-2 rounded-lg border border-zinc-800 hover:bg-zinc-900 text-zinc-300 text-xs transition-colors"
              title="Rename project"
              aria-label="Rename project"
            >
              <Edit2 size={14} />
            </button>
            <button
              onClick={() => setIsDeleteModalOpen(true)}
              className="p-2 rounded-lg border border-zinc-800 hover:bg-rose-500/10 hover:text-rose-400 text-zinc-400 text-xs transition-colors"
              title="Delete project"
              aria-label="Delete project"
            >
              <Trash2 size={14} />
            </button>

            <button
              type="button"
              onClick={() => setIsPublicShare((prev) => !prev)}
              data-testid="publish-visibility-toggle"
              className="px-2.5 py-1.5 rounded-lg border border-zinc-800 bg-[#111116] hover:bg-zinc-900 text-zinc-300 text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
              title="Toggle whether the published preview URL is publicly viewable across tabs/incognito or restricted to your account"
            >
              {isPublicShare ? (
                <>
                  <Unlock size={13} className="text-emerald-400" />
                  <span>Public Share</span>
                </>
              ) : (
                <>
                  <Lock size={13} className="text-amber-400" />
                  <span>Owner Only</span>
                </>
              )}
            </button>

            <button
              onClick={() =>
                downloadProjectZip(currentProject.name, currentProject.fileManifest)
              }
              data-testid="download-zip-button"
              className="px-3.5 py-1.5 rounded-lg border border-violet-500/40 bg-violet-500/10 hover:bg-violet-500/20 text-violet-200 text-xs font-medium flex items-center gap-1.5 transition-all"
            >
              <Download size={14} />
              <span>Download ZIP</span>
            </button>

            {publishEligibility.canPublish && (
              <button
                type="button"
                onClick={() => handlePublishPreview(true)}
                disabled={isPublishing}
                data-testid="publish-preview-button"
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md shadow-emerald-600/25 disabled:opacity-50"
                title="Publish a durable standalone preview and open it in a new browser tab"
              >
                {isPublishing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Rocket size={14} />
                )}
                <span>Publish Preview</span>
                <ExternalLink size={12} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Published Preview Status Bar */}
      {currentProject && publishedSnapshot && (
        <div
          data-testid="published-preview-bar"
          className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-start sm:items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 shrink-0">
              <Link2 size={16} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-emerald-300">
                  Published Preview Active (v{publishedSnapshot.snapshotVersion || 1})
                </span>
                <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-200 text-[10px] font-mono">
                  {publishedSnapshot.isPublic !== false ? 'Public Share Link' : 'Owner Only'}
                </span>
              </div>
              <div
                data-testid="published-preview-url"
                className="text-xs font-mono text-zinc-200 truncate mt-0.5"
              >
                {publishedSnapshot.publishedUrl}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopyPublishedLink}
              data-testid="copy-published-link"
              className="px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200 text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
            >
              {copiedPublishedLink ? (
                <>
                  <Check size={13} className="text-emerald-400" />
                  <span>Copied Link</span>
                </>
              ) : (
                <>
                  <Copy size={13} />
                  <span>Copy Link</span>
                </>
              )}
            </button>

            <a
              href={publishedSnapshot.publishedUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="open-published-site"
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors shadow-sm"
            >
              <span>Open Published Site</span>
              <ExternalLink size={12} />
            </a>
          </div>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="p-3.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center justify-between gap-2.5"
        >
          <div className="flex items-center gap-2.5">
            <AlertCircle size={16} className="text-rose-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-rose-400 hover:text-white text-[11px]"
          >
            Dismiss
          </button>
        </div>
      )}

      {statusBanner && (
        <div
          role="status"
          className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center justify-between gap-2.5"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
            <span>{statusBanner}</span>
          </div>
          <button
            onClick={() => setStatusBanner(null)}
            className="text-emerald-400 hover:text-white text-[11px]"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Grid: Form (4 cols) & Workspace (8 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Form */}
        <div className="lg:col-span-4 space-y-4">
          <form
            onSubmit={handleGenerate}
            className="p-5 rounded-2xl bg-[#111116] border border-zinc-800/80 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-200">
                Website Specification
              </span>
              <span className="text-[11px] text-violet-400 font-mono">Hydrogen Engine</span>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">Website Name</label>
              <input
                type="text"
                value={websiteName}
                onChange={(e) => setWebsiteName(e.target.value)}
                placeholder="CloudPulse"
                required
                className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-200 text-xs focus:outline-none focus:border-violet-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-200 text-xs focus:outline-none focus:border-violet-500"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Technology</label>
                <select
                  value={technology}
                  onChange={(e) => setTechnology(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-200 text-xs focus:outline-none focus:border-violet-500"
                >
                  {TECHNOLOGIES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Design Direction
              </label>
              <select
                value={designDirection}
                onChange={(e) => setDesignDirection(e.target.value)}
                className="w-full px-2.5 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-200 text-xs focus:outline-none focus:border-violet-500"
              >
                {DESIGN_DIRECTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Target audience, main features, messaging..."
                required
                className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-200 text-xs focus:outline-none focus:border-violet-500 resize-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Special Requirements
              </label>
              <textarea
                value={requirements}
                onChange={(e) => setRequirements(e.target.value)}
                rows={3}
                placeholder="Specific sections, components, animations..."
                className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-200 text-xs focus:outline-none focus:border-violet-500 resize-none font-mono"
              />
            </div>

            <div className="space-y-2 pt-1">
              <button
                type="submit"
                disabled={isGenerating}
                className="w-full py-2.5 px-4 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium text-xs transition-all shadow-md shadow-violet-600/20 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isGenerating ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    <span>Synthesizing Website Project...</span>
                  </>
                ) : (
                  <>
                    <Wand2 size={15} />
                    <span>Generate Website</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleLoadSampleProject}
                disabled={isGenerating}
                className="w-full py-2 px-4 rounded-lg border border-violet-500/30 bg-violet-500/10 hover:bg-violet-500/20 text-violet-300 font-medium text-xs transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Sparkles size={14} />
                <span>Load Sample React/Vite Project</span>
              </button>
            </div>
          </form>
        </div>

        {/* Right Area: Code Explorer, Diagnostics & Isolated Compiler Preview */}
        <div className="lg:col-span-8 flex flex-col rounded-2xl bg-[#111116] border border-zinc-800/80 overflow-hidden min-h-[620px]">
          {currentProject ? (
            <div className="flex-1 flex flex-col">
              {/* Top View Toggle & Compiler Status Bar */}
              <div className="px-4 py-2.5 border-b border-zinc-800/80 bg-[#0d0d12] flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1 p-1 bg-[#09090b] border border-zinc-800/80 rounded-lg">
                    <button
                      onClick={() => setViewMode('preview')}
                      data-testid="tab-live-preview"
                      className={`px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${
                        viewMode === 'preview'
                          ? 'bg-violet-600 text-white shadow-sm'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      <Eye size={13} />
                      <span>Live Preview</span>
                    </button>
                    <button
                      onClick={() => setViewMode('code')}
                      data-testid="tab-source-code"
                      className={`px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${
                        viewMode === 'code'
                          ? 'bg-violet-600 text-white shadow-sm'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      <Code size={13} />
                      <span>Source Code ({currentProject.fileManifest.length})</span>
                      {hasUnsavedEdits && (
                        <span
                          className="w-2 h-2 rounded-full bg-amber-400"
                          title="Unsaved changes in editor"
                        />
                      )}
                    </button>
                    <button
                      onClick={() => setViewMode('diagnostics')}
                      data-testid="tab-diagnostics"
                      className={`px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${
                        viewMode === 'diagnostics'
                          ? 'bg-violet-600 text-white shadow-sm'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      <Terminal size={13} />
                      <span>Compilation Diagnostics ({diagnosticCount})</span>
                    </button>
                  </div>

                  {/* Compiler Status Indicator */}
                  {isCompiling ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-500/10 border border-blue-500/20 text-blue-300 text-[11px]">
                      <Loader2 size={12} className="animate-spin" />
                      <span>Compiling...</span>
                    </span>
                  ) : hasCompilationErrors ? (
                    <span
                      data-testid="compiler-status-error"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[11px] font-medium"
                    >
                      <AlertTriangle size={12} className="text-rose-400" />
                      <span>
                        Compilation Failed ({diagnosticCount} error
                        {diagnosticCount === 1 ? '' : 's'})
                      </span>
                    </span>
                  ) : compileResult ? (
                    <span
                      data-testid="compiler-status-ok"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px]"
                      title="Opaque origin sandbox (allow-scripts without allow-same-origin) + strict CSP"
                    >
                      <ShieldCheck size={12} className="text-emerald-400" />
                      <span>
                        Compiled ({compileResult.resolvedModules.length} modules ·{' '}
                        {compileResult.compileTimeMs}ms
                        {lastRepairAttempts > 0 ? ` · ${lastRepairAttempts} auto-repair` : ''})
                      </span>
                    </span>
                  ) : null}
                </div>

                {viewMode === 'preview' && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPreviewRefreshKey((k) => k + 1)}
                      data-testid="refresh-preview-button"
                      className="px-2.5 py-1 rounded-lg border border-zinc-800 hover:bg-zinc-900 text-zinc-300 hover:text-white text-xs flex items-center gap-1.5 transition-colors"
                      title="Recompile and refresh preview"
                    >
                      <RefreshCw size={12} />
                      <span>Refresh Preview</span>
                    </button>

                    {publishEligibility.canPublish && (
                      <button
                        type="button"
                        onClick={() => handlePublishPreview(true)}
                        data-testid="open-in-new-tab-button"
                        className="px-2.5 py-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 text-xs flex items-center gap-1.5 transition-colors"
                        title="Publish preview and open in new browser tab"
                      >
                        <ExternalLink size={12} />
                        <span>Open in New Tab</span>
                      </button>
                    )}

                    <div className="flex items-center gap-1 bg-[#09090b] border border-zinc-800 p-1 rounded-lg">
                      <button
                        onClick={() => setPreviewViewport('desktop')}
                        className={`p-1.5 rounded text-xs transition-colors ${
                          previewViewport === 'desktop'
                            ? 'bg-violet-600 text-white'
                            : 'text-zinc-400 hover:text-white'
                        }`}
                        title="Desktop viewport (100%)"
                        aria-label="Desktop viewport"
                      >
                        <Laptop size={14} />
                      </button>
                      <button
                        onClick={() => setPreviewViewport('tablet')}
                        className={`p-1.5 rounded text-xs transition-colors ${
                          previewViewport === 'tablet'
                            ? 'bg-violet-600 text-white'
                            : 'text-zinc-400 hover:text-white'
                        }`}
                        title="Tablet viewport (768px)"
                        aria-label="Tablet viewport"
                      >
                        <Tablet size={14} />
                      </button>
                      <button
                        onClick={() => setPreviewViewport('mobile')}
                        className={`p-1.5 rounded text-xs transition-colors ${
                          previewViewport === 'mobile'
                            ? 'bg-violet-600 text-white'
                            : 'text-zinc-400 hover:text-white'
                        }`}
                        title="Mobile viewport (390px)"
                        aria-label="Mobile viewport"
                      >
                        <Smartphone size={14} />
                      </button>
                    </div>
                  </div>
                )}

                {viewMode === 'code' && selectedFile && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSaveFileChanges(null)}
                      disabled={isSavingFile}
                      className={`px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
                        hasUnsavedEdits
                          ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm'
                          : 'bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 border border-violet-500/30'
                      }`}
                    >
                      {isSavingFile ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Play size={12} />
                      )}
                      <span>Apply & Refresh Preview</span>
                    </button>

                    <button
                      onClick={handleCopyCode}
                      className="p-1.5 rounded text-zinc-400 hover:text-white hover:bg-white/5 text-xs flex items-center gap-1"
                    >
                      {copied ? (
                        <>
                          <Check size={13} className="text-emerald-400" />
                          <span className="text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy size={13} />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => downloadSingleFile(selectedFile.path, editedContent)}
                      className="p-1.5 rounded text-zinc-400 hover:text-white hover:bg-white/5 text-xs flex items-center gap-1"
                    >
                      <Download size={13} />
                      <span>Download</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Compilation & Runtime Diagnostics Error Panel */}
              {hasCompilationErrors && viewMode !== 'diagnostics' && (
                <div
                  data-testid="compilation-error-panel"
                  className="bg-rose-950/30 border-b border-rose-500/30 p-4 space-y-3 max-h-64 overflow-y-auto"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-rose-400 text-xs font-semibold uppercase tracking-wider">
                      <Terminal size={14} />
                      <span>Compiler & Preview Diagnostics</span>
                    </div>
                    <span className="text-[11px] text-rose-300/80">
                      Fix the issue in Source Code and click Apply & Refresh Preview
                    </span>
                  </div>

                  <div className="space-y-2">
                    {compileResult?.errors.map((err, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-lg bg-[#09090b] border border-rose-500/30 text-xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 font-mono">
                            <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-bold">
                              {err.type}
                            </span>
                            <span className="text-zinc-200 font-semibold">{err.file}</span>
                            {err.line && (
                              <span className="text-zinc-400">
                                :{err.line}
                                {err.column ? `:${err.column}` : ''}
                              </span>
                            )}
                          </div>
                          <button
                            onClick={() => handleOpenErrorInEditor(err.file)}
                            className="px-2.5 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-[11px] font-medium transition-colors"
                          >
                            Open in Editor
                          </button>
                        </div>
                        <p className="text-rose-200 font-mono text-[11px]">{err.message}</p>
                        {err.snippet && (
                          <pre className="p-2 rounded bg-black/50 border border-white/5 text-zinc-300 font-mono text-[11px] overflow-x-auto">
                            {err.snippet}
                          </pre>
                        )}
                      </div>
                    ))}

                    {runtimeError && (
                      <div className="p-3 rounded-lg bg-[#09090b] border border-rose-500/30 text-xs space-y-1.5">
                        <div className="flex items-center gap-2 font-mono">
                          <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-bold">
                            RUNTIME_ERROR
                          </span>
                          <span className="text-zinc-200 font-semibold">Sandboxed Execution</span>
                        </div>
                        <p className="text-rose-200 font-mono text-[11px]">
                          {runtimeError.message}
                        </p>
                        {runtimeError.stack && (
                          <pre className="p-2 rounded bg-black/50 border border-white/5 text-zinc-400 font-mono text-[10px] overflow-x-auto">
                            {runtimeError.stack}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* View Content */}
              {viewMode === 'preview' ? (
                <div className="flex-1 bg-[#09090b] p-4 flex items-center justify-center overflow-auto">
                  <div
                    className={`h-[560px] bg-zinc-950 rounded-lg border border-zinc-800 shadow-2xl overflow-hidden transition-all duration-200 ${
                      previewViewport === 'mobile'
                        ? 'w-[390px]'
                        : previewViewport === 'tablet'
                        ? 'w-[768px]'
                        : 'w-full'
                    }`}
                  >
                    <iframe
                      ref={iframeRef}
                      key={`${currentProject.id}-${previewRefreshKey}`}
                      title="Sandboxed Website Preview"
                      srcDoc={compileResult?.compiledHtml || ''}
                      sandbox="allow-scripts"
                      className="w-full h-full border-none bg-zinc-950"
                    />
                  </div>
                </div>
              ) : viewMode === 'diagnostics' ? (
                <div
                  data-testid="diagnostics-tab-panel"
                  className="flex-1 bg-[#09090b] p-6 overflow-y-auto space-y-5"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-zinc-800/80">
                    <div>
                      <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                        <Terminal size={15} className="text-violet-400" />
                        <span>Compilation & Module Resolution Report</span>
                      </h3>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        Inspect JSX/JS syntax checks, import graph resolution, and sandboxed runtime
                        status.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPreviewRefreshKey((k) => k + 1)}
                      className="px-3 py-1.5 rounded-lg border border-zinc-800 hover:bg-zinc-900 text-zinc-200 text-xs inline-flex items-center gap-1.5"
                    >
                      <RefreshCw size={12} />
                      <span>Re-run Validation</span>
                    </button>
                  </div>

                  {!hasCompilationErrors && compileResult ? (
                    <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/25 space-y-3">
                      <div className="flex items-center gap-2 text-emerald-300 text-xs font-semibold">
                        <CheckCircle2 size={16} className="text-emerald-400" />
                        <span>
                          All {compileResult.resolvedModules.length} project modules passed JSX/JS
                          syntax and import resolution checks ({compileResult.compileTimeMs}ms)
                        </span>
                      </div>
                      <div className="text-xs text-zinc-300">
                        Resolved Modules:{' '}
                        <span className="font-mono text-emerald-200">
                          {compileResult.resolvedModules.join(', ')}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div
                      data-testid="compilation-error-panel"
                      className="space-y-3"
                    >
                      {compileResult?.errors.map((err, idx) => (
                        <div
                          key={idx}
                          className="p-4 rounded-xl bg-rose-950/30 border border-rose-500/30 text-xs space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 font-mono">
                              <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-bold">
                                {err.type}
                              </span>
                              <span className="text-white font-semibold">{err.file}</span>
                              {err.line && (
                                <span className="text-zinc-400">
                                  line {err.line}
                                  {err.column ? `, col ${err.column}` : ''}
                                </span>
                              )}
                            </div>
                            <button
                              onClick={() => handleOpenErrorInEditor(err.file)}
                              className="px-3 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-xs font-medium"
                            >
                              Open in Editor
                            </button>
                          </div>
                          <p className="text-rose-200 font-mono">{err.message}</p>
                          {err.snippet && (
                            <pre className="p-2.5 rounded bg-black/60 border border-white/5 text-zinc-300 font-mono text-[11px] overflow-x-auto">
                              {err.snippet}
                            </pre>
                          )}
                        </div>
                      ))}

                      {runtimeError && (
                        <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-500/30 text-xs space-y-2">
                          <div className="flex items-center gap-2 font-mono">
                            <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-bold">
                              RUNTIME_ERROR
                            </span>
                            <span className="text-white font-semibold">Sandboxed Execution</span>
                          </div>
                          <p className="text-rose-200 font-mono">{runtimeError.message}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex-1 flex flex-col md:flex-row min-h-[520px]">
                  {/* File Explorer */}
                  <div className="w-full md:w-60 border-b md:border-b-0 md:border-r border-zinc-800/80 bg-[#0d0d12] p-3 shrink-0">
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-zinc-800/70">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                        <Folder size={13} className="text-violet-400" />
                        <span>Manifest</span>
                      </span>
                      <span className="text-[10px] text-zinc-500">
                        {currentProject.fileManifest.length} files
                      </span>
                    </div>

                    <div className="space-y-0.5 overflow-y-auto max-h-[300px] md:max-h-[500px]">
                      {currentProject.fileManifest.map((file) => {
                        const isSelected = file.path === selectedFilePath;
                        const fileHasError = compileResult?.errors.some(
                          (e) => e.file === file.path
                        );
                        return (
                          <button
                            key={file.path}
                            onClick={() => handleSelectFile(file.path)}
                            className={`w-full text-left px-2 py-1.5 rounded-md text-xs font-mono flex items-center justify-between gap-2 truncate transition-colors ${
                              isSelected
                                ? 'bg-violet-600/20 text-violet-300 font-semibold border border-violet-500/30'
                                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03]'
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate">
                              <FileCode
                                size={13}
                                className={`shrink-0 ${
                                  fileHasError ? 'text-rose-400' : 'text-zinc-500'
                                }`}
                              />
                              <span className="truncate">{file.path}</span>
                            </div>
                            {fileHasError && (
                              <span
                                className="w-2 h-2 rounded-full bg-rose-500 shrink-0"
                                title="File has compilation error"
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Interactive Source Code Editor */}
                  <div className="flex-1 flex flex-col bg-[#09090b]">
                    {selectedFile ? (
                      <>
                        <div className="px-4 py-2 border-b border-zinc-800/70 bg-[#0d0d12] flex items-center justify-between text-[11px] text-zinc-400 font-mono">
                          <div className="flex items-center gap-2">
                            <span className="text-zinc-200 font-semibold">
                              {selectedFile.path}
                            </span>
                            {hasUnsavedEdits && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px] font-sans">
                                Unsaved Edits
                              </span>
                            )}
                          </div>
                          <span>{editedContent.split('\n').length} lines</span>
                        </div>

                        <div className="flex-1 flex relative overflow-hidden">
                          <div className="select-none py-4 px-3 text-zinc-600 text-right border-r border-zinc-800/70 font-mono text-xs leading-relaxed bg-[#0c0c10] overflow-hidden">
                            {editedContent.split('\n').map((_, idx) => (
                              <div key={idx}>{idx + 1}</div>
                            ))}
                          </div>
                          <textarea
                            aria-label={`Source code editor for ${selectedFile.path}`}
                            value={editedContent}
                            onChange={(e) => {
                              setEditedContent(e.target.value);
                              setHasUnsavedEdits(e.target.value !== selectedFile.content);
                            }}
                            spellCheck={false}
                            className="flex-1 p-4 bg-[#09090b] text-zinc-200 font-mono text-xs leading-relaxed focus:outline-none resize-none overflow-auto whitespace-pre"
                          />
                        </div>
                      </>
                    ) : (
                      <div className="h-full flex items-center justify-center text-zinc-600 text-xs">
                        Select a file to inspect and edit.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-zinc-500">
              <div className="w-12 h-12 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-400 flex items-center justify-center mb-3">
                <Globe size={24} />
              </div>
              <h3 className="text-base font-semibold text-white">No Website Project Active</h3>
              <p className="text-xs text-zinc-400 max-w-sm mt-1">
                Configure your requirements on the left and click "Generate Website" or "Load Sample
                React/Vite Project" to launch the multi-file compiler and isolated preview.
              </p>
              <button
                type="button"
                onClick={handleLoadSampleProject}
                className="mt-4 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium inline-flex items-center gap-2 shadow-md shadow-violet-600/20"
              >
                <Sparkles size={14} />
                <span>Load Sample React/Vite Project</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Accessible Rename Modal */}
      <ModalDialog
        isOpen={isRenaming}
        onClose={() => setIsRenaming(false)}
        title="Rename Website Project"
        description="Update the display title for this website project across your workspace."
        footer={
          <>
            <button
              type="button"
              onClick={() => setIsRenaming(false)}
              className="px-3.5 py-1.5 rounded-lg border border-white/10 text-slate-300 hover:text-white text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRename}
              className="px-4 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium"
            >
              Save Name
            </button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5">Project Name</label>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-[#07090e] border border-white/10 text-slate-200 text-xs focus:outline-none focus:border-purple-500"
          />
        </div>
      </ModalDialog>

      {/* Accessible Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleConfirmDelete}
        title="Delete Website Project"
        message={`Are you sure you want to permanently delete '${currentProject?.name || ''}'? This action cannot be undone.`}
        confirmLabel="Delete Project"
        cancelLabel="Cancel"
        variant="danger"
        isLoading={isDeleting}
      />

      {/* Accessible Unsaved Changes Modal when switching files */}
      <UnsavedChangesModal
        isOpen={Boolean(pendingFileSwitch)}
        onClose={() => setPendingFileSwitch(null)}
        onDiscard={() => {
          if (pendingFileSwitch) {
            switchToFile(pendingFileSwitch);
          }
        }}
        onSaveAndContinue={async () => {
          if (pendingFileSwitch) {
            await handleSaveFileChanges(pendingFileSwitch);
          }
        }}
        fileName={selectedFilePath}
      />
    </div>
  );
};
