// Webview entry point. The preview renderer is implemented in Phase 1.
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

const vscode = acquireVsCodeApi();
vscode.postMessage({ type: 'ready' });
