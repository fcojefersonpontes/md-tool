/** Offsets into a document's text. `start === end` is a cursor. */
export interface Span {
  start: number;
  end: number;
}

/** Replace `[start, end)` of the original text with `text`. */
export interface Edit extends Span {
  text: string;
}

export interface EditResult {
  /** Non-overlapping edits, in original-text offsets. */
  edits: Edit[];
  /** Selections to set afterwards, in offsets of the edited text. */
  selections: Span[];
}

/** What one selection turns into, before being combined with the others. */
export interface SelectionChange {
  edits: Edit[];
  /** The new selection, in offsets of the text with only `edits` applied. */
  selection: Span;
}

/** Applies edits (any order, non-overlapping) to `text`. */
export function applyEdits(text: string, edits: readonly Edit[]): string {
  let out = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}

/**
 * Runs `change` for every selection (multi-cursor) and merges the results into
 * one non-overlapping edit set with the final selections. A selection whose
 * edits would overlap an earlier selection's edits is left untouched.
 */
export function editSelections(
  selections: readonly Span[],
  change: (selection: Span) => SelectionChange,
): EditResult {
  const ordered = [...selections].sort((a, b) => a.start - b.start || a.end - b.end);
  const edits: Edit[] = [];
  const result: Span[] = [];
  let delta = 0;
  let lastEnd = -1;

  for (const selection of ordered) {
    const local = change(selection);
    const ownEdits = [...local.edits].sort((a, b) => a.start - b.start);
    const first = ownEdits[0];
    if (first && first.start < lastEnd) {
      // Overlaps the previous selection's edits (e.g. two cursors in one word).
      result.push({ start: selection.start + delta, end: selection.end + delta });
      continue;
    }
    edits.push(...ownEdits);
    result.push({ start: local.selection.start + delta, end: local.selection.end + delta });
    for (const edit of ownEdits) {
      delta += edit.text.length - (edit.end - edit.start);
      lastEnd = Math.max(lastEnd, edit.end);
    }
  }
  return { edits, selections: result };
}

/**
 * Maps a span through `edits`. Text inserted exactly at the span's start lands
 * before it; text inserted exactly at its end lands after it. So wrapping a
 * selection keeps the same characters selected, and a cursor stays inside an
 * inserted pair.
 */
export function shiftSpan(span: Span, edits: readonly Edit[]): Span {
  const delta = (edit: Edit) => edit.text.length - (edit.end - edit.start);
  const isInsertAt = (edit: Edit, offset: number) =>
    edit.start === edit.end && edit.start === offset;
  const shiftEnd = (offset: number) =>
    offset +
    edits
      .filter((edit) => edit.end <= offset && !isInsertAt(edit, offset))
      .reduce((sum, edit) => sum + delta(edit), 0);
  if (span.start === span.end) {
    const at = shiftEnd(span.start);
    return { start: at, end: at };
  }
  const start =
    span.start +
    edits.filter((edit) => edit.end <= span.start).reduce((sum, edit) => sum + delta(edit), 0);
  return { start, end: shiftEnd(span.end) };
}

/** Like `shiftSpan`, but text inserted exactly at either edge ends up inside the span. */
export function growSpan(span: Span, edits: readonly Edit[]): Span {
  const delta = (edit: Edit) => edit.text.length - (edit.end - edit.start);
  const isInsertAt = (edit: Edit, offset: number) =>
    edit.start === edit.end && edit.start === offset;
  const start =
    span.start +
    edits
      .filter((edit) => edit.end <= span.start && !isInsertAt(edit, span.start))
      .reduce((sum, edit) => sum + delta(edit), 0);
  const end =
    span.end +
    edits
      .filter((edit) => edit.start < span.end || isInsertAt(edit, span.end))
      .reduce((sum, edit) => sum + delta(edit), 0);
  return { start, end };
}
