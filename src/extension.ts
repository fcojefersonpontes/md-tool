import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('mdTool.hello', () => {
      void vscode.window.showInformationMessage('md-tool está ativo.');
    }),
  );
}

export function deactivate(): void {}
