import { Schema, Type } from '@google/genai';
import {
  CleaningOperation,
  CleaningOperationType,
  CleaningStrategy,
  DatasetAiProfile,
  FilterOperator,
} from '../utils/dataCleaner';
import {
  HYDROGEN_MODEL_ID,
  callWithBoundedRetry,
  parseWebsiteGeneratorJson,
} from './websiteGenerationService';
import {
  GeminiRequestManager,
  normalizeGeminiError,
} from './geminiRequestManager';

export const ALLOWED_CLEANING_OPERATIONS: ReadonlySet<CleaningOperationType> = new Set([
  'remove_duplicates',
  'handle_missing',
  'remove_empty_rows',
  'remove_empty_columns',
  'trim_whitespace',
  'standardize_text',
  'convert_type',
  'rename_column',
  'remove_column',
  'filter_rows',
  'standardize_date',
  'normalize_categories',
  'remove_invalid_emails',
  'remove_outliers',
  'reorder_columns',
  'sort_rows',
  'replace_values',
  'split_column',
  'merge_columns',
  'remove_invalid_phones',
]);

export const ALLOWED_MISSING_STRATEGIES: ReadonlySet<CleaningStrategy> = new Set([
  'drop_row',
  'fill_custom',
  'fill_mean',
  'fill_median',
  'fill_mode',
  'fill_prev',
]);

export const ALLOWED_FILTER_OPERATORS: ReadonlySet<FilterOperator> = new Set([
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'greater_than',
  'less_than',
  'greater_or_equal',
  'less_or_equal',
  'not_empty',
  'is_empty',
]);

export type CleaningPlanStatus = 'ready' | 'needs_clarification' | 'invalid_column';

export interface ValidatedCleaningPlan {
  status: CleaningPlanStatus;
  explanation: string;
  clarificationQuestion?: string;
  pendingColumnRemovalCount?: number;
  requiresConfirmation?: boolean;
  operations: CleaningOperation[];
}

export interface DataCleaningPlanInput {
  instruction: string;
  datasetProfile: DatasetAiProfile;
}

