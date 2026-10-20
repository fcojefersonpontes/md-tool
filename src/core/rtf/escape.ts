function signed16(code: number): number {
  return code > 0x7fff ? code - 0x10000 : code;
}

/**
 * Escapes text for an RTF body (`\uc1` mode): RTF control characters are
 * backslash-escaped and everything outside ASCII becomes `\uN?`, with
 * astral characters (emoji) split into UTF-16 surrogate pairs.
 *
 * In a run of spaces only the first is a plain space; the rest become
 * non-breaking spaces (`\~`). LibreOffice's RTF importer otherwise widens
 * every space in the run, doubling code indentation.
 */
export function escapeRtf(text: string): string {
  let out = '';
  let previousSpace = false;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (ch === ' ') {
      out += previousSpace ? '\\~' : ' ';
      previousSpace = true;
      continue;
    }
    previousSpace = false;
    if (ch === '\\' || ch === '{' || ch === '}') out += `\\${ch}`;
    else if (ch === '\t') out += '\\tab ';
    else if (ch === '\n') out += '\\line ';
    else if (code < 0x20) continue;
    else if (code < 0x80) out += ch;
    else if (code <= 0xffff) out += `\\u${signed16(code)}?`;
    else {
      const offset = code - 0x10000;
      const high = 0xd800 + (offset >> 10);
      const low = 0xdc00 + (offset & 0x3ff);
      out += `\\u${signed16(high)}?\\u${signed16(low)}?`;
    }
  }
  return out;
}
