import { type EditResult, editSelections, type Span } from './edits';

/** `[label](url)`, escaping brackets in the label and wrapping awkward URLs in `<>`. */
export function markdownLink(label: string, url: string): string {
  const escaped = label.replace(/([\\[\]])/g, '\\$1');
  const needsAngles = /[\s<>]/.test(url) || unbalancedParens(url);
  return `[${escaped}](${needsAngles ? `<${url}>` : url})`;
}

function unbalancedParens(url: string): boolean {
  let depth = 0;
  for (const ch of url) {
    if (ch === '(') depth++;
    if (ch === ')' && --depth < 0) return true;
  }
  return depth !== 0;
}

export function looksLikeUrl(text: string): boolean {
  return /^(https?:\/\/|mailto:|www\.)\S+$/i.test(text.trim());
}

/**
 * Turns every selection into a link to `url`. Selected text becomes the label
 * and the cursor goes after the link; an empty selection inserts `[](url)` with
 * the cursor inside the brackets, ready for the label.
 */
export function insertLink(text: string, selections: readonly Span[], url: string): EditResult {
  return editSelections(selections, (selection) => {
    const label = text.slice(selection.start, selection.end);
    const link = markdownLink(label, url);
    const caret = label ? selection.start + link.length : selection.start + 1;
    return {
      edits: [{ start: selection.start, end: selection.end, text: link }],
      selection: { start: caret, end: caret },
    };
  });
}

/** Selections that are URLs become `[](url)`, with the cursor in the brackets. */
export function linkSelectedUrls(text: string, selections: readonly Span[]): EditResult {
  return editSelections(selections, (selection) => {
    const url = text.slice(selection.start, selection.end).trim();
    const link = markdownLink('', url);
    return {
      edits: [{ start: selection.start, end: selection.end, text: link }],
      selection: { start: selection.start + 1, end: selection.start + 1 },
    };
  });
}
