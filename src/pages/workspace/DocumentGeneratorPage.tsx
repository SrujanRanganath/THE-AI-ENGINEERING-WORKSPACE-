import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/authContext';
import {
  saveDocument,
  getDocuments,
  updateDocument,
  deleteDocument,
  logActivity,
  toSafeUserFirestoreErrorMessage,
  DocumentRecord,
} from '../../lib/firestoreService';
import { downloadDocx, parseMarkdownIntoSections } from '../../utils/docxExport';
import { ModalDialog, ConfirmModal } from '../../components/common/ModalPrimitives';
import {
  AgentExecutionMode,
  generateDemoDocumentData,
} from '../../utils/demoModeEngine';
import { getAiRequestHeaders, parseAiFailure, ParsedAiErrorInfo } from '../../lib/aiClient';
import { AgentModeBar, AiUnavailableBanner } from '../../components/common/AgentModeControls';
import {
  FileText,
  Download,
  Copy,
  Check,
  Edit3,
  Edit2,
  Trash2,
  Save,
  AlertCircle,
  Loader2,
  Wand2,
  Sparkles,
  CheckCircle2,
  FilePlus2,
} from 'lucide-react';

export const DOCUMENT_TYPES = [
  'Technical Project Report',
  'Research Paper',
  'Project Proposal',
  'System Architecture Document',
  'Technical Documentation',
  'Business Report',
  'General Document',
];

export const PAGE_COUNT_OPTIONS = [
  'Brief (1-2 pages)',
  'Standard (3-5 pages)',
  'Detailed (6-10 pages)',
  'Comprehensive (12-15+ pages)',
  'Custom page count',
];

export function getSampleDocumentData(
  title = 'AI Engineering Workspace — System Architecture Report',
  documentType = 'Technical Project Report',
  pageCount = 'Standard (3-5 pages)'
) {
  const sections = [
    {
      heading: '1. Executive Summary',
      level: 1 as const,
      paragraphs: [
        'This technical project report documents the multi-agent engineering architecture powering AI Engineering Workspace across code synthesis, React/Vite compilation, prompt-driven documentation, and natural-language data cleaning.',
        'All AI provider interactions execute through server-side Express proxy routes while user artifacts persist inside owner-isolated Cloud Firestore collections.',
      ],
      bullets: [
        'Zero-trust workload isolation for generated React/Vite previews via opaque-origin sandboxes',
        'Non-destructive tabular data cleaning guided by schema-validated AI plans',
        'Native OpenXML (.docx) document compilation with tables, headings, and lists',
      ],
    },
    {
      heading: '2. Four-Agent Architecture Overview',
      level: 2 as const,
      paragraphs: [
        'Each engineering agent operates independently while sharing unified authentication and project persistence:',
      ],
      bullets: [],
    },
    {
      heading: '3. Implementation Milestones',
      level: 2 as const,
      paragraphs: [
        'The delivery sequence below outlines verification checkpoints for final academic review:',
      ],
      bullets: [],
    },
  ];

  const fullMarkdown = `# ${title}

## 1. Executive Summary

This technical project report documents the multi-agent engineering architecture powering AI Engineering Workspace across code synthesis, React/Vite compilation, prompt-driven documentation, and natural-language data cleaning.

All AI provider interactions execute through server-side Express proxy routes while user artifacts persist inside owner-isolated Cloud Firestore collections.

- Zero-trust workload isolation for generated React/Vite previews via opaque-origin sandboxes
- Non-destructive tabular data cleaning guided by schema-validated AI plans
- Native OpenXML (.docx) document compilation with tables, headings, and lists

## 2. Four-Agent Architecture Overview

| Agent | Primary Responsibility | Output Format |
| --- | --- | --- |
| Code Generator | Multi-file software synthesis & diff inspection | .zip Archive |
| Website Generator | React/Vite manifest & sandboxed live preview | .zip + Live URL |
| Document Generator | Prompt-driven structured authoring | .docx & Markdown |
| Data Cleaner | Natural-language tabular profiling & cleaning | .csv & .xlsx |

## 3. Verification & Delivery Checklist

1. Authenticate user session via Firebase Auth and salted HMAC-SHA256 email OTP.
2. Validate AI payloads via structured server-side JSON schemas before rendering.
3. Export compiled artifacts directly without mutating original source inputs.`;

  return {
    title,
    subtitle: `${documentType} · Target Length: ${pageCount}`,
    sections,
    fullMarkdown,
  };
}

