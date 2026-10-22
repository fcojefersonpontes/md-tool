import * as vscode from 'vscode';
import { getEditorConfig, getTocConfig } from '../config';
import { type InlineStyle, toggleCodeBlock, toggleInlineStyle } from '../core/edit/formatting';
import { insertLink, linkSelectedUrls, looksLikeUrl } from '../core/edit/links';
import { continueList } from '../core/edit/lists';
import { formatTables, isInTable } from '../core/edit/table';
import { TOC_START, tocEdit } from '../core/edit/toc';
import type { EngineProvider } from '../engineProvider';
import { applyResult, selectionSpans, toTextEdits } from './applyResult';

const MARKDOWN: vscode.DocumentSelector = { language: 'markdown' };

/** Editing commands, list continuation, table formatting and the table of contents. */
export class EditorFeatures implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private formatter: vscode.Disposable | undefined;

  constructor(private readonly engines: EngineProvider) {
    const style = (name: string, inline: InlineStyle) =>
      this.textCommand(name, (editor) =>
        applyResult(
          editor,
          toggleInlineStyle(editor.document.getText(), selectionSpans(editor), inline),
        ),
      );

    this.disposables.push(
      style('mdTool.toggleBold', 'bold'),
      style('mdTool.toggleItalic', 'italic'),
      style('mdTool.toggleStrikethrough', 'strikethrough'),
      style('mdTool.toggleCode', 'code'),
      this.textCommand('mdTool.toggleCodeBlock', (editor) =>
        applyResult(
          editor,
          toggleCodeBlock(
            editor.document.getText(),
            selectionSpans(editor),
            eolOf(editor.document),
          ),
        ),
      ),
      this.textCommand('mdTool.insertLink', (editor) => this.insertLink(editor)),
      this.textCommand('mdTool.formatTables', (editor) => this.formatTablesAtCursor(editor)),
      this.textCommand('mdTool.insertToc', (editor) => this.insertToc(editor)),
      vscode.commands.registerCommand('mdTool.onEnterKey', () => this.onEnter()),
      vscode.workspace.onWillSaveTextDocument((event) => this.updateTocOnSave(event)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('mdTool.editor.formatTables')) this.registerFormatter();
      }),
    );
    this.registerFormatter();
  }

  dispose(): void {
    this.formatter?.dispose();
    vscode.Disposable.from(...this.disposables).dispose();
  }

  /** A command that runs on the active Markdown editor, if any. */
  private textCommand(
    id: string,
    run: (editor: vscode.TextEditor) => Thenable<unknown> | Promise<unknown>,
  ): vscode.Disposable {
    return vscode.commands.registerCommand(id, async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && !editor.document.isClosed) await run(editor);
    });
  }

  // ------------------------------------------------------------------ Enter

  private async onEnter(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const result = editor
      ? continueList(editor.document.getText(), selectionSpans(editor), eolOf(editor.document))
      : undefined;
    if (editor && result) {
      await applyResult(editor, result);
      editor.revealRange(editor.selection, vscode.TextEditorRevealType.Default);
    } else {
      // Not in a list: behave exactly like a normal Enter.
      await vscode.commands.executeCommand('type', { source: 'keyboard', text: '\n' });
    }
  }

  // ------------------------------------------------------------------ links

  private async insertLink(editor: vscode.TextEditor): Promise<void> {
    const text = editor.document.getText();
    const spans = selectionSpans(editor);
    const selected = spans.map((span) => text.slice(span.start, span.end));
    if (selected.every((value) => value && looksLikeUrl(value))) {
      await applyResult(editor, linkSelectedUrls(text, spans));
      return;
    }

    const clipboard = (await vscode.env.clipboard.readText()).trim();
    const url = await vscode.window.showInputBox({
      title: vscode.l10n.t('Insert Link'),
      prompt: vscode.l10n.t('Link address (URL or path)'),
      placeHolder: 'https://',
      value: looksLikeUrl(clipboard) ? clipboard : '',
      ignoreFocusOut: true,
    });
    if (!url?.trim()) return;
    // Re-read: the document may have changed while the input box was open.
    await applyResult(
      editor,
      insertLink(editor.document.getText(), selectionSpans(editor), url.trim()),
    );
  }

  // ----------------------------------------------------------------- tables

  private async formatTablesAtCursor(editor: vscode.TextEditor): Promise<void> {
    const { document } = editor;
    const text = document.getText();
    const cursor = document.offsetAt(editor.selection.active);
    // The table under the cursor, or every table when the cursor is not in one.
    const edits = isInTable(text, cursor) ? formatTables(text, cursor) : formatTables(text);
    if (edits.length === 0) {
      vscode.window.setStatusBarMessage(vscode.l10n.t('Tables are already formatted.'), 3000);
      return;
    }
    await editor.edit((builder) => {
      for (const edit of toTextEdits(document, edits)) builder.replace(edit.range, edit.newText);
    });
  }

  private registerFormatter(): void {
    this.formatter?.dispose();
    this.formatter = undefined;
    if (!getEditorConfig().formatTables) return;
    const provider: vscode.DocumentFormattingEditProvider &
      vscode.DocumentRangeFormattingEditProvider = {
      provideDocumentFormattingEdits: (document) =>
        toTextEdits(document, formatTables(document.getText())),
      provideDocumentRangeFormattingEdits: (document, range) => {
        const start = document.offsetAt(range.start);
        const end = document.offsetAt(range.end);
        const edits = formatTables(document.getText()).filter(
          (edit) => edit.start <= end && edit.end >= start,
        );
        return toTextEdits(document, edits);
      },
    };
    this.formatter = vscode.Disposable.from(
      vscode.languages.registerDocumentFormattingEditProvider(MARKDOWN, provider),
      vscode.languages.registerDocumentRangeFormattingEditProvider(MARKDOWN, provider),
    );
  }

  // ------------------------------------------------------- table of contents

  private async insertToc(editor: vscode.TextEditor): Promise<void> {
    const { document } = editor;
    const text = document.getText();
    const engine = await this.engines.get(document.uri);
    const lineStart = document.offsetAt(new vscode.Position(editor.selection.active.line, 0));
    const edit = tocEdit(
      text,
      engine.parse(text).headings,
      getTocConfig(document.uri),
      lineStart,
      eolOf(document),
    );
    if (!edit) {
      vscode.window.setStatusBarMessage(
        vscode.l10n.t('The table of contents is up to date.'),
        3000,
      );
      return;
    }
    await editor.edit((builder) => {
      const [textEdit] = toTextEdits(document, [edit]);
      builder.replace(textEdit.range, textEdit.newText);
    });
  }

  private updateTocOnSave(event: vscode.TextDocumentWillSaveEvent): void {
    const { document } = event;
    if (document.languageId !== 'markdown' || !getTocConfig(document.uri).updateOnSave) return;
    const text = document.getText();
    if (!text.includes(TOC_START)) return;
    event.waitUntil(
      this.engines.get(document.uri).then((engine) => {
        const edit = tocEdit(
          text,
          engine.parse(text).headings,
          getTocConfig(document.uri),
          undefined,
          eolOf(document),
        );
        return edit ? toTextEdits(document, [edit]) : [];
      }),
    );
  }
}

/** The line ending VS Code stores for the document (inserted breaks are normalised to it). */
function eolOf(document: vscode.TextDocument): string {
  return document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
}
