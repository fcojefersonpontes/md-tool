import { readImage } from '../rtf/images';

/**
 * An image from a document, identified by its content. Sizes are in pixels.
 * - `png` / `jpeg`: embedded as is by both exporters;
 * - `svg`: drawn as vectors in PDF, rasterized for RTF;
 * - `bitmap`: other formats (GIF, WebP, BMP), converted to PNG first.
 */
export type Picture =
  | { kind: 'png' | 'jpeg'; data: Uint8Array; width: number; height: number }
  | { kind: 'svg'; svg: string; width: number; height: number }
  | { kind: 'bitmap'; mime: string; data: Uint8Array; width: number; height: number };

/** Recognizes PNG, JPEG, GIF, WebP, BMP and SVG; `undefined` for anything else. */
export function identifyPicture(
  data: Uint8Array,
  svgSize: (svg: string) => { width: number; height: number },
): Picture | undefined {
  const bitmap = readImage(data);
  if (bitmap) return { kind: bitmap.kind, data, width: bitmap.width, height: bitmap.height };

  const ascii = (start: number, end: number) => String.fromCharCode(...data.subarray(start, end));
  const u16 = (offset: number) => data[offset] | (data[offset + 1] << 8);
  const u24 = (offset: number) => u16(offset) | (data[offset + 2] << 16);
  const i32 = (offset: number) =>
    data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24);
  const other = (mime: string, width: number, height: number): Picture | undefined =>
    width > 0 && height > 0 ? { kind: 'bitmap', mime, data, width, height } : undefined;

  if (data.length > 10 && ascii(0, 4) === 'GIF8') return other('image/gif', u16(6), u16(8));

  if (data.length > 30 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    const chunk = ascii(12, 16);
    if (chunk === 'VP8 ') return other('image/webp', u16(26) & 0x3fff, u16(28) & 0x3fff);
    if (chunk === 'VP8L') {
      const bits = data[21] | (data[22] << 8) | (data[23] << 16) | (data[24] << 24);
      return other('image/webp', (bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
    }
    if (chunk === 'VP8X') return other('image/webp', u24(24) + 1, u24(27) + 1);
    return undefined;
  }

  if (data.length > 26 && ascii(0, 2) === 'BM') {
    return other('image/bmp', i32(18), Math.abs(i32(22)));
  }

  const head = new TextDecoder().decode(data.subarray(0, 2048));
  if (/<svg[\s>]/i.test(head)) {
    const svg = new TextDecoder().decode(data);
    return { kind: 'svg', svg, ...svgSize(svg) };
  }
  return undefined;
}
