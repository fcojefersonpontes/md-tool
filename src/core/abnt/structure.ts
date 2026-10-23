import Token from 'markdown-it/lib/token.mjs';
import { type ExportWarning, footnoteNumber } from '../exportAssets';
import type { AbntOptions, Identification } from './profile';

/** How a heading is presented: the document title, a numbered section or an unnumbered one. */
export interface AbntHeading {
  role: 'title' | 'section' | 'unnumbered';
  level: number;
  /** `1.2.3`, for numbered sections. */
  number?: string;
}

/** An illustration, table or quadro, with its identification above and source below. */
export interface Caption {
  /** `Figura`, `Gráfico`, `Tabela`, `Quadro`, ... */
  kind: string;
  /** Numbered per kind. */
  number: number;
  /** Inline content of the title. */
  title: Token[];
  /** Inline content of the source line (`Fonte: ...`), when there is one. */
  source?: Token[];
}

/** What the ABNT layout adds to the token stream; indexes are into that stream. */
export interface AbntPlan {
  headings: Map<number, AbntHeading>;
  /** Keyed by the element: `table_open`, `fence`, or the `paragraph_open` of a figure. */
  captions: Map<number, Caption>;
  /** `paragraph_open` of paragraphs holding only an image: drawn as centered figures. */
  figures: Set<number>;
  /** `paragraph_open` of caption and source paragraphs, drawn with their element instead. */
  skip: Set<number>;
  /** `paragraph_open` of the entries under REFERÊNCIAS. */
  references: Set<number>;
  /** Footnote number → the inline content of each of its paragraphs. */
  notes: Map<number, Token[][]>;
  /** Title from the front matter, for documents without a `#` heading. */
  title?: string;
  /** Subtitle, author, place and date, shown under the title. */
  identification: string[];
  warnings: ExportWarning[];
}

const ILLUSTRATIONS = [
  'Figura',
  'Gráfico',
  'Mapa',
  'Fotografia',
  'Organograma',
  'Fluxograma',
  'Esquema',
  'Desenho',
  'Diagrama',
  'Ilustração',
  'Imagem',
  'Planta',
];
const KINDS = [...ILLUSTRATIONS, 'Tabela', 'Quadro'];
const CAPTION = new RegExp(`^(${KINDS.join('|')})\\s*:\\s*`, 'iu');
const SOURCE = /^Fonte\s*:/iu;
const REFERENCES = /^REFER[ÊE]NCIAS$/u;
/** Pandoc's markers for an unnumbered heading. */
const UNNUMBERED_MARK = /\s*\{\s*(?:\.unnumbered|-)\s*\}\s*$/;
/** ABNT titles without a section number (NBR 14724); `APÊNDICE A – ...` included. */
const UNNUMBERED =
  /^(REFER[ÊE]NCIAS|GLOSS[ÁA]RIO|AP[ÊE]NDICES?|ANEXOS?|[ÍI]NDICE|SUM[ÁA]RIO|ERRATA|AGRADECIMENTOS|DEDICAT[ÓO]RIA|EP[ÍI]GRAFE|RESUMO|ABSTRACT|LISTA DE)(\s|$)/u;

/**
 * Finds the document title, numbers the sections, pairs illustrations and tables with
 * their captions and sources, and collects footnotes. Heading text is rewritten in place
 * (upper case, markers removed): the tokens must come from a fresh parse.
 */
export function analyzeAbnt(
  tokens: Token[],
  options: AbntOptions,
  meta: { title?: string; identification: Identification },
): AbntPlan {
  const plan: AbntPlan = {
    headings: new Map(),
    captions: new Map(),
    figures: new Set(),
    skip: new Set(),
    references: new Set(),
    notes: new Map(),
    identification: [],
    warnings: [],
  };
  const warn = (warning: ExportWarning) => {
    if (!plan.warnings.includes(warning)) plan.warnings.push(warning);
  };

  const counters = [0, 0, 0, 0, 0, 0, 0];
  const captionCounters = new Map<string, number>();
  let hasTitle = false;
  let previousLevel = 1;
  let inNotes = false;
  let inReferences = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'footnote_block_open') inNotes = true;
    if (token.type === 'footnote_block_close') inNotes = false;
    if (inNotes) continue;

    if (token.type === 'heading_open') {
      const level = Number(token.tag.slice(1));
      const inline = tokens[i + 1];
      const marked = stripUnnumberedMark(inline);
      const text = inline?.content.trim() ?? '';
      let heading: AbntHeading;
      if (level === 1) {
        heading = { role: 'title', level };
        hasTitle = true;
      } else if (marked || (level === 2 && UNNUMBERED.test(upper(text)))) {
        heading = { role: 'unnumbered', level };
      } else {
        if (level > previousLevel + 1) warn('heading-level');
        previousLevel = level;
        counters[level]++;
        counters.fill(0, level + 1);
        heading = {
          role: 'section',
          level,
          number: options.numberSections ? counters.slice(2, level + 1).join('.') : undefined,
        };
      }
      if (heading.role !== 'section' || level <= 3) upperInline(inline);
      plan.headings.set(i, heading);
      if (level <= 2) inReferences = heading.role === 'unnumbered' && REFERENCES.test(upper(text));
      continue;
    }
    if (inReferences && token.type === 'paragraph_open' && token.level === 0) {
      plan.references.add(i);
    }

    const element = elementAt(tokens, i);
    if (!element) continue;
    if (element.figure) plan.figures.add(i);

    // Identification: a `Kind: title` paragraph before the element, or the image's alt text.
    const before = paragraphBefore(tokens, i);
    let kind: string | undefined;
    let title: Token[] | undefined;
    const captionMatch = before !== undefined && matchCaption(tokens[before + 1]);
    if (captionMatch) {
      plan.skip.add(before!);
      ({ kind, title } = captionMatch);
    } else if (element.figure && element.image.content.trim()) {
      const alt = element.image.children?.length
        ? element.image.children
        : [textToken(element.image.content)];
      const altMatch = matchCaption({ children: alt, content: element.image.content } as Token);
      kind = altMatch ? altMatch.kind : 'Figura';
      title = altMatch ? altMatch.title : alt;
    }
    if (!kind || !title) continue;

    // Source: a `Fonte: ...` paragraph after the element, or the image's title attribute.
    let source: Token[] | undefined;
    const after = element.end + 1;
    if (isParagraph(tokens, after) && SOURCE.test(tokens[after + 1].content.trim())) {
      plan.skip.add(after);
      source = tokens[after + 1].children ?? [];
    } else if (element.figure && element.image.attrGet('title')?.trim()) {
      const text = element.image.attrGet('title')!.trim();
      source = [textToken(SOURCE.test(text) ? text : `Fonte: ${text}`)];
    } else {
      warn('source');
    }

    const number = (captionCounters.get(kind) ?? 0) + 1;
    captionCounters.set(kind, number);
    plan.captions.set(i, { kind, number, title, source });
  }

  // Footnotes, drawn where they are called (at the foot of the page).
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'footnote_open') continue;
    const paragraphs: Token[][] = [];
    for (let j = i + 1; j < tokens.length && tokens[j].type !== 'footnote_close'; j++) {
      if (tokens[j].type === 'inline') {
        paragraphs.push(
          (tokens[j].children ?? []).filter((child) => child.type !== 'footnote_anchor'),
        );
      }
    }
    plan.notes.set(footnoteNumber(tokens[i]), paragraphs);
  }

  if (!hasTitle && meta.title) plan.title = upper(meta.title);
  const { subtitle, author, place, date } = meta.identification;
  plan.identification = [subtitle, author, place, date].filter(
    (line): line is string => line !== undefined,
  );
  return plan;
}

