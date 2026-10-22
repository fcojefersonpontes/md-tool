import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ViewerHostMessage, ViewerWebviewMessage } from '../../webview/messages';
import { rtfToHtml } from '../core/rtf/RtfReader';

export type ViewerKind = 'pdf' | 'rtf';

export const VIEWER_TYPES: Record<ViewerKind, string> = {
  pdf: 'mdTool.pdfViewer',
  rtf: 'mdTool.rtfViewer',
};

/** Reported when a viewer finishes showing a file (used by the integration tests). */
export interface ViewerRenderEvent {
  uri: vscode.Uri;
  kind: ViewerKind;
  pages?: number;
  error?: string;
}

/** How long a file must stay unchanged before it is shown again. */
const RELOAD_DELAY_MS = 300;

/**
 * A simple read-only viewer for exported PDF and RTF files, to check them
 * without leaving VS Code. It follows changes to the file, so it can stay
 * open beside the Markdown while exporting again.
 */
export class DocumentViewerProvider implements vscode.CustomReadonlyEditorProvider {
  private readonly rendered = new vscode.EventEmitter<ViewerRenderEvent>();
  readonly onDidRender = this.rendered.event;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  /** Registers the PDF and RTF viewers. */
  register(): vscode.Disposable {
    const options = {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true,
    };
    return vscode.Disposable.from(
      this.rendered,
      vscode.window.registerCustomEditorProvider(VIEWER_TYPES.pdf, this, options),
      vscode.window.registerCustomEditorProvider(VIEWER_TYPES.rtf, this, options),
    );
  }

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => undefined };
  }

  resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): void {
    const kind: ViewerKind = panel.viewType === VIEWER_TYPES.pdf ? 'pdf' : 'rtf';
    const { uri } = document;
    const webviewRoot = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [webviewRoot, vscode.Uri.joinPath(this.extensionUri, 'media')],
    };

    let ready = false;
    const send = async () => {
      if (!ready) return;
      let message: ViewerHostMessage;
      try {
        const data = await vscode.workspace.fs.readFile(uri);
        message =
          kind === 'pdf'
            ? // A plain Uint8Array (not a Node Buffer), so it reaches the webview as binary.
              { type: 'pdf', data: new Uint8Array(data) }
            : { type: 'rtf', document: rtfToHtml(data) };
      } catch (error) {
        this.log.error(`Viewing ${uri.toString()}:`, error);
        message = {
          type: 'error',
          message: vscode.l10n.t(
            'Could not read {0}: {1}',
            path.basename(uri.path),
            error instanceof Error ? error.message : String(error),
          ),
        };
      }
      void panel.webview.postMessage(message);
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const reload = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void send(), RELOAD_DELAY_MS);
    };
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.joinPath(uri, '..'), path.posix.basename(uri.path)),
    );

    const disposables: vscode.Disposable[] = [
      watcher,
      watcher.onDidChange(reload),
      watcher.onDidCreate(reload),
      panel.webview.onDidReceiveMessage((message: ViewerWebviewMessage) => {
        switch (message.type) {
          case 'ready':
            ready = true;
            void send();
            break;
          case 'openLink':
            void this.openLink(uri, message.href);
            break;
          case 'rendered':
            this.rendered.fire({ uri, kind, pages: message.pages });
            break;
          case 'failed':
            this.log.warn(`Viewing ${uri.toString()}: ${message.error}`);
            this.rendered.fire({ uri, kind, error: message.error });
            break;
        }
      }),
    ];
    panel.onDidDispose(() => {
      clearTimeout(timer);
      disposables.forEach((disposable) => disposable.dispose());
    });
    panel.webview.html = this.html(panel.webview, kind, webviewRoot);
  }

  /** Web and mail links open outside; relative links open the file in VS Code. */
  private async openLink(source: vscode.Uri, href: string): Promise<void> {
    if (/^(https?|mailto):/i.test(href)) {
      await vscode.env.openExternal(vscode.Uri.parse(href, true));
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return; // other schemes: not opened from a document
    const file = decodeURIComponent(href.replace(/[?#].*$/, ''));
    if (!file) return;
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.joinPath(source, '..', file));
  }

  private html(webview: vscode.Webview, kind: ViewerKind, root: vscode.Uri): string {
    const nonce = randomBytes(16).toString('base64');
    const asset = (name: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(root, name)).toString();
    const style = webview
      .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'viewer.css'))
      .toString();
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data: blob:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource} data: blob:`,
      `script-src 'nonce-${nonce}'`,
      // pdf.js: the worker script is fetched and started from a blob: URL.
      ...(kind === 'pdf' ? [`connect-src ${webview.cspSource}`, 'worker-src blob:'] : []),
    ].join('; ');
    const t = vscode.l10n.t;
    return `<!DOCTYPE html>
<html lang="${vscode.env.language}">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="${style}">
  </head>
  <body data-worker="${asset('pdf.worker.mjs')}">
    <div class="toolbar">
      <button id="zoom-out" title="${t('Zoom Out')}" aria-label="${t('Zoom Out')}">−</button>
      <span id="zoom" class="zoom">100%</span>
      <button id="zoom-in" title="${t('Zoom In')}" aria-label="${t('Zoom In')}">+</button>
      <button id="fit" title="${t('Fit Width')}">${t('Fit Width')}</button>
      <span class="spacer"></span>
      <span id="pages" class="pages"></span>
    </div>
    <div id="scroller" class="scroller"><div id="pages-host" class="pages-host"></div></div>
    <script nonce="${nonce}" src="${asset(`${kind}Viewer.js`)}"></script>
  </body>
</html>`;
  }
}
