import { describe, expect, it } from 'vitest';
import { browserCandidates, locateBrowser } from '../../src/export/pdf/browserLocator';

const winEnv = {
  PROGRAMFILES: 'C:\\Program Files',
  'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
  LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local',
};

describe('browserCandidates', () => {
  it('prefers Chrome over Edge on Windows', () => {
    const candidates = browserCandidates('win32', winEnv);
    const chrome = candidates.indexOf('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    const edge = candidates.indexOf(
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    );
    expect(chrome).toBeGreaterThanOrEqual(0);
    expect(edge).toBeGreaterThan(chrome);
    expect(candidates).toContain(
      'C:\\Users\\u\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
    );
  });

  it('lists app bundles on macOS', () => {
    expect(browserCandidates('darwin', {})[0]).toBe(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    );
  });

  it('searches PATH on Linux', () => {
    const candidates = browserCandidates('linux', { PATH: '/usr/bin:/opt/bin' });
    expect(candidates).toContain('/usr/bin/google-chrome');
    expect(candidates).toContain('/opt/bin/chromium');
    expect(candidates).toContain('/snap/bin/chromium');
  });
});

describe('locateBrowser', () => {
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

  it('returns the first installed candidate', () => {
    expect(locateBrowser({ platform: 'win32', env: winEnv, exists: (f) => f === edge })).toBe(edge);
  });

  it('prefers a configured path that exists', () => {
    expect(
      locateBrowser({
        platform: 'win32',
        env: winEnv,
        configuredPath: 'D:\\chrome.exe',
        exists: () => true,
      }),
    ).toBe('D:\\chrome.exe');
  });

  it('ignores a configured path that does not exist', () => {
    expect(
      locateBrowser({
        platform: 'win32',
        env: winEnv,
        configuredPath: 'D:\\missing.exe',
        exists: (f) => f === edge,
      }),
    ).toBe(edge);
  });

  it('returns undefined when nothing is installed', () => {
    expect(
      locateBrowser({ platform: 'linux', env: { PATH: '/usr/bin' }, exists: () => false }),
    ).toBe(undefined);
  });
});
