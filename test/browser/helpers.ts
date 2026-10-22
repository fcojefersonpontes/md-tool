import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Page } from 'puppeteer-core';

export const repoRoot = path.resolve(__dirname, '../..');
export const fixtures = path.join(repoRoot, 'test/fixtures');

/**
 * Chromium-based browser that stands in for the VS Code webview in these
 * development-only tests (the extension itself never uses a browser).
 * The suites skip themselves when none is installed.
 */
export const browserPath = findBrowser();

function findBrowser(): string | undefined {
  const env = process.env;
  if (env.MD_TOOL_BROWSER) return env.MD_TOOL_BROWSER;
  const candidates =
    process.platform === 'win32'
      ? [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA]
          .filter((root): root is string => !!root)
          .flatMap((root) => [
            path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          ])
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          ]
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'];
  return candidates.find((file) => fs.existsSync(file));
}

export function assertBuilt(): void {
  for (const file of ['dist/webview/preview.js', 'dist/webview/mermaid.min.js']) {
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
