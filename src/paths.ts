import * as nodePath from 'node:path';
import * as vscode from 'vscode';

const SCHEME = /^[a-z][a-z\d+.-]*:/i;

/** True for `https:`, `data:`, `mailto:`, ... and protocol-relative `//host` links. */
export function hasScheme(href: string): boolean {
  return SCHEME.test(href) || href.startsWith('//');
}

/** Splits `path#fragment` (or `path?query`) into its path and the rest. */
export function splitHref(href: string): { path: string; suffix: string } {
  const index = href.search(/[?#]/);
  return index === -1
    ? { path: href, suffix: '' }
    : { path: href.slice(0, index), suffix: href.slice(index) };
}

/**
 * Resolves a scheme-less link or image path written in `document`.
 * Paths starting with `/` are relative to the document's workspace folder.
 * Returns `undefined` when there is nothing to resolve against (e.g. an
 * untitled file outside any workspace).
 */
export function resolveDocumentPath(document: vscode.Uri, path: string): vscode.Uri | undefined {
  const decoded = safeDecode(path);
  if (decoded.startsWith('/')) {
    const folder =
      vscode.workspace.getWorkspaceFolder(document) ?? vscode.workspace.workspaceFolders?.[0];
    return folder ? vscode.Uri.joinPath(folder.uri, decoded) : undefined;
  }
  if (document.scheme === 'untitled') {
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder ? vscode.Uri.joinPath(folder.uri, decoded) : undefined;
  }
  return vscode.Uri.joinPath(document, '..', decoded);
}

/** `decodeURIComponent` that leaves malformed escapes as written. */
export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Resolves a `mdTool.preview.customCss` entry: absolute, or relative to the workspace folder. */
export function resolveStylesheet(document: vscode.Uri, href: string): vscode.Uri | undefined {
  if (nodePath.isAbsolute(href)) return vscode.Uri.file(href);
  const folder = vscode.workspace.getWorkspaceFolder(document);
  return folder ? vscode.Uri.joinPath(folder.uri, href) : resolveDocumentPath(document, href);
}
