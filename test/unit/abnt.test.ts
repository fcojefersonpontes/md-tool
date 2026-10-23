import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { ABNT, DEFAULT_ABNT_OPTIONS, type AbntOptions } from '../../src/core/abnt/profile';
import { alineaLetter, analyzeAbnt } from '../../src/core/abnt/structure';
import { parseDocumentMeta } from '../../src/core/exportOptions';
import { familyNames, FontIndex, resolveFonts } from '../../src/core/fonts/fontIndex';
import { readImage } from '../../src/core/rtf/images';
import { MarkdownEngine } from '../../src/core/MarkdownEngine';
import { type PdfRenderOptions, renderPdf } from '../../src/core/pdf/PdfRenderer';
import { rtfToHtml } from '../../src/core/rtf/RtfReader';
import { renderRtf } from '../../src/core/rtf/RtfRenderer';

const root = path.resolve(__dirname, '../..');
const CM = 72 / 2.54;

let engine: MarkdownEngine;
beforeAll(async () => {
  engine = await MarkdownEngine.create({ allowHtml: false, math: true, mermaid: true });
});

function analyze(markdown: string, options: Partial<AbntOptions> = {}) {
  const parsed = engine.parse(markdown);
  const meta = parseDocumentMeta(parsed.frontMatter);
  const plan = analyzeAbnt(parsed.tokens, { ...DEFAULT_ABNT_OPTIONS, ...options }, meta);
  return { tokens: parsed.tokens, plan, meta };
}

describe('analyzeAbnt', () => {
  it('numbers sections progressively, leaving the title and ABNT titles unnumbered', () => {
    const { tokens, plan, meta } = analyze(
      '# Relatório\n\n## Introdução\n\n### Contexto\n\n### Objetivos\n\n#### Geral\n\n' +
        '## Método\n\n## Referências\n\n## Anexo A – Mapas\n\n## Lista {.unnumbered}\n',
    );
    const headings = [...plan.headings].map(([i, h]) => [tokens[i + 1].content, h.role, h.number]);
    expect(headings).toEqual([
      ['RELATÓRIO', 'title', undefined],
      ['INTRODUÇÃO', 'section', '1'],
      ['CONTEXTO', 'section', '1.1'],
      ['OBJETIVOS', 'section', '1.2'],
      ['Geral', 'section', '1.2.1'],
      ['MÉTODO', 'section', '2'],
      ['REFERÊNCIAS', 'unnumbered', undefined],
      ['ANEXO A – MAPAS', 'unnumbered', undefined],
      ['LISTA', 'unnumbered', undefined],
    ]);
    expect(plan.warnings).toEqual([]);
    expect(meta.profile).toBeUndefined();
  });

  it('can leave sections unnumbered, and warns about skipped levels', () => {
    const { plan } = analyze('## A\n\n#### B\n', { numberSections: false });
    expect([...plan.headings.values()].map((h) => h.number)).toEqual([undefined, undefined]);
    expect(plan.warnings).toEqual(['heading-level']);
  });

  it('pairs tables and figures with their identification and source', () => {
    const { tokens, plan } = analyze(
      'Tabela: Atendimentos\n\n| a |\n| - |\n| 1 |\n\nFonte: dados do exemplo (2026).\n\n' +
        '| b |\n| - |\n| 2 |\n\n' +
        '![Gráfico: Evolução](g.png "IBGE (2020).")\n\n' +
        '![Mapa da rede](m.png)\n\n' +
        'Quadro: Código\n\n```js\nx\n```\n',
    );
    const captions = [...plan.captions].map(([i, c]) => ({
      at: tokens[i].type,
      label: `${c.kind} ${c.number}`,
      title: c.title.map((t) => t.content).join(''),
      source: c.source?.map((t) => t.content).join(''),
    }));
    expect(captions).toEqual([
      {
        at: 'table_open',
        label: 'Tabela 1',
        title: 'Atendimentos',
        source: 'Fonte: dados do exemplo (2026).',
      },
      {
        at: 'paragraph_open',
        label: 'Gráfico 1',
        title: 'Evolução',
        source: 'Fonte: IBGE (2020).',
      },
      { at: 'paragraph_open', label: 'Figura 1', title: 'Mapa da rede', source: undefined },
      { at: 'fence', label: 'Quadro 1', title: 'Código', source: undefined },
    ]);
    expect(plan.figures.size).toBe(2);
    // The caption and source paragraphs are drawn with their element.
    expect([...plan.skip].map((i) => tokens[i + 1].content)).toEqual([
      'Tabela: Atendimentos',
      'Fonte: dados do exemplo (2026).',
      'Quadro: Código',
    ]);
    expect(plan.warnings).toEqual(['source']);
  });

  it('collects footnotes and the identification from the front matter', () => {
    const { plan, meta } = analyze(
      '---\ntitulo: Parecer\nperfil: abnt\nautor: Fulano\ndata: 2026\n' +
        'abnt:\n  hr: linha\n  lista_nao_ordenada: marcador\n---\n\nTexto.[^a]\n\n[^a]: Nota *um*.\n',
    );
    expect(meta.profile).toBe('abnt');
    expect(meta.abnt).toEqual({ rule: 'linha', unorderedList: 'marcador' });
    expect(plan.title).toBe('PARECER');
    expect(plan.identification).toEqual(['Fulano', '2026']);
    expect([...plan.notes.keys()]).toEqual([1]);
    expect(plan.notes.get(1)![0].map((t) => t.type)).toEqual([
      'text',
      'em_open',
      'text',
      'em_close',
      'text',
    ]);
  });

  it('reads font family lists, CSS style', () => {
    expect(familyNames(`"Times New Roman", 'Liberation Serif' ,Tinos,,`)).toEqual([
      'Times New Roman',
      'Liberation Serif',
      'Tinos',
    ]);
  });

  it('letters alíneas past z', () => {
    expect([1, 2, 26, 27, 28, 52, 53].map(alineaLetter)).toEqual([
      'a',
      'b',
      'z',
      'aa',
      'ab',
      'az',
      'ba',
    ]);
  });
});

