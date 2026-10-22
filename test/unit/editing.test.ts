import { beforeAll, describe, expect, it } from 'vitest';
import { applyEdits } from '../../src/core/edit/edits';
import {
  insertLink,
  linkSelectedUrls,
  looksLikeUrl,
  markdownLink,
} from '../../src/core/edit/links';
import { continueList } from '../../src/core/edit/lists';
import {
  displayWidth,
  findTables,
  formatTable,
  formatTables,
  isInTable,
  splitRow,
} from '../../src/core/edit/table';
import { buildToc, findToc, TOC_END, TOC_START, tocEdit } from '../../src/core/edit/toc';
import { MarkdownEngine } from '../../src/core/MarkdownEngine';
import { parse, run } from './cursors';

describe('continueList', () => {
  const enter = (marked: string) => {
    const { text, selections } = parse(marked);
    const result = continueList(text, selections);
    return result ? run(marked, () => result) : 'default';
  };

  it.each([
    ['- item|', '- item\n- |'],
    ['* item|', '* item\n* |'],
    ['+ item|', '+ item\n+ |'],
    ['1. one|', '1. one\n2. |'],
    ['9) nine|', '9) nine\n10) |'],
    ['- [x] done|', '- [x] done\n- [ ] |'],
    ['1. [ ] task|', '1. [ ] task\n2. [ ] |'],
    ['  - nested|', '  - nested\n  - |'],
    ['> - quoted|', '> - quoted\n> - |'],
    // splits the item at the cursor
    ['- one| two', '- one\n- | two'],
    // keeps the original spacing after the marker
    ['-   wide|', '-   wide\n-   |'],
  ])('%s -> %s', (input, expected) => {
    expect(enter(input)).toBe(expected);
  });

  it.each([
    ['- |', '|'],
    ['1. |', '|'],
    ['- [ ] |', '|'],
    ['  - |', '|'],
    ['> - |', '>|'],
  ])('ends the list on an empty item: %s -> %s', (input, expected) => {
    expect(enter(input)).toBe(expected);
  });

  it('continues and ends block quotes', () => {
    expect(enter('> quote|')).toBe('> quote\n> |');
    expect(enter('>quote|')).toBe('>quote\n> |');
    expect(enter('> |')).toBe('|');
  });

  it('keeps the default Enter outside lists, inside markers and with selections', () => {
    expect(enter('plain|')).toBe('default');
    expect(enter('-| item')).toBe('default');
    expect(enter('- «item»')).toBe('default');
    expect(enter('- a|\nplain|')).toBe('default');
  });

  it('handles several cursors', () => {
    expect(enter('- a|\n- b|')).toBe('- a\n- |\n- b\n- |');
  });

  it("inserts the document's own line ending (CRLF)", () => {
    expect(enter('- a|\r\n- b')).toBe('- a\r\n- |\r\n- b');
  });
});

describe('tables', () => {
  it('measures display width', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('ção')).toBe(3);
    expect(displayWidth('é')).toBe(1); // e + combining accent
    expect(displayWidth('日本')).toBe(4);
    expect(displayWidth('🎉')).toBe(2);
    expect(displayWidth('👍🏽')).toBe(2);
  });

  it('splits rows, keeping escaped pipes and pipes in code', () => {
    expect(splitRow('| a | b |')).toEqual(['a', 'b']);
    expect(splitRow('a | b')).toEqual(['a', 'b']);
    expect(splitRow('| a \\| b | `x|y` |')).toEqual(['a \\| b', '`x|y`']);
    expect(splitRow('| a | |')).toEqual(['a', '']);
  });

  it('finds tables outside code fences', () => {
    const lines = [
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '```',
      '| x | y |',
      '|---|---|',
      '```',
      'a | b',
      '-- | --',
      'not a table',
    ];
    expect(findTables(lines)).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 10 },
    ]);
  });

  it('requires a delimiter row with the same column count', () => {
    expect(findTables(['| a | b |', '|---|', '| 1 | 2 |'])).toEqual([]);
  });

  it('aligns columns by display width and keeps alignment markers', () => {
    expect(
      formatTable(['|Nome|Idade|Cidade|', '|:-|-:|:-:|', '|João|30|São Paulo|', '|日本|5|🎉|']),
    ).toEqual([
      '| Nome | Idade |  Cidade   |',
      '| :--- | ----: | :-------: |',
      '| João |    30 | São Paulo |',
      '| 日本 |     5 |    🎉     |',
    ]);
  });

  it('pads short rows and keeps the indentation', () => {
    expect(formatTable(['  | a | b |', '  |---|---|', '  | 1 |'])).toEqual([
      '  | a   | b   |',
      '  | --- | --- |',
      '  | 1   |     |',
    ]);
  });

  it('formats every table, or only the one at the cursor', () => {
    const text = 'Intro\n\n|a|b|\n|-|-|\n|1|2|\n\ntext\n\n|c|\n|-|\n|3|\n';
    const all = formatTables(text);
    expect(all).toHaveLength(2);
    expect(applyEdits(text, all)).toBe(
      'Intro\n\n| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\ntext\n\n| c   |\n| --- |\n| 3   |\n',
    );
    const second = formatTables(text, text.indexOf('|c|') + 1);
    expect(second).toHaveLength(1);
    expect(applyEdits(text, second)).toContain('|a|b|');
    expect(formatTables(applyEdits(text, all))).toEqual([]); // idempotent
  });

  it('knows whether an offset is inside a table', () => {
    const text = 'x\n\n|a|\n|-|\n|1|\n\ny';
    expect(isInTable(text, text.indexOf('|1|'))).toBe(true);
    expect(isInTable(text, text.indexOf('|-|') + 3)).toBe(true);
    expect(isInTable(text, 0)).toBe(false);
    expect(isInTable(text, text.length)).toBe(false);
  });

  it('preserves CRLF line endings', () => {
    const text = '|a|\r\n|-|\r\n|1|\r\n';
    expect(applyEdits(text, formatTables(text))).toBe('| a   |\r\n| --- |\r\n| 1   |\r\n');
  });
});

