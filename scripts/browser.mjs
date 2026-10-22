import { existsSync } from 'node:fs';
import path from 'node:path';

/** The first installed Chrome/Edge, or `MDTOOL_BROWSER` (dev scripts only). */
export function findBrowser() {
  const env = process.env;
  if (env.MDTOOL_BROWSER) return env.MDTOOL_BROWSER;
  const candidates =
    process.platform === 'win32'
      ? [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA]
          .filter(Boolean)
          .flatMap((root) => [
            path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          ])
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          ]
        : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge'];
  const found = candidates.find((file) => existsSync(file));
  if (!found) throw new Error('No Chrome/Edge found; set MDTOOL_BROWSER.');
  return found;
}
