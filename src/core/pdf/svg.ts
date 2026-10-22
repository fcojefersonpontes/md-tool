/**
 * Makes an SVG safe for svg-to-pdfkit: pdfkit rejects dash patterns with zero
 * lengths, which Mermaid emits (`stroke-dasharray="0 0 97 4"`).
 */
export function pdfSafeSvg(svg: string): string {
  return svg.replace(
    /(stroke-dasharray\s*[=:]\s*)("([^"]*)"|'([^']*)'|([^;"'>]+))/gi,
    (_match, prefix: string, _value, double?: string, single?: string, bare?: string) => {
      const raw = double ?? single ?? bare ?? '';
      const fixed = fixDashArray(raw);
      if (double !== undefined) return `${prefix}"${fixed}"`;
      if (single !== undefined) return `${prefix}'${fixed}'`;
      return `${prefix}${fixed}`;
    },
  );
}

/** Drops dash/gap pairs that are both zero and lifts remaining zeros to a hairline. */
export function fixDashArray(value: string): string {
  if (/^\s*(none|inherit|initial)?\s*$/i.test(value)) return value;
  const lengths = value
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((part) => parseFloat(part));
  if (lengths.some((length) => !Number.isFinite(length) || length < 0)) return 'none';
  // An odd count repeats to make pairs, as in SVG.
  const pattern = lengths.length % 2 ? [...lengths, ...lengths] : lengths;
  const kept: number[] = [];
  for (let i = 0; i < pattern.length; i += 2) {
    if (pattern[i] + pattern[i + 1] > 0) kept.push(pattern[i], pattern[i + 1]);
  }
  return kept.length ? kept.map((length) => Math.max(length, 0.01)).join(' ') : 'none';
}
