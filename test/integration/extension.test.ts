import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('Extension', () => {
  test('activates on a Markdown document', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: '# Oi' });
    await vscode.window.showTextDocument(doc);

    const ext = vscode.extensions.getExtension('jefersonpontes.md-tool');
    assert.ok(ext, 'extension not found');
    await ext.activate();
    assert.strictEqual(ext.isActive, true);
  });

  test('registers its commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('mdTool.hello'));
  });
});
