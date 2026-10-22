import { applyEdits, type EditResult, type Span } from '../../src/core/edit/edits';

/**
 * Test notation for cursors and selections: `|` is a cursor, `«…»` a selection.
 * `parse('a «b» c|')` -> text `a b c` with two selections.
 */
export function parse(marked: string): { text: string; selections: Span[] } {
  const selections: Span[] = [];
  let text = '';
  let open: number | undefined;
  for (const ch of marked) {
    if (ch === '|') selections.push({ start: text.length, end: text.length });
    else if (ch === '«') open = text.length;
    else if (ch === '»') {
      selections.push({ start: open!, end: text.length });
      open = undefined;
    } else text += ch;
  }
  return { text, selections };
}

/** Applies a result and renders it back in the same notation. */
export function render(text: string, result: EditResult): string {
  const edited = applyEdits(text, result.edits);
  const marks: { at: number; mark: string }[] = [];
  for (const selection of result.selections) {
    if (selection.start === selection.end) marks.push({ at: selection.start, mark: '|' });
    else {
      marks.push({ at: selection.start, mark: '«' });
      marks.push({ at: selection.end, mark: '»' });
    }
  }
  let out = edited;
  for (const { at, mark } of marks.sort((a, b) => b.at - a.at)) {
    out = out.slice(0, at) + mark + out.slice(at);
  }
  return out;
}

/** `run('**a|**', fn)` -> rendered result of `fn(text, selections)`. */
export function run(marked: string, fn: (text: string, selections: Span[]) => EditResult): string {
  const { text, selections } = parse(marked);
  return render(text, fn(text, selections));
}
