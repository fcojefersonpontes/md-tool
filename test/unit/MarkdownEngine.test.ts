import { beforeAll, describe, expect, it } from 'vitest';
import { MarkdownEngine, type EngineOptions } from '../../src/core/MarkdownEngine';

const defaults: EngineOptions = { allowHtml: false, math: true, mermaid: true };

describe('MarkdownEngine', () => {
  let engine: MarkdownEngine;

  beforeAll(async () => {
    engine = await MarkdownEngine.create(defaults);
  });

  it('adds zero-based data-line to block elements', () => {
    const { html } = engine.render('# Title\n\nParagraph\n\n- a\n- b\n');
    expect(html).toContain('<h1 id="title" data-line="0">');
    expect(html).toContain('<p data-line="2">Paragraph</p>');
    expect(html).toContain('<ul data-line="4">');
    expect(html).toContain('<li data-line="5">');
  });

  it('gives headings unique GitHub-style ids and reports them', () => {
    const { html, headings } = engine.render('# Olá, Mundo!\n\n## Seção\n\n## Seção\n');
    expect(html).toContain('id="olá-mundo"');
    expect(headings).toEqual([
      { level: 1, text: 'Olá, Mundo!', slug: 'olá-mundo', line: 0 },
      { level: 2, text: 'Seção', slug: 'seção', line: 2 },
      { level: 2, text: 'Seção', slug: 'seção-1', line: 4 },
    ]);
  });

  it('renders task lists with checkboxes pointing at the item line', () => {
    const { html } = engine.render('Intro\n\n- [ ] todo\n- [x] done\n- plain\n');
    expect(html).toContain('<ul class="contains-task-list" data-line="2">');
    expect(html).toContain(
      '<li class="task-list-item" data-line="2"><input type="checkbox" class="task-list-item-checkbox" data-line="2"> todo</li>',
    );
    expect(html).toContain('data-line="3" checked> done');
    expect(html).toContain('<li data-line="4">plain</li>');
  });

  it('does not treat brackets mid-text as tasks', () => {
    const { html } = engine.render('- [link]\n- [ ]not-a-task\n');
    expect(html).not.toContain('checkbox');
  });

  it('highlights known languages, including aliases, and keeps data-line', () => {
    const { html } = engine.render('```ts\nconst a = 1;\n```\n\n```js\nlet b;\n```\n');
    expect(html).toMatch(/<pre data-line="0" class="shiki/);
    expect(html).toMatch(/<pre data-line="4" class="shiki/);
    expect(html).toContain('--shiki-dark');
  });

  it('falls back to escaped plain code for unknown languages', () => {
    const { html } = engine.render('```nope\n<b>x</b>\n```\n');
    expect(html).toContain('<pre><code data-line="0" class="language-nope">&lt;b&gt;x&lt;/b&gt;');
  });

  it('emits mermaid blocks for client-side rendering', () => {
    const { html } = engine.render('```mermaid\ngraph TD; A-->B\n```\n');
    expect(html).toContain('<pre class="mermaid" data-line="0">graph TD; A--&gt;B\n</pre>');
  });

  it('renders inline and block math with KaTeX', () => {
    const { html } = engine.render('Inline $x^2$\n\n$$\n\\frac{a}{b}\n$$\n');
    expect(html).toContain('class="katex"');
    expect(html).toContain('katex-display');
  });

  it('renders math with our KaTeX, whose stylesheet is the one shipped', () => {
    // 0.19 renamed .strut to .katex-strut; the plugin's own 0.16 copy emits the old name.
    const { html } = engine.render('$R_2$');
    expect(html).toContain('class="katex-strut"');
    expect(html).not.toContain('class="strut"');
  });

  it('renders footnotes', () => {
    const { html } = engine.render('Text[^1]\n\n[^1]: Note\n');
    expect(html).toContain('class="footnotes"');
    expect(html).toContain('href="#fn1"');
  });

  it('hides front matter and returns it raw', () => {
    const result = engine.render('---\ntitle: Doc\n---\n\n# Body\n');
    expect(result.frontMatter).toBe('title: Doc');
    expect(result.html).not.toContain('title: Doc');
    expect(result.html).toContain('<h1 id="body" data-line="4">');
  });

  it('escapes raw HTML unless allowed', async () => {
    expect(engine.render('<script>x</script>').html).toContain('&lt;script&gt;');
    const html = await MarkdownEngine.create({ ...defaults, allowHtml: true });
    expect(html.render('<div>ok</div>').html).toContain('<div>ok</div>');
  });

  it('passes image sources through resolveResource', () => {
    const { html } = engine.render('![alt](img/a%20b.png)', {
      resolveResource: (src) => `resolved:${src}`,
    });
    expect(html).toContain('src="resolved:img/a%20b.png"');
  });

  it('can disable math and mermaid', async () => {
    const plain = await MarkdownEngine.create({ ...defaults, math: false, mermaid: false });
    const { html } = plain.render('$x$\n\n```mermaid\nA\n```\n');
    expect(html).not.toContain('katex');
    expect(html).not.toContain('class="mermaid"');
  });
});
