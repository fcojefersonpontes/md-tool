/** How a run of text is drawn. Objects are compared by identity when merging runs. */
export interface TextStyle {
  family: 'body' | 'mono';
  bold: boolean;
  italic: boolean;
  /** Points. */
  size: number;
  color: string;
  strike?: boolean;
  /** External URL. */
  link?: string;
  /** Named destination inside the document. */
  goTo?: string;
  /** Inline code: drawn on a shaded background. */
  code?: boolean;
  /** Baseline shift upwards (superscripts), in points. */
  rise?: number;
  /** Footnote call: the note is placed at the foot of the page that shows it. */
  note?: number;
}

/** Something drawn inline that is not text (formula, image, checkbox). */
export interface InlineBox {
  type: 'box';
  width: number;
  /** Above / below the baseline, in points. */
  ascent: number;
  descent: number;
  draw: (x: number, baseline: number) => void;
  link?: string;
  goTo?: string;
}

export type InlineItem =
  { type: 'text'; text: string; style: TextStyle } | InlineBox | { type: 'break' };

export interface Measurer {
  width(text: string, style: TextStyle): number;
  /** Above / below the baseline for text in this style. */
  ascent(style: TextStyle): number;
  descent(style: TextStyle): number;
}

export type Piece =
  | { type: 'text'; text: string; style: TextStyle; width: number }
  | { type: 'box'; box: InlineBox; width: number };

export interface Line {
  pieces: Piece[];
  width: number;
  ascent: number;
  descent: number;
  /** Largest text size on the line, for line spacing. */
  size: number;
  /** Ended by a hard break (or the end of the content), so never stretched to justify it. */
  last?: boolean;
}

/** Ideographs, kana and hangul: lines may break between any two of them. */
const CJK =
  '\\u2E80-\\u2FFF\\u3000-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uAC00-\\uD7AF\\uF900-\\uFAFF\\uFF00-\\uFFEF';
const SEGMENT = new RegExp(`\\s+|[${CJK}]|[^\\s${CJK}]+`, 'gu');

type Segment =
  | { kind: 'space'; style: TextStyle }
  | { kind: 'word'; piece: Piece }
  | { kind: 'break'; style?: TextStyle };

/**
 * Breaks inline content into lines no wider than `maxWidth` (greedy, like a
 * browser): whitespace collapses to single spaces and is dropped at line ends,
 * and a word longer than a line is split between characters. The first line is
 * `firstIndent` narrower (wider when negative, for hanging indents).
 */
export function layoutLines(
  items: InlineItem[],
  maxWidth: number,
  measure: Measurer,
  defaultStyle: TextStyle,
  firstIndent = 0,
): Line[] {
  const segments: Segment[] = [];
  let lastStyle = defaultStyle;
  for (const item of items) {
    if (item.type === 'break') {
      segments.push({ kind: 'break', style: lastStyle });
    } else if (item.type === 'box') {
      segments.push({ kind: 'word', piece: { type: 'box', box: item, width: item.width } });
    } else {
      lastStyle = item.style;
      for (const [text] of item.text.matchAll(SEGMENT)) {
        if (/^\s/.test(text)) segments.push({ kind: 'space', style: item.style });
        else {
          const width = measure.width(text, item.style);
          segments.push({ kind: 'word', piece: { type: 'text', text, style: item.style, width } });
        }
      }
    }
  }

  const lines: Line[] = [];
  let current: Piece[] = [];
  let width = 0;
  let spaces: TextStyle[] = [];
  const limit = () => (lines.length ? maxWidth : maxWidth - firstIndent);
  const finish = (style: TextStyle, last = false) => {
    lines.push({ ...makeLine(current, measure, style), last });
    current = [];
    width = 0;
    spaces = [];
  };
  const spaceWidth = () => spaces.reduce((sum, style) => sum + measure.width(' ', style), 0);

  for (const segment of segments) {
    if (segment.kind === 'break') {
      finish(segment.style ?? defaultStyle, true);
      continue;
    }
    if (segment.kind === 'space') {
      if (current.length) spaces = [segment.style]; // runs of spaces collapse to one
      continue;
    }
    const { piece } = segment;
    let gap = current.length ? spaceWidth() : 0;
    if (current.length && width + gap + piece.width > limit()) {
      finish(defaultStyle);
      gap = 0;
    }
    if (!current.length && piece.type === 'text' && piece.width > limit()) {
      // Too long for any line (URLs, long identifiers): split between characters.
      const chunks = splitWord(piece.text, limit(), (text) => measure.width(text, piece.style));
      for (const chunk of chunks.slice(0, -1)) {
        current.push({ ...piece, text: chunk, width: measure.width(chunk, piece.style) });
        finish(piece.style);
      }
      const last = chunks[chunks.length - 1];
      current.push({ ...piece, text: last, width: measure.width(last, piece.style) });
      width = current[0].width;
      continue;
    }
    if (gap) {
      for (const style of spaces) {
        current.push({ type: 'text', text: ' ', style, width: measure.width(' ', style) });
      }
    }
    spaces = [];
    current.push(piece);
    width += gap + piece.width;
  }
  if (current.length || lines.length === 0) finish(lastStyle, true);
  return lines;
}

