/**
 * Pure data cleaning and transformation engine for tabular data (CSV / XLSX).
 * Operates on arrays of record objects. Original data is never mutated.
 */

export interface MissingValueConfig {
  treatWhitespaceAsMissing?: boolean; // defaults to true
  treatNATokensAsMissing?: boolean; // defaults to false unless explicitly opted-in or requested
  explicitMissingTokens?: string[];
}

export interface DatasetStats {
  rowCount: number;
  columnCount: number;
  columns: string[];
  columnTypes: Record<string, 'string' | 'number' | 'boolean' | 'date' | 'empty'>;
  missingCounts: Record<string, number>;
  totalMissingValues: number;
  duplicateRowCount: number;
}

export type CleaningStrategy =
  | 'drop_row'
  | 'fill_custom'
  | 'fill_mean'
  | 'fill_median'
  | 'fill_mode'
  | 'fill_prev';

export type FilterOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'greater_than'
  | 'less_than'
  | 'greater_or_equal'
  | 'less_or_equal'
  | 'not_empty'
  | 'is_empty';

export type CleaningOperationType =
  | 'remove_duplicates'
  | 'handle_missing'
  | 'remove_empty_rows'
  | 'remove_empty_columns'
  | 'trim_whitespace'
  | 'standardize_text'
  | 'convert_type'
  | 'rename_column'
  | 'remove_column'
  | 'filter_rows'
  | 'standardize_date'
  | 'normalize_categories'
  | 'remove_invalid_emails'
  | 'remove_outliers'
  | 'reorder_columns'
  | 'sort_rows'
  | 'replace_values'
  | 'split_column'
  | 'merge_columns'
  | 'remove_invalid_phones';

export interface CleaningOperation {
  id: string;
  type: CleaningOperationType;
  params: Record<string, any>;
  description: string;
}

export type AuditEntryStatus = 'changed' | 'removed' | 'attention' | 'unchanged';

export interface CleaningAuditEntry {
  id: string;
  originalRow: number | null; // 1-based original row index; null for column-level actions
  column: string;
  previousValue: string;
  newValue: string;
  operation: CleaningOperationType;
  operationLabel: string;
  reason: string;
  status: AuditEntryStatus;
}

export interface CellAuditHighlight {
  status: AuditEntryStatus;
  previousValue: any;
  newValue: any;
  operation: string;
  reason: string;
}

export interface OperationExecutionSummary {
  id: string;
  type: CleaningOperationType;
  description: string;
  status: 'completed' | 'failed';
  affectedRows: number;
  affectedCells: number;
  affectedColumns: number;
  error?: string;
}

export interface CleaningResult {
  cleanedData: Record<string, any>[];
  statsBefore: DatasetStats;
  statsAfter: DatasetStats;
  rowsRemoved: number;
  duplicatesRemoved: number;
  missingValuesHandled: number;
  columnsModified: number;
  columnsRemoved: number;
  affectedCells: number;
  cellsModified: number;
  appliedOperations: string[];
  operationsCompleted: number;
  operationsFailed: number;
  operationSummaries: OperationExecutionSummary[];
  auditLog: CleaningAuditEntry[];
  auditLogTruncated: boolean;
  totalAuditEvents: number;
  cellAuditByRowCol: Record<string, CellAuditHighlight>;
  originalRowNumbers: number[];
}

export interface DatasetAiProfile {
  filename: string;
  rowCount: number;
  columnCount: number;
  columns: string[];
  columnTypes: Record<string, 'string' | 'number' | 'boolean' | 'date' | 'empty'>;
  missingCounts: Record<string, number>;
  duplicateRowCount: number;
  sampleRows: Record<string, any>[];
}

const DEFAULT_NA_TOKENS = new Set(['na', 'n/a', 'null', 'nan', 'none']);
const MAX_AUDIT_ENTRIES = 10_000;
const MAX_CELL_HIGHLIGHT_MAP = 25_000;

/**
 * Distinguishes true missing cells (`null`, `undefined`, `NaN`, `""`, and whitespace-only strings)
 * from legitimate text such as `"NA"` or `"N/A"` unless `treatNATokensAsMissing` is explicitly enabled.
 */
export const isMissingValue = (v: any, config?: MissingValueConfig): boolean => {
  if (v === undefined || v === null || (typeof v === 'number' && Number.isNaN(v))) {
    return true;
  }
  if (typeof v === 'string') {
    if (v === '') return true;
    const trimmed = v.trim();
    if (config?.treatWhitespaceAsMissing !== false && trimmed === '') {
      return true;
    }
    const lower = trimmed.toLowerCase();
    if (config?.treatNATokensAsMissing === true && DEFAULT_NA_TOKENS.has(lower)) {
      return true;
    }
    if (
      Array.isArray(config?.explicitMissingTokens) &&
      config!.explicitMissingTokens!.some((tok) => tok.trim().toLowerCase() === lower)
    ) {
      return true;
    }
  }
  return false;
};

/**
 * Normalizes a custom replacement value so numeric strings such as "0" or "-5"
 * become true numbers (`0`, `-5`) rather than unexpected strings or `'N/A'`.
 */
export function normalizeCustomFillValue(rawValue: any): any {
  if (rawValue === undefined || rawValue === null) {
    return undefined;
  }
  if (typeof rawValue === 'number') {
    return Number.isNaN(rawValue) ? undefined : rawValue;
  }
  if (typeof rawValue === 'boolean') {
    return rawValue;
  }
  const str = String(rawValue).trim();
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(str)) {
    const num = Number(str);
    if (Number.isFinite(num)) return num;
  }
  return str;
}

export function getAllColumns(data: Record<string, any>[]): string[] {
  if (!Array.isArray(data) || data.length === 0) return [];
  const colSet = new Set<string>();
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (row && typeof row === 'object') {
      const keys = Object.keys(row);
      for (let k = 0; k < keys.length; k++) {
        colSet.add(keys[k]);
      }
    }
  }
  return Array.from(colSet);
}

function formatAuditValue(v: any): string {
  if (v === undefined) return '(missing)';
  if (v === null) return '(null)';
  if (typeof v === 'number' && Number.isNaN(v)) return '(NaN)';
  if (typeof v === 'string') {
    if (v === '') return '(empty)';
    if (v.trim() === '') return '(whitespace)';
    return v;
  }
  return String(v);
}

