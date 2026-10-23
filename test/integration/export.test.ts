import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

/** Compiled to out/integration, two levels below the repository root. */
const fixtures = path.resolve(__dirname, '../../test/fixtures');

/** Set MD_TOOL_E2E_OUT to keep the exported files for manual inspection. */
const keepDir = process.env.MD_TOOL_E2E_OUT;

function keep(file: string): void {
  if (!keepDir) return;
  fs.mkdirSync(keepDir, { recursive: true });
  fs.copyFileSync(file, path.join(keepDir, path.basename(file)));
}

async function exportAs(command: string, uri: vscode.Uri): Promise<string> {
  const target = await vscode.commands.executeCommand<vscode.Uri | undefined>(command, uri);
  assert.ok(target, `${command} returned no file`);
  return target.fsPath;
}

suite('Export end to end (kitchen sink)', () => {
  let source: vscode.Uri;

  suiteSetup(() => {
    // A private copy, so exports land next to it and not in the repository.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tool-e2e-'));
    fs.cpSync(path.join(fixtures, 'assets'), path.join(dir, 'assets'), { recursive: true });
    fs.copyFileSync(path.join(fixtures, 'kitchen-sink.md'), path.join(dir, 'kitchen-sink.md'));
    source = vscode.Uri.file(path.join(dir, 'kitchen-sink.md'));
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('RTF embeds every image, formula and diagram as a picture', async () => {
    const file = await exportAs('mdTool.exportRtf', source);
    keep(file);
    const rtf = fs.readFileSync(file, 'ascii');

    // logo.svg (rasterized), banner.png (direct), inline + block formula, Mermaid diagram.
    assert.strictEqual(rtf.match(/\\pict\\pngblip/g)?.length, 5);
    for (const leaked of ['[Logo]', '\\\\int_0', 'mc^2', 'graph LR', 'A[Markdown]']) {
      assert.ok(!rtf.includes(leaked), `source leaked into the RTF: ${leaked}`);
    }
    // Text content is still there, and code keeps its indentation (space + \~).
    assert.ok(rtf.includes('Kitchen sink\\par'));
    assert.ok(rtf.includes('\\line  \\~name: string;'));
    assert.ok(rtf.includes('{\\*\\bkmkstart _tabelas}'));
  });

  test('PDF is printed with several pages', async () => {
    const file = await exportAs('mdTool.exportPdf', source);
    keep(file);
    const pdf = fs.readFileSync(file, 'latin1');
    assert.ok(pdf.startsWith('%PDF-'));
    assert.ok((pdf.match(/\/Type\s*\/Page\b/g) ?? []).length >= 2);
  });

  test('exports the editor buffer, including unsaved changes', async () => {
    const document = await vscode.workspace.openTextDocument(source);
    const editor = await vscode.window.showTextDocument(document);
    await editor.edit((edit) => edit.insert(new vscode.Position(4, 0), 'UNSAVED-MARKER\n\n'));
    assert.ok(document.isDirty);
    try {
      const rtf = fs.readFileSync(await exportAs('mdTool.exportRtf', source), 'ascii');
      assert.ok(rtf.includes('UNSAVED-MARKER'));
    } finally {
      await vscode.commands.executeCommand('workbench.action.files.revert');
    }
  });

  test('exports from the focused preview', async () => {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(source));
    await vscode.commands.executeCommand('mdTool.openPreview');
    // The preview replaced the editor in the active group: no text editor is focused.
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.strictEqual(vscode.window.activeTextEditor, undefined);
    const file = await exportAs('mdTool.exportRtf', undefined as unknown as vscode.Uri);
    assert.strictEqual(file, source.fsPath.replace(/\.md$/, '.rtf'));
  });

  test("exports from the preview's title buttons, which pass the panel's URI", async () => {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(source));
    await vscode.commands.executeCommand('mdTool.openPreview');
    await new Promise((resolve) => setTimeout(resolve, 300));
    // What VS Code hands an editor/title command while a webview is active.
    const panel = vscode.Uri.parse('webview-panel:webview-panel/webview-mdTool.preview-test');
    const file = await exportAs('mdTool.exportRtf', panel);
    assert.strictEqual(file, source.fsPath.replace(/\.md$/, '.rtf'));
  });
});

suite('Export end to end (ABNT profile)', () => {
  let dir: string;

  suiteSetup(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tool-abnt-'));
    fs.cpSync(path.join(fixtures, 'assets'), path.join(dir, 'assets'), { recursive: true });
    fs.copyFileSync(path.join(fixtures, 'abnt.md'), path.join(dir, 'abnt.md'));
    fs.writeFileSync(
      path.join(dir, 'plain.md'),
      '# Plain\n\n## Section\n\nText.[^1]\n\n[^1]: Note.\n',
    );
  });

  teardown(async () => {
    await vscode.workspace
      .getConfiguration('mdTool.export')
      .update('profile', undefined, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('the front matter chooses the profile', async () => {
    const source = vscode.Uri.file(path.join(dir, 'abnt.md'));
    const rtfFile = await exportAs('mdTool.exportRtf', source);
    keep(rtfFile);
    const rtf = fs.readFileSync(rtfFile, 'ascii');
    assert.ok(rtf.includes('\\deflang1046'));
    assert.ok(rtf.includes('{\\f0\\froman\\fcharset0 Times New Roman;}'));
    assert.ok(rtf.includes('\\margl1701\\margr1134\\margt1701\\margb1134'));
    assert.ok(rtf.includes('{\\footnote'));
    assert.ok(rtf.includes('Tabela 1 \\u8211? Atendimentos'));

    const pdfFile = await exportAs('mdTool.exportPdf', source);
    keep(pdfFile);
    const pdf = fs.readFileSync(pdfFile, 'latin1');
    assert.ok(pdf.includes('/Lang (pt-BR)'));
    assert.ok((pdf.match(/\/Type\s*\/Page\b/g) ?? []).length >= 2);
  });

  test('the setting chooses it for documents that do not', async () => {
    const source = vscode.Uri.file(path.join(dir, 'plain.md'));
    const before = fs.readFileSync(await exportAs('mdTool.exportRtf', source), 'ascii');
    assert.ok(!before.includes('\\deflang1046'));

    await vscode.workspace
      .getConfiguration('mdTool.export')
      .update('profile', 'abnt', vscode.ConfigurationTarget.Global);
    const after = fs.readFileSync(await exportAs('mdTool.exportRtf', source), 'ascii');
    assert.ok(after.includes('\\deflang1046'));
    assert.ok(after.includes('1\\tab SECTION'));
  });
});
