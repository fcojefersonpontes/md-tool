import { parse as parseYaml } from 'yaml';

export type PageSize = 'A4' | 'Letter' | 'Legal';

export const PAGE_SIZES: readonly PageSize[] = ['A4', 'Letter', 'Legal'];

/** Page dimensions in millimetres (portrait). */
const PAGE_SIZE_MM: Record<PageSize, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
};

/** CSS lengths such as `20mm`, `1in`, `12pt`. */
export interface Margins {
  top: string;
  right: string;
  bottom: string;
  left: string;
}

export interface PageOptions {
  pageSize: PageSize;
  landscape: boolean;
  margin: Margins;
}

export interface PdfOptions extends PageOptions {
  headerTemplate: string;
  footerTemplate: string;
}

/** PDF settings a document can override in its YAML front matter. */
export type PdfOverrides = Partial<Omit<PdfOptions, 'margin'>> & {
  /** Raw value; resolved against the configured margin by `resolvePdfOptions`. */
  margin?: unknown;
};

export interface DocumentMeta {
  title?: string;
  pdf: PdfOverrides;
}

const LENGTH = /^(\d+(?:\.\d+)?)\s*(mm|cm|in|pt|px)?$/i;
const TWIPS_PER_UNIT: Record<string, number> = {
  mm: 1440 / 25.4,
  cm: 1440 / 2.54,
  in: 1440,
  pt: 20,
  px: 15,
};

/** Converts a CSS length (unitless means px) to twips; `undefined` if invalid. */
export function lengthToTwips(length: string): number | undefined {
  const match = LENGTH.exec(length.trim());
  if (!match) return undefined;
  return Math.round(Number(match[1]) * TWIPS_PER_UNIT[(match[2] ?? 'px').toLowerCase()]);
}

function normalizeLength(value: unknown): string | undefined {
  if (typeof value === 'number' && value >= 0) return `${value}mm`;
  if (typeof value === 'string' && LENGTH.test(value.trim())) return value.trim();
  return undefined;
}

/**
 * Parses a margin given as a CSS shorthand (`"20mm"`, `"10mm 15mm"`, ...),
 * a number of millimetres, or an object with `top`/`right`/`bottom`/`left`.
 * Invalid parts fall back to `fallback`.
 */
export function parseMargin(value: unknown, fallback: Margins): Margins {
  if (typeof value === 'number') {
    const length = normalizeLength(value);
    return length ? { top: length, right: length, bottom: length, left: length } : fallback;
  }
  if (typeof value === 'string') {
    const parts = value.trim().split(/\s+/).map(normalizeLength);
    if (parts.length === 0 || parts.length > 4 || parts.some((part) => !part)) return fallback;
    const [top, right = top, bottom = top, left = right] = parts as string[];
    return { top, right, bottom, left };
  }
  if (value && typeof value === 'object') {
    const sides = value as Record<string, unknown>;
    return {
      top: normalizeLength(sides.top) ?? fallback.top,
      right: normalizeLength(sides.right) ?? fallback.right,
      bottom: normalizeLength(sides.bottom) ?? fallback.bottom,
      left: normalizeLength(sides.left) ?? fallback.left,
    };
  }
  return fallback;
}

export function parsePageSize(value: unknown): PageSize | undefined {
  if (typeof value !== 'string') return undefined;
  return PAGE_SIZES.find((size) => size.toLowerCase() === value.trim().toLowerCase());
}

/** Reads `title` and the `pdf:` block from raw YAML front matter. Never throws. */
export function parseDocumentMeta(frontMatter: string | undefined): DocumentMeta {
  const meta: DocumentMeta = { pdf: {} };
  if (!frontMatter) return meta;
  let data: unknown;
  try {
    data = parseYaml(frontMatter);
  } catch {
    return meta;
  }
  if (!data || typeof data !== 'object') return meta;
  const root = data as Record<string, unknown>;

  if (typeof root.title === 'string' && root.title.trim()) meta.title = root.title.trim();

  const pdf = root.pdf;
  if (pdf && typeof pdf === 'object') {
    const options = pdf as Record<string, unknown>;
    const pageSize = parsePageSize(options.pageSize ?? options.format);
    if (pageSize) meta.pdf.pageSize = pageSize;
    if (typeof options.landscape === 'boolean') meta.pdf.landscape = options.landscape;
    if (options.margin !== undefined) meta.pdf.margin = options.margin;
    for (const key of ['headerTemplate', 'footerTemplate'] as const) {
      if (typeof options[key] === 'string') meta.pdf[key] = options[key];
    }
  }
  return meta;
}

/** Applies front-matter overrides on top of the configured PDF options. */
export function resolvePdfOptions(defaults: PdfOptions, overrides: PdfOverrides): PdfOptions {
  const { margin, ...rest } = overrides;
  return {
    ...defaults,
    ...rest,
    margin: margin === undefined ? defaults.margin : parseMargin(margin, defaults.margin),
  };
}

/** Page size in twips, honouring orientation. */
export function pageSizeTwips(options: Pick<PageOptions, 'pageSize' | 'landscape'>): {
  width: number;
  height: number;
} {
  const mm = PAGE_SIZE_MM[options.pageSize];
  const width = Math.round(mm.width * TWIPS_PER_UNIT.mm);
  const height = Math.round(mm.height * TWIPS_PER_UNIT.mm);
  return options.landscape ? { width: height, height: width } : { width, height };
}
