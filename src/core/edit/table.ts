import type { Edit } from './edits';

type Align = 'none' | 'left' | 'center' | 'right';

const DELIMITER_CELL = /^:?-+:?$/;
const WIDE = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x20000, 0x3fffd],
];
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Columns a string occupies in a monospace editor: CJK and emoji are 2, combining marks 0. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const { segment } of segmenter.segment(text)) {
    if (/\p{Extended_Pictographic}/u.test(segment)) {
      width += 2;
      continue;
    }
    const code = segment.codePointAt(0)!;
    if (/^\p{M}+$/u.test(segment)) continue;
    width += WIDE.some(([from, to]) => code >= from && code <= to) ? 2 : 1;
  }
  return width;
}

/** Splits a table row on `|`, ignoring escaped pipes and pipes inside `code`. */
export function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inCode = false;
  const trimmed = line.trim();
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '\\' && i + 1 < trimmed.length) {
      current += ch + trimmed[++i];
      continue;
    }
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode) {
      cells.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current);
  // Leading / trailing pipes produce empty edge cells.
  if (trimmed.startsWith('|')) cells.shift();
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|') && cells.length > 0) cells.pop();
  return cells.map((cell) => cell.trim());
}

function isRow(line: string): boolean {
  return splitRow(line).length > 1 || /^\s*\|/.test(line);
}

function isDelimiterRow(line: string, columns: number): boolean {
  const cells = splitRow(line);
  return cells.length === columns && cells.every((cell) => DELIMITER_CELL.test(cell));
}

/** Line ranges `[start, end)` of GFM tables, skipping fenced code blocks. */
export function findTables(lines: readonly string[]): { start: number; end: number }[] {
  const tables: { start: number; end: number }[] = [];
  let fence: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(lines[i]);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = undefined;
      continue;
    }
    if (fence || !isRow(lines[i]) || i + 1 >= lines.length) continue;
    const columns = splitRow(lines[i]).length;
    if (!isDelimiterRow(lines[i + 1], columns)) continue;
    let end = i + 2;
    while (end < lines.length && lines[end].trim() !== '' && isRow(lines[end])) end++;
    tables.push({ start: i, end });
    i = end - 1;
  }
  return tables;
}

/** Aligns a table's pipes, padding cells by display width and honouring column alignment. */
export function formatTable(lines: readonly string[]): string[] {
  const indent = /^\s*/.exec(lines[0])![0];
  const rows = lines.map(splitRow);
  const columns = Math.max(...rows.map((row) => row.length));
  const aligns: Align[] = Array.from({ length: columns }, (_, c) => {
    const cell = rows[1][c] ?? '';
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    return left && right ? 'center' : left ? 'left' : right ? 'right' : 'none';
  });
  const widths = Array.from({ length: columns }, (_, c) =>
    Math.max(3, ...rows.filter((_, r) => r !== 1).map((row) => displayWidth(row[c] ?? ''))),
  );

  return rows.map((row, r) => {
    const cells = Array.from({ length: columns }, (_, c) =>
      r === 1 ? delimiter(aligns[c], widths[c]) : pad(row[c] ?? '', widths[c], aligns[c]),
    );
    return `${indent}| ${cells.join(' | ')} |`;
  });
}

function delimiter(align: Align, width: number): string {
  switch (align) {
    case 'left':
      return ':' + '-'.repeat(width - 1);
    case 'right':
      return '-'.repeat(width - 1) + ':';
    case 'center':
      return ':' + '-'.repeat(width - 2) + ':';
    default:
      return '-'.repeat(width);
  }
}

function pad(cell: string, width: number, align: Align): string {
  const space = width - displayWidth(cell);
  if (align === 'right') return ' '.repeat(space) + cell;
  if (align === 'center') {
    const left = Math.floor(space / 2);
    return ' '.repeat(left) + cell + ' '.repeat(space - left);
  }
  return cell + ' '.repeat(space);
}

interface TableSpan {
  /** Offsets of the table text, without the final line break. */
  start: number;
  end: number;
  /** The table's lines, without line breaks. */
  lines: string[];
  eol: string;
}

/** Every GFM table of `text`, with its offsets. */
function tableSpans(text: string): TableSpan[] {
  const lines = text.split('\n');
  const starts: number[] = [];
  let position = 0;
  for (const line of lines) {
    starts.push(position);
    position += line.length + 1;
  }
  const bare = lines.map((line) => line.replace(/\r$/, ''));
  return findTables(bare).map((table) => ({
    start: starts[table.start],
    end: starts[table.end - 1] + bare[table.end - 1].length,
    lines: bare.slice(table.start, table.end),
    eol: lines[table.start].endsWith('\r') ? '\r\n' : '\n',
  }));
}

/** Whether `offset` lies inside a table. */
export function isInTable(text: string, offset: number): boolean {
  return tableSpans(text).some((table) => offset >= table.start && offset <= table.end);
}

/**
 * Edits that format the tables of `text`: all of them, or only the one
 * containing `offset` when given. Unchanged tables produce no edit.
 */
export function formatTables(text: string, offset?: number): Edit[] {
  const edits: Edit[] = [];
  for (const table of tableSpans(text)) {
    if (offset !== undefined && (offset < table.start || offset > table.end)) continue;
    const formatted = formatTable(table.lines).join(table.eol);
    if (formatted !== text.slice(table.start, table.end)) {
      edits.push({ start: table.start, end: table.end, text: formatted });
    }
  }
  return edits;
}
