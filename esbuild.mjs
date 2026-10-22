import * as esbuild from 'esbuild';
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').Plugin} */
const problemMatcher = {
  name: 'problem-matcher',
  setup(build) {
    build.onStart(() => console.log('[watch] build started'));
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`);
        if (location) console.error(`    ${location.file}:${location.line}:${location.column}:`);
      }
      console.log('[watch] build finished');
    });
  },
};

/**
 * pdfkit loads its standard-font metrics with a dynamic require that esbuild
 * cannot follow; make those requires static so the metrics are bundled.
 * @type {import('esbuild').Plugin}
 */
const pdfkitStandardFonts = {
  name: 'pdfkit-standard-fonts',
  setup(build) {
    build.onLoad({ filter: /pdfkit[\\/]js[\\/]pdfkit\.js$/ }, async (args) => ({
      contents: (await readFile(args.path, 'utf8')).replace(
        /require\$1\('#standard-fonts\/(\w+)'\)/g,
        "require('./standard-fonts/$1.cjs')",
      ),
      loader: 'js',
      resolveDir: path.dirname(args.path),
    }));
  },
};

const common = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  metafile: production,
  logLevel: 'silent',
  plugins: [problemMatcher],
};

/** Extension host bundle (Node, CommonJS). */
const extension = {
  ...common,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
};

/** PDF writer, MathJax and resvg, required lazily on the first export. */
const exporter = {
  ...extension,
  entryPoints: ['src/export/engine/index.ts'],
  outfile: 'dist/exporter.js',
  // The CommonJS build: the ESM one locates its data files through import.meta.url.
  alias: { pdfkit: './node_modules/pdfkit/js/pdfkit.js' },
  plugins: [...common.plugins, pdfkitStandardFonts],
};

/**
 * Webview bundles (browser, IIFE): the preview, the diagram renderer used by
 * exports, and the PDF / RTF viewers.
 */
const webview = {
  ...common,
  entryPoints: {
    preview: 'webview/preview.ts',
    diagrams: 'webview/diagrams.ts',
    pdfViewer: 'webview/pdfViewer.ts',
    rtfViewer: 'webview/rtfViewer.ts',
  },
  outdir: 'dist/webview',
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
};

// Production builds start clean so stale source maps never reach the .vsix.
if (production) rmSync('dist', { recursive: true, force: true });

// Runtime assets loaded by the webview that are not bundled by esbuild.
cpSync('node_modules/katex/dist/katex.min.css', 'dist/webview/katex/katex.min.css');
cpSync('node_modules/katex/dist/fonts', 'dist/webview/katex/fonts', { recursive: true });
cpSync('node_modules/mermaid/dist/mermaid.min.js', 'dist/webview/mermaid.min.js');
// pdf.js parses PDFs in a worker, started by the PDF viewer from this file.
cpSync('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', 'dist/webview/pdf.worker.mjs');
// resvg (SVG to PNG) as WebAssembly, loaded by dist/exporter.js.
cpSync('node_modules/@resvg/resvg-wasm/index_bg.wasm', 'dist/resvg.wasm');

const contexts = await Promise.all(
  [extension, exporter, webview].map((options) => esbuild.context(options)),
);

if (watch) {
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  const results = await Promise.all(contexts.map((ctx) => ctx.rebuild()));
  await Promise.all(contexts.map((ctx) => ctx.dispose()));
  if (production) writeNotices(results.map((result) => result.metafile));
}

/**
 * dist/THIRD-PARTY-NOTICES.txt: the license of every npm package that ends up in
 * the bundles, plus the copied KaTeX, Mermaid and pdf.js assets.
 */
function writeNotices(metafiles) {
  const packages = new Set([
    'node_modules/katex',
    'node_modules/mermaid',
    'node_modules/pdfjs-dist',
  ]);
  for (const metafile of metafiles) {
    for (const input of Object.keys(metafile.inputs)) {
      const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input.replace(/\\/g, '/'));
      if (match) packages.add(match[1]);
    }
  }
  const sections = [...packages]
    .map((dir) => {
      const { name, version, license } = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'));
      const file = readdirSync(dir).find((entry) => /^(licen[cs]e|copying)/i.test(entry));
      const text = file
        ? readFileSync(path.join(dir, file), 'utf8').trim()
        : `License: ${license} (https://spdx.org/licenses/${license}.html)`;
      return { id: `${name}@${version}`, text };
    })
    .filter((entry, i, all) => all.findIndex((other) => other.id === entry.id) === i)
    .sort((a, b) => a.id.localeCompare(b.id));
  const rule = '-'.repeat(72);
  const body = sections.map(({ id, text }) => `${rule}\n${id}\n${rule}\n\n${text}\n`).join('\n');
  writeFileSync(
    'dist/THIRD-PARTY-NOTICES.txt',
    `md-tool bundles the following third-party software.\n\n${body}`,
  );
}