describe('table of contents', () => {
  let engine: MarkdownEngine;
  beforeAll(async () => {
    engine = await MarkdownEngine.create({ allowHtml: false, math: true, mermaid: true });
  });

  const doc = [
    '# Title',
    '',
    TOC_START,
    TOC_END,
    '',
    '## Intro [beta]',
    '### Details',
    '#### Too deep',
    '## Seção',
    '## Seção',
    '```',
    '## not a heading',
    '```',
  ].join('\n');

  it('finds the markers outside code fences', () => {
    expect(findToc(['```', TOC_START, '```', TOC_START, 'x', TOC_END])).toEqual({
      start: 3,
      end: 5,
    });
    expect(findToc(['x', TOC_START])).toEqual({ start: 1 });
    expect(findToc(['x'])).toBeUndefined();
  });

  it('builds a nested list with the preview slugs', () => {
    const { headings } = engine.parse(doc);
    expect(buildToc(headings, { minLevel: 2, maxLevel: 3 })).toEqual([
      '- [Intro \\[beta\\]](#intro-beta)',
      '  - [Details](#details)',
      '- [Seção](#seção)',
      '- [Seção](#seção-1)',
    ]);
  });

  it('fills existing markers and is stable once up to date', () => {
    const { headings } = engine.parse(doc);
    const edit = tocEdit(doc, headings, { minLevel: 2, maxLevel: 2 })!;
    const updated = applyEdits(doc, [edit]);
    expect(updated).toContain(
      `${TOC_START}\n- [Intro \\[beta\\]](#intro-beta)\n- [Seção](#seção)\n- [Seção](#seção-1)\n${TOC_END}`,
    );
    expect(tocEdit(updated, engine.parse(updated).headings, { minLevel: 2, maxLevel: 2 })).toBe(
      undefined,
    );
  });

  it('inserts a marked block where asked when there are no markers', () => {
    const text = '# A\n\n## B\n';
    const { headings } = engine.parse(text);
    const edit = tocEdit(text, headings, { minLevel: 1, maxLevel: 2 }, 5)!;
    expect(applyEdits(text, [edit])).toBe(
      `# A\n\n${TOC_START}\n- [A](#a)\n  - [B](#b)\n${TOC_END}\n## B\n`,
    );
    expect(tocEdit(text, headings, { minLevel: 1, maxLevel: 2 })).toBeUndefined();
  });

  it('never inserts before or inside front matter', () => {
    const text = '---\ntitle: Doc\n---\n## A\n';
    const { headings } = engine.parse(text);
    for (const at of [0, 4, text.indexOf('## A')]) {
      const edit = tocEdit(text, headings, { minLevel: 2, maxLevel: 3 }, at)!;
      expect(applyEdits(text, [edit])).toBe(
        `---\ntitle: Doc\n---\n${TOC_START}\n- [A](#a)\n${TOC_END}\n## A\n`,
      );
    }
  });

  it('adds a missing closing marker', () => {
    const text = `${TOC_START}\n\n## A\n`;
    const edit = tocEdit(text, engine.parse(text).headings, { minLevel: 2, maxLevel: 3 })!;
    expect(applyEdits(text, [edit])).toBe(`${TOC_START}\n- [A](#a)\n${TOC_END}\n\n## A\n`);
  });

  it('does not let a setext heading swallow the closing marker', () => {
    const { html, headings } = engine.render(`${TOC_START}\n- [a](#a)\n${TOC_END}\nTitle\n=====\n`);
    expect(html).toContain('<h1 id="title" data-line="3">Title</h1>');
    expect(headings.map((h) => h.slug)).toEqual(['title']);
  });

  it('hides the markers in the rendered HTML', () => {
    const { html } = engine.render(
      `${TOC_START}\n- [A](#a)\n${TOC_END}\n\n<!-- multi\nline -->\n\nText <!-- inline --> here`,
    );
    expect(html).not.toContain('toc');
    expect(html).not.toContain('multi');
    expect(html).toContain('Text &lt;!-- inline --&gt; here'); // inline HTML stays escaped
    expect(html).toContain('<a href="#a">A</a>');
  });
});

describe('links', () => {
  it('builds links, escaping labels and awkward URLs', () => {
    expect(markdownLink('a [b]', 'https://x.com/a')).toBe('[a \\[b\\]](https://x.com/a)');
    expect(markdownLink('a', 'my file.md')).toBe('[a](<my file.md>)');
    expect(markdownLink('a', 'https://x.com/(a)')).toBe('[a](https://x.com/(a))');
    expect(markdownLink('a', 'https://x.com/a)')).toBe('[a](<https://x.com/a)>)');
  });

  it('recognises URLs', () => {
    expect(looksLikeUrl('https://example.com/x?y=1')).toBe(true);
    expect(looksLikeUrl(' www.example.com ')).toBe(true);
    expect(looksLikeUrl('mailto:a@b.c')).toBe(true);
    expect(looksLikeUrl('example')).toBe(false);
    expect(looksLikeUrl('https://a.com b')).toBe(false);
  });

  it('links each selection, or inserts an empty label at cursors', () => {
    expect(run('see «docs» and |', (t, s) => insertLink(t, s, 'https://d.io'))).toBe(
      'see [docs](https://d.io)| and [|](https://d.io)',
    );
  });

  it('turns selected URLs into links with the cursor on the label', () => {
    expect(run('«https://d.io»', linkSelectedUrls)).toBe('[|](https://d.io)');
  });
});
