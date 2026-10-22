import * as vscode from 'vscode';
import type { ExportFormat } from './core/exportPath';
import { EditorFeatures } from './editor/EditorFeatures';
import { EngineProvider } from './engineProvider';
import { ExportService } from './export/ExportService';
import { PreviewManager } from './preview/PreviewManager';

export function activate(context: vscode.ExtensionContext): void {
  const engines = new EngineProvider();
  const previews = new PreviewManager(context.extensionUri, engines);
  const exporter = new ExportService(context.extensionUri, engines);
  context.subscriptions.push(new EditorFeatures(engines));

  /** Explorer / editor-title argument, else the active editor, else the focused preview. */
  const sourceDocument = (arg: unknown): vscode.Uri | undefined => {
    if (arg instanceof vscode.Uri) return arg;
    return vscode.window.activeTextEditor?.document.uri ?? previews.activeDocument();
  };

  const withSource = <T>(arg: unknown, run: (uri: vscode.Uri) => T): T | undefined => {
    const uri = sourceDocument(arg);
    if (uri) return run(uri);
    void vscode.window.showWarningMessage(vscode.l10n.t('Open a Markdown file first.'));
    return undefined;
  };

  const openPreview = (arg: unknown, toSide: boolean) =>
    withSource(arg, (uri) =>
      previews.show(uri, toSide ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active, toSide),
    );

  const exportAs = (arg: unknown, format: ExportFormat) =>
    withSource(arg, (uri) => exporter.export(uri, format));

  context.subscriptions.push(
    previews,
    vscode.commands.registerCommand('mdTool.openPreview', (uri?: vscode.Uri) =>
      openPreview(uri, false),
    ),
    vscode.commands.registerCommand('mdTool.openPreviewToSide', (uri?: vscode.Uri) =>
      openPreview(uri, true),
    ),
    vscode.commands.registerCommand('mdTool.exportPdf', (uri?: vscode.Uri) => exportAs(uri, 'pdf')),
    vscode.commands.registerCommand('mdTool.exportRtf', (uri?: vscode.Uri) => exportAs(uri, 'rtf')),
  );
}

export function deactivate(): void {}
