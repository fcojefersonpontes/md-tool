import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FontIndex, resolveFonts, type ResolvedFonts } from '../../src/core/fonts/fontIndex';
import type { FontFace } from '../../src/core/fonts/sfnt';
import { renderMath } from '../../src/core/graphics/math';
import { identifyPicture } from '../../src/core/graphics/pictures';
import { bitmapSvg, initRaster, svgSize, svgToPng } from '../../src/core/graphics/raster';
import { MarkdownEngine } from '../../src/core/MarkdownEngine';
import { layoutLines, type Measurer, type TextStyle } from '../../src/core/pdf/layout';
import { previewFontSize } from '../../src/core/exportOptions';
import { type PdfRenderOptions, renderPdf } from '../../src/core/pdf/PdfRenderer';
import { columnWidths, estimateColumnSizes } from '../../src/core/tableLayout';
import { fixDashArray, pdfSafeSvg } from '../../src/core/pdf/svg';
import { readImage } from '../../src/core/rtf/images';

const root = path.resolve(__dirname, '../..');

/** Every character is 1pt wide per point of size: easy to reason about. */
const measure: Measurer = {
  width: (text, style) => Array.from(text).length * style.size,
  ascent: (style) => style.size * 0.8,
  descent: (style) => style.size * 0.2,
};
const style: TextStyle = { family: 'body', bold: false, italic: false, size: 1, color: '#000' };
const text = (value: string, s = style) => ({ type: 'text' as const, text: value, style: s });
const lineTexts = (items: Parameters<typeof layoutLines>[0], width: number) =>
  layoutLines(items, width, measure, style).map((line) =>
    line.pieces.map((piece) => (piece.type === 'text' ? piece.text : '[box]')).join(''),
  );

describe('layoutLines', () => {
  it('wraps at spaces, collapsing whitespace and dropping it at line ends', () => {
    expect(lineTexts([text('aaa  bbb ccc\ndd')], 7)).toEqual(['aaa bbb', 'ccc dd']);
  });

  it('keeps styled runs on one line and merges equal styles', () => {
    const bold = { ...style, bold: true };
    const lines = layoutLines([text('a '), text('b', bold), text(' c')], 20, measure, style);
    expect(lines).toHaveLength(1);
    expect(lines[0].pieces.map((p) => p.type === 'text' && p.text)).toEqual(['a ', 'b', ' c']);
    expect(lines[0].width).toBe(5);
  });

  it('honours hard breaks and keeps empty lines', () => {
    expect(lineTexts([text('a'), { type: 'break' }, { type: 'break' }, text('b')], 10)).toEqual([
      'a',
      '',
      'b',
    ]);
  });

  it('splits words longer than a line between characters', () => {
    expect(lineTexts([text('see abcdefghij')], 4)).toEqual(['see', 'abcd', 'efgh', 'ij']);
  });

  it('breaks between CJK characters', () => {
    expect(lineTexts([text('日本語の文章')], 4)).toEqual(['日本語の', '文章']);
  });

  it('sizes lines by their tallest box', () => {
    const box = { type: 'box' as const, width: 2, ascent: 5, descent: 3, draw: () => {} };
    const [line] = layoutLines([text('x '), box], 10, measure, style);
    expect(line.ascent).toBe(5);
    expect(line.descent).toBe(3);
    expect(line.width).toBe(4);
  });
});

describe('columnWidths', () => {
  it('uses natural widths when they fit', () => {
    expect(
      columnWidths(
        [
          { natural: 10, minimum: 5 },
          { natural: 20, minimum: 5 },
        ],
        100,
      ),
    ).toEqual([10, 20]);
  });

  it('shares the space by how much each column wants beyond its minimum', () => {
    const widths = columnWidths(
      [
        { natural: 50, minimum: 10 },
        { natural: 130, minimum: 10 },
      ],
      60,
    );
    expect(widths[0] + widths[1]).toBeCloseTo(60);
    expect(widths[0]).toBeCloseTo(10 + 40 / 4);
  });

  it('splits the space evenly when no minimum fits', () => {
    expect(
      columnWidths(
        [
          { natural: 50, minimum: 40 },
          { natural: 50, minimum: 40 },
        ],
        40,
      ),
    ).toEqual([20, 20]);
  });

  it('keeps narrow columns whole when a long word does not fit', () => {
    // "Margens" (12) and "Valor" (10) stay whole; the long code (200) breaks.
    expect(
      columnWidths(
        [
          { natural: 20, minimum: 12 },
          { natural: 15, minimum: 10 },
          { natural: 200, minimum: 200 },
        ],
        100,
      ),
    ).toEqual([12, 10, 78]);
  });
});

