import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { decodeFragment, type ExportWarning, fenceLanguage, footnoteNumber } from '../exportAssets';
import type { ResolvedFonts } from '../fonts/fontIndex';
import { type MathGraphic, renderMath } from '../graphics/math';
import type { Token } from '../MarkdownEngine';
import { PdfFonts } from './fonts';
import { pdfSafeSvg } from './svg';
import {
  type InlineBox,
  type InlineItem,
  type Line,
  layoutLines,
  measureInline,
  splitWord,
  type TextStyle,
} from './layout';

/** A picture to place: a bitmap pdfkit embeds, or an SVG drawn as vectors. Sizes in CSS px. */
export type PdfImage =
  | { kind: 'png' | 'jpeg'; data: Uint8Array; width: number; height: number }
  | { kind: 'svg'; svg: string; width: number; height: number };

/** A highlighted code token. */
export interface CodeToken {
  content: string;
  color?: string;
}

export interface PdfRenderOptions {
  title?: string;
  lang?: string;
  /** Page geometry in points. */
  page: {
    width: number;
    height: number;
    margin: { top: number; right: number; bottom: number; left: number };
  };
  /** Body size in points. */
  fontSize: number;
  fonts: ResolvedFonts;
  /** Header / footer text; `{page}`, `{pages}`, `{title}` and `{date}` are replaced. */
  header: string;
  footer: string;
  date?: string;
  loadImage: (src: string) => PdfImage | undefined;
  /** Rendered Mermaid diagram (SVG), when one is available. */
  loadDiagram: (source: string) => PdfImage | undefined;
  /** Highlighted lines of code, or `undefined` for plain text. */
  highlight?: (code: string, lang: string) => CodeToken[][] | undefined;
  math?: (tex: string, display: boolean) => MathGraphic | undefined;
}

export interface PdfResult {
  data: Uint8Array;
  warnings: ExportWarning[];
}

const COLOR = {
  text: '#1f2328',
  muted: '#59636e',
  link: '#0969da',
  border: '#d1d9e0',
  codeBg: '#f6f8fa',
  inlineCodeBg: '#eff1f3',
  stripe: '#f6f8fa',
  checkbox: '#59636e',
};

const HEADING_SCALE = [2, 1.5, 1.25, 1, 0.875, 0.85];
const BULLETS = ['•', '◦', '▪'];
const PX = 0.75; // points per CSS pixel

interface QuoteBar {
  x: number;
  top: number;
}

/** Converts a markdown-it token stream (from `MarkdownEngine.parse`) into a PDF. */
export function renderPdf(tokens: Token[], options: PdfRenderOptions): Promise<PdfResult> {
  return new PdfWriter(tokens, options).write();
}

class PdfWriter {
  private readonly doc: PDFKit.PDFDocument;
  private readonly fonts: PdfFonts;
  private readonly warnings = new Set<ExportWarning>();
  private readonly fs: number;
  private readonly left: number;
  private readonly right: number;
  private readonly top: number;
  private readonly bottom: number;

  private y: number;
  /** Space owed before the next block; dropped at the top of a page. */
  private pendingSpace = 0;
  private indent = 0;
  private readonly lists: { ordered: boolean; next: number }[] = [];
  private readonly quotes: QuoteBar[] = [];
  /** List marker (or footnote label) owed to the first line of the next block. */
  private pendingMarker: ((baseline: number) => void) | undefined;
  private readonly outline: { level: number; item: PDFKit.PDFOutline }[] = [];
  private readonly destinations = new Set<string>();

  constructor(
    private readonly tokens: Token[],
    private readonly options: PdfRenderOptions,
  ) {
    const { page } = options;
    this.doc = new PDFDocument({
      size: [page.width, page.height],
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      bufferPages: true,
      autoFirstPage: true,
      lang: options.lang,
      displayTitle: !!options.title,
      info: { Title: options.title ?? '', Creator: 'MD tool', Producer: 'MD tool' },
    });
    this.fonts = new PdfFonts(this.doc, options.fonts);
    this.fs = options.fontSize;
    this.left = page.margin.left;
    this.right = page.width - page.margin.right;
    this.top = page.margin.top;
    this.bottom = page.height - page.margin.bottom;
    this.y = this.top;
  }

