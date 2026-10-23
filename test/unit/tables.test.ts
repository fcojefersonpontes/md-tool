import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { previewFontSize } from '../../src/core/exportOptions';
import { FontIndex, resolveFonts } from '../../src/core/fonts/fontIndex';
import { MarkdownEngine } from '../../src/core/MarkdownEngine';
import { renderPdf } from '../../src/core/pdf/PdfRenderer';
import { renderRtf } from '../../src/core/rtf/RtfRenderer';

const fixture = path.resolve(__dirname, '../fixtures/tabela-6-colunas.md');
const MM = 72 / 25.4;
/** A4 with 20 mm margins, the default page. */
const page = {
  width: 595.28,
  height: 841.89,
  margin: { top: 20 * MM, right: 20 * MM, bottom: 20 * MM, left: 20 * MM },
};
const column = page.width - page.margin.left - page.margin.right;
const fontSize = previewFontSize(column);

/** Text that must never be split across lines: words, and the short cells. */
const WHOLE = [
  'Código',
  'Unidade',
  'Responsável',
  'Atendimentos',
  'Situação',
  'Observações',
  'Coordenação',
  'técnica',
  'Desativada',
  'reforma',
  '1.250',
  // Short cells stay on one line; only the observations wrap.
  'Unidade A',
  'Equipe técnica',
  'Em reforma',
];

let engine: MarkdownEngine;
beforeAll(async () => {
  engine = await MarkdownEngine.create({ allowHtml: false, math: true, mermaid: true });
});

describe('a table with six columns', () => {
  it('PDF: fits the page and keeps short words whole', async () => {
    const fonts = resolveFonts(
      FontIndex.scan(
        process.platform === 'win32'
          ? [path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts')]
          : ['/usr/share/fonts', '/System/Library/Fonts', '/Library/Fonts'],
      ),
      process.platform,
      { fontFamily: '', codeFontFamily: '' },
    );
    const markdown = fs.readFileSync(fixture, 'utf8');
    const result = await renderPdf(engine.parse(markdown).tokens, {
      page,
      fontSize,
      fonts,
      header: '',
      footer: '',
      loadImage: () => undefined,
      loadDiagram: () => undefined,
    });
    if (process.env.TABLE_OUT) fs.writeFileSync(`${process.env.TABLE_OUT}.pdf`, result.data);

    const pdf = await getDocument({ data: new Uint8Array(result.data), verbosity: 0 }).promise;
    const { items } = await (await pdf.getPage(1)).getTextContent();
    const texts = items.flatMap((item) => ('str' in item && item.str.trim() ? [item] : []));
    const lines = texts.map((item) => item.str);
    for (const word of WHOLE) {
      expect(
        lines.some((line) => line.includes(word)),
        word,
      ).toBe(true);
    }
    // Nothing is drawn past the right margin.
    for (const item of texts) {
      expect(item.transform[4] + item.width).toBeLessThanOrEqual(
        page.width - page.margin.right + 1,
      );
    }
  });

  it('RTF: the long-text column gets the most room, and the table fits the page', () => {
    const markdown = fs.readFileSync(fixture, 'utf8');
    const twips = (points: number) => Math.round(points * 20);
    const { rtf } = renderRtf(engine.parse(markdown).tokens, {
      fontFamily: 'Segoe UI',
      codeFontFamily: 'Consolas',
      fontSize,
      page: {
        width: twips(page.width),
        height: twips(page.height),
        margin: {
          top: twips(page.margin.top),
          right: twips(page.margin.right),
          bottom: twips(page.margin.bottom),
          left: twips(page.margin.left),
        },
      },
    });
    if (process.env.TABLE_OUT) fs.writeFileSync(`${process.env.TABLE_OUT}.rtf`, rtf, 'ascii');

    const row = /\\trowd[^\n]*/.exec(rtf)![0];
    const edges = [...row.matchAll(/\\cellx(\d+)/g)].map((match) => Number(match[1]));
    expect(edges).toHaveLength(6);
    expect(edges[5]).toBeLessThanOrEqual(twips(column) + 1);
    const widths = edges.map((edge, i) => edge - (edges[i - 1] ?? 0));
    expect(Math.max(...widths)).toBe(widths[5]); // Observações
    // Short columns keep room for their longest word ("Atendimentos", in bold, at 0.68em).
    const em = fontSize * 20;
    expect(widths[3]).toBeGreaterThanOrEqual(12 * 0.68 * em);
  });
});
