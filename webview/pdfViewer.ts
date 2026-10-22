/// <reference lib="dom" />
// PDF viewer: pdf.js draws each page on a canvas when it scrolls into view,
// with a text layer for selection and clickable links.
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
  TextLayer,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  pagesHost,
  post,
  restoreAnchor,
  scrollAnchor,
  scroller,
  showError,
  showPages,
  startViewer,
} from './viewerShell';

/** pdf.js works in PDF points; 100% zoom shows them at their real size in CSS pixels. */
const CSS_UNITS = 96 / 72;

interface PageView {
  page: PDFPageProxy;
  /** Size at 100%, in CSS pixels. */
  width: number;
  height: number;
  element: HTMLDivElement;
  /** Scale the page is drawn at; 0 when it needs drawing. */
  drawn: number;
  task?: RenderTask;
  text?: TextLayer;
}

let pdf: PDFDocumentProxy | undefined;
let pdfTask: PDFDocumentLoadingTask | undefined;
let views: PageView[] = [];
let scale = 1;
let loading = 0;

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      const view = views.find((candidate) => candidate.element === entry.target);
      if (entry.isIntersecting && view && view.drawn !== scale) void draw(view);
    }
  },
  { root: scroller, rootMargin: '100% 0px' },
);

const shell = startViewer({
  pageWidth: () => Math.max(0, ...views.map((view) => view.width)),
  layout(next) {
    scale = next;
    for (const view of views) {
      view.element.style.width = `${Math.floor(view.width * scale)}px`;
      view.element.style.height = `${Math.floor(view.height * scale)}px`;
      clear(view);
      // Re-observing makes the observer report the pages now in view.
      observer.unobserve(view.element);
      observer.observe(view.element);
    }
  },
  receive(message) {
    if (message.type === 'pdf') void load(toBytes(message.data));
  },
});

/** Older VS Code versions deliver typed arrays as plain objects of indexes. */
function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  const values = data as { data?: number[] } & Record<string, number>;
  return Uint8Array.from(Array.isArray(values.data) ? values.data : Object.values(values));
}

/** pdf.js parses in a worker; webviews only allow workers from blob: URLs. */
let workerReady: Promise<void> | undefined;
function startWorker(): Promise<void> {
  workerReady ??= (async () => {
    const response = await fetch(document.body.dataset.worker!);
    const url = URL.createObjectURL(new Blob([await response.text()], { type: 'text/javascript' }));
    GlobalWorkerOptions.workerPort = new Worker(url, { type: 'module' });
  })();
  return workerReady;
}

async function load(data: Uint8Array): Promise<void> {
  const generation = ++loading;
  const anchor = views.length ? scrollAnchor() : { x: 0, y: 0 };
  try {
    await startWorker();
    const task = getDocument({ data });
    const next = await task.promise;
    const pages = await Promise.all(
      Array.from({ length: next.numPages }, (_, i) => next.getPage(i + 1)),
    );
    if (generation !== loading) {
      void task.destroy();
      return;
    }
    const previous = pdfTask;
    for (const view of views) clear(view);
    observer.disconnect();

    pdf = next;
    pdfTask = task;
    views = pages.map((page) => {
      const viewport = page.getViewport({ scale: CSS_UNITS });
      const element = document.createElement('div');
      element.className = 'page';
      element.dataset.page = String(page.pageNumber);
      return { page, width: viewport.width, height: viewport.height, element, drawn: 0 };
    });
    pagesHost.replaceChildren(...views.map((view) => view.element));
    shell.relayout();
    restoreAnchor(anchor);
    updatePageLabel();
    void previous?.destroy();
    post({ type: 'rendered', pages: views.length });
  } catch (error) {
    if (generation === loading) showError(error instanceof Error ? error.message : String(error));
  }
}

function clear(view: PageView): void {
  view.task?.cancel();
  view.text?.cancel();
  view.task = undefined;
  view.text = undefined;
  view.drawn = 0;
  view.element.replaceChildren();
}

async function draw(view: PageView): Promise<void> {
  clear(view);
  const drawnAt = scale;
  view.drawn = drawnAt;
  const viewport = view.page.getViewport({ scale: scale * CSS_UNITS });
  const ratio = window.devicePixelRatio || 1;

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  const textLayer = document.createElement('div');
  textLayer.className = 'textLayer';
  view.element.style.setProperty('--scale-factor', String(viewport.scale));
  view.element.style.setProperty('--total-scale-factor', String(viewport.scale));
  view.element.style.setProperty('--user-unit', '1');
  view.element.replaceChildren(canvas, textLayer);

  view.task = view.page.render({
    canvas,
    canvasContext: canvas.getContext('2d')!,
    viewport,
    transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
  });
  view.text = new TextLayer({
    textContentSource: view.page.streamTextContent(),
    container: textLayer,
    viewport,
  });
  try {
    await Promise.all([view.task.promise, view.text.render(), addLinks(view, viewport)]);
  } catch (error) {
    // Cancelled because the page was zoomed or the document reloaded.
    if (
      view.drawn === drawnAt &&
      !(error instanceof Error && error.name === 'RenderingCancelledException')
    ) {
      console.error(error);
    }
  }
}

type Viewport = ReturnType<PDFPageProxy['getViewport']>;

interface LinkAnnotation {
  subtype: string;
  rect: number[];
  url?: string;
  dest?: string | unknown[];
}

async function addLinks(view: PageView, viewport: Viewport): Promise<void> {
  const annotations = (await view.page.getAnnotations({ intent: 'display' })) as LinkAnnotation[];
  for (const annotation of annotations) {
    if (annotation.subtype !== 'Link' || (!annotation.url && !annotation.dest)) continue;
    const [x1, y1] = viewport.convertToViewportPoint(annotation.rect[0], annotation.rect[1]);
    const [x2, y2] = viewport.convertToViewportPoint(annotation.rect[2], annotation.rect[3]);
    const link = document.createElement('a');
    link.className = 'link';
    link.style.left = `${Math.min(x1, x2)}px`;
    link.style.top = `${Math.min(y1, y2)}px`;
    link.style.width = `${Math.abs(x2 - x1)}px`;
    link.style.height = `${Math.abs(y2 - y1)}px`;
    if (annotation.url) link.title = annotation.url;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      if (annotation.url) post({ type: 'openLink', href: annotation.url });
      else if (annotation.dest) void goTo(annotation.dest);
    });
    view.element.append(link);
  }
}

/** Scrolls to a named or explicit destination inside the document. */
async function goTo(dest: string | unknown[]): Promise<void> {
  if (!pdf) return;
  const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
  if (!explicit) return;
  const [ref, kind, left, top] = explicit as [unknown, { name?: string }, number?, number?];
  const index =
    typeof ref === 'number'
      ? ref
      : await pdf.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0]);
  const view = views[index];
  if (!view) return;
  let offset = 0;
  if (kind?.name === 'XYZ' && typeof top === 'number') {
    const viewport = view.page.getViewport({ scale: scale * CSS_UNITS });
    offset = viewport.convertToViewportPoint(left ?? 0, top)[1];
  }
  scroller.scrollTop = view.element.offsetTop + offset - 8;
}

function updatePageLabel(): void {
  if (!views.length) return showPages('');
  const middle = scroller.scrollTop + scroller.clientHeight / 3;
  const current = views.findIndex(
    (view) => view.element.offsetTop + view.element.offsetHeight > middle,
  );
  showPages(`${(current < 0 ? views.length - 1 : current) + 1} / ${views.length}`);
}

scroller.addEventListener('scroll', updatePageLabel, { passive: true });