const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function isValidPhoneNumber(raw: any): boolean {
  if (isMissingValue(raw)) return false;
  const s = String(raw).trim();
  if (!/^[+\d\s().-]+$/.test(s)) return false;
  const digits = s.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

/**
 * Parses varied date representations into ISO YYYY-MM-DD without UTC timezone shift bugs.
 */
export function normalizeDateString(raw: any): string | null {
  if (isMissingValue(raw)) return null;

  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    const d = String(raw.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const s = String(raw).trim();
  if (!s) return null;

  const ymdMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymdMatch) {
    const year = Number(ymdMatch[1]);
    const month = Number(ymdMatch[2]);
    const day = Number(ymdMatch[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const mdyMatch = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (mdyMatch) {
    const first = Number(mdyMatch[1]);
    const second = Number(mdyMatch[2]);
    const year = Number(mdyMatch[3]);
    let month = first;
    let day = second;
    if (first > 12 && second <= 12) {
      day = first;
      month = second;
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    if (s.includes('T') || s.endsWith('Z')) {
      return parsed.toISOString().split('T')[0];
    }
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return null;
}

/**
 * Calculates comprehensive statistical profile of a tabular dataset.
 */
export function calculateDatasetStats(
  data: Record<string, any>[],
  missingConfig?: MissingValueConfig
): DatasetStats {
  if (!Array.isArray(data) || data.length === 0) {
    return {
      rowCount: 0,
      columnCount: 0,
      columns: [],
      columnTypes: {},
      missingCounts: {},
      totalMissingValues: 0,
      duplicateRowCount: 0,
    };
  }

  const columns = getAllColumns(data);
  const rowCount = data.length;
  const columnCount = columns.length;

  const missingCounts: Record<string, number> = {};
  const strCounts = new Int32Array(columnCount);
  const numCounts = new Int32Array(columnCount);
  const boolCounts = new Int32Array(columnCount);
  const dateCounts = new Int32Array(columnCount);
  const emptyCounts = new Int32Array(columnCount);
  const missCounts = new Int32Array(columnCount);

  const rowSignatures = new Set<string>();
  let duplicateRowCount = 0;

  for (let i = 0; i < rowCount; i++) {
    const row = data[i];
    const sigParts = new Array<string>(columnCount);
    for (let c = 0; c < columnCount; c++) {
      const col = columns[c];
      const val = row[col];
      sigParts[c] = val === undefined || val === null ? '' : String(val);

      if (isMissingValue(val, missingConfig)) {
        missCounts[c]++;
        emptyCounts[c]++;
      } else if (typeof val === 'number') {
        numCounts[c]++;
      } else if (typeof val === 'boolean') {
        boolCounts[c]++;
      } else if (
        val instanceof Date ||
        (typeof val === 'string' &&
          val.length <= 32 &&
          (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(val.trim()) ||
            /^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(val.trim())))
      ) {
        dateCounts[c]++;
      } else if (typeof val === 'string') {
        const trimmed = val.trim();
        const numCheck = trimmed !== '' ? Number(trimmed) : Number.NaN;
        if (!Number.isNaN(numCheck)) {
          numCounts[c]++;
        } else {
          strCounts[c]++;
        }
      } else {
        strCounts[c]++;
      }
    }

    const sig = sigParts.join('|||');
    if (rowSignatures.has(sig)) {
      duplicateRowCount++;
    } else {
      rowSignatures.add(sig);
    }
  }

  const columnTypes: Record<string, 'string' | 'number' | 'boolean' | 'date' | 'empty'> = {};
  let totalMissingValues = 0;

  for (let c = 0; c < columnCount; c++) {
    const col = columns[c];
    missingCounts[col] = missCounts[c];
    totalMissingValues += missCounts[c];
    if (numCounts[c] >= strCounts[c] && numCounts[c] > 0) {
      columnTypes[col] = 'number';
    } else if (dateCounts[c] > strCounts[c] && dateCounts[c] > 0) {
      columnTypes[col] = 'date';
    } else if (boolCounts[c] > 0 && boolCounts[c] >= strCounts[c]) {
      columnTypes[col] = 'boolean';
    } else if (emptyCounts[c] === rowCount) {
      columnTypes[col] = 'empty';
    } else {
      columnTypes[col] = 'string';
    }
  }

  return {
    rowCount,
    columnCount,
    columns,
    columnTypes,
    missingCounts,
    totalMissingValues,
    duplicateRowCount,
  };
}

/**
 * Extracts ONLY metadata + a small sample of rows to send to the AI planner
 * so large datasets never exceed context or payload limits.
 */
export function buildDatasetProfileForAi(
  data: Record<string, any>[],
  filename: string,
  maxSampleRows = 6,
  statsOverride?: DatasetStats
): DatasetAiProfile {
  const stats = statsOverride || calculateDatasetStats(data);
  const boundedCols = stats.columns.slice(0, 200);
  const sampleRows = data.slice(0, Math.max(1, Math.min(maxSampleRows, 10))).map((row) => {
    if (stats.columns.length <= 200) return row;
    const partial: Record<string, any> = {};
    for (const c of boundedCols) partial[c] = row[c];
    return partial;
  });

  const boundedTypes: Record<string, 'string' | 'number' | 'boolean' | 'date' | 'empty'> = {};
  const boundedMissing: Record<string, number> = {};
  for (const c of boundedCols) {
    boundedTypes[c] = stats.columnTypes[c];
    boundedMissing[c] = stats.missingCounts[c] ?? 0;
  }

  return {
    filename,
    rowCount: stats.rowCount,
    columnCount: stats.columnCount,
    columns: boundedCols,
    columnTypes: boundedTypes,
    missingCounts: boundedMissing,
    duplicateRowCount: stats.duplicateRowCount,
    sampleRows,
  };
}

/**
 * 1. Remove duplicate rows based on all or specified columns.
 */
export function removeDuplicates(
  data: Record<string, any>[],
  keyColumns?: string[],
  keep: 'first' | 'last' = 'first'
): { data: Record<string, any>[]; removedCount: number; removedIndices: number[] } {
  const allCols =
    keyColumns && keyColumns.length > 0 ? keyColumns : getAllColumns(data);

  if (keep === 'last') {
    const seen = new Set<string>();
    const keptRev: Record<string, any>[] = [];
    const removedIndicesRev: number[] = [];
    let removedCount = 0;
    for (let i = data.length - 1; i >= 0; i--) {
      const row = data[i];
      const keysToCheck = allCols.length > 0 ? allCols : Object.keys(row);
      const sig = keysToCheck.map((k) => String(row[k] ?? '')).join(':::');
      if (seen.has(sig)) {
        removedCount++;
        removedIndicesRev.push(i);
      } else {
        seen.add(sig);
        keptRev.push({ ...row });
      }
    }
    keptRev.reverse();
    removedIndicesRev.reverse();
    return { data: keptRev, removedCount, removedIndices: removedIndicesRev };
  }

  const seen = new Set<string>();
  const cleaned: Record<string, any>[] = [];
  const removedIndices: number[] = [];
  let removedCount = 0;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const keysToCheck = allCols.length > 0 ? allCols : Object.keys(row);
    const sig = keysToCheck.map((k) => String(row[k] ?? '')).join(':::');
    if (seen.has(sig)) {
      removedCount++;
      removedIndices.push(i);
    } else {
      seen.add(sig);
      cleaned.push({ ...row });
    }
  }

  return { data: cleaned, removedCount, removedIndices };
}

/**
 * 2. Handle missing values for a specific column or all columns.
 * Numeric strings like "0" are stored as true numeric `0`. Never silently falls back to 'N/A'.
 */
export function handleMissingValues(
  data: Record<string, any>[],
  column: string,
  strategy: CleaningStrategy,
  fillValue?: any,
  missingConfig?: MissingValueConfig
): { data: Record<string, any>[]; handledCount: number; error?: string } {
  const targetColumns = column === 'ALL' ? getAllColumns(data) : [column];

  if (strategy === 'fill_custom') {
    const normalizedFill = normalizeCustomFillValue(fillValue);
    if (normalizedFill === undefined || normalizedFill === '') {
      return {
        data: data.map((r) => ({ ...r })),
        handledCount: 0,
        error: 'Custom fill strategy requires an explicit fillValue.',
      };
    }

    let handledCount = 0;
    const current = data.map((r) => ({ ...r }));
    for (let c = 0; c < targetColumns.length; c++) {
      const col = targetColumns[c];
      for (let i = 0; i < current.length; i++) {
        if (isMissingValue(current[i][col], missingConfig)) {
          current[i][col] = normalizedFill;
          handledCount++;
        }
      }
    }
    return { data: current, handledCount };
  }

  let handledCount = 0;

  if (strategy === 'drop_row') {
    const filtered: Record<string, any>[] = [];
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const missingInTarget = targetColumns.some((col) => isMissingValue(row[col], missingConfig));
      if (missingInTarget) {
        handledCount++;
      } else {
        filtered.push({ ...row });
      }
    }
    return { data: filtered, handledCount };
  }

  const current = data.map((r) => ({ ...r }));

  for (const col of targetColumns) {
    let numericStats = { mean: 0, median: 0, mode: '' as any };
    if (['fill_mean', 'fill_median', 'fill_mode'].includes(strategy)) {
      const validNums: number[] = [];
      const valFreq = new Map<string, { val: any; count: number }>();

      for (let i = 0; i < current.length; i++) {
        const v = current[i][col];
        if (!isMissingValue(v, missingConfig)) {
          const num = Number(String(v).replace(/[$,]/g, ''));
          if (!Number.isNaN(num)) validNums.push(num);
          const s = String(v);
          const existing = valFreq.get(s);
          if (existing) existing.count++;
          else valFreq.set(s, { val: v, count: 1 });
        }
      }

      if (validNums.length > 0) {
        const sum = validNums.reduce((acc, curr) => acc + curr, 0);
        numericStats.mean = Math.round((sum / validNums.length) * 100) / 100;
        validNums.sort((a, b) => a - b);
        const mid = Math.floor(validNums.length / 2);
        numericStats.median =
          validNums.length % 2 !== 0
            ? validNums[mid]
            : Math.round(((validNums[mid - 1] + validNums[mid]) / 2) * 100) / 100;
      }

      let maxCount = 0;
      let modeVal: any = '';
      for (const entry of valFreq.values()) {
        if (entry.count > maxCount) {
          maxCount = entry.count;
          modeVal = entry.val;
        }
      }
      numericStats.mode = modeVal;
    }

    let previousVal: any = undefined;
    const fallbackPrev = normalizeCustomFillValue(fillValue);
    for (let i = 0; i < current.length; i++) {
      const copy = current[i];
      if (isMissingValue(copy[col], missingConfig)) {
        if (strategy === 'fill_mean') {
          copy[col] = numericStats.mean;
          handledCount++;
        } else if (strategy === 'fill_median') {
          copy[col] = numericStats.median;
          handledCount++;
        } else if (strategy === 'fill_mode') {
          if (numericStats.mode !== '') {
            copy[col] = numericStats.mode;
            handledCount++;
          }
        } else if (strategy === 'fill_prev') {
          if (previousVal !== undefined) {
            copy[col] = previousVal;
            handledCount++;
          } else if (fallbackPrev !== undefined) {
            copy[col] = fallbackPrev;
            handledCount++;
          }
        }
      } else {
        previousVal = copy[col];
      }
    }
  }

  return { data: current, handledCount };
}

/**
 * 3. Remove completely empty rows.
 */
export function removeEmptyRows(
  data: Record<string, any>[],
  missingConfig?: MissingValueConfig
): {
  data: Record<string, any>[];
  removedCount: number;
} {
  let removedCount = 0;
  const filtered: Record<string, any>[] = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const hasAnyValue = Object.values(row).some((val) => !isMissingValue(val, missingConfig));
    if (!hasAnyValue) {
      removedCount++;
    } else {
      filtered.push({ ...row });
    }
  }
  return { data: filtered, removedCount };
}

/**
 * 4. Remove completely empty columns.
 */
export function removeEmptyColumns(
  data: Record<string, any>[],
  missingConfig?: MissingValueConfig
): {
  data: Record<string, any>[];
  removedColumns: string[];
} {
  if (data.length === 0) return { data: [], removedColumns: [] };
  const allCols = getAllColumns(data);
  const emptyCols = allCols.filter((col) =>
    data.every((row) => isMissingValue(row[col], missingConfig))
  );

  if (emptyCols.length === 0) {
    return { data: data.map((r) => ({ ...r })), removedColumns: [] };
  }

  const cleaned = data.map((row) => {
    const copy = { ...row };
    for (const col of emptyCols) delete copy[col];
    return copy;
  });

  return { data: cleaned, removedColumns: emptyCols };
}

/**
 * 5. Trim leading and trailing whitespace from all or targeted string columns.
 */
export function trimWhitespace(
  data: Record<string, any>[],
  targetColumns?: string[]
): {
  data: Record<string, any>[];
  modifiedFieldsCount: number;
} {
  let modifiedFieldsCount = 0;
  const colFilter =
    targetColumns && targetColumns.length > 0 && !targetColumns.includes('ALL')
      ? new Set(targetColumns)
      : null;

  const cleaned = data.map((row) => {
    const copy = { ...row };
    const keys = Object.keys(copy);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (colFilter && !colFilter.has(k)) continue;
      if (typeof copy[k] === 'string') {
        const trimmed = copy[k].trim();
        if (trimmed !== copy[k]) {
          modifiedFieldsCount++;
          copy[k] = trimmed;
        }
      }
    }
    return copy;
  });
  return { data: cleaned, modifiedFieldsCount };
}

/**
 * 6. Standardize text cases in a specific column.
 */
export function standardizeText(
  data: Record<string, any>[],
  column: string,
  caseType: 'lowercase' | 'uppercase' | 'titlecase' | 'trim'
): { data: Record<string, any>[]; modifiedCount: number } {
  let modifiedCount = 0;
  const toTitleCase = (str: string) =>
    str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase());

  const cleaned = data.map((row) => {
    const copy = { ...row };
    if (typeof copy[column] === 'string') {
      const orig = copy[column];
      let transformed = orig;
      if (caseType === 'lowercase') transformed = orig.toLowerCase();
      else if (caseType === 'uppercase') transformed = orig.toUpperCase();
      else if (caseType === 'titlecase') transformed = toTitleCase(orig);
      else if (caseType === 'trim') transformed = orig.trim();

      if (transformed !== orig) {
        modifiedCount++;
        copy[column] = transformed;
      }
    }
    return copy;
  });
  return { data: cleaned, modifiedCount };
}

/**
 * 7. Convert column data types.
 */
export function convertColumnType(
  data: Record<string, any>[],
  column: string,
  targetType: 'number' | 'date' | 'string' | 'boolean'
): { data: Record<string, any>[]; convertedCount: number; errorCount: number } {
  let convertedCount = 0;
  let errorCount = 0;

  const cleaned = data.map((row) => {
    const copy = { ...row };
    const val = copy[column];
    if (isMissingValue(val)) return copy;

    if (targetType === 'number') {
      const stripped = String(val).replace(/[^0-9.-]/g, '');
      const parsed = Number(stripped);
      if (!Number.isNaN(parsed) && stripped !== '' && stripped !== '-' && stripped !== '.') {
        copy[column] = parsed;
        convertedCount++;
      } else {
        errorCount++;
      }
    } else if (targetType === 'boolean') {
      const str = String(val).toLowerCase().trim();
      if (['true', '1', 'yes', 'y'].includes(str)) {
        copy[column] = true;
        convertedCount++;
      } else if (['false', '0', 'no', 'n'].includes(str)) {
        copy[column] = false;
        convertedCount++;
      } else {
        errorCount++;
      }
    } else if (targetType === 'date') {
      const iso = normalizeDateString(val);
      if (iso) {
        copy[column] = iso;
        convertedCount++;
      } else {
        errorCount++;
      }
    } else if (targetType === 'string') {
      copy[column] = String(val);
      convertedCount++;
    }

    return copy;
  });

  return { data: cleaned, convertedCount, errorCount };
}

/**
 * 8. Rename column.
 */
export function renameColumn(
  data: Record<string, any>[],
  oldName: string,
  newName: string
): { data: Record<string, any>[]; success: boolean } {
  if (!oldName || !newName || oldName === newName) return { data, success: false };
  const cleaned = data.map((row) => {
    const copy: Record<string, any> = {};
    Object.keys(row).forEach((k) => {
      if (k === oldName) {
        copy[newName] = row[k];
      } else {
        copy[k] = row[k];
      }
    });
    return copy;
  });
  return { data: cleaned, success: true };
}

/**
 * 9. Remove column.
 */
export function removeColumn(
  data: Record<string, any>[],
  columnName: string
): { data: Record<string, any>[]; success: boolean } {
  if (!columnName) return { data, success: false };
  const cleaned = data.map((row) => {
    const copy = { ...row };
    delete copy[columnName];
    return copy;
  });
  return { data: cleaned, success: true };
}

/**
 * 10. Filter rows by predicate.
 */
export function filterRows(
  data: Record<string, any>[],
  column: string,
  operator: FilterOperator,
  value: any
): { data: Record<string, any>[]; retainedCount: number; removedCount: number } {
  let removedCount = 0;
  const filtered = data.filter((row) => {
    const val = row[column];
    let match = false;

    if (operator === 'equals') {
      match = String(val ?? '').trim().toLowerCase() === String(value ?? '').trim().toLowerCase();
    } else if (operator === 'not_equals') {
      match = String(val ?? '').trim().toLowerCase() !== String(value ?? '').trim().toLowerCase();
    } else if (operator === 'contains') {
      match = String(val ?? '').toLowerCase().includes(String(value ?? '').toLowerCase());
    } else if (operator === 'not_contains') {
      match = !String(val ?? '').toLowerCase().includes(String(value ?? '').toLowerCase());
    } else if (operator === 'greater_than') {
      const n = Number(String(val ?? '').replace(/[$,]/g, ''));
      match = !isMissingValue(val) && !Number.isNaN(n) && n > Number(value);
    } else if (operator === 'less_than') {
      const n = Number(String(val ?? '').replace(/[$,]/g, ''));
      match = !isMissingValue(val) && !Number.isNaN(n) && n < Number(value);
    } else if (operator === 'greater_or_equal') {
      const n = Number(String(val ?? '').replace(/[$,]/g, ''));
      match = !isMissingValue(val) && !Number.isNaN(n) && n >= Number(value);
    } else if (operator === 'less_or_equal') {
      const n = Number(String(val ?? '').replace(/[$,]/g, ''));
      match = !isMissingValue(val) && !Number.isNaN(n) && n <= Number(value);
    } else if (operator === 'not_empty') {
      match = !isMissingValue(val);
    } else if (operator === 'is_empty') {
      match = isMissingValue(val);
    }

    if (!match) removedCount++;
    return match;
  });

  return {
    data: filtered.map((r) => ({ ...r })),
    retainedCount: filtered.length,
    removedCount,
  };
}

/**
 * 11. Standardize date column values to ISO YYYY-MM-DD format.
 */
export function standardizeDateColumn(
  data: Record<string, any>[],
  column: string
): { data: Record<string, any>[]; modifiedCount: number; unparseableCount: number } {
  let modifiedCount = 0;
  let unparseableCount = 0;

  const cleaned = data.map((row) => {
    const copy = { ...row };
    const val = copy[column];
    if (isMissingValue(val)) return copy;

    const normalized = normalizeDateString(val);
    if (normalized) {
      if (normalized !== String(val)) {
        modifiedCount++;
      }
      copy[column] = normalized;
    } else {
      unparseableCount++;
    }
    return copy;
  });

  return { data: cleaned, modifiedCount, unparseableCount };
}

/**
 * 12. Normalize inconsistent categorical labels (explicit mapping and/or casing normalization).
 */
export function normalizeCategories(
  data: Record<string, any>[],
  column: string,
  mapping?: Record<string, string>,
  caseType?: 'lowercase' | 'uppercase' | 'titlecase'
): { data: Record<string, any>[]; modifiedCount: number } {
  let modifiedCount = 0;
  const lowerMap = new Map<string, string>();
  if (mapping) {
    for (const [k, v] of Object.entries(mapping)) {
      lowerMap.set(k.trim().toLowerCase(), v);
    }
  }

  const toTitleCase = (str: string) =>
    str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase());

  const cleaned = data.map((row) => {
    const copy = { ...row };
    const val = copy[column];
    if (typeof val !== 'string' || !val.trim()) return copy;

    const trimmed = val.trim();
    const mapped = lowerMap.get(trimmed.toLowerCase());
    let nextVal = mapped !== undefined ? mapped : trimmed;

    if (mapped === undefined && caseType) {
      if (caseType === 'lowercase') nextVal = nextVal.toLowerCase();
      else if (caseType === 'uppercase') nextVal = nextVal.toUpperCase();
      else if (caseType === 'titlecase') nextVal = toTitleCase(nextVal);
    }

    if (nextVal !== val) {
      modifiedCount++;
      copy[column] = nextVal;
    }
    return copy;
  });

  return { data: cleaned, modifiedCount };
}

