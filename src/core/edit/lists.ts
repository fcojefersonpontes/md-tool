import { type EditResult, type Span } from './edits';
import { lineEnding } from './formatting';

/** Optional quote/indent prefix, list marker, spacing and an optional task box. */
const LIST_ITEM = /^((?:[ \t]*>[ \t]?)*[ \t]*)([-*+]|(\d{1,9})([.)]))([ \t]+)(\[[ xX]\][ \t]+)?/;
const QUOTE = /^((?:[ \t]*>[ \t]?)+)/;

/**
 * What Enter does in a Markdown list or block quote, for every cursor:
 * - in a list item, start the next item (`- `, `2. `, `- [ ] `), splitting the
 *   text at the cursor;
 * - on an empty item, end the list by removing its marker;
 * - in a block quote, continue the `> ` prefix (or end the quote on an empty line).
 *
 * Returns `undefined` when Enter should keep its default behaviour: a non-empty
 * selection, or a cursor outside any list / quote (or inside the marker itself).
 */
export function continueList(
  text: string,
  selections: readonly Span[],
  eol = lineEnding(text),
): EditResult | undefined {
  const edits: EditResult['edits'] = [];
  const result: Span[] = [];
  let delta = 0;

  for (const selection of [...selections].sort((a, b) => a.start - b.start)) {
    if (selection.start !== selection.end) return undefined;
    const cursor = selection.start;
    const lineStart = text.lastIndexOf('\n', cursor - 1) + 1;
    const newline = text.indexOf('\n', cursor);
    const lineEnd = newline === -1 ? text.length : newline;
    const line = text.slice(lineStart, lineEnd).replace(/\r$/, '');
    const column = cursor - lineStart;

    const change = changeFor(line, column, eol);
    if (!change) return undefined;

    const edit =
      change.kind === 'insert'
        ? { start: cursor, end: cursor, text: change.text }
        : { start: lineStart, end: lineStart + line.length, text: change.text };
    edits.push(edit);
    const caret =
      change.kind === 'insert' ? cursor + change.text.length : lineStart + change.text.length;
    result.push({ start: caret + delta, end: caret + delta });
    delta += edit.text.length - (edit.end - edit.start);
  }
  return { edits, selections: result };
}

type Change = { kind: 'insert'; text: string } | { kind: 'replaceLine'; text: string };

function changeFor(line: string, column: number, eol: string): Change | undefined {
  const item = LIST_ITEM.exec(line);
  if (item) {
    const [marker, prefix, bullet, number, delimiter, spacing, task] = item;
    if (column < marker.length) return undefined; // cursor inside the marker
    if (line.slice(marker.length).trim() === '') {
      // Empty item: end the list, keeping any quote prefix.
      return { kind: 'replaceLine', text: prefix.replace(/[ \t]+$/, '') };
    }
    const next = number === undefined ? bullet : `${Number(number) + 1}${delimiter}`;
    return { kind: 'insert', text: `${eol}${prefix}${next}${spacing}${task ? '[ ] ' : ''}` };
  }

  const quote = QUOTE.exec(line);
  if (quote) {
    const [prefix] = quote;
    if (column < prefix.length) return undefined;
    if (line.slice(prefix.length).trim() === '') return { kind: 'replaceLine', text: '' };
    return { kind: 'insert', text: `${eol}${prefix.endsWith(' ') ? prefix : `${prefix} `}` };
  }
  return undefined;
}
