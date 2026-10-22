import * as vscode from 'vscode';
import type { Edit, EditResult, Span } from '../core/edit/edits';

/** Document offsets of the editor's selections. */
export function selectionSpans(editor: vscode.TextEditor): Span[] {
  const { document } = editor;
  return editor.selections.map((selection) => ({
    start: document.offsetAt(selection.start),
    end: document.offsetAt(selection.end),
  }));
}

export function toTextEdits(
  document: vscode.TextDocument,
  edits: readonly Edit[],
): vscode.TextEdit[] {
  return edits.map(
    (edit) =>
      new vscode.TextEdit(
        new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)),
        edit.text,
      ),
  );
}

/** Applies a core `EditResult` as one undo step, then moves the selections. */
export async function applyResult(editor: vscode.TextEditor, result: EditResult): Promise<boolean> {
  const { document } = editor;
  if (result.edits.length > 0) {
    const applied = await editor.edit((builder) => {
      for (const edit of toTextEdits(document, result.edits)) {
        builder.replace(edit.range, edit.newText);
      }
    });
    if (!applied) return false;
  }
  editor.selections = result.selections.map(
    (span) => new vscode.Selection(document.positionAt(span.start), document.positionAt(span.end)),
  );
  return true;
}
