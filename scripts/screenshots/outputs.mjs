// Renders page 1 of the exported PDF and RTF with LibreOffice and puts them side by side.
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

const SOFFICE = 'C:\\Program Files\\LibreOffice\\program\\soffice.com';
const FONT = 'C:\\Windows\\Fonts\\segoeuib.ttf';

/** `demo.pdf` and `demo.rtf` in `dir` -> `target` PNG; skipped without LibreOffice. */
export async function renderOutputs(dir, target) {
  if (!existsSync(SOFFICE)) {
    console.warn('LibreOffice not found; skipping', target);
    return;
  }
  const profile = pathToFileURL(path.join(dir, 'lo-profile')).href;
  const pages = {};
  for (const file of ['demo.pdf', 'demo.rtf']) {
    // Draw opens the PDF, Writer the RTF; both export their first page.
    const out = path.join(dir, 'pages', file.replace('.', '-'));
    mkdirSync(out, { recursive: true });
    execFileSync(SOFFICE, [
      '--headless',
      '--norestore',
      `-env:UserInstallation=${profile}`,
      '--convert-to',
      'png',
      '--outdir',
      out,
      path.join(dir, file),
    ]);
    pages[file] = readFileSync(path.join(out, 'demo.png'));
  }

  const size = (png) => {
    const { width, height } = PNG.sync.read(png);
    return { width, height };
  };
  const height = 760;
  const figure = (png, x, caption) => {
    const page = size(png);
    const width = Math.round((page.width * height) / page.height);
    return {
      width,
      svg:
        `<rect x="${x + 4}" y="34" width="${width}" height="${height}" fill="#000" opacity=".45"/>` +
        `<rect x="${x}" y="28" width="${width}" height="${height}" fill="#fff"/>` +
        `<image x="${x}" y="28" width="${width}" height="${height}" ` +
        `href="data:image/png;base64,${png.toString('base64')}"/>` +
        `<text x="${x + width / 2}" y="${height + 70}" text-anchor="middle" ` +
        `font-family="Segoe UI" font-weight="bold" font-size="18" fill="#ccc">${caption}</text>`,
    };
  };
  const pdf = figure(pages['demo.pdf'], 0, 'PDF');
  const rtf = figure(pages['demo.rtf'], 0, 'RTF (LibreOffice Writer)');
  const gap = 48;
  const left = Math.round((1280 - pdf.width - rtf.width - gap) / 2);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="860">` +
    `<rect width="1280" height="860" fill="#1f1f1f"/>` +
    `<g transform="translate(${left} 0)">${pdf.svg}</g>` +
    `<g transform="translate(${left + pdf.width + gap} 0)">${rtf.svg}</g></svg>`;

  await initWasm(readFileSync('node_modules/@resvg/resvg-wasm/index_bg.wasm'));
  const font = existsSync(FONT) ? [readFileSync(FONT)] : [];
  const png = new Resvg(svg, {
    font: { fontBuffers: font, defaultFontFamily: 'Segoe UI', loadSystemFonts: false },
  })
    .render()
    .asPng();
  writeFileSync(target, png);
}
