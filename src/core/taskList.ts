const TASK_LINE = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

/**
 * Toggles the task-list checkbox on a single source line (`- [ ] a` <-> `- [x] a`).
 * Returns `undefined` when the line is not a task-list item.
 */
export function toggleTaskLine(line: string): string | undefined {
  const match = TASK_LINE.exec(line);
  if (!match) return undefined;
  const mark = match[2] === ' ' ? 'x' : ' ';
  return match[1] + mark + match[3] + line.slice(match[0].length);
}
