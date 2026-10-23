import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { ABNT, type AbntOptions, linePitch } from '../abnt/profile';
import {
  type AbntHeading,
  type AbntPlan,
  alineaLetter,
  type Caption,
  tableKind,
} from '../abnt/structure';
import { decodeFragment, type ExportWarning, fenceLanguage, footnoteNumber } from '../exportAssets';
import type { ResolvedFonts } from '../fonts/fontIndex';
import { type MathGraphic, renderMath } from '../graphics/math';
import type { Token } from '../MarkdownEngine';
import { PdfFonts } from './fonts';
import { columnWidths } from '../tableLayout';
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
  /** Formal-document layout (ABNT) instead of the GitHub-like one; `header` and `footer` are then unused. */
  abnt?: { plan: AbntPlan; options: AbntOptions };
}

export interface PdfResult {
  data: Uint8Array;
  warnings: ExportWarning[];
}

const GITHUB_COLORS = {
  text: '#1f2328',
  muted: '#59636e',
  link: '#0969da',
  border: '#d1d9e0',
  codeBg: '#f6f8fa',
  inlineCodeBg: '#eff1f3',
  stripe: '#f6f8fa',
  checkbox: '#59636e',
};

/** ABNT: black text; colors only in illustrations. */
const ABNT_COLORS: typeof GITHUB_COLORS = {
  text: '#000000',
  muted: '#000000',
  link: '#000000',
  border: '#000000',
  codeBg: '#9a9a9a', // the code box outline
  inlineCodeBg: '#ffffff',
  stripe: '#ffffff',
  checkbox: '#000000',
};

/** Between a caption or source line and its table, in points. */
const CAPTION_GAP = 3;

/** Above and below the footnote separator, in points. */
const NOTE_GAP = 6;
const NOTE_AFTER_RULE = 3;

const HEADING_SCALE = [2, 1.5, 1.25, 1, 0.875, 0.85];
const BULLETS = ['•', '◦', '▪'];
const PX = 0.75; // points per CSS pixel

