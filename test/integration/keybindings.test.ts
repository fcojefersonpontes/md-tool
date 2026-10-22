import * as assert from 'node:assert';
import * as vscode from 'vscode';

interface Binding {
  key: string;
  command: string;
  when?: string;
}

/** Reads VS Code's resolved default keybindings (built-in + extensions). */
async function defaultKeybindings(): Promise<Binding[]> {
  await vscode.commands.executeCommand('workbench.action.openDefaultKeybindingsFile');
  const text = vscode.window.activeTextEditor!.document.getText();
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  const bindings: Binding[] = [];
  const entry =
    /\{\s*"key":\s*"([^"]+)",\s*"command":\s*"([^"]+)"(?:,\s*"when":\s*"((?:[^"\\]|\\.)*)")?/g;
  for (const match of text.matchAll(entry)) {
    bindings.push({ key: match[1], command: match[2], when: match[3]?.replace(/\\"/g, '"') });
  }
  return bindings;
}

suite('Keybindings', () => {
  let bindings: Binding[];

  suiteSetup(async () => {
    await vscode.extensions.getExtension('JefersonPontes.md-tool')!.activate();
    bindings = await defaultKeybindings();
    assert.ok(bindings.length > 500, `parsed only ${bindings.length} keybindings`);
  });

  const ours = (command: string) => bindings.find((b) => b.command === command);
  const sharing = (key: string, command: string) =>
    bindings.filter((b) => b.key === key && b.command !== command && !b.command.startsWith('-'));

  test('editing shortcuts are bound only in editable Markdown editors', () => {
    const expected: [string, string][] = [
      ['mdTool.toggleBold', process.platform === 'darwin' ? 'cmd+b' : 'ctrl+b'],
      ['mdTool.toggleItalic', process.platform === 'darwin' ? 'cmd+i' : 'ctrl+i'],
      ['mdTool.insertLink', process.platform === 'darwin' ? 'cmd+k l' : 'ctrl+k l'],
      ['mdTool.onEnterKey', 'enter'],
    ];
    for (const [command, key] of expected) {
      const binding = ours(command);
      assert.ok(binding, `${command} is not bound`);
      assert.strictEqual(binding.key, key);
      // VS Code normalises the clause, quoting values: editorLangId == 'markdown'.
      const when = binding.when?.replace(/'/g, '') ?? '';
      for (const part of ['editorTextFocus', 'editorLangId == markdown', '!editorReadonly']) {
        assert.ok(when.includes(part), `${command} when clause lacks ${part}: ${binding.when}`);
      }
    }
  });

  test('Enter yields to suggestions, inline suggestions and snippets, and can be turned off', () => {
    const when = ours('mdTool.onEnterKey')!.when!;
    for (const part of [
      '!suggestWidgetVisible',
      '!inlineSuggestionVisible',
      '!inSnippetMode',
      'config.mdTool.editor.listContinuation',
    ]) {
      assert.ok(when.includes(part), `Enter when clause lacks ${part}`);
    }
  });

  test('Ctrl+K L is not taken by a built-in command', () => {
    const key = process.platform === 'darwin' ? 'cmd+k l' : 'ctrl+k l';
    assert.deepStrictEqual(sharing(key, 'mdTool.insertLink'), []);
  });

  test('lists the built-in bindings our keys shadow in Markdown (for review)', () => {
    for (const [command, key] of [
      ['mdTool.toggleBold', 'ctrl+b'],
      ['mdTool.toggleItalic', 'ctrl+i'],
    ]) {
      const others = sharing(
        process.platform === 'darwin' ? key.replace('ctrl', 'cmd') : key,
        command,
      );
      console.log(
        `  ${key}: ${others.map((b) => `${b.command} [${b.when ?? 'always'}]`).join('; ')}`,
      );
    }
  });
});
