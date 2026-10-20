import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as vscode from 'vscode';
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