function makeLine(pieces: Piece[], measure: Measurer, fallback: TextStyle): Line {
  const merged: Piece[] = [];
  for (const piece of pieces) {
    const previous = merged[merged.length - 1];
    if (piece.type === 'text' && previous?.type === 'text' && previous.style === piece.style) {
      merged[merged.length - 1] = {
        ...previous,
        text: previous.text + piece.text,
        width: previous.width + piece.width,
      };
    } else {
      merged.push(piece);
    }
  }
  let ascent = 0;
  let descent = 0;
  let size = 0;
  for (const piece of merged) {
    if (piece.type === 'box') {
      ascent = Math.max(ascent, piece.box.ascent);
      descent = Math.max(descent, piece.box.descent);
    } else {
      ascent = Math.max(ascent, measure.ascent(piece.style) + (piece.style.rise ?? 0));
      descent = Math.max(descent, measure.descent(piece.style));
      size = Math.max(size, piece.style.size);
    }
  }
  if (!merged.some((piece) => piece.type === 'text')) {
    // Empty or box-only lines still take the height of a line of text.
    ascent = Math.max(ascent, merged.length ? 0 : measure.ascent(fallback));
    descent = Math.max(descent, merged.length ? 0 : measure.descent(fallback));
    size = merged.length ? 0 : fallback.size;
  }
  return {
    pieces: merged,
    width: merged.reduce((sum, piece) => sum + piece.width, 0),
    ascent,
    descent,
    size,
  };
}

/** Splits `text` into chunks that each fit `maxWidth` (at least one character each). */
export function splitWord(
  text: string,
  maxWidth: number,
  width: (text: string) => number,
): string[] {
  const chars = Array.from(text);
  const chunks: string[] = [];
  let chunk = '';
  for (const char of chars) {
    if (chunk && width(chunk + char) > maxWidth) {
      chunks.push(chunk);
      chunk = '';
    }
    chunk += char;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

/** Natural (unwrapped) width and narrowest possible width of inline content. */
export function measureInline(
  items: InlineItem[],
  measure: Measurer,
  defaultStyle: TextStyle,
): { natural: number; minimum: number } {
  const natural = Math.max(
    ...layoutLines(items, Infinity, measure, defaultStyle).map((line) => line.width),
  );
  let minimum = 0;
  for (const item of items) {
    if (item.type === 'box') minimum = Math.max(minimum, item.width);
    else if (item.type === 'text') {
      for (const [word] of item.text.matchAll(SEGMENT)) {
        if (!/^\s/.test(word)) minimum = Math.max(minimum, measure.width(word, item.style));
      }
    }
  }
  return { natural, minimum: Math.min(minimum, natural) };
}
