import { describe, expect, it } from 'vitest';
import {
  type Margins,
  lengthToTwips,
  pageSizeTwips,
  parseDocumentMeta,
  parseMargin,
  parsePageSize,
  resolvePdfOptions,
  type PdfOptions,
} from '../../src/core/exportOptions';

const fallback: Margins = { top: '1mm', right: '2mm', bottom: '3mm', left: '4mm' };

describe('lengthToTwips', () => {
  it.each([
    ['1in', 1440],
    ['72pt', 1440],
    ['25.4mm', 1440],
    ['2.54cm', 1440],
    ['96px', 1440],
    ['96', 1440],
    [' 20mm ', 1134],
  ])('%s -> %i', (input, twips) => {
    expect(lengthToTwips(input)).toBe(twips);
  });

  it.each(['', 'abc', '10em', '-5mm'])('rejects %s', (input) => {
    expect(lengthToTwips(input)).toBeUndefined();
  });
});

describe('parseMargin', () => {
  it('expands CSS shorthands', () => {
    expect(parseMargin('10mm', fallback)).toEqual({
      top: '10mm',
      right: '10mm',
      bottom: '10mm',
      left: '10mm',
    });
    expect(parseMargin('10mm 20mm', fallback)).toEqual({
      top: '10mm',
      right: '20mm',
      bottom: '10mm',
      left: '20mm',
    });
    expect(parseMargin('1in 2in 3in', fallback)).toEqual({
      top: '1in',
      right: '2in',
      bottom: '3in',
      left: '2in',
    });
    expect(parseMargin('1mm 2mm 3mm 4mm', fallback)).toEqual(fallback);
  });

  it('treats numbers as millimetres', () => {
    expect(parseMargin(15, fallback).top).toBe('15mm');
  });

  it('merges partial objects with the fallback', () => {
    expect(parseMargin({ top: '30mm', left: 'bad' }, fallback)).toEqual({
      ...fallback,
      top: '30mm',
    });
  });

  it('falls back on invalid input', () => {
    expect(parseMargin('10em', fallback)).toBe(fallback);
    expect(parseMargin('1mm 2mm 3mm 4mm 5mm', fallback)).toBe(fallback);
    expect(parseMargin(true, fallback)).toBe(fallback);
  });
});

describe('parsePageSize', () => {
  it('is case-insensitive', () => {
    expect(parsePageSize('a4')).toBe('A4');
    expect(parsePageSize('LETTER')).toBe('Letter');
    expect(parsePageSize('A3')).toBeUndefined();
    expect(parsePageSize(4)).toBeUndefined();
  });
});

describe('parseDocumentMeta', () => {
  it('reads title and pdf overrides', () => {
    const meta = parseDocumentMeta(
      'title: Relatório\npdf:\n  format: letter\n  landscape: true\n  margin: 10mm\n  footerTemplate: "<b>x</b>"',
    );
    expect(meta).toEqual({
      title: 'Relatório',
      pdf: { pageSize: 'Letter', landscape: true, margin: '10mm', footerTemplate: '<b>x</b>' },
    });
  });

  it('ignores invalid or missing front matter', () => {
    expect(parseDocumentMeta(undefined)).toEqual({ pdf: {} });
    expect(parseDocumentMeta('not: [valid')).toEqual({ pdf: {} });
    expect(parseDocumentMeta('- a list')).toEqual({ pdf: {} });
    expect(parseDocumentMeta('title: 3\npdf: nope')).toEqual({ pdf: {} });
  });
});

describe('resolvePdfOptions', () => {
  const defaults: PdfOptions = {
    pageSize: 'A4',
    landscape: false,
    margin: fallback,
    headerTemplate: '',
    footerTemplate: 'footer',
  };

  it('keeps defaults without overrides', () => {
    expect(resolvePdfOptions(defaults, {})).toEqual(defaults);
  });

  it('applies overrides and resolves margins against the defaults', () => {
    expect(resolvePdfOptions(defaults, { landscape: true, margin: { top: '9mm' } })).toEqual({
      ...defaults,
      landscape: true,
      margin: { ...fallback, top: '9mm' },
    });
  });
});

describe('pageSizeTwips', () => {
  it('converts and rotates', () => {
    expect(pageSizeTwips({ pageSize: 'A4', landscape: false })).toEqual({
      width: 11906,
      height: 16838,
    });
    expect(pageSizeTwips({ pageSize: 'Letter', landscape: true })).toEqual({
      width: 15840,
      height: 12240,
    });
  });
});
