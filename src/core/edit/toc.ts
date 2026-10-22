import type { Heading } from '../MarkdownEngine';
import type { Edit } from './edits';
import { lineEnding } from './formatting';

export const TOC_START = '<!-- toc -->';
export const TOC_END = '<!-- tocstop -->';

export interface TocOptions {
  minLevel: number;
  maxLevel: number;
}

/** Lines of the TOC markers (outside code fences); `end` is the closing marker, if any. */
export function findToc(lines: readonly string[]): { start: number; end?: number } | undefined {
  let fence: string | undefined;
  let start: number | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const fenceMatch = /^(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = undefined;
      continue;
    }
    if (fence) continue;
    if (start === undefined && line === TOC_START) start = i;
    else if (start !== undefined && line === TOC_END) return { start, end: i };
  }
  return start === undefined ? undefined : { start };
}

/** Nested Markdown list of links to the headings within the configured levels. */
export function buildToc(headings: readonly Heading[], options: TocOptions): string[] {
  const included = headings.filter(
    (heading) => heading.level >= options.minLevel && heading.level <= options.maxLevel,
  );
  if (included.length === 0) return [];
  const base = Math.min(...included.map((heading) => heading.level));
  return included.map((heading) => {
    const label = heading.text.replace(/([\\[\]])/g, '\\$1');
    return `${'  '.repeat(heading.level - base)}- [${label}](#${heading.slug})`;
  });
}

/**
 * The edit that writes the TOC: replaces the content between existing markers,
 * or inserts a new marked block at `insertAt` (a line start) when there are none. Returns
 * `undefined` when nothing changes (or there is nowhere to write).
 * Headings inside the TOC block itself are ignored.
 */
export function tocEdit(
  text: string,
  headings: readonly Heading[],
  options: TocOptions,
  insertAt?: number,
  eol = lineEnding(text),
): Edit | undefined {
  const lines = text.split('\n');
  const bare = lines.map((line) => line.replace(/\r$/, ''));
  const toc = findToc(bare);
  const outside = toc
    ? headings.filter((h) => h.line < toc.start || h.line > (toc.end ?? toc.start))
    : headings;
  const items = buildToc(outside, options);

  if (toc) {
    const offsetOf = (line: number) =>
      lines.slice(0, line).reduce((sum, l) => sum + l.length + 1, 0);
    const start = offsetOf(toc.start + 1);
    const end = toc.end === undefined ? start : offsetOf(toc.end);
    const body = items.map((item) => item + eol).join('');
    const closing = toc.end === undefined ? TOC_END + eol : '';
    const replacement = body + closing;
    if (text.slice(start, end) === replacement) return undefined;
    return { start, end, text: replacement };
  }

  if (insertAt === undefined) return undefined;
  // Front matter must stay first in the file: never insert before or inside it.
  const at = Math.max(insertAt, frontMatterEnd(text));
  // `at` is a line start: end the block with a break so that line stays separate.
  const block = [TOC_START, ...items, TOC_END].join(eol) + eol;
  return { start: at, end: at, text: block };
}

/** Offset just after a leading `---` … `---` front matter block, or 0. */
function frontMatterEnd(text: string): number {
  const match = /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
  return match ? match[0].length : 0;
}
