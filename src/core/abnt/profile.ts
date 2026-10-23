/** Points per centimetre. */
const CM = 72 / 2.54;

export type ExportProfile = 'default' | 'abnt';

export const EXPORT_PROFILES: readonly ExportProfile[] = ['default', 'abnt'];

/**
 * ABNT presentation rules for a formal document (NBR 14724, NBR 6024, NBR 10520), as
 * described in docs/spec-perfil-abnt-documento-formal.md. The single source of values:
 * the PDF and RTF renderers only translate them. Lengths in points.
 */
export const ABNT = {
  page: { size: 'A4', margin: { top: '3cm', right: '2cm', bottom: '2cm', left: '3cm' } },
  font: {
    /** ABNT does not fix a family; Times New Roman, or the closest one installed. */
    family: ['Times New Roman', 'Liberation Serif', 'Tinos', 'Nimbus Roman', 'Times'],
    mono: ['Courier New', 'Liberation Mono', 'Cousine', 'Nimbus Mono PS', 'Courier'],
    body: 12,
    /** Long quotations, notes, captions, sources, page numbers. */
    small: 10,
  },
  /** Height of a single-spaced line, in ems ("single" in Word for Times New Roman and Arial). */
  singleLine: 1.15,
  /** Body line spacing, in single lines. */
  bodySpacing: 1.5,
  firstLineIndent: 1.25 * CM,
  /** From the margin to an alínea's letter. */
  listIndent: 1.25 * CM,
  /** From an alínea's letter to its text; nested items start under that text. */
  listHang: 0.63 * CM,
  quoteIndent: 4 * CM,
  footnoteRule: 5 * CM,
  /** Page number: distance of the number from the top and right edges. */
  pageNumber: { top: 2 * CM, right: 2 * CM },
  lang: 'pt-BR',
  /** RTF language id of pt-BR. */
  rtfLang: 1046,
} as const;

/** Distance between baselines for `size`-point text at `spacing` lines. */
export function linePitch(size: number, spacing: number): number {
  return size * ABNT.singleLine * spacing;
}

/** Choices a document makes in its front matter (`abnt:` block). */
export interface AbntOptions {
  /** `-` lists: lettered alíneas (strict) or bullets. */
  unorderedList: 'alinea' | 'marcador';
  /** Page number on the first page. */
  firstPageNumber: boolean;
  /** What `---` does. */
  rule: 'quebra_pagina' | 'ignorar' | 'linha';
  /** A table without a `Tabela:` / `Quadro:` caption is drawn as this. */
  defaultTable: 'quadro' | 'tabela';
  /** Every `##` starts a page. */
  primaryNewPage: boolean;
  numberSections: boolean;
}

export const DEFAULT_ABNT_OPTIONS: AbntOptions = {
  unorderedList: 'alinea',
  firstPageNumber: true,
  rule: 'quebra_pagina',
  defaultTable: 'quadro',
  primaryNewPage: false,
  numberSections: true,
};

/** Lines shown under the document title. */
export interface Identification {
  subtitle?: string;
  author?: string;
  place?: string;
  date?: string;
}

export function parseProfile(value: unknown): ExportProfile | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim().toLowerCase();
  if (name === 'abnt') return 'abnt';
  if (name === 'default' || name === 'padrao' || name === 'padrão') return 'default';
  return undefined;
}

/** Reads the `abnt:` front-matter block; unknown keys and invalid values are ignored. */
export function parseAbntOptions(value: unknown): Partial<AbntOptions> {
  const options: Partial<AbntOptions> = {};
  if (!value || typeof value !== 'object') return options;
  const block = value as Record<string, unknown>;
  const pick = <T extends string>(key: string, allowed: readonly T[]): T | undefined => {
    const raw = block[key];
    return typeof raw === 'string' && (allowed as readonly string[]).includes(raw.trim())
      ? (raw.trim() as T)
      : undefined;
  };
  const flag = (key: string) => (typeof block[key] === 'boolean' ? block[key] : undefined);

  const list = pick('lista_nao_ordenada', ['alinea', 'marcador']);
  if (list) options.unorderedList = list;
  const rule = pick('hr', ['quebra_pagina', 'ignorar', 'linha']);
  if (rule) options.rule = rule;
  const table = pick('tabela_padrao', ['quadro', 'tabela']);
  if (table) options.defaultTable = table;
  const first = flag('primeira_pagina_visivel');
  if (first !== undefined) options.firstPageNumber = first;
  const newPage = flag('secao_primaria_nova_pagina');
  if (newPage !== undefined) options.primaryNewPage = newPage;
  const numbers = flag('numeracao_secoes');
  if (numbers !== undefined) options.numberSections = numbers;
  return options;
}

/** Reads `subtitulo`, `autor`, `local` and `data` (or their English names). */
export function parseIdentification(root: Record<string, unknown>): Identification {
  const text = (...keys: string[]) => {
    for (const key of keys) {
      const value = root[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number') return String(value);
      if (value instanceof Date) return value.toISOString().slice(0, 10);
    }
    return undefined;
  };
  return {
    subtitle: text('subtitulo', 'subtitle'),
    author: text('autor', 'author'),
    place: text('local', 'place'),
    date: text('data', 'date'),
  };
}
