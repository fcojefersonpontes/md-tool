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

/**
 * Registers the chosen system fonts with pdfkit and splits text into runs, each
 * drawn with the first font that has its characters (body, then fallbacks).
 */
export class PdfFonts implements Measurer {
  private readonly coverage = new Map<string, Glyphs | undefined>();
  private readonly fallbackNames: string[] = [];
  private readonly sources = new Map<string, FontSource>();
  private readonly standard: boolean;

  constructor(
    private readonly doc: PDFKit.PDFDocument,
    private readonly fonts: ResolvedFonts,
  ) {
    this.standard = !fonts.body;
    this.registerFamily('body', fonts.body);
    this.registerFamily('mono', fonts.mono ?? fonts.body);
    fonts.fallbacks.forEach((family, i) => {
      const name = `fallback-${i}`;
      this.register(name, family.regular);
      this.fallbackNames.push(name);
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

  /** Splits text into runs by font coverage. */
  runs(text: string, style: Pick<TextStyle, 'family' | 'bold' | 'italic'>): Run[] {
    const primary = this.fontName(style);
    const runs: Run[] = [];
    for (const char of text) {
      let font = primary;
      let shown = char;
      if (!this.covers(primary, char)) {
        const fallback = this.fallbackNames.find((name) => this.covers(name, char));
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
      this.doc
        .font(run.font)
        .fontSize(style.size)
        .fillColor(style.color)
        .text(run.text, cursor, baseline - (style.rise ?? 0), {
          lineBreak: false,
          baseline: 'alphabetic',
        });
      cursor += this.doc.widthOfString(run.text);
    }
    return cursor - x;
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
      let glyphs: Glyphs | undefined;
      try {
        const opened = source && fontkit.openSync(source.file, source.postscriptName);
        glyphs = opened && 'hasGlyphForCodePoint' in opened ? (opened as Glyphs) : undefined;
      } catch {
        glyphs = undefined;
      }
      this.coverage.set(name, glyphs);
    }
    return this.coverage.get(name)?.hasGlyphForCodePoint(codePoint) ?? true;
  }
}
