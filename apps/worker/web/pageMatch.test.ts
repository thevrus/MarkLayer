import { describe, expect, it } from 'bun:test';
import { findPageIndex, normalizePageUrl } from './pageMatch';

describe('normalizePageUrl', () => {
  it('drops the fragment and tracking params', () => {
    expect(normalizePageUrl('https://a.com/x?utm_source=t&gclid=1&fbclid=2&msclkid=3&_gl=4#top')).toBe(
      'https://a.com/x',
    );
  });

  it('keeps other params, the trailing slash and path case', () => {
    expect(normalizePageUrl('https://a.com/Docs/?id=7&utm_medium=x&q=a')).toBe('https://a.com/Docs/?id=7&q=a');
    expect(normalizePageUrl('https://a.com/x/')).toBe('https://a.com/x/');
    expect(normalizePageUrl('https://a.com/X')).toBe('https://a.com/X');
  });

  it('passes an unparseable string through', () => {
    expect(normalizePageUrl('not a url')).toBe('not a url');
  });
});

describe('findPageIndex', () => {
  const pages = [{ url: null }, { url: 'https://a.com/x?id=1' }];

  it('finds a page despite fragment and tracking noise', () => {
    expect(findPageIndex({ pages, url: 'https://a.com/x?id=1&utm_campaign=z#s' })).toBe(1);
  });

  it('does not merge a different query', () => {
    expect(findPageIndex({ pages, url: 'https://a.com/x?id=2' })).toBe(-1);
  });
});