/**
 * 13. Remove or clear invalid email addresses in an email column.
 */
export function removeInvalidEmails(
  data: Record<string, any>[],
  column: string,
  mode: 'drop_row' | 'clear_cell' = 'drop_row'
): { data: Record<string, any>[]; invalidCount: number } {
  let invalidCount = 0;

  if (mode === 'clear_cell') {
    const cleaned = data.map((row) => {
      const copy = { ...row };
      const raw = copy[column];
      if (!isMissingValue(raw) && !EMAIL_REGEX.test(String(raw).trim())) {
        invalidCount++;
        copy[column] = '';
      }
      return copy;
    });
    return { data: cleaned, invalidCount };
  }

  const filtered = data.filter((row) => {
    const raw = row[column];
    if (isMissingValue(raw) || !EMAIL_REGEX.test(String(raw).trim())) {
      invalidCount++;
      return false;
    }
    return true;
  });

  return { data: filtered.map((r) => ({ ...r })), invalidCount };
}

/**
 * 14. Remove numeric outliers using IQR (default 1.5x) or Z-score (default threshold 3).
 */
export function removeOutliers(
  data: Record<string, any>[],
  column: string,
  method: 'iqr' | 'zscore' = 'iqr',
  threshold?: number
): { data: Record<string, any>[]; removedCount: number } {
  const nums: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const v = data[i][column];
    if (!isMissingValue(v)) {
      const n = Number(String(v).replace(/[$,]/g, ''));
      if (!Number.isNaN(n)) nums.push(n);
    }
  }

  if (nums.length < 4) {
    return { data: data.map((r) => ({ ...r })), removedCount: 0 };
  }

  let lowerBound = -Infinity;
  let upperBound = Infinity;

  if (method === 'zscore') {
    const zThresh = threshold && threshold > 0 ? threshold : 3;
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    const variance = nums.reduce((acc, x) => acc + (x - mean) ** 2, 0) / nums.length;
    const std = Math.sqrt(variance);
    if (std > 0) {
      lowerBound = mean - zThresh * std;
      upperBound = mean + zThresh * std;
    }
  } else {
    const k = threshold && threshold > 0 ? threshold : 1.5;
    const sorted = [...nums].sort((a, b) => a - b);
    const q1 = sorted[Math.floor((sorted.length - 1) * 0.25)];
    const q3 = sorted[Math.floor((sorted.length - 1) * 0.75)];
    const iqr = q3 - q1;
    lowerBound = q1 - k * iqr;
    upperBound = q3 + k * iqr;
  }

  let removedCount = 0;
  const filtered = data.filter((row) => {
    const v = row[column];
    if (isMissingValue(v)) return true;
    const n = Number(String(v).replace(/[$,]/g, ''));
    if (Number.isNaN(n)) return true;
    if (n < lowerBound || n > upperBound) {
      removedCount++;
      return false;
    }
    return true;
  });

  return { data: filtered.map((r) => ({ ...r })), removedCount };
}

