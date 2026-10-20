import { describe, expect, it } from 'vitest';
import { buildExportHtml, type ExportHtmlOptions } from '../../src/core/exportHtml';

const base: ExportHtmlOptions = {
  title: 'A <b>title</b>',
  lang: 'pt-br',
  bodyHtml: '<p>Body</p>',
  stylesheets: ['file:///a.css', 'file:///b.css?x="y"'],
  mermaidScript: 'file:///mermaid.min.js',
  nonce: 'abc123',
};

describe('buildExportHtml', () => {
  it('builds a light-themed document with escaped metadata', () => {
    const html = buildExportHtml(base);
    expect(html).toContain('<html lang="pt-br" data-theme="light">');
    expect(html).toContain('<title>A &lt;b&gt;title&lt;/b&gt;</title>');
    expect(html).toContain('<link rel="stylesheet" href="file:///a.css">');
    expect(html).toContain('href="file:///b.css?x=&quot;y&quot;"');
    expect(html).toContain('<p>Body</p>');
  });

  it('only allows scripts carrying the nonce', () => {
    const html = buildExportHtml(base);
    expect(html).toContain("script-src 'nonce-abc123'");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('<script nonce="abc123">');
    expect(html).toContain('window.__mdToolReady = true');
  });

  it('loads mermaid only when the body has diagrams', () => {
    expect(buildExportHtml(base)).not.toContain('mermaid.min.js');
    const withDiagram = buildExportHtml({
      ...base,
      bodyHtml: '<pre class="mermaid">graph TD; A</pre>',
    });
    expect(withDiagram).toContain('<script nonce="abc123" src="file:///mermaid.min.js"></script>');
  });
});