  async write(): Promise<PdfResult> {
    const chunks: Uint8Array[] = [];
    const done = new Promise<void>((resolve, reject) => {
      this.doc.on('data', (chunk: Uint8Array) => chunks.push(chunk));
      this.doc.on('end', resolve);
      this.doc.on('error', reject);
    });
    for (let i = 0; i < this.tokens.length; i++) i = this.block(i);
    this.closeQuotes(0);
    this.headersAndFooters();
    this.doc.end();
    await done;
    return { data: Buffer.concat(chunks), warnings: [...this.warnings] };
  }

  // ------------------------------------------------------------ geometry

  private get width(): number {
    return this.right - this.left - this.indent;
  }

  private get x(): number {
    return this.left + this.indent;
  }

  private space(points: number): void {
    this.pendingSpace = Math.max(this.pendingSpace, points);
  }

  /** Applies owed spacing, then starts a new page unless `height` fits. */
  private reserve(height: number): void {
    if (this.y > this.top) this.y += this.pendingSpace;
    this.pendingSpace = 0;
    if (this.y + height > this.bottom && this.y > this.top + 0.5) this.newPage();
  }

  private newPage(): void {
    // Quote bars are drawn per page: finish them here and restart at the top.
    for (const bar of this.quotes) this.quoteBar(bar, this.y);
    this.doc.addPage({ size: [this.options.page.width, this.options.page.height], margin: 0 });
    this.y = this.top;
    for (const bar of this.quotes) bar.top = this.top;
  }

  // ------------------------------------------------------------ styles

  private style(overrides: Partial<TextStyle> = {}): TextStyle {
    return {
      family: 'body',
      bold: false,
      italic: false,
      size: this.fs,
      color: this.quotes.length ? COLOR.muted : COLOR.text,
      ...overrides,
    };
  }

  private lineGap(line: Line): number {
    return (line.size || this.fs) * 0.42;
  }

  // ------------------------------------------------------------ blocks

  /** Writes the block starting at `i` and returns the index of its last token. */
  private block(i: number): number {
    const token = this.tokens[i];
    switch (token.type) {
      case 'heading_open':
        return this.heading(i);
      case 'paragraph_open': {
        const inline = this.tokens[i + 1];
        if (inline?.type === 'inline') {
          this.paragraph(this.inline(inline.children ?? [], this.style()), 'left');
        }
        this.space(token.hidden ? this.fs * 0.2 : this.fs * 0.8);
        return i + 2;
      }
      case 'bullet_list_open':
      case 'ordered_list_open':
        this.lists.push({
          ordered: token.type === 'ordered_list_open',
          next: Number(token.attrGet('start') ?? 1),
        });
        this.indent += this.fs * 1.7;
        return i;
      case 'bullet_list_close':
      case 'ordered_list_close':
        this.lists.pop();
        this.indent -= this.fs * 1.7;
        this.space(this.fs * 0.8);
        return i;
      case 'list_item_open':
        this.pendingMarker = this.listMarker(token);
        return i;
      case 'list_item_close':
        if (this.pendingMarker) this.paragraph([], 'left'); // empty item: marker alone
        return i;
      case 'blockquote_open':
        this.reserve(0);
        this.quotes.push({ x: this.x, top: this.y });
        this.indent += this.fs * 1.2;
        return i;
      case 'blockquote_close':
        this.closeQuotes(this.quotes.length - 1);
        this.indent -= this.fs * 1.2;
        this.space(this.fs * 0.8);
        return i;
      case 'fence':
      case 'code_block':
        this.fence(token);
        return i;
      case 'math_block':
      case 'math_block_eqno':
        this.mathBlock(token.content.trim());
        return i;
      case 'hr':
        this.rule();
        return i;
      case 'table_open':
        return this.table(i);
      case 'html_block':
        if (!token.content.trim().startsWith('<!--')) this.warnings.add('html');
        return i;
      case 'footnote_block_open':
        this.space(this.fs);
        this.rule();
        return i;
      case 'footnote_open': {
        const n = footnoteNumber(token);
        this.lists.push({ ordered: true, next: n });
        this.indent += this.fs * 1.7;
        this.pendingMarker = this.textMarker(`${n}.`, `fn-${n}`);
        return i;
      }
      case 'footnote_close':
        this.lists.pop();
        this.indent -= this.fs * 1.7;
        this.pendingMarker = undefined;
        return i;
      default:
        return i;
    }
  }

