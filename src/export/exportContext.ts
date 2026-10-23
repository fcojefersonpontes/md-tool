import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as vscode from 'vscode';
import { type FontConfig, getExportProfile } from '../config';
import { ABNT, type AbntOptions, DEFAULT_ABNT_OPTIONS } from '../core/abnt/profile';
import { type DocumentMeta, type PageOptions, parseMargin } from '../core/exportOptions';
import type { Heading, MarkdownEngine } from '../core/MarkdownEngine';
import { hasScheme, resolveDocumentPath, splitHref } from '../paths';

export interface ExportContext {
  document: vscode.TextDocument;
  /** Local file to write. */
  target: vscode.Uri;
  engine: MarkdownEngine;
  extensionUri: vscode.Uri;
  signal: AbortSignal;
}

/** The ABNT options when the front matter (`perfil: abnt`) or the settings choose that profile. */
export function abntOptions(
  document: vscode.TextDocument,
  meta: DocumentMeta,
): AbntOptions | undefined {
  const profile = meta.profile ?? getExportProfile(document.uri);
  return profile === 'abnt' ? { ...DEFAULT_ABNT_OPTIONS, ...meta.abnt } : undefined;
}

/** ABNT page: A4, portrait, margins 3 cm top and left, 2 cm bottom and right. */
export function abntPage(): PageOptions {
  const { margin } = ABNT.page;
  return { pageSize: ABNT.page.size, landscape: false, margin: parseMargin(margin, margin) };
}

/** ABNT type: 12 pt, Times New Roman (or the configured family, as ABNT allows Arial). */
export function abntFonts(config: FontConfig): FontConfig {
  return {
    fontFamily: config.fontFamily || ABNT.font.family.join(', '),
    codeFontFamily: config.codeFontFamily || ABNT.font.mono.join(', '),
    fontSize: ABNT.font.body,
  };
}

/** Thrown when the user cancels; the service reports nothing. */
export class ExportCancelledError extends Error {
  constructor() {
    super('Export cancelled');
  }
}

/** Document title: front-matter `title`, else the first H1, else the file name. */
export function documentTitle(
  document: vscode.TextDocument,
  headings: Heading[],
  metaTitle?: string,
): string {
  return (
    metaTitle ??
    headings.find((heading) => heading.level === 1)?.text ??
    path.basename(document.uri.path, path.extname(document.uri.path))
  );
}

/** Resolves a scheme-less resource written in the document to a local file URI. */
export function resolveLocalResource(
  document: vscode.Uri,
  src: string,
): { uri: vscode.Uri; suffix: string } | undefined {
  if (hasScheme(src)) return undefined;
  const { path: filePath, suffix } = splitHref(src);
  const uri = resolveDocumentPath(document, filePath);
  return uri ? { uri, suffix } : undefined;
}

/** `file://` URL usable by Chromium (drive letters are not percent-encoded). */
export function toFileUrl(uri: vscode.Uri): string {
  return pathToFileURL(uri.fsPath).href;
}
