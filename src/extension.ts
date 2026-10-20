import * as vscode from 'vscode';
import { PreviewManager } from './preview/PreviewManager';

export function activate(context: vscode.ExtensionContext): void {
  const previews = new PreviewManager(context.extensionUri);

  const openPreview = (uri: unknown, toSide: boolean) => {
    const target = uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor?.document.uri;
    if (!target) {
      void vscode.window.showWarningMessage(vscode.l10n.t('Open a Markdown file to preview it.'));
      return;
    }
    previews.show(target, toSide ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active, toSide);
  };

  context.subscriptions.push(
    previews,
    vscode.commands.registerCommand('mdTool.openPreview', (uri?: vscode.Uri) =>
      openPreview(uri, false),
    ),
    vscode.commands.registerCommand('mdTool.openPreviewToSide', (uri?: vscode.Uri) =>
      openPreview(uri, true),
    ),
  );
}

export function deactivate(): void {}
