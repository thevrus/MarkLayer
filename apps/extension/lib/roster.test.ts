import { afterEach, describe, expect, test } from 'bun:test';
import type { CommentOp, DrawOp, Peer } from '@marklayer/types';
import { asMention, matchRoster, OFFLINE_COLOR, roster, rosterNames } from './roster';
import { localUser, operations, peers, setUserName } from './state';

/* The local name is otherwise a random animal, which would occasionally collide
   with a fixture name and change a ranking or a limit cut. */
setUserName('Local Tester');

const comment = (over: Partial<CommentOp> = {}): CommentOp => ({
  id: 'c1',
  color: '#000',
  lineWidth: 2,
  tool: 'comment',
  num: 1,
  text: 'x',
  x: 0,
  y: 0,
  ts: 0,
  ...over,
});

const peer = (over: Partial<Peer> & { id: string }): Peer => ({
  name: 'Peer',
  color: '#0f0',
  cursor: null,
  lastSeen: 0,
  ...over,
});

const seed = ({ ops = [], present = [] }: { ops?: DrawOp[]; present?: Peer[] } = {}) => {
  operations.value = ops;
  peers.value = new Map(present.map((p) => [p.id, p]));
};

afterEach(() => {
  seed();
});

describe('roster', () => {
  test('always includes you, marked as yourself', () => {
    seed();
    expect(roster.value).toEqual([
      { id: localUser.id, name: localUser.name, color: localUser.color, online: true, self: true },
    ]);
  });

  test('includes people who wrote annotations but are not connected', () => {
    // The extension never opens a socket, so a live-peers-only roster would
    // offer nobody to tag.
    seed({ ops: [comment({ author: 'Ada', authorId: 'ada' })] });
    expect(roster.value).toContainEqual({
      id: 'ada',
      name: 'Ada',
      color: OFFLINE_COLOR,
      online: false,
      self: false,
    });
  });

  test('includes people who were only ever tagged', () => {
    seed({ ops: [comment({ mentions: [{ id: 'bo', name: 'Bo' }] })] });
    expect(roster.value.map((e) => e.id)).toContain('bo');
  });

  test('keys a connected peer by its stable client id, not its per-connection id', () => {
    // Otherwise the same person appears twice: once from the socket, once as the
    // author of their own comments.
    seed({
      ops: [comment({ author: 'Ada', authorId: 'ada' })],
      present: [peer({ id: 'conn-7', uid: 'ada', name: 'Ada' })],
    });
    const entries = roster.value.filter((e) => e.name === 'Ada');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: 'ada', online: true, color: '#0f0' });
  });

  test('lets a live peer overwrite the offline entry whichever order they arrive in', () => {
    seed({
      ops: [comment({ author: 'Ada', authorId: 'ada' })],
      present: [peer({ id: 'conn-7', uid: 'ada', name: 'Ada', color: '#f0f' })],
    });
    expect(roster.value.find((e) => e.id === 'ada')?.color).toBe('#f0f');
  });

  test('skips a peer who has not announced a name yet', () => {
    seed({ present: [peer({ id: 'conn-1', name: '' })] });
    expect(roster.value).toHaveLength(1);
  });

  test('sorts you first, then everyone connected, then the rest by name', () => {
    seed({
      ops: [
        comment({ id: 'c1', author: 'Zed', authorId: 'zed' }),
        comment({ id: 'c2', author: 'Ada', authorId: 'ada' }),
      ],
      present: [peer({ id: 'conn-1', uid: 'mel', name: 'Mel' })],
    });
    expect(roster.value.map((e) => e.name)).toEqual([localUser.name, 'Mel', 'Ada', 'Zed']);
  });

  test('returns the same array while nobody identity actually changed', () => {
    // `operations` swaps on every stroke; re-deriving the roster there would
    // rerender the mention popover and every thread that renders a tag.
    seed({ ops: [comment({ id: 'c1', author: 'Ada', authorId: 'ada' })] });
    const first = roster.value;
    operations.value = [...operations.value, comment({ id: 'c2', author: 'Ada', authorId: 'ada' })];
    expect(roster.value).toBe(first);
  });

  test('produces a new array when someone renames', () => {
    seed({ ops: [comment({ id: 'c1', author: 'Ada', authorId: 'ada' })] });
    const first = roster.value;
    operations.value = [comment({ id: 'c1', author: 'Ada Lovelace', authorId: 'ada' })];
    expect(roster.value).not.toBe(first);
    expect(roster.value.find((e) => e.id === 'ada')?.name).toBe('Ada Lovelace');
  });
});

describe('rosterNames', () => {
  test('maps every id to its current name', () => {
    seed({ ops: [comment({ author: 'Ada', authorId: 'ada' })] });
    expect(rosterNames.value.get('ada')).toBe('Ada');
    expect(rosterNames.value.get(localUser.id)).toBe(localUser.name);
  });

  test('follows a rename, which is the point of resolving a tag by id', () => {
    // A mention stores the name it was written with; the map is what lets a tag
    // render the person's current name instead.
    seed({ ops: [comment({ id: 'c1', author: 'Ada', authorId: 'ada' })] });
    operations.value = [comment({ id: 'c1', author: 'Ada Lovelace', authorId: 'ada' })];
    expect(rosterNames.value.get('ada')).toBe('Ada Lovelace');
  });

  test('omits an id nobody in the room carries', () => {
    seed();
    expect(rosterNames.value.get('stranger')).toBeUndefined();
  });
});

describe('matchRoster', () => {
  const named = (names: string[]) =>
    seed({ ops: names.map((name, i) => comment({ id: `c${i}`, author: name, authorId: name.toLowerCase() })) });

  test('returns everyone for an empty query, you included', () => {
    named(['Ada']);
    expect(matchRoster({ query: '' }).map((e) => e.name)).toEqual([localUser.name, 'Ada']);
    expect(matchRoster({ query: '   ' })).toHaveLength(2);
  });

  test('ranks prefix matches above substring matches', () => {
    // Typing "ja" should reach Jazzy before Ninja.
    named(['Ninja', 'Jazzy']);
    expect(matchRoster({ query: 'ja' }).map((e) => e.name)).toEqual(['Jazzy', 'Ninja']);
  });

  test('is case-insensitive on both sides', () => {
    named(['Ada']);
    expect(matchRoster({ query: 'AD' }).map((e) => e.name)).toContain('Ada');
  });

  test('honours the result limit across both match tiers', () => {
    named(['Jab', 'Jam', 'Jar', 'Ninja']);
    expect(matchRoster({ query: 'ja', limit: 2 }).map((e) => e.name)).toEqual(['Jab', 'Jam']);
  });

  test('returns nothing when no name matches', () => {
    named(['Ada']);
    expect(matchRoster({ query: 'zzz' })).toEqual([]);
  });
});

describe('asMention', () => {
  test('stores the stable id alongside the name the text was written with', () => {
    expect(asMention({ id: 'ada', name: 'Ada', color: '#000', online: true, self: false })).toEqual({
      id: 'ada',
      name: 'Ada',
    });
  });
});
