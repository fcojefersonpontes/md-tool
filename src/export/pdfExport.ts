import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getPdfConfig, getPreviewConfig } from '../config';
import { buildExportHtml } from '../core/exportHtml';
import { parseDocumentMeta, resolvePdfOptions } from '../core/exportOptions';
import { resolveStylesheet } from '../paths';
import {
  documentTitle,
  ExportCancelledError,
  type ExportContext,
  resolveLocalResource,
  toFileUrl,
} from './exportContext';
import { findBrowser, loadBrowserModule } from './browserModule';

/** No Chrome / Edge / Chromium found and `mdTool.pdf.executablePath` is unset or invalid. */
export class BrowserNotFoundError extends Error {
  constructor() {
    super('No Chromium-based browser found');
  }
}

export async function exportPdf(context: ExportContext): Promise<void> {
  const { document, engine, extensionUri, signal } = context;
  const config = getPdfConfig(document.uri);
  const executablePath = findBrowser(document.uri);
  if (!executablePath) throw new BrowserNotFoundError();

  const rendered = engine.render(document.getText(), {
    resolveResource: (src) => {
      const local = resolveLocalResource(document.uri, src);
      return local ? toFileUrl(local.uri) + local.suffix : src;
    },
  });
  const meta = parseDocumentMeta(rendered.frontMatter);
  const options = resolvePdfOptions(config.options, meta.pdf);

  const asset = (...segments: string[]) =>
    toFileUrl(vscode.Uri.joinPath(extensionUri, ...segments));
  const customCss = getPreviewConfig(document.uri)
    .customCss.map((href) => resolveStylesheet(document.uri, href))
    .filter((uri): uri is vscode.Uri => uri !== undefined)
    .map(toFileUrl);

  const html = buildExportHtml({
    title: documentTitle(document, rendered.headings, meta.title),
    lang: vscode.env.language,
    bodyHtml: rendered.html,
    stylesheets: [
      asset('dist', 'webview', 'katex', 'katex.min.css'),
      asset('media', 'preview.css'),
      asset('media', 'print.css'),
      ...customCss,
    ],
    mermaidScript: asset('dist', 'webview', 'mermaid.min.js'),
    nonce: randomBytes(16).toString('base64'),
  });

  const htmlPath = path.join(os.tmpdir(), `md-tool-${randomBytes(8).toString('hex')}.html`);
  await fs.writeFile(htmlPath, html, 'utf8');
  try {
    await loadBrowserModule().renderPdf({
      executablePath,
      htmlUrl: toFileUrl(vscode.Uri.file(htmlPath)),
      outputPath: context.target.fsPath,
      ...options,
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw new ExportCancelledError();
    throw error;
  } finally {
    await fs.rm(htmlPath, { force: true });
  }
}
