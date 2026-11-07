import { describe, expect, test } from 'bun:test';
import { parseRoomRef } from '@marklayer/agent-tools';

describe('parseRoomRef', () => {
  test('extracts the id from a full share URL', () => {
    expect(parseRoomRef('https://marklayer.app/s/abc123')).toBe('abc123');
  });

  test('rejects empty or whitespace-only input', () => {
    expect(() => parseRoomRef('')).toThrow('empty room reference');
    expect(() => parseRoomRef('   ')).toThrow('empty room reference');
  });

  // Has a `/` (so it skips the bare-id shortcut) but is not a parseable URL.
  test('rejects a slash-containing string that is not a valid URL', () => {
    expect(() => parseRoomRef('this/is/not/a/url')).toThrow('invalid room reference: this/is/not/a/url');
  });

  test('rejects a valid URL with no /s/ segment', () => {
    expect(() => parseRoomRef('https://marklayer.app/nope')).toThrow(
      'could not extract room id from URL: https://marklayer.app/nope',
    );
  });
});