describe('estimateColumnSizes', () => {
  it('estimates from characters, with bold headers wider', () => {
    const [first, second] = estimateColumnSizes(
      [
        { header: true, cells: ['Número', 'Regra'] },
        { header: false, cells: ['1', 'um texto mais longo'] },
      ],
      2,
      10,
      2,
    );
    expect(first.natural).toBeCloseTo(6 * 6.8 + 2);
    expect(first.minimum).toBeCloseTo(6 * 6.8 + 2);
    expect(second.natural).toBeCloseTo(19 * 5.8 + 2);
    expect(second.minimum).toBeCloseTo(5 * 6.8 + 2); // "Regra", in bold, beats "longo"
  });
});

describe('previewFontSize', () => {
  it('fits as much text per line as the preview at full width', () => {
    expect(previewFontSize(836 * 0.75)).toBe(10.5); // the preview's own column
    expect(previewFontSize(595.28 - (2 * (20 * 72)) / 25.4)).toBe(8); // A4, 20 mm margins
  });
});

describe('identifyPicture', () => {
  const png = fs.readFileSync(path.join(root, 'test/fixtures/assets/banner.png'));

  it('recognizes bitmaps and their size', () => {
    expect(identifyPicture(png, svgSize)).toMatchObject({ kind: 'png' });
    const gif = Buffer.from(
      'R0lGODlhAgABAIABAP8AAP///yH5BAEAAAEALAAAAAACAAEAAAICBAoAOw==',
      'base64',
    );
    expect(identifyPicture(gif, svgSize)).toMatchObject({
      kind: 'bitmap',
      mime: 'image/gif',
      width: 2,
      height: 1,
    });
    // Smallest valid lossless WebP (1×1).
    const webp = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
    expect(identifyPicture(webp, svgSize)).toMatchObject({
      mime: 'image/webp',
      width: 1,
      height: 1,
    });
  });

  it('recognizes SVG and reads its size', () => {
    const svg = Buffer.from(
      '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="2in" viewBox="0 0 20 10"/>',
    );
    expect(identifyPicture(svg, svgSize)).toMatchObject({ kind: 'svg', width: 192, height: 96 });
    expect(identifyPicture(Buffer.from('plain text'), svgSize)).toBeUndefined();
  });
});

describe('svgSize', () => {
  it('reads attributes, then the viewBox, then falls back to 300×150', () => {
    expect(svgSize('<svg width="10pt" height="3mm">')).toEqual({
      width: 10 * (96 / 72),
      height: (3 * 96) / 25.4,
    });
    expect(svgSize('<svg viewBox="0 0 40 20" width="80">')).toEqual({ width: 80, height: 40 });
    expect(svgSize('<svg viewBox="0,0,40,20">')).toEqual({ width: 40, height: 20 });
    expect(svgSize('<svg width="100%">')).toEqual({ width: 300, height: 150 });
  });
});

describe('renderMath', () => {
  it('typesets TeX to a self-contained SVG measured in ems', () => {
    const inline = renderMath('g = \\frac{R_2 - R_1}{R_1}', false)!;
    expect(inline.svg).toMatch(/^<svg/);
    expect(inline.svg).not.toContain('<use'); // no shared glyph cache
    expect(inline.width).toBeGreaterThan(2);
    expect(inline.depth).toBeGreaterThan(0.2); // the fraction goes below the baseline
    const display = renderMath('\\sum_{k=0}^{3} x^k', true)!;
    expect(display.height + display.depth).toBeGreaterThan(inline.height + inline.depth);
  });

  it('rejects invalid TeX', () => {
    expect(renderMath('\\frac{1}{', false)).toBeUndefined();
    expect(renderMath('\\nosuchcommand{x}', false)).toBeUndefined();
  });
});

