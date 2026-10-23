import { ABNT, type AbntOptions, linePitch } from '../abnt/profile';
import { type AbntPlan, alineaLetter, type Caption, tableKind } from '../abnt/structure';
import type { Token } from '../MarkdownEngine';
import {
  decodeFragment,
  type ExportWarning,
  fenceLanguage,
  footnoteNumber,
  type GraphicKind,
} from '../exportAssets';
import { escapeRtf } from './escape';
import { imageToRtf, type RtfImage } from './images';

/** Content that has no RTF equivalent and was exported in a degraded form. */
export type RtfWarning = ExportWarning;

export interface RtfOptions {
  title?: string;
  fontFamily: string;
  codeFontFamily: string;
  /** Body font size in points. */
  fontSize: number;
  /** Page geometry in twips. */
  page: {
    width: number;
    height: number;
    margin: { top: number; right: number; bottom: number; left: number };
  };
  /** Returns the decoded bitmap for an image `src`, or `undefined` if unavailable. */
  loadImage?: (src: string) => RtfImage | undefined;
  /** Returns a rendered picture of a formula or diagram; without one they are written as source. */
  loadGraphic?: (kind: GraphicKind, source: string) => RtfImage | undefined;
  /** Formal-document layout (ABNT) instead of the GitHub-like one. */
  abnt?: { plan: AbntPlan; options: AbntOptions };
}

export interface RtfResult {
  rtf: string;
  warnings: RtfWarning[];
}

// Color table indexes (see `header`).
const COLOR_TEXT = 1;
const COLOR_LINK = 2;
const COLOR_CODE_BG = 3;
const COLOR_MUTED = 4;
const COLOR_BORDER = 5;

/** Indent per list / quote level, in twips. */
const INDENT = 360;
const SPACE_AFTER = 160;
const SPACE_AFTER_TIGHT = 40;
const HEADING_SCALE = [2, 1.5, 1.25, 1, 0.875, 0.85];

const BULLETS = ['\\u8226?', '\\u9702?', '\\u9642?']; // • ◦ ▪
/** Points to twips. */
const tw = (points: number) => Math.round(points * 20);
/** ABNT spacing, in twips: one 1.5 line (around headings, quotations...) and one single line. */
const PITCH = tw(linePitch(ABNT.font.body, ABNT.bodySpacing));
const SINGLE = tw(linePitch(ABNT.font.body, 1));
/** ABNT `\sl` values: 1.5 lines and single lines. */
const SL_BODY = `\\sl${Math.round(240 * ABNT.bodySpacing)}\\slmult1`;
const SL_SINGLE = '\\sl240\\slmult1';
const FS_BODY = Math.round(ABNT.font.body * 2);
const FS_SMALL = Math.round(ABNT.font.small * 2);
/** ABNT footnotes: lines after the first align past the number. */
const FOOTNOTE_HANG = 227;
/** Style numbers of footnote text and footnote calls (as Word numbers them). */
const FOOTNOTE_STYLE = 15;
const FOOTNOTE_CALL_STYLE = 16;

const CHECKBOX = { checked: '\\u9745?', unchecked: '\\u9744?' }; // ☑ ☐

interface ListState {
  ordered: boolean;
  next: number;
}

interface TableCell {
  inline: Token | undefined;
  align: 'l' | 'c' | 'r';
}

interface TableRow {
  header: boolean;
  cells: TableCell[];
}

/** Converts a markdown-it token stream (from `MarkdownEngine.parse`) into an RTF document. */
export function renderRtf(tokens: Token[], options: RtfOptions): RtfResult {
  return new RtfWriter(tokens, options).write();
}

/** Word bookmark names: letters, digits and `_`, at most 40 characters. */
export function bookmarkName(slug: string): string {
  const ascii = slug.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return `_${ascii.replace(/[^A-Za-z0-9_]/g, '_')}`.slice(0, 40);
}