  private heading(i: number): number {
    const level = Number(this.tokens[i].tag.slice(1));
    const inline = this.tokens[i + 1];
    const size = this.fs * HEADING_SCALE[level - 1];
    const style = this.style({ bold: true, size, color: level === 6 ? COLOR.muted : COLOR.text });
    const items = inline?.type === 'inline' ? this.inline(inline.children ?? [], style) : [];
    const lines = layoutLines(items, this.width, this.fonts, style);

    this.space(this.fs * (level <= 2 ? 1.5 : 1.2));
    // Keep the heading with at least two lines of what follows.
    const height = this.linesHeight(lines) + this.fs * 3.2;
    this.reserve(Math.min(height, this.bottom - this.top));

    const id = this.tokens[i].attrGet('id');
    if (id && !this.destinations.has(id)) {
      this.destinations.add(id);
      this.doc.addNamedDestination(id, 'XYZ', this.x, this.options.page.height - this.y, 0);
    }
    this.addOutline(level, inline?.content ?? '');
    this.drawLines(lines, 'left');
    if (level <= 2) {
      this.y += this.fs * 0.3;
      this.hline(this.x, this.right, this.y, 0.75);
    }
    this.space(this.fs * 0.6);
    return i + 2;
  }

  private addOutline(level: number, title: string): void {
    while (this.outline.length && this.outline[this.outline.length - 1].level >= level) {
      this.outline.pop();
    }
    const parent = this.outline[this.outline.length - 1]?.item ?? this.doc.outline;
    const item = parent.addItem(title || ' ');
    this.outline.push({ level, item });
  }

  private paragraph(items: InlineItem[], align: 'left' | 'center'): void {
    const lines = layoutLines(items, this.width, this.fonts, this.style());
    this.reserve(0);
    this.drawLines(lines, align);
  }

  private linesHeight(lines: Line[]): number {
    return lines.reduce((sum, line) => sum + line.ascent + line.descent + this.lineGap(line), 0);
  }

  /** Draws lines at the current position, breaking pages between lines. */
  private drawLines(
    lines: Line[],
    align: 'left' | 'center' | 'right',
    x = this.x,
    width = this.width,
  ): void {
    for (const line of lines) {
      const gap = this.lineGap(line);
      const height = line.ascent + line.descent + gap;
      if (this.y + height > this.bottom && this.y > this.top + 0.5) this.newPage();
      const baseline = this.y + gap / 2 + line.ascent;
      this.takeMarker(baseline);
      this.drawLine(line, x + offset(align, width, line.width), baseline);
      this.y += height;
    }
  }

  private drawLine(line: Line, x: number, baseline: number): void {
    let cursor = x;
    for (const piece of line.pieces) {
      if (piece.type === 'box') {
        piece.box.draw(cursor, baseline);
        const top = baseline - piece.box.ascent;
        const height = piece.box.ascent + piece.box.descent;
        if (piece.box.link) this.doc.link(cursor, top, piece.width, height, piece.box.link);
        if (piece.box.goTo) this.doc.goTo(cursor, top, piece.width, height, piece.box.goTo);
      } else {
        const { style } = piece;
        const top = baseline - this.fonts.ascent(style) - (style.rise ?? 0);
        const height = style.size * 1.05;
        if (style.code) {
          this.doc
            .roundedRect(cursor - 1.5, top - 0.5, piece.width + 3, height + 1, 2)
            .fill(COLOR.inlineCodeBg);
        }
        this.fonts.draw(piece.text, style, cursor, baseline);
        if (style.strike) {
          const y = baseline - (style.rise ?? 0) - style.size * 0.28;
          this.doc
            .moveTo(cursor, y)
            .lineTo(cursor + piece.width, y)
            .lineWidth(style.size * 0.065)
            .strokeColor(style.color)
            .stroke();
        }
        if (style.link) this.doc.link(cursor, top, piece.width, height, style.link);
        if (style.goTo) this.doc.goTo(cursor, top, piece.width, height, style.goTo);
      }
      cursor += piece.width;
    }
  }

  private takeMarker(baseline: number): void {
    const marker = this.pendingMarker;
    this.pendingMarker = undefined;
    marker?.(baseline);
  }