describe('svgToPng', () => {
  beforeAll(() =>
    initRaster(async () =>
      fs.readFileSync(path.join(root, 'node_modules/@resvg/resvg-wasm/index_bg.wasm')),
    ),
  );

  it('draws formulas and bitmaps at the requested width', () => {
    const math = renderMath('E = mc^2', false)!;
    const png = readImage(svgToPng(math.svg, { width: 200 }))!;
    expect(png.kind).toBe('png');
    expect(png.width).toBe(200);
    expect(png.height / png.width).toBeCloseTo((math.height + math.depth) / math.width, 1);

    const gif = Buffer.from(
      'R0lGODlhAgABAIABAP8AAP///yH5BAEAAAEALAAAAAACAAEAAAICBAoAOw==',
      'base64',
    );
    const converted = readImage(svgToPng(bitmapSvg('image/gif', gif, 2, 1), { width: 2 }))!;
    expect([converted.width, converted.height]).toEqual([2, 1]);
  });

  it('scales SVGs that have no viewBox', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="5"><rect width="10" height="5"/></svg>';
    const png = readImage(svgToPng(svg, { width: 40 }))!;
    expect([png.width, png.height]).toEqual([40, 20]);
  });
});

describe('FontIndex', () => {
  const face = (family: string, weight: number, italic: boolean, file: string): FontFace => ({
    file,
    postscriptName: file,
    family,
    weight,
    italic,
    collection: false,
  });
  const index = FontIndex.fromFaces([
    face('Segoe UI', 400, false, 'segoeui.ttf'),
    face('Segoe UI', 300, false, 'segoeuil.ttf'),
    face('Segoe UI', 600, false, 'seguisb.ttf'),
    face('Segoe UI', 700, false, 'segoeuib.ttf'),
    face('Segoe UI', 400, true, 'segoeuii.ttf'),
    face('Consolas', 400, false, 'consola.ttf'),
    face('Microsoft YaHei', 400, false, 'msyh.ttc'),
  ]);

  it('picks the closest weight and style for each face', () => {
    const family = index.family('segoe ui')!;
    expect(family.regular.file).toBe('segoeui.ttf');
    expect(family.bold.file).toBe('segoeuib.ttf');
    expect(family.italic.file).toBe('segoeuii.ttf');
    expect(family.boldItalic.file).toBe('segoeuii.ttf'); // no bold italic: closest is italic
    expect(family.regular.postscriptName).toBeUndefined(); // only collections need it
  });

  it('resolves the configured family, else the platform defaults', () => {
    const fonts = resolveFonts(index, 'win32', { fontFamily: 'Consolas', codeFontFamily: '' });
    expect(fonts.body?.name).toBe('Consolas');
    expect(fonts.mono?.name).toBe('Consolas');
    expect(fonts.fallbacks.map((f) => f.name)).toEqual(['Microsoft YaHei']);
    const missing = resolveFonts(index, 'win32', { fontFamily: 'Nope', codeFontFamily: '' });
    expect(missing.body?.name).toBe('Segoe UI');
    expect(
      resolveFonts(FontIndex.fromFaces([]), 'linux', { fontFamily: '', codeFontFamily: '' }).body,
    ).toBeUndefined();
  });
});

