import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

/** What the extension's `activate` returns (see src/extension.ts). */
interface ViewerRenderEvent {
  uri: vscode.Uri;
  kind: 'pdf' | 'rtf';
  pages?: number;
  error?: string;
}
interface MdToolApi {
  onDidRenderViewer: vscode.Event<ViewerRenderEvent>;
}

/** Compiled to out/integration, two levels below the repository root. */
const fixtures = path.resolve(__dirname, '../../test/fixtures');

suite('PDF / RTF viewer', () => {
  let api: MdToolApi;
  let dir: string;

  suiteSetup(async () => {
    api = await vscode.extensions.getExtension<MdToolApi>('JefersonPontes.md-tool')!.activate();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tool-viewer-'));
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  /** Opens `file` in its viewer and resolves with the first render report. */
  function open(file: string, timeout = 30_000): Promise<ViewerRenderEvent> {
    const uri = vscode.Uri.file(file);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${file} was not shown`)), timeout);
      const listener = api.onDidRenderViewer((event) => {
        if (event.uri.fsPath !== uri.fsPath) return;
        clearTimeout(timer);
        listener.dispose();
        resolve(event);
      });
      void vscode.commands.executeCommand('mdTool.openViewer', uri);
    });
  }

  function nextRender(file: string, timeout = 30_000): Promise<ViewerRenderEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${file} was not shown again`)), timeout);
      const listener = api.onDidRenderViewer((event) => {
        if (event.uri.fsPath !== vscode.Uri.file(file).fsPath) return;
        clearTimeout(timer);
        listener.dispose();
        resolve(event);
      });
    });
  }

  test('shows every page of a PDF', async () => {
    const file = path.join(dir, 'kitchen-sink.pdf');
    fs.copyFileSync(path.join(fixtures, 'kitchen-sink.pdf'), file);
    const event = await open(file);
    assert.strictEqual(event.error, undefined);
    assert.strictEqual(event.kind, 'pdf');
    assert.ok(event.pages && event.pages >= 2, `pages: ${event.pages}`);
  });

  test('shows an RTF file and follows changes to it', async () => {
    const file = path.join(dir, 'kitchen-sink.rtf');
    fs.copyFileSync(path.join(fixtures, 'kitchen-sink.rtf'), file);
    const event = await open(file);
    assert.strictEqual(event.error, undefined);
    assert.strictEqual(event.kind, 'rtf');

    const again = nextRender(file);
    fs.writeFileSync(file, '{\\rtf1\\ansi Changed\\par}');
    assert.strictEqual((await again).error, undefined);
  });

  test('reports a file that is not a PDF', async () => {
    const file = path.join(dir, 'broken.pdf');
    fs.writeFileSync(file, 'not a pdf');
    const event = await open(file);
    assert.ok(event.error, 'expected an error');
  });

  test('is an optional editor for .pdf and .rtf files', async () => {
    const packageJson = vscode.extensions.getExtension('JefersonPontes.md-tool')!.packageJSON as {
      contributes: { customEditors: { viewType: string; priority: string }[] };
    };
    const types = packageJson.contributes.customEditors.map((editor) => editor.viewType);
    assert.deepStrictEqual(types, ['mdTool.pdfViewer', 'mdTool.rtfViewer']);
    // "option": it does not replace the editor other extensions provide for these files.
    assert.ok(
      packageJson.contributes.customEditors.every((editor) => editor.priority === 'option'),
    );
  });
});
