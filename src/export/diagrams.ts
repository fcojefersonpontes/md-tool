import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { DiagramHostMessage, DiagramWebviewMessage } from '../../webview/messages';
import { ExportCancelledError } from './exportContext';

/** How long the whole batch may take before the remaining diagrams fall back to code. */
const TIMEOUT_MS = 60_000;

/** A drawn diagram; `png` when it has emoji, drawn in color by the webview. */
export interface Diagram {
  svg: string;
  png?: Uint8Array;
}

/**
 * Draws Mermaid diagrams to SVG in a temporary VS Code webview (VS Code's own
 * renderer: no external browser). Diagrams that fail are missing from the result.
 */
export async function renderDiagrams(
  extensionUri: vscode.Uri,
  sources: string[],
  signal: AbortSignal,
): Promise<Map<string, Diagram>> {
  const results = new Map<string, Diagram>();
  const unique = [...new Set(sources)];
  if (unique.length === 0) return results;
  signal.throwIfAborted();

  const webviewRoot = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
  const panel = vscode.window.createWebviewPanel(
    'mdTool.diagrams',
    vscode.l10n.t('Drawing diagrams…'),
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { enableScripts: true, localResourceRoots: [webviewRoot] },
  );

  try {
    await new Promise<void>((resolve, reject) => {
      let pending = unique.length;
      const finish = (error?: Error) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        disposables.forEach((disposable) => disposable.dispose());
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(() => finish(), TIMEOUT_MS); // keep what was drawn so far
      const onAbort = () => finish(new ExportCancelledError());
      signal.addEventListener('abort', onAbort);
      const disposables = [
        panel.onDidDispose(() => finish()),
        panel.webview.onDidReceiveMessage((message: DiagramWebviewMessage) => {
          if (message.type === 'ready') {
            unique.forEach((source, id) => {
              const request: DiagramHostMessage = { type: 'render', id, source };
              void panel.webview.postMessage(request);
            });
            return;
          }
          if (message.type === 'rendered') {
            results.set(unique[message.id], {
              svg: message.svg,
              png: message.png ? Buffer.from(message.png, 'base64') : undefined,
            });
          }
          // id -1: Mermaid itself failed to load, nothing more will come.
          if (message.type === 'failed' && message.id < 0) finish();
          else if (--pending === 0) finish();
        }),
      ];
      panel.webview.html = diagramHtml(panel.webview, webviewRoot);
    });
  } finally {
    panel.dispose();
  }
  return results;
}

function diagramHtml(webview: vscode.Webview, root: vscode.Uri): string {
  const nonce = randomBytes(16).toString('base64');
  const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(root, name)).toString();
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <style>body { background: #fff; color: #1f2328; font-family: sans-serif; }</style>
  </head>
  <body>
    <div id="host"></div>
    <script nonce="${nonce}" src="${asset('mermaid.min.js')}"></script>
    <script nonce="${nonce}" src="${asset('diagrams.js')}"></script>
  </body>
</html>`;
}
