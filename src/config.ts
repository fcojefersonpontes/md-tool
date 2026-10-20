import * as vscode from 'vscode';
import type { EngineOptions } from './core/MarkdownEngine';

export type PreviewTheme = 'auto' | 'light' | 'dark';

export interface PreviewConfig {
  theme: PreviewTheme;
  customCss: string[];
  scrollSync: boolean;
}

export function getPreviewConfig(scope?: vscode.Uri): PreviewConfig {
  const config = vscode.workspace.getConfiguration('mdTool.preview', scope);
  return {
    theme: config.get<PreviewTheme>('theme', 'auto'),
    // Custom stylesheets are workspace content: only honoured in trusted workspaces.
    customCss: vscode.workspace.isTrusted ? config.get<string[]>('customCss', []) : [],
    scrollSync: config.get<boolean>('scrollSync', true),
  };
}

export function getEngineOptions(scope?: vscode.Uri): EngineOptions {
  const config = vscode.workspace.getConfiguration('mdTool.markdown', scope);
  return {
    allowHtml: vscode.workspace.isTrusted && config.get<boolean>('allowHtml', false),
    math: config.get<boolean>('math', true),
    mermaid: config.get<boolean>('mermaid', true),
  };
}
