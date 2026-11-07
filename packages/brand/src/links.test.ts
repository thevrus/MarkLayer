import { describe, expect, test } from 'bun:test';
import {
  antHash,
  isNewShareId,
  isUploadPath,
  MIN_SHARE_ID_LENGTH,
  pageOgImage,
  parseRoomRef,
  parseShareRef,
  shareUrl,
  uploadPath,
} from './links';

describe('parseRoomRef', () => {
  test.each([
    ['abc123', 'abc123'],
    ['  abc123\n', 'abc123'],
    ['https://marklayer.app/s/abc123', 'abc123'],
    ['https://marklayer.app/s/abc123/', 'abc123'],
    ['https://marklayer.app/s/abc123?readonly=1', 'abc123'],
    ['https://marklayer.app/s/abc123/mcp', 'abc123'],
    ['marklayer.app/s/abc123', 'abc123'],
  ])('reads a room out of %j', (input, want) => {
    expect(parseRoomRef(input)).toBe(want);
  });

  test.each(['', '   ', 'https://marklayer.app/pricing', 'not an id', 'a'.repeat(65)])('finds none in %j', (input) => {
    expect(parseRoomRef(input)).toBeNull();
  });
});

describe('antHash', () => {
  test('reads back what it wrote', () => {
    expect(antHash.parse(antHash.build({ width: 1600, id: 'abc' }))).toEqual({ width: 1600, id: 'abc' });
  });

  test('a width nothing recorded falls back rather than writing a hash parse refuses', () => {
    expect(antHash.parse(antHash.build({ width: 0, id: 'abc' }))).toEqual({ width: 1280, id: 'abc' });
  });

  test.each(['', '#other', '#ant=abc', '#ant=0=abc', '#ant=-1=abc', '#ant=wide=abc', '#ant=1280=a=b'])(
    'refuses %j',
    (hash) => {
      expect(antHash.parse(hash)).toBeNull();
    },
  );
});

describe('pageOgImage', () => {
  const parsed = (url: string) => pageOgImage.parse(new URL(url).searchParams);

  test('survives the query encoding a real heading needs', () => {
    const url = pageOgImage.build({ heading: 'Compare & contrast: a/b?', path: '/vs/x' });
    expect(parsed(url)).toEqual({ heading: 'Compare & contrast: a/b?', path: '/vs/x' });
  });

  test('clamps caller-supplied text, and a card with no heading is no card', () => {
    const long = pageOgImage.build({ heading: 'h'.repeat(500), path: '/' });
    expect(parsed(long)?.heading).toHaveLength(200);
    expect(pageOgImage.parse(new URLSearchParams({ h: '  ', p: '/' }))).toBeNull();
  });
});

describe('upload paths', () => {
  const id = 'a'.repeat(21);

  test('recognises only what it mints', () => {
    expect(isUploadPath(uploadPath(id))).toBe(true);
    expect(isUploadPath(`/f/${id}/../secret`)).toBe(false);
    expect(isUploadPath(`/g/${id}`)).toBe(false);
  });
});

describe('isNewShareId', () => {
  test('refuses an id short enough to guess', () => {
    // The whole point of the floor: these are the ids that let someone squat a
    // room or enumerate their way into one, because the id is the access token.
    for (const id of ['a', 'abc', 'aB3xY7kZ', '12345678901']) expect(isNewShareId(id)).toBe(false);
    expect(isNewShareId('a'.repeat(MIN_SHARE_ID_LENGTH))).toBe(true);
  });

  test('takes what the product and the docs actually mint', () => {
    // A real nanoid() rather than the call, so this package stays dependency-free.
    expect(isNewShareId('dsWPMrdw6EZ8jkkhxvFKS')).toBe(true);
    expect(isNewShareId(crypto.randomUUID())).toBe(true);
  });

  test('refuses anything that could walk out of its own path', () => {
    for (const id of ['../../etc/passwd', 'abcdefghijkl/mno', 'abcdefghijkl?x=1', 'abcdefghijkl.json', ''])
      expect(isNewShareId(id)).toBe(false);
  });

  test('refuses an id too long to want as a primary key', () => {
    expect(isNewShareId('a'.repeat(64))).toBe(true);
    expect(isNewShareId('a'.repeat(65))).toBe(false);
  });
});

describe('shareUrl', () => {
  test('routes a project to /p and a page to /s', () => {
    expect(shareUrl({ origin: 'https://marklayer.app', kind: 'project', id: 'xyz', ref: 'web' })).toBe(
      'https://marklayer.app/p/xyz?ref=web',
    );
    expect(shareUrl({ origin: 'https://marklayer.app', kind: 'page', id: 'abc', ref: 'dash' })).toBe(
      'https://marklayer.app/s/abc?ref=dash',
    );
  });

  // A readonly lost between the popover and the copy hands out a view-only link as editable.
  test('carries readonly through alongside the ref', () => {
    expect(shareUrl({ origin: 'https://marklayer.app', kind: 'page', id: 'abc', readonly: true, ref: 'web' })).toBe(
      'https://marklayer.app/s/abc?readonly=1&ref=web',
    );
  });

  test('parseShareRef admits only known labels', () => {
    expect(parseShareRef('ext')).toBe('ext');
    expect(parseShareRef('<script>')).toBeNull();
    expect(parseShareRef(null)).toBeNull();
  });
});
