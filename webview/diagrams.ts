/// <reference lib="dom" />
// Runs in the temporary webview the exporters open to draw Mermaid diagrams.
import {
  EXPORT_MERMAID_CONFIG,
  emojiPng,
  type MermaidApi,
  renderExportDiagram,
} from './diagram';
import type { DiagramHostMessage, DiagramWebviewMessage } from './messages';

declare function acquireVsCodeApi(): { postMessage(message: DiagramWebviewMessage): void };

const vscode = acquireVsCodeApi();
const host = document.getElementById('host')!;
const mermaid = (window as unknown as { mermaid?: MermaidApi }).mermaid;

let queue = Promise.resolve();

window.addEventListener('message', (event: MessageEvent<DiagramHostMessage>) => {
  const message = event.data;
  if (message.type !== 'render' || !mermaid) return;
  // One at a time: Mermaid renders into the shared document.
  queue = queue.then(async () => {
    try {
      const svg = await renderExportDiagram(
        mermaid,
        `md-tool-d${message.id}`,
        message.source,
        host,
      );
      const png = await emojiPng(svg).catch(() => undefined);
      vscode.postMessage({ type: 'rendered', id: message.id, svg, png });
    } catch (error) {
      document.getElementById(`dmd-tool-d${message.id}`)?.remove();
      vscode.postMessage({
        type: 'failed',
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
});

if (mermaid) {
  mermaid.initialize(EXPORT_MERMAID_CONFIG);
  vscode.postMessage({ type: 'ready' });
} else {
  vscode.postMessage({ type: 'failed', id: -1, error: 'Mermaid did not load' });
}
