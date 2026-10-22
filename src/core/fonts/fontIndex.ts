import * as fs from 'node:fs';
import * as path from 'node:path';
import { type FontFace, readFontFaces } from './sfnt';

/** A font file, and the face to use when it is a collection. */
export interface FontSource {
  file: string;
  /** Set only for faces of a `.ttc` collection. */
  postscriptName?: string;
}

/** The four faces of a family; missing ones fall back to the closest available. */
export interface FamilyFaces {
  name: string;
  regular: FontSource;
  bold: FontSource;
  italic: FontSource;
  boldItalic: FontSource;
}

interface PlatformDefaults {
  body: string[];
  mono: string[];
  /** Tried in order for characters the chosen font lacks (symbols, CJK, ...). */
  fallback: string[];
}

/** Default families per platform, most preferred first. */
export const PLATFORM_FONTS: Record<'win32' | 'darwin' | 'linux', PlatformDefaults> = {
  win32: {
    body: ['Segoe UI', 'Calibri', 'Arial'],
    mono: ['Consolas', 'Cascadia Mono', 'Courier New'],
    fallback: [
      'Segoe UI Symbol',
      'Segoe UI Emoji',
      'Cambria Math',
      'Microsoft YaHei',
      'Yu Gothic',
      'Malgun Gothic',
      'Nirmala UI',
      'Leelawadee UI',
      'Ebrima',
      'Segoe UI Historic',
    ],
  },
  darwin: {
    body: ['Helvetica Neue', 'Helvetica', 'Arial'],
    mono: ['Menlo', 'Monaco', 'Courier New'],
    fallback: [
      'Apple Symbols',
      'PingFang SC',
      'Hiragino Sans',
      'Apple SD Gothic Neo',
      'Arial Unicode MS',
    ],
  },
  linux: {
    body: ['DejaVu Sans', 'Liberation Sans', 'Noto Sans', 'FreeSans'],
    mono: ['DejaVu Sans Mono', 'Liberation Mono', 'Noto Sans Mono', 'FreeMono'],
    fallback: [
      'DejaVu Sans',
      'Noto Sans Symbols',
      'Noto Sans Symbols 2',
      'Noto Sans CJK SC',
      'Noto Sans CJK JP',
      'WenQuanYi Micro Hei',
    ],
  },
};

export function platformFonts(platform: NodeJS.Platform): PlatformDefaults {
  return platform === 'win32' || platform === 'darwin'
    ? PLATFORM_FONTS[platform]
    : PLATFORM_FONTS.linux;
}

/** Folders that hold installed fonts. */
export function systemFontDirs(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  const home = env.HOME ?? env.USERPROFILE ?? '';
  switch (platform) {
    case 'win32':
      return [
        path.join(env.WINDIR ?? 'C:\\Windows', 'Fonts'),
        ...(env.LOCALAPPDATA ? [path.join(env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts')] : []),
      ];
    case 'darwin':
      return [
        '/System/Library/Fonts',
        '/System/Library/Fonts/Supplemental',
        '/Library/Fonts',
        path.join(home, 'Library', 'Fonts'),
      ];
    default:
      return [
        '/usr/share/fonts',
        '/usr/local/share/fonts',
        path.join(home, '.local', 'share', 'fonts'),
        path.join(home, '.fonts'),
      ];
  }
}

const FONT_FILE = /\.(ttf|otf|ttc|otc)$/i;

/** The installed fonts, grouped by family name (case-insensitive). */
export class FontIndex {
  private constructor(private readonly families: Map<string, FontFace[]>) {}

  static fromFaces(faces: FontFace[]): FontIndex {
    const families = new Map<string, FontFace[]>();
    for (const face of faces) {
      const key = face.family.toLowerCase();
      families.set(key, [...(families.get(key) ?? []), face]);
    }
    return new FontIndex(families);
  }

  /** Reads every font file under `dirs` (recursively, as Linux nests them). */
  static scan(dirs: string[]): FontIndex {
    const faces: FontFace[] = [];
    const visit = (dir: string, depth: number) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && depth < 4) visit(full, depth + 1);
        else if (FONT_FILE.test(entry.name)) faces.push(...readFontFaces(full));
      }
    };
    for (const dir of dirs) visit(dir, 0);
    return FontIndex.fromFaces(faces);
  }

  has(family: string): boolean {
    return this.families.has(family.toLowerCase());
  }

  /** The faces of `family`, or `undefined` when it is not installed. */
  family(family: string): FamilyFaces | undefined {
    const faces = this.families.get(family.toLowerCase());
    if (!faces?.length) return undefined;
    const pick = (weight: number, italic: boolean): FontSource => {
      const best = [...faces].sort(
        (a, b) =>
          Number(a.italic !== italic) - Number(b.italic !== italic) ||
          Math.abs(a.weight - weight) - Math.abs(b.weight - weight) ||
          // Static faces before variable ones, which pdfkit draws at their default instance.
          Number(/variable|vf/i.test(a.postscriptName)) -
            Number(/variable|vf/i.test(b.postscriptName)),
      )[0];
      return best.collection
        ? { file: best.file, postscriptName: best.postscriptName }
        : { file: best.file };
    };
    return {
      name: faces[0].family,
      regular: pick(400, false),
      bold: pick(700, false),
      italic: pick(400, true),
      boldItalic: pick(700, true),
    };
  }

  /** The first installed family of `names`. */
  first(names: string[]): FamilyFaces | undefined {
    for (const name of names) {
      const faces = this.family(name);
      if (faces) return faces;
    }
    return undefined;
  }
}

let systemIndex: FontIndex | undefined;

/** The system font index, scanned once per session. */
export function systemFontIndex(): FontIndex {
  systemIndex ??= FontIndex.scan(systemFontDirs(process.platform, process.env));
  return systemIndex;
}

export interface ResolvedFonts {
  body?: FamilyFaces;
  mono?: FamilyFaces;
  fallbacks: FamilyFaces[];
}

/**
 * Picks the body and code families: the configured name when installed, else the
 * platform defaults. `undefined` faces mean no usable font was found at all.
 */
export function resolveFonts(
  index: FontIndex,
  platform: NodeJS.Platform,
  configured: { fontFamily: string; codeFontFamily: string },
): ResolvedFonts {
  const defaults = platformFonts(platform);
  const choose = (name: string, fallback: string[]) =>
    (name.trim() && index.family(name.trim())) || index.first(fallback);
  const body = choose(configured.fontFamily, defaults.body);
  return {
    body,
    mono: choose(configured.codeFontFamily, defaults.mono),
    fallbacks: defaults.fallback
      .filter((name) => name.toLowerCase() !== body?.name.toLowerCase())
      .map((name) => index.family(name))
      .filter((faces): faces is FamilyFaces => faces !== undefined),
  };
}
