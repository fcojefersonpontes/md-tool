import { escapeHtml } from '../html';
import { readImage } from './images';

/**
 * Reads RTF into HTML for the built-in viewer. It covers what the exporter
 * writes and the common parts of RTF from word processors: character and
 * paragraph formatting, headings, tables, links, bookmarks, footnotes and
 * PNG/JPEG pictures. Anything else is skipped.
 */
export interface RtfView {
  /** Body HTML; all text is escaped and pictures are `data:` URIs. */
  html: string;
  /** Page geometry in CSS pixels. */
  page: {
    width: number;
    height: number;
    margin: { top: number; right: number; bottom: number; left: number };
  };
}

/** Twips (1/1440 in) to CSS pixels (1/96 in). */
const px = (twips: number) => Math.round((twips / 15) * 100) / 100;

type Side = 'top' | 'right' | 'bottom' | 'left';

interface CharFormat {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  hidden: boolean;
  font: number;
  /** Half-points. */
  size: number;
  /** Color table indexes; 0 is "automatic". */
  color: number;
  background: number;
  script?: 'super' | 'sub';
  /** Baseline shift in half-points (\up, \dn). */
  shift: number;
}

interface Border {
  /** Twips. */
  width: number;
  color: number;
}

interface ParaFormat {
  align?: 'left' | 'center' | 'right' | 'justify';
  /** Twips. */
  left: number;
  right: number;
  first: number;
  before: number;
  after: number;
  style: number;
  outline?: number;
  inTable: boolean;
  shading: number;
  borders: Partial<Record<Side, Border>>;
}

type Inline =
  | { type: 'text'; text: string; char: CharFormat; link?: string }
  | { type: 'image'; src: string; width: number; height: number; char: CharFormat; link?: string }
  | { type: 'anchor'; name: string }
  | { type: 'break' };

type Block =
  | { type: 'para'; para: ParaFormat; size: number; inlines: Inline[] }
  | { type: 'table'; rows: Row[] }
  | { type: 'page' };

interface Row {
  header: boolean;
  cells: { width?: number; shading: number; blocks: Block[] }[];
}

interface RowDef {
  left: number;
  header: boolean;
  cells: { right: number; shading: number }[];
}

type Destination =
  'text' | 'skip' | 'fonttbl' | 'colortbl' | 'stylesheet' | 'pict' | 'fldinst' | 'bookmark';

interface Group {
  char: CharFormat;
  dest: Destination;
  /** Fallback characters after \u. */
  uc: number;
  link?: string;
  field?: { instruction: string };
  /** Inside \footnote. */
  footnote?: boolean;
  /** List markers (listtext, pntext): their paragraph words are not the paragraph's. */
  markerOnly?: boolean;
}

interface Font {
  name: string;
  generic: string;
  encoding?: string;
}

interface Picture {
  format?: 'png' | 'jpeg';
  hex: string[];
  binary?: Uint8Array;
  width?: number;
  height?: number;
  goalWidth?: number;
  goalHeight?: number;
  scaleX: number;
  scaleY: number;
}

/** Output in progress: the document body, or a footnote. */
interface Sink {
  blocks: Block[];
  inlines: Inline[];
  para: ParaFormat;
}

/** Destinations whose text is not part of the document. */
const SKIPPED = new Set([
  'info',
  'header',
  'headerl',
  'headerr',
  'headerf',
  'footer',
  'footerl',
  'footerr',
  'footerf',
  'ftnsep',
  'ftnsepc',
  'ftncn',
  'aftnsep',
  'aftnsepc',
  'aftncn',
  'pn',
  'pnseclvl',
  'pntxta',
  'pntxtb',
  'object',
  'nonshppict',
  'xe',
  'tc',
  'txe',
  'rxe',
  'template',
  'author',
  'operator',
  'comment',
  'listtable',
  'listoverridetable',
  'revtbl',
  'rsidtbl',
  'filetbl',
  'pgdsctbl',
  'themedata',
  'colorschememapping',
  'latentstyles',
  'datastore',
  'xmlnstbl',
  'generator',
  'private',
  'userprops',
  'docvar',
  'fldtype',
  'datafield',
]);

/** Starred destinations that are read; any other \* group is skipped. */
const KNOWN_STARRED = new Set(['fldinst', 'bkmkstart', 'shppict', 'footnote']);

