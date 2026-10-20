import { escapeHtml } from './html';

export interface ExportHtmlOptions {
  title: string;
  lang: string;
  /** Rendered Markdown (from `MarkdownEngine.render`). */
  bodyHtml: string;
  /** Stylesheet URLs, in cascade order. */
  stylesheets: string[];
  /** URL of `mermaid.min.js`; only loaded when the body contains diagrams. */
  mermaidScript?: string;
  nonce: string;
}

/**
 * Runs in the export page: renders Mermaid diagrams, waits for fonts and images,
 * then raises `window.__mdToolReady` so the PDF can be printed.
 */
const READY_SCRIPT = `
(async () => {
  try {
    const blocks = document.querySelectorAll('pre.mermaid');
    if (blocks.length && window.mermaid) {
      window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
      let id = 0;
      for (const block of blocks) {
        try {
          const { svg } = await window.mermaid.render('md-tool-mermaid-' + id++, block.textContent);
          const figure = document.createElement('div');
          figure.className = 'mermaid';
          figure.innerHTML = svg;
          block.replaceWith(figure);
        } catch {
          block.classList.add('mermaid-error');
        }
      }
    }
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images, (img) =>
        img.complete ? null : new Promise((resolve) => { img.onload = img.onerror = resolve; }),
      ),
    );
  } finally {
    window.__mdToolReady = true;
  }
})();
`;

/**
 * Standalone HTML document used to print the PDF. Scripts are restricted to the
 * nonce, so raw HTML in the Markdown (when allowed) cannot execute.
 */
export function buildExportHtml(options: ExportHtmlOptions): string {
  const { nonce } = options;
  const csp = [
    "default-src 'none'",
    'img-src file: https: data:',
    "style-src file: 'unsafe-inline'",
    'font-src file: data:',
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  const styles = options.stylesheets
    .map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`)
    .join('\n    ');
  const needsMermaid = options.mermaidScript && options.bodyHtml.includes('class="mermaid"');
  const mermaid = needsMermaid
    ? `<script nonce="${nonce}" src="${escapeHtml(options.mermaidScript!)}"></script>\n    `
    : '';

  return `<!DOCTYPE html>
<html lang="${escapeHtml(options.lang)}" data-theme="light">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <title>${escapeHtml(options.title)}</title>
    ${styles}
  </head>
  <body class="md-tool-export">
    <main class="markdown-body">
${options.bodyHtml}
    </main>
    ${mermaid}<script nonce="${nonce}">${READY_SCRIPT}</script>
  </body>
</html>
`;
}