export const CLEANING_PLAN_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ['status', 'explanation', 'operations'],
  properties: {
    status: {
      type: Type.STRING,
      enum: ['ready', 'needs_clarification', 'invalid_column'],
      description:
        "Use 'ready' when the instruction is clear and maps to valid columns. Use 'invalid_column' if a requested column does not exist. Use 'needs_clarification' if the request is ambiguous (e.g., 'Remove 5 columns' without naming them, 'clean missing values' without specifying strategy, or 'fix the data').",
    },
    explanation: {
      type: Type.STRING,
      description:
        'Concise summary of the planned deterministic operations or why clarification/column correction is required.',
    },
    clarificationQuestion: {
      type: Type.STRING,
      description:
        'Clear question asking the user to clarify ambiguity or pick existing columns when status is not ready.',
    },
    pendingColumnRemovalCount: {
      type: Type.NUMBER,
      description:
        'If the user requested removing N columns without naming which columns (e.g. "Remove 5 columns"), set status="needs_clarification" and set this to N.',
    },
    operations: {
      type: Type.ARRAY,
      description:
        'Ordered list of ONLY the deterministic operations explicitly requested by the user. Must be empty when status is not ready.',
      items: {
        type: Type.OBJECT,
        required: ['type', 'description'],
        properties: {
          type: {
            type: Type.STRING,
            enum: Array.from(ALLOWED_CLEANING_OPERATIONS),
            description: 'Exact operation identifier from the allowed deterministic toolset.',
          },
          description: {
            type: Type.STRING,
            description: 'Human-readable summary of this single step.',
          },
          column: {
            type: Type.STRING,
            description: "Target column name (or 'ALL' for table-wide operations).",
          },
          columns: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'List of target columns (e.g. for remove_column, trim_whitespace, remove_duplicates, merge_columns, reorder_columns).',
          },
          strategy: {
            type: Type.STRING,
            enum: ['drop_row', 'fill_custom', 'fill_mean', 'fill_median', 'fill_mode', 'fill_prev'],
            description: 'Strategy for handle_missing.',
          },
          fillValue: {
            type: Type.STRING,
            description: 'REQUIRED custom replacement value when strategy is fill_custom (e.g. "0", "Unknown").',
          },
          caseType: {
            type: Type.STRING,
            enum: ['lowercase', 'uppercase', 'titlecase', 'trim'],
            description: 'Casing style for standardize_text or normalize_categories.',
          },
          targetType: {
            type: Type.STRING,
            enum: ['number', 'date', 'string', 'boolean'],
            description: 'Target type for convert_type.',
          },
          oldName: {
            type: Type.STRING,
            description: 'Existing column name for rename_column.',
          },
          newName: {
            type: Type.STRING,
            description: 'New column name for rename_column.',
          },
          columnName: {
            type: Type.STRING,
            description: 'Single column name to delete for remove_column.',
          },
          operator: {
            type: Type.STRING,
            enum: [
              'equals',
              'not_equals',
              'contains',
              'not_contains',
              'greater_than',
              'less_than',
              'greater_or_equal',
              'less_or_equal',
              'not_empty',
              'is_empty',
            ],
            description: 'Predicate operator for filter_rows (defines which rows to KEEP).',
          },
          value: {
            type: Type.STRING,
            description: 'Comparison value for filter_rows.',
          },
          keep: {
            type: Type.STRING,
            enum: ['first', 'last'],
            description: 'Which row to keep for remove_duplicates.',
          },
          method: {
            type: Type.STRING,
            enum: ['iqr', 'zscore'],
            description: 'Outlier detection method for remove_outliers.',
          },
          threshold: {
            type: Type.NUMBER,
            description: 'Numeric threshold for remove_outliers (e.g. 1.5 for IQR, 3 for zscore).',
          },
          emailMode: {
            type: Type.STRING,
            enum: ['drop_row', 'clear_cell'],
            description: 'Action for remove_invalid_emails or remove_invalid_phones.',
          },
          mappingPairs: {
            type: Type.ARRAY,
            description: 'Value normalization pairs for normalize_categories.',
            items: {
              type: Type.OBJECT,
              required: ['from', 'to'],
              properties: {
                from: { type: Type.STRING },
                to: { type: Type.STRING },
              },
            },
          },
          findValue: {
            type: Type.STRING,
            description: 'Text or value to find for replace_values.',
          },
          replaceValue: {
            type: Type.STRING,
            description: 'Replacement value for replace_values.',
          },
          exactMatch: {
            type: Type.BOOLEAN,
            description: 'Whether replace_values matches full cell value (true) or substring (false).',
          },
          direction: {
            type: Type.STRING,
            enum: ['asc', 'desc'],
            description: 'Sort order for sort_rows.',
          },
          order: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Ordered column names for reorder_columns.',
          },
          delimiter: {
            type: Type.STRING,
            description: 'Delimiter for split_column.',
          },
          intoColumns: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Target column names for split_column.',
          },
          separator: {
            type: Type.STRING,
            description: 'Separator for merge_columns.',
          },
          targetColumn: {
            type: Type.STRING,
            description: 'Destination column name for merge_columns.',
          },
          dropOriginals: {
            type: Type.BOOLEAN,
            description: 'Whether merge_columns drops original source columns.',
          },
        },
      },
    },
  },
};

