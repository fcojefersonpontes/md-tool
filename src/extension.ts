import * as vscode from 'vscode';
import type { ExportFormat } from './core/exportPath';
import { EditorFeatures } from './editor/EditorFeatures';
import { EngineProvider } from './engineProvider';
import { ExportService } from './export/ExportService';
import { PreviewManager } from './preview/PreviewManager';
import {
  DocumentViewerProvider,
  VIEWER_TYPES,
  type ViewerRenderEvent,
} from './viewer/DocumentViewer';

/** Returned by `activate`; only the integration tests use it. */
export interface MdToolApi {
  onDidRenderViewer: vscode.Event<ViewerRenderEvent>;
}

export function activate(context: vscode.ExtensionContext): MdToolApi {
  const log = vscode.window.createOutputChannel('MD tool', { log: true });
  const engines = new EngineProvider();
  const previews = new PreviewManager(context.extensionUri, engines);
  const exporter = new ExportService(context.extensionUri, engines, log);
  const viewer = new DocumentViewerProvider(context.extensionUri, log);
  context.subscriptions.push(log, new EditorFeatures(engines), viewer.register());

  /**
   * Explorer / editor-title argument, else the active editor, else the focused preview.
   * The preview's own title buttons pass the panel's `webview-panel:` URI, which is not a document.
   */
  const sourceDocument = (arg: unknown): vscode.Uri | undefined => {
    if (arg instanceof vscode.Uri && arg.scheme !== 'webview-panel') return arg;
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
    // Back from a preview opened in place: the Markdown in the same editor group.
    vscode.commands.registerCommand('mdTool.showSource', (uri?: vscode.Uri) =>
      withSource(uri, (source) =>
        vscode.window.showTextDocument(source, { viewColumn: vscode.ViewColumn.Active }),
      ),
    ),
    vscode.commands.registerCommand('mdTool.exportPdf', (uri?: vscode.Uri) => exportAs(uri, 'pdf')),
    vscode.commands.registerCommand('mdTool.exportRtf', (uri?: vscode.Uri) => exportAs(uri, 'rtf')),
    vscode.commands.registerCommand('mdTool.openViewer', async (uri?: vscode.Uri) => {
      const target = uri ?? (await pickDocument());
      if (!target) return;
      const kind = /.pdf$/i.test(target.path) ? 'pdf' : 'rtf';
      await vscode.commands.executeCommand('vscode.openWith', target, VIEWER_TYPES[kind]);
    }),
  );
  return { onDidRenderViewer: viewer.onDidRender };
}

async function pickDocument(): Promise<vscode.Uri | undefined> {
  const [uri] =
    (await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { [vscode.l10n.t('Documents')]: ['pdf', 'rtf'] },
    })) ?? [];
  return uri;
}

export function deactivate(): void {}
