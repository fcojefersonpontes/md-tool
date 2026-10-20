import * as vscode from 'vscode';
import { getEngineOptions, getExportConfig, getRtfConfig } from '../config';
import { lengthToTwips, pageSizeTwips, parseDocumentMeta } from '../core/exportOptions';
import { collectRtfAssets, graphicKey, type GraphicKind } from '../core/rtf/assets';
import { readImage, type RtfImage } from '../core/rtf/images';
import { renderRtf, type RtfWarning } from '../core/rtf/RtfRenderer';
import type { RasterImage, RasterJob } from './browser';
import { findBrowser, loadBrowserModule } from './browserModule';
import {
  documentTitle,
  type ExportContext,
  resolveLocalResource,
  toFileUrl,
} from './exportContext';

/** Remote images larger than this are not embedded. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const REMOTE_IMAGE_TIMEOUT_MS = 10_000;

export async function exportRtf(context: ExportContext): Promise<RtfWarning[]> {
  const { document, engine, signal } = context;
  const parsed = engine.parse(document.getText());
  const meta = parseDocumentMeta(parsed.frontMatter);
  const assets = collectRtfAssets(parsed.tokens, getEngineOptions(document.uri));
  const rtf = getRtfConfig(document.uri);

  // PNG / JPEG embed directly; everything else is drawn by the browser, if there is one.
  const images = new Map<string, RtfImage>();
  const jobs: RasterJob[] = [];
  await Promise.all(
    [...assets.images].map(async (src) => {
      const loaded = await loadImage(document.uri, src, signal);
      if (loaded.image) images.set(src, loaded.image);
      else if (loaded.url) jobs.push({ key: imageKey(src), kind: 'image', url: loaded.url });
    }),
  );
  for (const graphic of assets.graphics) {
    jobs.push({ key: graphicKey(graphic.kind, graphic.source), ...graphic });
  }
  const rasters = await rasterizeJobs(context, jobs, rtf.fontSize);

  const { page } = getExportConfig(document.uri);
  const twips = (length: string) => lengthToTwips(length) ?? 1134;
  const result = renderRtf(parsed.tokens, {
    title: documentTitle(document, parsed.headings, meta.title),
    ...rtf,
    page: {
      ...pageSizeTwips(page),
      margin: {
        top: twips(page.margin.top),
        right: twips(page.margin.right),
        bottom: twips(page.margin.bottom),
        left: twips(page.margin.left),
      },
    },
    loadImage: (src) => images.get(src) ?? rasters.get(imageKey(src)),
    loadGraphic: (kind: GraphicKind, source: string) => rasters.get(graphicKey(kind, source)),
  });

  // The renderer escapes everything outside ASCII, so the output is plain ASCII.
  await vscode.workspace.fs.writeFile(context.target, Buffer.from(result.rtf, 'ascii'));
  return result.warnings;
}

function imageKey(src: string): string {
  return `image\n${src}`;
}

/** Renders formulas, diagrams and non-bitmap images; empty when no browser is installed. */
async function rasterizeJobs(
  context: ExportContext,
  jobs: RasterJob[],
  fontSizePt: number,
): Promise<Map<string, RtfImage>> {
  const images = new Map<string, RtfImage>();
  const executablePath = jobs.length ? findBrowser(context.document.uri) : undefined;
  if (!executablePath) return images;

  const asset = (...segments: string[]) =>
    toFileUrl(vscode.Uri.joinPath(context.extensionUri, ...segments));
  let rasters: Map<string, RasterImage>;
  try {
    rasters = await loadBrowserModule().rasterize({
      executablePath,
      jobs,
      katexCssUrl: asset('dist', 'webview', 'katex', 'katex.min.css'),
      mermaidScriptUrl: asset('dist', 'webview', 'mermaid.min.js'),
      fontSizePx: (fontSizePt * 96) / 72,
      signal: context.signal,
    });
  } catch (error) {
    if (context.signal.aborted) throw error;
    return images; // the browser failed to start: keep the text fallbacks
  }

  for (const [key, raster] of rasters) {
    const image = readImage(raster.png);
    if (!image) continue;
    images.set(key, {
      ...image,
      display: { width: raster.width, height: raster.height },
      depth: raster.depth,
    });
  }
  return images;
}

interface LoadedImage {
  /** Directly embeddable bitmap. */
  image?: RtfImage;
  /** URL the browser can load to rasterize other formats. */
  url?: string;
}

async function loadImage(
  document: vscode.Uri,
  src: string,
  signal: AbortSignal,
): Promise<LoadedImage> {
  try {
    const dataUri = /^data:image\/[\w+.-]+;base64,(.*)$/i.exec(src);
    if (dataUri) {
      return { image: readImage(Buffer.from(dataUri[1], 'base64')), url: src };
    }

    if (/^https?:\/\//i.test(src)) {
      const response = await fetch(src, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(REMOTE_IMAGE_TIMEOUT_MS)]),
      });
      const length = Number(response.headers.get('content-length') ?? 0);
      if (!response.ok || length > MAX_IMAGE_BYTES) return {};
      const data = new Uint8Array(await response.arrayBuffer());
      if (data.length > MAX_IMAGE_BYTES) return {};
      return { image: readImage(data), url: src };
    }

    const local = resolveLocalResource(document, src);
    if (!local) return {};
    const data = await vscode.workspace.fs.readFile(local.uri);
    return { image: readImage(data), url: toFileUrl(local.uri) };
  } catch {
    return {}; // missing or unreadable: the alt text is used instead
  }
}
