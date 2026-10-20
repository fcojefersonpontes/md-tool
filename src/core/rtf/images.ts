/** A bitmap that can be embedded in RTF. */
export interface RtfImage {
  kind: 'png' | 'jpeg';
  data: Uint8Array;
  /** Pixel dimensions. */
  width: number;
  height: number;
  /**
   * Size to display, in CSS pixels, when it differs from the pixel size
   * (e.g. a rasterized formula captured at 2x for sharpness).
   */
  display?: { width: number; height: number };
  /** CSS pixels below the text baseline (inline formulas). */
  depth?: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readUint16(data: Uint8Array, offset: number): number {
  return (data[offset] << 8) | data[offset + 1];
}

function readUint32(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] << 24) |
      (data[offset + 1] << 16) |
      (data[offset + 2] << 8) |
      data[offset + 3]) >>>
    0
  );
}

/** Identifies PNG/JPEG data and reads its pixel size. Other formats return `undefined`. */
export function readImage(data: Uint8Array): RtfImage | undefined {
  if (data.length > 24 && PNG_SIGNATURE.every((byte, i) => data[i] === byte)) {
    return { kind: 'png', data, width: readUint32(data, 16), height: readUint32(data, 20) };
  }

  if (data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) return undefined;
      const marker = data[offset + 1];
      if (marker === 0xff) {
        offset++; // fill byte
        continue;
      }
      const length = readUint16(data, offset + 2);
      // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC).
      const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isFrame) {
        return {
          kind: 'jpeg',
          data,
          height: readUint16(data, offset + 5),
          width: readUint16(data, offset + 7),
        };
      }
      offset += 2 + length;
    }
  }
  return undefined;
}

/** Pixels are assumed to be 1/96 inch: 15 twips each. */
const TWIPS_PER_PIXEL = 15;

/**
 * `{\pict ...}` group sized to the image's display (or natural) size, shrunk to
 * `maxWidth` twips. Images with a `depth` are lowered so their baseline lines up
 * with the surrounding text.
 */
export function imageToRtf(image: RtfImage, maxWidth: number): string {
  const display = image.display ?? { width: image.width, height: image.height };
  let width = Math.round(display.width * TWIPS_PER_PIXEL);
  let height = Math.round(display.height * TWIPS_PER_PIXEL);
  let scale = 1;
  if (width > maxWidth) {
    scale = maxWidth / width;
    height = Math.round(height * scale);
    width = maxWidth;
  }
  const blip = image.kind === 'png' ? '\\pngblip' : '\\jpegblip';
  const hex = Array.from(image.data, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const lines = hex.match(/.{1,128}/g) ?? [];
  const pict =
    `{\\pict${blip}\\picw${image.width}\\pich${image.height}` +
    `\\picwgoal${width}\\pichgoal${height}\n${lines.join('\n')}\n}`;
  // \dn is in half-points; a CSS pixel is 0.75pt.
  const lower = Math.round((image.depth ?? 0) * scale * 1.5);
  return lower > 0 ? `{\\dn${lower}${pict}}` : pict;
}
