import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { readImage } from '../../src/core/rtf/images';
import { rasterize, type RasterImage, type RasterJob } from '../../src/export/browser/rasterize';
import { assertBuilt, browserPath, fixtures, repoRoot } from './helpers';

const fileUrl = (...segments: string[]) => pathToFileURL(path.join(repoRoot, ...segments)).href;

describe.skipIf(!browserPath)('rasterizing graphics for RTF', () => {
  let results: Map<string, RasterImage>;

  const jobs: RasterJob[] = [
    { key: 'svg', kind: 'image', url: pathToFileURL(path.join(fixtures, 'assets/logo.svg')).href },
    { key: 'missing', kind: 'image', url: pathToFileURL(path.join(fixtures, 'nope.svg')).href },
    { key: 'flat', kind: 'math-inline', source: 'E = mc^2' },
    { key: 'deep', kind: 'math-inline', source: 'x_i^2 + \\frac{a}{b}' },
    { key: 'block', kind: 'math-block', source: '\\int_0^1 x^2 \\, dx' },
    { key: 'broken', kind: 'math-inline', source: '\\frac{' },
    { key: 'diagram', kind: 'mermaid', source: 'graph LR\n  A[Markdown] --> B(Preview)\n' },
  ];

  beforeAll(async () => {
    assertBuilt();
    results = await rasterize({
      executablePath: browserPath!,
      jobs,
      katexCssUrl: fileUrl('dist/webview/katex/katex.min.css'),
      mermaidScriptUrl: fileUrl('dist/webview/mermaid.min.js'),
      fontSizePx: (11 * 96) / 72,
    });
  });

  it('renders every valid job and skips broken ones', () => {
    expect([...results.keys()].sort()).toEqual(['block', 'deep', 'diagram', 'flat', 'svg']);
  });

  it('captures PNGs at twice the display size', () => {
    for (const [key, raster] of results) {
      const png = readImage(raster.png);
      expect(png?.kind, key).toBe('png');
      expect(Math.abs(png!.width - raster.width * 2), key).toBeLessThanOrEqual(2);
      expect(Math.abs(png!.height - raster.height * 2), key).toBeLessThanOrEqual(2);
    }
  });

  it('keeps an SVG image at its intrinsic size', () => {
    const svg = results.get('svg')!;
    expect([svg.width, svg.height]).toEqual([120, 40]);
  });

  it('crops inline formulas to the baseline, keeping real depth only', () => {
    const flat = results.get('flat')!;
    const deep = results.get('deep')!;
    // No descenders: only the half-pixel antialiasing slack hangs below the baseline.
    expect(flat.depth).toBeLessThan(1);
    expect(flat.height).toBeLessThan(18); // tight, not the ~22px line box
    expect(deep.depth).toBeGreaterThan(2);
    expect(results.get('block')!.depth).toBe(0);
  });

  it('gives Mermaid diagrams their natural size instead of width="100%"', () => {
    expect(results.get('diagram')!.width).toBeGreaterThan(300);
  });
});