const SYMBOLS: Record<string, string> = {
  emdash: '—',
  endash: '–',
  emspace: ' ',
  enspace: ' ',
  qmspace: ' ',
  bullet: '•',
  lquote: '‘',
  rquote: '’',
  ldblquote: '“',
  rdblquote: '”',
  zwj: '‍',
  zwnj: '‌',
  ltrmark: '‎',
  rtlmark: '‏',
};

/** \fcharset to a TextDecoder label. */
const CHARSETS: Record<number, string> = {
  128: 'shift_jis',
  129: 'euc-kr',
  134: 'gbk',
  136: 'big5',
  161: 'windows-1253',
  162: 'windows-1254',
  163: 'windows-1258',
  177: 'windows-1255',
  178: 'windows-1256',
  186: 'windows-1257',
  204: 'windows-1251',
  222: 'windows-874',
  238: 'windows-1250',
};

/** Symbol / Wingdings fonts (\fcharset2): only the list bullets Word uses are mapped. */
const SYMBOL_ENCODING = 'symbol';
const SYMBOL_CHARS: Record<number, string> = { 0xb7: '•', 0xa7: '▪', 0x6f: '◦' };

/** Paragraph control words, ignored inside list markers. */
const PARA_WORDS = new Set(
  'pard ql qc qr qj li ri fi sb sa s outlinelevel intbl cbpat brdrt brdrr brdrb brdrl box brdrw brdrcf brdrnone'.split(
    ' ',
  ),
);

const GENERIC: Record<string, string> = {
  fswiss: 'sans-serif',
  fmodern: 'monospace',
  froman: 'serif',
  fscript: 'cursive',
  fdecor: 'fantasy',
};

const defaultChar = (font: number): CharFormat => ({
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  hidden: false,
  font,
  size: 24,
  color: 0,
  background: 0,
  shift: 0,
});

const defaultPara = (): ParaFormat => ({
  left: 0,
  right: 0,
  first: 0,
  before: 0,
  after: 0,
  style: 0,
  inTable: false,
  shading: 0,
  borders: {},
});

export function rtfToHtml(data: Uint8Array): RtfView {
  return new RtfReader(data).read();
}

class RtfReader {
  private pos = 0;
  private stack: Group[] = [];
  private group: Group = { char: defaultChar(0), dest: 'text', uc: 1 };
  private starred = false;
  private skipFallback = 0;
  /** Raw bytes waiting to be decoded with the current font's encoding. */
  private bytes: number[] = [];

  private encoding = 'windows-1252';
  private defaultFont = 0;
  private readonly fonts = new Map<number, Font>();
  private fontId: number | undefined;
  private readonly colors: (string | undefined)[] = [];
  private color: { r?: number; g?: number; b?: number } = {};
  private readonly styles = new Map<number, { outline?: number; name: string }>();
  private styleId: number | undefined;
  private pict: Picture | undefined;
  private bookmark = '';

  private sink: Sink = { blocks: [], inlines: [], para: defaultPara() };
  private readonly notes: Block[][] = [];
  /** The border that rdrw, rdrcf and rdrnone apply to, and its sides. */
  private border: Border | undefined;
  private borderSides: Side[] = [];
  private rowDef: RowDef = { left: 0, header: false, cells: [] };
  private pendingShading = 0;
  private cellBlocks: Block[] = [];
  private rowCells: Block[][] = [];
  private tableOpen = false;
  private footnoteDepth = 0;
  private outerSinks: Sink[] = [];
  /** A font or style name split across tokens. */
  private pendingName = '';

  private readonly page = {
    width: 12240,
    height: 15840,
    margin: { top: 1440, right: 1800, bottom: 1440, left: 1800 },
  };

  constructor(private readonly data: Uint8Array) {}

  read(): RtfView {
    const { data } = this;
    while (this.pos < data.length) {
      const byte = data[this.pos++];
      if (byte === 0x7b /* { */) {
        this.flush();
        this.open();
      } else if (byte === 0x7d /* } */) {
        this.flush();
        this.close();
      } else if (byte === 0x5c /* \ */) {
        this.control();
      } else if (byte === 0x0d || byte === 0x0a) {
        // Line breaks in the file are not content.
      } else if (byte === 0x09) {
        this.flush();
        this.text('\t');
      } else {
        this.byte(byte);
      }
    }
    this.flush();
    this.endParagraph(false);
    this.endTable();
    return {
      html: this.renderBlocks(this.sink.blocks) + this.renderNotes(),
      page: {
        width: px(this.page.width),
        height: px(this.page.height),
        margin: {
          top: px(this.page.margin.top),
          right: px(this.page.margin.right),
          bottom: px(this.page.margin.bottom),
          left: px(this.page.margin.left),
        },
      },
    };
  }

