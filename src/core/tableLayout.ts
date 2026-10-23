/** What a table column needs: its unwrapped width, and the width of its longest word. */
export interface ColumnSize {
  natural: number;
  minimum: number;
}

/**
 * Column widths for a table `available` units wide, like a browser's automatic layout:
 * - natural widths when they fit;
 * - otherwise, columns whose whole text fits in an even share keep it on one line, and
 *   the long ones get their minimum plus a share of what is left, proportional to how
 *   much more they want;
 * - when even the minimums do not fit, narrow columns keep their words whole and the
 *   space left is split evenly among the wide ones, whose long words (code, URLs) break.
 */
export function columnWidths(sizes: ColumnSize[], available: number): number[] {
  const natural = sizes.reduce((sum, size) => sum + size.natural, 0);
  if (natural <= available) return sizes.map((size) => size.natural);
  const minimum = sizes.reduce((sum, size) => sum + size.minimum, 0);

  if (minimum <= available) {
    const short = settle(sizes, available, 'natural');
    const rest = sizes.filter((_, i) => short.widths[i] === undefined);
    const restMinimum = rest.reduce((sum, size) => sum + size.minimum, 0);
    if (restMinimum <= short.left) {
      const want = rest.reduce((sum, size) => sum + size.natural - size.minimum, 0);
      return sizes.map(
        (size, i) =>
          short.widths[i] ??
          size.minimum +
            (want ? ((size.natural - size.minimum) * (short.left - restMinimum)) / want : 0),
      );
    }
    const wantAll = natural - minimum;
    return sizes.map(
      (size) => size.minimum + ((size.natural - size.minimum) * (available - minimum)) / wantAll,
    );
  }

  const narrow = settle(sizes, available, 'minimum');
  return narrow.widths.map((width) => width ?? Math.max(0, narrow.left) / narrow.open);
}

/**
 * Repeatedly gives each column whose `key` width fits in an even share of the space
 * left exactly that width. Returns the settled widths (`undefined` for the others), the
 * space left and how many columns are still open.
 */
function settle(
  sizes: ColumnSize[],
  available: number,
  key: keyof ColumnSize,
): { widths: (number | undefined)[]; left: number; open: number } {
  const widths: (number | undefined)[] = sizes.map(() => undefined);
  let left = available;
  let open = sizes.length;
  for (let changed = true; changed && open;) {
    changed = false;
    const share = left / open;
    sizes.forEach((size, i) => {
      if (widths[i] === undefined && size[key] <= share) {
        widths[i] = size[key];
        left -= size[key];
        open--;
        changed = true;
      }
    });
  }
  return { widths, left, open };
}

/**
 * Estimated column sizes for formats that cannot measure text (RTF): `em` per character
 * times `charWidth` (wider for bold headers), plus `padding` on each column.
 */
export function estimateColumnSizes(
  rows: { header: boolean; cells: (string | undefined)[] }[],
  columns: number,
  em: number,
  padding: number,
): ColumnSize[] {
  return Array.from({ length: columns }, (_, c) => {
    let natural = 0;
    let minimum = 0;
    for (const row of rows) {
      const text = row.cells[c] ?? '';
      const charWidth = em * (row.header ? 0.68 : 0.58);
      natural = Math.max(natural, Array.from(text).length * charWidth);
      for (const word of text.split(/\s+/)) {
        minimum = Math.max(minimum, Array.from(word).length * charWidth);
      }
    }
    // Room for at least two characters.
    return {
      natural: Math.max(natural, em * 1.2) + padding,
      minimum: Math.max(minimum, em * 1.2) + padding,
    };
  });
}
