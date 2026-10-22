import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type * as ExporterModule from './engine';

let exporter: typeof ExporterModule | undefined;

/** Loads dist/exporter.js (pdfkit, MathJax, resvg) on first use, with resvg initialized. */
export async function loadExporter(): Promise<typeof ExporterModule> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  exporter ??= require(path.join(__dirname, 'exporter.js')) as typeof ExporterModule;
  await exporter.initRaster(() => fs.readFile(path.join(__dirname, 'resvg.wasm')));
  return exporter;
}