/**
 * Render inline **bold** and `code` tokens as safe React nodes without dangerouslySetInnerHTML.
 */
function renderInlineMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-zinc-100">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 font-mono text-[11px] text-violet-300"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

/**
 * Lightweight safe Markdown renderer for document preview (headings, blockquotes, bullets, numbered lists, tables).
 */
const MarkdownDocumentPreview: React.FC<{ content: string; documentTitle?: string }> = ({
  content,
  documentTitle,
}) => {
  const lines = (content || '').split(/\r?\n/);
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let skippedLeadingTitle = false;

  const isTableRow = (line: string) =>
    line.trim().startsWith('|') && line.trim().endsWith('|') && line.trim().length >= 3;
  const isSeparator = (line: string) => {
    if (!isTableRow(line)) return false;
    const cells = line
      .trim()
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim());
    return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
  };
  const splitCells = (line: string) =>
    line
      .trim()
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim());

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      i++;
      continue;
    }

    if (trimmed.startsWith('### ')) {
      nodes.push(
        <h3 key={`h3-${i}`} className="text-sm font-semibold text-zinc-100 pt-3">
          {renderInlineMarkdown(trimmed.slice(4))}
        </h3>
      );
      i++;
      continue;
    }

    if (trimmed.startsWith('## ')) {
      nodes.push(
        <h2
          key={`h2-${i}`}
          className="text-base font-bold text-white pt-4 pb-1 border-b border-zinc-800/80"
        >
          {renderInlineMarkdown(trimmed.slice(3))}
        </h2>
      );
      i++;
      continue;
    }

    if (trimmed.startsWith('# ')) {
      const headingText = trimmed.slice(2).trim();
      if (
        !skippedLeadingTitle &&
        documentTitle &&
        headingText.toLowerCase() === documentTitle.trim().toLowerCase()
      ) {
        skippedLeadingTitle = true;
        i++;
        continue;
      }
      nodes.push(
        <h1 key={`h1-${i}`} className="text-lg font-bold text-white pt-2">
          {renderInlineMarkdown(headingText)}
        </h1>
      );
      i++;
      continue;
    }

    if (trimmed.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        quoteLines.push(lines[i].trim().slice(2).trim());
        i++;
      }
      nodes.push(
        <blockquote
          key={`bq-${i}`}
          className="border-l-2 border-amber-500/70 bg-amber-500/5 px-3.5 py-2.5 rounded-r-lg text-xs text-zinc-300 leading-relaxed space-y-1"
        >
          {quoteLines.map((qLine, qIdx) => (
            <p key={qIdx}>{renderInlineMarkdown(qLine)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    if (isTableRow(trimmed) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const headers = splitCells(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        if (!isSeparator(lines[i])) {
          rows.push(splitCells(lines[i]));
        }
        i++;
      }
      nodes.push(
        <div key={`tbl-${i}`} className="overflow-x-auto my-3 rounded-lg border border-zinc-800">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-[#0d0d12] border-b border-zinc-800">
              <tr>
                {headers.map((h, idx) => (
                  <th key={idx} className="px-3 py-2 font-semibold text-zinc-200">
                    {renderInlineMarkdown(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {rows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-zinc-900/40">
                  {headers.map((_, cIdx) => (
                    <td key={cIdx} className="px-3 py-2 text-zinc-300">
                      {renderInlineMarkdown(row[cIdx] || '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const items: string[] = [];
      while (i < lines.length && (lines[i].trim().startsWith('- ') || lines[i].trim().startsWith('* '))) {
        items.push(lines[i].trim().slice(2).trim());
        i++;
      }
      nodes.push(
        <ul key={`ul-${i}`} className="list-disc pl-5 space-y-1 text-xs text-zinc-300">
          {items.map((item, idx) => (
            <li key={idx}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s+/, ''));
        i++;
      }
      nodes.push(
        <ol key={`ol-${i}`} className="list-decimal pl-5 space-y-1 text-xs text-zinc-300">
          {items.map((item, idx) => (
            <li key={idx}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    nodes.push(
      <p key={`p-${i}`} className="text-xs text-zinc-300 leading-relaxed">
        {renderInlineMarkdown(trimmed)}
      </p>
    );
    i++;
  }

  return <div className="space-y-3">{nodes}</div>;
};

export const DocumentGeneratorPage: React.FC = () => {
  const { currentUser } = useAuth();
  const [searchParams] = useSearchParams();
  const docIdParam = searchParams.get('id');

  // Simplified 4-Field Prompt-Driven Form State
  const [title, setTitle] = useState('');
  const [documentType, setDocumentType] = useState('Technical Project Report');
  const [pageCountOption, setPageCountOption] = useState('Standard (3-5 pages)');
  const [customPageCount, setCustomPageCount] = useState('15 pages');
  const [prompt, setPrompt] = useState('');

  // Generation & Status
  const [executionMode, setExecutionMode] = useState<AgentExecutionMode>('live');
  const [isGenerating, setIsGenerating] = useState(false);
  const generatingRef = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [aiUnavailableError, setAiUnavailableError] = useState<ParsedAiErrorInfo | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Active Document
  const [currentDoc, setCurrentDoc] = useState<DocumentRecord | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [hasPendingCloudSave, setHasPendingCloudSave] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isExportingDocx, setIsExportingDocx] = useState(false);

  // Modals: Rename & Delete
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const effectivePageCount =
    pageCountOption === 'Custom page count'
      ? (customPageCount.trim() || 'Standard (3-5 pages)').slice(0, 64)
      : pageCountOption;

  // Load saved document if ?id= exists
  useEffect(() => {
    async function fetchDoc() {
      const lookupUid = currentUser?.uid || 'guest_engineer_demo';
      if (!docIdParam) return;
      try {
        const list = await getDocuments(lookupUid);
        const match = list.find((d) => d.id === docIdParam);
        if (match) {
          setCurrentDoc(match);
          setHasPendingCloudSave(false);
          setTitle(match.title);
          if (DOCUMENT_TYPES.includes(match.category)) {
            setDocumentType(match.category);
          }
          if (match.length && PAGE_COUNT_OPTIONS.includes(match.length)) {
            setPageCountOption(match.length);
          } else if (match.length) {
            setPageCountOption('Custom page count');
            setCustomPageCount(match.length);
          }
          setEditedContent(match.content);
        }
      } catch (err) {
        console.warn('Could not load document:', err);
      }
    }
    fetchDoc();
  }, [docIdParam, currentUser?.uid]);

  // Reset editor for a fresh document prompt
  const handleNewDocument = () => {
    setCurrentDoc(null);
    setEditedContent('');
    setIsEditing(false);
    setHasPendingCloudSave(false);
    setTitle('');
    setPrompt('');
    setErrorMessage(null);
    setStatusBanner(null);
  };

  const persistGeneratedDocument = async (
    generated: {
      title?: string;
      subtitle?: string;
      category?: string;
      tone?: string;
      sections?: any[];
      fullMarkdown?: string;
    },
    bannerText: string,
    activityVerb = 'Generated document'
  ) => {
    const now = new Date().toISOString();
    const newDocId = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const safeCategory = String(generated.category || documentType).slice(0, 64);
    const safeTone = String(generated.tone || 'AI-Directed').slice(0, 64);
    const safeLength = effectivePageCount.slice(0, 64);

    const newRecord: DocumentRecord = {
      id: newDocId,
      ownerId: currentUser?.uid || 'guest_engineer_demo',
      title: String(generated.title || title.trim()).slice(0, 256),
      subtitle: String(generated.subtitle || '').slice(0, 512),
      category: safeCategory,
      tone: safeTone,
      length: safeLength,
      sections: Array.isArray(generated.sections) ? generated.sections : [],
      content: String(generated.fullMarkdown || ''),
      createdAt: now,
      updatedAt: now,
    };

    // Always render the generated document in the preview immediately,
    // even if Cloud Firestore saving subsequently fails.
    setCurrentDoc(newRecord);
    setEditedContent(newRecord.content);
    setIsEditing(false);

    try {
      await saveDocument(newRecord);
      setHasPendingCloudSave(false);
      if (currentUser?.uid) {
        await logActivity(
          currentUser.uid,
          'document',
          `${activityVerb} '${newRecord.title}' (${safeCategory})`,
          newDocId,
          'document'
        );
      }
      setStatusBanner(bannerText);
    } catch (saveErr) {
      setHasPendingCloudSave(true);
      setStatusBanner(null);
      setErrorMessage(
        toSafeUserFirestoreErrorMessage(
          saveErr,
          'Document generated, but saving failed. Please retry.'
        )
      );
    }
  };

  //Retry saving the current document when a previous save attempt failed
  const handleRetrySaveCurrentDoc = async () => {
    if (!currentDoc) return;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const updatedRecord: DocumentRecord = {
        ...currentDoc,
        content: isEditing ? editedContent : currentDoc.content,
        sections: parseMarkdownIntoSections(isEditing ? editedContent : currentDoc.content),
        updatedAt: new Date().toISOString(),
      };
      await saveDocument(updatedRecord);
      setCurrentDoc(updatedRecord);
      setHasPendingCloudSave(false);
      setIsEditing(false);
      setStatusBanner(`Saved "${updatedRecord.title}" successfully.`);
    } catch (err) {
      setErrorMessage(
        toSafeUserFirestoreErrorMessage(
          err,
          'Document generated, but saving failed. Please retry.'
        )
      );
    } finally {
      setIsSaving(false);
    }
  };

  // Load Sample Document (Zero API Credits)
  const handleLoadSampleDocument = async () => {
    setErrorMessage(null);
    setStatusBanner(null);
    setIsGenerating(true);
    try {
      const sampleTitle =
        title.trim() || 'AI Engineering Workspace — System Architecture Report';
      const generated = getSampleDocumentData(sampleTitle, documentType, effectivePageCount);
      await persistGeneratedDocument(
        {
          ...generated,
          category: documentType,
          tone: 'AI-Directed',
        },
        `Loaded sample document "${generated.title}".`,
        'Loaded sample document'
      );
    } catch (err) {
      setErrorMessage(
        toSafeUserFirestoreErrorMessage(
          err,
          'Document generated, but saving failed. Please retry.'
        )
      );
    } finally {
      setIsGenerating(false);
    }
  };

  // Deterministic Offline Demo Document Generation (Zero AI API calls)
  const runDemoDocumentGeneration = async () => {
    if (generatingRef.current) return;
    if (!title.trim() || !prompt.trim()) {
      setErrorMessage('Document Title and Main Content / Instructions are required.');
      return;
    }

    generatingRef.current = true;
    setErrorMessage(null);
    setAiUnavailableError(null);
    setStatusBanner(null);
    setIsGenerating(true);

    try {
      const demo = generateDemoDocumentData({
        title: title.trim(),
        documentType,
        pageCount: effectivePageCount,
        prompt: prompt.trim(),
      });
      await persistGeneratedDocument(
        demo,
        `[Demo Mode] Generated "${demo.title}" (${effectivePageCount}) locally without live Gemini API calls.`
      );
    } catch (err) {
      setErrorMessage(
        toSafeUserFirestoreErrorMessage(err, 'Failed to generate Demo Mode document.')
      );
    } finally {
      generatingRef.current = false;
      setIsGenerating(false);
    }
  };

  // Live Gemini Document Generation
  const runLiveDocumentGeneration = async () => {
    if (generatingRef.current) return;
    if (!title.trim() || !prompt.trim()) {
      setErrorMessage('Document Title and Main Content / Instructions are required.');
      return;
    }

    generatingRef.current = true;
    setErrorMessage(null);
    setAiUnavailableError(null);
    setStatusBanner(null);
    setIsGenerating(true);

    try {
      const headers = await getAiRequestHeaders();
      const res = await fetch('/api/ai/generate-document', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: title.trim(),
          documentType,
          pageCount: effectivePageCount,
          prompt: prompt.trim(),
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const parsedErr = parseAiFailure(res.status, data, 'Failed to generate document.');
        if (parsedErr.isQuotaOrTransient) {
          setAiUnavailableError(parsedErr);
          if (parsedErr.allModelsExhausted || parsedErr.recommendDemoMode) {
            setExecutionMode('demo');
          }
        } else {
          setErrorMessage(parsedErr.message);
        }
        return;
      }

      const generated = data?.data;
      if (!generated || typeof generated.fullMarkdown !== 'string') {
        setErrorMessage('Server returned an incomplete document payload. Please retry.');
        return;
      }

      const usedModel = data?.modelUsed || 'gemini-3-flash-preview';
      const fallbackNote = data?.modelFallbackNotice ? ` (${data.modelFallbackNotice})` : '';
      await persistGeneratedDocument(
        generated,
        `Generated "${String(generated.title || title.trim())}" (${effectivePageCount}) using ${usedModel}.${fallbackNote}`
      );
    } catch (err) {
      setErrorMessage(
        toSafeUserFirestoreErrorMessage(err, 'Error occurred while generating document.')
      );
    } finally {
      generatingRef.current = false;
      setIsGenerating(false);
    }
  };

  // Generate Document Submit
  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (executionMode === 'demo') {
      await runDemoDocumentGeneration();
    } else {
      await runLiveDocumentGeneration();
    }
  };

  // Save inline markdown edits
  const handleSaveEdits = async () => {
    if (!currentDoc) return;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const updatedSections = parseMarkdownIntoSections(editedContent);
      await updateDocument(currentDoc.id, {
        content: editedContent,
        sections: updatedSections,
      });
      setCurrentDoc((prev) =>
        prev
          ? {
              ...prev,
              content: editedContent,
              sections: updatedSections,
              updatedAt: new Date().toISOString(),
            }
          : null
      );
      setHasPendingCloudSave(false);
      setIsEditing(false);
      setStatusBanner('Saved document updates.');
    } catch (err) {
      setErrorMessage(
        toSafeUserFirestoreErrorMessage(err, 'Failed to save document updates. Please retry.')
      );
    } finally {
      setIsSaving(false);
    }
  };

  // Rename Document
  const handleRename = async () => {
    if (!currentDoc || !newName.trim()) return;
    const trimmedName = newName.trim();
    try {
      await updateDocument(currentDoc.id, { title: trimmedName });
      setCurrentDoc((prev) =>
        prev ? { ...prev, title: trimmedName, updatedAt: new Date().toISOString() } : null
      );
      setTitle(trimmedName);
      setIsRenaming(false);
      setErrorMessage(null);
      setStatusBanner('Document title updated.');
    } catch (err) {
      setIsRenaming(false);
      setErrorMessage(
        toSafeUserFirestoreErrorMessage(err, 'Failed to rename document. Please retry.')
      );
    }
  };

  // Delete Document via ConfirmModal
  const handleConfirmDelete = async () => {
    if (!currentDoc) return;
    setIsDeleting(true);
    try {
      await deleteDocument(currentDoc.id);
      if (currentUser?.uid) {
        await logActivity(
          currentUser.uid,
          'document',
          `Deleted document '${currentDoc.title}'`,
          currentDoc.id,
          'document'
        );
      }
      setCurrentDoc(null);
      setEditedContent('');
      setHasPendingCloudSave(false);
      setIsDeleteModalOpen(false);
      setErrorMessage(null);
      setStatusBanner('Document deleted.');
    } catch (err) {
      setIsDeleteModalOpen(false);
      setErrorMessage(
        toSafeUserFirestoreErrorMessage(err, 'Failed to delete document. Please retry.')
      );
    } finally {
      setIsDeleting(false);
    }
  };

  // Genuine OpenXML .docx Export
  const handleExportDocx = async () => {
    if (!currentDoc) return;
    setIsExportingDocx(true);
    setErrorMessage(null);
    try {
      const markdownToExport = isEditing ? editedContent : currentDoc.content;
      await downloadDocx({
        title: currentDoc.title,
        subtitle: currentDoc.subtitle,
        category: currentDoc.category,
        tone: currentDoc.length || currentDoc.tone || 'Standard',
        sections: currentDoc.sections || [],
        fullMarkdown: markdownToExport,
        author: currentUser?.displayName || 'AI Engineering Workspace',
      });
      setStatusBanner(`Exported "${currentDoc.title}.docx" successfully.`);
    } catch (err: any) {
      console.error(err);
      setErrorMessage('Failed to compile DOCX file.');
    } finally {
      setIsExportingDocx(false);
    }
  };

  const handleCopyMarkdown = () => {
    if (currentDoc) {
      navigator.clipboard.writeText(isEditing ? editedContent : currentDoc.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div data-tour="document-studio-panel" className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-zinc-800/80">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-indigo-400 mb-1">
            <FileText size={15} />
            <span>Agent 03 · Prompt-Driven Document Generator</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            AI Document Publishing Studio
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            Describe your document goals in plain English. AI plans sections, tables, and lists
            automatically—edit live Markdown and export standard Microsoft Word (.docx) files.
          </p>
        </div>

        {currentDoc && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleNewDocument}
              className="px-3 py-1.5 rounded-lg border border-zinc-800 hover:bg-zinc-900 text-xs text-zinc-200 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <FilePlus2 size={13} />
              <span>New Document</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setNewName(currentDoc.title);
                setIsRenaming(true);
              }}
              className="p-2 rounded-lg border border-zinc-800 hover:bg-zinc-900 text-zinc-300 text-xs transition-colors cursor-pointer"
              title="Rename document"
              aria-label="Rename document"
            >
              <Edit2 size={14} />
            </button>
            <button
              type="button"
              onClick={() => setIsDeleteModalOpen(true)}
              className="p-2 rounded-lg border border-zinc-800 hover:bg-rose-500/10 hover:text-rose-400 text-zinc-400 text-xs transition-colors cursor-pointer"
              title="Delete document"
              aria-label="Delete document"
            >
              <Trash2 size={14} />
            </button>
            <button
              type="button"
              onClick={handleCopyMarkdown}
              className="px-3 py-1.5 rounded-lg border border-zinc-800 hover:bg-zinc-900 text-xs text-zinc-300 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              {copied ? (
                <>
                  <Check size={13} className="text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy size={13} />
                  <span>Copy Markdown</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleExportDocx}
              disabled={isExportingDocx}
              data-testid="export-docx-button"
              className="px-3.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm shadow-violet-500/20 disabled:opacity-50 cursor-pointer"
            >
              <Download size={14} />
              <span>{isExportingDocx ? 'Compiling DOCX...' : 'Export DOCX'}</span>
            </button>
          </div>
        )}
      </div>

      <AgentModeBar
        mode={executionMode}
        onModeChange={(nextMode) => {
          setExecutionMode(nextMode);
          setAiUnavailableError(null);
          setErrorMessage(null);
        }}
        agentRole="synthesis"
        disabled={isGenerating}
        accentColor="indigo"
      />

      {aiUnavailableError && (
        <AiUnavailableBanner
          errorInfo={aiUnavailableError}
          isBusy={isGenerating}
          onRetryLive={() => {
            void runLiveDocumentGeneration();
          }}
          onSwitchToDemoAndRun={() => {
            setExecutionMode('demo');
            setAiUnavailableError(null);
            setErrorMessage(null);
            void runDemoDocumentGeneration();
          }}
          onDismiss={() => setAiUnavailableError(null)}
        />
      )}

      {errorMessage && (
        <div
          role="alert"
          className="p-3.5 rounded-lg bg-rose-950/40 border border-rose-500/30 text-rose-200 text-xs flex items-center justify-between gap-2.5"
        >
          <div className="flex items-center gap-2.5">
            <AlertCircle size={16} className="text-rose-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          {currentDoc && hasPendingCloudSave && (
            <button
              type="button"
              onClick={handleRetrySaveCurrentDoc}
              disabled={isSaving}
              data-testid="retry-save-document-button"
              className="px-3 py-1 rounded-md bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-100 text-[11px] font-semibold shrink-0 transition-colors cursor-pointer"
            >
              {isSaving ? 'Saving...' : 'Retry Save'}
            </button>
          )}
        </div>
      )}

      {statusBanner && (
        <div
          role="status"
          className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-emerald-200 text-xs flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
            <span>{statusBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="text-emerald-400 hover:text-white text-[11px]"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Grid: Simple 4-Field Form (4 cols) & Document Preview (8 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Prompt Form */}
        <div className="lg:col-span-4 space-y-4">
          <form
            onSubmit={handleGenerate}
            className="p-5 rounded-2xl bg-[#111116] border border-zinc-800/80 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-200">
                Document Specification
              </span>
              <span className="text-[11px] font-mono text-indigo-400">OpenXML DOCX</span>
            </div>

            <div>
              <label
                htmlFor="doc-title-input"
                className="block text-xs font-medium text-zinc-300 mb-1.5"
              >
                Document Title
              </label>
              <input
                id="doc-title-input"
                data-testid="doc-title-input"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., AI Engineering Workspace System Architecture"
                required
                className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-100 text-xs focus:outline-none focus:border-violet-500"
              />
            </div>

            <div>
              <label
                htmlFor="doc-type-select"
                className="block text-xs font-medium text-zinc-300 mb-1.5"
              >
                Document Type
              </label>
              <select
                id="doc-type-select"
                data-testid="doc-type-select"
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value)}
                className="w-full px-2.5 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-100 text-xs focus:outline-none focus:border-violet-500"
              >
                {DOCUMENT_TYPES.map((typeOption) => (
                  <option key={typeOption} value={typeOption}>
                    {typeOption}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="doc-length-select"
                className="block text-xs font-medium text-zinc-300 mb-1.5"
              >
                Page Count / Document Length
              </label>
              <select
                id="doc-length-select"
                data-testid="doc-length-select"
                value={pageCountOption}
                onChange={(e) => setPageCountOption(e.target.value)}
                className="w-full px-2.5 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-100 text-xs focus:outline-none focus:border-violet-500"
              >
                {PAGE_COUNT_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>

              {pageCountOption === 'Custom page count' && (
                <input
                  type="text"
                  data-testid="doc-custom-page-input"
                  value={customPageCount}
                  onChange={(e) => setCustomPageCount(e.target.value)}
                  placeholder="e.g., 15 pages"
                  aria-label="Custom page count"
                  className="mt-2 w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-100 text-xs focus:outline-none focus:border-violet-500"
                />
              )}
            </div>

            <div>
              <label
                htmlFor="doc-prompt-input"
                className="block text-xs font-medium text-zinc-300 mb-1.5"
              >
                Main Content / Instructions
              </label>
              <textarea
                id="doc-prompt-input"
                data-testid="doc-prompt-input"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={7}
                placeholder="Describe what the document should cover, target audience, key points, architecture details, or any specific sections, tables, or style guidelines you want included..."
                required
                className="w-full px-3 py-2.5 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-100 text-xs focus:outline-none focus:border-violet-500 resize-y leading-relaxed"
              />
            </div>

            <div className="space-y-2 pt-1">
              <button
                type="submit"
                data-testid="generate-document-button"
                disabled={isGenerating}
                className="w-full py-2.5 px-4 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold text-xs transition-all shadow-md shadow-violet-600/20 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                {isGenerating ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    <span>Generating Document...</span>
                  </>
                ) : (
                  <>
                    <Wand2 size={15} />
                    <span>
                      {executionMode === 'demo'
                        ? 'Generate Document (Demo Mode)'
                        : 'Generate Document'}
                    </span>
                  </>
                )}
              </button>

              <button
                type="button"
                data-testid="load-sample-document-button"
                onClick={handleLoadSampleDocument}
                disabled={isGenerating}
                className="w-full py-2 px-4 rounded-lg border border-zinc-800 bg-[#09090b] hover:bg-zinc-900 text-zinc-300 hover:text-white font-medium text-xs transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                <Sparkles size={14} className="text-violet-400" />
                <span>Load Sample Technical Document</span>
              </button>
            </div>
          </form>
        </div>

        {/* Right Area: Document Preview & Editor (8 cols) */}
        <div className="lg:col-span-8 flex flex-col rounded-2xl bg-[#111116] border border-zinc-800/80 overflow-hidden min-h-[560px]">
          {currentDoc ? (
            <div className="flex-1 flex flex-col">
              {/* Document Subheader Toolbar */}
              <div className="px-5 py-3 border-b border-zinc-800/80 bg-[#0d0d12] flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-white truncate max-w-md">
                    {currentDoc.title}
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                    <span>{currentDoc.category}</span>
                    <span>·</span>
                    <span>{currentDoc.length || 'Standard'}</span>
                    <span>·</span>
                    <span>{new Date(currentDoc.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isEditing ? (
                    <button
                      type="button"
                      onClick={handleSaveEdits}
                      disabled={isSaving}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <Save size={13} />
                      <span>{isSaving ? 'Saving...' : 'Save Edits'}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsEditing(true)}
                      className="px-3 py-1.5 rounded-lg border border-zinc-800 hover:bg-zinc-900 text-zinc-300 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Edit3 size={13} />
                      <span>Edit Content</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Document Body */}
              <div className="flex-1 p-6 overflow-y-auto bg-[#09090b]">
                {isEditing ? (
                  <textarea
                    aria-label="Document markdown editor"
                    value={editedContent}
                    onChange={(e) => setEditedContent(e.target.value)}
                    className="w-full h-full min-h-[460px] p-4 rounded-lg bg-[#0d0d12] border border-zinc-800 text-zinc-200 text-xs font-mono focus:outline-none focus:border-violet-500 leading-relaxed resize-none"
                    placeholder="Edit your document markdown..."
                  />
                ) : (
                  <div className="max-w-3xl mx-auto bg-[#111116] p-8 rounded-2xl border border-zinc-800/80 shadow-inner">
                    <h1 className="text-2xl font-bold text-white mb-2">{currentDoc.title}</h1>
                    {currentDoc.subtitle && (
                      <p className="text-sm text-zinc-400 italic mb-6">{currentDoc.subtitle}</p>
                    )}

                    <div className="my-5 border-b border-zinc-800" />

                    <MarkdownDocumentPreview
                      content={currentDoc.content}
                      documentTitle={currentDoc.title}
                    />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-zinc-500">
              <div className="w-12 h-12 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-400 flex items-center justify-center mb-3">
                <FileText size={24} />
              </div>
              <h3 className="text-base font-semibold text-white">Ready to Draft Your Document</h3>
              <p className="text-xs text-zinc-400 max-w-sm mt-1.5 leading-relaxed">
                Enter your Document Title, choose a Document Type and target page length, and
                describe what you need on the left—or load a zero-credit sample document below.
              </p>
              <button
                type="button"
                onClick={handleLoadSampleDocument}
                className="mt-4 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-2 shadow-md shadow-violet-600/20 cursor-pointer"
              >
                <Sparkles size={14} />
                <span>Load Sample Technical Document</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Accessible Rename Modal */}
      <ModalDialog
        isOpen={isRenaming}
        onClose={() => setIsRenaming(false)}
        title="Rename Document"
        description="Update the title for this document."
        footer={
          <>
            <button
              type="button"
              onClick={() => setIsRenaming(false)}
              className="px-3.5 py-1.5 rounded-lg border border-zinc-800 text-zinc-300 hover:text-white text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRename}
              className="px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium"
            >
              Save Title
            </button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-medium text-zinc-300 mb-1.5">Document Title</label>
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
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleConfirmDelete}
        title="Delete Document"
        message={`Are you sure you want to permanently delete '${currentDoc?.title || ''}'?`}
        confirmLabel="Delete Document"
        cancelLabel="Cancel"
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
};
