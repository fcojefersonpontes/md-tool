import * as fontkit from 'fontkit';
import type { FamilyFaces, FontSource, ResolvedFonts } from '../fonts/fontIndex';
import type { Measurer, TextStyle } from './layout';

type Face = 'regular' | 'bold' | 'italic' | 'boldItalic';

/** The 14 standard PDF fonts, used only when no system font could be found. */
const STANDARD: Record<'body' | 'mono', Record<Face, string>> = {
  body: {
    regular: 'Helvetica',
    bold: 'Helvetica-Bold',
    italic: 'Helvetica-Oblique',
    boldItalic: 'Helvetica-BoldOblique',
  },
  mono: {
    regular: 'Courier',
    bold: 'Courier-Bold',
    italic: 'Courier-Oblique',
    boldItalic: 'Courier-BoldOblique',
  },
};

/** Characters the standard fonts can show (WinAnsi). */
const WIN_ANSI = /^[\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]$/;

interface Run {
  font: string;
  text: string;
}

interface Glyphs {
  hasGlyphForCodePoint(codePoint: number): boolean;
}

interface Outline {
  id: number;
  path: { toSVG(): string };
}

interface Color {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

/** The fontkit internals needed to draw a color font. */
interface ColorFont extends Glyphs {
  directory: { tables: Record<string, unknown> };
  unitsPerEm: number;
  getGlyph(id: number, codePoints?: number[]): unknown;
  _getBaseGlyph(id: number, codePoints?: number[]): Outline | null;
  layout(text: string): {
    glyphs: Outline[];
    positions: { xAdvance: number; xOffset: number; yOffset: number }[];
  };
  COLR?: {
    baseGlyphRecord: { gid: number; firstLayerIndex: number; numLayers: number }[];
    layerRecords: { gid: number; paletteIndex: number }[];
  };
  CPAL?: { colorRecords: Color[] };
}

/** One layer of a color glyph: an outline in SVG path syntax, and its color. */
interface Layer {
  path: string;
  /** Undefined: the text color. */
  color?: Color;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Graphemes shown as emoji, like a browser does: emoji by default (😀, flags), or made
 * so by U+FE0F, a skin tone, a joiner or a keycap. U+FE0E asks for the text form.
 */
const EMOJI = /^(?!.*︎)(?:\p{Emoji_Presentation}|.*(?:️|‍|⃣|\p{Emoji_Modifier}))/su;

const NO_GLYPHS: Glyphs = { hasGlyphForCodePoint: () => false };

/**
 * Color fonts (Segoe UI Emoji: COLR; Apple Color Emoji: sbix) give color glyphs that
 * pdfkit cannot embed. Makes `font` give its monochrome outlines instead; false when it
 * has none.
 */
function monochrome(font: ColorFont): boolean {
  const tables = font.directory.tables;
  if (!tables.sbix && !tables.COLR) return true;
  if (!tables.glyf && !tables['CFF '] && !tables.CFF2) return false;
  font.getGlyph = (id, codePoints) => font._getBaseGlyph(id, codePoints);
  return true;
}

interface Component {
  scale01: number;
  scale10: number;
}

interface TtfGlyph {
  _decode(): { components?: Component[] } | null;
}

const patched = new WeakSet<object>();

/**
 * fontkit applies the 2x2 transform of composite TrueType glyphs transposed
 * (x' = a·x + b·y instead of a·x + c·y), so rotated or skewed parts land in the wrong
 * place; Segoe UI Emoji has many. Swaps the two terms back as glyphs are decoded.
 */
function fixComposites(glyph: object): void {
  const prototype = Object.getPrototypeOf(glyph) as TtfGlyph;
  if (patched.has(prototype) || typeof prototype._decode !== 'function') return;
  patched.add(prototype);
  const decode = prototype._decode;
  prototype._decode = function (this: TtfGlyph) {
    const decoded = decode.call(this);
    for (const component of decoded?.components ?? []) {
      [component.scale01, component.scale10] = [component.scale10, component.scale01];
    }
    return decoded;
  };
}

/** The COLR layers of glyph `id`, or its plain outline when it has none. */
function layersOf(font: ColorFont, id: number): Layer[] {
  const colr = font.COLR!;
  const first = font._getBaseGlyph(id);
  if (first && font.directory.tables.glyf) fixComposites(first);
  const base = binarySearch(colr.baseGlyphRecord, id);
  if (!base) return [{ path: font._getBaseGlyph(id)?.path.toSVG() ?? '' }];
  return colr.layerRecords
    .slice(base.firstLayerIndex, base.firstLayerIndex + base.numLayers)
    .map((layer) => ({
      path: font._getBaseGlyph(layer.gid)?.path.toSVG() ?? '',
      // 0xFFFF is the text color.
      color: layer.paletteIndex === 0xffff ? undefined : font.CPAL!.colorRecords[layer.paletteIndex],
    }));
}

function binarySearch<T extends { gid: number }>(records: T[], gid: number): T | undefined {
  let low = 0;
  let high = records.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (records[mid].gid === gid) return records[mid];
    if (records[mid].gid < gid) low = mid + 1;
    else high = mid - 1;
  }
  return undefined;
}

/**
 * Registers the chosen system fonts with pdfkit and splits text into runs, each
 * drawn with the first font that has its characters (body, then fallbacks).
 */
export class PdfFonts implements Measurer {
  private readonly coverage = new Map<string, Glyphs | undefined>();
  /** Fallbacks with COLR color glyphs, drawn layer by layer. */
  private readonly colorFonts = new Map<string, ColorFont>();
  private readonly layers = new Map<string, Layer[]>();
  private readonly fallbackNames: string[] = [];
  /** Fallbacks tried first for emoji, before fonts with text-style symbols. */
  private readonly emojiNames: string[] = [];
  private readonly sources = new Map<string, FontSource>();
  private readonly standard: boolean;

