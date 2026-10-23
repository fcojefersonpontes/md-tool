import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

function previewTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter(
      (tab) =>
        tab.input instanceof vscode.TabInputWebview &&
        tab.input.viewType.endsWith('mdTool.preview'),
    );
}

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

suite('Extension', () => {
  let file: vscode.Uri;

  suiteSetup(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tool-'));
    const filePath = path.join(dir, 'sample.md');
    fs.writeFileSync(
      filePath,
      '# Sample\n\n- [ ] task\n\nEnergy: $E = mc^2$\n\n```ts\nconst a = 1;\n```\n',
    );
    file = vscode.Uri.file(filePath);
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('activates on a Markdown document', async () => {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
    const ext = vscode.extensions.getExtension('JefersonPontes.md-tool');
    assert.ok(ext, 'extension not found');
    await ext.activate();
    assert.strictEqual(ext.isActive, true);
  });

  test('registers its commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('mdTool.openPreview'));
    assert.ok(commands.includes('mdTool.openPreviewToSide'));
    assert.ok(commands.includes('mdTool.showSource'));
    assert.ok(commands.includes('mdTool.exportPdf'));
    assert.ok(commands.includes('mdTool.exportRtf'));
  });

  test('exports RTF next to the source file', async () => {
    const target = await vscode.commands.executeCommand<vscode.Uri | undefined>(
      'mdTool.exportRtf',
      file,
    );
    assert.ok(target, 'export returned no file');
    assert.strictEqual(target.fsPath, file.fsPath.replace(/\.md$/, '.rtf'));
    const rtf = fs.readFileSync(target.fsPath, 'ascii');
    assert.ok(rtf.startsWith('{\\rtf1'), rtf.slice(0, 40));
    assert.ok(rtf.includes('Sample\\par'));
    // The formula is rendered by the browser and embedded as a picture, not as TeX.
    assert.ok(rtf.includes('\\pict\\pngblip'), 'formula was not embedded as an image');
    assert.ok(!rtf.includes('mc^2'), 'formula source leaked into the RTF');
  });

  test('exports PDF next to the source file', async () => {
    const target = await vscode.commands.executeCommand<vscode.Uri | undefined>(
      'mdTool.exportPdf',
      file,
    );
    assert.ok(target, 'export returned no file (is Chrome/Edge installed?)');
    const pdf = fs.readFileSync(target.fsPath);
    assert.strictEqual(pdf.subarray(0, 5).toString(), '%PDF-');
  });

  test('opens the preview to the side, once per document', async () => {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
    await vscode.commands.executeCommand('mdTool.openPreviewToSide');
    await waitFor(() => previewTabs().length === 1);
    assert.strictEqual(previewTabs()[0].label, 'Preview sample.md');

    // Re-running the command reveals the existing preview instead of opening another.
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
    await vscode.commands.executeCommand('mdTool.openPreviewToSide');
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.strictEqual(previewTabs().length, 1);
  });

  test('opens the preview in place and goes back to the source', async () => {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
    await vscode.commands.executeCommand('mdTool.openPreview');
    await waitFor(() => previewTabs().length === 1);
    const group = vscode.window.tabGroups.activeTabGroup;
    assert.strictEqual(vscode.window.tabGroups.all.length, 1); // nothing opened to the side
    assert.ok(group.activeTab?.input instanceof vscode.TabInputWebview);

    await vscode.commands.executeCommand('mdTool.showSource');
    await waitFor(() => vscode.window.activeTextEditor?.document.uri.fsPath === file.fsPath);
    assert.strictEqual(vscode.window.activeTextEditor?.viewColumn, group.viewColumn);
  });

  test('opens the preview for an explorer resource', async () => {
    await vscode.commands.executeCommand('mdTool.openPreview', file);
    await waitFor(() => previewTabs().length === 1);
  });

  test('keeps the preview alive while the document is edited', async () => {
    const editor = await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument(file),
    );
    await vscode.commands.executeCommand('mdTool.openPreviewToSide');
    await waitFor(() => previewTabs().length === 1);
    await editor.edit((edit) => edit.insert(new vscode.Position(0, 0), '## Edited\n\n'));
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.strictEqual(previewTabs().length, 1);

    // Discard the edit so closing the editors does not prompt to save.
    await vscode.window.showTextDocument(editor.document);
    await vscode.commands.executeCommand('workbench.action.files.revert');
  });
});