  // --- Tokens ---------------------------------------------------------------

  private open(): void {
    this.stack.push(this.group);
    this.group = { ...this.group, char: { ...this.group.char } };
    this.skipFallback = 0;
  }

  private close(): void {
    const closed = this.group;
    const parent = this.stack.pop();
    if (!parent) return; // unbalanced: ignore the extra brace
    this.group = parent;
    this.skipFallback = 0;
    if (closed.dest === 'pict' && parent.dest !== 'pict') this.endPicture(closed);
    if (closed.dest === 'bookmark' && parent.dest !== 'bookmark') {
      const name = this.bookmark.trim();
      if (name) this.sink.inlines.push({ type: 'anchor', name });
    }
    if (closed.footnote && !parent.footnote) this.endFootnote();
  }

  private control(): void {
    const { data } = this;
    const next = data[this.pos];
    if (next === undefined) return;
    const isLetter = (byte: number) =>
      (byte >= 0x61 && byte <= 0x7a) || (byte >= 0x41 && byte <= 0x5a);
    if (isLetter(next)) {
      let name = '';
      while (this.pos < data.length && isLetter(data[this.pos]) && name.length < 32) {
        name += String.fromCharCode(data[this.pos++]);
      }
      let digits = '';
      if (data[this.pos] === 0x2d /* - */) digits = String.fromCharCode(data[this.pos++]);
      while (this.pos < data.length && data[this.pos] >= 0x30 && data[this.pos] <= 0x39) {
        digits += String.fromCharCode(data[this.pos++]);
      }
      if (data[this.pos] === 0x20) this.pos++; // the delimiting space
      const param = digits && digits !== '-' ? Number(digits) : undefined;
      if (name === 'bin') {
        const length = param ?? 0;
        const binary = data.subarray(this.pos, this.pos + length);
        this.pos += length;
        if (this.group.dest === 'pict' && this.pict) this.pict.binary = binary;
        return;
      }
      if (name === 'u' && param !== undefined) {
        this.flush();
        this.text(String.fromCharCode(param < 0 ? param + 65536 : param));
        this.skipFallback = this.group.uc;
        return;
      }
      if (this.skipFallback > 0) {
        this.skipFallback--;
        return;
      }
      this.flush();
      this.word(name, param);
      return;
    }

    this.pos++;
    if (next === 0x27 /* ' */) {
      const hex = String.fromCharCode(data[this.pos] ?? 0, data[this.pos + 1] ?? 0);
      this.pos += 2;
      const value = parseInt(hex, 16);
      if (!Number.isNaN(value)) this.byte(value);
      return;
    }
    if (this.skipFallback > 0) {
      this.skipFallback--;
      return;
    }
    this.flush();
    switch (String.fromCharCode(next)) {
      case '*':
        this.starred = true;
        break;
      case '\\':
      case '{':
      case '}':
        this.text(String.fromCharCode(next));
        break;
      case '~':
        this.text(' ');
        break;
      case '_':
        this.text('‑');
        break;
      case '\r':
      case '\n':
        this.word('par');
        break;
      // \- (optional hyphen), \| and \: (index entries) show nothing.
    }
  }

  /** A content byte: part of the text, a picture's hex data or a table name. */
  private byte(value: number): void {
    if (this.skipFallback > 0) {
      this.skipFallback--;
      return;
    }
    if (this.group.dest === 'pict') {
      if (this.pict) this.pict.hex.push(String.fromCharCode(value));
      return;
    }
    this.bytes.push(value);
  }

  /** Decodes pending bytes with the encoding of the current font. */
  private flush(): void {
    if (!this.bytes.length) return;
    const bytes = Uint8Array.from(this.bytes);
    this.bytes = [];
    const encoding = this.fonts.get(this.group.char.font)?.encoding ?? this.encoding;
    this.text(decode(bytes, encoding));
  }

