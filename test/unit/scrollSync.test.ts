import { describe, expect, it } from 'vitest';
import { lineForOffset, normalizeAnchors, offsetForLine } from '../../webview/scrollSync';

const anchors = [
  { line: 0, top: 20 },
  { line: 4, top: 100 },
  { line: 10, top: 400 },
];

describe('normalizeAnchors', () => {
  it('sorts by line and keeps the outermost anchor per line', () => {
    expect(
      normalizeAnchors([
        { line: 4, top: 100 },
        { line: 0, top: 20 },
        { line: 4, top: 102 },
      ]),
    ).toEqual([
      { line: 0, top: 20 },
      { line: 4, top: 100 },
    ]);
  });

  it('drops anchors that go backwards on screen', () => {
    expect(
      normalizeAnchors([
        { line: 0, top: 20 },
        { line: 2, top: 10 },
        { line: 3, top: 50 },
      ]),
    ).toEqual([
      { line: 0, top: 20 },
      { line: 3, top: 50 },
    ]);
  });
});

describe('offsetForLine', () => {
  it('is 0 at the start and without anchors', () => {
    expect(offsetForLine(anchors, 0)).toBe(0);
    expect(offsetForLine([], 5)).toBe(0);
  });

  it('lands exactly on an anchor line', () => {
    expect(offsetForLine(anchors, 4)).toBe(100);
  });

  it('interpolates between anchors', () => {
    expect(offsetForLine(anchors, 7)).toBe(250);
  });

  it('clamps past the last anchor', () => {
    expect(offsetForLine(anchors, 99)).toBe(400);
  });
});

describe('lineForOffset', () => {
  it('is 0 above the first anchor and without anchors', () => {
    expect(lineForOffset(anchors, 5)).toBe(0);
    expect(lineForOffset([], 300)).toBe(0);
  });

  it('interpolates between anchors', () => {
    expect(lineForOffset(anchors, 250)).toBe(7);
  });

  it('clamps past the last anchor', () => {
    expect(lineForOffset(anchors, 9999)).toBe(10);
  });

  it('round-trips with offsetForLine', () => {
    for (const line of [1, 3, 5, 8, 10]) {
      expect(lineForOffset(anchors, offsetForLine(anchors, line))).toBeCloseTo(line);
    }
  });
});