describe('renderPdf', () => {
  let engine: MarkdownEngine;
  beforeAll(async () => {
    engine = await MarkdownEngine.create({ allowHtml: false, math: true, mermaid: true });
  });

  /** The 14 standard PDF fonts: no dependency on the machine's fonts. */
  const noFonts: ResolvedFonts = { fallbacks: [] };
  const options = (overrides: Partial<PdfRenderOptions> = {}): PdfRenderOptions => ({
    title: 'Test',
    page: { width: 595, height: 842, margin: { top: 56, right: 56, bottom: 56, left: 56 } },
    fontSize: 11,
    fonts: noFonts,
    header: '',
    footer: '{page} / {pages}',
    loadImage: () => undefined,
    loadDiagram: () => undefined,
    ...overrides,
  });
  const render = async (
    markdown: string,
    overrides?: Partial<PdfRenderOptions>,
    parser = engine,
  ) => {
    const result = await renderPdf(parser.parse(markdown).tokens, options(overrides));
    return { ...result, pdf: Buffer.from(result.data).toString('latin1') };
  };
  const pages = (pdf: string) => (pdf.match(/\/Type \/Page\b/g) ?? []).length;

  it('writes a PDF with metadata, an outline and heading destinations', async () => {
    const { pdf, warnings } = await render(
      '# Title\n\nText [to b](#b-section).\n\n## B section\n\nMore.\n',
    );
    expect(pdf.startsWith('%PDF-1.')).toBe(true);
    expect(pdf).toMatch(/\/Title \d+ 0 R/);
    expect(pdf).toContain('(Test)');
    expect(pdf).toContain('/Outlines');
    expect(pdf).toMatch(/\(b-section\)/); // named destination of the heading
    expect(pdf).toMatch(/\/S \/GoTo/); // the internal link
    expect(pages(pdf)).toBe(1);
    expect(warnings).toEqual([]);
  });

  it('breaks long documents into pages', async () => {
    const markdown = Array.from({ length: 120 }, (_, i) => `Paragraph ${i} with some text.`).join(
      '\n\n',
    );
    expect(pages((await render(markdown)).pdf)).toBeGreaterThan(3);
  });

  it('splits long code blocks and tables across pages', async () => {
    const code =
      '```\n' + Array.from({ length: 150 }, (_, i) => `line ${i}`).join('\n') + '\n```\n';
    expect(pages((await render(code)).pdf)).toBeGreaterThan(1);
    const table =
      '| a | b |\n|---|---|\n' + Array.from({ length: 80 }, (_, i) => `| ${i} | x |`).join('\n');
    expect(pages((await render(table)).pdf)).toBeGreaterThan(1);
  });

  it('reports what could not be exported', async () => {
    const withHtml = await MarkdownEngine.create({ allowHtml: true, math: true, mermaid: true });
    const { warnings } = await render(
      '<div>html</div>\n\n$\\frac{1}{$\n\n![alt](missing.png)\n\n```mermaid\ngraph LR; A-->B\n```\n',
      {},
      withHtml,
    );
    expect(warnings.sort()).toEqual(['html', 'image', 'math', 'mermaid']);
  });

  it('draws images and diagrams it is given, and external links', async () => {
    const png = fs.readFileSync(path.join(root, 'test/fixtures/assets/banner.png'));
    const image = readImage(png)!;
    const { pdf, warnings } = await render(
      '[![b](b.png)](https://example.com)\n\n```mermaid\ngraph LR; A-->B\n```\n',
      {
        loadImage: () => ({ kind: 'png', data: png, width: image.width, height: image.height }),
        loadDiagram: () => ({
          kind: 'svg',
          svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><rect width="100" height="40" fill="#eee"/><text x="10" y="25">A</text></svg>',
          width: 100,
          height: 40,
        }),
      },
    );
    expect(warnings).toEqual([]);
    expect(pdf).toContain('/Subtype /Image');
    expect(pdf).toContain('(https://example.com)');
  });

  it('renders the kitchen sink with the machine fonts', async () => {
    const fonts = resolveFonts(
      FontIndex.scan(
        process.platform === 'win32'
          ? [path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts')]
          : ['/usr/share/fonts', '/System/Library/Fonts', '/Library/Fonts'],
      ),
      process.platform,
      { fontFamily: '', codeFontFamily: '' },
    );
    const markdown = fs.readFileSync(path.join(root, 'test/fixtures/kitchen-sink.md'), 'utf8');
    const { pdf, warnings } = await render(markdown, {
      fonts,
      highlight: (code, lang) => engine.highlightTokens(code, lang),
    });
    expect(pages(pdf)).toBeGreaterThanOrEqual(2);
    expect(warnings.sort()).toEqual(['image', 'mermaid']); // no images or diagrams given
    if (fonts.body) expect(pdf).toContain('/FontFile2'); // embedded TrueType
  });
});

describe('pdfSafeSvg', () => {
  it('drops zero-length dash pairs, which pdfkit rejects', () => {
    expect(fixDashArray('0 0 97.3 4')).toBe('97.3 4');
    expect(fixDashArray('0,0')).toBe('none');
    expect(fixDashArray('0 5')).toBe('0.01 5');
    expect(fixDashArray('3')).toBe('3 3');
    expect(fixDashArray('none')).toBe('none');
    expect(fixDashArray('-1 2')).toBe('none');
  });

  it('fixes attributes and style declarations', () => {
    expect(
      pdfSafeSvg('<path stroke-dasharray="0 0 9 4"/><g style="stroke-dasharray: 0 0;fill:red">'),
    ).toBe('<path stroke-dasharray="9 4"/><g style="stroke-dasharray: none;fill:red">');
  });
});