  private listMarker(item: Token): ((baseline: number) => void) | undefined {
    if (item.attrGet('class')?.includes('task-list-item')) return undefined; // the checkbox marks it
    const list = this.lists[this.lists.length - 1];
    if (!list) return undefined;
    const text = list.ordered
      ? `${list.next++}${item.markup || '.'}`
      : BULLETS[(this.lists.length - 1) % BULLETS.length];
    return this.textMarker(text);
  }

  /** Draws `text` right-aligned just left of the current indentation. */
  private textMarker(text: string, destination?: string): (baseline: number) => void {
    const style = this.style({ color: COLOR.text });
    const x = this.x;
    return (baseline) => {
      const width = this.fonts.width(text, style);
      this.fonts.draw(text, style, x - width - this.fs * 0.45, baseline);
      if (destination) {
        this.doc.addNamedDestination(
          destination,
          'XYZ',
          this.left,
          this.options.page.height - (baseline - style.size),
          0,
        );
      }
    };
  }

  private closeQuotes(from: number): void {
    while (this.quotes.length > from) this.quoteBar(this.quotes.pop()!, this.y);
  }

  private quoteBar(bar: QuoteBar, bottom: number): void {
    if (bottom <= bar.top) return;
    this.doc.rect(bar.x, bar.top, 3, bottom - bar.top).fill(COLOR.border);
  }

  private hline(x1: number, x2: number, y: number, width: number): void {
    this.doc.moveTo(x1, y).lineTo(x2, y).lineWidth(width).strokeColor(COLOR.border).stroke();
  }

  private rule(): void {
    this.space(this.fs * 0.8);
    this.reserve(this.fs);
    this.y += this.fs * 0.5;
    this.hline(this.x, this.right, this.y, 1.5);
    this.y += this.fs * 0.5;
    this.space(this.fs * 0.8);
  }

  // ------------------------------------------------------------ code

  private fence(token: Token): void {
    const lang = fenceLanguage(token);
    if (lang === 'math') return this.mathBlock(token.content.trim());
    if (lang === 'mermaid') {
      const diagram = this.options.loadDiagram(token.content);
      if (diagram) return this.figure(diagram);
      this.warnings.add('mermaid');
    }
    const code = token.content.replace(/\n$/, '');
    const highlighted = lang ? this.options.highlight?.(code, lang) : undefined;
    const lines = highlighted ?? code.split('\n').map((content) => [{ content }]);
    this.codeBlock(lines);
  }

  private codeBlock(source: CodeToken[][]): void {
    const size = this.fs * 0.85;
    const pad = this.fs * 0.8;
    const style = (color?: string): TextStyle => ({
      family: 'mono',
      bold: false,
      italic: false,
      size,
      color: color ?? COLOR.text,
    });
    const lineHeight = size * 1.45;
    const maxWidth = this.width - 2 * pad;

    // Wrap long lines between characters; spaces and tabs are kept as written.
    const rows: CodeToken[][] = [];
    for (const tokens of source) {
      let row: CodeToken[] = [];
      let width = 0;
      for (const token of tokens) {
        const text = token.content.replace(/\t/g, '    ');
        for (const chunk of splitWord(text, maxWidth, (t) => this.fonts.width(t, style()))) {
          const chunkWidth = this.fonts.width(chunk, style());
          if (width + chunkWidth > maxWidth && row.length) {
            // Split this chunk again to fill the current row first.
            const fits = splitWord(chunk, maxWidth - width, (t) => this.fonts.width(t, style()));
            const head = fits[0];
            if (this.fonts.width(head, style()) <= maxWidth - width) {
              row.push({ ...token, content: head });
              rows.push(row);
              row = [];
              width = 0;
              const rest = chunk.slice(head.length);
              if (rest) {
                row.push({ ...token, content: rest });
                width = this.fonts.width(rest, style());
              }
              continue;
            }
            rows.push(row);
            row = [];
            width = 0;
          }
          row.push({ ...token, content: chunk });
          width += chunkWidth;
        }
      }
      rows.push(row);
    }

    this.space(this.fs * 0.2);
    this.reserve(lineHeight + 2 * pad);
    let next = 0;
    while (next < rows.length) {
      if (next > 0) this.newPage();
      const fit = Math.max(1, Math.floor((this.bottom - this.y - 2 * pad) / lineHeight));
      const chunk = rows.slice(next, next + fit);
      const height = chunk.length * lineHeight + 2 * pad;
      this.doc.roundedRect(this.x, this.y, this.width, height, 4).fill(COLOR.codeBg);
      let baseline = this.y + pad + size * 1.05;
      this.takeMarker(baseline);
      for (const row of chunk) {
        let x = this.x + pad;
        for (const token of row) {
          x += this.fonts.draw(token.content, style(token.color), x, baseline);
        }
        baseline += lineHeight;
      }
      this.y += height;
      next += chunk.length;
    }
    this.space(this.fs * 0.8);
  }

