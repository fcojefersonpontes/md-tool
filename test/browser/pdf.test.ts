import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildExportHtml } from '../../src/core/exportHtml';
import { MarkdownEngine } from '../../src/core/MarkdownEngine';
import { renderPdf } from '../../src/export/pdf/renderPdf';
import { assertBuilt, browserPath, fixtures, repoRoot, trackProblems } from './helpers';

const fileUrl = (...segments: string[]) => pathToFileURL(path.join(repoRoot, ...segments)).href;

describe.skipIf(!browserPath)('PDF export in a browser', () => {
  let dir: string;
  let htmlPath: string;

  beforeAll(async () => {
    assertBuilt();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tool-pdf-'));
    // Raw HTML enabled on purpose: the export page's CSP must still block scripts.
    const engine = await MarkdownEngine.create({ allowHtml: true, math: true, mermaid: true });
    const markdown =
      fs.readFileSync(path.join(fixtures, 'kitchen-sink.md'), 'utf8') +
      '\n\n<script>window.__xss = 1</script>\n';
    const { html } = engine.render(markdown, {
      resolveResource: (src) => pathToFileURL(path.join(fixtures, decodeURIComponent(src))).href,
    });
    htmlPath = path.join(dir, 'kitchen-sink.html');
    fs.writeFileSync(
      htmlPath,
      buildExportHtml({
        title: 'Kitchen sink',
        lang: 'pt-br',
        bodyHtml: html,
        stylesheets: [
          fileUrl('dist/webview/katex/katex.min.css'),
          fileUrl('media/preview.css'),
          fileUrl('media/print.css'),
        ],
        mermaidScript: fileUrl('dist/webview/mermaid.min.js'),
        nonce: 'test-nonce',
      }),
    );
  });

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('renders diagrams, math and images, and blocks injected scripts', async () => {
    const browser = await puppeteer.launch({ executablePath: browserPath, headless: true });
    try {
      const page = await browser.newPage();
      const problems = await trackProblems(page);
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
      await page.waitForFunction('window.__mdToolReady === true', { timeout: 30_000 });
      const info = await page.evaluate(() => ({
        xss: (window as unknown as { __xss?: number }).__xss,
        diagrams: document.querySelectorAll('div.mermaid svg').length,
        katex: document.querySelectorAll('.katex').length,
        images: Array.from(document.images, (img) => img.naturalWidth),
        theme: document.documentElement.dataset.theme,
      }));
      // The inline <script> from the Markdown being blocked is the only expected report.
      const blocked = (p: string) => /inline script violates|CSP script-src-elem inline/.test(p);
      expect(problems.filter((p) => !blocked(p))).toEqual([]);
      expect(problems.some(blocked)).toBe(true);
      expect(info).toEqual({
        xss: undefined,
        diagrams: 1,
        katex: expect.any(Number),
        images: [120, 160],
        theme: 'light',
      });
      expect(info.katex).toBeGreaterThanOrEqual(2);
    } finally {
      await browser.close();
    }
  });

  it('prints a multi-page PDF with the configured page setup', async () => {
    const output = path.join(dir, 'kitchen-sink.pdf');
    await renderPdf({
      executablePath: browserPath!,
      htmlUrl: pathToFileURL(htmlPath).href,
      outputPath: output,
      pageSize: 'A4',
      landscape: false,
      margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
      headerTemplate: '',
      footerTemplate: '<span class="pageNumber"></span>',
    });
    const pdf = fs.readFileSync(output);
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    expect((text.match(/\/Type\s*\/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // A4 portrait MediaBox: 595 x 842 points.
    expect(text).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+59[45](\.\d+)?\s+84[12](\.\d+)?\s*\]/);
  });

  it('honours landscape and aborts on request', async () => {
    const output = path.join(dir, 'landscape.pdf');
    await renderPdf({
      executablePath: browserPath!,
      htmlUrl: pathToFileURL(htmlPath).href,
      outputPath: output,
      pageSize: 'Letter',
      landscape: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
      headerTemplate: '',
      footerTemplate: '',
    });
    expect(fs.readFileSync(output, 'latin1')).toMatch(
      /\/MediaBox\s*\[\s*0\s+0\s+792(\.\d+)?\s+612(\.\d+)?\s*\]/,
    );

    const controller = new AbortController();
    controller.abort();
    await expect(
      renderPdf({
        executablePath: browserPath!,
        htmlUrl: pathToFileURL(htmlPath).href,
        outputPath: path.join(dir, 'aborted.pdf'),
        pageSize: 'A4',
        landscape: false,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
        headerTemplate: '',
        footerTemplate: '',
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(fs.existsSync(path.join(dir, 'aborted.pdf'))).toBe(false);
  });
});
