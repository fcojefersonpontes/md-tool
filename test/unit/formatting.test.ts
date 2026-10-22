import { describe, expect, it } from 'vitest';
import { applyEdits, editSelections, shiftSpan } from '../../src/core/edit/edits';
import {
  type InlineStyle,
  toggleCodeBlock,
  toggleInlineStyle,
} from '../../src/core/edit/formatting';
import { run } from './cursors';

const toggle = (marked: string, style: InlineStyle) =>
  run(marked, (text, selections) => toggleInlineStyle(text, selections, style));

describe('edits', () => {
  it('applies edits in any order', () => {
    expect(
      applyEdits('abcdef', [
        { start: 0, end: 0, text: 'X' },
        { start: 4, end: 6, text: 'Y' },
        { start: 2, end: 3, text: '' },
      ]),
    ).toBe('XabdY');
  });

  it('keeps a wrapped selection on the same characters', () => {
    const edits = [
      { start: 2, end: 2, text: '**' },
      { start: 5, end: 5, text: '**' },
    ];
    expect(shiftSpan({ start: 2, end: 5 }, edits)).toEqual({ start: 4, end: 7 });
    expect(shiftSpan({ start: 5, end: 5 }, edits)).toEqual({ start: 7, end: 7 });
  });

  it('skips selections whose edits overlap earlier ones', () => {
    const result = editSelections(
      [
        { start: 0, end: 3 },
        { start: 1, end: 2 },
      ],
      (selection) => ({
        edits: [{ start: selection.start, end: selection.end, text: 'x' }],
        selection: { start: selection.start, end: selection.start + 1 },
      }),
    );
    expect(result.edits).toHaveLength(1);
  });
});

describe('toggleInlineStyle', () => {
  it.each([
    // wrap a selection, keeping it selected
    ['a «word» b', 'bold', 'a **«word»** b'],
    ['a «word» b', 'italic', 'a _«word»_ b'],
    ['a «word» b', 'strikethrough', 'a ~~«word»~~ b'],
    ['a «word» b', 'code', 'a `«word»` b'],
    // whitespace at the edges stays outside the markers
    ['a« word »b', 'bold', 'a« **word** »b'],
    // unwrap when the markers are outside or inside the selection
    ['a **«word»** b', 'bold', 'a «word» b'],
    ['a «**word**» b', 'bold', 'a «word» b'],
    ['a __«word»__ b', 'bold', 'a «word» b'],
    ['a *«word»* b', 'italic', 'a «word» b'],
    // italic must not mistake bold markers for its own
    ['a **«word»** b', 'italic', 'a **_«word»_** b'],
    // cursor in a word styles the word, cursor stays in place
    ['a wo|rd b', 'bold', 'a **wo|rd** b'],
    ['a çã|o b', 'italic', 'a _çã|o_ b'],
    // cursor inside styled text removes the style
    ['a **wo|rd** b', 'bold', 'a wo|rd b'],
    ['**two wo|rds**', 'bold', 'two wo|rds'],
    // ...but not between two styled spans
    ['**a** b|c **d**', 'bold', '**a** **b|c** **d**'],
    // cursor outside words inserts an empty pair; toggling again removes it
    ['a | b', 'bold', 'a **|** b'],
    ['a **|** b', 'bold', 'a | b'],
    ['|', 'code', '`|`'],
  ] as const)('%s (%s) -> %s', (input, style, expected) => {
    expect(toggle(input, style)).toBe(expected);
  });

  it.each([
    // `_` inside words (URLs, snake_case) is not emphasis: never strip it
    [
      'see [x](https://a.b/Half_and_full) and dou|ble [y](https://c.d/ANSI_escape)',
      'italic',
      'see [x](https://a.b/Half_and_full) and _dou|ble_ [y](https://c.d/ANSI_escape)',
    ],
    ['call my_fu|nc_name now', 'italic', 'call _my_fu|nc_name_ now'],
    // a list bullet `* ` cannot open emphasis
    ['* Ign|ore *.d.ts files', 'italic', '* _Ign|ore_ *.d.ts files'],
    // markers inside inline code do not count
    ['`a * b` te|xt * c', 'italic', '`a * b` _te|xt_ * c'],
    // cursor inside inline code removes the code span
    ['use `npm in|stall` now', 'code', 'use npm in|stall now'],
    ['use ``a ` b|`` now', 'code', 'use a ` b| now'],
  ] as const)('respects Markdown delimiter rules: %s (%s)', (input, style, expected) => {
    expect(toggle(input, style)).toBe(expected);
  });

  it('handles multiple cursors independently', () => {
    expect(toggle('|one two| «three»', 'bold')).toBe('**|one** **two|** **«three»**');
  });

  it('styles multi-line selections line by line, skipping blank lines', () => {
    expect(toggle('«one\n\n two»', 'bold')).toBe('«**one**\n\n **two**»');
    expect(toggle('«**one**\n**two**»', 'bold')).toBe('«one\ntwo»');
    // mixed: only the unstyled lines get the style
    expect(toggle('«**one**\ntwo»', 'bold')).toBe('«**one**\n**two**»');
  });

  it('does nothing for a whitespace-only selection', () => {
    expect(toggle('a«  »b', 'bold')).toBe('a«  »b');
  });
});

describe('toggleCodeBlock', () => {
  const block = (marked: string) => run(marked, toggleCodeBlock);

  it('fences the selected lines', () => {
    expect(block('intro\n«a\nb»\nend')).toBe('intro\n```\n«a\nb»\n```\nend');
  });

  it('fences the line under the cursor', () => {
    expect(block('x = |1')).toBe('```\nx = |1\n```');
  });

  it('inserts an empty block on an empty line', () => {
    expect(block('a\n|\nb')).toBe('a\n```\n|\n```\nb');
  });

  it('uses and understands CRLF line endings', () => {
    expect(block('a\r\n«b»\r\nc')).toBe('a\r\n```\r\n«b»\r\n```\r\nc');
    expect(block('a\r\n```\r\n«b»\r\n```\r\nc')).toBe('a\r\n«b»\r\nc');
    expect(block('|')).toBe('```\n|\n```');
  });

  it('removes fences around the selection', () => {
    expect(block('intro\n```\n«a\nb»\n```\nend')).toBe('intro\n«a\nb»\nend');
    expect(block('```ts\nconst |a = 1;\n```')).toBe('const |a = 1;');
  });
});
