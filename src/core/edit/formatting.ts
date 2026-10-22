import {
  type Edit,
  type EditResult,
  editSelections,
  growSpan,
  type Span,
  shiftSpan,
} from './edits';

export type InlineStyle = 'bold' | 'italic' | 'strikethrough' | 'code';

/** Marker written when applying a style, plus other spellings recognised when removing it. */
const MARKERS: Record<InlineStyle, { write: string; read: string[] }> = {
  bold: { write: '**', read: ['**', '__'] },
  italic: { write: '_', read: ['_', '*'] },
  strikethrough: { write: '~~', read: ['~~'] },
  code: { write: '`', read: ['`'] },
};

const WORD = /[\p{L}\p{M}\p{N}_'-]/u;

/**
 * Toggles an inline style on every selection:
 * - a selection (or the word under an empty cursor) is wrapped in the marker,
 *   or unwrapped when it is already wrapped (markers inside or just outside);
 * - an empty cursor outside a word inserts a marker pair with the cursor inside,
 *   or removes an empty pair around it;
 * - multi-line selections are styled line by line, since inline styles cannot
 *   span paragraphs.
 */
export function toggleInlineStyle(
  text: string,
  selections: readonly Span[],
  style: InlineStyle,
): EditResult {
  const markers = MARKERS[style];
  return editSelections(selections, (selection) => {
    if (text.slice(selection.start, selection.end).includes('\n')) {
      return toggleLines(text, selection, markers);
    }
    return toggleOne(text, selection, markers);
  });
}

function toggleOne(text: string, selection: Span, markers: { write: string; read: string[] }) {
  if (selection.start !== selection.end) {
    const span = trimSpan(text, selection);
    const edits = span ? wrapOrUnwrap(text, span, markers) : [];
    // Keep the user's selection on the same characters.
    return { edits, selection: shiftSpan(selection, edits) };
  }

  const cursor = selection.start;
  const at = (offset: number) => ({ start: offset, end: offset });

  // Empty pair around the cursor (`**|**`): remove it.
  const pair = markers.read.find(
    (m) =>
      text.slice(cursor - m.length, cursor) === m &&
      text.slice(cursor, cursor + m.length) === m &&
      text[cursor - m.length - 1] !== m[0] &&
      text[cursor + m.length] !== m[0],
  );
  if (pair) {
    const edits = [{ start: cursor - pair.length, end: cursor + pair.length, text: '' }];
    return { edits, selection: at(cursor - pair.length) };
  }

  // Cursor inside **some styled text**: remove the style.
  const styled = enclosingStyled(text, cursor, markers.read);
  if (styled) {
    const { span, marker } = styled;
    const edits = [
      { start: span.start - marker.length, end: span.start, text: '' },
      { start: span.end, end: span.end + marker.length, text: '' },
    ];
    return { edits, selection: at(cursor - marker.length) };
  }

  // Cursor in a word: style the word; the cursor stays on the same character.
  const word = wordAt(text, cursor);
  if (word) {
    const edits = wrapOrUnwrap(text, word, markers);
    const opening = edits[0];
    const shift = opening.text.length - (opening.end - opening.start);
    return { edits, selection: at(cursor + shift) };
  }

  // Nothing to style: insert an empty pair with the cursor inside.
  const marker = markers.write;
  return {
    edits: [{ start: cursor, end: cursor, text: marker + marker }],
    selection: at(cursor + marker.length),
  };
}

/**
 * The styled span around `offset` on its line: markers are paired left to right,
 * so in `**a** b|c **d**` the cursor is not inside a pair.
 */
function enclosingStyled(
  text: string,
  offset: number,
  read: string[],
): { span: Span; marker: string } | undefined {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const newline = text.indexOf('\n', offset);
  const lineEnd = newline === -1 ? text.length : newline;
  const line = text.slice(lineStart, lineEnd);
  const code = codeSpans(line);
  const inCode = (i: number) => code.some(([from, to]) => i >= from && i < to);

  for (const marker of read) {
    // Each pair: opening delimiter offset, closing delimiter offset, delimiter text.
    const pairs: [number, number, string][] = [];
    if (marker === '`') {
      // A code span is delimited by backtick runs of equal length (`a` or ``a ` b``).
      for (const [from, to] of code) {
        const run = /^`+/.exec(line.slice(from))![0];
        pairs.push([from, to - run.length, run]);
      }
    } else {
      // CommonMark-style pairing: closers match the nearest open opener.
      const openers: number[] = [];
      for (let i = line.indexOf(marker); i !== -1; i = line.indexOf(marker, i + marker.length)) {
        if (isLongerRun(line, i, marker) || inCode(i)) continue;
        const { canOpen, canClose } = flanking(line, i, marker);
        if (canClose && openers.length > 0) pairs.push([openers.pop()!, i, marker]);
        else if (canOpen) openers.push(i);
      }
    }
    for (const [open, close, delimiter] of pairs) {
      const start = lineStart + open + delimiter.length;
      const end = lineStart + close;
      if (start <= offset && offset <= end) return { span: { start, end }, marker: delimiter };
    }
  }
  return undefined;
}

/** `[start, end)` of inline code spans on a line, backticks included (runs of equal length pair up). */
function codeSpans(line: string): [number, number][] {
  const spans: [number, number][] = [];
  const runs = [...line.matchAll(/`+/g)];
  for (let i = 0; i < runs.length; i++) {
    const closing = runs.findIndex((run, j) => j > i && run[0].length === runs[i][0].length);
    if (closing === -1) continue;
    spans.push([runs[i].index!, runs[closing].index! + runs[closing][0].length]);
    i = closing;
  }
  return spans;
}

/**
 * Whether the delimiter at `i` can open / close emphasis (CommonMark flanking rules):
 * `* item` cannot open, and `_` inside a word (snake_case, URLs) does neither.
 */
function flanking(
  line: string,
  i: number,
  marker: string,
): { canOpen: boolean; canClose: boolean } {
  const before = line[i - 1] ?? ' ';
  const after = line[i + marker.length] ?? ' ';
  const space = (ch: string) => /\s/u.test(ch);
  const punct = (ch: string) => /[\p{P}\p{S}]/u.test(ch);
  const left = !space(after) && (!punct(after) || space(before) || punct(before));
  const right = !space(before) && (!punct(before) || space(after) || punct(after));
  if (marker[0] === '_') {
    return {
      canOpen: left && (!right || punct(before)),
      canClose: right && (!left || punct(after)),
    };
  }
  return { canOpen: left, canClose: right };
}

function toggleLines(text: string, selection: Span, markers: { write: string; read: string[] }) {
  const edits: Edit[] = [];
  let lineStart = text.lastIndexOf('\n', selection.start - 1) + 1;
  const lines: Span[] = [];
  while (lineStart <= selection.end) {
    const newline = text.indexOf('\n', lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    const span = trimSpan(text, {
      start: Math.max(lineStart, selection.start),
      end: Math.min(lineEnd, selection.end),
    });
    if (span) lines.push(span);
    if (newline === -1) break;
    lineStart = newline + 1;
  }
  // All lines styled already -> unwrap all; otherwise wrap the ones that are not.
  const allStyled =
    lines.length > 0 && lines.every((line) => wrappedMarker(text, line, markers.read));
  for (const line of lines) {
    const styled = wrappedMarker(text, line, markers.read);
    if (allStyled || !styled) edits.push(...wrapOrUnwrap(text, line, markers));
  }
  // Select the styled lines including their markers.
  return { edits, selection: growSpan(selection, edits) };
}

function wrapOrUnwrap(
  text: string,
  span: Span,
  markers: { write: string; read: string[] },
): Edit[] {
  const marker = wrappedMarker(text, span, markers.read);
  if (marker) {
    const inner = text.slice(span.start, span.end);
    if (inner.length >= 2 * marker.length && inner.startsWith(marker) && inner.endsWith(marker)) {
      return [
        { start: span.start, end: span.start + marker.length, text: '' },
        { start: span.end - marker.length, end: span.end, text: '' },
      ];
    }
    return [
      { start: span.start - marker.length, end: span.start, text: '' },
      { start: span.end, end: span.end + marker.length, text: '' },
    ];
  }
  return [
    { start: span.start, end: span.start, text: markers.write },
    { start: span.end, end: span.end, text: markers.write },
  ];
}

/** The marker wrapping `span`, either inside its edges or just outside them. */
function wrappedMarker(text: string, span: Span, read: string[]): string | undefined {
  const inner = text.slice(span.start, span.end);
  for (const marker of read) {
    const insideOk =
      inner.length >= 2 * marker.length &&
      inner.startsWith(marker) &&
      inner.endsWith(marker) &&
      !isLongerRun(inner, 0, marker) &&
      !isLongerRun(inner, inner.length - marker.length, marker);
    if (insideOk || isWrappedBy(text, span, marker)) return marker;
  }
  return undefined;
}

/** `marker` sits right before and right after `span`, and is not part of a longer run (`*` vs `**`). */
function isWrappedBy(text: string, span: Span, marker: string): boolean {
  const before = span.start - marker.length;
  return (
    before >= 0 &&
    text.startsWith(marker, before) &&
    text.startsWith(marker, span.end) &&
    !isLongerRun(text, before, marker) &&
    !isLongerRun(text, span.end, marker)
  );
}

function isLongerRun(text: string, at: number, marker: string): boolean {
  const ch = marker[0];
  return text[at - 1] === ch || text[at + marker.length] === ch;
}

function wordAt(text: string, offset: number): Span | undefined {
  let start = offset;
  let end = offset;
  while (start > 0 && WORD.test(text[start - 1])) start--;
  while (end < text.length && WORD.test(text[end])) end++;
  return start === end ? undefined : { start, end };
}

/** Drops surrounding whitespace: `** word**` is not valid Markdown emphasis. */
function trimSpan(text: string, span: Span): Span | undefined {
  let { start, end } = span;
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return start === end ? undefined : { start, end };
}

/**
 * Wraps the lines touched by each selection in a fenced code block, or removes
 * the fences when the lines are already fenced. An empty line gets an empty block
 * with the cursor inside.
 */
export function toggleCodeBlock(
  text: string,
  selections: readonly Span[],
  eol = lineEnding(text),
): EditResult {
  return editSelections(selections, (selection) => {
    const first = lineAt(text, selection.start);
    const last = lineAt(text, selection.end);
    const previous = first.start > 0 ? lineAt(text, first.start - 1) : undefined;
    const next = last.end < last.next ? lineAt(text, last.next) : undefined;

    const fenced =
      previous &&
      next &&
      isFence(text.slice(previous.start, previous.end)) &&
      isFence(text.slice(next.start, next.end));
    if (fenced) {
      const edits = [
        { start: previous.start, end: first.start, text: '' },
        { start: last.end, end: next.end, text: '' },
      ];
      return { edits, selection: shiftSpan(selection, edits) };
    }

    if (first.start === last.end) {
      const caret = first.start + 3 + eol.length;
      return {
        edits: [{ start: first.start, end: first.start, text: '```' + eol + eol + '```' }],
        selection: { start: caret, end: caret },
      };
    }
    const edits = [
      { start: first.start, end: first.start, text: '```' + eol },
      { start: last.end, end: last.end, text: eol + '```' },
    ];
    return { edits, selection: shiftSpan(selection, edits) };
  });
}

/**
 * Best guess of a text's line ending. Editors should pass the document's own
 * setting instead: a single-line document has no break to look at.
 */
export function lineEnding(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/** The line containing `offset`: content `[start, end)` (no line break) and the next line's start. */
function lineAt(text: string, offset: number): { start: number; end: number; next: number } {
  const start = text.lastIndexOf('\n', offset - 1) + 1;
  const newline = text.indexOf('\n', offset);
  if (newline === -1) return { start, end: text.length, next: text.length };
  const end = text[newline - 1] === '\r' ? newline - 1 : newline;
  return { start, end: Math.max(start, end), next: newline + 1 };
}

function isFence(line: string): boolean {
  return /^\s*(```|~~~)/.test(line);
}
