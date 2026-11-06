import type { Database } from 'bun:sqlite';

/** A D1 stand-in that records SQL and replays queued rows. `changes` matters because the guards are conditional UPDATEs: a fake that always succeeds would pass while the guard did nothing. */
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
  return new FakeD1({ first, queue: firstQueue ? [...firstQueue] : null, all, changes });
}

export const unsupported = (): never => {
  throw new Error('not used by these tests');
};

export function d1Meta({ changes, lastRowId = 0 }: { changes: number; lastRowId?: number }) {
  return {
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: changes,
    last_row_id: lastRowId,
    changed_db: changes > 0,
    changes,
  };
}

// The fake replays rows the test supplies; the store's T is a claim about SQL the fake does not run.
const replay = <T>(row: unknown): T => row as T;

interface Replay {
  first: unknown;
  queue: unknown[] | null;
  all: unknown[];
  changes: number;
}

class FakeStatement implements D1PreparedStatement {
  constructor(
    private readonly call: { sql: string; bindings: unknown[] },
    private readonly script: Replay,
  ) {}

  bind(...bindings: unknown[]): FakeStatement {
    this.call.bindings = bindings;
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const { queue, first } = this.script;
    return replay<T | null>(queue && queue.length > 0 ? queue.shift() : first);
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return { success: true, results: this.script.all.map((row) => replay<T>(row)), meta: d1Meta({ changes: 0 }) };
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return { success: true, results: [], meta: d1Meta({ changes: this.script.changes }) };
  }

  raw = unsupported;
}

/** Records the SQL it was handed; `calls` is what tests assert on. */
class FakeD1 implements D1Database {
  readonly calls: { sql: string; bindings: unknown[] }[] = [];
  constructor(private readonly script: Replay) {}

  prepare: D1Database['prepare'] = (sql) => {
    const call = { sql, bindings: [] };
    this.calls.push(call);
    return new FakeStatement(call, this.script);
  };

  batch = unsupported;
  exec = unsupported;
  withSession = unsupported;
  dump = unsupported;
}

type Binding = string | number | bigint | boolean | null;

const toBinding = (v: unknown): Binding =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean' ? v : null;

class SqliteStatement implements D1PreparedStatement {
  private args: Binding[] = [];
  constructor(
    private readonly sqlite: Database,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): SqliteStatement {
    this.args = values.map(toBinding);
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return this.sqlite.query<T, Binding[]>(this.sql).get(...this.args);
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const { changes, lastInsertRowid } = this.sqlite.query(this.sql).run(...this.args);
    return { success: true, results: [], meta: d1Meta({ changes, lastRowId: Number(lastInsertRowid) }) };
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const results = this.sqlite.query<T, Binding[]>(this.sql).all(...this.args);
    return { success: true, results, meta: d1Meta({ changes: 0 }) };
  }

  raw = unsupported;
}

/** D1's statement surface over bun:sqlite, for tests where the guard lives in SQL; only what the stores call is real. */
export class SqliteD1 implements D1Database {
  constructor(private readonly sqlite: Database) {}

  prepare(sql: string): SqliteStatement {
    return new SqliteStatement(this.sqlite, sql);
  }

  batch = unsupported;
  exec = unsupported;
  withSession = unsupported;
  dump = unsupported;
}
