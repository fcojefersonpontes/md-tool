import * as vscode from 'vscode';
import { type ExportProfile, parseProfile } from './core/abnt/profile';
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

export const DEFAULT_FOOTER = '{page} / {pages}';

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

export function getPdfOptions(scope?: vscode.Uri): PdfOptions {
  const config = vscode.workspace.getConfiguration('mdTool.pdf', scope);
  return {
    ...getExportConfig(scope).page,
    header: config.get<string>('header', ''),
    footer: config.get<string>('footer', DEFAULT_FOOTER),
  };
}

/** `mdTool.export.profile`: the layout of exported documents unless their front matter picks one. */
export function getExportProfile(scope?: vscode.Uri): ExportProfile {
  const config = vscode.workspace.getConfiguration('mdTool.export', scope);
  return parseProfile(config.get<string>('profile')) ?? 'default';
}

export interface FontConfig {
  /** Empty: the platform's default family. */
  fontFamily: string;
  codeFontFamily: string;
  /** Body size in points; `undefined` sizes the text like the preview (`previewFontSize`). */
  fontSize: number | undefined;
}

/** Fonts for both exporters (PDF and RTF). */
export function getFontConfig(scope?: vscode.Uri): FontConfig {
  const config = vscode.workspace.getConfiguration('mdTool.export', scope);
  const fontSize = config.get<number | null>('fontSize', null);
  return {
    fontFamily: config.get<string>('fontFamily', '').trim(),
    codeFontFamily: config.get<string>('codeFontFamily', '').trim(),
    fontSize: typeof fontSize === 'number' && fontSize > 0 && fontSize <= 72 ? fontSize : undefined,
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