  constructor(
    private readonly doc: PDFKit.PDFDocument,
    private readonly fonts: ResolvedFonts,
  ) {
    this.standard = !fonts.body;
    this.registerFamily('body', fonts.body);
    this.registerFamily('mono', fonts.mono ?? fonts.body);
    // Fallbacks are registered when first needed (see `covers`).
    fonts.fallbacks.forEach((family, i) => {
      const name = `fallback-${i}`;
      this.sources.set(name, family.regular);
      this.fallbackNames.push(name);
      if (/emoji/i.test(family.name)) this.emojiNames.push(name);
    });
  }

  /** pdfkit name of the font for a style's family and face. */
  fontName(style: Pick<TextStyle, 'family' | 'bold' | 'italic'>): string {
    const face: Face = style.bold
      ? style.italic
        ? 'boldItalic'
        : 'bold'
      : style.italic
        ? 'italic'
        : 'regular';
    const family = style.family === 'mono' && (this.fonts.mono || this.standard) ? 'mono' : 'body';
    return this.standard ? STANDARD[family][face] : `${family}-${face}`;
  }

  /**
   * Splits text into runs by font coverage. A grapheme (an emoji with its skin tone,
   * joiners or keycap) stays in one font, the first that has all its characters.
   */
  runs(text: string, style: Pick<TextStyle, 'family' | 'bold' | 'italic'>): Run[] {
    const primary = this.fontName(style);
    const runs: Run[] = [];
    for (const { segment } of segmenter.segment(text)) {
      const chars = Array.from(segment);
      const coversAll = (name: string) => chars.every((char) => this.covers(name, char));
      let font = primary;
      let shown = segment;
      const emoji = EMOJI.test(segment) && this.emojiNames.find(coversAll);
      if (emoji) {
        font = emoji;
      } else if (!coversAll(primary)) {
        const fallback =
          (chars.length > 1 && this.fallbackNames.find(coversAll)) ||
          (this.covers(primary, chars[0]) ? primary : undefined) ||
          this.fallbackNames.find((name) => this.covers(name, chars[0]));
        if (fallback) font = fallback;
        else if (this.standard) shown = '?';
      }
      const last = runs[runs.length - 1];
      if (last?.font === font) last.text += shown;
      else runs.push({ font, text: shown });
    }
    return runs;
  }

