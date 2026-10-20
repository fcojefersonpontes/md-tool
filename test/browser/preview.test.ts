import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MarkdownEngine } from '../../src/core/MarkdownEngine';
import { assertBuilt, browserPath, fixtures, repoRoot, trackProblems } from './helpers';

/**
 * Loads the built webview script in a real browser with the extension's CSP and a
 * fake `acquireVsCodeApi`, then checks rendering and host messaging.
 */

const MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

let rendered = '';

function shell(origin: string, theme: string, bodyClass: string): string {
  const nonce = 'test-nonce';
  const csp = [
    "default-src 'none'",
    `img-src ${origin} https: data:`,
    `style-src ${origin} 'unsafe-inline'`,
    `font-src ${origin}`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  const payload = JSON.stringify(rendered).replace(/</g, '\\u003c');
  const editorBackground = bodyClass === 'vscode-dark' ? '#1f1f1f' : '#ffffff';
  return `<!DOCTYPE html><html data-theme="${theme}"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="/dist/webview/katex/katex.min.css">
<link rel="stylesheet" href="/media/preview.css"></head>
<body class="${bodyClass}" style="--vscode-editor-background:${editorBackground}">
<div id="md-tool-settings" hidden data-uri="file:///kitchen-sink.md" data-scroll-sync="true"
  data-mermaid-src="/dist/webview/mermaid.min.js"></div>
<main id="md-tool-content" class="markdown-body"></main>
<script nonce="${nonce}">
  window.__posts = [];
  let saved;
  window.acquireVsCodeApi = () => ({
    postMessage(message) {
      window.__posts.push(message);
      if (message.type === 'ready') window.postMessage({ type: 'update', html: ${payload} }, '*');
    },
    getState: () => saved,
    setState: (state) => { saved = state; },
  });
</script>
<script nonce="${nonce}" src="/dist/webview/preview.js"></script></body></html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/preview.html') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(
      shell(
        `http://${req.headers.host}`,
        url.searchParams.get('theme') ?? 'auto',
        url.searchParams.get('body') ?? 'vscode-light',
      ),
    );
    return;
  }
  const file = path.join(repoRoot, decodeURIComponent(url.pathname));
  if (!file.startsWith(repoRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

interface Posted {
  type: string;
  line?: number;
  href?: string;
}

const posts = (page: Page) =>
  page.evaluate(() => (window as unknown as { __posts: Posted[] }).__posts.slice());
const clearPosts = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __posts: Posted[] }).__posts.length = 0;
  });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!browserPath)('preview webview in a browser', () => {
  let browser: Browser;
  let base: string;

  beforeAll(async () => {
    assertBuilt();
    const engine = await MarkdownEngine.create({ allowHtml: true, math: true, mermaid: true });
    const markdown =
      fs.readFileSync(path.join(fixtures, 'kitchen-sink.md'), 'utf8') +
      '\n\n<script>window.__xss = 1</script>\n\n<img src="x" onerror="window.__xss = 2">\n';
    rendered = engine.render(markdown, {
      resolveResource: (src) => (/^https?:/.test(src) ? src : `/test/fixtures/${src}`),
    }).html;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await puppeteer.launch({ executablePath: browserPath, headless: true });
  });

  afterAll(async () => {
    await browser?.close();
    server.close();
  });

  async function open(theme: string, body: string) {
    const page = await browser.newPage();
    await page.setViewport({ width: 960, height: 900 });
    // `/x` is the deliberately broken <img> of the XSS probe.
    const problems = await trackProblems(page, [/\/x$/, /favicon\.ico$/]);
    await page.goto(`${base}/preview.html?theme=${theme}&body=${body}`, {
      waitUntil: 'networkidle0',
    });
    await page.waitForSelector('div.mermaid svg', { timeout: 20_000 });
    return { page, problems };
  }

  it.each([
    ['light', 'auto', 'vscode-light', 'rgb(255, 255, 255)'],
    ['dark', 'auto', 'vscode-dark', 'rgb(31, 31, 31)'],
    ['forced dark', 'dark', 'vscode-light', 'rgb(13, 17, 23)'],
  ])('renders the kitchen sink (%s)', async (_label, theme, body, background) => {
    const { page, problems } = await open(theme, body);
    const info = await page.evaluate(() => ({
      xss: (window as unknown as { __xss?: number }).__xss,
      scripts: document.querySelectorAll('#md-tool-content script').length,
      handlers: document.querySelectorAll('#md-tool-content [onerror]').length,
      katex: document.querySelectorAll('.katex').length,
      shiki: document.querySelectorAll('pre.shiki').length,
      tasks: document.querySelectorAll('.task-list-item-checkbox').length,
      images: Array.from(document.querySelectorAll('img[alt]'), (img) => [
        img.getAttribute('alt'),
        (img as HTMLImageElement).naturalWidth,
      ]),
      background: getComputedStyle(document.body).backgroundColor,
    }));
    await page.close();

    expect(problems).toEqual([]);
    expect(info.xss).toBeUndefined();
    expect(info.scripts + info.handlers).toBe(0);
    expect(info.katex).toBeGreaterThanOrEqual(2);
    expect(info.shiki).toBe(2);
    expect(info.tasks).toBe(2);
    expect(info.images).toEqual([
      ['Logo', 120],
      ['Banner', 160],
    ]);
    expect(info.background).toBe(background);
  });

  it('routes checkbox and link clicks to the host', async () => {
    const { page } = await open('auto', 'vscode-light');

    await clearPosts(page);
    await page.click('.task-list-item-checkbox');
    const checked = await page.$eval(
      '.task-list-item-checkbox',
      (box) => (box as HTMLInputElement).checked,
    );
    expect(await posts(page)).toContainEqual({ type: 'toggleTask', line: expect.any(Number) });
    expect(checked).toBe(false); // the host edits the source; no local flip

    await page.evaluate(() => window.scrollTo(0, 0));
    await clearPosts(page);
    await page.click('a[href="https://example.com"]');
    await page.click('a[href="other.md#intro"]');
    await page.click('a[href="#tabelas"]');
    await sleep(300);
    const links = (await posts(page)).filter((p) => p.type === 'openLink').map((p) => p.href);
    const headingTop = await page.$eval('#tabelas', (h) => h.getBoundingClientRect().top);
    await page.close();

    expect(links).toEqual(['https://example.com', 'other.md#intro']);
    expect(Math.abs(headingTop)).toBeLessThan(5);
  });

  it('syncs scrolling both ways without echoing', async () => {
    const { page } = await open('auto', 'vscode-light');
    const codeLine = await page.$eval('pre.shiki', (pre) =>
      Number((pre as HTMLElement).dataset.line),
    );

    await sleep(300);
    await clearPosts(page);
    await page.evaluate((line) => window.postMessage({ type: 'scrollTo', line }, '*'), codeLine);
    await sleep(300);
    const top = await page.$eval('pre.shiki', (pre) => pre.getBoundingClientRect().top);
    expect(Math.abs(top)).toBeLessThan(2);
    expect((await posts(page)).filter((p) => p.type === 'revealLine')).toEqual([]);

    await clearPosts(page);
    await page.mouse.move(400, 400);
    await page.mouse.wheel({ deltaY: 400 });
    await sleep(400);
    const revealed = (await posts(page)).filter((p) => p.type === 'revealLine');
    await page.close();

    expect(revealed.length).toBeGreaterThan(0);
    expect(revealed.at(-1)!.line).toBeGreaterThan(codeLine);
  });
});
