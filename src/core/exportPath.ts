import * as path from 'node:path';

export type ExportFormat = 'pdf' | 'rtf';

/**
 * Resolves the output file path for an exported Markdown document.
 * `outputDir` may contain `${fileDirname}` and `${workspaceFolder}`; relative
 * directories are resolved against the source file's directory.
 */
export function resolveExportPath(
  sourcePath: string,
  format: ExportFormat,
  outputDir = '${fileDirname}',
  workspaceFolder?: string,
): string {
  const fileDirname = path.dirname(sourcePath);
  const baseName = path.basename(sourcePath, path.extname(sourcePath));
  const expanded = outputDir
    .replaceAll('${fileDirname}', fileDirname)
    .replaceAll('${workspaceFolder}', workspaceFolder ?? fileDirname);
  return path.join(path.resolve(fileDirname, expanded), `${baseName}.${format}`);
}
