/**
 * Parses an uploaded CSV or XLSX file and returns array of records, columns, and validation stats.
 */
export async function parseTabularFile(file: File): Promise<{
  data: Record<string, any>[];
  columns: string[];
  filename: string;
  format: 'csv' | 'xlsx';
  error?: string;
}> {
  const filename = file.name;
  const isCsv = filename.toLowerCase().endsWith('.csv');
  const isXlsx =
    filename.toLowerCase().endsWith('.xlsx') || filename.toLowerCase().endsWith('.xls');

  if (!isCsv && !isXlsx) {
    return {
      data: [],
      columns: [],
      filename,
      format: 'csv',
      error: 'Unsupported file format. Please upload a .csv or .xlsx file.',
    };
  }

  if (file.size > 25 * 1024 * 1024) {
    return {
      data: [],
      columns: [],
      filename,
      format: isCsv ? 'csv' : 'xlsx',
      error: 'File size exceeds maximum limit of 25MB.',
    };
  }

  if (isCsv) {
    const { default: Papa } = await import('papaparse');
    return new Promise((resolve) => {
      Papa.parse(file, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: (results) => {
          const rawData = (results.data as Record<string, any>[]).filter(
            (row) => row && Object.keys(row).length > 0
          );
          if (rawData.length === 0) {
            resolve({
              data: [],
              columns: [],
              filename,
              format: 'csv',
              error: 'The uploaded CSV file is empty.',
            });
            return;
          }
          const columns = results.meta.fields || Object.keys(rawData[0] || {});
          resolve({
            data: rawData,
            columns,
            filename,
            format: 'csv',
          });
        },
        error: (err) => {
          resolve({
            data: [],
            columns: [],
            filename,
            format: 'csv',
            error: `Failed to parse CSV: ${err.message}`,
          });
        },
      });
    });
  } else {
    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        return {
          data: [],
          columns: [],
          filename,
          format: 'xlsx',
          error: 'Spreadsheet has no readable sheets.',
        };
      }
      const worksheet = workbook.Sheets[firstSheetName];
      const rawData = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, {
        defval: '',
      });

      if (rawData.length === 0) {
        return {
          data: [],
          columns: [],
          filename,
          format: 'xlsx',
          error: 'The uploaded Excel spreadsheet contains no rows.',
        };
      }

      const columns = Object.keys(rawData[0] || {});
      return {
        data: rawData,
        columns,
        filename,
        format: 'xlsx',
      };
    } catch (err: any) {
      return {
        data: [],
        columns: [],
        filename,
        format: 'xlsx',
        error: `Failed to parse Excel file: ${err.message || 'Corrupt spreadsheet'}`,
      };
    }
  }
}

/**
 * Exports data to a CSV file and triggers download.
 */
export async function exportToCsv(data: Record<string, any>[], baseFilename = 'cleaned_dataset'): Promise<void> {
  const { default: Papa } = await import('papaparse');
  const csvStr = Papa.unparse(data);
  const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const name = baseFilename.replace(/\.[^/.]+$/, '');
  a.download = `${name}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Exports data to a Microsoft Excel (.xlsx) file and triggers download.
 */
export async function exportToXlsx(data: Record<string, any>[], baseFilename = 'cleaned_dataset'): Promise<void> {
  const XLSX = await import('xlsx');
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Cleaned Data');
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const name = baseFilename.replace(/\.[^/.]+$/, '');
  a.download = `${name}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