  /** Text in the current destination. */
  private text(text: string): void {
    const { group } = this;
    switch (group.dest) {
      case 'text': {
        if (group.char.hidden) return;
        const last = this.sink.inlines[this.sink.inlines.length - 1];
        if (last?.type === 'text' && last.link === group.link && sameChar(last.char, group.char)) {
          last.text += text;
        } else {
          this.sink.inlines.push({ type: 'text', text, char: { ...group.char }, link: group.link });
        }
        return;
      }
      case 'fonttbl':
        if (this.fontId !== undefined) {
          this.nameUntilSemicolon(text, (name) => {
            const font = this.fonts.get(this.fontId!);
            if (font) font.name = name;
            this.fontId = undefined;
          });
        }
        return;
      case 'colortbl':
        for (const char of text) {
          if (char !== ';') continue;
          const { r, g, b } = this.color;
          this.colors.push(
            r === undefined && g === undefined && b === undefined
              ? undefined
              : `rgb(${r ?? 0}, ${g ?? 0}, ${b ?? 0})`,
          );
          this.color = {};
        }
        return;
      case 'stylesheet':
        if (this.styleId !== undefined) {
          this.nameUntilSemicolon(text, (name) => {
            const style = this.styles.get(this.styleId!);
            if (style) {
              style.name = name;
              const heading = /^heading (\d)$/i.exec(name);
              if (style.outline === undefined && heading) style.outline = Number(heading[1]) - 1;
            }
            this.styleId = undefined;
          });
        }
        return;
      case 'fldinst':
        if (group.field) group.field.instruction += text;
        return;
      case 'bookmark':
        this.bookmark += text;
        return;
    }
  }

  private nameUntilSemicolon(text: string, done: (name: string) => void): void {
    const end = text.indexOf(';');
    if (end < 0) {
      this.pendingName += text;
      return;
    }
    done((this.pendingName + text.slice(0, end)).trim());
    this.pendingName = '';
  }

  // --- Control words -------------------------------------------------------

  private word(name: string, param?: number): void {
    const { group } = this;
    const starred = this.starred;
    this.starred = false;
    if (group.dest === 'skip') return;

    // Destinations.
    if (starred && !KNOWN_STARRED.has(name)) {
      group.dest = 'skip';
      return;
    }
    if (SKIPPED.has(name)) {
      group.dest = 'skip';
      return;
    }
    switch (name) {
      case 'fonttbl':
        group.dest = 'fonttbl';
        return;
      case 'colortbl':
        group.dest = 'colortbl';
        return;
      case 'stylesheet':
        group.dest = 'stylesheet';
        return;
      case 'pict':
        group.dest = 'pict';
        this.pict = { hex: [], scaleX: 100, scaleY: 100 };
        return;
      case 'field':
        group.field = { instruction: '' };
        return;
      case 'fldinst':
        group.dest = 'fldinst';
        return;
      case 'fldrslt':
        group.link = hyperlink(group.field?.instruction ?? '') ?? group.link;
        return;
      case 'bkmkstart':
        group.dest = 'bookmark';
        this.bookmark = '';
        return;
      case 'footnote':
        this.startFootnote();
        return;
      case 'listtext':
      case 'pntext':
        group.markerOnly = true;
        return;
      case 'chftn':
        this.text(String(this.footnoteDepth ? this.notes.length : this.notes.length + 1));
        return;
    }

    if (group.dest === 'fonttbl') return this.fontWord(name, param);
    if (group.dest === 'colortbl') {
      if (name === 'red') this.color.r = param;
      else if (name === 'green') this.color.g = param;
      else if (name === 'blue') this.color.b = param;
      return;
    }
    if (group.dest === 'stylesheet') {
      if (name === 's') {
        this.styleId = param ?? 0;
        this.styles.set(this.styleId, { name: '' });
      } else if (name === 'cs' || name === 'ds' || name === 'ts' || name === 'tsrowd') {
        this.styleId = undefined;
      } else if (name === 'outlinelevel' && this.styleId !== undefined) {
        const style = this.styles.get(this.styleId);
        if (style) style.outline = param;
      }
      return;
    }
    if (group.dest === 'pict') return this.pictWord(name, param);
    if (group.dest !== 'text') return;

    if (this.charWord(name, param)) return;
    if (this.paraWord(name, param)) return;
    this.documentWord(name, param);
  }

  private fontWord(name: string, param?: number): void {
    if (name === 'f') {
      this.fontId = param ?? 0;
      this.fonts.set(this.fontId, { name: '', generic: 'sans-serif' });
      this.pendingName = '';
      return;
    }
    const font = this.fontId === undefined ? undefined : this.fonts.get(this.fontId);
    if (!font) return;
    if (name in GENERIC) font.generic = GENERIC[name];
    else if (name === 'fcharset' && param !== undefined) {
      font.encoding = param === 2 ? SYMBOL_ENCODING : CHARSETS[param];
    }
  }

