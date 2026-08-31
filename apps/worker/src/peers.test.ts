import { describe, expect, test } from 'bun:test';
import { isAgentPeer, readPeerInfo, sanitizeColor, sanitizeName, sanitizeUid } from './peers';

describe('sanitizeName', () => {
  test('falls back for a non-string value', () => {
    expect(sanitizeName(42)).toBe('Anonymous');
    expect(sanitizeName(null)).toBe('Anonymous');
    expect(sanitizeName(undefined)).toBe('Anonymous');
    expect(sanitizeName({ name: 'x' })).toBe('Anonymous');
  });

  test('falls back for an empty or whitespace-only string rather than going blank', () => {
    expect(sanitizeName('')).toBe('Anonymous');
    expect(sanitizeName('   ')).toBe('Anonymous');
    expect(sanitizeName('\t\n ')).toBe('Anonymous');
  });

  test('truncates a long name to exactly the max length', () => {
    const long = 'x'.repeat(100);
    const result = sanitizeName(long);
    expect(result).toHaveLength(64);
    expect(result).toBe('x'.repeat(64));
  });

  test('trims before slicing, so leading whitespace is not counted toward the limit', () => {
    // 10 leading spaces + 64 'x's: trim happens first, so the kept 64 chars are all 'x'.
    const padded = ' '.repeat(10) + 'x'.repeat(64);
    const result = sanitizeName(padded);
    expect(result).toHaveLength(64);
    expect(result).toBe('x'.repeat(64));
  });

  test('honors an explicit fallback argument', () => {
    expect(sanitizeName(null, 'Guest')).toBe('Guest');
    expect(sanitizeName('   ', 'Guest')).toBe('Guest');
  });
});

describe('sanitizeColor', () => {
  test('accepts a valid #rrggbb in either hex case', () => {
    expect(sanitizeColor('#ff00aa')).toBe('#ff00aa');
    expect(sanitizeColor('#FF00AA')).toBe('#FF00AA');
  });

  test('rejects a 3-digit shorthand', () => {
    expect(sanitizeColor('#abc')).toBe('#8b5cf6');
  });

  test('rejects a named colour', () => {
    expect(sanitizeColor('red')).toBe('#8b5cf6');
  });

  test('rejects an rgb() function string', () => {
    expect(sanitizeColor('rgb(255, 0, 0)')).toBe('#8b5cf6');
  });

  test('rejects a non-string value', () => {
    expect(sanitizeColor(123)).toBe('#8b5cf6');
    expect(sanitizeColor(null)).toBe('#8b5cf6');
    expect(sanitizeColor(undefined)).toBe('#8b5cf6');
  });

  test('rejects trailing junk after 6 valid hex digits — the regex is anchored', () => {
    expect(sanitizeColor('#ff00aaZZ')).toBe('#8b5cf6');
    expect(sanitizeColor('#ff00aa;background:url(x)')).toBe('#8b5cf6');
  });

  test('honors an explicit fallback argument', () => {
    expect(sanitizeColor('not-a-color', '#000000')).toBe('#000000');
    expect(sanitizeColor('#123abc', '#000000')).toBe('#123abc');
  });
});

describe('readPeerInfo', () => {
  test('accepts a well-formed peer', () => {
    expect(readPeerInfo({ id: 'p1', name: 'Ada', color: '#8b5cf6' })).not.toBeNull();
  });

  test('rejects null and non-objects', () => {
    expect(readPeerInfo(null)).toBeNull();
    expect(readPeerInfo(undefined)).toBeNull();
    expect(readPeerInfo('peer')).toBeNull();
    expect(readPeerInfo(42)).toBeNull();
  });

  test('rejects an object missing a field', () => {
    expect(readPeerInfo({ name: 'Ada', color: '#8b5cf6' })).toBeNull();
    expect(readPeerInfo({ id: 'p1', color: '#8b5cf6' })).toBeNull();
    expect(readPeerInfo({ id: 'p1', name: 'Ada' })).toBeNull();
  });

  test('rejects an object with a mistyped field', () => {
    expect(readPeerInfo({ id: 1, name: 'Ada', color: '#8b5cf6' })).toBeNull();
    expect(readPeerInfo({ id: 'p1', name: 42, color: '#8b5cf6' })).toBeNull();
    expect(readPeerInfo({ id: 'p1', name: 'Ada', color: null })).toBeNull();
  });
});

describe('isAgentPeer', () => {
  test('an mcp-prefixed id is an agent', () => {
    expect(isAgentPeer('mcp-abc123')).toBe(true);
  });

  test('an ordinary uuid is not an agent', () => {
    expect(isAgentPeer('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d')).toBe(false);
  });

  test('a bare "mcp" without the dash is not an agent', () => {
    expect(isAgentPeer('mcp')).toBe(false);
  });
});

// The stable client id is what a mention points at, so presence has to carry it
// across a reconnect. An attachment that fails the schema is dropped whole —
// the peer then has no name, no colour and no uid, and nobody can tag them.
describe('sanitizeUid', () => {
  test('keeps a client-supplied id', () => {
    expect(sanitizeUid('V1StGXR8_Z5jdHi6B-myT')).toBe('V1StGXR8_Z5jdHi6B-myT');
  });

  test('is absent rather than invented when the client sent nothing usable', () => {
    expect(sanitizeUid(null)).toBeUndefined();
    expect(sanitizeUid(undefined)).toBeUndefined();
    expect(sanitizeUid('')).toBeUndefined();
    expect(sanitizeUid('   ')).toBeUndefined();
    expect(sanitizeUid(42)).toBeUndefined();
  });

  test('caps the length, since it is stored verbatim', () => {
    expect(sanitizeUid('x'.repeat(200))).toHaveLength(64);
  });
});

describe('readPeerInfo with a uid', () => {
  test('accepts an attachment carrying one, and hands the uid back', () => {
    // Asserted on the parsed value, not just non-null: a schema that dropped
    // `uid` would still parse, and the peer would stop being addressable.
    expect(readPeerInfo({ id: 'p1', uid: 'me-1', name: 'Ada', color: '#8b5cf6' })).toEqual({
      id: 'p1',
      uid: 'me-1',
      name: 'Ada',
      color: '#8b5cf6',
    });
  });

  test('still accepts one written before uid existed', () => {
    expect(readPeerInfo({ id: 'p1', name: 'Ada', color: '#8b5cf6' })).not.toBeNull();
  });

  test('accepts an explicitly absent uid', () => {
    expect(readPeerInfo({ id: 'p1', uid: undefined, name: 'Ada', color: '#8b5cf6' })).not.toBeNull();
  });

  test('rejects a mistyped uid rather than passing it to peers', () => {
    expect(readPeerInfo({ id: 'p1', uid: 7, name: 'Ada', color: '#8b5cf6' })).toBeNull();
  });
});
