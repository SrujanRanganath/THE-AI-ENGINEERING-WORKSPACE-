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
  getErrorStatusCode,
  parseWebsiteGeneratorJson,
} from './websiteGenerationService';

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
        "Use 'ready' when the instruction is clear and maps to valid columns. Use 'invalid_column' if a requested column does not exist. Use 'needs_clarification' if the request is ambiguous (e.g., 'clean missing values' without specifying column/method or vague 'fix the data').",
    },
    explanation: {
      type: Type.STRING,
      description:
        'Concise summary of the planned deterministic operations or why clarification/column correction is required.',
    },
    clarificationQuestion: {
      type: Type.STRING,
      description:
        'Clear question asking the user to clarify ambiguity or pick an existing column when status is not ready.',
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
            description: 'Optional list of target columns for deduplication or trimming.',
          },
          strategy: {
            type: Type.STRING,
            enum: ['drop_row', 'fill_custom', 'fill_mean', 'fill_median', 'fill_mode', 'fill_prev'],
            description: 'Strategy for handle_missing.',
          },
          fillValue: {
            type: Type.STRING,
            description: 'Custom replacement value when strategy is fill_custom.',
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
            description: 'Column name to delete for remove_column.',
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
            description: 'Predicate operator for filter_rows.',
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
            description: 'Action for remove_invalid_emails.',
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
2. VALIDATE COLUMNS: Every column name referenced must exist in the provided dataset columns. If the user names a column that does not exist (and isn't 'ALL'), set status='invalid_column', keep operations=[], and explain which columns exist.
3. CLARIFY AMBIGUITY: If the instruction is genuinely vague (e.g., "fix the data", "clean everything", "make it better", "handle missing values" when the user did not indicate whether to drop rows or fill with mean/median/mode/custom value), set status='needs_clarification', keep operations=[], and ask a concise clarificationQuestion.
4. NEVER WRITE CODE: Never emit JavaScript, Python, or SQL code. Only emit structured operations using the schema enums.
5. MULTI-STEP REQUESTS: When the user clearly specifies multiple actions (e.g., "Trim whitespace, remove duplicates, and standardize signup_date to YYYY-MM-DD"), return them in logical execution order.
6. CATEGORY NORMALIZATION: For inconsistent category labels (e.g. "active", "ACTIVE", "Active"), inspect sampleRows and build mappingPairs mapping dirty variants to the canonical label (plus caseType if appropriate).
7. DATES & OUTLIERS & EMAILS: Use 'standardize_date' for formatting dates to YYYY-MM-DD, 'remove_invalid_emails' for validating/dropping invalid email rows, and 'remove_outliers' for numeric outlier filtering.`;

  const userPrompt = `User Cleaning Instruction:
"${instruction}"

Dataset Profile:
- Filename: ${datasetProfile.filename}
- Total Rows: ${datasetProfile.rowCount}
- Total Columns: ${datasetProfile.columnCount}
- Duplicate Rows Detected: ${datasetProfile.duplicateRowCount}
- Columns & Inferred Types:
${datasetProfile.columns
  .map(
    (c) =>
      `  * ${c} (type: ${datasetProfile.columnTypes[c] || 'string'}, missing: ${
        datasetProfile.missingCounts[c] ?? 0
      })`
  )
  .join('\n')}

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
 * Validates and canonicalizes an AI-produced cleaning plan against the real dataset columns.
 * Guarantees no unknown operations, no non-existent column silently modified, and no code execution.
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

  if (rawStatus === 'invalid_column') {
    return {
      status: 'invalid_column',
      explanation,
      clarificationQuestion:
        clarificationQuestion ||
        `Please choose from existing columns: ${availableColumns.join(', ')}.`,
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
        'Please describe a concrete cleaning action (for example: "Remove duplicate rows" or "Fill missing age with mean").',
      operations: [],
    };
  }

  const validatedOps: CleaningOperation[] = [];
  const missingColumnsReferenced: string[] = [];

  for (let i = 0; i < rawOps.length; i++) {
    const item = rawOps[i];
    if (!item || typeof item !== 'object') continue;
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
            if (!res.found || res.isAll) {
              missingColumnsReferenced.push(String(rawCol));
            } else if (res.canonical) {
              resolvedCols.push(res.canonical);
            }
          }
        } else if (typeof item.column === 'string' && item.column.trim() && item.column.trim().toUpperCase() !== 'ALL') {
          const res = resolveCanonicalColumn(item.column, availableColumns);
          if (!res.found) {
            missingColumnsReferenced.push(item.column);
          } else if (res.canonical) {
            resolvedCols = [res.canonical];
          }
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
        } else if (typeof item.column === 'string' && item.column.trim() && item.column.trim().toUpperCase() !== 'ALL') {
          const res = resolveCanonicalColumn(item.column, availableColumns);
          if (!res.found) missingColumnsReferenced.push(item.column);
          else if (res.canonical) resolvedCols = [res.canonical];
        }
        validatedOps.push({
          id: opId,
          type: opType,
          params: resolvedCols && resolvedCols.length > 0 ? { columns: resolvedCols } : { column: 'ALL' },
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
              'How should missing values be handled? (e.g., drop rows, fill with mean/median/mode, or fill with a custom value)',
            operations: [],
          };
        }
        const rawTarget = item.column || (Array.isArray(item.columns) ? item.columns[0] : 'ALL');
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
              ...(item.fillValue !== undefined ? { fillValue: item.fillValue } : {}),
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
          } else if (res.canonical) {
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

      case 'remove_invalid_emails': {
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
    }
  }

  if (missingColumnsReferenced.length > 0) {
    const uniqueMissing = Array.from(new Set(missingColumnsReferenced.filter(Boolean)));
    return {
      status: 'invalid_column',
      explanation: `Column${uniqueMissing.length > 1 ? 's' : ''} not found in dataset: ${uniqueMissing.join(', ')}.`,
      clarificationQuestion: `Available columns are: ${availableColumns.join(', ')}. Please specify one of these columns.`,
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
  generateContent: (params: any) => Promise<{ text?: string }>;
}): Promise<{ status: number; body: Record<string, any> }> {
  const {
    input,
    apiKeyConfigured,
    model = HYDROGEN_MODEL_ID,
    generateContent,
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
        error: 'Gemini API key is not configured on the server. Please check the Secrets panel.',
      },
    };
  }

  // Ensure only a bounded sample of rows is forwarded to the AI prompt
  const sanitizedProfile: DatasetAiProfile = {
    filename: String(profile.filename || 'dataset.csv').slice(0, 256),
    rowCount: Number(profile.rowCount) || 0,
    columnCount: profile.columns.length,
    columns: profile.columns.slice(0, 200).map((c) => String(c)),
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
    const response = await callWithBoundedRetry(() =>
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

    const parsed = parseWebsiteGeneratorJson(response.text);
    if (!parsed.success || !parsed.data || typeof parsed.data !== 'object') {
      return {
        status: 502,
        body: {
          error: 'Could not parse a valid data cleaning plan from the AI response. Please try rephrasing your instruction.',
        },
      };
    }

    const validatedPlan = validateCleaningPlan(parsed.data, sanitizedProfile.columns);
    return {
      status: 200,
      body: {
        success: true,
        requestId: `req_clean_${Date.now()}`,
        plan: validatedPlan,
      },
    };
  } catch (error: any) {
    const statusCode = getErrorStatusCode(error);
    if (statusCode === 429) {
      return {
        status: 429,
        body: { error: 'Gemini rate limit or quota exceeded. Please wait a moment and retry.' },
      };
    }
    if (statusCode === 503) {
      return {
        status: 503,
        body: { error: 'Gemini model is temporarily unavailable (HTTP 503). Please retry shortly.' },
      };
    }
    return {
      status: 500,
      body: { error: 'Failed to analyze data cleaning instruction. Please retry.' },
    };
  }
}
