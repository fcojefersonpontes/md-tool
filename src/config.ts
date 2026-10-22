import * as vscode from 'vscode';
import {
  type Margins,
  type PageOptions,
  type PdfOptions,
  parseMargin,
  parsePageSize,
} from './core/exportOptions';
import type { EngineOptions } from './core/MarkdownEngine';

const DEFAULT_MARGIN: Margins = { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' };

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

export const DEFAULT_FOOTER_TEMPLATE =
  '<div style="width:100%;font-family:sans-serif;font-size:9px;color:#666;text-align:center">' +
  '<span class="pageNumber"></span> / <span class="totalPages"></span></div>';

export interface ExportConfig {
  outputDir: string;
  askLocation: boolean;
  page: PageOptions;
}

export function getExportConfig(scope?: vscode.Uri): ExportConfig {
  const config = vscode.workspace.getConfiguration('mdTool.export', scope);
  const margin = parseMargin(config.get<string>('margin', '20mm'), DEFAULT_MARGIN);
  return {
    outputDir: config.get<string>('outputDir', '${fileDirname}') || '${fileDirname}',
    askLocation: config.get<boolean>('askLocation', false),
    page: {
      pageSize: parsePageSize(config.get<string>('pageSize')) ?? 'A4',
      landscape: config.get<boolean>('landscape', false),
      margin,
    },
  };
}

export interface PdfConfig {
  executablePath: string;
  options: PdfOptions;
}

export function getPdfConfig(scope?: vscode.Uri): PdfConfig {
  const config = vscode.workspace.getConfiguration('mdTool.pdf', scope);
  return {
    executablePath: config.get<string>('executablePath', ''),
    options: {
      ...getExportConfig(scope).page,
      headerTemplate: config.get<string>('headerTemplate', ''),
      footerTemplate: config.get<string>('footerTemplate', DEFAULT_FOOTER_TEMPLATE),
    },
  };
}

export interface RtfConfig {
  fontFamily: string;
  codeFontFamily: string;
  fontSize: number;
}

export function getRtfConfig(scope?: vscode.Uri): RtfConfig {
  const config = vscode.workspace.getConfiguration('mdTool.rtf', scope);
  const fontSize = config.get<number>('fontSize', 11);
  return {
    fontFamily: config.get<string>('fontFamily', 'Calibri') || 'Calibri',
    codeFontFamily: config.get<string>('codeFontFamily', 'Consolas') || 'Consolas',
    fontSize: fontSize > 0 && fontSize <= 72 ? fontSize : 11,
  };
}

export interface EditorConfig {
  listContinuation: boolean;
  formatTables: boolean;
}

export function getEditorConfig(scope?: vscode.Uri): EditorConfig {
  const config = vscode.workspace.getConfiguration('mdTool.editor', scope);
  return {
    listContinuation: config.get<boolean>('listContinuation', true),
    formatTables: config.get<boolean>('formatTables', true),
  };
}

export interface TocConfig {
  minLevel: number;
  maxLevel: number;
  updateOnSave: boolean;
}

export function getTocConfig(scope?: vscode.Uri): TocConfig {
  const config = vscode.workspace.getConfiguration('mdTool.toc', scope);
  const level = (key: string, fallback: number) => {
    const value = config.get<number>(key, fallback);
    return Number.isInteger(value) && value >= 1 && value <= 6 ? value : fallback;
  };
  const minLevel = level('minLevel', 2);
  return {
    minLevel,
    maxLevel: Math.max(minLevel, level('maxLevel', 3)),
    updateOnSave: config.get<boolean>('updateOnSave', true),
  };
}
