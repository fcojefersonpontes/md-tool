import type { Token } from '../MarkdownEngine';
import { fenceLanguage, type GraphicKind } from './assets';
import { escapeRtf } from './escape';
import { imageToRtf, type RtfImage } from './images';

/** Content that has no RTF equivalent and was exported in a degraded form. */
export type RtfWarning = 'mermaid' | 'math' | 'html' | 'image';

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
  }

  write(): RtfResult {
    this.out.push(this.header());
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
    const indent = (this.lists.length + this.quoteDepth) * INDENT;
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
    const charWidth = this.options.fontSize * 11; // ~0.55em in twips
    const widths = Array.from({ length: columns }, (_, c) => {
      const chars = Math.max(...rows.map((row) => row.cells[c]?.inline?.content.length ?? 0));
      return (Math.min(60, Math.max(3, chars)) + 2) * charWidth;
    });
    const left = (this.lists.length + this.quoteDepth) * INDENT;
    const available = this.contentWidth - left;
    const total = widths.reduce((sum, width) => sum + width, 0);
    const scale = Math.min(1, available / total);
    const edges: number[] = [];
    let position = left;
    for (const width of widths) {
      position += Math.round(width * scale);
      edges.push(position);
    }

    const border = (side: string) => `\\clbrdr${side}\\brdrs\\brdrw10\\brdrcf${COLOR_BORDER}`;
    for (const row of rows) {
      let line = `\\trowd\\trgaph108\\trleft${left}${row.header ? '\\trhdr' : ''}`;
      for (const edge of edges) {
        line += border('t') + border('l') + border('b') + border('r');
        if (row.header) line += `\\clcbpat${COLOR_CODE_BG}`;
        line += `\\cellx${edge}`;
      }
      line += '\n';
      for (let c = 0; c < columns; c++) {
        const cell = row.cells[c];
        const content = cell?.inline ? this.inline(cell.inline.children ?? []) : '';
        line +=
          `\\pard\\plain\\intbl\\q${cell?.align ?? 'l'}\\f0\\fs${this.fs}\\cf${COLOR_TEXT} ` +
          (row.header ? `{\\b ${content}}` : content) +
          '\\cell\n';
      }
      this.out.push(line + '\\row\n');
    }
    // Space between the table and what follows.
    this.out.push(`\\pard\\plain\\sa0\\fs${Math.round(this.fs / 2)}\\par\n`);
    return end;
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
          out += `{\\f1\\fs${this.codeFs}\\chcbpat${COLOR_CODE_BG} ${escapeRtf(token.content)}}`;
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
          out += `{\\super ${footnoteNumber(token)}}`;
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
    return `{\\field{\\*\\fldinst{HYPERLINK ${target}}}{\\fldrslt{\\ul\\cf${COLOR_LINK} `;
  }

  private image(token: Token): string {
    const src = token.attrGet('src') ?? '';
    const image = src ? this.options.loadImage?.(src) : undefined;
    if (image) return this.picture(image);
    this.warnings.add('image');
    return `[${escapeRtf(token.content || src)}]`;
  }
}

function footnoteNumber(token: Token): number {
  return ((token.meta as { id?: number } | null)?.id ?? 0) + 1;
}

function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}