  private pictWord(name: string, param?: number): void {
    const pict = this.pict;
    if (!pict) return;
    switch (name) {
      case 'pngblip':
        pict.format = 'png';
        break;
      case 'jpegblip':
        pict.format = 'jpeg';
        break;
      case 'picw':
        pict.width = param;
        break;
      case 'pich':
        pict.height = param;
        break;
      case 'picwgoal':
        pict.goalWidth = param;
        break;
      case 'pichgoal':
        pict.goalHeight = param;
        break;
      case 'picscalex':
        pict.scaleX = param ?? 100;
        break;
      case 'picscaley':
        pict.scaleY = param ?? 100;
        break;
    }
  }

  private charWord(name: string, param?: number): boolean {
    const char = this.group.char;
    const on = param !== 0;
    switch (name) {
      case 'plain':
        this.group.char = defaultChar(this.defaultFont);
        return true;
      case 'b':
        char.bold = on;
        return true;
      case 'i':
        char.italic = on;
        return true;
      case 'ul':
      case 'uld':
      case 'uldb':
      case 'uldash':
      case 'ulw':
      case 'ulwave':
      case 'ulth':
        char.underline = on;
        return true;
      case 'ulnone':
        char.underline = false;
        return true;
      case 'strike':
      case 'striked':
        char.strike = on;
        return true;
      case 'v':
        char.hidden = on;
        return true;
      case 'f':
        char.font = param ?? this.defaultFont;
        return true;
      case 'fs':
        char.size = param ?? 24;
        return true;
      case 'cf':
        char.color = param ?? 0;
        return true;
      case 'cb':
      case 'chcbpat':
      case 'highlight':
        char.background = param ?? 0;
        return true;
      case 'super':
        char.script = 'super';
        return true;
      case 'sub':
        char.script = 'sub';
        return true;
      case 'nosupersub':
        char.script = undefined;
        return true;
      case 'up':
        char.shift = param ?? 6;
        return true;
      case 'dn':
        char.shift = -(param ?? 6);
        return true;
      case 'tab':
        this.text('\t');
        return true;
      case 'line':
        if (this.group.dest === 'text') this.sink.inlines.push({ type: 'break' });
        return true;
    }
    if (name in SYMBOLS) {
      this.text(SYMBOLS[name]);
      return true;
    }
    return false;
  }

  private paraWord(name: string, param?: number): boolean {
    const para = this.sink.para;
    if (this.group.markerOnly) return name !== 'par' && name in PARA_WORDS;
    switch (name) {
      case 'pard':
        this.sink.para = defaultPara();
        this.border = undefined;
        this.borderSides = [];
        return true;
      case 'par':
        this.endParagraph(true);
        return true;
      case 'ql':
        para.align = 'left';
        return true;
      case 'qc':
        para.align = 'center';
        return true;
      case 'qr':
        para.align = 'right';
        return true;
      case 'qj':
        para.align = 'justify';
        return true;
      case 'li':
        para.left = param ?? 0;
        return true;
      case 'ri':
        para.right = param ?? 0;
        return true;
      case 'fi':
        para.first = param ?? 0;
        return true;
      case 'sb':
        para.before = param ?? 0;
        return true;
      case 'sa':
        para.after = param ?? 0;
        return true;
      case 's':
        para.style = param ?? 0;
        return true;
      case 'outlinelevel':
        para.outline = param;
        return true;
      case 'intbl':
        para.inTable = true;
        return true;
      case 'cbpat':
        para.shading = param ?? 0;
        return true;
      case 'brdrt':
      case 'brdrr':
      case 'brdrb':
      case 'brdrl': {
        const side = ({ brdrt: 'top', brdrr: 'right', brdrb: 'bottom', brdrl: 'left' } as const)[
          name
        ];
        this.border = para.borders[side] = { width: 15, color: 0 };
        this.borderSides = [side];
        return true;
      }
      case 'box':
        this.border = { width: 15, color: 0 };
        this.borderSides = ['top', 'right', 'bottom', 'left'];
        for (const side of this.borderSides) {
          para.borders[side] = this.border;
        }
        return true;
      case 'brdrw':
        if (this.border) this.border.width = param ?? 15;
        return true;
      case 'brdrcf':
        if (this.border) this.border.color = param ?? 0;
        return true;
      case 'brdrnone':
        for (const side of this.borderSides) delete para.borders[side];
        this.border = undefined;
        this.borderSides = [];
        return true;
    }
    return false;
  }

