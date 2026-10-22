import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tool-edit-'));
let counter = 0;

/**
 * Opens a fresh Markdown file; `|` marks cursors and `«…»` selections (unless `raw`).
 * Files without any line break take the platform's default EOL (CRLF on Windows),
 * so single-line tests end with a break to pin it.
 */
async function open(marked: string, eol = '\n', raw = false): Promise<vscode.TextEditor> {
  const selections: [number, number][] = [];
  let text = '';
  let selectionStart = 0;
  for (const ch of marked.replace(/\n/g, eol)) {
    if (raw) {
      text += ch;
      continue;
    }
    if (ch === '|') selections.push([text.length, text.length]);
    else if (ch === '«') selectionStart = text.length;
    else if (ch === '»') selections.push([selectionStart, text.length]);
    else text += ch;
  }
  const file = path.join(dir, `doc-${counter++}.md`);
  fs.writeFileSync(file, text);
  const document = await vscode.workspace.openTextDocument(file);
  const editor = await vscode.window.showTextDocument(document);
  editor.selections = selections.map(
    ([start, end]) => new vscode.Selection(document.positionAt(start), document.positionAt(end)),
  );
  return editor;
}

/** The document text with the editor's selections drawn in the same notation. */
function show(editor: vscode.TextEditor): string {
  const { document } = editor;
  const marks: [number, string][] = [];
  for (const selection of editor.selections) {
    const start = document.offsetAt(selection.start);
    const end = document.offsetAt(selection.end);
    if (start === end) marks.push([start, '|']);
    else marks.push([start, '«'], [end, '»']);
  }
  let text = document.getText();
  for (const [at, mark] of marks.sort((a, b) => b[0] - a[0])) {
    text = text.slice(0, at) + mark + text.slice(at);
  }
  return text;
}

suite('Editing', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('JefersonPontes.md-tool')!.activate();
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('toggles bold and italic with multiple cursors, as one undo step', async () => {
    const editor = await open('one| «two» three|');
    await vscode.commands.executeCommand('mdTool.toggleBold');
    assert.strictEqual(show(editor), '**one|** **«two»** **three|**');
    await vscode.commands.executeCommand('mdTool.toggleItalic');
    assert.strictEqual(show(editor), '**_one|_** **_«two»_** **_three|_**');
    await vscode.commands.executeCommand('undo');
    assert.strictEqual(editor.document.getText(), '**one** **two** **three**');
  });

  test('toggles a code block', async () => {
    const editor = await open('a\n«b»\nc');
    await vscode.commands.executeCommand('mdTool.toggleCodeBlock');
    assert.strictEqual(show(editor), 'a\n```\n«b»\n```\nc');
  });

  test('links a selected URL without asking', async () => {
    const editor = await open('«https://code.visualstudio.com»');
    await vscode.commands.executeCommand('mdTool.insertLink');
    assert.strictEqual(show(editor), '[|](https://code.visualstudio.com)');
  });

  test('Enter continues lists and falls back to a plain newline', async () => {
    const editor = await open('1. [x] first|\n');
    await vscode.commands.executeCommand('mdTool.onEnterKey');
    assert.strictEqual(show(editor), '1. [x] first\n2. [ ] |\n');
    await vscode.commands.executeCommand('mdTool.onEnterKey');
    assert.strictEqual(show(editor), '1. [x] first\n|\n');

    const plain = await open('plain|\n');
    await vscode.commands.executeCommand('mdTool.onEnterKey');
    assert.strictEqual(show(plain), 'plain\n|\n');
  });

  test('Enter keeps the cursor right in CRLF documents', async () => {
    const editor = await open('- a|\n- b', '\r\n');
    assert.strictEqual(editor.document.eol, vscode.EndOfLine.CRLF);
    await vscode.commands.executeCommand('mdTool.onEnterKey');
    assert.strictEqual(show(editor), '- a\r\n- |\r\n- b');
  });

  test("Enter uses the document's EOL even when the text has no line break yet", async () => {
    // A single-line file takes the default EOL, which the text alone cannot reveal.
    const editor = await open('- only|');
    const eol = editor.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    await vscode.commands.executeCommand('mdTool.onEnterKey');
    assert.strictEqual(show(editor), `- only${eol}- |`);
  });

  test('Format Document aligns tables', async () => {
    // Raw text: tables are full of `|`, which `open()` would read as cursors.
    const editor = await open('|Nome|Idade|\n|:-|-:|\n|João|30|\n', '\n', true);
    const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
      'vscode.executeFormatDocumentProvider',
      editor.document.uri,
      { tabSize: 2, insertSpaces: true },
    );
    assert.ok(edits && edits.length > 0, 'no formatting edits');
    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.set(editor.document.uri, edits);
    await vscode.workspace.applyEdit(workspaceEdit);
    assert.strictEqual(
      editor.document.getText(),
      '| Nome | Idade |\n| :--- | ----: |\n| João |    30 |\n',
    );
  });

  test('inserts a table of contents and refreshes it on save', async () => {
    const editor = await open('# Doc\n|\n## Um\n## Dois\n');
    await vscode.commands.executeCommand('mdTool.insertToc');
    assert.strictEqual(
      editor.document.getText(),
      '# Doc\n<!-- toc -->\n- [Um](#um)\n- [Dois](#dois)\n<!-- tocstop -->\n\n## Um\n## Dois\n',
    );

    await editor.edit((edit) =>
      edit.insert(editor.document.positionAt(editor.document.getText().length), '## Três\n'),
    );
    await editor.document.save();
    assert.ok(editor.document.getText().includes('- [Três](#três)\n<!-- tocstop -->'));
    assert.ok(fs.readFileSync(editor.document.uri.fsPath, 'utf8').includes('- [Três](#três)'));
  });
});
