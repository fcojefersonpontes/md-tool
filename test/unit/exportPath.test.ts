import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveExportPath } from '../../src/core/exportPath';

const source = path.resolve('/docs/notes/readme.md');

describe('resolveExportPath', () => {
  it('saves next to the source file by default', () => {
    expect(resolveExportPath(source, 'pdf')).toBe(path.resolve('/docs/notes/readme.pdf'));
  });

  it('resolves relative output dirs against the source directory', () => {
    expect(resolveExportPath(source, 'rtf', 'export')).toBe(
      path.resolve('/docs/notes/export/readme.rtf'),
    );
  });

  it('expands ${fileDirname}', () => {
    expect(resolveExportPath(source, 'pdf', '${fileDirname}/out')).toBe(
      path.resolve('/docs/notes/out/readme.pdf'),
    );
  });

  it('keeps absolute output dirs', () => {
    expect(resolveExportPath(source, 'pdf', path.resolve('/tmp/pdfs'))).toBe(
      path.resolve('/tmp/pdfs/readme.pdf'),
    );
  });

  it('only strips the last extension', () => {
    expect(resolveExportPath(path.resolve('/a/v1.2.md'), 'pdf')).toBe(path.resolve('/a/v1.2.pdf'));
  });
});

describe('resolveExportPath with ${workspaceFolder}', () => {
  it('expands the workspace folder', () => {
    expect(
      resolveExportPath(source, 'pdf', '${workspaceFolder}/exports', path.resolve('/docs')),
    ).toBe(path.resolve('/docs/exports/readme.pdf'));
  });

  it('falls back to the file directory without a workspace', () => {
    expect(resolveExportPath(source, 'pdf', '${workspaceFolder}')).toBe(
      path.resolve('/docs/notes/readme.pdf'),
    );
  });
});