/** The kind (`Tabela`, `Quadro`) a table is drawn as. */
export function tableKind(plan: AbntPlan, index: number, options: AbntOptions): string {
  return (
    plan.captions.get(index)?.kind ?? (options.defaultTable === 'tabela' ? 'Tabela' : 'Quadro')
  );
}

/** Letter label of the `n`th alínea (1 → `a`, 27 → `aa`). */
export function alineaLetter(n: number): string {
  let label = '';
  for (let value = Math.max(1, n); value > 0; value = Math.floor((value - 1) / 26)) {
    label = String.fromCharCode(97 + ((value - 1) % 26)) + label;
  }
  return label;
}

function upper(text: string): string {
  return text.toLocaleUpperCase('pt-BR');
}

function upperInline(inline: Token | undefined): void {
  if (!inline) return;
  inline.content = upper(inline.content);
  const visit = (children: Token[]) => {
    for (const child of children) {
      if (child.type === 'text') child.content = upper(child.content);
      if (child.children) visit(child.children);
    }
  };
  visit(inline.children ?? []);
}

/** Removes a trailing `{.unnumbered}` / `{-}`; true if there was one. */
function stripUnnumberedMark(inline: Token | undefined): boolean {
  const last = inline?.children?.[inline.children.length - 1];
  if (!inline || last?.type !== 'text' || !UNNUMBERED_MARK.test(last.content)) return false;
  last.content = last.content.replace(UNNUMBERED_MARK, '');
  inline.content = inline.content.replace(UNNUMBERED_MARK, '');
  return true;
}

function isParagraph(tokens: Token[], i: number): boolean {
  return (
    tokens[i]?.type === 'paragraph_open' &&
    tokens[i + 1]?.type === 'inline' &&
    tokens[i + 2]?.type === 'paragraph_close'
  );
}

/** Index of the paragraph just before `i`, if the token before it closes one. */
function paragraphBefore(tokens: Token[], i: number): number | undefined {
  return isParagraph(tokens, i - 3) ? i - 3 : undefined;
}

type Element = { end: number } & ({ figure: false } | { figure: true; image: Token });

/** A table, a fenced block or a paragraph holding only an image, starting at `i`. */
function elementAt(tokens: Token[], i: number): Element | undefined {
  const token = tokens[i];
  if (token.type === 'table_open') {
    let end = i;
    while (end < tokens.length - 1 && tokens[end].type !== 'table_close') end++;
    return { end, figure: false };
  }
  if (token.type === 'fence') return { end: i, figure: false };
  if (isParagraph(tokens, i)) {
    const content = (tokens[i + 1].children ?? []).filter(
      (child) => child.type !== 'softbreak' && !(child.type === 'text' && !child.content.trim()),
    );
    if (content.length === 1 && content[0].type === 'image') {
      return { end: i + 2, figure: true, image: content[0] };
    }
  }
  return undefined;
}

/** `Tabela: título` → kind and the title's inline content (prefix removed). */
function matchCaption(inline: Token | undefined): { kind: string; title: Token[] } | undefined {
  const children = inline?.children ?? [];
  const first = children[0];
  if (first?.type !== 'text') return undefined;
  const match = CAPTION.exec(first.content);
  if (!match) return undefined;
  const kind = KINDS.find((name) => name.toLowerCase() === match[1].toLowerCase())!;
  const rest = first.content.slice(match[0].length);
  const title = [...(rest ? [textToken(rest)] : []), ...children.slice(1)];
  return title.length ? { kind, title } : undefined;
}

function textToken(content: string): Token {
  const token = new Token('text', '', 0);
  token.content = content;
  return token;
}
