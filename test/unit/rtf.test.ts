import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { MarkdownEngine } from '../../src/core/MarkdownEngine';
import { collectRtfAssets } from '../../src/core/rtf/assets';
import { escapeRtf } from '../../src/core/rtf/escape';
import { imageToRtf, readImage } from '../../src/core/rtf/images';
import { bookmarkName, renderRtf, type RtfOptions } from '../../src/core/rtf/RtfRenderer';

const fixtures = path.resolve(__dirname, '../fixtures');
const options: RtfOptions = {
  title: 'Doc',
  fontFamily: 'Calibri',
  codeFontFamily: 'Consolas',
  fontSize: 11,
  page: {
    width: 11906,
    height: 16838,
    margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
  },
};

let engine: MarkdownEngine;
beforeAll(async () => {
  engine = await MarkdownEngine.create({ allowHtml: false, math: true, mermaid: true });
});

function rtf(markdown: string, extra: Partial<RtfOptions> = {}) {
  return renderRtf(engine.parse(markdown).tokens, { ...options, ...extra });
}

/** Every `{` closed, never more `}` than opened (ignoring escaped braces). */
function braceDepthOk(text: string): boolean {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
      continue;
    }
    if (text[i] === '{') depth++;
    if (text[i] === '}' && --depth < 0) return false;
  }
  return depth === 0;
}

describe('escapeRtf', () => {
  it('escapes control characters', () => {
    expect(escapeRtf('a\\b{c}')).toBe('a\\\\b\\{c\\}');
    expect(escapeRtf('a\tb\nc')).toBe('a\\tab b\\line c');
  });

  it('keeps the first space of a run and makes the rest non-breaking', () => {
    expect(escapeRtf('a b')).toBe('a b');
    expect(escapeRtf('a  b')).toBe('a \\~b');
    expect(escapeRtf('    x')).toBe(' \\~\\~\\~x');
  });

  it('collapses repeated spaces in prose but not in code', () => {
    const { rtf: out } = rtf('a   b `c   d`');
    expect(out).toContain('a b {\\f1');
    expect(out).toContain('c \\~\\~d}');
  });

  it('encodes non-ASCII as signed 16-bit \\u escapes', () => {
    expect(escapeRtf('ção')).toBe('\\u231?\\u227?o');
    expect(escapeRtf('日')).toBe('\\u26085?');
    expect(escapeRtf('￿')).toBe('\\u-1?');
  });

  it('splits astral characters into surrogate pairs', () => {
    // U+1F389 -> D83C DF89
    expect(escapeRtf('🎉')).toBe('\\u-10180?\\u-8311?');
  });
});

