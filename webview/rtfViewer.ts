/// <reference lib="dom" />
// RTF viewer: shows the HTML the extension host made from the file on a page.
import type { RtfPage } from './messages';
import {
  pagesHost,
  post,
  restoreAnchor,
  scrollAnchor,
  scroller,
  showPages,
  startViewer,
} from './viewerShell';

const page = document.createElement('div');
page.className = 'page rtf';
let loaded: RtfPage | undefined;

const shell = startViewer({
  pageWidth: () => loaded?.page.width ?? 0,
  layout(scale) {
    page.style.zoom = String(scale);
  },
  receive(message) {
    if (message.type !== 'rtf') return;
    const anchor = loaded ? scrollAnchor() : { x: 0, y: 0 };
    loaded = message.document;
    const { width, height, margin } = loaded.page;
    page.style.width = `${width}px`;
    page.style.minHeight = `${height}px`;
    page.style.padding = `${margin.top}px ${margin.right}px ${margin.bottom}px ${margin.left}px`;
    // Built by the extension from the RTF: all text is escaped; the CSP blocks scripts anyway.
    page.innerHTML = loaded.html;
    pagesHost.replaceChildren(page);
    showPages('');
    shell.relayout();
    restoreAnchor(anchor);
    post({ type: 'rendered', pages: 1 });
  },
});

page.addEventListener('click', (event) => {
  const link = (event.target as Element).closest('a[href]');
  if (!link) return;
  event.preventDefault();
  const href = link.getAttribute('href')!;
  if (href.startsWith('#')) {
    const target = document.getElementById(href.slice(1));
    if (target) {
      scroller.scrollTop +=
        target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8;
    }
  } else {
    post({ type: 'openLink', href });
  }
});
