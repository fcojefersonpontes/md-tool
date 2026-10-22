import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

let highlighter: Promise<HighlighterCore> | undefined;

/** Lazily creates the shared highlighter with a curated set of common languages. */
export function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    engine: createJavaScriptRegexEngine(),
    themes: [import('@shikijs/themes/github-light'), import('@shikijs/themes/github-dark')],
    langs: [
      import('@shikijs/langs/bash'),
      import('@shikijs/langs/c'),
      import('@shikijs/langs/cpp'),
      import('@shikijs/langs/csharp'),
      import('@shikijs/langs/css'),
      import('@shikijs/langs/dart'),
      import('@shikijs/langs/diff'),
      import('@shikijs/langs/docker'),
      import('@shikijs/langs/go'),
      import('@shikijs/langs/html'),
      import('@shikijs/langs/ini'),
      import('@shikijs/langs/java'),
      import('@shikijs/langs/javascript'),
      import('@shikijs/langs/json'),
      import('@shikijs/langs/jsonc'),
      import('@shikijs/langs/jsx'),
      import('@shikijs/langs/kotlin'),
      import('@shikijs/langs/lua'),
      import('@shikijs/langs/php'),
      import('@shikijs/langs/powershell'),
      import('@shikijs/langs/python'),
      import('@shikijs/langs/ruby'),
      import('@shikijs/langs/rust'),
      import('@shikijs/langs/scss'),
      import('@shikijs/langs/sql'),
      import('@shikijs/langs/swift'),
      import('@shikijs/langs/toml'),
      import('@shikijs/langs/tsx'),
      import('@shikijs/langs/typescript'),
      import('@shikijs/langs/xml'),
      import('@shikijs/langs/yaml'),
    ],
  });
  return highlighter;
}

/**
 * Highlighted lines of `code` with GitHub Light colors, for exporters that draw
 * text themselves; `undefined` for languages that are not loaded.
 */
export function highlightTokens(
  hl: HighlighterCore,
  code: string,
  lang: string,
): { content: string; color?: string }[][] | undefined {
  if (!hl.getLoadedLanguages().includes(lang)) return undefined;
  return hl
    .codeToTokens(code, { lang, theme: 'github-light' })
    .tokens.map((line) => line.map(({ content, color }) => ({ content, color })));
}

/**
 * Highlights `code` as a `<pre class="shiki">` block using CSS variables for both
 * themes (`--shiki-light` / `--shiki-dark`), so the stylesheet picks the active one.
 * Returns `undefined` for languages that are not loaded.
 */
export function highlight(hl: HighlighterCore, code: string, lang: string): string | undefined {
  if (!hl.getLoadedLanguages().includes(lang)) return undefined;
  return hl.codeToHtml(code, {
    lang,
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
  });
}
