export interface FirestoreDocumentTableRow {
  cells: string[];
}

export type DocumentTableRowInput = string[] | FirestoreDocumentTableRow;

export interface DocumentTable {
  headers: string[];
  rows: DocumentTableRowInput[];
}

/**
 * Normalizes table rows whether stored as in-memory `string[][]` or
 * Firestore-compatible `Array<{ cells: string[] }>` back into `string[][]`.
 */
export function normalizeTableRowsTo2D(rows: unknown): string[][] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    if (Array.isArray(row)) {
      return row.map((cell) => String(cell ?? ''));
    }
    if (row && typeof row === 'object' && Array.isArray((row as FirestoreDocumentTableRow).cells)) {
      return (row as FirestoreDocumentTableRow).cells.map((cell) => String(cell ?? ''));
    }
    if (row && typeof row === 'object' && Array.isArray((row as any).items)) {
      return (row as any).items.map((cell: unknown) => String(cell ?? ''));
    }
    return [String(row ?? '')];
  });
}

export type DocumentContentBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'numbered'; text: string }
  | { type: 'table'; table: DocumentTable };

export interface DocumentSection {
  heading: string;
  level: 1 | 2 | 3;
  paragraphs: string[];
  bullets?: string[];
  numberedItems?: string[];
  tables?: DocumentTable[];
  blocks?: DocumentContentBlock[];
}

export interface StructuredDocumentData {
  title: string;
  subtitle?: string;
  category: string;
  tone: string;
  author?: string;
  sections: DocumentSection[];
  fullMarkdown?: string;
}

function isTableRowLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length >= 3;
}

function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!isTableRowLine(trimmed)) return false;
  const cells = trimmed
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim());
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

function parseTableCells(line: string): string[] {
  return line
    .trim()
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim());
}

/**
 * Parses markdown text into structured sections (headings, paragraphs, bullets,
 * numbered lists, and markdown tables) so user-edited markdown is faithfully
 * represented in the exported OpenXML Word (.docx) document.
 */
export function parseMarkdownIntoSections(markdown: string): DocumentSection[] {
  const lines = (markdown || '').split(/\r?\n/);
  const sections: DocumentSection[] = [];
  let current: DocumentSection = {
    heading: 'Overview',
    level: 1,
    paragraphs: [],
    bullets: [],
    numberedItems: [],
    tables: [],
    blocks: [],
  };
  let hasStartedHeading = false;

  const hasContent = (sec: DocumentSection) =>
    sec.paragraphs.length > 0 ||
    (sec.bullets && sec.bullets.length > 0) ||
    (sec.numberedItems && sec.numberedItems.length > 0) ||
    (sec.tables && sec.tables.length > 0);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i++;
      continue;
    }

    if (line.startsWith('### ')) {
      if (hasStartedHeading || hasContent(current)) {
        sections.push(current);
      }
      current = {
        heading: line.slice(4).trim(),
        level: 3,
        paragraphs: [],
        bullets: [],
        numberedItems: [],
        tables: [],
        blocks: [],
      };
      hasStartedHeading = true;
      i++;
      continue;
    }

    if (line.startsWith('## ')) {
      if (hasStartedHeading || hasContent(current)) {
        sections.push(current);
      }
      current = {
        heading: line.slice(3).trim(),
        level: 2,
        paragraphs: [],
        bullets: [],
        numberedItems: [],
        tables: [],
        blocks: [],
      };
      hasStartedHeading = true;
      i++;
      continue;
    }

    if (line.startsWith('# ')) {
      if (hasStartedHeading || hasContent(current)) {
        sections.push(current);
      }
      current = {
        heading: line.slice(2).trim(),
        level: 1,
        paragraphs: [],
        bullets: [],
        numberedItems: [],
        tables: [],
        blocks: [],
      };
      hasStartedHeading = true;
      i++;
      continue;
    }

    // Parse Markdown table block
    if (isTableRowLine(line) && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1])) {
      const headers = parseTableCells(line);
      i += 2; // skip header and separator
      const rows: string[][] = [];
      while (i < lines.length && isTableRowLine(lines[i])) {
        if (!isTableSeparatorLine(lines[i])) {
          const rowCells = parseTableCells(lines[i]);
          while (rowCells.length < headers.length) rowCells.push('');
          rows.push(rowCells.slice(0, headers.length));
        }
        i++;
      }
      const table: DocumentTable = { headers, rows };
      current.tables = current.tables || [];
      current.tables.push(table);
      current.blocks = current.blocks || [];
      current.blocks.push({ type: 'table', table });
      continue;
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      const text = line.slice(2).trim();
      current.bullets = current.bullets || [];
      current.bullets.push(text);
      current.blocks = current.blocks || [];
      current.blocks.push({ type: 'bullet', text });
      i++;
      continue;
    }

    const numberedMatch = line.match(/^\d+[.)]\s+(.+)$/);
    if (numberedMatch) {
      const text = numberedMatch[1].trim();
      current.numberedItems = current.numberedItems || [];
      current.numberedItems.push(text);
      current.blocks = current.blocks || [];
      current.blocks.push({ type: 'numbered', text });
      i++;
      continue;
    }

    current.paragraphs.push(line);
    current.blocks = current.blocks || [];
    current.blocks.push({ type: 'paragraph', text: line });
    i++;
  }

  if (hasContent(current) || hasStartedHeading || sections.length === 0) {
    sections.push(current);
  }

  return sections;
}

