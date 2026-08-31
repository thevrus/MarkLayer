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
  all = [],
  changes = 1,
}: {
  first?: unknown;
  all?: unknown[];
  changes?: number;
} = {}) {
  const calls: { sql: string; bindings: unknown[] }[] = [];
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
        first: async () => first,
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
