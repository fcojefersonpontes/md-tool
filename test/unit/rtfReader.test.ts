import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { rtfToHtml } from '../../src/core/rtf/RtfReader';

const fixtures = path.resolve(__dirname, '../fixtures');

const html = (rtf: string) => rtfToHtml(Buffer.from(rtf, 'latin1')).html;
/** The visible text, without markup. */
const text = (rtf: string) =>
  html(rtf)
    .replace(/<br>/g, '\n')
    .replace(/<\/(p|h\d)>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

const doc = (body: string) =>
  `{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fswiss Arial;}{\\f1\\fmodern Courier New;}}` +
  `{\\colortbl;\\red255\\green0\\blue0;\\red0\\green0\\blue255;}${body}}`;

describe('rtfToHtml', () => {
  it('reads paragraphs and character formatting', () => {
    const out = html(doc('\\pard Plain {\\b bold} {\\i italic} {\\ul under}{\\strike gone}\\par'));
    expect(out).toContain('<p ');
    expect(out).toMatch(/font-weight:bold[^>]*>bold</);
    expect(out).toMatch(/font-style:italic[^>]*>italic</);
    expect(out).toMatch(/text-decoration:underline[^>]*>under</);
    expect(out).toMatch(/text-decoration:line-through[^>]*>gone</);
    expect(out).toContain("font-family:'Arial', sans-serif");
  });

  it("decodes \\u, \\'hh and code pages, skipping the fallback characters", () => {
    expect(text(doc("\\pard a\\'e7\\'e3o \\u26085?\\u26412? \\u-10180?\\u-8311? \\~x\\par"))).toBe(
      'ação 日本 🎉  x',
    );
    // \uc2: two fallback bytes per character.
    expect(text(doc("\\pard\\uc2 \\u26085\\'93\\'fa!\\par"))).toBe('日!');
    // A Shift-JIS font.
    const sjis = `{\\rtf1\\ansi{\\fonttbl{\\f0\\fcharset128 MS Gothic;}}\\pard\\f0 \\'93\\'fa\\'96\\'7b\\par}`;
    expect(text(sjis)).toBe('日本');
  });

  it('escapes text, so RTF content cannot inject markup', () => {
    const out = html(doc('\\pard <script>alert(1)</script> & "q"\\par'));
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('turns outline levels and heading styles into headings', () => {
    const rtf =
      `{\\rtf1{\\stylesheet{\\s0 Normal;}{\\s1\\outlinelevel0 heading 1;}{\\s2 heading 2;}}` +
      `\\pard\\s1 Title\\par\\pard\\s2 Sub\\par\\pard\\outlinelevel2 Third\\par\\pard Body\\par}`;
    const out = rtfToHtml(Buffer.from(rtf)).html;
    expect(out).toMatch(/<h1 [^>]*>.*Title.*<\/h1>/);
    expect(out).toMatch(/<h2 [^>]*>.*Sub.*<\/h2>/);
    expect(out).toMatch(/<h3 [^>]*>.*Third.*<\/h3>/);
    expect(out).toMatch(/<p [^>]*>.*Body.*<\/p>/);
  });

  it('reads tables with header rows, widths and shading', () => {
    const row = (header: boolean, cells: string[]) =>
      `\\trowd${header ? '\\trhdr' : ''}\\clcbpat1\\cellx1500\\cellx3000 ` +
      cells.map((cell) => `\\pard\\intbl ${cell}\\cell`).join('') +
      '\\row';
    const out = html(doc(`${row(true, ['A', 'B'])}${row(false, ['1', '2'])}\\pard After\\par`));
    expect(out).toMatch(/<table[^>]*><colgroup><col style="width:100px"><col style="width:100px">/);
    expect(out).toMatch(/<thead><tr><th style="background:rgb\(255, 0, 0\)">.*A.*<\/th><th>.*B/);
    expect(out).toMatch(/<tbody><tr><td [^>]*>.*1.*<\/td><td>.*2/);
    expect(out.indexOf('After')).toBeGreaterThan(out.indexOf('</table>'));
  });

  it('reads links, bookmarks and colors', () => {
    const out = html(
      doc(
        '\\pard {\\*\\bkmkstart top}{\\*\\bkmkend top}' +
          '{\\field{\\*\\fldinst{HYPERLINK "https://example.com/?a=1&b=2"}}{\\fldrslt{\\cf2 web}}} ' +
          '{\\field{\\*\\fldinst{HYPERLINK \\\\l "top"}}{\\fldrslt back}}\\par',
      ),
    );
    expect(out).toContain('<a id="top"></a>');
    expect(out).toMatch(
      /<a href="https:\/\/example.com\/\?a=1&amp;b=2"[^>]*><span style="[^"]*color:rgb\(0, 0, 255\)/,
    );
    expect(out).toMatch(/<a href="#top"[^>]*><span[^>]*>back</);
  });

  it('shows PNG pictures at their display size and marks other formats', () => {
    const png = fs.readFileSync(path.join(fixtures, 'assets/banner.png'));
    const out = html(
      doc(
        `\\pard {\\*\\shppict{\\pict\\pngblip\\picw10\\pich10\\picwgoal1500\\pichgoal750 ${png.toString('hex')}}}` +
          '{\\nonshppict{\\pict\\wmetafile8 0102}} {\\pict\\emfblip 0102}\\par',
      ),
    );
    expect(out).toMatch(
      /<img src="data:image\/png;base64,[A-Za-z0-9+/=]+" alt="" style="width:100px;height:50px">/,
    );
    expect(out.match(/<img/g)).toHaveLength(1);
    expect(out.match(/\[image\]/g)).toHaveLength(1); // the EMF; the WMF fallback is skipped
  });

  it('skips non-content destinations and Word list markers keep the paragraph format', () => {
    const rtf = doc(
      '{\\info{\\title Hidden}{\\author Me}}{\\header Head}{\\*\\generator X;}' +
        "\\pard\\li720\\fi-360 {\\listtext\\pard\\plain\\f0 \\'95\\tab}Item\\par",
    );
    const out = html(rtf);
    expect(out).not.toMatch(/Hidden|Me|Head|X;/);
    // The marker takes the hanging indent's width, so "Item" lines up with the next lines.
    expect(out).toMatch(
      /<p style="[^"]*margin-left:48px;text-indent:-24px[^"]*"><span class="marker" style="min-width:24px"><span[^>]*>•<\/span><\/span><span[^>]*>Item</,
    );
  });

  it('draws paragraph borders, except sides set to \\brdrnone', () => {
    // As LibreOffice writes a heading underline.
    const out = html(
      doc(
        '\\pard\\brdrt\\brdrnone\\brdrl\\brdrnone\\brdrb\\brdrs\\brdrw10\\brdrcf2\\brdrr\\brdrnone Title\\par',
      ),
    );
    expect(out).toContain('border-bottom:1px solid rgb(0, 0, 255)');
    expect(out).not.toMatch(/border-(top|left|right)/);
  });

  it('collects footnotes at the end', () => {
    const out = text(
      doc('\\pard Text{\\super\\chftn}{\\footnote\\pard{\\super\\chftn} Note.}. End\\par'),
    );
    expect(out).toBe('Text1. End\n1 Note.');
  });

  it('reads the page size and margins', () => {
    const view = rtfToHtml(
      Buffer.from(
        '{\\rtf1\\paperw11906\\paperh16838\\margl1134\\margr1134\\margt1440\\margb1440 x}',
      ),
    );
    expect(view.page).toEqual({
      width: 793.73,
      height: 1122.53,
      margin: { top: 96, right: 75.6, bottom: 96, left: 75.6 },
    });
  });

  it('reads the exporter’s kitchen-sink RTF', () => {
    const view = rtfToHtml(fs.readFileSync(path.join(fixtures, 'golden/kitchen-sink.rtf')));
    const out = view.html;
    expect(out.match(/<h\d/g)?.length).toBeGreaterThanOrEqual(7);
    expect(out.match(/<table/g)).toHaveLength(1);
    expect(out.match(/<tr>/g)).toHaveLength(3);
    expect(out).toMatch(/<a href="#_tabelas"/);
    expect(out).toContain('acentuação: ção, ü, 日本, emoji 🎉');
    expect(out).toContain('interface User {');
  });

  it('survives malformed input', () => {
    expect(() => rtfToHtml(Buffer.from('{\\rtf1 {\\b unclosed \\par'))).not.toThrow();
    expect(() => rtfToHtml(Buffer.from('}}} \\ {\\*'))).not.toThrow();
    expect(text('{\\rtf1 {\\b unclosed \\par')).toBe('unclosed');
  });
});
