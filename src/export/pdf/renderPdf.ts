import puppeteer, { type Browser } from 'puppeteer-core';
import type { Margins, PageSize } from '../../core/exportOptions';

/**
 * Prints an HTML file to PDF with a locally installed Chromium-based browser.
 * Bundled separately (dist/renderPdf.js) and loaded on first export, so the
 * extension does not pay for puppeteer at activation.
 */
export interface RenderPdfOptions {
  executablePath: string;
  /** `file://` URL of the HTML produced by `buildExportHtml`. */
  htmlUrl: string;
  outputPath: string;
  pageSize: PageSize;
  landscape: boolean;
  margin: Margins;
  headerTemplate: string;
  footerTemplate: string;
  timeoutMs?: number;
  /** Aborts the export (closes the browser) when it fires. */
  signal?: AbortSignal;
}

export async function renderPdf(options: RenderPdfOptions): Promise<void> {
  const timeout = options.timeoutMs ?? 60_000;
  let browser: Browser | undefined;
  const abort = () => void browser?.close();
  options.signal?.addEventListener('abort', abort);
  try {
    options.signal?.throwIfAborted();
    browser = await puppeteer.launch({
      executablePath: options.executablePath,
      headless: true,
      args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions'],
    });
    options.signal?.throwIfAborted();
    const page = await browser.newPage();
    await page.goto(options.htmlUrl, { waitUntil: 'load', timeout });
    await page.waitForFunction('window.__mdToolReady === true', { timeout });
    const displayHeaderFooter = !!(options.headerTemplate || options.footerTemplate);
    await page.pdf({
      path: options.outputPath,
      format: options.pageSize,
      landscape: options.landscape,
      margin: options.margin,
      printBackground: true,
      displayHeaderFooter,
      // Chrome prints a default header/footer when a template is empty.
      headerTemplate: options.headerTemplate || '<span></span>',
      footerTemplate: options.footerTemplate || '<span></span>',
      timeout,
    });
  } finally {
    options.signal?.removeEventListener('abort', abort);
    await browser?.close();
  }
}