describe('images', () => {
  const png = fs.readFileSync(path.join(fixtures, 'assets/banner.png'));

  it('reads PNG dimensions', () => {
    expect(readImage(png)).toMatchObject({ kind: 'png', width: 160, height: 48 });
  });

  it('reads JPEG dimensions from the SOF marker', () => {
    // SOI, APP0 (len 16), SOF0 (height 0x0102, width 0x0304)
    const jpeg = new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xe0,
      0x00,
      0x10,
      ...new Array(14).fill(0),
      0xff,
      0xc0,
      0x00,
      0x11,
      0x08,
      0x01,
      0x02,
      0x03,
      0x04,
      0x03,
      ...new Array(9).fill(0),
    ]);
    expect(readImage(jpeg)).toMatchObject({ kind: 'jpeg', width: 0x0304, height: 0x0102 });
  });

  it('rejects other formats', () => {
    expect(readImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeUndefined();
    expect(readImage(Buffer.from('GIF89a......'))).toBeUndefined();
  });

  it('embeds as hex and shrinks to the available width', () => {
    const image = readImage(png)!;
    const natural = imageToRtf(image, 100_000);
    expect(natural).toMatch(
      /^\{\\pict\\pngblip\\picw160\\pich48\\picwgoal2400\\pichgoal720\n89504e47/,
    );
    expect(imageToRtf(image, 1200)).toContain('\\picwgoal1200\\pichgoal360');
  });

  it('sizes 2x captures by their display size and lowers by their depth', () => {
    const image = { ...readImage(png)!, display: { width: 80, height: 24 }, depth: 4 };
    const out = imageToRtf(image, 100_000);
    // 80x24 CSS px -> 1200x360 twips; 4px depth = 3pt = 6 half-points.
    expect(out).toMatch(/^\{\\dn6\{\\pict\\pngblip\\picw160\\pich48\\picwgoal1200\\pichgoal360\n/);
    // Shrinking scales the depth too.
    expect(imageToRtf(image, 600)).toMatch(/^\{\\dn3\{\\pict.*\\picwgoal600\\pichgoal180\n/);
  });
});

describe('collectRtfAssets', () => {
  it('lists images, formulas and diagrams once each', () => {
    const md = [
      '![a](a.svg) ![a](a.svg) ![b](https://x/b.gif)',
      '',
      'Inline $x$ and $x$.',
      '',
      '$$',
      'y',
      '$$',
      '',
      '```math',
      'z',
      '```',
      '',
      '```mermaid',
      'graph TD; A',
      '```',
    ].join('\n');
    const assets = collectRtfAssets(engine.parse(md).tokens, { math: true, mermaid: true });
    expect([...assets.images]).toEqual(['a.svg', 'https://x/b.gif']);
    expect(assets.graphics).toEqual([
      { kind: 'math-inline', source: 'x' },
      { kind: 'math-block', source: 'y' },
      { kind: 'math-block', source: 'z' },
      { kind: 'mermaid', source: 'graph TD; A\n' },
    ]);
  });

  it('skips diagrams when Mermaid is disabled', () => {
    const assets = collectRtfAssets(engine.parse('```mermaid\nA\n```').tokens, {
      math: true,
      mermaid: false,
    });
    expect(assets.graphics).toEqual([]);
  });
});

describe('bookmarkName', () => {
  it('keeps Word-safe characters only', () => {
    expect(bookmarkName('seção-1')).toBe('_secao_1');
    expect(bookmarkName('a'.repeat(60))).toHaveLength(40);
  });
});

describe('renderRtf', () => {
  it('produces a well-formed document with page setup and metadata', () => {
    const { rtf: out } = rtf('# Title\n\nText');
    expect(out.startsWith('{\\rtf1\\ansi')).toBe(true);
    expect(out).toContain(
      '{\\fonttbl{\\f0\\fswiss\\fcharset0 Calibri;}{\\f1\\fmodern\\fcharset0 Consolas;}}',
    );
    expect(out).toContain('{\\info{\\title Doc}}');
    expect(out).toContain('\\paperw11906\\paperh16838\\margl1134');
    expect(braceDepthOk(out)).toBe(true);
    expect([...out].every((ch) => ch.charCodeAt(0) < 0x80)).toBe(true);
  });

  it('marks headings with outline levels and bookmarks', () => {
    const { rtf: out } = rtf('## Seção Dois');
    expect(out).toContain('\\s2\\outlinelevel1\\keepn');
    expect(out).toContain(
      '{\\*\\bkmkstart _secao_dois}{\\*\\bkmkend _secao_dois}Se\\u231?\\u227?o Dois\\par',
    );
  });

  it('renders inline formatting', () => {
    const { rtf: out } = rtf('**b** _i_ ~~s~~ `c`');
    expect(out).toContain('{\\b b} {\\i i} {\\strike s} {\\f1\\fs19\\chcbpat3 c}');
  });

  it('renders external and internal links as fields', () => {
    const { rtf: out } = rtf('[x](https://a.com/?q="1") [y](#seção)');
    expect(out).toContain('{\\field{\\*\\fldinst{HYPERLINK "https://a.com/?q=%221%22"}}');
    expect(out).toContain(
      '{\\field{\\*\\fldinst{HYPERLINK \\\\l "_secao"}}{\\fldrslt{\\ul\\cf2 y}}}',
    );
  });

  it('renders nested lists, numbering and task items', () => {
    const { rtf: out } = rtf('- a\n  - b\n\n3. x\n4. y\n\n- [ ] t\n- [x] d\n');
    expect(out).toContain('\\li360\\fi-360\\tx360 \\u8226?\\tab a');
    expect(out).toContain('\\li720\\fi-360\\tx720 \\u9702?\\tab b');
    expect(out).toContain('\\tab x');
    expect(out).toMatch(/ 3\.\\tab x/);
    expect(out).toMatch(/ 4\.\\tab y/);
    expect(out).toContain('\\tab \\u9744? t');
    expect(out).toContain('\\tab \\u9745? d');
  });

  it('renders code blocks with line breaks and escaped content', () => {
    const { rtf: out } = rtf('```js\nif (a) {\n  b();\n}\n```');
    // `\line ` + two spaces of indentation: one plain space, then a non-breaking one.
    expect(out).toContain('\\cbpat3 {\\f1\\fs19 if (a) \\{\\line  \\~b();\\line \\}}\\par');
  });

  it('renders tables with header row, borders and alignment', () => {
    const { rtf: out } = rtf('| A | B |\n|:-:|--:|\n| 1 | 2 |\n');
    expect(out).toContain('\\trowd\\trgaph108\\trleft0\\trhdr');
    expect(out).toContain('\\clcbpat3\\cellx');
    expect(out).toContain('\\intbl\\qc\\f0\\fs22\\cf1 {\\b A}\\cell');
    expect(out).toContain('\\intbl\\qr\\f0\\fs22\\cf1 2\\cell');
    expect(out.match(/\\row/g)).toHaveLength(2);
  });

  it('indents and borders blockquotes', () => {
    const { rtf: out } = rtf('> quoted');
    expect(out).toContain('\\cf4\\sa160\\li360\\brdrl\\brdrs');
  });

  it('renders footnotes as superscripts plus a numbered list', () => {
    const { rtf: out } = rtf('Text[^n]\n\n[^n]: Note\n');
    expect(out).toContain('Text{\\super 1}');
    expect(out).toMatch(/1\.\\tab Note/);
  });

  it('degrades mermaid, math, raw HTML and missing images with warnings', () => {
    const result = rtf('```mermaid\nA-->B\n```\n\n$x$\n\n<div>h</div>\n\n![alt](missing.png)\n');
    expect(result.warnings.sort()).toEqual(['image', 'math', 'mermaid']);
    expect(result.rtf).toContain('A-->B');
    expect(result.rtf).toContain('{\\f1 x}');
    expect(result.rtf).toContain('[alt]');
  });

  it('ignores HTML comments silently', () => {
    expect(rtf('<!-- toc -->\n\nText').warnings).toEqual([]);
  });

  it('embeds loaded images', () => {
    const image = readImage(fs.readFileSync(path.join(fixtures, 'assets/banner.png')))!;
    const result = rtf('![b](banner.png)', {
      loadImage: (src) => (src === 'banner.png' ? image : undefined),
    });
    expect(result.rtf).toContain('{\\pict\\pngblip');
    expect(result.warnings).toEqual([]);
  });

  it('embeds rendered formulas and diagrams instead of their source', () => {
    const image = readImage(fs.readFileSync(path.join(fixtures, 'assets/banner.png')))!;
    const asked: string[] = [];
    const result = rtf('Inline $x^2$\n\n$$\ny\n$$\n\n```mermaid\nA-->B\n```\n', {
      loadGraphic: (kind, source) => {
        asked.push(`${kind}:${source.trim()}`);
        return image;
      },
    });
    expect(asked).toEqual(['math-inline:x^2', 'math-block:y', 'mermaid:A-->B']);
    expect(result.warnings).toEqual([]);
    expect(result.rtf.match(/\\pict\\pngblip/g)).toHaveLength(3);
    expect(result.rtf).toContain('\\qc {\\pict'); // block graphics are centered
    expect(result.rtf).not.toContain('A-->B');
    expect(result.rtf).not.toContain('{\\f1 x^2}');
  });

  it('falls back to source when a graphic is not available', () => {
    const result = rtf('$x$\n\n```mermaid\nA\n```', { loadGraphic: () => undefined });
    expect(result.warnings.sort()).toEqual(['math', 'mermaid']);
    expect(result.rtf).toContain('{\\f1 x}');
  });

  it('switches to landscape when the page is wider than tall', () => {
    const { rtf: out } = rtf('x', {
      page: { ...options.page, width: 16838, height: 11906 },
    });
    expect(out).toContain('\\landscape');
  });

  it('matches the golden kitchen-sink export', () => {
    const markdown = fs.readFileSync(path.join(fixtures, 'kitchen-sink.md'), 'utf8');
    const banner = readImage(fs.readFileSync(path.join(fixtures, 'assets/banner.png')))!;
    const { rtf: out } = rtf(markdown, {
      title: 'Kitchen sink',
      loadImage: (src) => (src === 'assets/banner.png' ? banner : undefined),
    });
    expect(braceDepthOk(out)).toBe(true);
    const golden = path.join(fixtures, 'golden/kitchen-sink.rtf');
    if (process.env.UPDATE_GOLDEN || !fs.existsSync(golden)) {
      fs.mkdirSync(path.dirname(golden), { recursive: true });
      fs.writeFileSync(golden, out);
    }
    expect(out).toBe(fs.readFileSync(golden, 'utf8'));
  });
});