export function buildDataCleaningPlanPrompts(input: DataCleaningPlanInput) {
  const { instruction, datasetProfile } = input;

  const systemInstruction = `You are the AI Data Cleaning Planner inside AI Engineering Workspace.
Your job is to translate a user's natural-language data cleaning request into a strictly validated, minimal sequence of deterministic tabular operations.

CRITICAL RULES:
1. EXECUTE ONLY WHAT IS ASKED: Include ONLY operations directly requested by the user. NEVER add unrequested extra operations (do NOT silently drop columns, deduplicate, fill missing values, trim strings, or change casing unless the user asked for them).
2. MISSING VALUES:
   - When the user says "Replace all missing values with 0" or specifies a custom fill value, use type='handle_missing', column='ALL' (or specified column), strategy='fill_custom', fillValue='0' (EXACT requested value — never substitute 'NA' or 'N/A' unless the user literally requested 'NA').
   - Never assume missing strategy if the user did not specify one.
3. VALIDATE COLUMNS: Every column name referenced must exist in the provided dataset columns. If the user names a column that does not exist (and isn't 'ALL'), set status='invalid_column', keep operations=[], and explain which columns exist.
4. CLARIFY AMBIGUOUS COLUMN COUNTS OR VAGUE PROMPTS:
   - If the user says "Remove 5 columns" or "Drop 3 columns" WITHOUT specifying exact column names, you MUST set status='needs_clarification', operations=[], pendingColumnRemovalCount=<count>, and ask which exact columns to remove. NEVER silently pick or delete columns!
   - If the instruction is genuinely vague (e.g., "fix the data", "clean everything", "handle missing values" with no strategy), set status='needs_clarification', keep operations=[], and ask a concise clarificationQuestion.
5. FILTER SEMANTICS: 'filter_rows' operator defines which rows to KEEP! For example, "Remove rows where salary < 20000" MUST emit operator='greater_or_equal', value='20000' (so rows < 20000 are removed).
6. NEVER WRITE CODE: Never emit JavaScript, Python, or SQL code. Only emit structured operations using the schema enums.
7. MULTI-STEP REQUESTS: Return steps in exact logical execution order.
8. CATEGORIES / GENDER / DATES / PHONES / VALUES:
   - Use 'normalize_categories' with explicit mappingPairs for inconsistent labels (e.g. Gender 'M'/'male' -> 'Male', 'F'/'female' -> 'Female') leaving unknown categories unmapped.
   - Use 'standardize_date' for YYYY-MM-DD formatting, 'remove_invalid_emails' for emails, 'remove_invalid_phones' for phones, 'remove_outliers' for outliers, 'replace_values' for find-and-replace.`;

  const userPrompt = `User Cleaning Instruction:
"${instruction}"

Dataset Profile:
- Filename: ${datasetProfile.filename}
- Total Rows: ${datasetProfile.rowCount}
- Total Columns: ${datasetProfile.columnCount}
- Duplicate Rows Detected: ${datasetProfile.duplicateRowCount}
- Columns & Inferred Types:
${datasetProfile.columns
  .slice(0, 120)
  .map(
    (c) =>
      `  * ${c} (type: ${datasetProfile.columnTypes[c] || 'string'}, missing: ${
        datasetProfile.missingCounts[c] ?? 0
      })`
  )
  .join('\n')}${
    datasetProfile.columns.length > 120
      ? `\n  ... (${datasetProfile.columns.length - 120} more columns)`
      : ''
  }

Representative Sample Rows (first ${datasetProfile.sampleRows.length} rows only):
${JSON.stringify(datasetProfile.sampleRows, null, 2)}

Return ONLY valid JSON matching the schema.`;

  return { systemInstruction, userPrompt };
}

function resolveCanonicalColumn(
  rawName: string | undefined,
  availableColumns: string[]
): { found: boolean; canonical?: string; isAll?: boolean } {
  if (!rawName || typeof rawName !== 'string') return { found: false };
  const trimmed = rawName.trim();
  if (!trimmed) return { found: false };
  if (trimmed.toUpperCase() === 'ALL') return { found: true, canonical: 'ALL', isAll: true };

  if (availableColumns.includes(trimmed)) {
    return { found: true, canonical: trimmed };
  }
  const lower = trimmed.toLowerCase();
  const match = availableColumns.find((c) => c.toLowerCase() === lower);
  if (match) {
    return { found: true, canonical: match };
  }
  const normalizedSpace = lower.replace(/[\s_-]+/g, '_');
  const normMatch = availableColumns.find(
    (c) => c.toLowerCase().replace(/[\s_-]+/g, '_') === normalizedSpace
  );
  if (normMatch) {
    return { found: true, canonical: normMatch };
  }
  return { found: false };
}

function sanitizeSafeKey(value: string): string {
  const cleaned = value.trim();
  if (cleaned === '__proto__' || cleaned === 'constructor' || cleaned === 'prototype') {
    return `${cleaned}_col`;
  }
  return cleaned;
}

/**
 * Validates and canonicalizes an AI-produced or local cleaning plan against real dataset columns.
 */
