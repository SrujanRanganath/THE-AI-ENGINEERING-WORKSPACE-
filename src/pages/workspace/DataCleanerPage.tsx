import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/authContext';
import {
  saveDataset,
  updateDataset,
  saveCleaningJob,
  getDatasets,
  logActivity,
  DatasetRecord,
} from '../../lib/firestoreService';
import {
  buildDatasetProfileForAi,
  calculateDatasetStats,
  executeCleaningPipeline,
  DatasetStats,
  CleaningOperation,
  CleaningResult,
} from '../../utils/dataCleaner';
import { parseTabularFile, exportToCsv, exportToXlsx } from '../../utils/sheetExport';
import {
  Table2,
  Upload,
  Download,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Loader2,
  RotateCcw,
  HelpCircle,
  X,
} from 'lucide-react';

// Sample dataset with realistic quality issues (duplicates, whitespace, missing values, mixed dates, inconsistent categories)
const DIRTY_SAMPLE_DATA = [
  { id: 101, customer_name: '  Alice Smith ', email: 'alice@alpha.io', age: 34, revenue: '1250.50', status: 'active', signup_date: '2025-01-14', notes: '' },
  { id: 102, customer_name: 'Bob Johnson', email: 'bob@beta.org', age: null, revenue: '890.00', status: 'ACTIVE', signup_date: '01/22/2025', notes: '' },
  { id: 103, customer_name: '  CHARLIE BROWN  ', email: 'invalid-email', age: 45, revenue: '2100.00', status: 'pending', signup_date: 'March 5, 2025', notes: '' },
  { id: 101, customer_name: '  Alice Smith ', email: 'alice@alpha.io', age: 34, revenue: '1250.50', status: 'active', signup_date: '2025-01-14', notes: '' },
  { id: 104, customer_name: 'David Lee', email: 'david@corp.net', age: 29, revenue: '540.20', status: 'in-active', signup_date: '2025/02/19', notes: '' },
  { id: null, customer_name: '', email: '', age: null, revenue: '', status: '', signup_date: '', notes: '' },
  { id: 105, customer_name: 'Eva Miller', email: 'eva@domain.com', age: 52, revenue: '3400.00', status: 'Active', signup_date: '2025-03-11', notes: '' },
  { id: 106, customer_name: 'Frank Ocean', email: 'frank@music.com', age: 38, revenue: null, status: 'pending', signup_date: '02/28/2025', notes: '' },
  { id: 107, customer_name: 'Grace Hopper', email: 'grace@navy.mil', age: 85, revenue: '9999.99', status: 'active', signup_date: '2025-01-02', notes: '' },
  { id: 102, customer_name: 'Bob Johnson', email: 'bob@beta.org', age: null, revenue: '890.00', status: 'ACTIVE', signup_date: '01/22/2025', notes: '' },
];

interface CleaningPlanFeedback {
  status: 'needs_clarification' | 'invalid_column';
  explanation: string;
  clarificationQuestion: string;
}