  // ------------------------------------------------------------ figures

  private mathBlock(tex: string): void {
    const math = (this.options.math ?? renderMath)(tex, true);
    if (!math) {
      this.warnings.add('math');
      this.codeBlock([[{ content: tex }]]);
      return;
    }
    const box = this.mathBox(math, this.fs * 1.1);
    this.space(this.fs * 0.5);
    this.paragraph([box], 'center');
    this.space(this.fs * 0.8);
  }

  /** A formula scaled to the text size (shrunk if wider than the column). */
  private mathBox(math: MathGraphic, size: number): InlineBox {
    const scale = Math.min(size, this.width / math.width);
    const width = math.width * scale;
    const ascent = math.height * scale;
    const descent = math.depth * scale;
    return {
      type: 'box',
      width,
      ascent,
      descent,
      draw: (x, baseline) =>
        this.drawSvg(math.svg, x, baseline - ascent, width, ascent + descent, 'math'),
    };
  }

  /** A centered block picture (diagram or image), shrunk to fit the column and the page. */
  private figure(image: PdfImage): void {
    this.space(this.fs * 0.4);
    this.paragraph([this.imageBox(image, {}, 'mermaid')], 'center');
    this.space(this.fs * 0.8);
  }

  private imageBox(
    image: PdfImage,
    link: { link?: string; goTo?: string } = {},
    kind: 'image' | 'mermaid' = 'image',
  ): InlineBox {
    const maxHeight = (this.bottom - this.top) * 0.9;
    const scale = Math.min(1, this.width / (image.width * PX), maxHeight / (image.height * PX));
    const width = image.width * PX * scale;
    const height = image.height * PX * scale;
    return {
      type: 'box',
      width,
      ascent: height,
      descent: 0,
      ...link,
      draw: (x, baseline) => {
        const top = baseline - height;
        if (image.kind === 'svg') this.drawSvg(image.svg, x, top, width, height, kind);
        else this.doc.image(Buffer.from(image.data), x, top, { width, height });
      },
    };
  }

  /** Draws an SVG as vectors; one the converter cannot handle leaves a gap and a warning. */
  private drawSvg(
    svg: string,
    x: number,
    y: number,
    width: number,
    height: number,
    kind: ExportWarning,
  ): void {
    this.doc.save();
    try {
      SVGtoPDF(this.doc, pdfSafeSvg(svg), x, y, {
        width,
        height,
        preserveAspectRatio: kind === 'math' ? 'none' : 'xMidYMid meet',
        fontCallback: (family, bold, italic) => this.fonts.svgFont(family, bold, italic),
      });
    } catch {
      this.warnings.add(kind);
    } finally {
      this.doc.restore();
    }
  }

  // ------------------------------------------------------------ tables