export function validateCleaningPlan(
  rawPlan: unknown,
  availableColumns: string[]
): ValidatedCleaningPlan {
  if (!rawPlan || typeof rawPlan !== 'object') {
    return {
      status: 'needs_clarification',
      explanation: 'Could not interpret the cleaning request into a valid plan.',
      clarificationQuestion:
        'Please specify the exact column(s) and cleaning action you would like to apply.',
      operations: [],
    };
  }

  const raw = rawPlan as Record<string, any>;
  const rawStatus = String(raw.status || '').trim();
  const explanation =
    typeof raw.explanation === 'string' && raw.explanation.trim()
      ? raw.explanation.trim()
      : 'Reviewing your dataset cleaning request.';
  const clarificationQuestion =
    typeof raw.clarificationQuestion === 'string' && raw.clarificationQuestion.trim()
      ? raw.clarificationQuestion.trim()
      : undefined;
  const pendingColumnRemovalCount =
    typeof raw.pendingColumnRemovalCount === 'number' && raw.pendingColumnRemovalCount > 0
      ? Math.floor(raw.pendingColumnRemovalCount)
      : undefined;

  if (rawStatus === 'invalid_column') {
    return {
      status: 'invalid_column',
      explanation,
      clarificationQuestion:
        clarificationQuestion ||
        `Please choose from existing columns: ${availableColumns.slice(0, 25).join(', ')}.`,
      operations: [],
    };
  }

  if (rawStatus === 'needs_clarification') {
    return {
      status: 'needs_clarification',
      explanation,
      clarificationQuestion:
        clarificationQuestion ||
        'Could you clarify which column(s) and transformation rule you want to apply?',
      ...(pendingColumnRemovalCount ? { pendingColumnRemovalCount } : {}),
      operations: [],
    };
  }

  const rawOps = Array.isArray(raw.operations) ? raw.operations : [];
  if (rawOps.length === 0) {
    return {
      status: 'needs_clarification',
      explanation: 'No specific cleaning operations were identified from your instruction.',
      clarificationQuestion:
        clarificationQuestion ||
        'Please describe a concrete cleaning action (for example: "Replace all missing values with 0" or "Remove duplicate rows").',
      operations: [],
    };
  }

  const validatedOps: CleaningOperation[] = [];
  const missingColumnsReferenced: string[] = [];

  for (let i = 0; i < rawOps.length; i++) {
    const rawItem = rawOps[i];
    if (!rawItem || typeof rawItem !== 'object') continue;
    const item = {
      ...(rawItem.params && typeof rawItem.params === 'object' ? rawItem.params : {}),
      ...rawItem,
    };
    const opType = String(item.type || '').trim() as CleaningOperationType;
    if (!ALLOWED_CLEANING_OPERATIONS.has(opType)) {
      return {
        status: 'needs_clarification',
        explanation: `Unsupported operation requested (${opType || 'unknown'}).`,
        clarificationQuestion:
          'Please rephrase your instruction using supported tabular cleaning actions.',
        operations: [],
      };
    }

    const opId = `nl_op_${Date.now()}_${i}`;
    const desc =
      typeof item.description === 'string' && item.description.trim()
        ? item.description.trim()
        : opType;

    switch (opType) {
      case 'remove_empty_rows':
      case 'remove_empty_columns': {
        validatedOps.push({ id: opId, type: opType, params: {}, description: desc });
        break;
      }

      case 'remove_duplicates': {
        let resolvedCols: string[] | undefined;
        if (Array.isArray(item.columns) && item.columns.length > 0) {
          resolvedCols = [];
          for (const rawCol of item.columns) {
            const res = resolveCanonicalColumn(String(rawCol), availableColumns);
            if (!res.found || res.isAll) missingColumnsReferenced.push(String(rawCol));
            else if (res.canonical) resolvedCols.push(res.canonical);
          }
        } else if (
          typeof item.column === 'string' &&
          item.column.trim() &&
          item.column.trim().toUpperCase() !== 'ALL'
        ) {
          const res = resolveCanonicalColumn(item.column, availableColumns);
          if (!res.found) missingColumnsReferenced.push(item.column);
          else if (res.canonical) resolvedCols = [res.canonical];
        }
        validatedOps.push({
          id: opId,
          type: opType,
          params: {
            ...(resolvedCols && resolvedCols.length > 0 ? { columns: resolvedCols } : {}),
            keep: item.keep === 'last' ? 'last' : 'first',
          },
          description: desc,
        });
        break;
      }

      case 'trim_whitespace': {
        let resolvedCols: string[] | undefined;
        if (Array.isArray(item.columns) && item.columns.length > 0) {
          resolvedCols = [];
          for (const rawCol of item.columns) {
            if (String(rawCol).trim().toUpperCase() === 'ALL') continue;
            const res = resolveCanonicalColumn(String(rawCol), availableColumns);
            if (!res.found) missingColumnsReferenced.push(String(rawCol));
            else if (res.canonical) resolvedCols.push(res.canonical);
          }
        } else if (
          typeof item.column === 'string' &&
          item.column.trim() &&
          item.column.trim().toUpperCase() !== 'ALL'
        ) {
          const res = resolveCanonicalColumn(item.column, availableColumns);
          if (!res.found) missingColumnsReferenced.push(item.column);
          else if (res.canonical) resolvedCols = [res.canonical];
        }
        validatedOps.push({
          id: opId,
          type: opType,
          params:
            resolvedCols && resolvedCols.length > 0 ? { columns: resolvedCols } : { column: 'ALL' },
          description: desc,
        });
        break;
      }

      case 'handle_missing': {
        const strategy = String(item.strategy || '').trim() as CleaningStrategy;
        if (!ALLOWED_MISSING_STRATEGIES.has(strategy)) {
          return {
            status: 'needs_clarification',
            explanation: 'Missing-value handling requires specifying a strategy.',
            clarificationQuestion:
              'How should missing values be handled? (e.g., replace with 0, drop rows, or fill with mean/median/mode)',
            operations: [],
          };
        }
        const resolvedFillValue =
          item.fillValue !== undefined && item.fillValue !== null && String(item.fillValue).trim() !== ''
            ? String(item.fillValue)
            : item.value !== undefined && item.value !== null && String(item.value).trim() !== ''
            ? String(item.value)
            : item.replaceValue !== undefined &&
              item.replaceValue !== null &&
              String(item.replaceValue).trim() !== ''
            ? String(item.replaceValue)
            : undefined;
        if (strategy === 'fill_custom' && resolvedFillValue === undefined) {
          return {
            status: 'needs_clarification',
            explanation: 'Custom missing-value replacement requires an explicit replacement value.',
            clarificationQuestion:
              'What exact value would you like to use to replace missing values (for example, 0 or Unknown)?',
            operations: [],
          };
        }
        const rawTarget =
          item.column ||
          (Array.isArray(item.columns) && item.columns.length > 0 ? item.columns[0] : 'ALL');
        const res = resolveCanonicalColumn(String(rawTarget), availableColumns);
        if (!res.found) {
          missingColumnsReferenced.push(String(rawTarget));
        } else {
          validatedOps.push({
            id: opId,
            type: opType,
            params: {
              column: res.canonical,
              strategy,
              ...(resolvedFillValue !== undefined ? { fillValue: resolvedFillValue } : {}),
            },
            description: desc,
          });
        }
        break;
      }

      case 'standardize_text': {
        const res = resolveCanonicalColumn(item.column || item.columnName, availableColumns);
        if (!res.found || res.isAll) {
          missingColumnsReferenced.push(String(item.column || item.columnName || ''));
        } else {
          const caseType = ['lowercase', 'uppercase', 'titlecase', 'trim'].includes(item.caseType)
            ? item.caseType
            : 'lowercase';
          validatedOps.push({
            id: opId,
            type: opType,
            params: { column: res.canonical, caseType },
            description: desc,
          });
        }
        break;
      }

      case 'convert_type': {
        const res = resolveCanonicalColumn(item.column || item.columnName, availableColumns);
        if (!res.found || res.isAll) {
          missingColumnsReferenced.push(String(item.column || item.columnName || ''));
        } else {
          const targetType = ['number', 'date', 'string', 'boolean'].includes(item.targetType)
            ? item.targetType
            : 'string';
          validatedOps.push({
            id: opId,
            type: opType,
            params: { column: res.canonical, targetType },
            description: desc,
          });
        }
        break;
      }

      case 'rename_column': {
        const rawOld = item.oldName || item.column;
        const rawNew = item.newName;
        const res = resolveCanonicalColumn(rawOld, availableColumns);
        if (!res.found || res.isAll) {
          missingColumnsReferenced.push(String(rawOld || ''));
        } else if (!rawNew || typeof rawNew !== 'string' || !rawNew.trim()) {
          return {
            status: 'needs_clarification',
            explanation: 'Column rename requires both an existing column name and a new column name.',
            clarificationQuestion: `What would you like to rename '${res.canonical}' to?`,
            operations: [],
          };
        } else {
          validatedOps.push({
            id: opId,
            type: opType,
            params: { oldName: res.canonical, newName: sanitizeSafeKey(rawNew) },
            description: desc,
          });
        }
        break;
      }

      case 'remove_column': {
        const colsInput: string[] =
          Array.isArray(item.columns) && item.columns.length > 0
            ? item.columns
            : [item.columnName || item.column || ''];
        const resolved: string[] = [];
        for (const c of colsInput) {
          const res = resolveCanonicalColumn(String(c), availableColumns);
          if (!res.found || res.isAll) {
            missingColumnsReferenced.push(String(c));
          } else if (res.canonical && !resolved.includes(res.canonical)) {
            resolved.push(res.canonical);
          }
        }
        if (resolved.length > 0) {
          validatedOps.push({
            id: opId,
            type: opType,
            params: resolved.length === 1 ? { columnName: resolved[0] } : { columns: resolved },
            description: desc,
          });
        }
        break;
      }

      case 'filter_rows': {
        const res = resolveCanonicalColumn(item.column || item.columnName, availableColumns);
        if (!res.found || res.isAll) {
          missingColumnsReferenced.push(String(item.column || item.columnName || ''));
        } else {
          const operator = String(item.operator || 'equals').trim() as FilterOperator;
          if (!ALLOWED_FILTER_OPERATORS.has(operator)) {
            return {
              status: 'needs_clarification',
              explanation: `Unsupported row filter condition '${operator}'.`,
              clarificationQuestion: 'Please clarify the exact filter condition to apply.',
              operations: [],
            };
          }
          validatedOps.push({
            id: opId,
            type: opType,
            params: {
              column: res.canonical,
              operator,
              value: item.value ?? '',
            },
            description: desc,
          });
        }
        break;
      }

      case 'standardize_date': {
        const res = resolveCanonicalColumn(item.column || item.columnName, availableColumns);
        if (!res.found || res.isAll) {
          missingColumnsReferenced.push(String(item.column || item.columnName || ''));
        } else {
          validatedOps.push({
            id: opId,
            type: opType,
            params: { column: res.canonical, format: 'iso_date' },
            description: desc,
          });
        }
        break;
      }

      case 'normalize_categories': {
        const res = resolveCanonicalColumn(item.column || item.columnName, availableColumns);
        if (!res.found || res.isAll) {
          missingColumnsReferenced.push(String(item.column || item.columnName || ''));
        } else {
          const mapping: Record<string, string> = {};
          if (Array.isArray(item.mappingPairs)) {
            for (const pair of item.mappingPairs) {
              if (pair && typeof pair.from === 'string' && typeof pair.to === 'string') {
                mapping[pair.from] = pair.to;
              }
            }
          }
          const caseType = ['lowercase', 'uppercase', 'titlecase'].includes(item.caseType)
            ? item.caseType
            : undefined;
          validatedOps.push({
            id: opId,
            type: opType,
            params: {
              column: res.canonical,
              ...(Object.keys(mapping).length > 0 ? { mapping } : {}),
              ...(caseType ? { caseType } : {}),
            },
            description: desc,
          });
        }
        break;
      }

      case 'remove_invalid_emails':
      case 'remove_invalid_phones': {
        const res = resolveCanonicalColumn(item.column || item.columnName, availableColumns);
        if (!res.found || res.isAll) {
          missingColumnsReferenced.push(String(item.column || item.columnName || ''));
        } else {
          validatedOps.push({
            id: opId,
            type: opType,
            params: {
              column: res.canonical,
              mode: item.emailMode === 'clear_cell' ? 'clear_cell' : 'drop_row',
            },
            description: desc,
          });
        }
        break;
      }

      case 'remove_outliers': {
        const res = resolveCanonicalColumn(item.column || item.columnName, availableColumns);
        if (!res.found || res.isAll) {
          missingColumnsReferenced.push(String(item.column || item.columnName || ''));
        } else {
          validatedOps.push({
            id: opId,
            type: opType,
            params: {
              column: res.canonical,
              method: item.method === 'zscore' ? 'zscore' : 'iqr',
              ...(typeof item.threshold === 'number' && item.threshold > 0
                ? { threshold: item.threshold }
                : {}),
            },
            description: desc,
          });
        }
        break;
      }

      case 'replace_values': {
        const rawTarget = item.column || 'ALL';
        const res = resolveCanonicalColumn(String(rawTarget), availableColumns);
        if (!res.found) {
          missingColumnsReferenced.push(String(rawTarget));
        } else if (item.findValue === undefined || item.replaceValue === undefined) {
          return {
            status: 'needs_clarification',
            explanation: 'Value replacement requires both a search value and replacement value.',
            clarificationQuestion: 'Which value should be replaced, and what should replace it?',
            operations: [],
          };
        } else {
          validatedOps.push({
            id: opId,
            type: opType,
            params: {
              column: res.canonical,
              findValue: item.findValue,
              replaceValue: item.replaceValue,
              exactMatch: item.exactMatch !== false,
            },
            description: desc,
          });
        }
        break;
      }

      case 'sort_rows': {
        const res = resolveCanonicalColumn(item.column || item.columnName, availableColumns);
        if (!res.found || res.isAll) {
          missingColumnsReferenced.push(String(item.column || item.columnName || ''));
        } else {
          validatedOps.push({
            id: opId,
            type: opType,
            params: {
              column: res.canonical,
              direction: item.direction === 'desc' ? 'desc' : 'asc',
            },
            description: desc,
          });
        }
        break;
      }

      case 'reorder_columns': {
        const orderInput: string[] = Array.isArray(item.order)
          ? item.order
          : Array.isArray(item.columns)
          ? item.columns
          : [];
        const resolvedOrder: string[] = [];
        for (const c of orderInput) {
          const res = resolveCanonicalColumn(String(c), availableColumns);
          if (!res.found || res.isAll) missingColumnsReferenced.push(String(c));
          else if (res.canonical) resolvedOrder.push(res.canonical);
        }
        if (resolvedOrder.length > 0) {
          validatedOps.push({
            id: opId,
            type: opType,
            params: { order: resolvedOrder },
            description: desc,
          });
        }
        break;
      }

      case 'split_column': {
        const res = resolveCanonicalColumn(item.column || item.columnName, availableColumns);
        if (!res.found || res.isAll) {
          missingColumnsReferenced.push(String(item.column || item.columnName || ''));
        } else {
          const into = Array.isArray(item.intoColumns)
            ? item.intoColumns.map((x: any) => sanitizeSafeKey(String(x))).filter(Boolean)
            : [`${res.canonical}_1`, `${res.canonical}_2`];
          validatedOps.push({
            id: opId,
            type: opType,
            params: {
              column: res.canonical,
              delimiter: typeof item.delimiter === 'string' && item.delimiter.length > 0 ? item.delimiter : ' ',
              intoColumns: into,
            },
            description: desc,
          });
        }
        break;
      }

      case 'merge_columns': {
        const colsInput: string[] = Array.isArray(item.columns) ? item.columns : [];
        const resolved: string[] = [];
        for (const c of colsInput) {
          const res = resolveCanonicalColumn(String(c), availableColumns);
          if (!res.found || res.isAll) missingColumnsReferenced.push(String(c));
          else if (res.canonical) resolved.push(res.canonical);
        }
        if (resolved.length >= 2) {
          validatedOps.push({
            id: opId,
            type: opType,
            params: {
              columns: resolved,
              separator: typeof item.separator === 'string' ? item.separator : ' ',
              targetColumn: sanitizeSafeKey(String(item.targetColumn || 'merged_column')),
              dropOriginals: Boolean(item.dropOriginals),
            },
            description: desc,
          });
        }
        break;
      }
    }
  }

  if (missingColumnsReferenced.length > 0) {
    const uniqueMissing = Array.from(new Set(missingColumnsReferenced.filter(Boolean)));
    return {
      status: 'invalid_column',
      explanation: `Column${uniqueMissing.length > 1 ? 's' : ''} not found in dataset: ${uniqueMissing.join(', ')}.`,
      clarificationQuestion: `Available columns are: ${availableColumns.slice(0, 25).join(', ')}. Please specify one of these columns.`,
      operations: [],
    };
  }

  if (validatedOps.length === 0) {
    return {
      status: 'needs_clarification',
      explanation: 'No valid cleaning actions could be constructed.',
      clarificationQuestion:
        'Please specify the target column and exact transformation you want to run.',
      operations: [],
    };
  }

  return {
    status: 'ready',
    explanation,
    operations: validatedOps,
  };
}

