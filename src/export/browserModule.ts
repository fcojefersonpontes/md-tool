import * as path from 'node:path';
import * as vscode from 'vscode';
import { getPdfConfig } from '../config';
import type * as BrowserModule from './browser';
import { locateBrowser } from './pdf/browserLocator';

/** Loads dist/browser.js (puppeteer) on first use. */
export function loadBrowserModule(): typeof BrowserModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(path.join(__dirname, 'browser.js')) as typeof BrowserModule;
}

/** Chrome / Edge / Chromium to drive, honouring `mdTool.pdf.executablePath`. */
export function findBrowser(scope: vscode.Uri): string | undefined {
  return locateBrowser({
    platform: process.platform,
    env: process.env,
    configuredPath: getPdfConfig(scope).executablePath,
  });
}
