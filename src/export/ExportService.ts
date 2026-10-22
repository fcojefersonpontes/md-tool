import * as path from 'node:path';
import * as vscode from 'vscode';
import { getExportConfig } from '../config';
import { type ExportFormat, resolveExportPath } from '../core/exportPath';
import type { ExportWarning } from '../core/exportAssets';
import type { EngineProvider } from '../engineProvider';
import { VIEWER_TYPES } from '../viewer/DocumentViewer';
import { ExportCancelledError, type ExportContext } from './exportContext';
import { exportPdf } from './pdfExport';
import { exportRtf } from './rtfExport';

/** Runs an export with progress, cancellation and result notifications. */
export class ExportService {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly engines: EngineProvider,
    /** Details of failed exports, for bug reports. */
    private readonly log: vscode.LogOutputChannel,
  ) {}

  /** Exports `source` and returns the written file, or `undefined` if cancelled / failed. */
  async export(source: vscode.Uri, format: ExportFormat): Promise<vscode.Uri | undefined> {
    const document = await vscode.workspace.openTextDocument(source);
    const target = await this.chooseTarget(document, format);
    if (!target) return undefined;

    const name = path.basename(target.fsPath);
    const controller = new AbortController();
    try {
      const warnings = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: vscode.l10n.t('Exporting {0}…', name),
          cancellable: true,
        },
        async (_progress, token) => {
          token.onCancellationRequested(() => controller.abort(new ExportCancelledError()));
          const context: ExportContext = {
            document,
            target,
            engine: await this.engines.get(document.uri),
            extensionUri: this.extensionUri,
            signal: controller.signal,
          };
          const result = await (format === 'pdf' ? exportPdf(context) : exportRtf(context));
          controller.signal.throwIfAborted();
          return result;
        },
      );
      // Not awaited: the notification stays until the user dismisses it.
      void this.notifyDone(target, format, warnings);
      return target;
    } catch (error) {
      if (!controller.signal.aborted) {
        this.log.error(`Exporting ${document.uri.toString()} to ${format}:`, error);
        void this.notifyError(error);
      }
      return undefined;
    }
  }

  private async chooseTarget(
    document: vscode.TextDocument,
    format: ExportFormat,
  ): Promise<vscode.Uri | undefined> {
    const config = getExportConfig(document.uri);
    const folder = (
      vscode.workspace.getWorkspaceFolder(document.uri) ?? vscode.workspace.workspaceFolders?.[0]
    )?.uri.fsPath;
    const isFile = document.uri.scheme === 'file';

    let defaultPath: string | undefined;
    if (isFile) {
      defaultPath = resolveExportPath(document.uri.fsPath, format, config.outputDir, folder);
    } else if (folder) {
      defaultPath = path.join(folder, `${path.basename(document.uri.path)}.${format}`);
    }

    if (config.askLocation || !isFile || !defaultPath) {
      return vscode.window.showSaveDialog({
        defaultUri: defaultPath ? vscode.Uri.file(defaultPath) : undefined,
        filters: { [format.toUpperCase()]: [format] },
      });
    }
    const target = vscode.Uri.file(defaultPath);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'));
    return target;
  }

  private async notifyDone(
    target: vscode.Uri,
    format: ExportFormat,
    warnings: ExportWarning[],
  ): Promise<void> {
    const preview = vscode.l10n.t('Preview');
    const open = vscode.l10n.t('Open');
    const reveal = vscode.l10n.t('Show in Folder');
    const name = path.basename(target.fsPath);
    const message = warnings.length
      ? vscode.l10n.t('Exported {0}. {1}', name, warnings.map(describeWarning).join(' '))
      : vscode.l10n.t('Exported {0}.', name);
    const choice = await (warnings.length
      ? vscode.window.showWarningMessage(message, preview, open, reveal)
      : vscode.window.showInformationMessage(message, preview, open, reveal));
    if (choice === preview) {
      await vscode.commands.executeCommand('vscode.openWith', target, VIEWER_TYPES[format], {
        viewColumn: vscode.ViewColumn.Beside,
      });
    } else if (choice === open) await vscode.env.openExternal(target);
    else if (choice === reveal) await vscode.commands.executeCommand('revealFileInOS', target);
  }

  private async notifyError(error: unknown): Promise<void> {
    if (error instanceof ExportCancelledError) return;
    const message = error instanceof Error ? error.message : String(error);
    const details = vscode.l10n.t('Show Details');
    const choice = await vscode.window.showErrorMessage(
      vscode.l10n.t('Export failed: {0}', message),
      details,
    );
    if (choice === details) this.log.show();
  }
}

function describeWarning(warning: ExportWarning): string {
  switch (warning) {
    case 'mermaid':
      return vscode.l10n.t(
        'Some Mermaid diagrams were exported as code (invalid or could not be drawn).',
      );
    case 'math':
      return vscode.l10n.t('Some formulas were exported as TeX source (invalid formula).');
    case 'html':
      return vscode.l10n.t('Raw HTML was omitted.');
    case 'image':
      return vscode.l10n.t(
        'Some images could not be embedded and were replaced by their alt text.',
      );
  }
}
