import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import 'mathjax-full/js/input/tex/base/BaseConfiguration.js';
import 'mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js';
import 'mathjax-full/js/input/tex/cancel/CancelConfiguration.js';
import 'mathjax-full/js/input/tex/color/ColorConfiguration.js';
import 'mathjax-full/js/input/tex/mathtools/MathtoolsConfiguration.js';
import 'mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js';
import 'mathjax-full/js/input/tex/textmacros/TextMacrosConfiguration.js';
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { SVG } from 'mathjax-full/js/output/svg.js';

/** A formula drawn as SVG paths; sizes are in ems of the surrounding text. */
export interface MathGraphic {
  svg: string;
  width: number;
  /** Above the baseline. */
  height: number;
  /** Below the baseline. */
  depth: number;
}

const PACKAGES = [
  'base',
  'ams',
  'newcommand',
  'boldsymbol',
  'cancel',
  'color',
  'mathtools',
  'textmacros',
];

/** MathJax lays formulas out with 1ex = 0.5em. */
const EM_PER_EX = 0.5;

type MathDocument = ReturnType<typeof mathjax.document>;
let state: { adaptor: ReturnType<typeof liteAdaptor>; document: MathDocument } | undefined;

function mathDocument() {
  if (!state) {
    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    const document = mathjax.document('', {
      InputJax: new TeX({ packages: PACKAGES }),
      // No shared glyph cache: every formula is a self-contained SVG of paths,
      // which PDF and PNG converters draw without any font.
      OutputJax: new SVG({ fontCache: 'none' }),
    });
    state = { adaptor, document };
  }
  return state;
}

/** Typesets TeX (KaTeX-style input) to SVG; `undefined` for invalid TeX. */
export function renderMath(tex: string, display: boolean): MathGraphic | undefined {
  const { adaptor, document } = mathDocument();
  let svg: string;
  try {
    svg = adaptor.innerHTML(document.convert(tex, { display }));
  } catch {
    return undefined;
  }
  if (/data-mjx-error|<merror\b/.test(svg)) return undefined;

  const ex = (pattern: RegExp) => Number(pattern.exec(svg)?.[1] ?? NaN);
  const width = ex(/^<svg[^>]*\swidth="([\d.]+)ex"/);
  const total = ex(/^<svg[^>]*\sheight="([\d.]+)ex"/);
  const depth = Math.max(0, -ex(/^<svg[^>]*vertical-align:\s*(-?[\d.]+)ex/) || 0);
  if (!(width > 0) || !(total > 0)) return undefined;
  return {
    svg,
    width: width * EM_PER_EX,
    height: (total - depth) * EM_PER_EX,
    depth: depth * EM_PER_EX,
  };
}
