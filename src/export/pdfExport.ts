import * as vscode from 'vscode';
import { getEngineOptions, getFontConfig, getPdfOptions } from '../config';
import { ABNT } from '../core/abnt/profile';
import { analyzeAbnt } from '../core/abnt/structure';
import { collectAssets, type ExportWarning } from '../core/exportAssets';
import {
  lengthToPoints,
  pageSizeTwips,
  parseDocumentMeta,
  resolvePdfOptions,
} from '../core/exportOptions';
import type { PdfImage } from '../core/pdf/PdfRenderer';
import { renderDiagrams } from './diagrams';
import {
  abntFonts,
  abntOptions,
  abntPage,
  documentTitle,
  type ExportContext,
} from './exportContext';
import { loadExporter } from './exporterModule';
import { loadPictures } from './pictures';

export async function exportPdf(context: ExportContext): Promise<ExportWarning[]> {
  const { document, engine, signal } = context;
  const exporter = await loadExporter();
  const parsed = engine.parse(document.getText());
  const meta = parseDocumentMeta(parsed.frontMatter);
  const abnt = abntOptions(document, meta);
  const defaults = getPdfOptions(document.uri);
  const options = resolvePdfOptions(abnt ? { ...defaults, ...abntPage() } : defaults, meta.pdf);
  const title = documentTitle(document, parsed.headings, meta.title);
  const plan = abnt && analyzeAbnt(parsed.tokens, abnt, meta);
  const assets = collectAssets(parsed.tokens, getEngineOptions(document.uri));

  const [pictures, diagrams] = await Promise.all([
    loadPictures(document.uri, assets.images, signal, exporter),
    renderDiagrams(
      context.extensionUri,
      assets.graphics.filter((g) => g.kind === 'mermaid').map((g) => g.source),
      signal,
    ),
  ]);
  signal.throwIfAborted();

  // Vectors where possible; other bitmaps (GIF, WebP) become PNG.
  const images = new Map<string, PdfImage>();
  for (const [src, picture] of pictures) {
    if (picture.kind === 'bitmap') {
      const svg = exporter.bitmapSvg(picture.mime, picture.data, picture.width, picture.height);
      const data = exporter.svgToPng(svg, { width: picture.width });
      images.set(src, { kind: 'png', data, width: picture.width, height: picture.height });
    } else {
      images.set(src, picture);
    }
  }

  const page = pageSizeTwips(options);
  const points = (length: string) => lengthToPoints(length) ?? 56.7;
  const fontConfig = abnt ? abntFonts(getFontConfig(document.uri)) : getFontConfig(document.uri);
  const result = await exporter.renderPdf(parsed.tokens, {
    title,
    lang: abnt ? ABNT.lang : vscode.env.language,
    page: {
      width: page.width / 20,
      height: page.height / 20,
      margin: {
        top: points(options.margin.top),
        right: points(options.margin.right),
        bottom: points(options.margin.bottom),
        left: points(options.margin.left),
      },
    },
    fontSize: fontConfig.fontSize,
    fonts: exporter.resolveFonts(exporter.systemFontIndex(), process.platform, fontConfig),
    header: options.header,
    footer: options.footer,
    date: new Date().toLocaleDateString(vscode.env.language),
    loadImage: (src) => images.get(src),
    loadDiagram: (source) => {
      const svg = diagrams.get(source);
      return svg ? { kind: 'svg', svg, ...exporter.svgSize(svg) } : undefined;
    },
    highlight: (code, lang) => engine.highlightTokens(code, lang),
    abnt: plan ? { plan, options: abnt } : undefined,
  });
  signal.throwIfAborted();
  await vscode.workspace.fs.writeFile(context.target, result.data);
  return [...result.warnings, ...(plan ? plan.warnings : [])];
}
