import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { getEngineOptions, getExportConfig, getFontConfig } from '../config';
import {
  collectAssets,
  type ExportWarning,
  graphicKey,
  type GraphicKind,
} from '../core/exportAssets';
import { lengthToTwips, pageSizeTwips, parseDocumentMeta } from '../core/exportOptions';
import type { Picture } from '../core/graphics/pictures';
import { readImage, type RtfImage } from '../core/rtf/images';
import { renderRtf } from '../core/rtf/RtfRenderer';
import { renderDiagrams } from './diagrams';
import { documentTitle, type ExportContext } from './exportContext';
import { loadExporter } from './exporterModule';
import { loadPictures } from './pictures';

/** Pictures are drawn at twice their display size, so they stay sharp when printed. */
const SCALE = 2;
const PX_PER_PT = 96 / 72;

type Exporter = Awaited<ReturnType<typeof loadExporter>>;

export async function exportRtf(context: ExportContext): Promise<ExportWarning[]> {
  const { document, engine, signal } = context;
  const exporter = await loadExporter();
  const parsed = engine.parse(document.getText());
  const meta = parseDocumentMeta(parsed.frontMatter);
  const assets = collectAssets(parsed.tokens, getEngineOptions(document.uri));
  const fontConfig = getFontConfig(document.uri);
  const fonts = exporter.resolveFonts(exporter.systemFontIndex(), process.platform, fontConfig);

  const [pictures, diagrams] = await Promise.all([
    loadPictures(document.uri, assets.images, signal, exporter),
    renderDiagrams(
      context.extensionUri,
      assets.graphics.filter((g) => g.kind === 'mermaid').map((g) => g.source),
      signal,
    ),
  ]);
  signal.throwIfAborted();

  // SVG text (diagram labels, text in images) is drawn with the body font.
  const svgFonts = await readFonts([fonts.body?.regular.file, fonts.body?.bold.file]);
  const images = new Map<string, RtfImage>();
  for (const [src, picture] of pictures) {
    const image = toRtfImage(picture, exporter, svgFonts, fonts.body?.name);
    if (image) images.set(src, image);
  }

  // Formulas and diagrams become PNG pictures.
  const fontPx = fontConfig.fontSize * PX_PER_PT;
  const graphics = new Map<string, RtfImage>();
  for (const { kind, source } of assets.graphics) {
    const image =
      kind === 'mermaid'
        ? diagramImage(diagrams.get(source), exporter, svgFonts, fonts.body?.name)
        : mathImage(source, kind === 'math-block', fontPx * 1.1, exporter);
    if (image) graphics.set(graphicKey(kind, source), image);
  }

  const { page } = getExportConfig(document.uri);
  const twips = (length: string) => lengthToTwips(length) ?? 1134;
  const result = renderRtf(parsed.tokens, {
    title: documentTitle(document, parsed.headings, meta.title),
    fontFamily: fontConfig.fontFamily || fonts.body?.name || 'Calibri',
    codeFontFamily: fontConfig.codeFontFamily || fonts.mono?.name || 'Consolas',
    fontSize: fontConfig.fontSize,
    page: {
      ...pageSizeTwips(page),
      margin: {
        top: twips(page.margin.top),
        right: twips(page.margin.right),
        bottom: twips(page.margin.bottom),
        left: twips(page.margin.left),
      },
    },
    loadImage: (src) => images.get(src),
    loadGraphic: (kind: GraphicKind, source: string) => graphics.get(graphicKey(kind, source)),
  });

  // The renderer escapes everything outside ASCII, so the output is plain ASCII.
  await vscode.workspace.fs.writeFile(context.target, Buffer.from(result.rtf, 'ascii'));
  return result.warnings;
}

function toRtfImage(
  picture: Picture,
  exporter: Exporter,
  fonts: Uint8Array[],
  fontFamily: string | undefined,
): RtfImage | undefined {
  switch (picture.kind) {
    case 'png':
    case 'jpeg':
      return picture;
    case 'svg':
      return rasterize(
        picture.svg,
        picture.width,
        picture.height,
        SCALE,
        exporter,
        fonts,
        fontFamily,
      );
    case 'bitmap': {
      // Bitmaps keep their pixel size.
      const svg = exporter.bitmapSvg(picture.mime, picture.data, picture.width, picture.height);
      return rasterize(svg, picture.width, picture.height, 1, exporter);
    }
  }
}

function mathImage(
  tex: string,
  display: boolean,
  emPx: number,
  exporter: Exporter,
): RtfImage | undefined {
  const math = exporter.renderMath(tex, display);
  if (!math) return undefined;
  const width = math.width * emPx;
  const height = (math.height + math.depth) * emPx;
  const image = rasterize(math.svg, width, height, SCALE, exporter);
  return image && { ...image, depth: math.depth * emPx };
}

function diagramImage(
  svg: string | undefined,
  exporter: Exporter,
  fonts: Uint8Array[],
  fontFamily: string | undefined,
): RtfImage | undefined {
  if (!svg) return undefined;
  const { width, height } = exporter.svgSize(svg);
  return rasterize(svg, width, height, SCALE, exporter, fonts, fontFamily);
}

/** PNG of an SVG at `scale` times its display size (`width` × `height` CSS px). */
function rasterize(
  svg: string,
  width: number,
  height: number,
  scale: number,
  exporter: Exporter,
  fonts?: Uint8Array[],
  defaultFontFamily?: string,
): RtfImage | undefined {
  try {
    const png = exporter.svgToPng(svg, {
      width: width * scale,
      fonts,
      defaultFontFamily,
    });
    const image = readImage(png);
    return image && { ...image, display: { width, height } };
  } catch {
    return undefined;
  }
}

async function readFonts(files: (string | undefined)[]): Promise<Uint8Array[]> {
  const fonts: (Uint8Array | undefined)[] = await Promise.all(
    [...new Set(files)].map((file) =>
      file ? fs.readFile(file).catch(() => undefined) : undefined,
    ),
  );
  return fonts.filter((font): font is Uint8Array => font !== undefined);
}
