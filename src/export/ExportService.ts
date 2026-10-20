import * as path from 'node:path';
import * as vscode from 'vscode';
import { getExportConfig } from '../config';
import { type ExportFormat, resolveExportPath } from '../core/exportPath';
import type { RtfWarning } from '../core/rtf/RtfRenderer';
import type { EngineProvider } from '../engineProvider';
import { ExportCancelledError, type ExportContext } from './exportContext';
import { BrowserNotFoundError, exportPdf } from './pdfExport';
import { exportRtf } from './rtfExport';

/** Runs an export with progress, cancellation and result notifications. */
export class ExportService {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly engines: EngineProvider,
  ) {}

  /** Exports `source` and returns the written file, or `undefined` if cancelled / failed. */
  async export(source: vscode.Uri, format: ExportFormat): Promise<vscode.Uri | undefined> {
    const document = await vscode.workspace.openTextDocument(source);
    const target = await this.chooseTarget(document, format);
    if (!target) return undefined;

    const name = path.basename(target.fsPath);
    try {
      const warnings = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: vscode.l10n.t('Exporting {0}…', name),
          cancellable: true,
        },
        async (_progress, token) => {
          const controller = new AbortController();
          token.onCancellationRequested(() => controller.abort());
          const context: ExportContext = {
            document,
            target,
            engine: await this.engines.get(document.uri),
            extensionUri: this.extensionUri,
            signal: controller.signal,
          };
          if (format === 'pdf') {
            await exportPdf(context);
            return [];
          }
          const result = await exportRtf(context);
          if (controller.signal.aborted) throw new ExportCancelledError();
          return result;
        },
      );
      // Not awaited: the notification stays until the user dismisses it.
      void this.notifyDone(target, warnings);
      return target;
    } catch (error) {
      void this.notifyError(error);
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

  private async notifyDone(target: vscode.Uri, warnings: RtfWarning[]): Promise<void> {
    const open = vscode.l10n.t('Open');
    const reveal = vscode.l10n.t('Show in Folder');
    const name = path.basename(target.fsPath);
    const message = warnings.length
      ? vscode.l10n.t('Exported {0}. {1}', name, warnings.map(describeWarning).join(' '))
      : vscode.l10n.t('Exported {0}.', name);
    const choice = await (warnings.length
      ? vscode.window.showWarningMessage(message, open, reveal)
      : vscode.window.showInformationMessage(message, open, reveal));
    if (choice === open) await vscode.env.openExternal(target);
    else if (choice === reveal) await vscode.commands.executeCommand('revealFileInOS', target);
  }

  private async notifyError(error: unknown): Promise<void> {
    if (error instanceof ExportCancelledError) return;
    if (error instanceof BrowserNotFoundError) {
      const configure = vscode.l10n.t('Configure Browser Path');
      const choice = await vscode.window.showErrorMessage(
        vscode.l10n.t(
          'PDF export needs Google Chrome, Microsoft Edge or Chromium. Install one or set "mdTool.pdf.executablePath".',
        ),
        configure,
      );
      if (choice === configure) {
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'mdTool.pdf.executablePath',
        );
      }
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(vscode.l10n.t('Export failed: {0}', message));
  }
}

function describeWarning(warning: RtfWarning): string {
  switch (warning) {
    case 'mermaid':
      return vscode.l10n.t(
        'Some Mermaid diagrams were exported as code (no browser found, or the diagram is invalid).',
      );
    case 'math':
      return vscode.l10n.t(
        'Some formulas were exported as TeX source (no browser found, or the formula is invalid).',
      );
    case 'html':
      return vscode.l10n.t('Raw HTML was omitted.');
    case 'image':
      return vscode.l10n.t(
        'Some images could not be embedded and were replaced by their alt text.',
      );
  }
}
