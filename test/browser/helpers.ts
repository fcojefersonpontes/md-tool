import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Page } from 'puppeteer-core';
import { locateBrowser } from '../../src/export/pdf/browserLocator';

export const repoRoot = path.resolve(__dirname, '../..');
export const fixtures = path.join(repoRoot, 'test/fixtures');

/** Browser used by these tests; the suites skip themselves when none is installed. */
export const browserPath = locateBrowser({
  platform: process.platform,
  env: process.env,
  configuredPath: process.env.MD_TOOL_BROWSER,
});

export function assertBuilt(): void {
  for (const file of [
    'dist/webview/preview.js',
    'dist/webview/mermaid.min.js',
    'dist/browser.js',
  ]) {
    if (!fs.existsSync(path.join(repoRoot, file))) {
      throw new Error(`${file} is missing: run "npm run compile" first`);
    }
  }
}

/** Collects console errors, page errors, failed requests and CSP violations. */
export async function trackProblems(page: Page, ignoreUrls: RegExp[] = []): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
      problems.push(`console: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${(error as Error).message}`));
  page.on('requestfailed', (request) => {
    if (!ignoreUrls.some((re) => re.test(request.url()))) problems.push(`failed: ${request.url()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && !ignoreUrls.some((re) => re.test(response.url()))) {
      problems.push(`${response.status()}: ${response.url()}`);
    }
  });
  await page.evaluateOnNewDocument(() => {
    document.addEventListener('securitypolicyviolation', (event) =>
      console.error(`CSP ${event.violatedDirective} ${event.blockedURI}`),
    );
  });
  return problems;
}