  private documentWord(name: string, param?: number): void {
    switch (name) {
      case 'ansicpg':
        if (param) this.encoding = param === 65001 ? 'utf-8' : `windows-${param}`;
        return;
      case 'mac':
        this.encoding = 'macintosh';
        return;
      case 'deff':
        this.defaultFont = param ?? 0;
        this.group.char.font = this.defaultFont;
        return;
      case 'uc':
        this.group.uc = param ?? 1;
        return;
      case 'paperw':
        this.page.width = param ?? this.page.width;
        return;
      case 'paperh':
        this.page.height = param ?? this.page.height;
        return;
      case 'margl':
        this.page.margin.left = param ?? this.page.margin.left;
        return;
      case 'margr':
        this.page.margin.right = param ?? this.page.margin.right;
        return;
      case 'margt':
        this.page.margin.top = param ?? this.page.margin.top;
        return;
      case 'margb':
        this.page.margin.bottom = param ?? this.page.margin.bottom;
        return;
      case 'page':
        this.endParagraph(false);
        this.endTable();
        this.sink.blocks.push({ type: 'page' });
        return;
      // Tables.
      case 'trowd':
        this.rowDef = { left: 0, header: false, cells: [] };
        this.pendingShading = 0;
        return;
      case 'trleft':
        this.rowDef.left = param ?? 0;
        return;
      case 'trhdr':
        this.rowDef.header = true;
        return;
      case 'clcbpat':
        this.pendingShading = param ?? 0;
        return;
      case 'clbrdrt':
      case 'clbrdrr':
      case 'clbrdrb':
      case 'clbrdrl':
      case 'trbrdrt':
      case 'trbrdrr':
      case 'trbrdrb':
      case 'trbrdrl':
      case 'trbrdrh':
      case 'trbrdrv':
        // Not drawn: tables get a uniform grid.
        this.border = { width: 0, color: 0 };
        this.borderSides = [];
        return;
      case 'cellx':
        this.rowDef.cells.push({ right: param ?? 0, shading: this.pendingShading });
        this.pendingShading = 0;
        return;
      case 'cell':
      case 'nestcell':
        this.endCell();
        return;
      case 'row':
      case 'nestrow':
        this.endRow();
        return;
    }
  }

  // --- Structure -----------------------------------------------------------

  private endParagraph(explicit: boolean): void {
    const { sink } = this;
    if (!explicit && !sink.inlines.length) return;
    const block: Block = {
      type: 'para',
      para: { ...sink.para, borders: { ...sink.para.borders } },
      size: this.group.char.size,
      inlines: sink.inlines,
    };
    sink.inlines = [];
    if (!this.footnoteDepth) {
      if (sink.para.inTable) {
        this.cellBlocks.push(block);
        return;
      }
      this.endTable();
    }
    sink.blocks.push(block);
  }

  private endCell(): void {
    if (this.sink.inlines.length || !this.cellBlocks.length) {
      this.sink.para.inTable = true;
      this.endParagraph(true);
    }
    this.rowCells.push(this.cellBlocks);
    this.cellBlocks = [];
  }

  private endRow(): void {
    if (this.sink.inlines.length) this.endCell();
    const def = this.rowDef;
    const row: Row = {
      header: def.header,
      cells: this.rowCells.map((blocks, i) => {
        const cell = def.cells[i];
        const start = i === 0 ? def.left : (def.cells[i - 1]?.right ?? 0);
        const width = cell && cell.right > start ? px(cell.right - start) : undefined;
        return { width, shading: cell?.shading ?? 0, blocks };
      }),
    };
    this.rowCells = [];
    const last = this.sink.blocks[this.sink.blocks.length - 1];
    if (this.tableOpen && last?.type === 'table') last.rows.push(row);
    else this.sink.blocks.push({ type: 'table', rows: [row] });
    this.tableOpen = true;
  }

  /** Closes a table whose last row was not ended with \row. */
  private endTable(): void {
    if (this.rowCells.length || this.cellBlocks.length) {
      if (this.cellBlocks.length) {
        this.rowCells.push(this.cellBlocks);
        this.cellBlocks = [];
      }
      this.endRow();
    }
    this.tableOpen = false;
  }

  private startFootnote(): void {
    this.group.footnote = true;
    this.footnoteDepth++;
    this.notes.push([]);
    this.outerSinks.push(this.sink);
    this.sink = { blocks: this.notes[this.notes.length - 1], inlines: [], para: defaultPara() };
  }

  private endFootnote(): void {
    this.endParagraph(false);
    this.footnoteDepth--;
    this.sink = this.outerSinks.pop() ?? this.sink;
  }

