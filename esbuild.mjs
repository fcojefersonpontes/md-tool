import * as esbuild from 'esbuild';
import { cpSync, rmSync } from 'node:fs';

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

const common = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
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

/** Puppeteer-based PDF printer and rasterizer, required lazily on first export. */
const browserTasks = {
  ...extension,
  entryPoints: ['src/export/browser/index.ts'],
  outfile: 'dist/browser.js',
};

/** Webview bundle (browser, IIFE). */
const webview = {
  ...common,
  entryPoints: ['webview/preview.ts'],
  outfile: 'dist/webview/preview.js',
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

const contexts = await Promise.all(
  [extension, browserTasks, webview].map((options) => esbuild.context(options)),
);

if (watch) {
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  await Promise.all(contexts.map((ctx) => ctx.rebuild()));
  await Promise.all(contexts.map((ctx) => ctx.dispose()));
}
