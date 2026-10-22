// Captures the README images from a real VS Code window (Windows only).
// Usage: npm run compile && node scripts/screenshots/run.mjs
// Output: docs/images/{preview,preview-math,export}.png and editing.gif
import { runTests } from '@vscode/test-electron';
import gifenc from 'gifenc';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { renderOutputs } from './outputs.mjs';

const { GIFEncoder, applyPalette, quantize } = gifenc;
// Set when this runs from a VS Code terminal; it would start VS Code as plain Node.
delete process.env.ELECTRON_RUN_AS_NODE;
const root = path.resolve(import.meta.dirname, '..', '..');
const images = path.join(root, 'docs', 'images');
const temp = mkdtempSync(path.join(tmpdir(), 'md-tool-shots-'));
const workspace = path.join(temp, 'md-tool-demo');
const shots = path.join(temp, 'shots');
const userData = path.join(temp, 'user-data');

cpSync(path.join(root, 'docs', 'demo'), workspace, { recursive: true });
mkdirSync(shots);
mkdirSync(path.join(userData, 'User'), { recursive: true });
writeFileSync(
  path.join(userData, 'User', 'settings.json'),
  JSON.stringify({
    'window.title': '${rootName} — md-tool-demo',
    'workbench.colorTheme': 'Default Dark Modern',
    'workbench.startupEditor': 'none',
    'workbench.tips.enabled': false,
    'workbench.layoutControl.enabled': false,
    'window.commandCenter': false,
    'editor.minimap.enabled': false,
    'editor.fontSize': 14,
    'editor.autoClosingBrackets': 'never',
    'editor.renderWhitespace': 'none',
    'breadcrumbs.enabled': false,
    'git.enabled': false,
    'telemetry.telemetryLevel': 'off',
    'update.mode': 'none',
  }),
);

const code = await runTests({
  version: '1.90.0',
  extensionDevelopmentPath: root,
  extensionTestsPath: path.join(root, 'scripts', 'screenshots', 'demo.cjs'),
  extensionTestsEnv: { MDTOOL_SHOTS: shots },
  launchArgs: [
    workspace,
    `--user-data-dir=${userData}`,
    `--extensions-dir=${path.join(temp, 'extensions')}`,
  ],
});
if (code !== 0) throw new Error(`VS Code exited with ${code}; shots in ${shots}`);

mkdirSync(images, { recursive: true });
for (const name of ['preview.png', 'preview-math.png', 'export.png']) {
  cpSync(path.join(shots, name), path.join(images, name));
}
await renderOutputs(shots, path.join(images, 'outputs.png'));

// editing.gif: only the pixels that changed since the previous frame are stored.
const frames = JSON.parse(readFileSync(path.join(shots, 'editing', 'frames.json'), 'utf8'));
const gif = GIFEncoder();
let previous;
for (const { file, delay } of frames) {
  const { width, height, data } = PNG.sync.read(readFileSync(file));
  const rgba = new Uint8Array(data);
  const palette = quantize(rgba, 255, { format: 'rgb565' });
  const index = applyPalette(rgba, palette, 'rgb565');
  // An extra palette entry marks unchanged pixels as transparent.
  const transparentIndex = palette.length;
  palette.push([0, 0, 0]);
  if (previous) {
    for (let p = 0, i = 0; i < rgba.length; p++, i += 4) {
      if (
        rgba[i] === previous[i] &&
        rgba[i + 1] === previous[i + 1] &&
        rgba[i + 2] === previous[i + 2]
      ) {
        index[p] = transparentIndex;
      }
    }
  }
  gif.writeFrame(index, width, height, {
    palette,
    delay,
    transparent: !!previous,
    transparentIndex,
    dispose: 1, // keep the previous frame under the transparent pixels
  });
  previous = rgba;
}
gif.finish();
writeFileSync(path.join(images, 'editing.gif'), gif.bytes());
console.log(`images in ${images}; exports in ${shots}`);
