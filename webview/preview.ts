import DOMPurify from 'dompurify';
import type { HostMessage, PreviewState, WebviewMessage } from './messages';
import { type LineAnchor, lineForOffset, normalizeAnchors, offsetForLine } from './scrollSync';

interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
  getState(): PreviewState | undefined;
  setState(state: PreviewState): void;
}

interface Mermaid {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string }>;
}

declare function acquireVsCodeApi(): VsCodeApi;
declare global {
  interface Window {
    mermaid?: Mermaid;
  }
}

/** Ignore scroll events this long after a programmatic scroll, to avoid sync loops. */
const SCROLL_ECHO_MS = 150;

const vscode = acquireVsCodeApi();
const content = document.getElementById('md-tool-content')!;
const settings = document.getElementById('md-tool-settings')!.dataset;
const scriptNonce = document.currentScript?.nonce ?? '';

let state: PreviewState = { ...vscode.getState(), uri: settings.uri ?? '' };
let lastHtml = '';
let firstRender = true;
let ignoreScrollUntil = 0;
let renderGeneration = 0;

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  switch (message.type) {
    case 'update':
      render(message.html);
      break;
    case 'scrollTo':
      scrollToLine(message.line);
      break;
  }
});

// ---------------------------------------------------------------- rendering

function render(html: string): void {
  lastHtml = html;
  const generation = ++renderGeneration;
  content.innerHTML = DOMPurify.sanitize(html);
  if (content.querySelector('pre.mermaid')) void renderMermaid(generation);
  if (firstRender) {
    firstRender = false;
    if (state.line !== undefined) scrollToLine(state.line);
  }
}

function isDark(): boolean {
  const theme = document.documentElement.dataset.theme;
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  const body = document.body.classList;
  return (
    body.contains('vscode-dark') ||
    (body.contains('vscode-high-contrast') && !body.contains('vscode-high-contrast-light'))
  );
}

// Re-render (mermaid colors) when VS Code switches between light and dark themes.
let wasDark = isDark();
new MutationObserver(() => {
  const dark = isDark();
  if (dark !== wasDark) {
    wasDark = dark;
    if (lastHtml) render(lastHtml);
  }
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });

// ------------------------------------------------------------------ mermaid

let mermaidLoader: Promise<Mermaid> | undefined;
const mermaidCache = new Map<string, string>();
let mermaidId = 0;

function loadMermaid(): Promise<Mermaid> {
  mermaidLoader ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = settings.mermaidSrc ?? '';
    script.nonce = scriptNonce;
    script.onload = () => (window.mermaid ? resolve(window.mermaid) : reject(new Error('mermaid')));
    script.onerror = () => reject(new Error('Failed to load mermaid'));
    document.head.appendChild(script);
  });
  return mermaidLoader;
}

async function renderMermaid(generation: number): Promise<void> {
  const mermaid = await loadMermaid();
  const theme = isDark() ? 'dark' : 'default';
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme });

  for (const block of content.querySelectorAll<HTMLElement>('pre.mermaid')) {
    const source = block.textContent ?? '';
    const key = `${theme}\n${source}`;
    let svg = mermaidCache.get(key);
    if (svg === undefined) {
      const id = `md-tool-mermaid-${mermaidId++}`;
      try {
        svg = (await mermaid.render(id, source)).svg;
        mermaidCache.set(key, svg);
      } catch (error) {
        document.getElementById(`d${id}`)?.remove();
        if (generation !== renderGeneration) return;
        block.classList.add('mermaid-error');
        block.title = error instanceof Error ? error.message : String(error);
        continue;
      }
    }
    if (generation !== renderGeneration) return;
    const figure = document.createElement('div');
    figure.className = 'mermaid';
    if (block.dataset.line) figure.dataset.line = block.dataset.line;
    figure.innerHTML = svg;
    block.replaceWith(figure);
  }
}

// -------------------------------------------------------------- scroll sync

function anchors(): LineAnchor[] {
  const scrollY = window.scrollY;
  const result: LineAnchor[] = [];
  for (const el of content.querySelectorAll<HTMLElement>('[data-line]')) {
    if (el.offsetParent === null) continue;
    result.push({ line: Number(el.dataset.line), top: el.getBoundingClientRect().top + scrollY });
  }
  return normalizeAnchors(result);
}

function scrollToLine(line: number): void {
  ignoreScrollUntil = Date.now() + SCROLL_ECHO_MS;
  window.scrollTo({ top: offsetForLine(anchors(), line) });
  saveLine(line);
}

function saveLine(line: number): void {
  state = { ...state, line };
  vscode.setState(state);
}

let scrollFrame = 0;
window.addEventListener('scroll', () => {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    if (Date.now() < ignoreScrollUntil) return;
    const line = lineForOffset(anchors(), window.scrollY);
    saveLine(line);
    if (settings.scrollSync === 'true') {
      vscode.postMessage({ type: 'revealLine', line: Math.floor(line) });
    }
  });
});

// ------------------------------------------------------ links & task lists

document.addEventListener('click', (event) => {
  const target = event.target as Element;

  if (target instanceof HTMLInputElement && target.classList.contains('task-list-item-checkbox')) {
    // The host edits the source; the re-render then shows the new state.
    event.preventDefault();
    vscode.postMessage({ type: 'toggleTask', line: Number(target.dataset.line) });
    return;
  }

  const link = target.closest('a');
  const href = link?.getAttribute('href');
  if (!href) return;
  event.preventDefault();
  if (href.startsWith('#')) {
    document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView();
  } else {
    vscode.postMessage({ type: 'openLink', href });
  }
});

vscode.setState(state);
vscode.postMessage({ type: 'ready' });
