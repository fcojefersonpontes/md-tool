import * as vscode from 'vscode';
import { getEngineOptions } from '../config';
import { MarkdownEngine } from '../core/MarkdownEngine';
import type { PreviewState } from '../../webview/messages';
import { PreviewPanel, previewTitle, type PreviewHost } from './PreviewPanel';

export const PREVIEW_VIEW_TYPE = 'mdTool.preview';

/** Owns every open preview and routes editor / configuration events to them. */
export class PreviewManager
  implements PreviewHost, vscode.WebviewPanelSerializer<PreviewState>, vscode.Disposable
{
  private readonly panels = new Set<PreviewPanel>();
  private readonly disposables: vscode.Disposable[] = [];
  private engine: { key: string; engine: Promise<MarkdownEngine> } | undefined;

  constructor(readonly extensionUri: vscode.Uri) {
    this.disposables.push(
      vscode.window.registerWebviewPanelSerializer(PREVIEW_VIEW_TYPE, this),
      vscode.workspace.onDidChangeTextDocument((event) => {
        for (const panel of this.panelsFor(event.document.uri)) panel.scheduleUpdate();
      }),
      vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
        for (const panel of this.panelsFor(event.textEditor.document.uri)) {
          panel.onEditorScrolled(event.textEditor);
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('mdTool')) this.reloadAll();
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.reloadAll()),
    );
  }

  show(uri: vscode.Uri, viewColumn: vscode.ViewColumn, preserveFocus: boolean): void {
    const existing = this.panelsFor(uri)[0];
    if (existing) {
      existing.reveal(viewColumn, preserveFocus);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      PREVIEW_VIEW_TYPE,
      previewTitle(uri),
      { viewColumn, preserveFocus },
      { enableScripts: true, enableFindWidget: true },
    );
    this.panels.add(new PreviewPanel(panel, uri, this));
  }

  async deserializeWebviewPanel(panel: vscode.WebviewPanel, state?: PreviewState): Promise<void> {
    if (!state?.uri) {
      panel.dispose();
      return;
    }
    this.panels.add(new PreviewPanel(panel, vscode.Uri.parse(state.uri), this));
  }

  getEngine(scope: vscode.Uri): Promise<MarkdownEngine> {
    const options = getEngineOptions(scope);
    const key = JSON.stringify(options);
    if (this.engine?.key !== key) this.engine = { key, engine: MarkdownEngine.create(options) };
    return this.engine.engine;
  }

  onPanelDisposed(panel: PreviewPanel): void {
    this.panels.delete(panel);
  }

  dispose(): void {
    for (const panel of [...this.panels]) panel.dispose();
    vscode.Disposable.from(...this.disposables).dispose();
  }

  private panelsFor(uri: vscode.Uri): PreviewPanel[] {
    return [...this.panels].filter((panel) => panel.isFor(uri));
  }

  private reloadAll(): void {
    this.engine = undefined;
    for (const panel of this.panels) panel.reload();
  }
}
