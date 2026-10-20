import * as path from 'node:path';
import * as vscode from 'vscode';
import { getPreviewConfig } from '../config';
import { escapeHtml } from '../core/html';
import type { MarkdownEngine } from '../core/MarkdownEngine';
import { toggleTaskLine } from '../core/taskList';
import { hasScheme, resolveDocumentPath, safeDecode, splitHref } from '../paths';
import type { HostMessage, WebviewMessage } from '../../webview/messages';

/** Delay between the last keystroke and the preview re-render. */
const UPDATE_DELAY_MS = 150;
/** Ignore editor scroll events this long after the preview scrolled the editor. */
const SCROLL_ECHO_MS = 150;

export interface PreviewHost {
  readonly extensionUri: vscode.Uri;
  getEngine(scope: vscode.Uri): Promise<MarkdownEngine>;
  onPanelDisposed(panel: PreviewPanel): void;
}

/** One preview webview bound to a single Markdown document. */
export class PreviewPanel implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private updateTimer: ReturnType<typeof setTimeout> | undefined;
  private updateVersion = 0;
  private ignoreEditorScrollUntil = 0;
  private disposed = false;

  constructor(
    readonly panel: vscode.WebviewPanel,
    readonly uri: vscode.Uri,
    private readonly host: PreviewHost,
  ) {
    panel.title = previewTitle(uri);
    this.disposables.push(
      panel.webview.onDidReceiveMessage((message: WebviewMessage) => this.onMessage(message)),
      panel.onDidDispose(() => this.dispose()),
    );
    this.reload();
  }

  isFor(uri: vscode.Uri): boolean {
    return this.uri.toString() === uri.toString();
  }

  reveal(viewColumn: vscode.ViewColumn, preserveFocus: boolean): void {
    this.panel.reveal(viewColumn, preserveFocus);
  }

  /** Rebuilds the webview shell (theme, stylesheets, resource roots). The webview then asks for content. */
  reload(): void {
    const config = getPreviewConfig(this.uri);
    const customCss = config.customCss
      .map((href) => this.resolveStylesheet(href))
      .filter((uri): uri is vscode.Uri => uri !== undefined);

    this.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: this.resourceRoots(customCss),
    };
    this.panel.webview.html = this.buildHtml(config.theme, config.scrollSync, customCss);
  }

  scheduleUpdate(): void {
    clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(() => void this.update(), UPDATE_DELAY_MS);
  }

  onEditorScrolled(editor: vscode.TextEditor): void {
    if (Date.now() < this.ignoreEditorScrollUntil || !getPreviewConfig(this.uri).scrollSync) return;
    const line = editor.visibleRanges[0]?.start.line;
    if (line !== undefined) this.post({ type: 'scrollTo', line });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.updateTimer);
    this.panel.dispose();
    vscode.Disposable.from(...this.disposables).dispose();
    this.host.onPanelDisposed(this);
  }

  // ------------------------------------------------------------ rendering

  private async update(): Promise<void> {
    const version = ++this.updateVersion;
    let html: string;
    try {
      const document = await vscode.workspace.openTextDocument(this.uri);
      const engine = await this.host.getEngine(this.uri);
      html = engine.render(document.getText(), {
        resolveResource: (src) => this.resolveResource(src),
      }).html;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const text = vscode.l10n.t('Could not render {0}: {1}', this.uri.fsPath, message);
      html = `<p class="md-tool-error">${escapeHtml(text)}</p>`;
    }
    if (version === this.updateVersion) this.post({ type: 'update', html });
  }

  private buildHtml(theme: string, scrollSync: boolean, customCss: vscode.Uri[]): string {
    const webview = this.panel.webview;
    const nonce = createNonce();
    const asset = (...segments: string[]) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.host.extensionUri, ...segments)).toString();
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    const userStyles = customCss
      .map(
        (uri) =>
          `<link rel="stylesheet" href="${escapeHtml(webview.asWebviewUri(uri).toString())}">`,
      )
      .join('\n    ');

    return `<!DOCTYPE html>
<html lang="${escapeHtml(vscode.env.language)}" data-theme="${escapeHtml(theme)}">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="${asset('dist', 'webview', 'katex', 'katex.min.css')}">
    <link rel="stylesheet" href="${asset('media', 'preview.css')}">
    ${userStyles}
  </head>
  <body>
    <div id="md-tool-settings" hidden
      data-uri="${escapeHtml(this.uri.toString())}"
      data-scroll-sync="${scrollSync}"
      data-mermaid-src="${asset('dist', 'webview', 'mermaid.min.js')}"></div>
    <main id="md-tool-content" class="markdown-body"></main>
    <script nonce="${nonce}" src="${asset('dist', 'webview', 'preview.js')}"></script>
  </body>
</html>`;
  }

  private resourceRoots(customCss: vscode.Uri[]): vscode.Uri[] {
    const roots = [
      vscode.Uri.joinPath(this.host.extensionUri, 'media'),
      vscode.Uri.joinPath(this.host.extensionUri, 'dist'),
      ...(vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri),
      ...customCss.map((uri) => vscode.Uri.joinPath(uri, '..')),
    ];
    if (this.uri.scheme !== 'untitled') roots.push(vscode.Uri.joinPath(this.uri, '..'));
    return roots;
  }

  private resolveResource(src: string): string {
    if (hasScheme(src)) return src;
    const { path: filePath, suffix } = splitHref(src);
    const target = resolveDocumentPath(this.uri, filePath);
    return target ? this.panel.webview.asWebviewUri(target).toString() + suffix : src;
  }

  private resolveStylesheet(href: string): vscode.Uri | undefined {
    if (path.isAbsolute(href)) return vscode.Uri.file(href);
    const folder = vscode.workspace.getWorkspaceFolder(this.uri);
    return folder ? vscode.Uri.joinPath(folder.uri, href) : resolveDocumentPath(this.uri, href);
  }

  // ------------------------------------------------------------- messages

  private post(message: HostMessage): void {
    if (!this.disposed) void this.panel.webview.postMessage(message);
  }

  private async onMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        return this.update();
      case 'revealLine':
        return this.revealInEditors(message.line);
      case 'openLink':
        return this.openLink(message.href);
      case 'toggleTask':
        return this.toggleTask(message.line);
    }
  }

  private revealInEditors(line: number): void {
    if (!getPreviewConfig(this.uri).scrollSync) return;
    for (const editor of this.sourceEditors()) {
      this.ignoreEditorScrollUntil = Date.now() + SCROLL_ECHO_MS;
      const position = new vscode.Position(line, 0);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.AtTop);
    }
  }

  private async openLink(href: string): Promise<void> {
    if (hasScheme(href)) {
      const target = vscode.Uri.parse(href);
      if (['http', 'https', 'mailto'].includes(target.scheme)) {
        await vscode.env.openExternal(target);
      } else if (target.scheme === 'file') {
        await vscode.commands.executeCommand('vscode.open', target, this.sourceColumn());
      }
      return;
    }

    const { path: filePath, suffix } = splitHref(href);
    const target = filePath ? resolveDocumentPath(this.uri, filePath) : this.uri;
    if (!target) return;
    const fragment = suffix.startsWith('#') ? safeDecode(suffix.slice(1)) : '';

    if (!/\.(md|markdown)$/i.test(target.path)) {
      await vscode.commands.executeCommand('vscode.open', target, this.sourceColumn());
      return;
    }
    const document = await vscode.workspace.openTextDocument(target);
    let selection: vscode.Range | undefined;
    if (fragment) {
      const engine = await this.host.getEngine(target);
      const heading = engine.render(document.getText()).headings.find((h) => h.slug === fragment);
      if (heading) selection = new vscode.Range(heading.line, 0, heading.line, 0);
    }
    await vscode.window.showTextDocument(document, { viewColumn: this.sourceColumn(), selection });
  }

  private async toggleTask(line: number): Promise<void> {
    const document = await vscode.workspace.openTextDocument(this.uri);
    if (line < 0 || line >= document.lineCount) return;
    const { text, range } = document.lineAt(line);
    const toggled = toggleTaskLine(text);
    if (toggled === undefined) return;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(this.uri, range, toggled);
    await vscode.workspace.applyEdit(edit);
  }

  private sourceEditors(): vscode.TextEditor[] {
    return vscode.window.visibleTextEditors.filter((editor) => this.isFor(editor.document.uri));
  }

  /** Column of the source editor, so links open next to it rather than over the preview. */
  private sourceColumn(): vscode.ViewColumn {
    return this.sourceEditors()[0]?.viewColumn ?? vscode.ViewColumn.Active;
  }
}

export function previewTitle(uri: vscode.Uri): string {
  return vscode.l10n.t('Preview {0}', path.posix.basename(uri.path));
}

function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64');
}