  private table(start: number): number {
    interface Cell {
      items: InlineItem[];
      align: 'left' | 'center' | 'right';
    }
    const rows: { header: boolean; cells: Cell[] }[] = [];
    let header = false;
    let end = start;
    for (let i = start + 1; i < this.tokens.length; i++) {
      const token = this.tokens[i];
      end = i;
      if (token.type === 'table_close') break;
      if (token.type === 'thead_open') header = true;
      else if (token.type === 'thead_close') header = false;
      else if (token.type === 'tr_open') rows.push({ header, cells: [] });
      else if (token.type === 'th_open' || token.type === 'td_open') {
        const align = /text-align:\s*(left|center|right)/.exec(token.attrGet('style') ?? '')?.[1];
        const inline = this.tokens[i + 1];
        const style = this.style({ bold: header, color: COLOR.text });
        rows[rows.length - 1]?.cells.push({
          items: inline?.type === 'inline' ? this.inline(inline.children ?? [], style) : [],
          align: (align as Cell['align'] | undefined) ?? 'left',
        });
      }
    }
    const columns = Math.max(0, ...rows.map((row) => row.cells.length));
    if (!columns) return end;

    const padX = this.fs * 0.55;
    const padY = this.fs * 0.35;
    const base = this.style({ color: COLOR.text });
    const sizes = Array.from({ length: columns }, (_, c) => {
      const measured = rows.map((row) =>
        row.cells[c]
          ? measureInline(row.cells[c].items, this.fonts, base)
          : { natural: 0, minimum: 0 },
      );
      return {
        natural: Math.max(...measured.map((m) => m.natural)) + 2 * padX,
        minimum: Math.max(...measured.map((m) => m.minimum)) + 2 * padX,
      };
    });
    const widths = columnWidths(sizes, this.width);

    const layoutRow = (row: (typeof rows)[number]) => {
      const cells = widths.map((width, c) =>
        layoutLines(row.cells[c]?.items ?? [], width - 2 * padX, this.fonts, base),
      );
      const height = Math.max(...cells.map((lines) => this.linesHeight(lines))) + 2 * padY;
      return { cells, height };
    };
    const headerRows = rows.filter((row) => row.header);

    this.reserve(0);
    let stripe = false;
    const drawRow = (row: (typeof rows)[number], laid: ReturnType<typeof layoutRow>) => {
      let x = this.x;
      const top = this.y;
      widths.forEach((width, c) => {
        if (row.header) this.doc.rect(x, top, width, laid.height).fill(COLOR.codeBg);
        else if (stripe) this.doc.rect(x, top, width, laid.height).fill(COLOR.stripe);
        this.doc
          .rect(x, top, width, laid.height)
          .lineWidth(0.75)
          .strokeColor(COLOR.border)
          .stroke();
        this.y = top + padY;
        this.drawLines(laid.cells[c], row.cells[c]?.align ?? 'left', x + padX, width - 2 * padX);
        x += width;
      });
      this.y = top + laid.height;
    };

    for (const row of rows) {
      const laid = layoutRow(row);
      if (this.y + laid.height > this.bottom && this.y > this.top + 0.5) {
        this.newPage();
        if (!row.header) for (const head of headerRows) drawRow(head, layoutRow(head)); // repeat the header
      }
      if (!row.header) stripe = !stripe;
      drawRow(row, laid);
    }
    this.space(this.fs * 0.8);
    return end;
  }

  // ------------------------------------------------------------ inline

  private inline(children: Token[], base: TextStyle): InlineItem[] {
    const items: InlineItem[] = [];
    const stack: TextStyle[] = [base];
    const current = () => stack[stack.length - 1];
    const push = (overrides: Partial<TextStyle>) => stack.push({ ...current(), ...overrides });

    for (const token of children) {
      switch (token.type) {
        case 'text':
          items.push({ type: 'text', text: token.content, style: current() });
          break;
        case 'softbreak':
          items.push({ type: 'text', text: ' ', style: current() });
          break;
        case 'hardbreak':
          items.push({ type: 'break' });
          break;
        case 'strong_open':
          push({ bold: true });
          break;
        case 'em_open':
          push({ italic: true });
          break;
        case 's_open':
          push({ strike: true });
          break;
        case 'link_open':
          push(this.linkStyle(token.attrGet('href') ?? ''));
          break;
        case 'strong_close':
        case 'em_close':
        case 's_close':
        case 'link_close':
          if (stack.length > 1) stack.pop();
          break;
        case 'code_inline':
          items.push({
            type: 'text',
            text: token.content,
            style: { ...current(), family: 'mono', size: current().size * 0.9, code: true },
          });
          break;
        case 'image':
          items.push(this.inlineImage(token, current()));
          break;
        case 'task_checkbox':
          items.push(this.checkbox((token.meta as { checked: boolean }).checked, current()));
          break;
        case 'math_inline':
        case 'math_inline_block': {
          const math = (this.options.math ?? renderMath)(token.content, false);
          if (math) items.push(this.mathBox(math, current().size * 1.1));
          else {
            this.warnings.add('math');
            items.push({
              type: 'text',
              text: token.content,
              style: { ...current(), family: 'mono' },
            });
          }
          break;
        }
        case 'footnote_ref': {
          const n = footnoteNumber(token);
          items.push({
            type: 'text',
            text: String(n),
            style: {
              ...current(),
              size: current().size * 0.7,
              rise: current().size * 0.35,
              color: COLOR.link,
              goTo: `fn-${n}`,
            },
          });
          break;
        }
        case 'html_inline':
          if (/^<br\s*\/?>$/i.test(token.content)) items.push({ type: 'break' });
          else if (!token.content.startsWith('<!--')) this.warnings.add('html');
          break;
        case 'footnote_anchor':
          break;
        default:
          if (token.children) items.push(...this.inline(token.children, current()));
          else if (token.content) {
            items.push({ type: 'text', text: token.content, style: current() });
          }
      }
    }
    return items;
  }

