import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDatasetStats,
  removeDuplicates,
  handleMissingValues,
  removeEmptyRows,
  removeEmptyColumns,
  trimWhitespace,
  standardizeText,
  convertColumnType,
  renameColumn,
  removeColumn,
  filterRows,
  executeCleaningPipeline,
} from './dataCleaner';

test('calculateDatasetStats accurately profiles rows, columns, and missing values', () => {
  const sample = [
    { id: 1, name: 'Alice', age: 30, email: 'alice@example.com' },
    { id: 2, name: 'Bob', age: null, email: 'bob@example.com' },
    { id: 3, name: 'Charlie', age: 25, email: '' },
    { id: 1, name: 'Alice', age: 30, email: 'alice@example.com' }, // duplicate
  ];

  const stats = calculateDatasetStats(sample);
  assert.equal(stats.rowCount, 4);
  assert.equal(stats.columnCount, 4);
  assert.equal(stats.duplicateRowCount, 1);
  assert.equal(stats.missingCounts['age'], 1);
  assert.equal(stats.missingCounts['email'], 1);
  assert.equal(stats.totalMissingValues, 2);
  assert.equal(stats.columnTypes['id'], 'number');
  assert.equal(stats.columnTypes['name'], 'string');
});

test('removeDuplicates removes identical records and returns correct count', () => {
  const sample = [
    { id: 1, val: 'A' },
    { id: 2, val: 'B' },
    { id: 1, val: 'A' },
  ];

  const result = removeDuplicates(sample);
  assert.equal(result.removedCount, 1);
  assert.equal(result.data.length, 2);
  assert.deepEqual(result.data, [
    { id: 1, val: 'A' },
    { id: 2, val: 'B' },
  ]);
  // Original is not modified
  assert.equal(sample.length, 3);
});

test('handleMissingValues with drop_row drops rows with missing target column', () => {
  const sample = [
    { id: 1, score: 100 },
    { id: 2, score: null },
    { id: 3, score: 95 },
  ];

  const result = handleMissingValues(sample, 'score', 'drop_row');
  assert.equal(result.handledCount, 1);
  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].id, 1);
  assert.equal(result.data[1].id, 3);
});

test('handleMissingValues with fill_mean calculates accurate mean', () => {
  const sample = [
    { id: 1, score: 10 },
    { id: 2, score: 20 },
    { id: 3, score: null },
  ];

  const result = handleMissingValues(sample, 'score', 'fill_mean');
  assert.equal(result.handledCount, 1);
  assert.equal(result.data[2].score, 15);
});

test('trimWhitespace strips whitespace from strings without altering numbers', () => {
  const sample = [
    { name: '  Alice  ', role: ' Developer ', count: 42 },
  ];

  const result = trimWhitespace(sample);
  assert.equal(result.data[0].name, 'Alice');
  assert.equal(result.data[0].role, 'Developer');
  assert.equal(result.data[0].count, 42);
  assert.equal(result.modifiedFieldsCount, 2);
});

test('standardizeText transforms text casing properly', () => {
  const sample = [
    { city: 'new york' },
    { city: 'LOS ANGELES' },
  ];

  const result = standardizeText(sample, 'city', 'titlecase');
  assert.equal(result.data[0].city, 'New York');
  assert.equal(result.data[1].city, 'Los Angeles');
});

test('executeCleaningPipeline applies full suite and records metrics truthfully', () => {
  const dirty = [
    { id: '1', name: ' Alice ', age: '30', emptyCol: '' },
    { id: '2', name: 'Bob', age: '', emptyCol: '' },
    { id: '1', name: ' Alice ', age: '30', emptyCol: '' }, // duplicate
    { id: '', name: '', age: '', emptyCol: '' }, // completely empty row
  ];

  const operations = [
    { id: '1', type: 'remove_empty_rows' as const, params: {}, description: 'Remove empty rows' },
    { id: '2', type: 'trim_whitespace' as const, params: {}, description: 'Trim whitespace' },
    { id: '3', type: 'remove_duplicates' as const, params: {}, description: 'Remove duplicates' },
    { id: '4', type: 'remove_empty_columns' as const, params: {}, description: 'Remove empty columns' },
    { id: '5', type: 'convert_type' as const, params: { column: 'id', targetType: 'number' }, description: 'Convert id to number' },
  ];

  const res = executeCleaningPipeline(dirty, operations);
  assert.equal(res.rowsRemoved, 2); // 1 empty row + 1 duplicate
  assert.equal(res.duplicatesRemoved, 1);
  assert.equal(res.cleanedData.length, 2);
  assert.equal(res.cleanedData[0].id, 1);
  assert.equal(res.cleanedData[0].name, 'Alice');
  assert.equal('emptyCol' in res.cleanedData[0], false);
});