/**
 * 15. Replace specific values / find-and-replace across one column or ALL columns.
 */
export function replaceValues(
  data: Record<string, any>[],
  column: string,
  findValue: any,
  replaceValue: any,
  exactMatch = true,
  caseSensitive = false
): { data: Record<string, any>[]; modifiedCount: number } {
  const targetColumns = column === 'ALL' ? getAllColumns(data) : [column];
  const findStr = String(findValue ?? '');
  const findComparable = caseSensitive ? findStr : findStr.toLowerCase();
  const normalizedReplace = normalizeCustomFillValue(replaceValue);
  const replacement = normalizedReplace === undefined ? '' : normalizedReplace;

  let modifiedCount = 0;
  const cleaned = data.map((row) => {
    const copy = { ...row };
    for (const col of targetColumns) {
      const val = copy[col];
      if (val === undefined || val === null) continue;
      const valStr = String(val);
      if (exactMatch) {
        const cmp = caseSensitive ? valStr : valStr.trim().toLowerCase();
        if (cmp === (caseSensitive ? findComparable : findComparable.trim())) {
          if (copy[col] !== replacement) {
            copy[col] = replacement;
            modifiedCount++;
          }
        }
      } else {
        const escaped = findStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(escaped, caseSensitive ? 'g' : 'gi');
        const nextStr = valStr.replace(re, String(replacement));
        if (nextStr !== valStr) {
          copy[col] = normalizeCustomFillValue(nextStr) ?? nextStr;
          modifiedCount++;
        }
      }
    }
    return copy;
  });

  return { data: cleaned, modifiedCount };
}

/**
 * 16. Sort rows by a given column ascending or descending.
 */
export function sortRows(
  data: Record<string, any>[],
  column: string,
  direction: 'asc' | 'desc' = 'asc'
): { data: Record<string, any>[]; sorted: boolean } {
  const mult = direction === 'desc' ? -1 : 1;
  const indexed = data.map((row, idx) => ({ row: { ...row }, idx }));
  indexed.sort((a, b) => {
    const va = a.row[column];
    const vb = b.row[column];
    const ma = isMissingValue(va);
    const mb = isMissingValue(vb);
    if (ma && mb) return a.idx - b.idx;
    if (ma) return 1;
    if (mb) return -1;
    const na = Number(String(va).replace(/[$,]/g, ''));
    const nb = Number(String(vb).replace(/[$,]/g, ''));
    if (!Number.isNaN(na) && !Number.isNaN(nb)) {
      return na === nb ? a.idx - b.idx : (na - nb) * mult;
    }
    const cmp = String(va).localeCompare(String(vb));
    return cmp === 0 ? a.idx - b.idx : cmp * mult;
  });
  return { data: indexed.map((x) => x.row), sorted: true };
}

/**
 * 17. Reorder columns according to the specified column list (remaining columns appended cleanly).
 */
export function reorderColumns(
  data: Record<string, any>[],
  preferredOrder: string[]
): { data: Record<string, any>[]; columnsOrder: string[] } {
  const existingCols = getAllColumns(data);
  const existingSet = new Set(existingCols);
  const ordered: string[] = [];
  for (const col of preferredOrder) {
    if (existingSet.has(col) && !ordered.includes(col)) {
      ordered.push(col);
    }
  }
  for (const col of existingCols) {
    if (!ordered.includes(col)) ordered.push(col);
  }
  const cleaned = data.map((row) => {
    const copy: Record<string, any> = {};
    for (const col of ordered) copy[col] = row[col];
    return copy;
  });
  return { data: cleaned, columnsOrder: ordered };
}

/**
 * 18. Split a single column by delimiter into target columns.
 */
export function splitColumn(
  data: Record<string, any>[],
  column: string,
  delimiter = ' ',
  intoColumns: string[] = []
): { data: Record<string, any>[]; modifiedCount: number } {
  const targets =
    intoColumns.length >= 2 ? intoColumns : [`${column}_part1`, `${column}_part2`];
  let modifiedCount = 0;

  const cleaned = data.map((row) => {
    const copy = { ...row };
    const val = copy[column];
    if (!isMissingValue(val)) {
      const parts = String(val).split(delimiter);
      for (let i = 0; i < targets.length; i++) {
        if (i === targets.length - 1 && parts.length > targets.length) {
          copy[targets[i]] = parts.slice(i).join(delimiter).trim();
        } else {
          copy[targets[i]] = (parts[i] ?? '').trim();
        }
      }
      modifiedCount++;
    } else {
      for (const t of targets) {
        if (!(t in copy)) copy[t] = '';
      }
    }
    return copy;
  });

  return { data: cleaned, modifiedCount };
}

/**
 * 19. Merge two or more columns into a target column.
 */
export function mergeColumns(
  data: Record<string, any>[],
  columns: string[],
  separator = ' ',
  targetColumn = 'merged_column',
  dropOriginals = false
): { data: Record<string, any>[]; modifiedCount: number } {
  let modifiedCount = 0;
  const cleaned = data.map((row) => {
    const copy = { ...row };
    const joined = columns
      .map((c) => copy[c])
      .filter((v) => !isMissingValue(v))
      .map((v) => String(v).trim())
      .join(separator);
    copy[targetColumn] = joined;
    if (dropOriginals) {
      for (const c of columns) {
        if (c !== targetColumn) delete copy[c];
      }
    }
    modifiedCount++;
    return copy;
  });
  return { data: cleaned, modifiedCount };
}

/**
 * 20. Remove or clear invalid phone numbers.
 */
export function removeInvalidPhones(
  data: Record<string, any>[],
  column: string,
  mode: 'drop_row' | 'clear_cell' = 'drop_row'
): { data: Record<string, any>[]; invalidCount: number } {
  let invalidCount = 0;
  if (mode === 'clear_cell') {
    const cleaned = data.map((row) => {
      const copy = { ...row };
      const raw = copy[column];
      if (!isMissingValue(raw) && !isValidPhoneNumber(raw)) {
        invalidCount++;
        copy[column] = '';
      }
      return copy;
    });
    return { data: cleaned, invalidCount };
  }

  const filtered = data.filter((row) => {
    const raw = row[column];
    if (isMissingValue(raw) || !isValidPhoneNumber(raw)) {
      invalidCount++;
      return false;
    }
    return true;
  });
  return { data: filtered.map((r) => ({ ...r })), invalidCount };
}

/**
 * Applies a batch of cleaning operations sequentially while recording a full per-change
 * audit log with stable original 1-based row numbers and operation status metrics.
 * Never mutates originalData.
 */