interface PageText {
  items: { text: string; x: number; y: number; size: number }[];
  height: number;
}

/** Text of each page, with positions in points from the top-left corner. */
async function pdfText(data: Uint8Array): Promise<PageText[]> {
  const pdf = await getDocument({ data: new Uint8Array(data), verbosity: 0 }).promise;
  const pages: PageText[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const { height } = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items
      .filter((item) => 'str' in item && item.str.trim())
      .map((item) => {
        const { str, transform } = item as { str: string; transform: number[] };
        return {
          text: str,
          x: transform[4],
          y: height - transform[5],
          size: Math.hypot(transform[0], transform[1]),
        };
      });
    pages.push({ items, height });
  }
  return pages;
}

describe('ABNT PDF', () => {
  const fonts = resolveFonts(
    FontIndex.scan(
      process.platform === 'win32'
        ? [path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts')]
        : ['/usr/share/fonts', '/System/Library/Fonts', '/Library/Fonts'],
    ),
    process.platform,
    { fontFamily: ABNT.font.family.join(', '), codeFontFamily: ABNT.font.mono.join(', ') },
  );
  const page = {
    width: 595.28,
    height: 841.89,
    margin: { top: 3 * CM, right: 2 * CM, bottom: 2 * CM, left: 3 * CM },
  };

  async function render(markdown: string, extra: Partial<PdfRenderOptions> = {}) {
    const parsed = engine.parse(markdown);
    const meta = parseDocumentMeta(parsed.frontMatter);
    const options = { ...DEFAULT_ABNT_OPTIONS, ...meta.abnt };
    const plan = analyzeAbnt(parsed.tokens, options, meta);
    const result = await renderPdf(parsed.tokens, {
      page,
      fontSize: ABNT.font.body,
      fonts,
      header: '',
      footer: '',
      loadImage: () => undefined,
      loadDiagram: () => undefined,
      abnt: { plan, options },
      ...extra,
    });
    return { ...result, pages: await pdfText(result.data), plan };
  }

  it('renders the sample document', async () => {
    const markdown = fs.readFileSync(path.join(root, 'test/fixtures/abnt.md'), 'utf8');
    const png = fs.readFileSync(path.join(root, 'test/fixtures/assets/banner.png'));
    const image = readImage(png)!;
    const { data, pages, warnings } = await render(markdown, {
      loadImage: () => ({ kind: 'png', data: png, width: image.width, height: image.height }),
    });
    if (process.env.ABNT_PDF) fs.writeFileSync(process.env.ABNT_PDF, data);
    expect(warnings).toEqual([]);
    const all = pages.flatMap((p) => p.items.map((item) => item.text)).join('\n');
    for (const text of [
      'RELATÓRIO DE ATIVIDADES',
      '1 INTRODUÇÃO',
      '1.1 CONTEXTO',
      '1.1.1 Objetivos específicos',
      'REFERÊNCIAS',
      'Tabela 1 – Atendimentos por unidade em 2026',
      'Quadro 1 – Serviços da rede',
      'Figura 1 – Logotipo do projeto',
      'a)',
      '–',
    ]) {
      expect(all).toContain(text);
    }
    // The page number: 2 cm from the top and right edges, in 10 pt.
    const number = pages[0].items.find((item) => item.text === '1' && item.y < 3 * CM)!;
    expect(number.size).toBeCloseTo(10, 0);
    expect(number.x).toBeGreaterThan(595.28 - 2 * CM - 8);
    // Body text starts at the left margin; the first line of a paragraph 1.25 cm in.
    const body = pages[0].items.filter((item) => item.size > 11.5 && item.y > 4 * CM);
    expect(Math.min(...body.map((item) => item.x))).toBeCloseTo(3 * CM, 0);
    const opening = pages[0].items.find((item) => item.text.startsWith('Este relatório'))!;
    expect(opening.x).toBeCloseTo(3 * CM + 1.25 * CM, 0);
  });

  it('places footnotes at the foot of the page that calls them', async () => {
    const filler = Array.from({ length: 30 }, (_, i) => `Parágrafo ${i} de enchimento.`).join(
      '\n\n',
    );
    const { pages } = await render(`${filler}\n\nChamada.[^n]\n\n${filler}\n\n[^n]: A nota.`);
    expect(pages.length).toBeGreaterThan(1);
    const withCall = pages.findIndex((p) => p.items.some((item) => item.text.includes('Chamada')));
    const note = pages[withCall].items.find((item) => item.text.includes('A nota.'));
    expect(note).toBeDefined();
    expect(note!.size).toBeCloseTo(10, 0);
    const lowest = Math.max(...pages[withCall].items.filter((i) => i !== note).map((i) => i.y));
    expect(note!.y).toBeGreaterThanOrEqual(lowest - 0.1);
    expect(note!.y).toBeLessThanOrEqual(841.89 - 2 * CM);
  });

  it('hides the first page number on request and breaks pages at rules', async () => {
    const { pages } = await render(
      '---\nabnt:\n  primeira_pagina_visivel: false\n---\n\nUm.\n\n---\n\nDois.\n',
    );
    expect(pages).toHaveLength(2);
    expect(pages[0].items.map((item) => item.text)).toEqual(['Um.']);
    expect(pages[1].items.map((item) => item.text).sort()).toEqual(['2', 'Dois.']);
  });
});

describe('ABNT RTF', () => {
  function render(markdown: string) {
    const parsed = engine.parse(markdown);
    const meta = parseDocumentMeta(parsed.frontMatter);
    const options = { ...DEFAULT_ABNT_OPTIONS, ...meta.abnt };
    const plan = analyzeAbnt(parsed.tokens, options, meta);
    return renderRtf(parsed.tokens, {
      title: 'Doc',
      fontFamily: 'Times New Roman',
      codeFontFamily: 'Courier New',
      fontSize: ABNT.font.body,
      page: {
        width: 11906,
        height: 16838,
        margin: { top: 1701, right: 1134, bottom: 1134, left: 1701 },
      },
      loadImage: () =>
        readImage(fs.readFileSync(path.join(root, 'test/fixtures/assets/banner.png'))),
      abnt: { plan, options },
    });
  }
  const sample = () => fs.readFileSync(path.join(root, 'test/fixtures/abnt.md'), 'utf8');

  it('renders the sample document', () => {
    const { rtf, warnings } = render(sample());
    if (process.env.ABNT_RTF) fs.writeFileSync(process.env.ABNT_RTF, rtf, 'ascii');
    expect(warnings).toEqual([]);
    // Page, type, hyphenation, footnotes and the page number.
    expect(rtf).toContain('\\margl1701\\margr1134\\margt1701\\margb1134');
    expect(rtf).toContain('{\\f0\\froman\\fcharset0 Times New Roman;}');
    expect(rtf).toContain('\\deflang1046');
    expect(rtf).toContain('\\hyphauto1\\ftnbj\\ftnnar\\ftnrstcont');
    expect(rtf).toContain(
      '\\headery1134{\\header\\pard\\plain\\qr\\f0\\fs20{\\field{\\*\\fldinst PAGE}',
    );
    // Body: justified, 1.5 lines, first-line indent of 1.25 cm.
    expect(rtf).toMatch(
      /\\pard\\plain\\qj\\f0\\lang1046\\sa0\\fs24\\sl360\\slmult1\\fi709 Este relat/,
    );
    // Numbered headings, the title aligned past the number.
    expect(rtf).toMatch(
      /\\s2\\outlinelevel1\\keepn\\sb414\\sa414[^ ]*\\ql\\b\\li\d+\\fi-\d+\\tx\d+ \{[^ ]+ [^}]+\}\{[^ ]+ [^}]+\}1\\tab INTRODU/,
    );
    // Alíneas and subalíneas.
    expect(rtf).toMatch(/\\fi-357\\tx1066 a\)\\tab levantar/);
    expect(rtf).toMatch(/\\fi-357\\tx1423 \\u8211\?\\tab por munic/);
    // Long quotation: 4 cm, 10 pt, single spacing.
    expect(rtf).toMatch(/\\fs20\\sl240\\slmult1\\li2268\\sb414 A organiza/);
    // Real footnotes.
    expect(rtf).toContain(
      '{\\cs16\\super\\chftn}{\\footnote\\pard\\plain\\s15\\qj\\f0\\fs20\\sl240\\slmult1',
    );
    expect(rtf).toContain('{\\s15\\sbasedon0\\qj\\li227\\fi-227');
    expect(rtf).not.toContain('{\\super 1}');
    // Captions; an IBGE table has rules only around the header and at the end.
    expect(rtf).toContain('Tabela 1 \\u8211? Atendimentos por unidade');
    expect(rtf).toContain('Fonte: dados do exemplo');
    const rule = (side: string) => `\\clbrdr${side}\\brdrs\\brdrw10\\brdrcf1`;
    expect(rtf).toContain(`\\trqc\\trhdr${rule('t')}${rule('b')}\\cellx`);
    expect(rtf).toMatch(/\\trqc\\cellx\d+\\cellx\d+\\cellx\d+\n/);
    // References: left, single-spaced.
    expect(rtf).toMatch(/\\ql\\sl240\\slmult1\\sa276 SILVA/);
  });

  it('reads back in the viewer', () => {
    const html = rtfToHtml(Buffer.from(render(sample()).rtf, 'ascii')).html;
    expect(html).toContain('RELATÓRIO DE ATIVIDADES');
    expect(html).toContain('A numeração progressiva segue a NBR 6024:2012.');
    expect(html).toMatch(/text-align:justify/);
    expect(html).toContain('line-height:1.73'); // 1.5 lines
  });

  it('breaks pages at rules and hides the first page number on request', () => {
    const { rtf } = render(
      '---\nabnt:\n  primeira_pagina_visivel: false\n---\n\nUm.\n\n---\n\nDois.\n',
    );
    expect(rtf).toContain('\\titlepg{\\header');
    expect(rtf).toContain('{\\headerf\\pard\\plain\\par}');
    expect(rtf).toMatch(/\\pagebb\\fi709 Dois\./);
  });
});
