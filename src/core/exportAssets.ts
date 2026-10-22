import type { Token } from './MarkdownEngine';

/** Content exported in a degraded form (as source text, alt text, or left out). */
export type ExportWarning = 'mermaid' | 'math' | 'html' | 'image';

/** Content that is drawn as a picture rather than written as text. */
export type GraphicKind = 'math-inline' | 'math-block' | 'mermaid';

export interface Graphic {
  kind: GraphicKind;
  source: string;
}

export interface ExportAssets {
  /** Image `src` attributes, as written in the document. */
  images: Set<string>;
  /** Formulas and diagrams, de-duplicated. */
  graphics: Graphic[];
}

/** Stable lookup key for a graphic. */
export function graphicKey(kind: GraphicKind, source: string): string {
  return `${kind}\n${source}`;
}

/** Lists the images, formulas and diagrams an exporter will ask for. */
export function collectAssets(
  tokens: Token[],
  options: { math: boolean; mermaid: boolean },
): ExportAssets {
  const images = new Set<string>();
  const graphics = new Map<string, Graphic>();
  const addGraphic = (kind: GraphicKind, source: string) => {
    graphics.set(graphicKey(kind, source), { kind, source });
  };

  const visit = (list: Token[]) => {
    for (const token of list) {
      switch (token.type) {
        case 'image': {
          const src = token.attrGet('src');
          if (src) images.add(src);
          break;
        }
        case 'math_inline':
        case 'math_inline_block':
          addGraphic('math-inline', token.content);
          break;
        case 'math_block':
        case 'math_block_eqno':
          addGraphic('math-block', token.content.trim());
          break;
        case 'fence': {
          const lang = fenceLanguage(token);
          if (lang === 'math' && options.math) addGraphic('math-block', token.content.trim());
          if (lang === 'mermaid' && options.mermaid) addGraphic('mermaid', token.content);
          break;
        }
      }
      if (token.children) visit(token.children);
    }
  };
  visit(tokens);
  return { images, graphics: [...graphics.values()] };
}

export function fenceLanguage(token: Token): string {
  return token.info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
}

/** `n` of a footnote reference or footnote, counting from 1. */
export function footnoteNumber(token: Token): number {
  return ((token.meta as { id?: number } | null)?.id ?? 0) + 1;
}

export function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}