  private endPicture(group: Group): void {
    const pict = this.pict;
    this.pict = undefined;
    if (!pict) return;
    const data = pict.binary ?? hexBytes(pict.hex.join(''));
    const image = pict.format ? readImage(data) : undefined;
    if (!image) {
      // EMF, WMF, DIB...: not drawn, but their place is shown.
      this.text('[image]');
      return;
    }
    const width =
      ((pict.goalWidth ? px(pict.goalWidth) : (pict.width ?? image.width)) * pict.scaleX) / 100;
    const height =
      ((pict.goalHeight ? px(pict.goalHeight) : (pict.height ?? image.height)) * pict.scaleY) / 100;
    const mime = image.kind === 'png' ? 'image/png' : 'image/jpeg';
    this.sink.inlines.push({
      type: 'image',
      src: `data:${mime};base64,${Buffer.from(data).toString('base64')}`,
      width: Math.round(width * 100) / 100,
      height: Math.round(height * 100) / 100,
      char: { ...group.char },
      link: group.link,
    });
  }

  // --- HTML ----------------------------------------------------------------

  private renderBlocks(blocks: Block[]): string {
    return blocks.map((block) => this.renderBlock(block)).join('\n');
  }

  private renderBlock(block: Block): string {
    if (block.type === 'page') return '<hr class="page-break">';
    if (block.type === 'table') return this.renderTable(block.rows);

    const { para } = block;
    const outline = para.outline ?? this.styles.get(para.style)?.outline;
    const tag = outline !== undefined && outline >= 0 && outline < 6 ? `h${outline + 1}` : 'p';
    const style: string[] = [`font-size:${block.size / 2}pt`];
    if (para.align) style.push(`text-align:${para.align}`);
    if (para.left) style.push(`margin-left:${px(para.left)}px`);
    if (para.right) style.push(`margin-right:${px(para.right)}px`);
    if (para.first) style.push(`text-indent:${px(para.first)}px`);
    if (para.before) style.push(`margin-top:${px(para.before)}px`);
    if (para.after) style.push(`margin-bottom:${px(para.after)}px`);
    const background = this.colors[para.shading];
    if (para.shading && background) style.push(`background:${background}`);
    for (const [side, border] of Object.entries(para.borders)) {
      const color = this.colors[border.color] ?? 'currentColor';
      style.push(`border-${side}:${Math.max(1, px(border.width / 1.5))}px solid ${color}`);
      style.push(`padding-${side}:${side === 'left' || side === 'right' ? 8 : 2}px`);
    }
    // A hanging indent with "marker<tab>text" is a list item: the marker gets the
    // indent's width, so the text lines up with the following lines.
    const item = para.first < 0 ? splitMarker(block.inlines) : undefined;
    const content = item
      ? `<span class="marker" style="min-width:${px(-para.first)}px">${this.renderInlines(item.marker)}</span>` +
        this.renderInlines(item.rest)
      : this.renderInlines(block.inlines) || '<br>';
    return `<${tag} style="${style.join(';')}">${content}</${tag}>`;
  }

  private renderInlines(inlines: Inline[]): string {
    let html = '';
    for (const inline of inlines) {
      let piece: string;
      switch (inline.type) {
        case 'break':
          html += '<br>';
          continue;
        case 'anchor':
          html += `<a id="${escapeHtml(inline.name)}"></a>`;
          continue;
        case 'image': {
          const style = `width:${inline.width}px;height:${inline.height}px${this.shiftStyle(inline.char)}`;
          piece = `<img src="${inline.src}" alt="" style="${style}">`;
          break;
        }
        case 'text':
          piece = `<span style="${this.charStyle(inline.char)}">${escapeHtml(inline.text)}</span>`;
          break;
      }
      if (inline.link) {
        html += `<a href="${escapeHtml(inline.link)}" title="${escapeHtml(inline.link)}">${piece}</a>`;
      } else {
        html += piece;
      }
    }
    return html;
  }

  private charStyle(char: CharFormat): string {
    const font = this.fonts.get(char.font);
    const style: string[] = [];
    if (font) {
      const name = font.name.replace(/[^\p{L}\p{N} _-]/gu, '').trim();
      style.push(`font-family:${name ? `'${name}', ` : ''}${font.generic}`);
    }
    const size = char.script ? char.size * 0.66 : char.size;
    style.push(`font-size:${size / 2}pt`);
    if (char.bold) style.push('font-weight:bold');
    if (char.italic) style.push('font-style:italic');
    const decoration = [char.underline && 'underline', char.strike && 'line-through'].filter(
      Boolean,
    );
    if (decoration.length) style.push(`text-decoration:${decoration.join(' ')}`);
    const color = this.colors[char.color];
    if (char.color && color) style.push(`color:${color}`);
    const background = this.colors[char.background];
    if (char.background && background) style.push(`background:${background}`);
    if (char.script) style.push(`vertical-align:${char.script}`);
    return style.join(';') + this.shiftStyle(char);
  }

