// Renders page 1 of the exported PDF and RTF with LibreOffice and puts them side by side.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { findBrowser } from '../browser.mjs';

const SOFFICE = 'C:\\Program Files\\LibreOffice\\program\\soffice.com';

/** `demo.pdf` and `demo.rtf` in `dir` -> `target` PNG; skipped without LibreOffice. */
export async function renderOutputs(dir, target) {
  if (!existsSync(SOFFICE)) {
    console.warn('LibreOffice not found; skipping', target);
    return;
  }
  const pngDir = path.join(dir, 'pages');
  mkdirSync(pngDir, { recursive: true });
  const profile = pathToFileURL(path.join(dir, 'lo-profile')).href;
  // Writer exports the first page of the RTF.
  execFileSync(SOFFICE, [
    '--headless',
    '--norestore',
    `-env:UserInstallation=${profile}`,
    '--convert-to',
    'png',
    '--outdir',
    pngDir,
    path.join(dir, 'demo.rtf'),
  ]);
  const dataUrl = (file) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;

  const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true });
  try {
    // The PDF in the browser's own viewer (LibreOffice's PDF import garbles KaTeX).
    const viewer = await browser.newPage();
    await viewer.setViewport({ width: 794, height: 1123 });
    await viewer.goto(`${pathToFileURL(path.join(dir, 'demo.pdf')).href}#toolbar=0&view=Fit`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const pdfPage = path.join(pngDir, 'demo-pdf.png');
    await viewer.screenshot({ path: pdfPage });
    const page = (file) => dataUrl(file === 'demo.pdf' ? pdfPage : path.join(pngDir, 'demo.png'));

    const tab = await browser.newPage();
    await tab.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 });
    await tab.setContent(`<!doctype html><style>
      body { margin: 0; background: #1f1f1f; font: 600 18px 'Segoe UI', sans-serif; color: #ccc;
             display: flex; gap: 48px; justify-content: center; padding: 28px; }
      figure { margin: 0; text-align: center; }
      img { height: 760px; box-shadow: 0 6px 24px #000a; background: #fff; display: block; }
      figcaption { margin-top: 14px; }
    </style>
    <figure><img src="${page('demo.pdf')}"><figcaption>PDF</figcaption></figure>
    <figure><img src="${page('demo.rtf')}"><figcaption>RTF (LibreOffice Writer)</figcaption></figure>`);
    await tab.screenshot({ path: target });
  } finally {
    await browser.close();
  }
}
