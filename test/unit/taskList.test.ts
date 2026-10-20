import { describe, expect, it } from 'vitest';
import { toggleTaskLine } from '../../src/core/taskList';

describe('toggleTaskLine', () => {
  it.each([
    ['- [ ] a', '- [x] a'],
    ['- [x] a', '- [ ] a'],
    ['- [X] a', '- [ ] a'],
    ['  * [ ] nested', '  * [x] nested'],
    ['+ [ ] plus', '+ [x] plus'],
    ['1. [ ] ordered', '1. [x] ordered'],
    ['2) [x] paren', '2) [ ] paren'],
    ['> - [ ] quoted', '> - [x] quoted'],
    ['- [ ] keeps [ ] later', '- [x] keeps [ ] later'],
  ])('%s -> %s', (input, expected) => {
    expect(toggleTaskLine(input)).toBe(expected);
  });

  it.each(['plain text', '- item', '-[ ] no space', '[ ] no marker'])('ignores %s', (input) => {
    expect(toggleTaskLine(input)).toBeUndefined();
  });
});
