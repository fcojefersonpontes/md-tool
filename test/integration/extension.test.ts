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
    fs.writeFileSync(filePath, '# Sample\n\n- [ ] task\n\n```ts\nconst a = 1;\n```\n');
    file = vscode.Uri.file(filePath);
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('activates on a Markdown document', async () => {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
    const ext = vscode.extensions.getExtension('jefersonpontes.md-tool');
    assert.ok(ext, 'extension not found');
    await ext.activate();
    assert.strictEqual(ext.isActive, true);
  });

  test('registers its commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('mdTool.openPreview'));
    assert.ok(commands.includes('mdTool.openPreviewToSide'));
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