export async function executeDataCleaningPlanRequest(options: {
  input: DataCleaningPlanInput;
  apiKeyConfigured: boolean;
  model?: string;
  candidateModels?: string[];
  useModelRouter?: boolean;
  generateContent: (params: any) => Promise<{ text?: string }>;
  requestManager?: GeminiRequestManager;
  scopeKey?: string;
  skipCache?: boolean;
}): Promise<{ status: number; body: Record<string, any> }> {
  const {
    input,
    apiKeyConfigured,
    model = 'gemini-3.1-flash-lite',
    candidateModels,
    useModelRouter = true,
    generateContent,
    requestManager,
    scopeKey = 'guest:anon',
    skipCache = false,
  } = options;

  const instruction = String(input.instruction || '').trim();
  const profile = input.datasetProfile;

  if (!instruction) {
    return {
      status: 400,
      body: { error: 'Please enter a natural-language cleaning instruction.' },
    };
  }

  if (!profile || !Array.isArray(profile.columns) || profile.columns.length === 0) {
    return {
      status: 400,
      body: { error: 'Dataset profile with valid columns is required.' },
    };
  }

  if (!apiKeyConfigured) {
    return {
      status: 503,
      body: {
        code: 'API_KEY_MISSING',
        demoModeAvailable: true,
        recommendDemoMode: true,
        error: 'Gemini API key is not configured on the server. Switch to Demo Mode to continue.',
      },
    };
  }

  const sanitizedProfile: DatasetAiProfile = {
    filename: String(profile.filename || 'dataset.csv').slice(0, 256),
    rowCount: Number(profile.rowCount) || 0,
    columnCount: profile.columns.length,
    columns: profile.columns
      .slice(0, 200)
      .map((c: any) => (typeof c === 'object' && c !== null && c.name ? String(c.name) : String(c))),
    columnTypes: profile.columnTypes || {},
    missingCounts: profile.missingCounts || {},
    duplicateRowCount: Number(profile.duplicateRowCount) || 0,
    sampleRows: Array.isArray(profile.sampleRows) ? profile.sampleRows.slice(0, 6) : [],
  };

  const { systemInstruction, userPrompt } = buildDataCleaningPlanPrompts({
    instruction,
    datasetProfile: sanitizedProfile,
  });

  try {
    let response: { text?: string };
    let modelUsed = model;
    let attemptedModels: string[] = [model];
    let fallbackUsed = false;
    let modelFallbackNotice: string | undefined;

    if (requestManager && useModelRouter) {
      const routed = await requestManager.executeWithRouting({
        agentType: 'data_cleaning',
        scopeKey,
        preferredModel: model,
        candidateModels,
        contents: userPrompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: CLEANING_PLAN_RESPONSE_SCHEMA,
        },
        skipCache,
        validateResponse: (rawText) => {
          const parsed = parseWebsiteGeneratorJson(rawText);
          return parsed.success && parsed.data && typeof parsed.data === 'object'
            ? { valid: true }
            : { valid: false, reason: 'Invalid JSON cleaning plan from model.' };
        },
        generateContent,
      });
      response = routed.response;
      modelUsed = routed.modelUsed;
      attemptedModels = routed.attemptedModels || [modelUsed];
      fallbackUsed = Boolean(routed.fallbackUsed);
      modelFallbackNotice = routed.modelFallbackNotice;
    } else if (requestManager) {
      const execRes = await requestManager.execute({
        agentType: 'data_cleaning',
        scopeKey,
        model,
        contents: userPrompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: CLEANING_PLAN_RESPONSE_SCHEMA,
        },
        skipCache,
        generateContent,
      });
      response = execRes.response;
      modelUsed = execRes.modelUsed;
    } else {
      response = await callWithBoundedRetry(() =>
        generateContent({
          model,
          contents: userPrompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: CLEANING_PLAN_RESPONSE_SCHEMA,
          },
        })
      );
    }

    const parsed = parseWebsiteGeneratorJson(response.text);
    if (!parsed.success || !parsed.data || typeof parsed.data !== 'object') {
      return {
        status: 502,
        body: {
          modelUsed,
          attemptedModels,
          demoModeAvailable: true,
          error:
            'Could not parse a valid data cleaning plan from the AI response. Please try rephrasing your instruction.',
        },
      };
    }

    const validatedPlan = validateCleaningPlan(parsed.data, sanitizedProfile.columns);
    return {
      status: 200,
      body: {
        success: true,
        requestId: `req_clean_${Date.now()}`,
        executionMode: 'live',
        modelUsed,
        attemptedModels,
        fallbackUsed,
        ...(modelFallbackNotice ? { modelFallbackNotice } : {}),
        plan: validatedPlan,
      },
    };
  } catch (error: any) {
    const normalized = normalizeGeminiError(error);
    return {
      status: normalized.status,
      body: {
        code: normalized.code,
        ...(error?.attemptedModels ? { attemptedModels: error.attemptedModels } : {}),
        ...(error?.allModelsExhausted ? { allModelsExhausted: true } : {}),
        ...(error?.recommendDemoMode ? { recommendDemoMode: true } : {}),
        demoModeAvailable: true,
        ...(normalized.retryAfterSeconds ? { retryAfterSeconds: normalized.retryAfterSeconds } : {}),
        error: normalized.message,
      },
    };
  }
}
