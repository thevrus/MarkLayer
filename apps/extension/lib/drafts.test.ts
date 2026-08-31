import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { DrawOp } from '@marklayer/types';

/**
 * IndexedDB does not exist in the test DOM, and the store is what the debounce
 * and the restore guard are written around - so stand it in rather than skip them.
 */
const db = new Map<string, DrawOp[]>();
let getImpl: (key: string) => Promise<DrawOp[] | undefined> = async (key) => db.get(key);

mock.module('idb-keyval', () => ({
  createStore: () => ({ name: 'test-store' }),
  get: (key: string) => getImpl(key),
  set: async (key: string, value: DrawOp[]) => {
    db.set(key, value);
  },
  del: async (key: string) => {
    db.delete(key);
  },
}));

const { createDraftStore } = await import('./drafts');

const op = (id: string): DrawOp => ({
  id,
  color: '#000',
  lineWidth: 2,
  tool: 'text',
  text: id,
  x: 0,
  y: 0,
  fontSize: 14,
});

const harness = ({ initial = [] as DrawOp[], debounceMs = 5 } = {}) => {
  let ops = initial;
  const notices: string[] = [];
  const store = createDraftStore({
    key: 'ml-draft-test',
    getOps: () => ops,
    setOps: (next) => {
      ops = next;
    },
    notify: (m) => notices.push(m),
    debounceMs,
  });
  return {
    store,
    notices,
    get ops() {
      return ops;
    },
  };
};

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  db.clear();
  getImpl = async (key) => db.get(key);
});

describe('createDraftStore', () => {
  test('restores a saved draft onto an empty canvas', async () => {
    db.set('ml-draft-test', [op('a')]);
    const h = harness();
    await h.store.restore();
    expect(h.ops).toEqual([op('a')]);
    expect(h.notices).toEqual(['Draft restored']);
  });

  test('does not clobber work already on the canvas', async () => {
    // The user has drawn since the page loaded; the older draft loses.
    db.set('ml-draft-test', [op('saved')]);
    const h = harness({ initial: [op('live')] });
    await h.store.restore();
    expect(h.ops).toEqual([op('live')]);
    expect(h.notices).toEqual([]);
  });

  test('says nothing when there is no draft, or an empty one', async () => {
    const h = harness();
    await h.store.restore();
    expect(h.notices).toEqual([]);

    db.set('ml-draft-test', []);
    await h.store.restore();
    expect(h.notices).toEqual([]);
  });

  test('swallows an unavailable store rather than throwing into the caller', async () => {
    // Private browsing, or site data blocked: `restore` runs at startup, so a
    // rejection here would take the whole content script down.
    getImpl = async () => {
      throw new Error('IndexedDB disabled');
    };
    const h = harness();
    await h.store.restore();
    expect(h.ops).toEqual([]);
  });

  test('coalesces a burst of saves into one write of the latest ops', async () => {
    let ops = [op('a')];
    const store = createDraftStore({
      key: 'ml-draft-test',
      getOps: () => ops,
      setOps: () => {},
      debounceMs: 20,
    });
    store.scheduleSave();
    ops = [op('a'), op('b')];
    store.scheduleSave();
    ops = [op('a'), op('b'), op('c')];
    store.scheduleSave();

    expect(db.get('ml-draft-test')).toBeUndefined();
    await tick(40);
    // The write reads the ops at flush time, so it lands on the final state.
    expect(db.get('ml-draft-test')).toEqual(ops);
  });

  test('clears the saved draft', async () => {
    db.set('ml-draft-test', [op('a')]);
    harness().store.clear();
    await tick(5);
    expect(db.has('ml-draft-test')).toBe(false);
  });
});
