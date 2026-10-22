// Renders media/icon.svg to media/icon.png (256×256) with resvg.
// Usage: node scripts/render-icon.mjs
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { readFileSync, writeFileSync } from 'node:fs';

await initWasm(readFileSync('node_modules/@resvg/resvg-wasm/index_bg.wasm'));
const svg = readFileSync('media/icon.svg', 'utf8');
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 256 } }).render().asPng();
writeFileSync('media/icon.png', png);
console.log('media/icon.png');