export const DataCleanerPage: React.FC = () => {
  const { currentUser } = useAuth();
  const [searchParams] = useSearchParams();
  const datasetIdParam = searchParams.get('id');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Dataset State (originalData is strictly preserved and never mutated)
  const [activeDatasetId, setActiveDatasetId] = useState<string | null>(datasetIdParam);
  const [activeDatasetCreatedAt, setActiveDatasetCreatedAt] = useState<string | null>(null);
  const [cleanedVersionsCount, setCleanedVersionsCount] = useState<number>(0);
  const [filename, setFilename] = useState('customers_dirty_sample.csv');
  const [originalData, setOriginalData] = useState<Record<string, any>[]>(DIRTY_SAMPLE_DATA);
  const [cleanedData, setCleanedData] = useState<Record<string, any>[] | null>(null);
  const [datasetFormat, setDatasetFormat] = useState<'csv' | 'xlsx'>('csv');

  // View & Pagination
  const [activeTab, setActiveTab] = useState<'original' | 'cleaned'>('original');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 8;

  // Natural-Language Instruction & Execution State
  const [instruction, setInstruction] = useState('');
  const [isPlanning, setIsPlanning] = useState(false);
  const [appliedStepsHistory, setAppliedStepsHistory] = useState<CleaningOperation[]>([]);
  const [cleaningResult, setCleaningResult] = useState<CleaningResult | null>(null);
  const [planExplanation, setPlanExplanation] = useState<string | null>(null);
  const [clarificationFeedback, setClarificationFeedback] = useState<CleaningPlanFeedback | null>(null);

  // Status & Error
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Memoized dataset stats (important for responsiveness on large datasets)
  const originalStats: DatasetStats = useMemo(
    () => calculateDatasetStats(originalData),
    [originalData]
  );
  const cleanedStats: DatasetStats | null = useMemo(
    () => (cleanedData ? calculateDatasetStats(cleanedData) : null),
    [cleanedData]
  );

  // Load dataset if query param exists
  useEffect(() => {
    async function fetchDataset() {
      const lookupUid = currentUser?.uid || 'guest_engineer_demo';
      if (!datasetIdParam) return;
      try {
        const list = await getDatasets(lookupUid);
        const match = list.find((d) => d.id === datasetIdParam);
        if (match && match.previewData && match.previewData.length > 0) {
          setActiveDatasetId(match.id);
          setActiveDatasetCreatedAt(match.createdAt || new Date().toISOString());
          setCleanedVersionsCount(match.cleanedVersionsCount || 0);
          setOriginalData(match.previewData);
          setFilename(match.filename);
          setDatasetFormat(match.format);
          setCleanedData(null);
          setCleaningResult(null);
          setAppliedStepsHistory([]);
          setPlanExplanation(null);
          setClarificationFeedback(null);
        }
      } catch (err) {
        console.warn('Could not load dataset:', err);
      }
    }
    fetchDataset();
  }, [datasetIdParam, currentUser?.uid]);

  // Handle File Upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMessage(null);
    setClarificationFeedback(null);
    setStatusMessage('Reading file into memory...');

    const parsed = await parseTabularFile(file);
    if (parsed.error) {
      setErrorMessage(parsed.error);
      setStatusMessage(null);
      return;
    }

    setFilename(parsed.filename);
    setDatasetFormat(parsed.format);
    setOriginalData(parsed.data);
    setCleanedData(null);
    setCleaningResult(null);
    setAppliedStepsHistory([]);
    setPlanExplanation(null);
    setCurrentPage(1);
    setActiveTab('original');
    setStatusMessage(`Loaded ${parsed.data.length} rows across ${parsed.columns.length} columns.`);

    const ownerUid = currentUser?.uid || 'guest_engineer_demo';
    const newDatasetId = `data_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const stats = calculateDatasetStats(parsed.data);
    const now = new Date().toISOString();

    setActiveDatasetId(newDatasetId);
    setActiveDatasetCreatedAt(now);
    setCleanedVersionsCount(0);

    const record: DatasetRecord = {
      id: newDatasetId,
      ownerId: ownerUid,
      filename: parsed.filename,
      format: parsed.format,
      rowCount: stats.rowCount,
      columnCount: stats.columnCount,
      columns: stats.columns,
      previewData: parsed.data.slice(0, 100),
      createdAt: now,
      updatedAt: now,
    };

    try {
      await saveDataset(record);
      await logActivity(
        ownerUid,
        'dataset',
        `Uploaded dataset '${parsed.filename}' (${stats.rowCount} rows)`,
        newDatasetId,
        'dataset'
      );
    } catch (err) {
      console.warn('Could not persist uploaded dataset:', err);
    }
  };

  // Load Sample Dataset (Zero AI Credits)
  const handleLoadSample = async () => {
    const sampleFilename = 'customers_dirty_sample.csv';
    setErrorMessage(null);
    setClarificationFeedback(null);
    setOriginalData(DIRTY_SAMPLE_DATA);
    setFilename(sampleFilename);
    setDatasetFormat('csv');
    setCleanedData(null);
    setCleaningResult(null);
    setAppliedStepsHistory([]);
    setPlanExplanation(null);
    setCurrentPage(1);
    setActiveTab('original');
    setStatusMessage(
      'Loaded sample dataset with duplicates, whitespace, mixed dates, missing values, and inconsistent categories.'
    );

    const ownerUid = currentUser?.uid || 'guest_engineer_demo';
    const newDatasetId = `data_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const stats = calculateDatasetStats(DIRTY_SAMPLE_DATA);
    const now = new Date().toISOString();

    setActiveDatasetId(newDatasetId);
    setActiveDatasetCreatedAt(now);
    setCleanedVersionsCount(0);

    const record: DatasetRecord = {
      id: newDatasetId,
      ownerId: ownerUid,
      filename: sampleFilename,
      format: 'csv',
      rowCount: stats.rowCount,
      columnCount: stats.columnCount,
      columns: stats.columns,
      previewData: DIRTY_SAMPLE_DATA,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await saveDataset(record);
      await logActivity(
        ownerUid,
        'dataset',
        `Loaded sample dataset '${sampleFilename}' (${stats.rowCount} rows)`,
        newDatasetId,
        'dataset'
      );
    } catch (err) {
      console.warn('Could not persist sample dataset:', err);
    }
  };

  // Reset Cleaned Output back to preserved Original Dataset
  const handleResetToOriginal = () => {
    setCleanedData(null);
    setCleaningResult(null);
    setAppliedStepsHistory([]);
    setPlanExplanation(null);
    setClarificationFeedback(null);
    setErrorMessage(null);
    setActiveTab('original');
    setCurrentPage(1);
    setStatusMessage('Restored view to the untouched original dataset.');
  };

  // Execute Natural-Language Cleaning Request
  const handleRunCleaning = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedInstruction = instruction.trim();
    if (!trimmedInstruction) {
      setErrorMessage('Please enter a cleaning instruction describing what you want to change.');
      return;
    }

    const workingSourceData = cleanedData ?? originalData;
    const workingStats = cleanedStats ?? originalStats;

    if (!workingSourceData || workingSourceData.length === 0) {
      setErrorMessage('Please upload a CSV/XLSX file or load the sample dataset first.');
      return;
    }

    setErrorMessage(null);
    setStatusMessage(null);
    setClarificationFeedback(null);
    setIsPlanning(true);

    try {
      // Only send metadata + up to 6 representative rows so large datasets remain fast & within payload bounds
      const datasetProfile = buildDatasetProfileForAi(
        workingSourceData,
        filename,
        6,
        workingStats
      );

      const response = await fetch('/api/ai/plan-cleaning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction: trimmedInstruction,
          datasetProfile,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to interpret cleaning instruction.');
      }

      const plan = payload.plan;
      if (!plan) {
        throw new Error('Server returned an incomplete cleaning plan.');
      }

      if (plan.status !== 'ready') {
        // Ask user for clarification or column correction without altering data
        setClarificationFeedback({
          status: plan.status === 'invalid_column' ? 'invalid_column' : 'needs_clarification',
          explanation: plan.explanation || 'More detail is needed before modifying the dataset.',
          clarificationQuestion:
            plan.clarificationQuestion ||
            `Please specify a valid column (${workingStats.columns.join(', ')}) and exact cleaning rule.`,
        });
        return;
      }

      const plannedOps: CleaningOperation[] = plan.operations || [];
      if (plannedOps.length === 0) {
        setClarificationFeedback({
          status: 'needs_clarification',
          explanation: 'No deterministic operations were matched from your prompt.',
          clarificationQuestion:
            'Please specify what you want cleaned (for example: "Remove duplicate rows" or "Trim whitespace from all text columns").',
        });
        return;
      }

      // Yield briefly to keep UI responsive before processing large datasets locally
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Execute deterministically in-memory without mutating originalData
      const result = executeCleaningPipeline(workingSourceData, plannedOps);
      setCleanedData(result.cleanedData);
      setCleaningResult(result);
      setPlanExplanation(plan.explanation || null);
      setAppliedStepsHistory((prev) => [...prev, ...plannedOps]);
      setActiveTab('cleaned');
      setCurrentPage(1);
      setStatusMessage(
        `Applied ${plannedOps.length} requested operation${plannedOps.length === 1 ? '' : 's'} cleanly.`
      );

      // Persist cleaning history & dataset metadata to Firestore
      const ownerUid = currentUser?.uid || 'guest_engineer_demo';
      const cleanedStatsNow = result.statsAfter;
      const now = new Date().toISOString();
      const targetDatasetId =
        activeDatasetId || `data_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const preservedCreatedAt = activeDatasetCreatedAt || now;
      const nextCleanedCount = cleanedVersionsCount + 1;

      if (!activeDatasetId) {
        setActiveDatasetId(targetDatasetId);
        setActiveDatasetCreatedAt(preservedCreatedAt);
      }
      setCleanedVersionsCount(nextCleanedCount);

      try {
        if (activeDatasetId) {
          await updateDataset(targetDatasetId, {
            filename,
            format: datasetFormat,
            rowCount: cleanedStatsNow.rowCount,
            columnCount: cleanedStatsNow.columnCount,
            columns: cleanedStatsNow.columns,
            previewData: result.cleanedData.slice(0, 100),
            cleanedVersionsCount: nextCleanedCount,
          });
        } else {
          const record: DatasetRecord = {
            id: targetDatasetId,
            ownerId: ownerUid,
            filename,
            format: datasetFormat,
            rowCount: cleanedStatsNow.rowCount,
            columnCount: cleanedStatsNow.columnCount,
            columns: cleanedStatsNow.columns,
            previewData: result.cleanedData.slice(0, 100),
            cleanedVersionsCount: nextCleanedCount,
            createdAt: preservedCreatedAt,
            updatedAt: now,
          };
          await saveDataset(record);
        }

        const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        await saveCleaningJob({
          id: jobId,
          ownerId: ownerUid,
          datasetId: targetDatasetId,
          operations: plannedOps.map((op) => ({
            id: op.id,
            type: op.type,
            params: op.params,
            description: op.description,
          })),
          stats: {
            originalRows: originalData.length,
            cleanedRows: cleanedStatsNow.rowCount,
            rowsRemoved: result.rowsRemoved,
            duplicatesRemoved: result.duplicatesRemoved,
            missingValuesHandled: result.missingValuesHandled,
            columnsModified: result.columnsModified,
          },
          createdAt: now,
          updatedAt: now,
        });

        await logActivity(
          ownerUid,
          'dataset',
          `Cleaned '${filename}' via prompt: "${trimmedInstruction.slice(0, 80)}"`,
          targetDatasetId,
          'dataset'
        );
      } catch (persistErr) {
        console.warn('Could not persist cleaned dataset record:', persistErr);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Could not process the cleaning instruction.');
    } finally {
      setIsPlanning(false);
    }
  };

  // Table pagination
  const currentTableData = activeTab === 'cleaned' && cleanedData ? cleanedData : originalData;
  const totalRows = currentTableData.length;
  const totalPages = Math.ceil(totalRows / pageSize) || 1;
  const paginatedData = currentTableData.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );
  const activeColumns =
    activeTab === 'cleaned' && cleanedStats ? cleanedStats.columns : originalStats.columns;

  return (
    <div data-tour="data-cleaner-panel" className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-zinc-800/80">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-emerald-400 mb-1">
            <Table2 size={15} />
            <span>Agent 04 · Natural-Language Data Cleaner</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            AI Data Cleaner & Statistical Profiler
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            Upload CSV or XLSX files, review statistical profiles, describe cleaning steps in plain
            English, and export verified results without altering original data.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".csv,.xlsx,.xls"
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm shadow-emerald-500/20 cursor-pointer"
          >
            <Upload size={14} />
            <span>Upload CSV / XLSX</span>
          </button>
          <button
            type="button"
            onClick={handleLoadSample}
            className="px-3.5 py-2 rounded-lg border border-zinc-800 bg-[#111116] hover:bg-zinc-900 text-xs text-zinc-200 transition-colors cursor-pointer"
          >
            Load Sample Dataset
          </button>
        </div>
      </div>

      {statusMessage && (
        <div
          role="status"
          className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-emerald-200 text-xs flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
            <span>{statusMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="text-emerald-400 hover:text-white"
            aria-label="Dismiss status message"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="p-3.5 rounded-lg bg-rose-950/40 border border-rose-500/30 text-rose-200 text-xs flex items-center gap-2.5"
        >
          <AlertCircle size={16} className="text-rose-400 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Statistical Summary Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-3.5 rounded-xl bg-[#111116] border border-zinc-800/80">
          <span className="text-[11px] text-zinc-400 block mb-1">Rows</span>
          <span className="text-xl font-bold text-white tabular-nums">{originalStats.rowCount}</span>
          {cleanedStats && (
            <span className="text-[10px] text-emerald-400 font-mono block mt-0.5 tabular-nums">
              After: {cleanedStats.rowCount}
            </span>
          )}
        </div>

        <div className="p-3.5 rounded-xl bg-[#111116] border border-zinc-800/80">
          <span className="text-[11px] text-zinc-400 block mb-1">Columns</span>
          <span className="text-xl font-bold text-white tabular-nums">
            {originalStats.columnCount}
          </span>
          {cleanedStats && (
            <span className="text-[10px] text-emerald-400 font-mono block mt-0.5 tabular-nums">
              After: {cleanedStats.columnCount}
            </span>
          )}
        </div>

        <div className="p-3.5 rounded-xl bg-[#111116] border border-zinc-800/80">
          <span className="text-[11px] text-zinc-400 block mb-1">Duplicate Rows</span>
          <span
            className={`text-xl font-bold tabular-nums ${
              originalStats.duplicateRowCount > 0 ? 'text-amber-400' : 'text-white'
            }`}
          >
            {originalStats.duplicateRowCount}
          </span>
          {cleanedStats ? (
            <span className="text-[10px] text-emerald-400 font-mono block mt-0.5 tabular-nums">
              After: {cleanedStats.duplicateRowCount}
            </span>
          ) : (
            <span className="text-[10px] text-zinc-500 block mt-0.5">Identical records</span>
          )}
        </div>

        <div className="p-3.5 rounded-xl bg-[#111116] border border-zinc-800/80">
          <span className="text-[11px] text-zinc-400 block mb-1">Missing Values</span>
          <span
            className={`text-xl font-bold tabular-nums ${
              originalStats.totalMissingValues > 0 ? 'text-rose-400' : 'text-white'
            }`}
          >
            {originalStats.totalMissingValues}
          </span>
          {cleanedStats ? (
            <span className="text-[10px] text-emerald-400 font-mono block mt-0.5 tabular-nums">
              After: {cleanedStats.totalMissingValues}
            </span>
          ) : (
            <span className="text-[10px] text-zinc-500 block mt-0.5">Empty or null cells</span>
          )}
        </div>

        <div className="p-3.5 rounded-xl bg-[#111116] border border-zinc-800/80">
          <span className="text-[11px] text-zinc-400 block mb-1">Active File</span>
          <span className="text-xs font-semibold text-zinc-200 truncate block mt-1">
            {filename}
          </span>
          <span className="text-[10px] text-zinc-500 uppercase font-mono mt-0.5 block">
            {datasetFormat}
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-[#111116] border border-zinc-800/80 flex flex-col justify-between">
          <span className="text-[11px] text-zinc-400 block">Integrity</span>
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
            <CheckCircle2 size={14} />
            <span>Original Safe</span>
          </div>
          <span className="text-[10px] text-zinc-500">Non-destructive pipeline</span>
        </div>
      </div>

      {/* Natural-Language Instruction Bar */}
      <form
        onSubmit={handleRunCleaning}
        className="p-5 rounded-2xl bg-[#111116] border border-zinc-800/80 space-y-3"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <label
            htmlFor="nl-cleaning-instruction"
            className="text-xs font-semibold text-zinc-100 flex items-center gap-2"
          >
            <Sparkles size={14} className="text-emerald-400" />
            <span>Describe Cleaning Instructions in Plain English</span>
          </label>
          <span className="text-[11px] font-mono text-zinc-400">
            Columns: {originalStats.columns.join(', ')}
          </span>
        </div>

        <div className="flex flex-col md:flex-row gap-3">
          <textarea
            id="nl-cleaning-instruction"
            data-testid="nl-cleaning-input"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={2}
            placeholder="e.g., Remove duplicate rows, trim leading and trailing whitespace, fill missing age with mean, standardize signup_date to YYYY-MM-DD, or remove invalid emails."
            className="flex-1 px-3.5 py-2.5 rounded-xl bg-[#09090b] border border-zinc-800 text-zinc-100 text-xs focus:outline-none focus:border-emerald-500 resize-y min-h-[56px]"
          />

          <div className="flex sm:flex-row md:flex-col gap-2 shrink-0">
            <button
              type="submit"
              data-testid="run-cleaning-button"
              disabled={isPlanning || !instruction.trim()}
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all shadow-sm shadow-emerald-600/20 disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              {isPlanning ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Analyzing...</span>
                </>
              ) : (
                <>
                  <Sparkles size={14} />
                  <span>Run Cleaning</span>
                </>
              )}
            </button>

            {cleanedData && (
              <button
                type="button"
                onClick={handleResetToOriginal}
                className="px-4 py-2 rounded-xl border border-zinc-800 bg-[#09090b] hover:bg-zinc-900 text-zinc-300 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <RotateCcw size={13} />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>

        {/* Clarification / Invalid Column Prompt (Shown without mutating dataset) */}
        {clarificationFeedback && (
          <div
            data-testid="cleaning-clarification-box"
            role="status"
            className="p-4 rounded-xl bg-amber-950/25 border border-amber-500/30 text-amber-100 text-xs space-y-1.5"
          >
            <div className="flex items-center gap-2 font-semibold text-amber-300">
              <HelpCircle size={15} className="shrink-0" />
              <span>
                {clarificationFeedback.status === 'invalid_column'
                  ? 'Column Not Found — No Data Modified'
                  : 'Clarification Needed — No Data Modified'}
              </span>
            </div>
            <p className="text-zinc-300">{clarificationFeedback.explanation}</p>
            <p className="text-amber-200 font-medium">
              {clarificationFeedback.clarificationQuestion}
            </p>
          </div>
        )}

        {/* Operation Execution Summary */}
        {cleaningResult && (
          <div
            data-testid="cleaning-summary-box"
            className="p-3.5 rounded-xl bg-[#09090b] border border-emerald-500/25 space-y-2 text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-emerald-400">
                {planExplanation || 'Completed Requested Cleaning Operations'}
              </span>
              <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-zinc-300 tabular-nums">
                <span>Rows removed: {cleaningResult.rowsRemoved}</span>
                <span>·</span>
                <span>Duplicates removed: {cleaningResult.duplicatesRemoved}</span>
                <span>·</span>
                <span>Missing handled: {cleaningResult.missingValuesHandled}</span>
                <span>·</span>
                <span>Cells updated: {cleaningResult.affectedCells}</span>
              </div>
            </div>

            {cleaningResult.appliedOperations.length > 0 && (
              <ul className="space-y-1 text-[11px] font-mono text-zinc-400">
                {cleaningResult.appliedOperations.map((item, idx) => (
                  <li key={`${item}-${idx}`}>
                    {idx + 1}. {item}
                  </li>
                ))}
              </ul>
            )}

            {appliedStepsHistory.length > cleaningResult.appliedOperations.length && (
              <div className="pt-1 border-t border-zinc-800/80 text-[11px] text-zinc-500">
                Total cumulative steps applied in this session: {appliedStepsHistory.length}
              </div>
            )}
          </div>
        )}
      </form>

      {/* Full-Width Data Preview Table (Before vs. After) */}
      <div className="flex flex-col rounded-2xl bg-[#111116] border border-zinc-800/80 overflow-hidden min-h-[480px]">
        {/* Table Header Bar */}
        <div className="px-4 py-2.5 border-b border-zinc-800/80 bg-[#0d0d12] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-[#09090b] border border-zinc-800 rounded-lg">
            <button
              type="button"
              onClick={() => {
                setActiveTab('original');
                setCurrentPage(1);
              }}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                activeTab === 'original'
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Original Dataset ({originalData.length} rows)
            </button>
            <button
              type="button"
              onClick={() => {
                if (cleanedData) {
                  setActiveTab('cleaned');
                  setCurrentPage(1);
                }
              }}
              disabled={!cleanedData}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors disabled:opacity-40 cursor-pointer ${
                activeTab === 'cleaned'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Cleaned Output {cleanedData ? `(${cleanedData.length} rows)` : '(Run to view)'}
            </button>
          </div>

          {/* Export buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => exportToCsv(currentTableData, filename)}
              className="px-3 py-1.5 rounded-lg border border-zinc-800 hover:bg-zinc-900 text-xs text-zinc-200 flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Export currently displayed table as CSV"
            >
              <Download size={13} />
              <span>Export CSV</span>
            </button>
            <button
              type="button"
              onClick={() => exportToXlsx(currentTableData, filename)}
              className="px-3 py-1.5 rounded-lg border border-zinc-800 hover:bg-zinc-900 text-xs text-zinc-200 flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Export currently displayed table as Excel XLSX"
            >
              <FileSpreadsheet size={13} />
              <span>Export XLSX</span>
            </button>
          </div>
        </div>

        {/* Tabular Data View */}
        <div className="flex-1 overflow-x-auto bg-[#09090b]">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-zinc-800/80 bg-[#0d0d12]">
                <th className="px-3 py-2.5 text-zinc-500 font-mono text-[10px] w-12 text-center">
                  #
                </th>
                {activeColumns.map((col) => {
                  const colType =
                    activeTab === 'cleaned' && cleanedStats
                      ? cleanedStats.columnTypes[col]
                      : originalStats.columnTypes[col];
                  const missingInCol =
                    activeTab === 'cleaned' && cleanedStats
                      ? cleanedStats.missingCounts[col] || 0
                      : originalStats.missingCounts[col] || 0;

                  return (
                    <th key={col} className="px-3 py-2.5 text-zinc-200 font-semibold whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span>{col}</span>
                        <span className="text-[10px] text-zinc-500 font-mono font-normal">
                          ({colType})
                        </span>
                      </div>
                      {missingInCol > 0 && (
                        <span className="text-[10px] text-amber-400 font-normal block mt-0.5 tabular-nums">
                          {missingInCol} missing
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-mono">
              {paginatedData.map((row, rowIdx) => {
                const globalIdx = (currentPage - 1) * pageSize + rowIdx + 1;
                return (
                  <tr key={globalIdx} className="hover:bg-zinc-900/50 transition-colors">
                    <td className="px-3 py-2 text-zinc-600 text-center text-[10px] tabular-nums">
                      {globalIdx}
                    </td>
                    {activeColumns.map((col) => {
                      const val = row[col];
                      const isMissing =
                        val === undefined ||
                        val === null ||
                        val === '' ||
                        (typeof val === 'number' && Number.isNaN(val));

                      return (
                        <td
                          key={col}
                          className={`px-3 py-2 whitespace-nowrap text-xs ${
                            isMissing ? 'text-rose-400/80 italic bg-rose-950/15' : 'text-zinc-300'
                          }`}
                        >
                          {isMissing ? '<empty>' : String(val)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Table Footer with Pagination */}
        <div className="px-4 py-3 border-t border-zinc-800/80 bg-[#0d0d12] flex items-center justify-between text-xs text-zinc-400 tabular-nums">
          <div>
            Showing {totalRows === 0 ? 0 : (currentPage - 1) * pageSize + 1} to{' '}
            {Math.min(currentPage * pageSize, totalRows)} of {totalRows} records
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              aria-label="Previous page"
              className="p-1 rounded bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 disabled:opacity-30"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="px-2 font-mono text-[11px]">
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              aria-label="Next page"
              className="p-1 rounded bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 disabled:opacity-30"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
