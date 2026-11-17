/**
 * Pure data cleaning and transformation engine for tabular data (CSV / XLSX).
 * Operates on arrays of record objects. Original data is never mutated.
 */

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
  | 'remove_outliers';

export interface CleaningOperation {
  id: string;
  type: CleaningOperationType;
  params: Record<string, any>;
  description: string;
}

export interface CleaningResult {
  cleanedData: Record<string, any>[];
  statsBefore: DatasetStats;
  statsAfter: DatasetStats;
  rowsRemoved: number;
  duplicatesRemoved: number;
  missingValuesHandled: number;
  columnsModified: number;
  affectedCells: number;
  appliedOperations: string[];
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

const isMissingValue = (v: any): boolean =>
  v === undefined || v === null || v === '' || (typeof v === 'number' && Number.isNaN(v));

const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

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

  // YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymdMatch) {
    const year = Number(ymdMatch[1]);
    const month = Number(ymdMatch[2]);
    const day = Number(ymdMatch[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // MM/DD/YYYY or MM-DD-YYYY
  const mdyMatch = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (mdyMatch) {
    const first = Number(mdyMatch[1]);
    const second = Number(mdyMatch[2]);
    const year = Number(mdyMatch[3]);
    let month = first;
    let day = second;
    // Handle DD/MM/YYYY if first > 12 and second <= 12
    if (first > 12 && second <= 12) {
      day = first;
      month = second;
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // Month name strings e.g. "March 5, 2025" or ISO timestamp
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    // If string has explicit UTC 'T' or 'Z', use UTC components; otherwise local calendar components
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
export function calculateDatasetStats(data: Record<string, any>[]): DatasetStats {
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

  // Derive distinct columns from all rows
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
  const columns = Array.from(colSet);
  const rowCount = data.length;
  const columnCount = columns.length;

  const missingCounts: Record<string, number> = {};
  const typeCounts: Record<string, Record<string, number>> = {};

  for (const col of columns) {
    missingCounts[col] = 0;
    typeCounts[col] = { string: 0, number: 0, boolean: 0, date: 0, empty: 0 };
  }

  const rowSignatures = new Set<string>();
  let duplicateRowCount = 0;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const sigParts: string[] = [];
    for (let c = 0; c < columns.length; c++) {
      const col = columns[c];
      const val = row[col];
      sigParts.push(String(val ?? ''));

      if (isMissingValue(val)) {
        missingCounts[col]++;
        typeCounts[col].empty++;
      } else if (typeof val === 'number') {
        typeCounts[col].number++;
      } else if (typeof val === 'boolean') {
        typeCounts[col].boolean++;
      } else if (
        val instanceof Date ||
        (typeof val === 'string' &&
          (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(val.trim()) ||
            /^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(val.trim())))
      ) {
        typeCounts[col].date++;
      } else if (typeof val === 'string') {
        const numCheck = Number(val);
        if (!Number.isNaN(numCheck) && val.trim() !== '') {
          typeCounts[col].number++;
        } else {
          typeCounts[col].string++;
        }
      } else {
        typeCounts[col].string++;
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

  for (const col of columns) {
    totalMissingValues += missingCounts[col];
    const counts = typeCounts[col];
    if (counts.number >= counts.string && counts.number > 0) {
      columnTypes[col] = 'number';
    } else if (counts.date > counts.string && counts.date > 0) {
      columnTypes[col] = 'date';
    } else if (counts.boolean > 0 && counts.boolean >= counts.string) {
      columnTypes[col] = 'boolean';
    } else if (counts.empty === rowCount) {
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
 * so large datasets (thousands of rows) never exceed context or payload limits.
 */
export function buildDatasetProfileForAi(
  data: Record<string, any>[],
  filename: string,
  maxSampleRows = 6,
  statsOverride?: DatasetStats
): DatasetAiProfile {
  const stats = statsOverride || calculateDatasetStats(data);
  return {
    filename,
    rowCount: stats.rowCount,
    columnCount: stats.columnCount,
    columns: stats.columns,
    columnTypes: stats.columnTypes,
    missingCounts: stats.missingCounts,
    duplicateRowCount: stats.duplicateRowCount,
    sampleRows: data.slice(0, Math.max(1, Math.min(maxSampleRows, 10))),
  };
}

/**
 * 1. Remove duplicate rows based on all or specified columns.
 */
export function removeDuplicates(
  data: Record<string, any>[],
  keyColumns?: string[],
  keep: 'first' | 'last' = 'first'
): { data: Record<string, any>[]; removedCount: number } {
  if (keep === 'last') {
    const seen = new Set<string>();
    const reversedKept: Record<string, any>[] = [];
    let removedCount = 0;
    for (let i = data.length - 1; i >= 0; i--) {
      const row = data[i];
      const keysToCheck = keyColumns && keyColumns.length > 0 ? keyColumns : Object.keys(row);
      const sig = keysToCheck.map((k) => String(row[k] ?? '')).join(':::');
      if (seen.has(sig)) {
        removedCount++;
      } else {
        seen.add(sig);
        reversedKept.push({ ...row });
      }
    }
    reversedKept.reverse();
    return { data: reversedKept, removedCount };
  }

  const seen = new Set<string>();
  const cleaned: Record<string, any>[] = [];
  let removedCount = 0;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const keysToCheck = keyColumns && keyColumns.length > 0 ? keyColumns : Object.keys(row);
    const sig = keysToCheck.map((k) => String(row[k] ?? '')).join(':::');
    if (seen.has(sig)) {
      removedCount++;
    } else {
      seen.add(sig);
      cleaned.push({ ...row });
    }
  }

  return { data: cleaned, removedCount };
}

/**
 * 2. Handle missing values for a specific column or multiple columns.
 */
export function handleMissingValues(
  data: Record<string, any>[],
  column: string,
  strategy: CleaningStrategy,
  fillValue?: any
): { data: Record<string, any>[]; handledCount: number } {
  let handledCount = 0;

  const targetColumns =
    column === 'ALL' && data.length > 0 ? Object.keys(data[0]) : [column];

  if (strategy === 'drop_row') {
    const filtered: Record<string, any>[] = [];
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const missingInTarget = targetColumns.some((col) => isMissingValue(row[col]));
      if (missingInTarget) {
        handledCount++;
      } else {
        filtered.push({ ...row });
      }
    }
    return { data: filtered, handledCount };
  }

  let current = data.map((r) => ({ ...r }));

  for (const col of targetColumns) {
    let numericStats = { mean: 0, median: 0, mode: '' };
    if (['fill_mean', 'fill_median', 'fill_mode'].includes(strategy)) {
      const validNums: number[] = [];
      const valFreq: Record<string, number> = {};

      for (let i = 0; i < current.length; i++) {
        const v = current[i][col];
        if (!isMissingValue(v)) {
          const num = Number(String(v).replace(/[$,]/g, ''));
          if (!Number.isNaN(num)) validNums.push(num);
          const s = String(v);
          valFreq[s] = (valFreq[s] || 0) + 1;
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
      let modeVal = '';
      for (const [k, count] of Object.entries(valFreq)) {
        if (count > maxCount) {
          maxCount = count;
          modeVal = k;
        }
      }
      numericStats.mode = modeVal;
    }

    let previousVal: any = null;
    for (let i = 0; i < current.length; i++) {
      const copy = current[i];
      if (isMissingValue(copy[col])) {
        handledCount++;
        if (strategy === 'fill_custom') {
          copy[col] = fillValue ?? 'N/A';
        } else if (strategy === 'fill_mean') {
          copy[col] = numericStats.mean;
        } else if (strategy === 'fill_median') {
          copy[col] = numericStats.median;
        } else if (strategy === 'fill_mode') {
          copy[col] = numericStats.mode;
        } else if (strategy === 'fill_prev') {
          copy[col] = previousVal ?? fillValue ?? 'N/A';
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
export function removeEmptyRows(data: Record<string, any>[]): {
  data: Record<string, any>[];
  removedCount: number;
} {
  let removedCount = 0;
  const filtered: Record<string, any>[] = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const hasAnyValue = Object.values(row).some((val) => !isMissingValue(val));
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
export function removeEmptyColumns(data: Record<string, any>[]): {
  data: Record<string, any>[];
  removedColumns: string[];
} {
  if (data.length === 0) return { data: [], removedColumns: [] };
  const allCols = Object.keys(data[0] || {});
  const emptyCols = allCols.filter((col) => data.every((row) => isMissingValue(row[col])));

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
      const parsed = Number(String(val).replace(/[^0-9.-]/g, ''));
      if (!Number.isNaN(parsed) && String(val).replace(/[^0-9.-]/g, '') !== '') {
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
        copy[column] = Boolean(val);
        convertedCount++;
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
 * Apply a batch of cleaning operations sequentially.
 * Never mutates original data.
 */
export function executeCleaningPipeline(
  originalData: Record<string, any>[],
  operations: CleaningOperation[]
): CleaningResult {
  const statsBefore = calculateDatasetStats(originalData);
  let currentData = originalData.map((r) => ({ ...r }));

  let totalRowsRemoved = 0;
  let totalDuplicatesRemoved = 0;
  let totalMissingHandled = 0;
  let totalColsModified = 0;
  let totalAffectedCells = 0;
  const applied: string[] = [];

  operations.forEach((op) => {
    switch (op.type) {
      case 'remove_duplicates': {
        const res = removeDuplicates(
          currentData,
          op.params.columns,
          op.params.keep === 'last' ? 'last' : 'first'
        );
        currentData = res.data;
        totalDuplicatesRemoved += res.removedCount;
        totalRowsRemoved += res.removedCount;
        applied.push(
          `Removed ${res.removedCount} duplicate row${res.removedCount === 1 ? '' : 's'}${
            op.params.columns?.length ? ` (by ${op.params.columns.join(', ')})` : ''
          }`
        );
        break;
      }
      case 'handle_missing': {
        const cols: string[] =
          Array.isArray(op.params.columns) && op.params.columns.length > 0
            ? op.params.columns
            : [op.params.column || 'ALL'];
        for (const col of cols) {
          const res = handleMissingValues(
            currentData,
            col,
            op.params.strategy,
            op.params.fillValue
          );
          currentData = res.data;
          totalMissingHandled += res.handledCount;
          if (op.params.strategy === 'drop_row') {
            totalRowsRemoved += res.handledCount;
          } else {
            totalAffectedCells += res.handledCount;
          }
          applied.push(
            `Handled ${res.handledCount} missing value${res.handledCount === 1 ? '' : 's'} in '${col}' (${op.params.strategy})`
          );
        }
        break;
      }
      case 'remove_empty_rows': {
        const res = removeEmptyRows(currentData);
        currentData = res.data;
        totalRowsRemoved += res.removedCount;
        applied.push(`Removed ${res.removedCount} completely empty row${res.removedCount === 1 ? '' : 's'}`);
        break;
      }
      case 'remove_empty_columns': {
        const res = removeEmptyColumns(currentData);
        currentData = res.data;
        totalColsModified += res.removedColumns.length;
        applied.push(
          res.removedColumns.length > 0
            ? `Removed ${res.removedColumns.length} empty column(s): ${res.removedColumns.join(', ')}`
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
        const res = trimWhitespace(currentData, targetCols);
        currentData = res.data;
        totalColsModified += res.modifiedFieldsCount;
        totalAffectedCells += res.modifiedFieldsCount;
        applied.push(
          `Trimmed whitespace across ${res.modifiedFieldsCount} cell${res.modifiedFieldsCount === 1 ? '' : 's'}${
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
        for (const col of cols) {
          if (!col) continue;
          const res = standardizeText(currentData, col, op.params.caseType || 'lowercase');
          currentData = res.data;
          totalColsModified += res.modifiedCount;
          totalAffectedCells += res.modifiedCount;
          applied.push(
            `Standardized '${col}' to ${op.params.caseType || 'lowercase'} (${res.modifiedCount} cells updated)`
          );
        }
        break;
      }
      case 'convert_type': {
        const res = convertColumnType(currentData, op.params.column, op.params.targetType);
        currentData = res.data;
        totalColsModified += res.convertedCount;
        totalAffectedCells += res.convertedCount;
        applied.push(
          `Converted '${op.params.column}' to ${op.params.targetType} (${res.convertedCount} cells converted)`
        );
        break;
      }
      case 'rename_column': {
        const res = renameColumn(currentData, op.params.oldName, op.params.newName);
        if (res.success) {
          currentData = res.data;
          totalColsModified++;
          applied.push(`Renamed column '${op.params.oldName}' to '${op.params.newName}'`);
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
          const res = removeColumn(currentData, colName);
          if (res.success) {
            currentData = res.data;
            totalColsModified++;
            applied.push(`Removed column '${colName}'`);
          }
        }
        break;
      }
      case 'filter_rows': {
        const res = filterRows(
          currentData,
          op.params.column,
          op.params.operator,
          op.params.value
        );
        currentData = res.data;
        totalRowsRemoved += res.removedCount;
        applied.push(
          `Filtered '${op.params.column}' (${op.params.operator}${
            op.params.value !== undefined && op.params.value !== '' ? ` '${op.params.value}'` : ''
          }): removed ${res.removedCount} row${res.removedCount === 1 ? '' : 's'}`
        );
        break;
      }
      case 'standardize_date': {
        const cols: string[] =
          Array.isArray(op.params.columns) && op.params.columns.length > 0
            ? op.params.columns
            : [op.params.column];
        for (const col of cols) {
          if (!col) continue;
          const res = standardizeDateColumn(currentData, col);
          currentData = res.data;
          totalColsModified += res.modifiedCount;
          totalAffectedCells += res.modifiedCount;
          applied.push(
            `Standardized dates in '${col}' to YYYY-MM-DD (${res.modifiedCount} cells updated)`
          );
        }
        break;
      }
      case 'normalize_categories': {
        const res = normalizeCategories(
          currentData,
          op.params.column,
          op.params.mapping,
          op.params.caseType
        );
        currentData = res.data;
        totalColsModified += res.modifiedCount;
        totalAffectedCells += res.modifiedCount;
        applied.push(
          `Normalized categories in '${op.params.column}' (${res.modifiedCount} cells updated)`
        );
        break;
      }
      case 'remove_invalid_emails': {
        const mode = op.params.mode === 'clear_cell' ? 'clear_cell' : 'drop_row';
        const res = removeInvalidEmails(currentData, op.params.column, mode);
        currentData = res.data;
        if (mode === 'drop_row') {
          totalRowsRemoved += res.invalidCount;
        } else {
          totalAffectedCells += res.invalidCount;
        }
        applied.push(
          mode === 'drop_row'
            ? `Removed ${res.invalidCount} row(s) with invalid or empty emails in '${op.params.column}'`
            : `Cleared ${res.invalidCount} invalid email cell(s) in '${op.params.column}'`
        );
        break;
      }
      case 'remove_outliers': {
        const res = removeOutliers(
          currentData,
          op.params.column,
          op.params.method === 'zscore' ? 'zscore' : 'iqr',
          op.params.threshold
        );
        currentData = res.data;
        totalRowsRemoved += res.removedCount;
        applied.push(
          `Removed ${res.removedCount} numeric outlier row(s) from '${op.params.column}' (${
            op.params.method === 'zscore' ? 'Z-score' : 'IQR'
          })`
        );
        break;
      }
    }
  });

  const statsAfter = calculateDatasetStats(currentData);

  return {
    cleanedData: currentData,
    statsBefore,
    statsAfter,
    rowsRemoved: totalRowsRemoved,
    duplicatesRemoved: totalDuplicatesRemoved,
    missingValuesHandled: totalMissingHandled,
    columnsModified: totalColsModified,
    affectedCells: totalAffectedCells,
    appliedOperations: applied,
  };
}
