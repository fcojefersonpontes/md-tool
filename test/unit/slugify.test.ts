import { describe, expect, it } from 'vitest';
import { Slugger, slugify } from '../../src/core/slugify';

describe('slugify', () => {
  it.each([
    ['Hello World', 'hello-world'],
    ['  Trim me  ', 'trim-me'],
    ['Olá, Mundo!', 'olá-mundo'],
    ['C++ & C#', 'c--c'],
    ['snake_case and-dash', 'snake_case-and-dash'],
    ['Version 1.2.3', 'version-123'],
  ])('%s -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});

describe('Slugger', () => {
  it('suffixes duplicates', () => {
    const slugger = new Slugger();
    expect(['A', 'A', 'A'].map((t) => slugger.slug(t))).toEqual(['a', 'a-1', 'a-2']);
  });

  it('does not collide with headings that already look suffixed', () => {
    const slugger = new Slugger();
    expect(['A', 'A-1', 'A'].map((t) => slugger.slug(t))).toEqual(['a', 'a-1', 'a-2']);
  });
});
