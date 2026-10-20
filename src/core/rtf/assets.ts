import type { Token } from '../MarkdownEngine';

/** Content with no RTF equivalent that can be embedded as a rendered picture. */
export type GraphicKind = 'math-inline' | 'math-block' | 'mermaid';

export interface Graphic {
  kind: GraphicKind;
  source: string;
}

export interface RtfAssets {
  /** Image `src` attributes, as written in the document. */
  images: Set<string>;
  /** Formulas and diagrams, de-duplicated. */
  graphics: Graphic[];
}

/** Stable lookup key for a graphic. */
export function graphicKey(kind: GraphicKind, source: string): string {
  return `${kind}\n${source}`;
}

/** Lists the images, formulas and diagrams the RTF renderer will ask for. */
export function collectRtfAssets(tokens: Token[], options: { math: boolean; mermaid: boolean }) {
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
  return { images, graphics: [...graphics.values()] } satisfies RtfAssets;
}

export function fenceLanguage(token: Token): string {
  return token.info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
}
