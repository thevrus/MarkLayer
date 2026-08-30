import { describe, expect, it } from 'bun:test';
import { bytesUrl } from './pdfSource';

const origin = 'https://marklayer.app';

describe('pdf bytes source', () => {
  it('reads an uploaded file straight from this origin', () => {
    expect(bytesUrl({ url: '/f/V1StGXR8Z5jdHi6BmyTaa', origin })).toBe('/f/V1StGXR8Z5jdHi6BmyTaa');
  });

  it('sends a remote document through the proxy', () => {
    expect(bytesUrl({ url: 'https://example.com/a.pdf', origin })).toBe(
      'https://marklayer.app/proxy?url=https%3A%2F%2Fexample.com%2Fa.pdf&raw=1',
    );
  });

  it('refuses to read any other same-origin path directly', () => {
    // Each of these would make the viewer fetch something it must never fetch.
    for (const url of ['/f/../../api/openapi.json', '/api/openapi.json', '/f/short', '/f/V1StGXR8Z5jdHi6BmyTaa/x']) {
      expect(bytesUrl({ url, origin }).startsWith('https://marklayer.app/proxy?')).toBe(true);
    }
  });
});