export function executeCleaningPipeline(
  originalData: Record<string, any>[],
  operations: CleaningOperation[],
  missingConfig?: MissingValueConfig
): CleaningResult {
  const statsBefore = calculateDatasetStats(originalData, missingConfig);

  // Maintain parallel arrays: active rows and their original 1-based row index
  let currentData: Record<string, any>[] = originalData.map((r) => ({ ...r }));
  let rowOriginMap: number[] = originalData.map((_, i) => i + 1);
  // Also track historical per-cell highlight by original row & column so removed or modified cells remain traceable
  const cellHighlightByOrigRowCol = new Map<string, CellAuditHighlight>();

  let totalRowsRemoved = 0;
  let totalDuplicatesRemoved = 0;
  let totalMissingHandled = 0;
  let totalColsModified = 0;
  let totalColumnsRemoved = 0;
  let totalAffectedCells = 0;
  let operationsCompleted = 0;
  let operationsFailed = 0;
  let totalAuditEvents = 0;
  let auditLogTruncated = false;

  const applied: string[] = [];
  const auditLog: CleaningAuditEntry[] = [];
  const operationSummaries: OperationExecutionSummary[] = [];

  const pushAudit = (entry: Omit<CleaningAuditEntry, 'id'>) => {
    totalAuditEvents++;
    if (auditLog.length < MAX_AUDIT_ENTRIES) {
      auditLog.push({
        id: `aud_${totalAuditEvents}`,
        ...entry,
      });
    } else {
      auditLogTruncated = true;
    }

    if (
      entry.originalRow !== null &&
      cellHighlightByOrigRowCol.size < MAX_CELL_HIGHLIGHT_MAP &&
      entry.column &&
      entry.column !== '(row)'
    ) {
      cellHighlightByOrigRowCol.set(`${entry.originalRow}:${entry.column}`, {
        status: entry.status,
        previousValue: entry.previousValue,
        newValue: entry.newValue,
        operation: entry.operationLabel,
        reason: entry.reason,
      });
    }
  };

  operations.forEach((op) => {
    let opAffectedRows = 0;
    let opAffectedCells = 0;
    let opAffectedCols = 0;
    let opStatus: 'completed' | 'failed' = 'completed';
    let opError: string | undefined;

    const currentCols = getAllColumns(currentData);
    const currentColSet = new Set(currentCols);

    try {
      switch (op.type) {
        case 'remove_duplicates': {
          const keyCols: string[] | undefined =
            Array.isArray(op.params.columns) && op.params.columns.length > 0
              ? op.params.columns
              : undefined;
          const keep: 'first' | 'last' = op.params.keep === 'last' ? 'last' : 'first';
          const checkCols = keyCols || currentCols;
          const seen = new Set<string>();
          const nextData: Record<string, any>[] = [];
          const nextOrig: number[] = [];

          if (keep === 'last') {
            for (let i = currentData.length - 1; i >= 0; i--) {
              const row = currentData[i];
              const sig = checkCols.map((k) => String(row[k] ?? '')).join(':::');
              if (seen.has(sig)) {
                opAffectedRows++;
                totalDuplicatesRemoved++;
                totalRowsRemoved++;
                pushAudit({
                  originalRow: rowOriginMap[i],
                  column: '(row)',
                  previousValue: checkCols.slice(0, 4).map((c) => `${c}=${formatAuditValue(row[c])}`).join(', '),
                  newValue: '(row removed)',
                  operation: 'remove_duplicates',
                  operationLabel: 'Remove Duplicates',
                  reason: `Duplicate row detected (kept ${keep} occurrence)`,
                  status: 'removed',
                });
              } else {
                seen.add(sig);
                nextData.push(row);
                nextOrig.push(rowOriginMap[i]);
              }
            }
            nextData.reverse();
            nextOrig.reverse();
          } else {
            for (let i = 0; i < currentData.length; i++) {
              const row = currentData[i];
              const sig = checkCols.map((k) => String(row[k] ?? '')).join(':::');
              if (seen.has(sig)) {
                opAffectedRows++;
                totalDuplicatesRemoved++;
                totalRowsRemoved++;
                pushAudit({
                  originalRow: rowOriginMap[i],
                  column: '(row)',
                  previousValue: checkCols.slice(0, 4).map((c) => `${c}=${formatAuditValue(row[c])}`).join(', '),
                  newValue: '(row removed)',
                  operation: 'remove_duplicates',
                  operationLabel: 'Remove Duplicates',
                  reason: `Duplicate row detected (kept ${keep} occurrence)`,
                  status: 'removed',
                });
              } else {
                seen.add(sig);
                nextData.push(row);
                nextOrig.push(rowOriginMap[i]);
              }
            }
          }

          currentData = nextData;
          rowOriginMap = nextOrig;
          applied.push(
            `Removed ${opAffectedRows} duplicate row${opAffectedRows === 1 ? '' : 's'}${
              keyCols?.length ? ` (by ${keyCols.join(', ')})` : ''
            }`
          );
          break;
        }

        case 'handle_missing': {
          const cols: string[] =
            Array.isArray(op.params.columns) && op.params.columns.length > 0
              ? op.params.columns
              : [op.params.column || 'ALL'];
          const strategy = op.params.strategy as CleaningStrategy;

          if (strategy === 'fill_custom') {
            const normalizedFill = normalizeCustomFillValue(op.params.fillValue);
            if (normalizedFill === undefined || normalizedFill === '') {
              opStatus = 'failed';
              opError = 'Missing custom fill value for handle_missing (fill_custom).';
              break;
            }
          }

          for (const colSpec of cols) {
            if (colSpec !== 'ALL' && !currentColSet.has(colSpec)) {
              opStatus = 'failed';
              opError = `Column '${colSpec}' does not exist in the dataset.`;
              break;
            }
            const targetCols = colSpec === 'ALL' ? currentCols : [colSpec];

            if (strategy === 'drop_row') {
              const nextData: Record<string, any>[] = [];
              const nextOrig: number[] = [];
              for (let i = 0; i < currentData.length; i++) {
                const row = currentData[i];
                const missingCols = targetCols.filter((c) => isMissingValue(row[c], missingConfig));
                if (missingCols.length > 0) {
                  totalMissingHandled += missingCols.length;
                  totalRowsRemoved++;
                  opAffectedRows++;
                  pushAudit({
                    originalRow: rowOriginMap[i],
                    column: missingCols.slice(0, 4).join(', '),
                    previousValue: '(missing)',
                    newValue: '(row removed)',
                    operation: 'handle_missing',
                    operationLabel: 'Handle Missing (Drop Row)',
                    reason: `Row dropped due to missing value in ${missingCols[0]}`,
                    status: 'removed',
                  });
                } else {
                  nextData.push(row);
                  nextOrig.push(rowOriginMap[i]);
                }
              }
              currentData = nextData;
              rowOriginMap = nextOrig;
              applied.push(
                `Dropped ${opAffectedRows} row${opAffectedRows === 1 ? '' : 's'} with missing values in '${colSpec}'`
              );
            } else {
              const fillValNormalized = normalizeCustomFillValue(op.params.fillValue);
              let colCellsUpdated = 0;
              const modifiedColSet = new Set<string>();

              for (const tc of targetCols) {
                let numericStats = { mean: 0, median: 0, mode: '' as any };
                if (['fill_mean', 'fill_median', 'fill_mode'].includes(strategy)) {
                  const validNums: number[] = [];
                  const valFreq = new Map<string, { val: any; count: number }>();
                  for (let i = 0; i < currentData.length; i++) {
                    const v = currentData[i][tc];
                    if (!isMissingValue(v, missingConfig)) {
                      const num = Number(String(v).replace(/[$,]/g, ''));
                      if (!Number.isNaN(num)) validNums.push(num);
                      const s = String(v);
                      const ex = valFreq.get(s);
                      if (ex) ex.count++;
                      else valFreq.set(s, { val: v, count: 1 });
                    }
                  }
                  if (validNums.length > 0) {
                    const sum = validNums.reduce((a, b) => a + b, 0);
                    numericStats.mean = Math.round((sum / validNums.length) * 100) / 100;
                    validNums.sort((a, b) => a - b);
                    const mid = Math.floor(validNums.length / 2);
                    numericStats.median =
                      validNums.length % 2 !== 0
                        ? validNums[mid]
                        : Math.round(((validNums[mid - 1] + validNums[mid]) / 2) * 100) / 100;
                  }
                  let maxCount = 0;
                  let modeVal: any = '';
                  for (const entry of valFreq.values()) {
                    if (entry.count > maxCount) {
                      maxCount = entry.count;
                      modeVal = entry.val;
                    }
                  }
                  numericStats.mode = modeVal;
                }

                let prevVal: any = undefined;
                for (let i = 0; i < currentData.length; i++) {
                  const row = currentData[i];
                  const oldVal = row[tc];
                  if (isMissingValue(oldVal, missingConfig)) {
                    let replacement: any = undefined;
                    let reason = '';
                    if (strategy === 'fill_custom') {
                      replacement = fillValNormalized;
                      reason = `Replaced missing value with ${formatAuditValue(fillValNormalized)}`;
                    } else if (strategy === 'fill_mean') {
                      replacement = numericStats.mean;
                      reason = `Imputed missing value with column mean (${numericStats.mean})`;
                    } else if (strategy === 'fill_median') {
                      replacement = numericStats.median;
                      reason = `Imputed missing value with column median (${numericStats.median})`;
                    } else if (strategy === 'fill_mode') {
                      if (numericStats.mode !== '') {
                        replacement = numericStats.mode;
                        reason = `Imputed missing value with column mode (${numericStats.mode})`;
                      }
                    } else if (strategy === 'fill_prev') {
                      if (prevVal !== undefined) {
                        replacement = prevVal;
                        reason = `Forward-filled missing value from previous row (${formatAuditValue(prevVal)})`;
                      } else if (fillValNormalized !== undefined) {
                        replacement = fillValNormalized;
                        reason = `Filled leading missing value with ${formatAuditValue(fillValNormalized)}`;
                      }
                    }

                    if (replacement !== undefined) {
                      row[tc] = replacement;
                      totalMissingHandled++;
                      totalAffectedCells++;
                      opAffectedCells++;
                      colCellsUpdated++;
                      modifiedColSet.add(tc);
                      pushAudit({
                        originalRow: rowOriginMap[i],
                        column: tc,
                        previousValue: formatAuditValue(oldVal),
                        newValue: formatAuditValue(replacement),
                        operation: 'handle_missing',
                        operationLabel: 'Handle Missing Values',
                        reason,
                        status: 'changed',
                      });
                    }
                  } else {
                    prevVal = oldVal;
                  }
                }
              }

              opAffectedCols += modifiedColSet.size;
              totalColsModified += modifiedColSet.size;
              applied.push(
                `Handled ${colCellsUpdated} missing value${colCellsUpdated === 1 ? '' : 's'} in '${colSpec}' (${strategy}${
                  strategy === 'fill_custom' ? ` -> ${fillValNormalized}` : ''
                })`
              );
            }
          }
          break;
        }

        case 'remove_empty_rows': {
          const nextData: Record<string, any>[] = [];
          const nextOrig: number[] = [];
          for (let i = 0; i < currentData.length; i++) {
            const row = currentData[i];
            const hasAny = Object.values(row).some((val) => !isMissingValue(val, missingConfig));
            if (!hasAny) {
              opAffectedRows++;
              totalRowsRemoved++;
              pushAudit({
                originalRow: rowOriginMap[i],
                column: '(row)',
                previousValue: '(all empty cells)',
                newValue: '(row removed)',
                operation: 'remove_empty_rows',
                operationLabel: 'Remove Empty Rows',
                reason: 'All cells in row were empty/missing',
                status: 'removed',
              });
            } else {
              nextData.push(row);
              nextOrig.push(rowOriginMap[i]);
            }
          }
          currentData = nextData;
          rowOriginMap = nextOrig;
          applied.push(
            `Removed ${opAffectedRows} completely empty row${opAffectedRows === 1 ? '' : 's'}`
          );
          break;
        }

        case 'remove_empty_columns': {
          const emptyCols = currentCols.filter((col) =>
            currentData.every((row) => isMissingValue(row[col], missingConfig))
          );
          if (emptyCols.length > 0) {
            for (let i = 0; i < currentData.length; i++) {
              for (const col of emptyCols) delete currentData[i][col];
            }
            for (const col of emptyCols) {
              totalColumnsRemoved++;
              totalColsModified++;
              opAffectedCols++;
              pushAudit({
                originalRow: null,
                column: col,
                previousValue: '(100% empty column)',
                newValue: '(column removed)',
                operation: 'remove_empty_columns',
                operationLabel: 'Remove Empty Columns',
                reason: `Removed completely empty column '${col}'`,
                status: 'removed',
              });
            }
          }
          applied.push(
            emptyCols.length > 0
              ? `Removed ${emptyCols.length} empty column(s): ${emptyCols.join(', ')}`
              : 'Checked for empty columns (none found)'
          );
          break;
        }

        case 'trim_whitespace': {
          const targetCols: string[] | undefined =
            Array.isArray(op.params.columns) && op.params.columns.length > 0
              ? op.params.columns
              : op.params.column && op.params.column !== 'ALL'
              ? [op.params.column]
              : undefined;
          const colsToTrim = targetCols || currentCols;

          for (const col of colsToTrim) {
            if (!currentColSet.has(col)) continue;
            let colChanged = false;
            for (let i = 0; i < currentData.length; i++) {
              const row = currentData[i];
              const orig = row[col];
              if (typeof orig === 'string') {
                const trimmed = orig.trim();
                if (trimmed !== orig) {
                  row[col] = trimmed;
                  totalAffectedCells++;
                  opAffectedCells++;
                  colChanged = true;
                  pushAudit({
                    originalRow: rowOriginMap[i],
                    column: col,
                    previousValue: JSON.stringify(orig),
                    newValue: JSON.stringify(trimmed),
                    operation: 'trim_whitespace',
                    operationLabel: 'Trim Whitespace',
                    reason: 'Removed leading/trailing whitespace',
                    status: 'changed',
                  });
                }
              }
            }
            if (colChanged) {
              opAffectedCols++;
              totalColsModified++;
            }
          }
          applied.push(
            `Trimmed whitespace across ${opAffectedCells} cell${opAffectedCells === 1 ? '' : 's'}${
              targetCols ? ` in ${targetCols.join(', ')}` : ''
            }`
          );
          break;
        }

        case 'standardize_text': {
          const cols: string[] =
            Array.isArray(op.params.columns) && op.params.columns.length > 0
              ? op.params.columns
              : [op.params.column];
          const caseType: 'lowercase' | 'uppercase' | 'titlecase' | 'trim' =
            op.params.caseType || 'lowercase';
          const toTitleCase = (str: string) =>
            str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase());

          for (const col of cols) {
            if (!col || !currentColSet.has(col)) continue;
            let countForCol = 0;
            for (let i = 0; i < currentData.length; i++) {
              const orig = currentData[i][col];
              if (typeof orig === 'string') {
                let next = orig;
                if (caseType === 'lowercase') next = orig.toLowerCase();
                else if (caseType === 'uppercase') next = orig.toUpperCase();
                else if (caseType === 'titlecase') next = toTitleCase(orig);
                else if (caseType === 'trim') next = orig.trim();
                if (next !== orig) {
                  currentData[i][col] = next;
                  countForCol++;
                  opAffectedCells++;
                  totalAffectedCells++;
                  pushAudit({
                    originalRow: rowOriginMap[i],
                    column: col,
                    previousValue: orig,
                    newValue: next,
                    operation: 'standardize_text',
                    operationLabel: 'Standardize Text',
                    reason: `Converted casing to ${caseType}`,
                    status: 'changed',
                  });
                }
              }
            }
            if (countForCol > 0) {
              opAffectedCols++;
              totalColsModified++;
            }
            applied.push(`Standardized '${col}' to ${caseType} (${countForCol} cells updated)`);
          }
          break;
        }

        case 'convert_type': {
          const col = op.params.column;
          const targetType = op.params.targetType as 'number' | 'date' | 'string' | 'boolean';
          if (!currentColSet.has(col)) {
            opStatus = 'failed';
            opError = `Column '${col}' not found for type conversion.`;
            break;
          }
          let converted = 0;
          for (let i = 0; i < currentData.length; i++) {
            const val = currentData[i][col];
            if (isMissingValue(val, missingConfig)) continue;
            let nextVal: any = val;
            let ok = true;
            if (targetType === 'number') {
              const stripped = String(val).replace(/[^0-9.-]/g, '');
              const parsed = Number(stripped);
              if (!Number.isNaN(parsed) && stripped !== '' && stripped !== '-' && stripped !== '.') {
                nextVal = parsed;
              } else {
                ok = false;
              }
            } else if (targetType === 'boolean') {
              const str = String(val).toLowerCase().trim();
              if (['true', '1', 'yes', 'y'].includes(str)) nextVal = true;
              else if (['false', '0', 'no', 'n'].includes(str)) nextVal = false;
              else ok = false;
            } else if (targetType === 'date') {
              const iso = normalizeDateString(val);
              if (iso) nextVal = iso;
              else ok = false;
            } else if (targetType === 'string') {
              nextVal = String(val);
            }

            if (ok) {
              if (nextVal !== val) {
                currentData[i][col] = nextVal;
                converted++;
                opAffectedCells++;
                totalAffectedCells++;
                pushAudit({
                  originalRow: rowOriginMap[i],
                  column: col,
                  previousValue: formatAuditValue(val),
                  newValue: formatAuditValue(nextVal),
                  operation: 'convert_type',
                  operationLabel: 'Convert Type',
                  reason: `Converted value to ${targetType}`,
                  status: 'changed',
                });
              }
            } else {
              pushAudit({
                originalRow: rowOriginMap[i],
                column: col,
                previousValue: formatAuditValue(val),
                newValue: formatAuditValue(val),
                operation: 'convert_type',
                operationLabel: 'Convert Type',
                reason: `Could not convert value to ${targetType}`,
                status: 'attention',
              });
            }
          }
          if (converted > 0) {
            opAffectedCols++;
            totalColsModified++;
          }
          applied.push(`Converted '${col}' to ${targetType} (${converted} cells converted)`);
          break;
        }

        case 'rename_column': {
          const oldName = op.params.oldName;
          const newName = op.params.newName;
          if (!oldName || !newName || !currentColSet.has(oldName)) {
            opStatus = 'failed';
            opError = `Cannot rename column '${oldName}': column not found.`;
            break;
          }
          const res = renameColumn(currentData, oldName, newName);
          if (res.success) {
            currentData = res.data;
            totalColsModified++;
            opAffectedCols++;
            pushAudit({
              originalRow: null,
              column: `${oldName} -> ${newName}`,
              previousValue: oldName,
              newValue: newName,
              operation: 'rename_column',
              operationLabel: 'Rename Column',
              reason: `Renamed column '${oldName}' to '${newName}'`,
              status: 'changed',
            });
            applied.push(`Renamed column '${oldName}' to '${newName}'`);
          }
          break;
        }

        case 'remove_column': {
          const colsToRemove: string[] =
            Array.isArray(op.params.columns) && op.params.columns.length > 0
              ? op.params.columns
              : op.params.columnName
              ? [op.params.columnName]
              : op.params.column
              ? [op.params.column]
              : [];

          for (const colName of colsToRemove) {
            if (!currentColSet.has(colName)) {
              opStatus = 'failed';
              opError = `Column '${colName}' not found in dataset.`;
              continue;
            }
            for (let i = 0; i < currentData.length; i++) {
              delete currentData[i][colName];
            }
            currentColSet.delete(colName);
            totalColumnsRemoved++;
            totalColsModified++;
            opAffectedCols++;
            pushAudit({
              originalRow: null,
              column: colName,
              previousValue: '(present)',
              newValue: '(column removed)',
              operation: 'remove_column',
              operationLabel: 'Remove Column',
              reason: `Removed column '${colName}'`,
              status: 'removed',
            });
            applied.push(`Removed column '${colName}'`);
          }
          break;
        }

        case 'filter_rows': {
          const col = op.params.column;
          const operator = op.params.operator as FilterOperator;
          const filterVal = op.params.value;
          if (!currentColSet.has(col)) {
            opStatus = 'failed';
            opError = `Column '${col}' not found for row filter.`;
            break;
          }
          const nextData: Record<string, any>[] = [];
          const nextOrig: number[] = [];

          for (let i = 0; i < currentData.length; i++) {
            const row = currentData[i];
            const val = row[col];
            let match = false;

            if (operator === 'equals') {
              match =
                String(val ?? '').trim().toLowerCase() ===
                String(filterVal ?? '').trim().toLowerCase();
            } else if (operator === 'not_equals') {
              match =
                String(val ?? '').trim().toLowerCase() !==
                String(filterVal ?? '').trim().toLowerCase();
            } else if (operator === 'contains') {
              match = String(val ?? '').toLowerCase().includes(String(filterVal ?? '').toLowerCase());
            } else if (operator === 'not_contains') {
              match = !String(val ?? '').toLowerCase().includes(String(filterVal ?? '').toLowerCase());
            } else if (operator === 'greater_than') {
              const n = Number(String(val ?? '').replace(/[$,]/g, ''));
              match = !isMissingValue(val, missingConfig) && !Number.isNaN(n) && n > Number(filterVal);
            } else if (operator === 'less_than') {
              const n = Number(String(val ?? '').replace(/[$,]/g, ''));
              match = !isMissingValue(val, missingConfig) && !Number.isNaN(n) && n < Number(filterVal);
            } else if (operator === 'greater_or_equal') {
              const n = Number(String(val ?? '').replace(/[$,]/g, ''));
              match = !isMissingValue(val, missingConfig) && !Number.isNaN(n) && n >= Number(filterVal);
            } else if (operator === 'less_or_equal') {
              const n = Number(String(val ?? '').replace(/[$,]/g, ''));
              match = !isMissingValue(val, missingConfig) && !Number.isNaN(n) && n <= Number(filterVal);
            } else if (operator === 'not_empty') {
              match = !isMissingValue(val, missingConfig);
            } else if (operator === 'is_empty') {
              match = isMissingValue(val, missingConfig);
            }

            if (match) {
              nextData.push(row);
              nextOrig.push(rowOriginMap[i]);
            } else {
              opAffectedRows++;
              totalRowsRemoved++;
              pushAudit({
                originalRow: rowOriginMap[i],
                column: col,
                previousValue: formatAuditValue(val),
                newValue: '(row removed)',
                operation: 'filter_rows',
                operationLabel: 'Filter Rows',
                reason: `Row excluded by condition ${col} ${operator} ${filterVal ?? ''}`.trim(),
                status: 'removed',
              });
            }
          }

          currentData = nextData;
          rowOriginMap = nextOrig;
          applied.push(
            `Filtered '${col}' (${operator}${
              filterVal !== undefined && filterVal !== '' ? ` '${filterVal}'` : ''
            }): removed ${opAffectedRows} row${opAffectedRows === 1 ? '' : 's'}`
          );
          break;
        }

        case 'standardize_date': {
          const cols: string[] =
            Array.isArray(op.params.columns) && op.params.columns.length > 0
              ? op.params.columns
              : [op.params.column];
          for (const col of cols) {
            if (!col || !currentColSet.has(col)) continue;
            let colChanged = 0;
            for (let i = 0; i < currentData.length; i++) {
              const val = currentData[i][col];
              if (isMissingValue(val, missingConfig)) continue;
              const iso = normalizeDateString(val);
              if (iso) {
                if (iso !== String(val)) {
                  currentData[i][col] = iso;
                  colChanged++;
                  opAffectedCells++;
                  totalAffectedCells++;
                  pushAudit({
                    originalRow: rowOriginMap[i],
                    column: col,
                    previousValue: formatAuditValue(val),
                    newValue: iso,
                    operation: 'standardize_date',
                    operationLabel: 'Standardize Dates',
                    reason: 'Normalized date format to ISO YYYY-MM-DD',
                    status: 'changed',
                  });
                }
              } else {
                pushAudit({
                  originalRow: rowOriginMap[i],
                  column: col,
                  previousValue: formatAuditValue(val),
                  newValue: formatAuditValue(val),
                  operation: 'standardize_date',
                  operationLabel: 'Standardize Dates',
                  reason: 'Unparseable date string requires manual review',
                  status: 'attention',
                });
              }
            }
            if (colChanged > 0) {
              opAffectedCols++;
              totalColsModified++;
            }
            applied.push(`Standardized dates in '${col}' to YYYY-MM-DD (${colChanged} cells updated)`);
          }
          break;
        }

        case 'normalize_categories': {
          const col = op.params.column;
          if (!currentColSet.has(col)) {
            opStatus = 'failed';
            opError = `Column '${col}' not found for category normalization.`;
            break;
          }
          const mapping = op.params.mapping as Record<string, string> | undefined;
          const caseType = op.params.caseType as 'lowercase' | 'uppercase' | 'titlecase' | undefined;
          const allowedTargets = mapping
            ? new Set(Object.values(mapping).map((v) => v.toLowerCase()))
            : null;
          const lowerMap = new Map<string, string>();
          if (mapping) {
            for (const [k, v] of Object.entries(mapping)) {
              lowerMap.set(k.trim().toLowerCase(), v);
            }
          }
          const toTitleCase = (str: string) =>
            str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase());

          let modCount = 0;
          for (let i = 0; i < currentData.length; i++) {
            const val = currentData[i][col];
            if (typeof val !== 'string' || !val.trim()) continue;
            const trimmed = val.trim();
            const mapped = lowerMap.get(trimmed.toLowerCase());
            let nextVal = mapped !== undefined ? mapped : trimmed;
            if (mapped === undefined && caseType) {
              if (caseType === 'lowercase') nextVal = nextVal.toLowerCase();
              else if (caseType === 'uppercase') nextVal = nextVal.toUpperCase();
              else if (caseType === 'titlecase') nextVal = toTitleCase(nextVal);
            }

            if (nextVal !== val) {
              currentData[i][col] = nextVal;
              modCount++;
              opAffectedCells++;
              totalAffectedCells++;
              pushAudit({
                originalRow: rowOriginMap[i],
                column: col,
                previousValue: val,
                newValue: nextVal,
                operation: 'normalize_categories',
                operationLabel: 'Standardize Categories',
                reason: 'Standardized categorical label',
                status: 'changed',
              });
            } else if (allowedTargets && !allowedTargets.has(trimmed.toLowerCase())) {
              pushAudit({
                originalRow: rowOriginMap[i],
                column: col,
                previousValue: val,
                newValue: val,
                operation: 'normalize_categories',
                operationLabel: 'Standardize Categories',
                reason: 'Unrecognized category kept unchanged for review',
                status: 'attention',
              });
            }
          }
          if (modCount > 0) {
            opAffectedCols++;
            totalColsModified++;
          }
          applied.push(`Normalized categories in '${col}' (${modCount} cells updated)`);
          break;
        }

        case 'remove_invalid_emails': {
          const col = op.params.column;
          const mode = op.params.mode === 'clear_cell' ? 'clear_cell' : 'drop_row';
          if (!currentColSet.has(col)) {
            opStatus = 'failed';
            opError = `Column '${col}' not found for email validation.`;
            break;
          }
          if (mode === 'clear_cell') {
            for (let i = 0; i < currentData.length; i++) {
              const raw = currentData[i][col];
              if (!isMissingValue(raw, missingConfig) && !EMAIL_REGEX.test(String(raw).trim())) {
                currentData[i][col] = '';
                opAffectedCells++;
                totalAffectedCells++;
                pushAudit({
                  originalRow: rowOriginMap[i],
                  column: col,
                  previousValue: formatAuditValue(raw),
                  newValue: '(cleared)',
                  operation: 'remove_invalid_emails',
                  operationLabel: 'Remove Invalid Emails',
                  reason: 'Invalid email address cleared',
                  status: 'changed',
                });
              }
            }
            if (opAffectedCells > 0) {
              opAffectedCols++;
              totalColsModified++;
            }
            applied.push(`Cleared ${opAffectedCells} invalid email cell(s) in '${col}'`);
          } else {
            const nextData: Record<string, any>[] = [];
            const nextOrig: number[] = [];
            for (let i = 0; i < currentData.length; i++) {
              const raw = currentData[i][col];
              if (isMissingValue(raw, missingConfig) || !EMAIL_REGEX.test(String(raw).trim())) {
                opAffectedRows++;
                totalRowsRemoved++;
                pushAudit({
                  originalRow: rowOriginMap[i],
                  column: col,
                  previousValue: formatAuditValue(raw),
                  newValue: '(row removed)',
                  operation: 'remove_invalid_emails',
                  operationLabel: 'Remove Invalid Emails',
                  reason: 'Invalid or missing email address',
                  status: 'removed',
                });
              } else {
                nextData.push(currentData[i]);
                nextOrig.push(rowOriginMap[i]);
              }
            }
            currentData = nextData;
            rowOriginMap = nextOrig;
            applied.push(`Removed ${opAffectedRows} row(s) with invalid or empty emails in '${col}'`);
          }
          break;
        }

        case 'remove_invalid_phones': {
          const col = op.params.column;
          const mode = op.params.mode === 'clear_cell' ? 'clear_cell' : 'drop_row';
          if (!currentColSet.has(col)) {
            opStatus = 'failed';
            opError = `Column '${col}' not found for phone validation.`;
            break;
          }
          if (mode === 'clear_cell') {
            for (let i = 0; i < currentData.length; i++) {
              const raw = currentData[i][col];
              if (!isMissingValue(raw, missingConfig) && !isValidPhoneNumber(raw)) {
                currentData[i][col] = '';
                opAffectedCells++;
                totalAffectedCells++;
                pushAudit({
                  originalRow: rowOriginMap[i],
                  column: col,
                  previousValue: formatAuditValue(raw),
                  newValue: '(cleared)',
                  operation: 'remove_invalid_phones',
                  operationLabel: 'Remove Invalid Phones',
                  reason: 'Invalid phone number cleared',
                  status: 'changed',
                });
              }
            }
            if (opAffectedCells > 0) {
              opAffectedCols++;
              totalColsModified++;
            }
            applied.push(`Cleared ${opAffectedCells} invalid phone cell(s) in '${col}'`);
          } else {
            const nextData: Record<string, any>[] = [];
            const nextOrig: number[] = [];
            for (let i = 0; i < currentData.length; i++) {
              const raw = currentData[i][col];
              if (isMissingValue(raw, missingConfig) || !isValidPhoneNumber(raw)) {
                opAffectedRows++;
                totalRowsRemoved++;
                pushAudit({
                  originalRow: rowOriginMap[i],
                  column: col,
                  previousValue: formatAuditValue(raw),
                  newValue: '(row removed)',
                  operation: 'remove_invalid_phones',
                  operationLabel: 'Remove Invalid Phones',
                  reason: 'Invalid or missing phone number',
                  status: 'removed',
                });
              } else {
                nextData.push(currentData[i]);
                nextOrig.push(rowOriginMap[i]);
              }
            }
            currentData = nextData;
            rowOriginMap = nextOrig;
            applied.push(`Removed ${opAffectedRows} row(s) with invalid or empty phones in '${col}'`);
          }
          break;
        }

        case 'remove_outliers': {
          const col = op.params.column;
          const method = op.params.method === 'zscore' ? 'zscore' : 'iqr';
          const threshold = op.params.threshold;
          if (!currentColSet.has(col)) {
            opStatus = 'failed';
            opError = `Column '${col}' not found for outlier detection.`;
            break;
          }
          const nums: number[] = [];
          for (let i = 0; i < currentData.length; i++) {
            const v = currentData[i][col];
            if (!isMissingValue(v, missingConfig)) {
              const n = Number(String(v).replace(/[$,]/g, ''));
              if (!Number.isNaN(n)) nums.push(n);
            }
          }
          if (nums.length >= 4) {
            let lowerBound = -Infinity;
            let upperBound = Infinity;
            if (method === 'zscore') {
              const zThresh = threshold && threshold > 0 ? threshold : 3;
              const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
              const std = Math.sqrt(nums.reduce((acc, x) => acc + (x - mean) ** 2, 0) / nums.length);
              if (std > 0) {
                lowerBound = mean - zThresh * std;
                upperBound = mean + zThresh * std;
              }
            } else {
              const k = threshold && threshold > 0 ? threshold : 1.5;
              const sorted = [...nums].sort((a, b) => a - b);
              const q1 = sorted[Math.floor((sorted.length - 1) * 0.25)];
              const q3 = sorted[Math.floor((sorted.length - 1) * 0.75)];
              const iqr = q3 - q1;
              lowerBound = q1 - k * iqr;
              upperBound = q3 + k * iqr;
            }
            const nextData: Record<string, any>[] = [];
            const nextOrig: number[] = [];
            for (let i = 0; i < currentData.length; i++) {
              const v = currentData[i][col];
              const n = !isMissingValue(v, missingConfig)
                ? Number(String(v).replace(/[$,]/g, ''))
                : Number.NaN;
              if (!Number.isNaN(n) && (n < lowerBound || n > upperBound)) {
                opAffectedRows++;
                totalRowsRemoved++;
                pushAudit({
                  originalRow: rowOriginMap[i],
                  column: col,
                  previousValue: formatAuditValue(v),
                  newValue: '(row removed)',
                  operation: 'remove_outliers',
                  operationLabel: 'Remove Outliers',
                  reason: `Value outside ${method.toUpperCase()} bounds [${Math.round(lowerBound * 100) / 100}, ${Math.round(upperBound * 100) / 100}]`,
                  status: 'removed',
                });
              } else {
                nextData.push(currentData[i]);
                nextOrig.push(rowOriginMap[i]);
              }
            }
            currentData = nextData;
            rowOriginMap = nextOrig;
          }
          applied.push(
            `Removed ${opAffectedRows} numeric outlier row(s) from '${col}' (${
              method === 'zscore' ? 'Z-score' : 'IQR'
            })`
          );
          break;
        }

        case 'replace_values': {
          const colSpec = op.params.column || 'ALL';
          const targetCols = colSpec === 'ALL' ? currentCols : [colSpec];
          const findStr = String(op.params.findValue ?? '');
          const exactMatch = op.params.exactMatch !== false;
          const caseSensitive = Boolean(op.params.caseSensitive);
          const normRepl = normalizeCustomFillValue(op.params.replaceValue);
          const replacement = normRepl === undefined ? '' : normRepl;

          for (const tc of targetCols) {
            if (!currentColSet.has(tc)) continue;
            let changedInCol = false;
            for (let i = 0; i < currentData.length; i++) {
              const val = currentData[i][tc];
              if (val === undefined || val === null) continue;
              const valStr = String(val);
              let matched = false;
              let nextVal: any = val;

              if (exactMatch) {
                const left = caseSensitive ? valStr : valStr.trim().toLowerCase();
                const right = caseSensitive ? findStr : findStr.trim().toLowerCase();
                if (left === right) {
                  matched = true;
                  nextVal = replacement;
                }
              } else {
                const escaped = findStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const re = new RegExp(escaped, caseSensitive ? 'g' : 'gi');
                const replacedStr = valStr.replace(re, String(replacement));
                if (replacedStr !== valStr) {
                  matched = true;
                  nextVal = normalizeCustomFillValue(replacedStr) ?? replacedStr;
                }
              }

              if (matched && nextVal !== val) {
                currentData[i][tc] = nextVal;
                opAffectedCells++;
                totalAffectedCells++;
                changedInCol = true;
                pushAudit({
                  originalRow: rowOriginMap[i],
                  column: tc,
                  previousValue: formatAuditValue(val),
                  newValue: formatAuditValue(nextVal),
                  operation: 'replace_values',
                  operationLabel: 'Replace Values',
                  reason: `Replaced '${findStr}' with '${replacement}'`,
                  status: 'changed',
                });
              }
            }
            if (changedInCol) {
              opAffectedCols++;
              totalColsModified++;
            }
          }
          applied.push(
            `Replaced '${findStr}' with '${replacement}' in '${colSpec}' (${opAffectedCells} cell(s) updated)`
          );
          break;
        }

        case 'sort_rows': {
          const col = op.params.column;
          const direction = op.params.direction === 'desc' ? 'desc' : 'asc';
          if (!currentColSet.has(col)) {
            opStatus = 'failed';
            opError = `Column '${col}' not found for sorting.`;
            break;
          }
          const mult = direction === 'desc' ? -1 : 1;
          const indexed = currentData.map((row, idx) => ({
            row,
            origRow: rowOriginMap[idx],
            idx,
          }));
          indexed.sort((a, b) => {
            const va = a.row[col];
            const vb = b.row[col];
            const ma = isMissingValue(va, missingConfig);
            const mb = isMissingValue(vb, missingConfig);
            if (ma && mb) return a.idx - b.idx;
            if (ma) return 1;
            if (mb) return -1;
            const na = Number(String(va).replace(/[$,]/g, ''));
            const nb = Number(String(vb).replace(/[$,]/g, ''));
            if (!Number.isNaN(na) && !Number.isNaN(nb)) {
              return na === nb ? a.idx - b.idx : (na - nb) * mult;
            }
            const cmp = String(va).localeCompare(String(vb));
            return cmp === 0 ? a.idx - b.idx : cmp * mult;
          });
          currentData = indexed.map((x) => x.row);
          rowOriginMap = indexed.map((x) => x.origRow);
          pushAudit({
            originalRow: null,
            column: col,
            previousValue: 'unsorted',
            newValue: `sorted (${direction})`,
            operation: 'sort_rows',
            operationLabel: 'Sort Rows',
            reason: `Sorted dataset by '${col}' (${direction})`,
            status: 'changed',
          });
          applied.push(`Sorted rows by '${col}' (${direction})`);
          break;
        }

        case 'reorder_columns': {
          const order: string[] = Array.isArray(op.params.order) ? op.params.order : [];
          const res = reorderColumns(currentData, order);
          currentData = res.data;
          opAffectedCols = res.columnsOrder.length;
          totalColsModified++;
          pushAudit({
            originalRow: null,
            column: '(schema)',
            previousValue: currentCols.slice(0, 5).join(', '),
            newValue: res.columnsOrder.slice(0, 5).join(', '),
            operation: 'reorder_columns',
            operationLabel: 'Reorder Columns',
            reason: `Reordered columns starting with: ${order.join(', ')}`,
            status: 'changed',
          });
          applied.push(`Reordered columns (${order.join(', ')})`);
          break;
        }

        case 'split_column': {
          const col = op.params.column;
          const delimiter = typeof op.params.delimiter === 'string' ? op.params.delimiter : ' ';
          const intoColumns: string[] = Array.isArray(op.params.intoColumns)
            ? op.params.intoColumns
            : [`${col}_1`, `${col}_2`];
          if (!currentColSet.has(col)) {
            opStatus = 'failed';
            opError = `Column '${col}' not found for split.`;
            break;
          }
          const res = splitColumn(currentData, col, delimiter, intoColumns);
          currentData = res.data;
          opAffectedCells = res.modifiedCount;
          totalAffectedCells += res.modifiedCount;
          opAffectedCols = intoColumns.length;
          totalColsModified++;
          pushAudit({
            originalRow: null,
            column: col,
            previousValue: col,
            newValue: intoColumns.join(', '),
            operation: 'split_column',
            operationLabel: 'Split Column',
            reason: `Split '${col}' into [${intoColumns.join(', ')}] using '${delimiter}'`,
            status: 'changed',
          });
          applied.push(`Split '${col}' into ${intoColumns.join(', ')} (${res.modifiedCount} rows)`);
          break;
        }

        case 'merge_columns': {
          const cols: string[] = Array.isArray(op.params.columns) ? op.params.columns : [];
          const separator = typeof op.params.separator === 'string' ? op.params.separator : ' ';
          const targetCol = op.params.targetColumn || 'merged_column';
          const dropOriginals = Boolean(op.params.dropOriginals);
          if (cols.some((c) => !currentColSet.has(c))) {
            opStatus = 'failed';
            opError = `One or more columns not found for merge: ${cols.join(', ')}.`;
            break;
          }
          const res = mergeColumns(currentData, cols, separator, targetCol, dropOriginals);
          currentData = res.data;
          opAffectedCells = res.modifiedCount;
          totalAffectedCells += res.modifiedCount;
          opAffectedCols = 1;
          totalColsModified++;
          if (dropOriginals) {
            totalColumnsRemoved += cols.filter((c) => c !== targetCol).length;
          }
          pushAudit({
            originalRow: null,
            column: targetCol,
            previousValue: cols.join(', '),
            newValue: targetCol,
            operation: 'merge_columns',
            operationLabel: 'Merge Columns',
            reason: `Merged [${cols.join(', ')}] into '${targetCol}'`,
            status: 'changed',
          });
          applied.push(`Merged [${cols.join(', ')}] into '${targetCol}'`);
          break;
        }
      }
    } catch (err: any) {
      opStatus = 'failed';
      opError = err?.message || 'Unexpected error applying cleaning step.';
    }

    if (opStatus === 'completed') operationsCompleted++;
    else operationsFailed++;

    operationSummaries.push({
      id: op.id,
      type: op.type,
      description: op.description,
      status: opStatus,
      affectedRows: opAffectedRows,
      affectedCells: opAffectedCells,
      affectedColumns: opAffectedCols,
      ...(opError ? { error: opError } : {}),
    });
  });

  // Map current row indices -> highlight info so active preview cells highlight accurately
  const cellAuditByRowCol: Record<string, CellAuditHighlight> = {};
  if (cellHighlightByOrigRowCol.size > 0) {
    let cellAuditCount = 0;
    for (let i = 0; i < currentData.length; i++) {
      const origRowNum = rowOriginMap[i];
      const row = currentData[i];
      const rowCols = Object.keys(row);
      for (let c = 0; c < rowCols.length; c++) {
        const col = rowCols[c];
        const hit = cellHighlightByOrigRowCol.get(`${origRowNum}:${col}`);
        if (hit) {
          cellAuditByRowCol[`${i}:${col}`] = hit;
          cellAuditCount++;
          if (cellAuditCount >= MAX_CELL_HIGHLIGHT_MAP) break;
        }
      }
      if (cellAuditCount >= MAX_CELL_HIGHLIGHT_MAP) break;
    }
  }

  const statsAfter = calculateDatasetStats(currentData, missingConfig);

  return {
    cleanedData: currentData,
    statsBefore,
    statsAfter,
    rowsRemoved: totalRowsRemoved,
    duplicatesRemoved: totalDuplicatesRemoved,
    missingValuesHandled: totalMissingHandled,
    columnsModified: totalColsModified,
    columnsRemoved: totalColumnsRemoved,
    affectedCells: totalAffectedCells,
    cellsModified: totalAffectedCells,
    appliedOperations: applied,
    operationsCompleted,
    operationsFailed,
    operationSummaries,
    auditLog,
    auditLogTruncated,
    totalAuditEvents,
    cellAuditByRowCol,
    originalRowNumbers: rowOriginMap,
  };
}
