/// <reference lib="dom" />
// page.evaluate() callbacks run in the browser.
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import katex from 'katex';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import type { GraphicKind } from '../../core/rtf/assets';
import { escapeHtml } from '../../core/html';

/** Something to draw: an image URL the browser can display, or a formula / diagram source. */
export type RasterJob = { key: string } & (
  { kind: 'image'; url: string } | { kind: GraphicKind; source: string }
);

export interface RasterImage {
  /** PNG captured at `DEVICE_SCALE`. */
  png: Uint8Array;
  /** Display size in CSS pixels. */
  width: number;
  height: number;
  /** CSS pixels below the text baseline (inline formulas only). */
  depth: number;
}

export interface RasterizeOptions {
  executablePath: string;
  jobs: RasterJob[];
  /** `file://` URLs of the KaTeX stylesheet and the Mermaid script. */
  katexCssUrl: string;
  mermaidScriptUrl: string;
  /** Body font size in CSS pixels, so formulas match the surrounding text. */
  fontSizePx: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Captures at 2x so pictures stay sharp when printed or zoomed. */
const DEVICE_SCALE = 2;

/**
 * Renders images (SVG, GIF, ...), KaTeX formulas and Mermaid diagrams to PNG
 * with a headless browser, for formats such as RTF that cannot draw them.
 * Jobs that fail are left out of the result; callers fall back to text.
 */
export async function rasterize(options: RasterizeOptions): Promise<Map<string, RasterImage>> {
  const results = new Map<string, RasterImage>();
  if (options.jobs.length === 0) return results;

  const timeout = options.timeoutMs ?? 30_000;
  const needsMermaid = options.jobs.some((job) => job.kind === 'mermaid');
  const htmlPath = path.join(os.tmpdir(), `md-tool-raster-${randomBytes(8).toString('hex')}.html`);
  await fs.writeFile(htmlPath, stageHtml(options, needsMermaid), 'utf8');

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
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: DEVICE_SCALE });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load', timeout });
    if (needsMermaid) {
      await page.evaluate(() => {
        (window as unknown as { mermaid: { initialize(c: object): void } }).mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'default',
        });
      });
    }

    let id = 0;
    for (const job of options.jobs) {
      options.signal?.throwIfAborted();
      try {
        const image = await renderJob(page, job, `md-tool-raster-${id++}`);
        if (image) results.set(job.key, image);
      } catch (error) {
        if (options.signal?.aborted) throw error;
        // A broken formula or unreachable image just keeps its text fallback.
      }
    }
    return results;
  } finally {
    options.signal?.removeEventListener('abort', abort);
    await browser?.close();
    await fs.rm(htmlPath, { force: true });
  }
}

function stageHtml(options: RasterizeOptions, needsMermaid: boolean): string {
  const mermaid = needsMermaid
    ? `<script src="${escapeHtml(options.mermaidScriptUrl)}"></script>`
    : '';
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<link rel="stylesheet" href="${escapeHtml(options.katexCssUrl)}">
<style>
  html, body { margin: 0; background: transparent; }
  body { font-size: ${options.fontSizePx}px; color: #1f2328; }
  #stage { display: inline-block; }
  #stage .katex-display { margin: 0; }
  #stage img { display: block; max-width: 1600px; }
  #baseline { display: inline-block; width: 0; height: 0; }
</style>
${mermaid}</head><body><div id="stage"></div></body></html>`;
}

async function renderJob(page: Page, job: RasterJob, id: string): Promise<RasterImage | undefined> {
  let html: string;
  switch (job.kind) {
    case 'image':
      html = `<img src="${escapeHtml(job.url)}">`;
      break;
    case 'math-inline':
    case 'math-block':
      html =
        katex.renderToString(job.source, {
          displayMode: job.kind === 'math-block',
          throwOnError: true,
        }) + (job.kind === 'math-inline' ? '<span id="baseline"></span>' : '');
      break;
    case 'mermaid':
      html = await page.evaluate(
        async (source, elementId) => {
          const mermaid = (
            window as unknown as {
              mermaid: { render(id: string, text: string): Promise<{ svg: string }> };
            }
          ).mermaid;
          return (await mermaid.render(elementId, source)).svg;
        },
        job.source,
        id,
      );
      break;
  }

  const geometry = await page.evaluate(async (content) => {
    const stage = document.getElementById('stage')!;
    stage.innerHTML = content;
    await Promise.all(
      Array.from(stage.querySelectorAll('img'), (img) =>
        img.complete ? null : new Promise((resolve) => (img.onload = img.onerror = resolve)),
      ),
    );
    await document.fonts.ready;
    if (!Array.from(stage.querySelectorAll('img')).every((img) => img.naturalWidth > 0)) {
      return undefined;
    }

    // Mermaid emits width="100%"; give the diagram its natural size instead.
    const svg = stage.querySelector<SVGSVGElement>(':scope > svg');
    const viewBox = svg?.viewBox?.baseVal;
    if (svg && viewBox && viewBox.width > 0) {
      svg.style.maxWidth = 'none';
      svg.setAttribute('width', String(viewBox.width));
      svg.setAttribute('height', String(viewBox.height));
    }

    let rect = stage.getBoundingClientRect();
    let depth = 0;
    const marker = document.getElementById('baseline');
    if (marker) {
      // Inline formula: crop to KaTeX's own boxes (height above + depth below the
      // baseline), not the taller line box, so a formula without descenders sits
      // exactly on the baseline even where the RTF reader ignores \dn.
      // Each strut (`.katex-strut` since KaTeX 0.19, `.strut` before) is exactly height + depth tall, sitting on the baseline.
      const struts = Array.from(
        stage.querySelectorAll('.katex-html .katex-strut, .katex-html .strut'),
        (strut) => strut.getBoundingClientRect(),
      );
      const html = stage.querySelector('.katex-html')?.getBoundingClientRect();
      if (struts.length && html) {
        const top = Math.min(...struts.map((s) => s.top));
        const bottom = Math.max(...struts.map((s) => s.bottom));
        // Half a pixel of slack so antialiased edges are not clipped.
        rect = new DOMRect(html.left, top - 0.5, html.width, bottom - top + 1);
      }
      depth = Math.max(0, rect.bottom - marker.getBoundingClientRect().top);
    }
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, depth };
  }, html);
  if (!geometry || geometry.width < 1 || geometry.height < 1) return undefined;

  const { depth, ...clip } = geometry;
  const png = await page.screenshot({ type: 'png', omitBackground: true, clip });
  return { png, width: clip.width, height: clip.height, depth };
}
