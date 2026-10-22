import { initWasm, Resvg } from '@resvg/resvg-wasm';

let ready: Promise<void> | undefined;

/** Loads the resvg WebAssembly module once; `load` supplies its bytes. */
export function initRaster(load: () => Promise<Uint8Array>): Promise<void> {
  ready ??= load().then((bytes) => initWasm(bytes));
  return ready;
}

export interface RasterOptions {
  /** Output width in pixels; the height follows the SVG's aspect ratio. */
  width: number;
  /** Font files for `<text>` (diagram labels); none are loaded from the system. */
  fonts?: Uint8Array[];
  defaultFontFamily?: string;
}

/** Draws an SVG into a PNG. `initRaster` must have completed. */
export function svgToPng(svg: string, options: RasterOptions): Uint8Array {
  // Pixel size plus a viewBox, so units like ex or % cannot confuse the scaling.
  const natural = svgSize(svg);
  let normalized = svg;
  if (!/<svg\b[^>]*\sviewBox=/i.test(svg)) {
    normalized = svg.replace(/<svg\b/i, `<svg viewBox="0 0 ${natural.width} ${natural.height}"`);
  }
  const resvg = new Resvg(sized(normalized, natural.width, natural.height), {
    fitTo: { mode: 'width', value: Math.max(1, Math.round(options.width)) },
    font: {
      fontBuffers: options.fonts ?? [],
      defaultFontFamily: options.defaultFontFamily ?? '',
      loadSystemFonts: false,
    },
  });
  try {
    const image = resvg.render();
    try {
      return image.asPng();
    } finally {
      image.free();
    }
  } finally {
    resvg.free();
  }
}

/** An SVG that shows a bitmap (GIF, WebP, ...), so it can be redrawn as PNG. */
export function bitmapSvg(mime: string, data: Uint8Array, width: number, height: number): string {
  const href = `data:${mime};base64,${Buffer.from(data).toString('base64')}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<image width="${width}" height="${height}" xlink:href="${href}"/></svg>`
  );
}

/** Replaces the root `width`/`height` (which may be in ex, %, ...) with pixels. */
export function sized(svg: string, width: number, height: number): string {
  return svg.replace(/<svg\b[^>]*>/, (tag) => {
    const cleaned = tag.replace(/\s(width|height)="[^"]*"/g, '').replace(/\sstyle="[^"]*"/, '');
    return cleaned.replace(/^<svg/, `<svg width="${width}" height="${height}"`);
  });
}

const UNIT_PX: Record<string, number> = {
  '': 1,
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  em: 16,
  ex: 8,
};

/** Intrinsic size of an SVG in CSS pixels (attributes, else viewBox, else 300×150). */
export function svgSize(svg: string): { width: number; height: number } {
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? '';
  const length = (name: string) => {
    const match = new RegExp(`\\s${name}="\\s*([\\d.]+)\\s*([a-z]*)\\s*"`, 'i').exec(tag);
    const unit = match?.[2].toLowerCase() ?? '';
    return match && unit in UNIT_PX ? Number(match[1]) * UNIT_PX[unit] : undefined;
  };
  const viewBox = /\sviewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/i.exec(tag);
  const boxWidth = viewBox ? Number(viewBox[1]) : undefined;
  const boxHeight = viewBox ? Number(viewBox[2]) : undefined;
  let width = length('width');
  let height = length('height');
  if (width === undefined && height === undefined) {
    width = boxWidth ?? 300;
    height = boxHeight ?? 150;
  } else if (width === undefined) {
    width = boxWidth && boxHeight ? (height! * boxWidth) / boxHeight : 300;
  } else if (height === undefined) {
    height = boxWidth && boxHeight ? (width * boxHeight) / boxWidth : 150;
  }
  return { width: Math.max(1, width), height: Math.max(1, height!) };
}
