/**
 * A D1 stand-in that records the SQL it was handed and replays queued rows.
 *
 * Enough to exercise the stores' parsing, expiry and conditional-write rules,
 * which is where call sites have disagreed; it deliberately does not model
 * SQLite. `changes` matters because the guards are conditional UPDATEs whose
 * whole meaning is in that number — a fake that always says "success" would
 * pass while the guard did nothing.
 */
export function fakeDb({
  first = null,
  firstQueue,
  all = [],
  changes = 1,
}: {
  first?: unknown;
  /**
   * Answers for `.first()` in call order, one request touching several tables
   * (a session lookup, then a settings read) needs a different row per call.
   * `first` answers once the queue is empty, so single-call tests need not set it.
   */
  firstQueue?: unknown[];
  all?: unknown[];
  changes?: number;
} = {}) {
  const calls: { sql: string; bindings: unknown[] }[] = [];
  const queue = firstQueue ? [...firstQueue] : null;
  const db = {
    calls,
    prepare(sql: string) {
      const call = { sql, bindings: [] as unknown[] };
      calls.push(call);
      const stmt = {
        bind(...bindings: unknown[]) {
          call.bindings = bindings;
          return stmt;
        },
        first: async () => (queue && queue.length > 0 ? queue.shift() : first),
        all: async () => ({ results: all }),
        run: async () => ({ success: true, meta: { changes } }),
      };
      return stmt;
    },
  };
  return db;
}

// biome-ignore lint/suspicious/noExplicitAny: the fake implements only the slice of D1 the stores touch.
export const asDb = (db: ReturnType<typeof fakeDb>) => db as any;