class RtfWriter {
  private readonly out: string[] = [];
  private readonly warnings = new Set<RtfWarning>();
  private readonly lists: ListState[] = [];
  private quoteDepth = 0;
  /** Marker (bullet, number, footnote label) owed to the next paragraph of a list item. */
  private pendingMarker: string | undefined;
  /** Extra space owed before the next paragraph, in twips. */
  private spaceBefore = 0;
  private readonly abnt: RtfOptions['abnt'];
  /** ABNT: the next paragraph starts a page. */
  private breakBefore = false;
  /** ABNT: notes already written at their first call. */
  private readonly notesWritten = new Set<number>();
  private inNote = false;
  private identified = false;
  /** ABNT: a heading was just written; its space after replaces the next one's space before. */
  private afterHeading = false;

  private readonly fs: number;
  private readonly codeFs: number;
  private readonly contentWidth: number;

  constructor(
    private readonly tokens: Token[],
    private readonly options: RtfOptions,
  ) {
    this.fs = Math.round(options.fontSize * 2);
    this.codeFs = Math.round(this.fs * 0.85);
    const { page } = options;
    this.contentWidth = page.width - page.margin.left - page.margin.right;
    this.abnt = options.abnt;
  }

  write(): RtfResult {
    this.out.push(this.abnt ? this.abntHeader() : this.header());
    if (this.abnt?.plan.title) {
      this.out.push(`${this.headingProps(1)}\\qc\\b ${escapeRtf(this.abnt.plan.title)}\\par\n`);
      this.identification();
    }
    for (let i = 0; i < this.tokens.length; i++) i = this.block(i);
    this.out.push('}\n');
    return { rtf: this.out.join(''), warnings: [...this.warnings] };
  }

  // ---------------------------------------------------------------- header

  private header(): string {
    const { fontFamily, codeFontFamily, page, title } = this.options;
    const styles = HEADING_SCALE.map(
      (scale, i) =>
        `{\\s${i + 1}\\sbasedon0\\snext0\\outlinelevel${i}\\keepn\\b\\f0\\fs${Math.round(this.fs * scale)} heading ${i + 1};}`,
    ).join('');
    return (
      '{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1\n' +
      `{\\fonttbl{\\f0\\fswiss\\fcharset0 ${escapeRtf(fontFamily)};}` +
      `{\\f1\\fmodern\\fcharset0 ${escapeRtf(codeFontFamily)};}}\n` +
      '{\\colortbl;\\red31\\green35\\blue40;\\red9\\green105\\blue218;' +
      '\\red246\\green248\\blue250;\\red89\\green99\\blue110;\\red209\\green217\\blue224;}\n' +
      `{\\stylesheet{\\s0\\f0\\fs${this.fs} Normal;}${styles}}\n` +
      (title ? `{\\info{\\title ${escapeRtf(title)}}}\n` : '') +
      `\\paperw${page.width}\\paperh${page.height}` +
      `\\margl${page.margin.left}\\margr${page.margin.right}` +
      `\\margt${page.margin.top}\\margb${page.margin.bottom}` +
      (page.width > page.height ? '\\landscape' : '') +
      '\\viewkind4\n'
    );
  }

