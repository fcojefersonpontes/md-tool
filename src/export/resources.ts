import * as vscode from 'vscode';
import { resolveLocalResource } from './exportContext';

/** Remote images larger than this are not embedded. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const REMOTE_IMAGE_TIMEOUT_MS = 10_000;

/**
 * Reads the bytes of an image `src` as written in a document: a path relative to
 * it, an http(s) URL or a data URI. `undefined` when missing or unreadable.
 */
export async function loadImageData(
  document: vscode.Uri,
  src: string,
  signal: AbortSignal,
): Promise<Uint8Array | undefined> {
  try {
    const dataUri = /^data:[^,]*;base64,(.*)$/is.exec(src);
    if (dataUri) return Buffer.from(dataUri[1], 'base64');
    if (/^data:[^,]*,(.*)$/is.test(src)) {
      return Buffer.from(decodeURIComponent(src.slice(src.indexOf(',') + 1)), 'utf8');
    }

    if (/^https?:\/\//i.test(src)) {
      const response = await fetch(src, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(REMOTE_IMAGE_TIMEOUT_MS)]),
      });
      const length = Number(response.headers.get('content-length') ?? 0);
      if (!response.ok || length > MAX_IMAGE_BYTES) return undefined;
      const data = new Uint8Array(await response.arrayBuffer());
      return data.length > MAX_IMAGE_BYTES ? undefined : data;
    }

    const local = resolveLocalResource(document, src);
    return local ? await vscode.workspace.fs.readFile(local.uri) : undefined;
  } catch {
    if (signal.aborted) throw signal.reason;
    return undefined; // the alt text is used instead
  }
}
