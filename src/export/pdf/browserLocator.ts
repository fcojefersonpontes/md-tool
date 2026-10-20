import * as fs from 'node:fs';
import * as path from 'node:path';

export interface LocateOptions {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** `mdTool.pdf.executablePath`; wins when it exists. */
  configuredPath?: string;
  exists?: (file: string) => boolean;
}

const LINUX_COMMANDS = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'microsoft-edge',
  'microsoft-edge-stable',
  'brave-browser',
];

/** Candidate Chromium-based browser executables, in order of preference (Chrome, then Edge). */
export function browserCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  switch (platform) {
    case 'win32': {
      const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(
        (root): root is string => !!root,
      );
      const apps = [
        ['Google', 'Chrome', 'Application', 'chrome.exe'],
        ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
        ['Chromium', 'Application', 'chrome.exe'],
        ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'],
      ];
      return apps.flatMap((app) => roots.map((root) => path.win32.join(root, ...app)));
    }
    case 'darwin':
      return [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      ];
    default: {
      const dirs = (env.PATH ?? '').split(path.posix.delimiter).filter(Boolean);
      return [
        ...LINUX_COMMANDS.flatMap((command) => dirs.map((dir) => path.posix.join(dir, command))),
        '/snap/bin/chromium',
      ];
    }
  }
}

/** Finds a browser that can print PDFs, or `undefined` when none is installed. */
export function locateBrowser(options: LocateOptions): string | undefined {
  const exists = options.exists ?? ((file: string) => fs.existsSync(file));
  const configured = options.configuredPath?.trim();
  if (configured && exists(configured)) return configured;
  return browserCandidates(options.platform, options.env).find(exists);
}