  // ---------------------------------------------------------------- blocks

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
      case 'paragraph_open':
        this.out.push(this.paragraphStart(token.hidden ? SPACE_AFTER_TIGHT : SPACE_AFTER));
        return i;
      case 'paragraph_close':
        this.out.push('\\par\n');
        return i;
      case 'inline':
        this.out.push(this.inline(token.children ?? []));
        return i;
      case 'bullet_list_open':
      case 'ordered_list_open':
        this.lists.push({
          ordered: token.type === 'ordered_list_open',
          next: Number(token.attrGet('start') ?? 1),
        });
        return i;
      case 'bullet_list_close':
      case 'ordered_list_close':
        this.lists.pop();
        // Tight items have little spacing; separate the list from what follows.
        if (this.lists.length === 0) this.spaceBefore = SPACE_AFTER;
        return i;
      case 'list_item_open':
        this.pendingMarker = this.listMarker(token);
        return i;
      case 'list_item_close':
        if (this.pendingMarker !== undefined) this.out.push(this.paragraphStart() + '\\par\n');
        this.pendingMarker = undefined;
        return i;
      case 'blockquote_open':
        this.quoteDepth++;
        return i;
      case 'blockquote_close':
        this.quoteDepth--;
        return i;
      case 'fence':
      case 'code_block':
        this.codeBlock(token);
        return i;
      case 'math_block':
      case 'math_block_eqno':
        this.mathBlock(token.content);
        return i;
      case 'hr':
        this.rule();
        return i;
      case 'table_open':
        return this.table(i);
      case 'html_block':
        if (!token.content.trim().startsWith('<!--')) this.warnings.add('html');
        return i;
      case 'html_comment':
        return i;
      case 'footnote_block_open':
        this.rule();
        return i;
      case 'footnote_open':
        // Footnotes render like an ordered list item labelled with their number.
        this.lists.push({ ordered: true, next: 0 });
        this.pendingMarker = `${footnoteNumber(token)}.`;
        return i;
      case 'footnote_close':
        this.lists.pop();
        this.pendingMarker = undefined;
        return i;
      default:
        return i;
    }
  }

  private heading(i: number): number {
    const open = this.tokens[i];
    const level = Number(open.tag.slice(1));
    const size = Math.round(this.fs * HEADING_SCALE[level - 1]);
    let props =
      `\\pard\\plain\\s${level}\\outlinelevel${level - 1}\\keepn\\sb${level <= 2 ? 360 : 240}` +
      `\\sa${SPACE_AFTER}\\f0\\fs${size}\\b\\cf${level === 6 ? COLOR_MUTED : COLOR_TEXT}`;
    if (level <= 2) props += `\\brdrb\\brdrs\\brdrw10\\brsp40\\brdrcf${COLOR_BORDER}`;
    this.out.push(props + ' ');

    const id = open.attrGet('id');
    if (id) {
      const name = bookmarkName(id);
      this.out.push(`{\\*\\bkmkstart ${name}}{\\*\\bkmkend ${name}}`);
    }
    const inline = this.tokens[i + 1];
    if (inline?.type === 'inline') this.out.push(this.inline(inline.children ?? []));
    this.out.push('\\par\n');
    return i + 2; // heading_close
  }

  /** `\pard` with indentation for the current list / quote nesting, plus any owed list marker. */
  private paragraphStart(spaceAfter = SPACE_AFTER, extraProps = ''): string {
    if (this.abnt) return this.abntParagraphStart(extraProps, false);
    const left = (this.lists.length + this.quoteDepth) * INDENT;
    let props = `\\pard\\plain\\f0\\fs${this.fs}\\cf${this.quoteDepth ? COLOR_MUTED : COLOR_TEXT}\\sa${spaceAfter}`;
    if (left) props += `\\li${left}`;
    if (this.spaceBefore) {
      props += `\\sb${this.spaceBefore}`;
      this.spaceBefore = 0;
    }
    if (this.quoteDepth) props += `\\brdrl\\brdrs\\brdrw30\\brsp160\\brdrcf${COLOR_BORDER}`;
    props += extraProps;
    if (this.pendingMarker !== undefined) {
      props += `\\fi-${INDENT}\\tx${left} ${this.pendingMarker}\\tab`;
      this.pendingMarker = undefined;
    }
    return props + ' ';
  }

  private listMarker(item: Token): string {
    if (item.attrGet('class')?.includes('task-list-item')) return ''; // the checkbox is the marker
    const list = this.lists[this.lists.length - 1];
    if (!list) return '';
    if (list.ordered) return `${list.next++}.`;
    return BULLETS[(this.lists.length - 1) % BULLETS.length];
  }

  private codeBlock(token: Token): void {
    const lang = fenceLanguage(token);
    if (lang === 'math') return this.mathBlock(token.content);
    if (lang === 'mermaid') {
      if (this.graphicBlock('mermaid', token.content)) return;
      this.warnings.add('mermaid');
    }

    const lines = token.content.replace(/\n$/, '').split('\n').map(escapeRtf);
    if (this.abnt) {
      // Small single-spaced type in a light box.
      const box = `\\box\\brdrs\\brdrw10\\brsp80\\brdrcf${COLOR_CODE_BG}`;
      this.out.push(
        this.abntParagraphStart(`\\ql\\fs${FS_SMALL}${SL_SINGLE}${box}`, false) +
          `{\\f1 ${lines.join('\\line ')}}\\par\n`,
      );
      this.spaceBefore = SINGLE;
      return;
    }
    this.out.push(
      this.paragraphStart(0, `\\cbpat${COLOR_CODE_BG}`) +
        `{\\f1\\fs${this.codeFs} ${lines.join('\\line ')}}\\par\n`,
    );
    // Unshaded spacer: adjacent paragraphs with identical shading merge into one box.
    this.spacer();
  }

  private spacer(): void {
    this.out.push(`\\pard\\plain\\sa0\\fs${Math.round(this.fs * 0.7)}\\par\n`);
  }

  private mathBlock(tex: string): void {
    if (this.graphicBlock('math-block', tex.trim())) return;
    this.warnings.add('math');
    this.out.push(
      `${this.paragraphStart(SPACE_AFTER, '\\qc')}{\\f1 ${escapeRtf(tex.trim())}}\\par\n`,
    );
  }

  /** Centered paragraph holding a rendered formula / diagram; false if none is available. */
  private graphicBlock(kind: GraphicKind, source: string): boolean {
    const image = this.options.loadGraphic?.(kind, source);
    if (!image) return false;
    this.out.push(`${this.paragraphStart(SPACE_AFTER, '\\qc')}${this.picture(image)}\\par\n`);
    return true;
  }

  private picture(image: RtfImage): string {
    const indent = this.abnt ? this.abntLeft() : (this.lists.length + this.quoteDepth) * INDENT;
    return imageToRtf(image, this.contentWidth - indent);
  }

  private rule(): void {
    this.out.push(
      `\\pard\\plain\\sb120\\sa240\\brdrb\\brdrs\\brdrw15\\brsp20\\brdrcf${COLOR_BORDER}\\fs4\\par\n`,
    );
  }

  // ---------------------------------------------------------------- tables

  private table(start: number): number {
    const rows: TableRow[] = [];
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
        const next = this.tokens[i + 1];
        rows[rows.length - 1]?.cells.push({
          inline: next?.type === 'inline' ? next : undefined,
          align: align === 'center' ? 'c' : align === 'right' ? 'r' : 'l',
        });
      }
    }

    const columns = Math.max(0, ...rows.map((row) => row.cells.length));
    if (columns === 0) return end;

    // Size columns to their longest cell (like the HTML table), shrinking to fit the page.
    // ~0.6em per character, 0.7em in bold headers, plus the cell padding (1.2em).
    const em = (this.abnt ? ABNT.font.small : this.options.fontSize) * 20;
    const widths = Array.from({ length: columns }, (_, c) => {
      const ems = Math.max(
        ...rows.map(
          (row) => (row.cells[c]?.inline?.content.length ?? 0) * (row.header ? 0.7 : 0.6),
        ),
      );
      return (Math.min(36, Math.max(1.8, ems)) + 1.2) * em;
    });
    const left = this.abnt ? 0 : (this.lists.length + this.quoteDepth) * INDENT;
    const available = this.contentWidth - left;
    const total = widths.reduce((sum, width) => sum + width, 0);
    const scale = Math.min(1, available / total);
    const edges: number[] = [];
    let position = left;
    for (const width of widths) {
      position += Math.round(width * scale);
      edges.push(position);
    }

    const kind = this.abnt && tableKind(this.abnt.plan, start, this.abnt.options);
    this.afterHeading = false;
    const color = kind ? COLOR_TEXT : COLOR_BORDER;
    const border = (side: string) => `\\clbrdr${side}\\brdrs\\brdrw10\\brdrcf${color}`;
    const headers = rows.filter((row) => row.header);
    rows.forEach((row, r) => {
      // ABNT tables (IBGE) only have rules around the header and at the end.
      let sides = 'tlbr';
      if (kind === 'Tabela') {
        sides = '';
        if (row === headers[0]) sides += 't';
        if (row === headers[headers.length - 1] || r === rows.length - 1) sides += 'b';
      }
      let line = `\\trowd\\trgaph108\\trleft${left}${kind ? '\\trqc' : ''}${row.header ? '\\trhdr' : ''}`;
      for (const edge of edges) {
        for (const side of sides) line += border(side);
        if (row.header && !kind) line += `\\clcbpat${COLOR_CODE_BG}`;
        line += `\\cellx${edge}`;
      }
      line += '\n';
      const text = kind ? `\\fs${FS_SMALL}${SL_SINGLE}` : `\\fs${this.fs}`;
      for (let c = 0; c < columns; c++) {
        const cell = row.cells[c];
        const content = cell?.inline ? this.inline(cell.inline.children ?? []) : '';
        line +=
          `\\pard\\plain\\intbl\\q${cell?.align ?? 'l'}\\f0${text}\\cf${COLOR_TEXT} ` +
          (row.header ? `{\\b ${content}}` : content) +
          '\\cell\n';
      }
      this.out.push(line + '\\row\n');
    });
    if (kind) {
      this.spaceBefore = SINGLE;
      return end;
    }
    // Space between the table and what follows.
    this.out.push(`\\pard\\plain\\sa0\\fs${Math.round(this.fs / 2)}\\par\n`);
    return end;
  }

  // ---------------------------------------------------------------- ABNT

  private abntHeader(): string {
    const { fontFamily, codeFontFamily, page, title } = this.options;
    const { options } = this.abnt!;
    const styles = [1, 2, 3, 4, 5, 6]
      .map(
        (level) =>
          `{\\s${level}\\sbasedon0\\snext0\\outlinelevel${level - 1}\\keepn\\sb${PITCH}\\sa${PITCH}` +
          `${SL_BODY}\\f0\\fs${FS_BODY} heading ${level};}`,
      )
      .join('');
    const black = '\\red0\\green0\\blue0;';
    // Page number: top right, 2 cm from the top edge (the right margin is 2 cm).
    const number = `\\pard\\plain\\qr\\f0\\fs${FS_SMALL}{\\field{\\*\\fldinst PAGE}{\\fldrslt 1}}\\par`;
    return (
      `{\\rtf1\\ansi\\ansicpg1252\\deff0\\deflang${ABNT.rtfLang}\\uc1\n` +
      `{\\fonttbl{\\f0\\froman\\fcharset0 ${escapeRtf(fontFamily)};}` +
      `{\\f1\\fmodern\\fcharset0 ${escapeRtf(codeFontFamily)};}}\n` +
      // Black text; COLOR_CODE_BG outlines code blocks.
      `{\\colortbl;${black}${black}\\red154\\green154\\blue154;${black}${black}}\n` +
      `{\\stylesheet{\\s0\\qj\\fi${tw(ABNT.firstLineIndent)}${SL_BODY}\\f0\\fs${FS_BODY}` +
      `\\lang${ABNT.rtfLang} Normal;}${styles}` +
      // LibreOffice lays footnotes out by their style, ignoring direct indents.
      `{\\s${FOOTNOTE_STYLE}\\sbasedon0\\qj\\li${FOOTNOTE_HANG}\\fi-${FOOTNOTE_HANG}${SL_SINGLE}` +
      `\\f0\\fs${FS_SMALL} footnote text;}` +
      `{\\*\\cs${FOOTNOTE_CALL_STYLE}\\super footnote reference;}}\n` +
      (title ? `{\\info{\\title ${escapeRtf(title)}}}\n` : '') +
      `\\paperw${page.width}\\paperh${page.height}` +
      `\\margl${page.margin.left}\\margr${page.margin.right}` +
      `\\margt${page.margin.top}\\margb${page.margin.bottom}` +
      // Hyphenation; footnotes at the foot of the page, arabic, numbered through the document.
      '\\hyphauto1\\ftnbj\\ftnnar\\ftnrstcont\\fet0\\viewkind4\n' +
      `\\headery${tw(ABNT.pageNumber.top)}` +
      (options.firstPageNumber ? '' : '\\titlepg') +
      `{\\header${number}}` +
      (options.firstPageNumber ? '' : '{\\headerf\\pard\\plain\\par}') +
      '\n'
    );
  }

  /** ABNT handling of the block at `i`; `undefined` leaves it to the common code. */
  private abntBlock(i: number): number | undefined {
    const { plan, options } = this.abnt!;
    const token = this.tokens[i];
    switch (token.type) {
      case 'heading_open':
        return this.abntHeading(i);
      case 'paragraph_open':
        if (plan.skip.has(i)) return i + 2;
        if (plan.figures.has(i)) {
          this.abntFigure(i, plan.captions.get(i));
          return i + 2;
        }
        if (plan.references.has(i)) {
          // References: aligned left, single-spaced, a blank single line between them.
          this.out.push(this.abntParagraphStart(`\\ql${SL_SINGLE}\\sa${SINGLE}`, false));
          return i;
        }
        this.out.push(this.abntParagraphStart('', true));
        return i;
      case 'bullet_list_open':
      case 'ordered_list_open':
        this.lists.push({
          ordered: token.type === 'ordered_list_open',
          next: Number(token.attrGet('start') ?? 1),
        });
        return i;
      case 'bullet_list_close':
      case 'ordered_list_close':
        this.lists.pop();
        return i;
      case 'list_item_open':
        this.pendingMarker = this.abntMarker(token, options);
        return i;
      case 'list_item_close':
        if (this.pendingMarker !== undefined) {
          this.out.push(this.abntParagraphStart('', false) + '\\par\n');
        }
        this.pendingMarker = undefined;
        return i;
      case 'blockquote_open':
        this.quoteDepth++;
        this.spaceBefore = PITCH;
        return i;
      case 'blockquote_close':
        this.quoteDepth--;
        this.spaceBefore = PITCH;
        return i;
      case 'hr':
        if (options.rule === 'linha') this.rule();
        else if (options.rule === 'quebra_pagina') this.breakBefore = true;
        return i;
      case 'footnote_block_open': {
        // Each note was written where it is first called.
        let end = i;
        while (end < this.tokens.length - 1 && this.tokens[end].type !== 'footnote_block_close') {
          end++;
        }
        return end;
      }
      case 'table_open': {
        let end = i;
        this.captioned(plan.captions.get(i), () => {
          end = this.table(i);
        });
        return end;
      }
      case 'fence':
        this.captioned(plan.captions.get(i), () => this.codeBlock(token));
        return i;
      default:
        return undefined;
    }
  }

  /** Left indent, in twips, for the current list and quotation nesting. */
  private abntLeft(): number {
    const list = this.lists.length
      ? tw(ABNT.listIndent) + this.lists.length * tw(ABNT.listHang)
      : 0;
    return this.quoteDepth * tw(ABNT.quoteIndent) + list;
  }

  /**
   * `\pard` for ABNT text: justified, 1.5 lines (quotations: small and single), the
   * owed list marker hanging before the text, and `firstIndent` for body paragraphs.
   */
  private abntParagraphStart(extraProps: string, firstIndent: boolean): string {
    const left = this.abntLeft();
    const quote = this.quoteDepth > 0;
    let props = `\\pard\\plain\\qj\\f0\\lang${ABNT.rtfLang}\\sa0`;
    props += quote ? `\\fs${FS_SMALL}${SL_SINGLE}` : `\\fs${FS_BODY}${SL_BODY}`;
    if (left) props += `\\li${left}`;
    if (this.spaceBefore && !this.afterHeading) props += `\\sb${this.spaceBefore}`;
    this.spaceBefore = 0;
    this.afterHeading = false;
    if (this.breakBefore) {
      props += '\\pagebb';
      this.breakBefore = false;
    }
    props += extraProps;
    if (this.pendingMarker !== undefined) {
      props += `\\fi-${tw(ABNT.listHang)}\\tx${left} ${this.pendingMarker}\\tab`;
      this.pendingMarker = undefined;
    } else if (firstIndent && !quote && !this.lists.length) {
      props += `\\fi${tw(ABNT.firstLineIndent)}`;
    }
    return props + ' ';
  }

  /** `\pard` of a heading at `level`: style, 1.5 lines, one 1.5 line before and after. */
  private headingProps(level: number): string {
    let props =
      `\\pard\\plain\\s${level}\\outlinelevel${level - 1}\\keepn\\sb${PITCH}\\sa${PITCH}` +
      `${SL_BODY}\\f0\\fs${FS_BODY}\\lang${ABNT.rtfLang}`;
    if (this.breakBefore) {
      props += '\\pagebb';
      this.breakBefore = false;
    }
    this.spaceBefore = 0;
    return props;
  }

  private abntHeading(i: number): number {
    const { plan, options } = this.abnt!;
    const heading = plan.headings.get(i) ?? { role: 'section', level: 2 };
    const { level, role } = heading;
    if (role === 'section' && level === 2 && options.primaryNewPage) this.breakBefore = true;
    let props = this.headingProps(level) + (role === 'section' ? '\\ql' : '\\qc');
    if (role !== 'section' || level === 2 || level === 4) props += '\\b';
    if (role === 'section' && level === 6) props += '\\i';
    let number = '';
    if (heading.number) {
      // Lines after the first align with the title's first letter, past the number.
      const hang = numberWidth(heading.number);
      props += `\\li${hang}\\fi-${hang}\\tx${hang}`;
      number = `${heading.number}\\tab `;
    }
    this.out.push(props + ' ');

    const id = this.tokens[i].attrGet('id');
    if (id) {
      const name = bookmarkName(id);
      this.out.push(`{\\*\\bkmkstart ${name}}{\\*\\bkmkend ${name}}`);
    }
    const inline = this.tokens[i + 1];
    this.out.push(number);
    if (inline?.type === 'inline') this.out.push(this.inline(inline.children ?? []));
    this.out.push('\\par\n');
    this.afterHeading = true;
    if (role === 'title') this.identification();
    return i + 2;
  }

  /** Subtitle, author, place and date, centered under the title (once). */
  private identification(): void {
    if (this.identified) return;
    this.identified = true;
    const lines = this.abnt!.plan.identification;
    if (!lines.length) return;
    this.afterHeading = false;
    for (const line of lines) {
      this.out.push(
        `\\pard\\plain\\qc\\f0\\fs${FS_BODY}${SL_BODY}\\lang${ABNT.rtfLang} ${escapeRtf(line)}\\par\n`,
      );
    }
    this.spaceBefore = PITCH;
  }

  /** `a)`, `b)` for alíneas, `–` for subalíneas, `•` for bullets when chosen. */
  private abntMarker(item: Token, options: AbntOptions): string {
    if (item.attrGet('class')?.includes('task-list-item')) return ''; // the checkbox is the marker
    const list = this.lists[this.lists.length - 1];
    if (!list) return '';
    if (this.lists.length > 1) return '\\u8211?'; // –
    if (list.ordered || options.unorderedList === 'alinea') return `${alineaLetter(list.next++)})`;
    return BULLETS[0];
  }

  /** `Tabela 1 – Título` above (kept with the element), `Fonte: ...` below. */
  private captioned(caption: Caption | undefined, draw: () => void): void {
    if (!caption) return draw();
    const props = `\\pard\\plain\\qc\\f0\\fs${FS_SMALL}${SL_SINGLE}\\lang${ABNT.rtfLang}`;
    const label = escapeRtf(`${caption.kind} ${caption.number} – `);
    const before = this.afterHeading ? 0 : Math.max(PITCH, this.spaceBefore);
    this.afterHeading = false;
    const pageBreak = this.breakBefore ? '\\pagebb' : '';
    this.breakBefore = false;
    this.spaceBefore = 0;
    this.out.push(
      `${props}\\keepn${pageBreak}\\sb${before}\\sa60 ${label}${this.inline(caption.title)}\\par\n`,
    );
    draw();
    this.spaceBefore = 0;
    if (caption.source) {
      this.out.push(`${props}\\sb60\\sa0 ${this.inline(caption.source)}\\par\n`);
    }
    this.spaceBefore = PITCH;
  }

  /** A paragraph holding only an image: centered, with its identification and source. */
  private abntFigure(i: number, caption: Caption | undefined): void {
    const image = (this.tokens[i + 1].children ?? []).find((child) => child.type === 'image');
    if (!image) return;
    this.captioned(caption, () => {
      const before = this.spaceBefore ? `\\sb${this.spaceBefore}` : '';
      this.spaceBefore = 0;
      const keep = caption?.source ? '\\keepn' : '';
      this.out.push(`\\pard\\plain\\qc${keep}${before}\\sa0\\f0 ${this.image(image)}\\par\n`);
    });
    if (!caption) this.spaceBefore = PITCH;
  }

  /** A footnote, written at its first call; Word places it at the foot of the page. */
  private footnote(n: number): string {
    if (this.inNote || this.notesWritten.has(n)) return `{\\super ${n}}`;
    this.notesWritten.add(n);
    this.inNote = true;
    const paragraphs = (this.abnt!.plan.notes.get(n) ?? []).map((p) => this.inline(p));
    this.inNote = false;
    const props =
      `\\pard\\plain\\s${FOOTNOTE_STYLE}\\qj\\f0\\fs${FS_SMALL}${SL_SINGLE}\\lang${ABNT.rtfLang}` +
      `\\li${FOOTNOTE_HANG}`;
    const call = `{\\cs${FOOTNOTE_CALL_STYLE}\\super\\chftn}`;
    const first = `${props}\\fi-${FOOTNOTE_HANG}\\tx${FOOTNOTE_HANG} ${call}\\tab `;
    const body = paragraphs
      .map((text, index) => (index ? `\\par${props}\\fi0 ${text}` : first + text))
      .join('');
    return `${call}{\\footnote${body || first}}`;
  }

  // ---------------------------------------------------------------- inline

  private inline(children: Token[]): string {
    let out = '';
    for (const token of children) {
      switch (token.type) {
        case 'text':
          // Collapse whitespace runs like HTML does; code keeps its spacing.
          out += escapeRtf(token.content.replace(/ {2,}/g, ' '));
          break;
        case 'softbreak':
          out += ' ';
          break;
        case 'hardbreak':
          out += '\\line ';
          break;
        case 'strong_open':
          out += '{\\b ';
          break;
        case 'em_open':
          out += '{\\i ';
          break;
        case 's_open':
          out += '{\\strike ';
          break;
        case 'strong_close':
        case 'em_close':
        case 's_close':
          out += '}';
          break;
        case 'code_inline':
          out += this.abnt
            ? `{\\f1 ${escapeRtf(token.content)}}`
            : `{\\f1\\fs${this.codeFs}\\chcbpat${COLOR_CODE_BG} ${escapeRtf(token.content)}}`;
          break;
        case 'link_open':
          out += this.linkOpen(token.attrGet('href') ?? '');
          break;
        case 'link_close':
          out += '}}}';
          break;
        case 'image':
          out += this.image(token);
          break;
        case 'task_checkbox':
          out += `${(token.meta as { checked: boolean }).checked ? CHECKBOX.checked : CHECKBOX.unchecked} `;
          break;
        case 'math_inline':
        case 'math_inline_block': {
          const image = this.options.loadGraphic?.('math-inline', token.content);
          if (image) {
            out += this.picture(image);
          } else {
            this.warnings.add('math');
            out += `{\\f1 ${escapeRtf(token.content)}}`;
          }
          break;
        }
        case 'footnote_ref':
          out += this.abnt
            ? this.footnote(footnoteNumber(token))
            : `{\\super ${footnoteNumber(token)}}`;
          break;
        case 'html_inline':
          if (/^<br\s*\/?>$/i.test(token.content)) out += '\\line ';
          else if (!token.content.startsWith('<!--')) this.warnings.add('html');
          break;
        case 'footnote_anchor':
          break;
        default:
          if (token.children) out += this.inline(token.children);
          else if (token.content) out += escapeRtf(token.content);
      }
    }
    return out;
  }

  private linkOpen(href: string): string {
    const target = href.startsWith('#')
      ? `\\\\l "${bookmarkName(decodeFragment(href.slice(1)))}"`
      : `"${escapeRtf(href).replace(/"/g, '%22')}"`;
    // ABNT: black and not underlined, like the rest of the text.
    const look = this.abnt ? '' : `\\ul\\cf${COLOR_LINK} `;
    return `{\\field{\\*\\fldinst{HYPERLINK ${target}}}{\\fldrslt{${look}`;
  }

  private image(token: Token): string {
    const src = token.attrGet('src') ?? '';
    const image = src ? this.options.loadImage?.(src) : undefined;
    if (image) return this.picture(image);
    this.warnings.add('image');
    return `[${escapeRtf(token.content || src)}]`;
  }
}

/**
 * Width of a section number and the space after it, in twips, for 12 pt text: digits are
 * half an em in Times New Roman (a little more in Arial), periods and spaces a quarter.
 * With some slack, so the tab after the number never jumps to the next default stop.
 */
function numberWidth(number: string): number {
  const digits = number.replace(/\D/g, '').length;
  const periods = number.length - digits;
  const em = ABNT.font.body * 20;
  return Math.round((digits * 0.5 + periods * 0.25 + 0.25) * em * 1.15);
}