/**
 * Splits inline **bold** segments into styled docx TextRuns without leaving raw asterisks.
 */
function buildInlineTextRuns(
  TextRun: any,
  text: string,
  baseStyle: { size: number; color: string; font: string; bold?: boolean }
): any[] {
  const parts = String(text || '').split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  if (parts.length === 0) {
    return [new TextRun({ text: '', ...baseStyle })];
  }
  return parts.map((part) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return new TextRun({
        text: part.slice(2, -2),
        ...baseStyle,
        bold: true,
      });
    }
    return new TextRun({
      text: part,
      ...baseStyle,
    });
  });
}

/**
 * Compiles structured document data into a real OpenXML Word (.docx) binary buffer (`Uint8Array`).
 * Can be verified in Node.js unit tests via JSZip and downloaded in the browser.
 */
export async function generateDocxBuffer(docData: StructuredDocumentData): Promise<Uint8Array> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
    BorderStyle,
    LevelFormat,
    Table,
    TableRow,
    TableCell,
    WidthType,
    ShadingType,
  } = await import('docx');

  const children: any[] = [];

  // Title Block
  children.push(
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: docData.title,
          bold: true,
          size: 44, // 22pt
          color: '1E293B',
          font: 'Calibri',
        }),
      ],
    })
  );

  // Subtitle / Meta Block
  if (docData.subtitle) {
    children.push(
      new Paragraph({
        spacing: { after: 120 },
        children: [
          new TextRun({
            text: docData.subtitle,
            italics: true,
            size: 24, // 12pt
            color: '64748B',
            font: 'Calibri',
          }),
        ],
      })
    );
  }

  children.push(
    new Paragraph({
      spacing: { after: 360 },
      border: {
        bottom: {
          color: 'CBD5E1',
          space: 8,
          style: BorderStyle.SINGLE,
          size: 6,
        },
      },
      children: [
        new TextRun({
          text: `Type: ${docData.category}  |  Length / Scope: ${docData.tone}  |  Generated: ${new Date().toLocaleDateString()}`,
          size: 18, // 9pt
          color: '94A3B8',
          font: 'Calibri',
        }),
      ],
    })
  );

  const effectiveSections =
    docData.fullMarkdown && docData.fullMarkdown.trim().length > 0
      ? parseMarkdownIntoSections(docData.fullMarkdown)
      : docData.sections;

  const renderTable = (tableData: DocumentTable) => {
    const safeHeaders = Array.isArray(tableData?.headers)
      ? tableData.headers.map((h) => String(h ?? ''))
      : [];
    const normalizedRows = normalizeTableRowsTo2D(tableData?.rows);
    const colCount = Math.max(1, safeHeaders.length);
    const colWidthPct = Math.floor(100 / colCount);

    const headerRow = new TableRow({
      tableHeader: true,
      children: safeHeaders.map(
        (h) =>
          new TableCell({
            width: { size: colWidthPct, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F1F5F9' },
            margins: { top: 100, bottom: 100, left: 140, right: 140 },
            children: [
              new Paragraph({
                children: buildInlineTextRuns(TextRun, h, {
                  size: 20,
                  color: '0F172A',
                  font: 'Calibri',
                  bold: true,
                }),
              }),
            ],
          })
      ),
    });

    const dataRows = normalizedRows.map(
      (r) =>
        new TableRow({
          children: safeHeaders.map(
            (_h, idx) =>
              new TableCell({
                width: { size: colWidthPct, type: WidthType.PERCENTAGE },
                margins: { top: 80, bottom: 80, left: 140, right: 140 },
                children: [
                  new Paragraph({
                    children: buildInlineTextRuns(TextRun, r[idx] || '', {
                      size: 20,
                      color: '334155',
                      font: 'Calibri',
                    }),
                  }),
                ],
              })
          ),
        })
    );

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headerRow, ...dataRows],
    });
  };

  const renderSectionBlocks = (sec: any) => {
    if (Array.isArray(sec.paragraphs)) {
      sec.paragraphs.forEach((p: string) => {
        if (!String(p || '').trim()) return;
        children.push(
          new Paragraph({
            spacing: { after: 160, line: 300 },
            children: buildInlineTextRuns(TextRun, String(p), {
              size: 22,
              color: '334155',
              font: 'Calibri',
            }),
          })
        );
      });
    }

    if (Array.isArray(sec.bullets) && sec.bullets.length > 0) {
      sec.bullets.forEach((b: string) => {
        if (!String(b || '').trim()) return;
        children.push(
          new Paragraph({
            bullet: { level: 0 },
            spacing: { after: 100 },
            children: buildInlineTextRuns(TextRun, String(b), {
              size: 22,
              color: '334155',
              font: 'Calibri',
            }),
          })
        );
      });
    }

    if (Array.isArray(sec.numberedItems) && sec.numberedItems.length > 0) {
      sec.numberedItems.forEach((item: string) => {
        if (!String(item || '').trim()) return;
        children.push(
          new Paragraph({
            numbering: { reference: 'default-numbered-list', level: 0 },
            spacing: { after: 100 },
            children: buildInlineTextRuns(TextRun, String(item), {
              size: 22,
              color: '334155',
              font: 'Calibri',
            }),
          })
        );
      });
    }

    if (Array.isArray(sec.tables) && sec.tables.length > 0) {
      sec.tables.forEach((t: DocumentTable) => {
        if (t && Array.isArray(t.headers) && t.headers.length > 0) {
          children.push(renderTable(t));
          children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
        }
      });
    } else if (sec.table && Array.isArray(sec.table.headers) && sec.table.headers.length > 0) {
      children.push(renderTable(sec.table));
      children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
    }

    if (Array.isArray(sec.subsections) && sec.subsections.length > 0) {
      sec.subsections.forEach((sub: any) => {
        if (sub?.subheading && String(sub.subheading).trim()) {
          children.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_3,
              spacing: { before: 220, after: 100 },
              children: [
                new TextRun({
                  text: String(sub.subheading).trim(),
                  bold: true,
                  size: 24,
                  color: '0F172A',
                  font: 'Calibri',
                }),
              ],
            })
          );
        }
        renderSectionBlocks(sub);
      });
    }
  };

  // Render Each Section
  effectiveSections.forEach((sec) => {
    const headingLevel =
      sec.level === 1
        ? HeadingLevel.HEADING_1
        : sec.level === 2
        ? HeadingLevel.HEADING_2
        : HeadingLevel.HEADING_3;

    children.push(
      new Paragraph({
        heading: headingLevel,
        spacing: { before: 280, after: 140 },
        children: [
          new TextRun({
            text: sec.heading,
            bold: true,
            size: sec.level === 1 ? 32 : sec.level === 2 ? 26 : 24,
            color: '0F172A',
            font: 'Calibri',
          }),
        ],
      })
    );

    if (sec.blocks && sec.blocks.length > 0) {
      sec.blocks.forEach((block) => {
        if (block.type === 'paragraph') {
          if (!block.text.trim()) return;
          children.push(
            new Paragraph({
              spacing: { after: 160, line: 300 },
              children: buildInlineTextRuns(TextRun, block.text, {
                size: 22,
                color: '334155',
                font: 'Calibri',
              }),
            })
          );
        } else if (block.type === 'bullet') {
          if (!block.text.trim()) return;
          children.push(
            new Paragraph({
              bullet: { level: 0 },
              spacing: { after: 100 },
              children: buildInlineTextRuns(TextRun, block.text, {
                size: 22,
                color: '334155',
                font: 'Calibri',
              }),
            })
          );
        } else if (block.type === 'numbered') {
          if (!block.text.trim()) return;
          children.push(
            new Paragraph({
              numbering: { reference: 'default-numbered-list', level: 0 },
              spacing: { after: 100 },
              children: buildInlineTextRuns(TextRun, block.text, {
                size: 22,
                color: '334155',
                font: 'Calibri',
              }),
            })
          );
        } else if (block.type === 'table') {
          children.push(renderTable(block.table));
          children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
        }
      });
      return;
    }

    // Legacy fallback if caller passed DocumentSection without blocks
    renderSectionBlocks(sec);
  });

  const doc = new Document({
    creator: docData.author || 'AI Engineering Workspace',
    title: docData.title,
    description: `${docData.category} document generated by AI Engineering Workspace`,
    numbering: {
      config: [
        {
          reference: 'default-numbered-list',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.START,
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const arrayBuffer = await blob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

/**
 * Generates and downloads a real OpenXML Word (.docx) file in the browser.
 */
export async function downloadDocx(docData: StructuredDocumentData): Promise<void> {
  const uint8 = await generateDocxBuffer(docData);
  const blob = new Blob([uint8 as unknown as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const safeTitle = (docData.title || 'document').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeTitle}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
