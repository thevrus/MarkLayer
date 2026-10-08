import { describe, expect, it } from 'bun:test';
import { compareHref, parseCompareUrl } from './url';

describe('parseCompareUrl', () => {
  it('adds https to a bare host', () => {
    expect(parseCompareUrl(' staging.example.com/pricing ')).toBe('https://staging.example.com/pricing');
  });

  it('refuses non-http schemes and blocked hosts', () => {
    expect(parseCompareUrl('javascript:alert(1)')).toBeNull();
    expect(parseCompareUrl('file:///etc/passwd')).toBeNull();
    expect(parseCompareUrl('http://127.0.0.1:8080')).toBeNull();
    expect(parseCompareUrl('')).toBeNull();
  });
});

describe('compareHref', () => {
  it('round-trips both addresses through the query', () => {
    const href = compareHref({ a: 'https://a.test/?x=1&y=2', b: 'https://b.test' });
    const params = new URL(href, 'https://marklayer.app').searchParams;
    expect(params.get('a')).toBe('https://a.test/?x=1&y=2');
    expect(params.get('b')).toBe('https://b.test');
  });
});
