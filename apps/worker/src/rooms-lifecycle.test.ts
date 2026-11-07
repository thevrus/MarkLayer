import { describe, expect, test } from 'bun:test';
import { sweepPageCards } from './rooms-lifecycle';
import { unsupported } from './test-d1';
import { FakeBucket } from './test-env';

class FakeObject implements R2Object {
  readonly version = '';
  readonly size = 0;
  readonly etag = '';
  readonly httpEtag = '';
  readonly checksums = { toJSON: unsupported };
  readonly storageClass = 'Standard';
  writeHttpMetadata = unsupported;
  constructor(
    readonly key: string,
    readonly uploaded: Date,
  ) {}
}

const object = (key: string, uploaded: Date) => new FakeObject(key, uploaded);

type Page = { objects: R2Object[]; cursor?: string };

/** R2's listing is a truncated/untruncated union; the last page is the one without a cursor. */
function listing(page: Page | undefined): R2Objects {
  if (!page) return { objects: [], delimitedPrefixes: [], truncated: false };
  const { objects, cursor } = page;
  return cursor === undefined
    ? { objects, delimitedPrefixes: [], truncated: false }
    : { objects, delimitedPrefixes: [], truncated: true, cursor };
}

describe('sweepPageCards', () => {
  test('deletes only cards older than the cutoff, across every listing page', async () => {
    const cutoff = new Date('2026-06-01T00:00:00Z');
    const old = new Date('2026-01-01T00:00:00Z');
    const fresh = new Date('2026-10-01T00:00:00Z');
    const pages: Page[] = [
      { objects: [object('a', old), object('b', fresh)], cursor: 'c1' },
      { objects: [object('c', old)] },
    ];
    const cursors: (string | undefined)[] = [];
    const deleted: string[][] = [];
    const bucket = new FakeBucket({
      list: async (opts) => {
        cursors.push(opts?.cursor);
        return listing(pages[cursors.length - 1]);
      },
      delete: async (keys) => void deleted.push([keys].flat()),
    });

    await sweepPageCards({ bucket, olderThan: cutoff });

    expect(cursors).toEqual([undefined, 'c1']);
    expect(deleted.flat().sort()).toEqual(['a', 'c']);
  });
});
