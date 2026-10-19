import * as path from 'node:path';

export type ExportFormat = 'pdf' | 'rtf';

/**
 * Resolves the output file path for an exported Markdown document.
 * `outputDir` may contain `${fileDirname}`; relative directories are resolved
 * against the source file's directory.
 */
export function resolveExportPath(
  sourcePath: string,
  format: ExportFormat,
  outputDir = '${fileDirname}',
): string {
  const fileDirname = path.dirname(sourcePath);
  const baseName = path.basename(sourcePath, path.extname(sourcePath));
  const dir = path.resolve(fileDirname, outputDir.replaceAll('${fileDirname}', fileDirname));
  return path.join(dir, `${baseName}.${format}`);
}