  private shiftStyle(char: CharFormat): string {
    return char.shift ? `;vertical-align:${char.shift / 2}pt` : '';
  }

  private renderTable(rows: Row[]): string {
    const columns = Math.max(...rows.map((row) => row.cells.length));
    const widths = rows
      .find((row) => row.cells.length === columns)
      ?.cells.map((cell) => cell.width);
    const colgroup = widths?.every((width) => width !== undefined)
      ? `<colgroup>${widths.map((width) => `<col style="width:${width}px">`).join('')}</colgroup>`
      : '';
    const renderRow = (row: Row) => {
      const tag = row.header ? 'th' : 'td';
      const cells = row.cells.map((cell) => {
        const background = this.colors[cell.shading];
        const style = cell.shading && background ? ` style="background:${background}"` : '';
        return `<${tag}${style}>${this.renderBlocks(cell.blocks)}</${tag}>`;
      });
      return `<tr>${cells.join('')}</tr>`;
    };
    const header = rows.filter((row) => row.header);
    const body = rows.filter((row) => !row.header);
    const width = widths?.every((w) => w !== undefined)
      ? ` style="width:${widths.reduce((sum, w) => sum + w!, 0)}px"`
      : '';
    return (
      `<table${width}>${colgroup}` +
      (header.length ? `<thead>${header.map(renderRow).join('')}</thead>` : '') +
      `<tbody>${body.map(renderRow).join('')}</tbody></table>`
    );
  }

  private renderNotes(): string {
    if (!this.notes.length) return '';
    const items = this.notes.map((blocks) => `<li>${this.renderBlocks(blocks)}</li>`).join('');
    return `<section class="footnotes"><hr><ol>${items}</ol></section>`;
  }
}

/** Splits a paragraph at its first tab, if only text comes before it. */
function splitMarker(inlines: Inline[]): { marker: Inline[]; rest: Inline[] } | undefined {
  for (const [i, inline] of inlines.entries()) {
    if (inline.type === 'anchor') continue;
    if (inline.type !== 'text') return undefined;
    const tab = inline.text.indexOf('\t');
    if (tab < 0) continue;
    const before = { ...inline, text: inline.text.slice(0, tab) };
    const after = { ...inline, text: inline.text.slice(tab + 1) };
    return {
      marker: [...inlines.slice(0, i), ...(before.text ? [before] : [])],
      rest: [...(after.text ? [after] : []), ...inlines.slice(i + 1)],
    };
  }
  return undefined;
}

function sameChar(a: CharFormat, b: CharFormat): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strike === b.strike &&
    a.hidden === b.hidden &&
    a.font === b.font &&
    a.size === b.size &&
    a.color === b.color &&
    a.background === b.background &&
    a.script === b.script &&
    a.shift === b.shift
  );
}

/** The target of a HYPERLINK field: a URL, or `#bookmark` for \l. */
function hyperlink(instruction: string): string | undefined {
  const match = /HYPERLINK\s+(?:\\l\s+)?"([^"]*)"(?:\s+\\l\s+"([^"]*)")?/i.exec(instruction);
  if (!match) return undefined;
  if (/HYPERLINK\s+\\l/i.test(instruction)) return `#${match[1]}`;
  return match[2] ? `${match[1]}#${match[2]}` : match[1];
}

function hexBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-f]/gi, '');
  const bytes = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  return bytes;
}

const decoders = new Map<string, { decode(bytes: Uint8Array): string }>();

function decode(bytes: Uint8Array, encoding: string): string {
  if (encoding === SYMBOL_ENCODING) {
    return Array.from(bytes, (byte) => SYMBOL_CHARS[byte] ?? String.fromCharCode(byte)).join('');
  }
  let decoder = decoders.get(encoding);
  if (!decoder) {
    try {
      decoder = new TextDecoder(encoding);
    } catch {
      decoder = new TextDecoder('windows-1252');
    }
    decoders.set(encoding, decoder);
  }
  return decoder.decode(bytes);
}
