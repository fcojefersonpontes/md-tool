/// <reference lib="dom" />

/** The part of the Mermaid API the exporter uses. */
export interface MermaidApi {
  initialize(config: object): void;
  render(id: string, text: string): Promise<{ svg: string }>;
}

/** Presentation properties copied from the computed style onto each element. */
const PROPERTIES = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
] as const;

export const EXPORT_MERMAID_CONFIG = {
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'default',
  // Plain SVG text instead of <foreignObject> HTML, which PDF and PNG converters cannot draw.
  htmlLabels: false,
  flowchart: { htmlLabels: false },
};

/**
 * Renders a Mermaid diagram to a self-contained SVG for export: CSS rules are
 * resolved into attributes (SVG-to-PDF converters ignore <style>), and the size
 * is the diagram's natural size.
 */
export async function renderExportDiagram(
  mermaid: MermaidApi,
  id: string,
  source: string,
  host: HTMLElement,
): Promise<string> {
  const { svg } = await mermaid.render(id, source);
  host.innerHTML = svg;
  const root = host.querySelector('svg');
  if (!root) throw new Error('Mermaid produced no SVG');
  try {
    inlineStyles(root);
    root.querySelectorAll('style').forEach((style) => style.remove());
    const box = root.viewBox.baseVal;
    if (box && box.width > 0) {
      root.removeAttribute('style');
      root.setAttribute('width', String(box.width));
      root.setAttribute('height', String(box.height));
    }
    return new XMLSerializer().serializeToString(root);
  } finally {
    host.innerHTML = '';
  }
}

function inlineStyles(root: SVGSVGElement): void {
  // Read everything first: selectors such as `.node rect` stop matching once classes go.
  const elements = Array.from(root.querySelectorAll<SVGElement>('*'));
  const values = elements.map((element) => {
    const computed = getComputedStyle(element);
    return PROPERTIES.map((property) => [property, computed.getPropertyValue(property)] as const);
  });
  elements.forEach((element, i) => {
    for (const [property, value] of values[i]) {
      if (value) element.setAttribute(property, value);
    }
    element.removeAttribute('class');
    element.removeAttribute('style');
  });
}
