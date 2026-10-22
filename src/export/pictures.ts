import type * as vscode from 'vscode';
import { identifyPicture, type Picture } from '../core/graphics/pictures';
import type * as ExporterModule from './engine';
import { loadImageData } from './resources';

/** Loads and identifies every image of a document; unusable ones are left out. */
export async function loadPictures(
  document: vscode.Uri,
  sources: Iterable<string>,
  signal: AbortSignal,
  exporter: Pick<typeof ExporterModule, 'svgSize'>,
): Promise<Map<string, Picture>> {
  const pictures = new Map<string, Picture>();
  await Promise.all(
    [...sources].map(async (src) => {
      const data = await loadImageData(document, src, signal);
      const picture = data && identifyPicture(data, exporter.svgSize);
      if (picture) pictures.set(src, picture);
    }),
  );
  return pictures;
}
