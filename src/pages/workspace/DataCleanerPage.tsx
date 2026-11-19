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
  isMissingValue,
  DatasetStats,
  CleaningOperation,
  CleaningResult,
  MissingValueConfig,
  AuditEntryStatus,
} from '../../utils/dataCleaner';
import { parseTabularFile, exportToCsv, exportToXlsx } from '../../utils/sheetExport';
import {
  AgentExecutionMode,
  interpretDemoCleaningInstruction,
} from '../../utils/demoModeEngine';
import { getAiRequestHeaders, parseAiFailure, ParsedAiErrorInfo } from '../../lib/aiClient';
import { AgentModeBar, AiUnavailableBanner } from '../../components/common/AgentModeControls';
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
  ClipboardList,
  Filter,
  FileText,
  Trash2,
  Columns,
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
  pendingColumnRemovalCount?: number;
}

function triggerClientDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

  // Missing-value token configuration ("NA"/"N/A" NOT treated as missing unless explicitly enabled)
  const [treatNATokensAsMissing, setTreatNATokensAsMissing] = useState(false);
  const missingConfig: MissingValueConfig = useMemo(
    () => ({
      treatWhitespaceAsMissing: true,
      treatNATokensAsMissing,
    }),
    [treatNATokensAsMissing]
  );

  // View & Pagination (Row AND Column windowing to handle 1,105 x 1,005 cleanly)
  const [activeTab, setActiveTab] = useState<'original' | 'cleaned' | 'compare'>('original');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 8;
  const [colPage, setColPage] = useState(1);
  const colPageSize = 18;
  const [colFilterQuery, setColFilterQuery] = useState('');

  // Natural-Language Instruction & Execution State
  const [executionMode, setExecutionMode] = useState<AgentExecutionMode>('live');
  const [instruction, setInstruction] = useState('');
  const [isPlanning, setIsPlanning] = useState(false);
  const planningRef = useRef(false);
  const [appliedStepsHistory, setAppliedStepsHistory] = useState<CleaningOperation[]>([]);
  const [cleaningResult, setCleaningResult] = useState<CleaningResult | null>(null);
  const [planExplanation, setPlanExplanation] = useState<string | null>(null);
  const [lastPlanMode, setLastPlanMode] = useState<AgentExecutionMode>('live');
  const [clarificationFeedback, setClarificationFeedback] = useState<CleaningPlanFeedback | null>(null);

  // Interactive Multi-Column Removal Confirmation Picker
  const [selectedRemovalCols, setSelectedRemovalCols] = useState<string[]>([]);
  const [pickerSearchQuery, setPickerSearchQuery] = useState('');

  // Cleaning Activity Report Filters
  const [auditOpFilter, setAuditOpFilter] = useState<string>('ALL');
  const [auditStatusFilter, setAuditStatusFilter] = useState<'ALL' | AuditEntryStatus>('ALL');
  const [auditColFilter, setAuditColFilter] = useState<string>('');
  const [auditRowFilter, setAuditRowFilter] = useState<string>('');
  const [auditPage, setAuditPage] = useState(1);
  const auditPageSize = 15;

  // Status & Error
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [aiUnavailableError, setAiUnavailableError] = useState<ParsedAiErrorInfo | null>(null);

  // Memoized dataset stats
  const originalStats: DatasetStats = useMemo(
    () => calculateDatasetStats(originalData, missingConfig),
    [originalData, missingConfig]
  );
  const cleanedStats: DatasetStats | null = useMemo(
    () => (cleanedData ? calculateDatasetStats(cleanedData, missingConfig) : null),
    [cleanedData, missingConfig]
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
          setColPage(1);
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
    setSelectedRemovalCols([]);
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
    setColPage(1);
    setColFilterQuery('');
    setActiveTab('original');
    setStatusMessage(`Loaded ${parsed.data.length} rows across ${parsed.columns.length} columns.`);

    const ownerUid = currentUser?.uid || 'guest_engineer_demo';
    const newDatasetId = `data_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const stats = calculateDatasetStats(parsed.data, missingConfig);
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
      previewData: parsed.data,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await saveDataset(record);
      await logActivity(
        ownerUid,
        'dataset',
        `Uploaded dataset '${parsed.filename}' (${stats.rowCount} rows, ${stats.columnCount} columns)`,
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
    setSelectedRemovalCols([]);
    setOriginalData(DIRTY_SAMPLE_DATA);
    setFilename(sampleFilename);
    setDatasetFormat('csv');
    setCleanedData(null);
    setCleaningResult(null);
    setAppliedStepsHistory([]);
    setPlanExplanation(null);
    setCurrentPage(1);
    setColPage(1);
    setColFilterQuery('');
    setActiveTab('original');
    setStatusMessage(
      'Loaded sample dataset with duplicates, whitespace, mixed dates, missing values, and inconsistent categories.'
    );

    const ownerUid = currentUser?.uid || 'guest_engineer_demo';
    const newDatasetId = `data_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const stats = calculateDatasetStats(DIRTY_SAMPLE_DATA, missingConfig);
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
    setSelectedRemovalCols([]);
    setErrorMessage(null);
    setActiveTab('original');
    setCurrentPage(1);
    setColPage(1);
    setStatusMessage('Restored view to the untouched original dataset.');
  };

  // Apply validated cleaning plan deterministically in-memory without mutating originalData
  const applyPlannedCleaningOperations = async (
    trimmedInstruction: string,
    workingSourceData: Record<string, any>[],
    workingStats: DatasetStats,
    plan: {
      status: string;
      explanation?: string;
      clarificationQuestion?: string;
      pendingColumnRemovalCount?: number;
      operations?: CleaningOperation[];
    },
    planMode: AgentExecutionMode
  ) => {
    if (plan.status !== 'ready') {
      setSelectedRemovalCols([]);
      setPickerSearchQuery('');
      setClarificationFeedback({
        status: plan.status === 'invalid_column' ? 'invalid_column' : 'needs_clarification',
        explanation: plan.explanation || 'More detail is needed before modifying the dataset.',
        clarificationQuestion:
          plan.clarificationQuestion ||
          `Please specify a valid column (${workingStats.columns.slice(0, 12).join(', ')}${
            workingStats.columns.length > 12 ? ', ...' : ''
          }) and exact cleaning rule.`,
        pendingColumnRemovalCount: plan.pendingColumnRemovalCount,
      });
      return;
    }

    const plannedOps: CleaningOperation[] = plan.operations || [];
    if (plannedOps.length === 0) {
      setClarificationFeedback({
        status: 'needs_clarification',
        explanation: 'No deterministic operations were matched from your prompt.',
        clarificationQuestion:
          'Please specify what you want cleaned (for example: "Replace all missing values with 0" or "Remove duplicate rows").',
      });
      return;
    }

    // Yield briefly to keep UI responsive before processing large datasets locally
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Execute sequentially on a shallow clone in-memory without mutating originalData
    const result = executeCleaningPipeline(workingSourceData, plannedOps, missingConfig);
    setCleanedData(result.cleanedData);
    setCleaningResult(result);
    setLastPlanMode(planMode);
    setPlanExplanation(
      planMode === 'demo'
        ? `[Demo Mode · Local Interpreter] ${plan.explanation || 'Completed requested local cleaning operations.'}`
        : plan.explanation || null
    );
    setAppliedStepsHistory((prev) => [...prev, ...plannedOps]);
    setAuditOpFilter('ALL');
    setAuditStatusFilter('ALL');
    setAuditColFilter('');
    setAuditRowFilter('');
    setAuditPage(1);
    setActiveTab('cleaned');
    setCurrentPage(1);
    setColPage(1);
    setStatusMessage(
      planMode === 'demo'
        ? `[Demo Mode] Executed ${result.operationsCompleted} local operation${
            result.operationsCompleted === 1 ? '' : 's'
          } (${result.cellsModified} cells modified, ${result.rowsRemoved} rows removed) without calling Gemini API.`
        : `Executed ${result.operationsCompleted} requested operation${
            result.operationsCompleted === 1 ? '' : 's'
          } cleanly (${result.cellsModified} cells modified).`
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
          previewData: result.cleanedData,
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
          previewData: result.cleanedData,
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
        `${planMode === 'demo' ? '[Demo Mode] ' : ''}Cleaned '${filename}' via prompt: "${trimmedInstruction.slice(0, 80)}"`,
        targetDatasetId,
        'dataset'
      );
    } catch (persistErr) {
      console.warn('Could not persist cleaned dataset record:', persistErr);
    }
  };

  // Execute Natural-Language Cleaning Request (Live AI or Offline Demo Mode)
  const executeCleaningWithMode = async (targetMode: AgentExecutionMode) => {
    if (planningRef.current) return;
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

    planningRef.current = true;
    setErrorMessage(null);
    setAiUnavailableError(null);
    setStatusMessage(null);
    setClarificationFeedback(null);
    setSelectedRemovalCols([]);
    setIsPlanning(true);

    try {
      const datasetProfile = buildDatasetProfileForAi(
        workingSourceData,
        filename,
        6,
        workingStats
      );

      if (targetMode === 'demo') {
        const demoPlan = interpretDemoCleaningInstruction(trimmedInstruction, datasetProfile);
        await applyPlannedCleaningOperations(
          trimmedInstruction,
          workingSourceData,
          workingStats,
          demoPlan,
          'demo'
        );
        return;
      }

      const headers = await getAiRequestHeaders();
      const response = await fetch('/api/ai/plan-cleaning', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          instruction: trimmedInstruction,
          datasetProfile,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const parsedErr = parseAiFailure(
          response.status,
          payload,
          'Failed to interpret cleaning instruction.'
        );
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

      const plan = payload?.plan;
      if (!plan) {
        throw new Error('Server returned an incomplete cleaning plan.');
      }

      await applyPlannedCleaningOperations(
        trimmedInstruction,
        workingSourceData,
        workingStats,
        plan,
        'live'
      );
    } catch (err: any) {
      setErrorMessage(err.message || 'Could not process the cleaning instruction.');
    } finally {
      planningRef.current = false;
      setIsPlanning(false);
    }
  };

  const handleConfirmPendingColumnRemoval = async () => {
    if (selectedRemovalCols.length === 0) return;
    const workingSourceData = cleanedData ?? originalData;
    const workingStats = cleanedStats ?? originalStats;
    const confirmedOp: CleaningOperation = {
      id: `confirmed_drop_${Date.now()}`,
      type: 'remove_column',
      params: { columns: selectedRemovalCols },
      description: `Remove ${selectedRemovalCols.length} confirmed column(s): ${selectedRemovalCols.join(', ')}`,
    };
    setClarificationFeedback(null);
    await applyPlannedCleaningOperations(
      `Remove columns: ${selectedRemovalCols.join(', ')}`,
      workingSourceData,
      workingStats,
      {
        status: 'ready',
        explanation: `Removed ${selectedRemovalCols.length} confirmed column(s): ${selectedRemovalCols.join(', ')}.`,
        operations: [confirmedOp],
      },
      executionMode
    );
    setSelectedRemovalCols([]);
  };

  const handleRunCleaning = async (e: React.FormEvent) => {
    e.preventDefault();
    await executeCleaningWithMode(executionMode);
  };

  // Filtered & paginated Audit Log for Cleaning Activity Report
  const availableAuditOperations = useMemo(() => {
    if (!cleaningResult) return [];
    return Array.from(new Set(cleaningResult.auditLog.map((entry) => entry.operationLabel)));
  }, [cleaningResult]);

  const filteredAuditLog = useMemo(() => {
    if (!cleaningResult) return [];
    const colQ = auditColFilter.trim().toLowerCase();
    const rowQ = auditRowFilter.trim();
    return cleaningResult.auditLog.filter((entry) => {
      if (auditOpFilter !== 'ALL' && entry.operationLabel !== auditOpFilter) return false;
      if (auditStatusFilter !== 'ALL' && entry.status !== auditStatusFilter) return false;
      if (colQ && !entry.column.toLowerCase().includes(colQ)) return false;
      if (rowQ) {
        const rowStr = entry.originalRow !== null ? String(entry.originalRow) : '';
        if (rowStr !== rowQ) return false;
      }
      return true;
    });
  }, [cleaningResult, auditOpFilter, auditStatusFilter, auditColFilter, auditRowFilter]);

  const totalAuditPages = Math.max(1, Math.ceil(filteredAuditLog.length / auditPageSize));
  const paginatedAuditLog = filteredAuditLog.slice(
    (auditPage - 1) * auditPageSize,
    auditPage * auditPageSize
  );

  // Download Cleaning Report as CSV or JSON
  const handleDownloadAuditCsv = () => {
    if (!cleaningResult) return;
    const headers = [
      'Original Row',
      'Column',
      'Previous Value',
      'New Value',
      'Operation',
      'Reason',
      'Status',
    ];
    const escapeCell = (v: any) => {
      const s = String(v ?? '');
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = cleaningResult.auditLog.map((item) =>
      [
        item.originalRow ?? 'schema',
        item.column,
        item.previousValue,
        item.newValue,
        item.operationLabel,
        item.reason,
        item.status,
      ]
        .map(escapeCell)
        .join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const baseName = filename.replace(/\.(csv|xlsx|xls)$/i, '');
    triggerClientDownload(`${baseName}_cleaning_report.csv`, csv, 'text/csv;charset=utf-8;');
  };

  const handleDownloadAuditJson = () => {
    if (!cleaningResult) return;
    const report = {
      filename,
      generatedAt: new Date().toISOString(),
      executionMode: lastPlanMode,
      summary: {
        rowsBefore: cleaningResult.statsBefore.rowCount,
        rowsAfter: cleaningResult.statsAfter.rowCount,
        columnsBefore: cleaningResult.statsBefore.columnCount,
        columnsAfter: cleaningResult.statsAfter.columnCount,
        missingBefore: cleaningResult.statsBefore.totalMissingValues,
        missingAfter: cleaningResult.statsAfter.totalMissingValues,
        duplicatesRemoved: cleaningResult.duplicatesRemoved,
        cellsModified: cleaningResult.cellsModified,
        rowsRemoved: cleaningResult.rowsRemoved,
        columnsRemoved: cleaningResult.columnsRemoved,
        operationsCompleted: cleaningResult.operationsCompleted,
        operationsFailed: cleaningResult.operationsFailed,
      },
      operationSummaries: cleaningResult.operationSummaries,
      auditLogTruncated: cleaningResult.auditLogTruncated,
      totalAuditEvents: cleaningResult.totalAuditEvents,
      auditLog: cleaningResult.auditLog,
    };
    const baseName = filename.replace(/\.(csv|xlsx|xls)$/i, '');
    triggerClientDownload(
      `${baseName}_cleaning_report.json`,
      JSON.stringify(report, null, 2),
      'application/json;charset=utf-8;'
    );
  };

  // Table pagination (rows + columns)
  const workingActiveStats =
    activeTab !== 'original' && cleanedStats ? cleanedStats : originalStats;
  const currentTableData =
    activeTab !== 'original' && cleanedData ? cleanedData : originalData;
  const totalRows = currentTableData.length;
  const totalPages = Math.ceil(totalRows / pageSize) || 1;
  const paginatedData = currentTableData.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const filteredColumns = useMemo(() => {
    const q = colFilterQuery.trim().toLowerCase();
    if (!q) return workingActiveStats.columns;
    return workingActiveStats.columns.filter((c) => c.toLowerCase().includes(q));
  }, [workingActiveStats.columns, colFilterQuery]);

  const totalColPages = Math.max(1, Math.ceil(filteredColumns.length / colPageSize));
  const safeColPage = Math.min(colPage, totalColPages);
  const visibleColumns = filteredColumns.slice(
    (safeColPage - 1) * colPageSize,
    safeColPage * colPageSize
  );

  const workingColumnsAll = (cleanedStats ?? originalStats).columns;
  const pickerFilteredColumns = useMemo(() => {
    const q = pickerSearchQuery.trim().toLowerCase();
    return q
      ? workingColumnsAll.filter((c) => c.toLowerCase().includes(q))
      : workingColumnsAll;
  }, [workingColumnsAll, pickerSearchQuery]);

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
            Upload CSV or XLSX files, inspect exact cell-level audit trails, clean with plain English,
            and export verified results without mutating original data.
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

      <AgentModeBar
        mode={executionMode}
        onModeChange={(nextMode) => {
          setExecutionMode(nextMode);
          setAiUnavailableError(null);
          setErrorMessage(null);
        }}
        agentRole="lightweight"
        disabled={isPlanning}
        accentColor="emerald"
      />

      {aiUnavailableError && (
        <AiUnavailableBanner
          errorInfo={aiUnavailableError}
          isBusy={isPlanning}
          onRetryLive={() => {
            void executeCleaningWithMode('live');
          }}
          onSwitchToDemoAndRun={() => {
            setExecutionMode('demo');
            setAiUnavailableError(null);
            setErrorMessage(null);
            void executeCleaningWithMode('demo');
          }}
          onDismiss={() => setAiUnavailableError(null)}
        />
      )}

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
          <span className="text-[11px] font-mono text-zinc-400 truncate max-w-xl">
            Columns ({originalStats.columns.length}):{' '}
            {originalStats.columns.slice(0, 12).join(', ')}
            {originalStats.columns.length > 12 ? `, +${originalStats.columns.length - 12} more` : ''}
          </span>
        </div>

        <div className="flex flex-col md:flex-row gap-3">
          <textarea
            id="nl-cleaning-instruction"
            data-testid="nl-cleaning-input"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={2}
            placeholder='e.g., "Replace all missing values with 0.", "Remove duplicate rows, trim whitespace, standardize gender values into Male and Female", or "Remove rows where salary < 20000"'
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
                  <span>{executionMode === 'demo' ? 'Run Cleaning (Demo)' : 'Run Cleaning'}</span>
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

        {/* Missing Token Option */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-zinc-400">
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={treatNATokensAsMissing}
              onChange={(e) => setTreatNATokensAsMissing(e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-0"
            />
            <span>
              Treat literal text tokens (<code className="text-zinc-300">"NA"</code>,{' '}
              <code className="text-zinc-300">"N/A"</code>, <code className="text-zinc-300">"null"</code>) as missing values
            </span>
          </label>
          <span className="text-zinc-500">
            Default preserves literal text like "NA" unless explicitly selected or replaced
          </span>
        </div>

        {/* Interactive Clarification / Invalid Column / Multi-Column Removal Confirmation Box */}
        {clarificationFeedback && (
          <div
            data-testid="cleaning-clarification-box"
            role="status"
            className="p-4 rounded-xl bg-amber-950/25 border border-amber-500/30 text-amber-100 text-xs space-y-3"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-semibold text-amber-300">
                <HelpCircle size={15} className="shrink-0" />
                <span>
                  {clarificationFeedback.status === 'invalid_column'
                    ? 'Column Not Found — No Data Modified'
                    : clarificationFeedback.pendingColumnRemovalCount
                    ? `Confirmation Required Before Removing ${clarificationFeedback.pendingColumnRemovalCount} Column(s)`
                    : 'Clarification Needed — No Data Modified'}
                </span>
              </div>
              <p className="text-zinc-300">{clarificationFeedback.explanation}</p>
              <p className="text-amber-200 font-medium">
                {clarificationFeedback.clarificationQuestion}
              </p>
            </div>

            {clarificationFeedback.pendingColumnRemovalCount && (
              <div
                data-testid="column-removal-picker"
                className="p-3 rounded-lg bg-[#09090b] border border-zinc-800 space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-zinc-200">
                    Select columns to remove ({selectedRemovalCols.length} selected):
                  </span>
                  <input
                    type="text"
                    value={pickerSearchQuery}
                    onChange={(e) => setPickerSearchQuery(e.target.value)}
                    placeholder="Filter columns..."
                    className="px-2.5 py-1 rounded bg-[#111116] border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-1.5 max-h-36 overflow-y-auto pr-1">
                  {pickerFilteredColumns.slice(0, 120).map((col) => {
                    const checked = selectedRemovalCols.includes(col);
                    return (
                      <label
                        key={col}
                        className={`px-2 py-1 rounded border text-[11px] font-mono flex items-center gap-1.5 cursor-pointer truncate ${
                          checked
                            ? 'bg-rose-950/40 border-rose-500/40 text-rose-200'
                            : 'bg-[#111116] border-zinc-800 text-zinc-300 hover:border-zinc-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedRemovalCols((prev) =>
                              prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
                            )
                          }
                          className="rounded border-zinc-700 bg-zinc-900"
                        />
                        <span className="truncate">{col}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setClarificationFeedback(null);
                      setSelectedRemovalCols([]);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-300 hover:text-white text-xs cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    data-testid="confirm-column-removal-btn"
                    disabled={selectedRemovalCols.length === 0}
                    onClick={handleConfirmPendingColumnRemoval}
                    className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40 cursor-pointer"
                  >
                    <Trash2 size={13} />
                    <span>Confirm & Remove ({selectedRemovalCols.length})</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Operation Execution Summary Banner */}
        {cleaningResult && (
          <div
            data-testid="cleaning-summary-box"
            className="p-3.5 rounded-xl bg-[#09090b] border border-emerald-500/25 space-y-2 text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-emerald-400">
                  {planExplanation || 'Completed Requested Cleaning Operations'}
                </span>
                <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[10px] font-mono text-zinc-300">
                  {lastPlanMode === 'demo' ? 'Demo Mode · Local' : 'Live AI · Gemini'}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-zinc-300 tabular-nums">
                <span>Cells modified: {cleaningResult.cellsModified}</span>
                <span>·</span>
                <span>Rows removed: {cleaningResult.rowsRemoved}</span>
                <span>·</span>
                <span>Columns removed: {cleaningResult.columnsRemoved}</span>
                <span>·</span>
                <span>Completed: {cleaningResult.operationsCompleted}</span>
                {cleaningResult.operationsFailed > 0 && (
                  <>
                    <span>·</span>
                    <span className="text-rose-400">
                      Failed: {cleaningResult.operationsFailed}
                    </span>
                  </>
                )}
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

      {/* CLEANING ACTIVITY REPORT (Driven 100% by real CleaningResult state) */}
      {cleaningResult && (
        <section
          data-testid="cleaning-activity-report"
          aria-label="Cleaning Activity Report"
          className="rounded-2xl bg-[#111116] border border-zinc-800/80 p-5 space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-3.5">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-emerald-400">
                <ClipboardList size={15} />
                <span>CLEANING ACTIVITY REPORT</span>
              </div>
              <p className="text-xs text-zinc-400">
                Verified before/after counts, cell-level audit trail with original row numbers, and
                downloadable execution logs.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="download-report-csv"
                onClick={handleDownloadAuditCsv}
                className="px-3 py-1.5 rounded-lg border border-zinc-800 bg-[#09090b] hover:bg-zinc-900 text-xs text-zinc-200 flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <FileText size={13} className="text-emerald-400" />
                <span>Report CSV</span>
              </button>
              <button
                type="button"
                data-testid="download-report-json"
                onClick={handleDownloadAuditJson}
                className="px-3 py-1.5 rounded-lg border border-zinc-800 bg-[#09090b] hover:bg-zinc-900 text-xs text-zinc-200 flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Download size={13} className="text-violet-400" />
                <span>Report JSON</span>
              </button>
            </div>
          </div>

          {/* 12 Execution Summary Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            {[
              { label: 'Total Rows Before', val: cleaningResult.statsBefore.rowCount, tone: 'text-zinc-100' },
              { label: 'Total Rows After', val: cleaningResult.statsAfter.rowCount, tone: 'text-emerald-400' },
              { label: 'Columns Before', val: cleaningResult.statsBefore.columnCount, tone: 'text-zinc-100' },
              { label: 'Columns After', val: cleaningResult.statsAfter.columnCount, tone: 'text-emerald-400' },
              { label: 'Missing Before', val: cleaningResult.statsBefore.totalMissingValues, tone: 'text-rose-400' },
              { label: 'Missing After', val: cleaningResult.statsAfter.totalMissingValues, tone: 'text-emerald-400' },
              { label: 'Duplicates Removed', val: cleaningResult.duplicatesRemoved, tone: 'text-amber-300' },
              { label: 'Cells Modified', val: cleaningResult.cellsModified, tone: 'text-emerald-300' },
              { label: 'Rows Removed', val: cleaningResult.rowsRemoved, tone: 'text-rose-300' },
              { label: 'Columns Removed', val: cleaningResult.columnsRemoved, tone: 'text-rose-300' },
              { label: 'Ops Completed', val: cleaningResult.operationsCompleted, tone: 'text-emerald-400' },
              {
                label: 'Ops Failed',
                val: cleaningResult.operationsFailed,
                tone: cleaningResult.operationsFailed > 0 ? 'text-rose-400' : 'text-zinc-400',
              },
            ].map((card) => (
              <div
                key={card.label}
                className="p-3 rounded-xl bg-[#09090b] border border-zinc-800/80"
              >
                <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 block">
                  {card.label}
                </span>
                <span className={`text-lg font-bold tabular-nums mt-0.5 block ${card.tone}`}>
                  {card.val}
                </span>
              </div>
            ))}
          </div>

          {/* Audit Filters */}
          <div className="flex flex-wrap items-center gap-2.5 p-3 rounded-xl bg-[#09090b] border border-zinc-800/80 text-xs">
            <div className="flex items-center gap-1.5 text-zinc-400 mr-1">
              <Filter size={13} />
              <span className="font-semibold">Audit Filters:</span>
            </div>

            <select
              aria-label="Filter by operation"
              value={auditOpFilter}
              onChange={(e) => {
                setAuditOpFilter(e.target.value);
                setAuditPage(1);
              }}
              className="px-2.5 py-1 rounded-lg bg-[#111116] border border-zinc-800 text-zinc-200 text-xs"
            >
              <option value="ALL">All Operations</option>
              {availableAuditOperations.map((opLabel) => (
                <option key={opLabel} value={opLabel}>
                  {opLabel}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by status"
              value={auditStatusFilter}
              onChange={(e) => {
                setAuditStatusFilter(e.target.value as any);
                setAuditPage(1);
              }}
              className="px-2.5 py-1 rounded-lg bg-[#111116] border border-zinc-800 text-zinc-200 text-xs"
            >
              <option value="ALL">All Statuses</option>
              <option value="changed">Changed (Green)</option>
              <option value="removed">Removed (Red)</option>
              <option value="attention">Needs Attention (Amber)</option>
              <option value="unchanged">Unchanged (Grey)</option>
            </select>

            <input
              type="text"
              aria-label="Filter audit by column"
              value={auditColFilter}
              onChange={(e) => {
                setAuditColFilter(e.target.value);
                setAuditPage(1);
              }}
              placeholder="Column name..."
              className="px-2.5 py-1 rounded-lg bg-[#111116] border border-zinc-800 text-zinc-200 text-xs w-36"
            />

            <input
              type="text"
              aria-label="Filter audit by original row number"
              value={auditRowFilter}
              onChange={(e) => {
                setAuditRowFilter(e.target.value);
                setAuditPage(1);
              }}
              placeholder="Orig Row #..."
              className="px-2.5 py-1 rounded-lg bg-[#111116] border border-zinc-800 text-zinc-200 text-xs w-28"
            />

            <span className="ml-auto text-[11px] font-mono text-zinc-500 tabular-nums">
              {filteredAuditLog.length} event{filteredAuditLog.length === 1 ? '' : 's'}
              {cleaningResult.auditLogTruncated
                ? ` (showing first ${cleaningResult.auditLog.length} of ${cleaningResult.totalAuditEvents})`
                : ''}
            </span>
          </div>

          {/* Audit Table */}
          <div className="rounded-xl border border-zinc-800/80 overflow-x-auto bg-[#09090b]">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-zinc-800 bg-[#0d0d12] text-zinc-400 font-mono text-[10px] uppercase">
                  <th className="px-3 py-2">Orig Row</th>
                  <th className="px-3 py-2">Column</th>
                  <th className="px-3 py-2">Previous Value</th>
                  <th className="px-3 py-2">New Value</th>
                  <th className="px-3 py-2">Operation</th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 font-mono text-[11px]">
                {paginatedAuditLog.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-zinc-500 font-sans text-xs">
                      No audit events match the selected filters.
                    </td>
                  </tr>
                ) : (
                  paginatedAuditLog.map((entry) => {
                    const statusBadgeClass =
                      entry.status === 'changed'
                        ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/30'
                        : entry.status === 'removed'
                        ? 'bg-rose-950/60 text-rose-300 border-rose-500/30'
                        : entry.status === 'attention'
                        ? 'bg-amber-950/60 text-amber-300 border-amber-500/30'
                        : 'bg-zinc-900 text-zinc-400 border-zinc-700';

                    return (
                      <tr key={entry.id} className="hover:bg-zinc-900/40">
                        <td className="px-3 py-2 text-zinc-400 tabular-nums">
                          {entry.originalRow !== null ? `#${entry.originalRow}` : 'Schema'}
                        </td>
                        <td className="px-3 py-2 text-zinc-200 font-semibold">{entry.column}</td>
                        <td className="px-3 py-2 text-zinc-400 max-w-[180px] truncate">
                          {entry.previousValue}
                        </td>
                        <td className="px-3 py-2 text-zinc-100 max-w-[180px] truncate">
                          {entry.newValue}
                        </td>
                        <td className="px-3 py-2 text-zinc-300 whitespace-nowrap">
                          {entry.operationLabel}
                        </td>
                        <td className="px-3 py-2 text-zinc-400 font-sans text-xs">{entry.reason}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded border text-[10px] uppercase ${statusBadgeClass}`}
                          >
                            {entry.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {totalAuditPages > 1 && (
            <div className="flex items-center justify-between text-xs text-zinc-400 tabular-nums">
              <span>
                Audit Page {auditPage} of {totalAuditPages}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                  disabled={auditPage <= 1}
                  className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 disabled:opacity-40 cursor-pointer"
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => setAuditPage((p) => Math.min(totalAuditPages, p + 1))}
                  disabled={auditPage >= totalAuditPages}
                  className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 disabled:opacity-40 cursor-pointer"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Full-Width Data Preview Table (Original / Cleaned / Before vs After Comparison) */}
      <div className="flex flex-col rounded-2xl bg-[#111116] border border-zinc-800/80 overflow-hidden min-h-[480px]">
        {/* Table Header Bar */}
        <div className="px-4 py-2.5 border-b border-zinc-800/80 bg-[#0d0d12] flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-[#09090b] border border-zinc-800 rounded-lg">
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
            <button
              type="button"
              onClick={() => {
                if (cleanedData) {
                  setActiveTab('compare');
                  setCurrentPage(1);
                }
              }}
              disabled={!cleanedData}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors disabled:opacity-40 cursor-pointer ${
                activeTab === 'compare'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Before vs After
            </button>
          </div>

          {/* Column Window Controls (prevents DOM freeze on 1,005+ columns) */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#09090b] border border-zinc-800">
              <Columns size={13} className="text-zinc-400" />
              <input
                type="text"
                value={colFilterQuery}
                onChange={(e) => {
                  setColFilterQuery(e.target.value);
                  setColPage(1);
                }}
                placeholder="Jump/filter col..."
                className="bg-transparent text-xs text-zinc-200 focus:outline-none w-28"
              />
            </div>
            {filteredColumns.length > colPageSize && (
              <div className="flex items-center gap-1 text-[11px] font-mono text-zinc-400">
                <button
                  type="button"
                  onClick={() => setColPage((p) => Math.max(1, p - 1))}
                  disabled={safeColPage <= 1}
                  className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800 disabled:opacity-40 cursor-pointer"
                >
                  Cols -
                </button>
                <span>
                  Cols {(safeColPage - 1) * colPageSize + 1}–
                  {Math.min(safeColPage * colPageSize, filteredColumns.length)} /{' '}
                  {filteredColumns.length}
                </span>
                <button
                  type="button"
                  onClick={() => setColPage((p) => Math.min(totalColPages, p + 1))}
                  disabled={safeColPage >= totalColPages}
                  className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800 disabled:opacity-40 cursor-pointer"
                >
                  Cols +
                </button>
              </div>
            )}

            {/* Export buttons */}
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

        {/* Visual Color Legend */}
        {cleaningResult && activeTab !== 'original' && (
          <div className="px-4 py-1.5 border-b border-zinc-800/60 bg-[#0b0b0f] flex flex-wrap items-center gap-4 text-[11px] text-zinc-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/70 inline-block" />
              <span>Changed Value</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-rose-500/70 inline-block" />
              <span>Missing / Removed</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-500/70 inline-block" />
              <span>Needs Attention</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-zinc-700 inline-block" />
              <span>Unchanged</span>
            </span>
          </div>
        )}

        {/* Tabular Data View */}
        <div className="flex-1 overflow-x-auto bg-[#09090b]">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-zinc-800/80 bg-[#0d0d12]">
                <th className="px-3 py-2.5 text-zinc-500 font-mono text-[10px] w-16 text-center">
                  {activeTab !== 'original' && cleaningResult ? 'Orig #' : '#'}
                </th>
                {visibleColumns.map((col) => {
                  const colType = workingActiveStats.columnTypes[col];
                  const missingInCol = workingActiveStats.missingCounts[col] || 0;

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
                const activeRowIdx = (currentPage - 1) * pageSize + rowIdx;
                const origRowNum =
                  activeTab !== 'original' && cleaningResult?.originalRowNumbers
                    ? cleaningResult.originalRowNumbers[activeRowIdx] ?? activeRowIdx + 1
                    : activeRowIdx + 1;
                const origRowObj =
                  activeTab === 'compare' && origRowNum > 0
                    ? originalData[origRowNum - 1]
                    : null;

                return (
                  <tr key={`${activeRowIdx}_${origRowNum}`} className="hover:bg-zinc-900/50 transition-colors">
                    <td className="px-3 py-2 text-zinc-500 text-center text-[10px] tabular-nums">
                      #{origRowNum}
                    </td>
                    {visibleColumns.map((col) => {
                      const val = row[col];
                      const missing = isMissingValue(val, missingConfig);
                      const cellAudit =
                        activeTab !== 'original'
                          ? cleaningResult?.cellAuditByRowCol[`${activeRowIdx}:${col}`]
                          : undefined;

                      let cellClass = 'text-zinc-300';
                      if (cellAudit?.status === 'changed') {
                        cellClass = 'bg-emerald-950/35 text-emerald-200 border-l-2 border-emerald-500/70';
                      } else if (cellAudit?.status === 'attention') {
                        cellClass = 'bg-amber-950/35 text-amber-200 border-l-2 border-amber-500/70';
                      } else if (missing) {
                        cellClass = 'text-rose-400/80 italic bg-rose-950/15';
                      }

                      const origVal = origRowObj ? origRowObj[col] : undefined;
                      const showCompare =
                        activeTab === 'compare' &&
                        origRowObj &&
                        String(origVal ?? '') !== String(val ?? '');

                      return (
                        <td
                          key={col}
                          title={
                            cellAudit
                              ? `${cellAudit.operation}: ${cellAudit.previousValue} -> ${cellAudit.newValue}`
                              : undefined
                          }
                          className={`px-3 py-2 whitespace-nowrap text-xs ${cellClass}`}
                        >
                          {showCompare ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="line-through text-zinc-500 text-[10px]">
                                {isMissingValue(origVal, missingConfig)
                                  ? '<empty>'
                                  : String(origVal)}
                              </span>
                              <span className="text-emerald-300 font-semibold">
                                {missing ? '<empty>' : String(val)}
                              </span>
                            </span>
                          ) : missing ? (
                            '<empty>'
                          ) : (
                            String(val)
                          )}
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