interface FootNote {
  n: number;
  lines: Line[];
  /** Indent of the lines after the first, which starts with the number. */
  hang: number;
  height: number;
}

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
  private readonly pageBottom: number;
  private readonly color: typeof GITHUB_COLORS;
  private readonly abnt: PdfRenderOptions['abnt'];

  private y: number;
  /** Space owed before the next block; dropped at the top of a page. */
  private pendingSpace = 0;
  private indent = 0;
  private readonly lists: { ordered: boolean; next: number; step?: number }[] = [];
  private readonly quotes: QuoteBar[] = [];
  /** ABNT: line spacing in single lines, for the block being drawn. */
  private spacing: number = ABNT.bodySpacing;
  /** ABNT: depth of long quotations (no bars, smaller type). */
  private quoteDepth = 0;
  /** ABNT: footnotes placed on the current page, drawn when it is finished. */
  private pageNotes: FootNote[] = [];
  private readonly noteCache = new Map<number, FootNote>();
  private notesHeight = 0;
  private readonly placedNotes = new Set<number>();
  /** Drawing table cells: rows were already fitted, so lines must not break the page. */
  private inCell = false;
  private identified = false;
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
    this.pageBottom = page.height - page.margin.bottom;
    this.y = this.top;
    this.abnt = options.abnt;
    this.color = this.abnt ? ABNT_COLORS : GITHUB_COLORS;
  }

  async write(): Promise<PdfResult> {
    const chunks: Uint8Array[] = [];
    const done = new Promise<void>((resolve, reject) => {
      this.doc.on('data', (chunk: Uint8Array) => chunks.push(chunk));
      this.doc.on('end', resolve);
      this.doc.on('error', reject);
    });
    if (this.abnt?.plan.title) {
      const style = this.style({ bold: true });
      this.abntTitle([{ type: 'text', text: this.abnt.plan.title, style }], style);
    }
    for (let i = 0; i < this.tokens.length; i++) i = this.block(i);
    this.closeQuotes(0);
    this.drawNotes();
    if (this.abnt) this.pageNumbers();
    else this.headersAndFooters();
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

  /** Where text must end on this page: above the margin and the footnotes. */
  private get bottom(): number {
    return this.pageBottom - this.notesHeight;
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
    this.drawNotes();
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
      color: this.quotes.length ? this.color.muted : this.color.text,
      ...(this.quoteDepth ? { size: ABNT.font.small } : {}),
      ...overrides,
    };
  }

  private lineGap(line: Line): number {
    const size = line.size || this.fs;
    if (!this.abnt) return size * 0.42;
    // Baselines one pitch apart; a line's own height (ascent + descent) is 1.02em.
    return Math.max(0, linePitch(size, this.spacing) - size * 1.02);
  }

  /** Runs `draw` with ABNT line spacing `spacing`. */
  private withSpacing<T>(spacing: number, draw: () => T): T {
    const saved = this.spacing;
    this.spacing = spacing;
    try {
      return draw();
    } finally {
      this.spacing = saved;
    }
  }

  // ------------------------------------------------------------ blocks

  /** Writes the block starting at `i` and returns the index of its last token. */
  private block(i: number): number {
    if (this.abnt) {
      const end = this.abntBlock(i);
      if (end !== undefined) return end;
    }
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
    const style = this.style({
      bold: true,
      size,
      color: level === 6 ? this.color.muted : this.color.text,
    });
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

  private paragraph(items: InlineItem[], align: Align, firstIndent = 0): void {
    const lines = layoutLines(items, this.width, this.fonts, this.style(), firstIndent);
    this.reserve(0);
    this.drawLines(lines, align, this.x, this.width, firstIndent);
  }

  private linesHeight(lines: Line[]): number {
    return lines.reduce((sum, line) => sum + line.ascent + line.descent + this.lineGap(line), 0);
  }

  /**
   * Draws lines at the current position, breaking pages between lines. The first
   * line starts `firstIndent` further right (left when negative).
   */
  private drawLines(
    lines: Line[],
    align: Align,
    x = this.x,
    width = this.width,
    firstIndent = 0,
  ): void {
    lines.forEach((line, index) => {
      const gap = this.lineGap(line);
      const height = line.ascent + line.descent + gap;
      const notes = this.callsOf(line);
      const fits = () => this.y + height <= this.bottom - this.notesExtra(notes);
      if (!fits() && this.y > this.top + 0.5 && !this.inCell) this.newPage();
      this.placeNotes(notes);
      const baseline = this.y + gap / 2 + line.ascent;
      this.takeMarker(baseline);
      const indent = index === 0 ? firstIndent : 0;
      const room = width - indent;
      if (align === 'justify') {
        const spaces = line.last ? 0 : countSpaces(line);
        const extra = spaces ? Math.max(0, (room - line.width) / spaces) : 0;
        this.drawLine(line, x + indent, baseline, extra);
      } else {
        this.drawLine(line, x + indent + offset(align, room, line.width), baseline);
      }
      this.y += height;
    });
  }

  /** Draws a line; `extraSpace` widens each space (justified text). */
  private drawLine(line: Line, x: number, baseline: number, extraSpace = 0): void {
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
        const extra = extraSpace * (piece.text.match(/ /g)?.length ?? 0);
        const width = piece.width + extra;
        if (style.code) {
          this.doc
            .roundedRect(cursor - 1.5, top - 0.5, width + 3, height + 1, 2)
            .fill(this.color.inlineCodeBg);
        }
        if (extra) {
          let x = cursor;
          for (const part of piece.text.split(/( )/)) {
            if (part === ' ') x += this.fonts.width(' ', style) + extraSpace;
            else if (part) x += this.fonts.draw(part, style, x, baseline);
          }
        } else {
          this.fonts.draw(piece.text, style, cursor, baseline);
        }
        if (style.strike) {
          const y = baseline - (style.rise ?? 0) - style.size * 0.28;
          this.doc
            .moveTo(cursor, y)
            .lineTo(cursor + width, y)
            .lineWidth(style.size * 0.065)
            .strokeColor(style.color)
            .stroke();
        }
        if (style.link) this.doc.link(cursor, top, width, height, style.link);
        if (style.goTo) this.doc.goTo(cursor, top, width, height, style.goTo);
        cursor += extra;
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
    const style = this.style({ color: this.color.text });
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
    this.doc.rect(bar.x, bar.top, 3, bottom - bar.top).fill(this.color.border);
  }

  private hline(x1: number, x2: number, y: number, width: number): void {
    this.doc.moveTo(x1, y).lineTo(x2, y).lineWidth(width).strokeColor(this.color.border).stroke();
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
    // ABNT text is black, code included.
    const highlighted = lang && !this.abnt ? this.options.highlight?.(code, lang) : undefined;
    const lines = highlighted ?? code.split('\n').map((content) => [{ content }]);
    this.codeBlock(lines);
  }

  private codeBlock(source: CodeToken[][]): void {
    const size = this.abnt ? ABNT.font.small : this.fs * 0.85;
    const pad = this.fs * (this.abnt ? 0.5 : 0.8);
    const style = (color?: string): TextStyle => ({
      family: 'mono',
      bold: false,
      italic: false,
      size,
      color: color ?? this.color.text,
    });
    const lineHeight = this.abnt ? linePitch(size, 1) : size * 1.45;
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
      if (this.abnt) {
        this.doc
          .rect(this.x, this.y, this.width, height)
          .lineWidth(0.5)
          .strokeColor(this.color.codeBg)
          .stroke();
      } else {
        this.doc.roundedRect(this.x, this.y, this.width, height, 4).fill(this.color.codeBg);
      }
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
        const style = this.style({ bold: header, color: this.color.text, ...this.cellSize() });
        rows[rows.length - 1]?.cells.push({
          items: inline?.type === 'inline' ? this.inline(inline.children ?? [], style) : [],
          align: (align as Cell['align'] | undefined) ?? 'left',
        });
      }
    }
    const columns = Math.max(0, ...rows.map((row) => row.cells.length));
    if (!columns) return end;

    const padX = this.fs * (this.abnt ? 0.4 : 0.55);
    const padY = this.fs * (this.abnt ? 0.15 : 0.35);
    const base = this.style({ color: this.color.text, ...this.cellSize() });
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
    // ABNT: a table narrower than the column is centered; IBGE tables have no side borders.
    const total = widths.reduce((sum, width) => sum + width, 0);
    const left = this.abnt ? this.x + Math.max(0, (this.width - total) / 2) : this.x;
    const kind = this.abnt && tableKind(this.abnt.plan, start, this.abnt.options);

    const layoutRow = (row: (typeof rows)[number]) => {
      const cells = widths.map((width, c) =>
        // The epsilon keeps a cell at its natural width from wrapping on rounding errors.
        layoutLines(row.cells[c]?.items ?? [], width - 2 * padX + 0.01, this.fonts, base),
      );
      const height = Math.max(...cells.map((lines) => this.linesHeight(lines))) + 2 * padY;
      return { cells, height };
    };
    const headerRows = rows.filter((row) => row.header);

    this.reserve(0);
    let stripe = false;
    const drawRow = (row: (typeof rows)[number], laid: ReturnType<typeof layoutRow>) => {
      let x = left;
      const top = this.y;
      this.inCell = true;
      widths.forEach((width, c) => {
        if (!kind) {
          if (row.header) this.doc.rect(x, top, width, laid.height).fill(this.color.codeBg);
          else if (stripe) this.doc.rect(x, top, width, laid.height).fill(this.color.stripe);
        }
        if (kind !== 'Tabela') {
          this.doc
            .rect(x, top, width, laid.height)
            .lineWidth(kind ? 0.5 : 0.75)
            .strokeColor(this.color.border)
            .stroke();
        }
        this.y = top + padY;
        this.drawLines(laid.cells[c], row.cells[c]?.align ?? 'left', x + padX, width - 2 * padX);
        x += width;
      });
      this.inCell = false;
      this.y = top + laid.height;
      if (kind === 'Tabela' && row.header) {
        // Rules above and below the header; none between data rows.
        if (row === headerRows[0]) this.hline(left, left + total, top, 0.75);
        if (row === headerRows[headerRows.length - 1]) this.hline(left, x, this.y, 0.5);
      }
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
    if (kind === 'Tabela') this.hline(left, left + total, this.y, 0.75);
    this.space(this.abnt ? 0 : this.fs * 0.8);
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
            style: this.abnt
              ? { ...current(), family: 'mono' }
              : { ...current(), family: 'mono', size: current().size * 0.9, code: true },
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
              color: this.color.link,
              goTo: `fn-${n}`,
              ...(this.abnt ? { note: n } : {}),
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
    const color = this.color.link;
    if (href.startsWith('#')) return { color, goTo: decodeFragment(href.slice(1)) };
    if (/^(https?|mailto):/i.test(href)) return { color, link: href };
    return { color }; // relative files: no target inside a PDF
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
          .strokeColor(this.color.checkbox)
          .stroke();
        if (checked) {
          this.doc.roundedRect(x, top, size, size, 1.5).fill(this.color.link);
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

  // ------------------------------------------------------------ ABNT

  /** ABNT handling of the block at `i`; `undefined` leaves it to the common code. */
  private abntBlock(i: number): number | undefined {
    const { plan, options } = this.abnt!;
    const token = this.tokens[i];
    const pitch = linePitch(this.fs, ABNT.bodySpacing);
    switch (token.type) {
      case 'heading_open':
        return this.abntHeading(i, plan.headings.get(i) ?? { role: 'section', level: 2 });
      case 'paragraph_open': {
        if (plan.skip.has(i)) return i + 2;
        if (plan.figures.has(i)) {
          this.abntFigure(i, plan.captions.get(i));
          return i + 2;
        }
        const inline = this.tokens[i + 1];
        if (inline?.type !== 'inline') return i;
        if (plan.references.has(i)) {
          // References: aligned left, single-spaced, a blank single line between them.
          this.withSpacing(1, () =>
            this.paragraph(this.inline(inline.children ?? [], this.style()), 'left'),
          );
          this.space(linePitch(this.fs, 1));
          return i + 2;
        }
        // Body text: first-line indent; list items and quotations: none.
        const plain = !this.quoteDepth && !this.lists.length && !this.pendingMarker;
        this.withSpacing(this.quoteDepth ? 1 : ABNT.bodySpacing, () =>
          this.paragraph(
            this.inline(inline.children ?? [], this.style()),
            'justify',
            plain ? ABNT.firstLineIndent : 0,
          ),
        );
        return i + 2;
      }
      case 'bullet_list_open':
      case 'ordered_list_open': {
        // An alínea's letter sits 1.25 cm in; nested items start under its text.
        const step = this.lists.length ? ABNT.listHang : ABNT.listIndent + ABNT.listHang;
        this.lists.push({
          ordered: token.type === 'ordered_list_open',
          next: Number(token.attrGet('start') ?? 1),
          step,
        });
        this.indent += step;
        return i;
      }
      case 'bullet_list_close':
      case 'ordered_list_close':
        this.indent -= this.lists.pop()?.step ?? 0;
        return i;
      case 'list_item_open':
        this.pendingMarker = this.abntMarker(token, options);
        return i;
      case 'blockquote_open':
        this.space(pitch);
        this.quoteDepth++;
        this.indent += ABNT.quoteIndent;
        return i;
      case 'blockquote_close':
        this.quoteDepth--;
        this.indent -= ABNT.quoteIndent;
        this.space(pitch);
        return i;
      case 'hr':
        if (options.rule === 'linha') this.rule();
        else if (options.rule === 'quebra_pagina' && this.y > this.top + 0.5) {
          this.newPage();
          this.pendingSpace = 0;
        }
        return i;
      case 'footnote_block_open': {
        // The notes were placed at the foot of the pages that call them.
        let end = i;
        while (end < this.tokens.length - 1 && this.tokens[end].type !== 'footnote_block_close') {
          end++;
        }
        return end;
      }
      case 'table_open': {
        let end = i;
        this.withCaption(plan.captions.get(i), this.fs * 4, () => {
          end = this.withSpacing(1, () => this.table(i));
        });
        return end;
      }
      case 'fence': {
        const diagram =
          fenceLanguage(token) === 'mermaid' ? this.options.loadDiagram(token.content) : undefined;
        const keep = diagram ? this.imageBox(diagram).ascent : linePitch(ABNT.font.small, 3);
        this.withCaption(plan.captions.get(i), keep, () => this.fence(token));
        return i;
      }
      default:
        return undefined;
    }
  }

  private abntHeading(i: number, heading: AbntHeading): number {
    const { level, role } = heading;
    const inline = this.tokens[i + 1];
    const style = this.style({
      bold: role !== 'section' || level === 2 || level === 4,
      italic: role === 'section' && level === 6,
    });
    const items = inline?.type === 'inline' ? this.inline(inline.children ?? [], style) : [];
    const id = this.tokens[i].attrGet('id');
    const title = (heading.number ? `${heading.number} ` : '') + (inline?.content ?? '');

    if (role === 'title') {
      this.abntTitle(items, style, id, title);
      return i + 2;
    }
    if (role === 'section' && level === 2 && this.abnt!.options.primaryNewPage) {
      if (this.y > this.top + 0.5) this.newPage();
      this.pendingSpace = 0;
    }
    // The number, one space, then the title; further lines align with the title's first letter.
    let hang = 0;
    if (heading.number) {
      const label = `${heading.number} `;
      hang = this.fonts.width(label, style);
      items.unshift({ type: 'text', text: label, style });
    }
    this.headingLines(items, style, role === 'section' ? 'left' : 'center', hang, id, level, title);
    return i + 2;
  }

  /** The document title (centered), then the identification lines from the front matter. */
  private abntTitle(
    items: InlineItem[],
    style: TextStyle,
    id?: string | null,
    title?: string,
  ): void {
    this.headingLines(items, style, 'center', 0, id, 1, title ?? this.abnt!.plan.title ?? '');
    if (this.identified) return;
    this.identified = true;
    const lines = this.abnt!.plan.identification;
    if (!lines.length) return;
    this.withSpacing(ABNT.bodySpacing, () => {
      for (const line of lines) {
        this.paragraph([{ type: 'text', text: line, style: this.style() }], 'center');
      }
    });
    this.space(linePitch(this.fs, ABNT.bodySpacing));
  }

  /** One 1.5 line before and after, kept with two lines of what follows. */
  private headingLines(
    items: InlineItem[],
    style: TextStyle,
    align: Align,
    hang: number,
    id: string | null | undefined,
    level: number,
    title: string,
  ): void {
    const pitch = linePitch(this.fs, ABNT.bodySpacing);
    this.withSpacing(ABNT.bodySpacing, () => {
      const lines = layoutLines(items, this.width - hang, this.fonts, style, -hang);
      this.space(pitch);
      this.reserve(Math.min(this.linesHeight(lines) + pitch * 3, this.bottom - this.top));
      if (id && !this.destinations.has(id)) {
        this.destinations.add(id);
        this.doc.addNamedDestination(id, 'XYZ', this.x, this.options.page.height - this.y, 0);
      }
      this.addOutline(level, title.trim());
      this.drawLines(lines, align, this.x + hang, this.width - hang, -hang);
    });
    this.space(pitch);
  }

  /** `a)`, `b)` for alíneas, `–` for subalíneas, `•` for bullets when chosen. */
  private abntMarker(item: Token, options: AbntOptions): ((baseline: number) => void) | undefined {
    if (item.attrGet('class')?.includes('task-list-item')) return undefined; // the checkbox marks it
    const list = this.lists[this.lists.length - 1];
    if (!list) return undefined;
    let text: string;
    if (this.lists.length > 1) text = '–';
    else if (list.ordered || options.unorderedList === 'alinea') {
      text = `${alineaLetter(list.next++)})`;
    } else text = '•';
    const style = this.style();
    const x = this.x - ABNT.listHang;
    return (baseline) => this.fonts.draw(text, style, x, baseline);
  }

  /** Small single-spaced type of tables and quadros. */
  private cellSize(): Partial<TextStyle> {
    return this.abnt ? { size: ABNT.font.small } : {};
  }

  /** `Tabela 1 – Título` above, `Fonte: ...` below, kept with `keep` points of the element. */
  private withCaption(caption: Caption | undefined, keep: number, draw: () => void): void {
    if (!caption) return draw();
    const pitch = linePitch(this.fs, ABNT.bodySpacing);
    this.space(pitch);
    const title = this.captionLines(caption, 'title');
    this.withSpacing(1, () => {
      this.reserve(Math.min(this.linesHeight(title) + keep, this.bottom - this.top));
      this.drawLines(title, 'center');
    });
    this.y += CAPTION_GAP;
    draw();
    this.y += CAPTION_GAP;
    this.withSpacing(1, () => this.drawLines(this.captionLines(caption, 'source'), 'center'));
    this.space(pitch);
  }

  private captionLines(caption: Caption, part: 'title' | 'source'): Line[] {
    const style = this.style({ size: ABNT.font.small });
    let items: InlineItem[] = [];
    if (part === 'title') {
      items = [
        { type: 'text', text: `${caption.kind} ${caption.number} – `, style },
        ...this.inline(caption.title, style),
      ];
    } else if (caption.source) {
      items = this.inline(caption.source, style);
    }
    return items.length ? layoutLines(items, this.width, this.fonts, style) : [];
  }

  /** A paragraph holding only an image: centered, with its identification and source. */
  private abntFigure(i: number, caption: Caption | undefined): void {
    const image = (this.tokens[i + 1].children ?? []).find((child) => child.type === 'image');
    if (!image) return;
    const item = this.inlineImage(image, this.style());
    const pitch = linePitch(this.fs, ABNT.bodySpacing);
    this.space(pitch);
    this.withSpacing(1, () => {
      const title = caption ? this.captionLines(caption, 'title') : [];
      const source = caption ? this.captionLines(caption, 'source') : [];
      const lines = layoutLines([item], this.width, this.fonts, this.style());
      const height = this.linesHeight(title) + this.linesHeight(lines) + this.linesHeight(source);
      this.reserve(Math.min(height, this.bottom - this.top));
      this.drawLines(title, 'center');
      this.drawLines(lines, 'center');
      this.drawLines(source, 'center');
    });
    this.space(pitch);
  }

  // ------------------------------------------------------------ footnotes (ABNT)

  /** Notes first called on `line` that are not placed yet. */
  private callsOf(line: Line): number[] {
    if (!this.abnt) return [];
    const notes: number[] = [];
    for (const piece of line.pieces) {
      const n = piece.type === 'text' ? piece.style.note : undefined;
      if (n !== undefined && !this.placedNotes.has(n) && !notes.includes(n)) notes.push(n);
    }
    return notes;
  }

  /** Height the notes would add to the foot of this page. */
  private notesExtra(notes: number[]): number {
    if (!notes.length) return 0;
    const separator = this.pageNotes.length ? 0 : NOTE_GAP + NOTE_AFTER_RULE;
    return separator + notes.reduce((sum, n) => sum + this.note(n).height, 0);
  }

  private placeNotes(notes: number[]): void {
    if (!notes.length) return;
    this.notesHeight += this.notesExtra(notes);
    for (const n of notes) {
      this.pageNotes.push(this.note(n));
      this.placedNotes.add(n);
    }
  }

  /** A note laid out in small single-spaced type, its lines aligned after the number. */
  private note(n: number): FootNote {
    let note = this.noteCache.get(n);
    if (note) return note;
    const style: TextStyle = {
      family: 'body',
      bold: false,
      italic: false,
      size: ABNT.font.small,
      color: this.color.text,
    };
    const call: TextStyle = { ...style, size: style.size * 0.7, rise: style.size * 0.35 };
    const label = String(n);
    const hang = this.fonts.width(label, call) + this.fonts.width(' ', style);
    const items: InlineItem[] = [{ type: 'text', text: `${label} `, style: call }];
    (this.abnt!.plan.notes.get(n) ?? []).forEach((paragraph, index) => {
      if (index) items.push({ type: 'break' });
      items.push(...this.inline(paragraph, style));
    });
    const lines = layoutLines(items, this.right - this.left - hang, this.fonts, style, -hang);
    const height = this.withSpacing(1, () => this.linesHeight(lines));
    note = { n, lines, hang, height };
    this.noteCache.set(n, note);
    return note;
  }

  /** The separator (5 cm from the left margin) and the notes of the current page. */
  private drawNotes(): void {
    if (!this.pageNotes.length) return;
    let y = this.pageBottom - this.notesHeight + NOTE_GAP;
    this.doc
      .moveTo(this.left, y)
      .lineTo(this.left + ABNT.footnoteRule, y)
      .lineWidth(0.5)
      .strokeColor(this.color.text)
      .stroke();
    y += NOTE_AFTER_RULE;
    this.withSpacing(1, () => {
      for (const note of this.pageNotes) {
        const top = this.options.page.height - y;
        this.doc.addNamedDestination(`fn-${note.n}`, 'XYZ', this.left, top, 0);
        note.lines.forEach((line, index) => {
          const gap = this.lineGap(line);
          this.drawLine(line, this.left + (index ? note.hang : 0), y + gap / 2 + line.ascent);
          y += line.ascent + line.descent + gap;
        });
      }
    });
    this.pageNotes = [];
    this.notesHeight = 0;
  }

  /** Arabic numbers, 2 cm from the top and right edges, in small type. */
  private pageNumbers(): void {
    const { page } = this.options;
    const range = this.doc.bufferedPageRange();
    const style: TextStyle = {
      family: 'body',
      bold: false,
      italic: false,
      size: ABNT.font.small,
      color: this.color.text,
    };
    for (let i = range.start; i < range.start + range.count; i++) {
      if (i === 0 && !this.abnt!.options.firstPageNumber) continue;
      this.doc.switchToPage(i);
      const text = String(i + 1);
      const x = page.width - ABNT.pageNumber.right - this.fonts.width(text, style);
      this.fonts.draw(text, style, x, ABNT.pageNumber.top + this.fonts.ascent(style));
    }
  }

  // ------------------------------------------------------------ page furniture

  private headersAndFooters(): void {
    const { header, footer, page } = this.options;
    if (!header.trim() && !footer.trim()) return;
    const range = this.doc.bufferedPageRange();
    const style = this.style({ size: this.fs * 0.8, color: this.color.muted });
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

type Align = 'left' | 'center' | 'right' | 'justify';

function countSpaces(line: Line): number {
  let spaces = 0;
  for (const piece of line.pieces) {
    if (piece.type === 'text') spaces += piece.text.match(/ /g)?.length ?? 0;
  }
  return spaces;
}

function offset(align: Align, width: number, lineWidth: number): number {
  if (align === 'center') return Math.max(0, (width - lineWidth) / 2);
  if (align === 'right') return Math.max(0, width - lineWidth);
  return 0;
}
