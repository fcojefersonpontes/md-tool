/** A rendered block: its zero-based source line and its document offset in pixels. */
export interface LineAnchor {
  line: number;
  top: number;
}

/**
 * Sorts anchors by line, keeps the first (outermost) anchor per line and drops
 * anchors that would move backwards on screen, so both lookups below can
 * interpolate monotonically.
 */
export function normalizeAnchors(anchors: readonly LineAnchor[]): LineAnchor[] {
  const sorted = [...anchors].sort((a, b) => a.line - b.line || a.top - b.top);
  const result: LineAnchor[] = [];
  for (const anchor of sorted) {
    const last = result[result.length - 1];
    if (last && (anchor.line === last.line || anchor.top < last.top)) continue;
    result.push(anchor);
  }
  return result;
}

/** Scroll offset that brings `line` to the top of the preview. */
export function offsetForLine(anchors: readonly LineAnchor[], line: number): number {
  if (anchors.length === 0 || line < 1) return 0;
  let prev: LineAnchor | undefined;
  let next: LineAnchor | undefined;
  for (const anchor of anchors) {
    if (anchor.line <= line) prev = anchor;
    else {
      next = anchor;
      break;
    }
  }
  if (!prev) return 0;
  if (!next) return prev.top;
  const fraction = (line - prev.line) / (next.line - prev.line);
  return prev.top + (next.top - prev.top) * fraction;
}

/** Source line (fractional) shown at the scroll offset `offset`. */
export function lineForOffset(anchors: readonly LineAnchor[], offset: number): number {
  if (anchors.length === 0) return 0;
  let prev: LineAnchor | undefined;
  let next: LineAnchor | undefined;
  for (const anchor of anchors) {
    if (anchor.top <= offset) prev = anchor;
    else {
      next = anchor;
      break;
    }
  }
  if (!prev) return 0;
  if (!next || next.top === prev.top) return prev.line;
  const fraction = (offset - prev.top) / (next.top - prev.top);
  return prev.line + (next.line - prev.line) * fraction;
}
