// Renders media/icon.svg to media/icon.png (256×256) with the installed Chrome/Edge.
// Usage: node scripts/render-icon.mjs
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { findBrowser } from './browser.mjs';

const svg = readFileSync('media/icon.svg', 'utf8');
const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 128, height: 128, deviceScaleFactor: 2 });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`,
  );
  await page.screenshot({ path: 'media/icon.png', omitBackground: true });
  console.log('media/icon.png');
} finally {
  await browser.close();
}
