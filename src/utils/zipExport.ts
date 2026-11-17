export interface ProjectFile {
  path: string;
  content: string;
}

/**
 * Sanitizes a relative archive path against directory traversal (`../`, `..\\`, leading slashes).
 */
export function sanitizeArchivePath(rawPath: string): string {
  const cleaned = (rawPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim();

  const segments = cleaned.split('/');
  const safeSegments: string[] = [];
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..') continue;
    safeSegments.push(seg);
  }
  return safeSegments.join('/');
}

/**
 * Generates a compressed ZIP archive buffer (`Uint8Array`) from project files.
 * Safe for both Node.js unit tests and browser downloads.
 */
export async function createProjectZipBuffer(files: ProjectFile[]): Promise<Uint8Array> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  files.forEach((file) => {
    const cleanPath = sanitizeArchivePath(file.path);
    if (cleanPath) {
      zip.file(cleanPath, file.content);
    }
  });

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

/**
 * Creates a clean, safe ZIP archive from project files and triggers download in the browser.
 * Validates against directory traversal (e.g. '../').
 */
export async function downloadProjectZip(projectName: string, files: ProjectFile[]): Promise<void> {
  const safeProjectName = (projectName || 'project').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const uint8 = await createProjectZipBuffer(files);
  const blob = new Blob([uint8 as unknown as BlobPart], { type: 'application/zip' });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeProjectName}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Downloads an individual source file with proper MIME type and filename.
 */
export function downloadSingleFile(filePath: string, content: string): void {
  const fileName = sanitizeArchivePath(filePath).split('/').pop() || 'file.txt';
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