  private linkStyle(href: string): Partial<TextStyle> {
    if (href.startsWith('#')) return { color: COLOR.link, goTo: decodeFragment(href.slice(1)) };
    if (/^(https?|mailto):/i.test(href)) return { color: COLOR.link, link: href };
    return { color: COLOR.link }; // relative files: no target inside a PDF
  }

  private inlineImage(token: Token, style: TextStyle): InlineItem {
    const src = token.attrGet('src') ?? '';
    const image = src ? this.options.loadImage(src) : undefined;
    if (image) return this.imageBox(image, { link: style.link, goTo: style.goTo });
    this.warnings.add('image');
    return { type: 'text', text: `[${token.content || src}]`, style };
  }

  private checkbox(checked: boolean, style: TextStyle): InlineBox {
    const size = style.size * 0.85;
    return {
      type: 'box',
      width: size + style.size * 0.4,
      ascent: size * 0.9,
      descent: size * 0.1,
      draw: (x, baseline) => {
        const top = baseline - size * 0.9;
        this.doc
          .roundedRect(x, top, size, size, 1.5)
          .lineWidth(0.8)
          .strokeColor(COLOR.checkbox)
          .stroke();
        if (checked) {
          this.doc.roundedRect(x, top, size, size, 1.5).fill(COLOR.link);
          this.doc
            .moveTo(x + size * 0.22, top + size * 0.52)
            .lineTo(x + size * 0.42, top + size * 0.72)
            .lineTo(x + size * 0.78, top + size * 0.3)
            .lineWidth(1.2)
            .strokeColor('#ffffff')
            .stroke();
        }
      },
    };
  }

  // ------------------------------------------------------------ page furniture

  private headersAndFooters(): void {
    const { header, footer, page } = this.options;
    if (!header.trim() && !footer.trim()) return;
    const range = this.doc.bufferedPageRange();
    const style = this.style({ size: this.fs * 0.8, color: COLOR.muted });
    for (let i = range.start; i < range.start + range.count; i++) {
      this.doc.switchToPage(i);
      const fill = (template: string) =>
        template
          .replace(/\{page\}/g, String(i + 1))
          .replace(/\{pages\}/g, String(range.count))
          .replace(/\{title\}/g, this.options.title ?? '')
          .replace(/\{date\}/g, this.options.date ?? '');
      const place = (text: string, baseline: number) => {
        if (!text.trim()) return;
        const width = this.fonts.width(text, style);
        this.fonts.draw(text, style, (page.width - width) / 2, baseline);
      };
      place(fill(header), Math.max(style.size, page.margin.top / 2 + style.size * 0.35));
      place(
        fill(footer),
        Math.min(
          page.height - style.size * 0.4,
          page.height - page.margin.bottom / 2 + style.size * 0.35,
        ),
      );
    }
  }
}

function offset(align: 'left' | 'center' | 'right', width: number, lineWidth: number): number {
  if (align === 'center') return Math.max(0, (width - lineWidth) / 2);
  if (align === 'right') return Math.max(0, width - lineWidth);
  return 0;
}

/**
 * Column widths for a table: natural widths when they fit, else each column gets
 * its minimum plus a share of the rest proportional to how much it wants.
 */
export function columnWidths(
  sizes: { natural: number; minimum: number }[],
  available: number,
): number[] {
  const natural = sizes.reduce((sum, size) => sum + size.natural, 0);
  if (natural <= available) return sizes.map((size) => size.natural);
  const minimum = sizes.reduce((sum, size) => sum + size.minimum, 0);
  if (minimum >= available) return sizes.map((size) => (size.minimum * available) / minimum);
  const want = natural - minimum;
  return sizes.map(
    (size) => size.minimum + ((size.natural - size.minimum) * (available - minimum)) / want,
  );
}