  width(text: string, style: TextStyle): number {
    let width = 0;
    for (const run of this.runs(text, style)) {
      width += this.doc.font(run.font).fontSize(style.size).widthOfString(run.text);
    }
    return width;
  }

  ascent(style: TextStyle): number {
    return style.size * 0.8;
  }

  descent(style: TextStyle): number {
    return style.size * 0.22;
  }

  /** Draws text with its baseline at `baseline`; returns the width drawn. */
  draw(text: string, style: TextStyle, x: number, baseline: number): number {
    let cursor = x;
    for (const run of this.runs(text, style)) {
      const color = this.colorFonts.get(run.font);
      if (color) this.drawLayers(color, run.font, run.text, style, cursor, baseline);
      // Over color glyphs the text is invisible, kept for copying and searching.
      this.doc
        .font(run.font)
        .fontSize(style.size)
        .fillColor(style.color, color ? 0 : 1)
        .text(run.text, cursor, baseline - (style.rise ?? 0), {
          lineBreak: false,
          baseline: 'alphabetic',
        });
      cursor += this.doc.widthOfString(run.text);
    }
    this.doc.fillOpacity(1);
    return cursor - x;
  }

  /** Draws text in a COLR font as filled outlines, one per color layer. */
  private drawLayers(
    font: ColorFont,
    name: string,
    text: string,
    style: TextStyle,
    x: number,
    baseline: number,
  ): void {
    const scale = style.size / font.unitsPerEm;
    const { glyphs, positions } = font.layout(text);
    let cursor = x;
    glyphs.forEach((glyph, i) => {
      const position = positions[i];
      const key = `${name}:${glyph.id}`;
      let layers = this.layers.get(key);
      if (!layers) this.layers.set(key, (layers = layersOf(font, glyph.id)));
      for (const layer of layers) {
        if (!layer.path) continue;
        const { red, green, blue, alpha } = layer.color ?? { red: 0, green: 0, blue: 0, alpha: 255 };
        this.doc
          .save()
          .translate(
            cursor + position.xOffset * scale,
            baseline - (style.rise ?? 0) - position.yOffset * scale,
          )
          .scale(scale, -scale)
          .fillColor(layer.color ? [red, green, blue] : style.color, alpha / 255)
          .path(layer.path)
          .fill()
          .restore();
      }
      cursor += position.xAdvance * scale;
    });
  }

  /** Font names for `<text>` in SVG diagrams. */
  svgFont(family: string, bold: boolean, italic: boolean): string {
    const mono = /mono|courier|consol|menlo/i.test(family);
    return this.fontName({ family: mono ? 'mono' : 'body', bold, italic });
  }

  private registerFamily(prefix: 'body' | 'mono', family: FamilyFaces | undefined): void {
    if (!family) return;
    for (const face of ['regular', 'bold', 'italic', 'boldItalic'] as const) {
      this.register(`${prefix}-${face}`, family[face]);
    }
  }

  private register(name: string, source: FontSource): void {
    this.doc.registerFont(name, source.file, source.postscriptName);
    this.sources.set(name, source);
  }

  private covers(name: string, char: string): boolean {
    const codePoint = char.codePointAt(0)!;
    if (codePoint < 0x20 || char === ' ') return true;
    if (this.standard) return WIN_ANSI.test(char);
    if (!this.coverage.has(name)) {
      const source = this.sources.get(name);
      let font: ColorFont | undefined;
      try {
        const opened = source && fontkit.openSync(source.file, source.postscriptName);
        font = opened && 'hasGlyphForCodePoint' in opened ? (opened as unknown as ColorFont) : undefined;
      } catch {
        font = undefined;
      }
      if (font && !monochrome(font)) {
        this.coverage.set(name, NO_GLYPHS);
      } else {
        this.coverage.set(name, font);
        if (font?.COLR && font.CPAL) this.colorFonts.set(name, font);
        if (source && this.fallbackNames.includes(name)) {
          // pdfkit takes an opened fontkit font as is, so the monochrome glyphs are embedded.
          this.doc.registerFont(name, (font ?? source.file) as PDFKit.Mixins.PDFFontSource);
        }
      }
    }
    return this.coverage.get(name)?.hasGlyphForCodePoint(codePoint) ?? true;
  }
}
