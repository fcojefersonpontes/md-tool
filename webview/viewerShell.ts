/// <reference lib="dom" />
// Toolbar, zoom and messaging shared by the PDF and RTF viewers.
import type { ViewerHostMessage, ViewerWebviewMessage } from './messages';

declare function acquireVsCodeApi(): { postMessage(message: ViewerWebviewMessage): void };

const STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

/** "auto": fit the page width, but never above 100%; "fit": always fit the width. */
export type ZoomMode = 'auto' | 'fit' | number;

export interface Viewer {
  /** Width of the widest page at 100%, in CSS pixels (0 while nothing is loaded). */
  pageWidth(): number;
  /** Lays the document out at `scale` (1 = 100%). */
  layout(scale: number): void;
  receive(message: ViewerHostMessage): void;
}

const vscode = acquireVsCodeApi();
export const scroller = document.getElementById('scroller')!;
export const pagesHost = document.getElementById('pages-host')!;
const zoomLabel = document.getElementById('zoom')!;
const pagesLabel = document.getElementById('pages')!;

export function post(message: ViewerWebviewMessage): void {
  vscode.postMessage(message);
}

export function showPages(text: string): void {
  pagesLabel.textContent = text;
}

/** Replaces the document with an error message. */
export function showError(message: string): void {
  pagesHost.replaceChildren();
  const element = document.createElement('div');
  element.className = 'message';
  element.textContent = message;
  pagesHost.append(element);
  showPages('');
  post({ type: 'failed', error: message });
}

/** Where the view is, as fractions of the content, to keep it across re-layouts. */
export function scrollAnchor(): { x: number; y: number } {
  return {
    x: scroller.scrollWidth
      ? (scroller.scrollLeft + scroller.clientWidth / 2) / scroller.scrollWidth
      : 0,
    y: scroller.scrollHeight ? scroller.scrollTop / scroller.scrollHeight : 0,
  };
}

export function restoreAnchor(anchor: { x: number; y: number }): void {
  scroller.scrollTop = anchor.y * scroller.scrollHeight;
  scroller.scrollLeft = anchor.x * scroller.scrollWidth - scroller.clientWidth / 2;
}

/** Wires the toolbar, Ctrl+wheel and resizing to `viewer`, and asks for the document. */
export function startViewer(viewer: Viewer): { relayout(): void } {
  let mode: ZoomMode = 'auto';
  let scale = 1;

  const effectiveScale = () => {
    if (typeof mode === 'number') return mode;
    const width = viewer.pageWidth();
    if (!width) return 1;
    const fit = Math.max(0.1, (scroller.clientWidth - 32) / width);
    return mode === 'auto' ? Math.min(1, fit) : fit;
  };

  const relayout = (keep = scrollAnchor()) => {
    scale = effectiveScale();
    zoomLabel.textContent = `${Math.round(scale * 100)}%`;
    viewer.layout(scale);
    restoreAnchor(keep);
  };

  const zoom = (direction: 1 | -1) => {
    const next =
      direction > 0
        ? (STEPS.find((step) => step > scale + 0.001) ?? STEPS[STEPS.length - 1])
        : ([...STEPS].reverse().find((step) => step < scale - 0.001) ?? STEPS[0]);
    mode = next;
    relayout();
  };

  document.getElementById('zoom-in')!.addEventListener('click', () => zoom(1));
  document.getElementById('zoom-out')!.addEventListener('click', () => zoom(-1));
  document.getElementById('fit')!.addEventListener('click', () => {
    mode = 'fit';
    relayout();
  });
  scroller.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      zoom(event.deltaY < 0 ? 1 : -1);
    },
    { passive: false },
  );
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  new ResizeObserver(() => {
    if (typeof mode === 'number') return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => relayout(), 100);
  }).observe(scroller);

  window.addEventListener('message', (event: MessageEvent<ViewerHostMessage>) => {
    if (event.data.type === 'error') showError(event.data.message);
    else viewer.receive(event.data);
  });
  post({ type: 'ready' });
  return { relayout: () => relayout() };
}
