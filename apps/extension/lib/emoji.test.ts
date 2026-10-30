import { describe, expect, test } from 'bun:test';
import { EMOJI, matchEmoji } from './emoji';

describe('matchEmoji', () => {
  test('an empty query lists the fixed reaction set first, in order', () => {
    expect(
      matchEmoji({ query: '' })
        .map((e) => e.name)
        .slice(0, 5),
    ).toEqual(['+1', '-1', 'smile', 'tada', 'confused']);
  });

  test('+ reaches +1', () => {
    expect(matchEmoji({ query: '+' })[0]?.name).toBe('+1');
  });

  test('a prefix hit outranks a substring hit', () => {
    // `bug` starts with b; `+1` only matches through its `thumbsup` alias, mid-word.
    const names = matchEmoji({ query: 'b', limit: 50 }).map((e) => e.name);
    expect(names.indexOf('bug')).toBeLessThan(names.indexOf('+1'));
    expect(names).toContain('+1');
  });
});

describe('EMOJI table', () => {
  test('every entry has a char and names and chars are unique', () => {
    expect(EMOJI.every((e) => e.char.length > 0)).toBe(true);
    expect(new Set(EMOJI.map((e) => e.name)).size).toBe(EMOJI.length);
    expect(new Set(EMOJI.map((e) => e.char)).size).toBe(EMOJI.length);
  });
});
