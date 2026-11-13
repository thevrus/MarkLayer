import type { AgentJoin, AgentSnapshot, AgentWatchResult } from '@marklayer/types/wire';
import type { Env } from './env';
import type { RoomNamespace, RoomStub, SaveMode } from './room-stub';
import { fakeDb, unsupported } from './test-d1';

class FakeSpan implements Span {
  isTraced = false;
  setAttribute(): this {
    return this;
  }
  setAttributes(): this {
    return this;
  }
  end(): void {}
}

/** An execution context whose `waitUntil` just drops the promise; nothing in these tests awaits background work. */
export class FakeExecutionContext implements ExecutionContext {
  waitUntil(promise: Promise<unknown>): void {
    void promise;
  }
  passThroughOnException(): void {}
  exports = {};
  props = undefined;
  tracing = { enterSpan: unsupported, startActiveSpan: unsupported, startSpan: unsupported, Span: FakeSpan };
  abort = unsupported;
}

class FakeFetcher implements Fetcher {
  fetch = unsupported;
  connect = unsupported;
}

/** `head` is the one R2 call a test scripts; the rest throw. */
export class FakeBucket implements R2Bucket {
  constructor(
    script: {
      get?: () => Promise<null>;
      head?: R2Bucket['head'];
      list?: R2Bucket['list'];
      delete?: R2Bucket['delete'];
    } = {},
  ) {
    this.get = script.get ?? unsupported;
    this.head = script.head ?? unsupported;
    this.list = script.list ?? unsupported;
    this.delete = script.delete ?? unsupported;
  }

  head: R2Bucket['head'];
  list: R2Bucket['list'];
  delete: R2Bucket['delete'];
  get: R2Bucket['get'];
  put = unsupported;
  createMultipartUpload = unsupported;
  resumeMultipartUpload = unsupported;
}

class FakeAi implements Ai {
  aiGatewayLogId = null;
  gateway = unsupported;
  aiSearch = unsupported;
  autorag = unsupported;
  run = unsupported;
  models = unsupported;
  toMarkdown = unsupported;
}

const EMPTY_SNAPSHOT: AgentSnapshot = {
  ops: [],
  url: null,
  width: null,
  createdAt: null,
  expiresAt: null,
  canEdit: true,
  cursor: 0,
};

/**
 * A room reached by RPC that records what it was told and answers an empty room.
 * `replaced` is what the REST save handed it; everything a test does not script throws.
 */
export class FakeRoomStub implements RoomStub {
  readonly replaced: { ops: unknown[]; userId: string | undefined; mode: SaveMode }[] = [];
  readonly resets: number[] = [];

  async saveOps(change: { ops: unknown[]; userId: string | undefined; mode: SaveMode }): Promise<boolean> {
    this.replaced.push(change);
    return true;
  }
  async agentTaskCommand() {
    return { ok: false, tasks: [] };
  }
  async snapshot(): Promise<AgentSnapshot> {
    return EMPTY_SNAPSHOT;
  }
  async join(): Promise<AgentJoin> {
    return { ...EMPTY_SNAPSHOT, missed: [] };
  }
  async send(): Promise<boolean> {
    return true;
  }
  async watch(): Promise<AgentWatchResult> {
    return { messages: [], cursor: 0 };
  }
  async reset(): Promise<void> {
    this.resets.push(Date.now());
  }
  async refreshAccess(): Promise<void> {}
  async revoke(): Promise<void> {}
  fetch = unsupported;
}

/** Every stub is the one `room`, so a test can read what reached it. */
export class FakeRoomNamespace implements RoomNamespace {
  readonly room = new FakeRoomStub();
  idFromName(name: string): DurableObjectId {
    return new FakeId(name);
  }
  get(): FakeRoomStub {
    return this.room;
  }
}

/** Every required binding, none of them usable; optional ones (relay, limiters, keys) are left to `over`. */
export function fakeEnv(over: Partial<Env['Bindings']> = {}): Env['Bindings'] {
  return {
    DB: fakeDb(),
    ASSETS: new FakeFetcher(),
    ANNOTATION_ROOM: new FakeRoomNamespace(),
    OG_BUCKET: new FakeBucket(),
    FILE_BUCKET: new FakeBucket(),
    AI: new FakeAi(),
    ...over,
  };
}

/** `closes` records the code of every `close()`, which the platform socket would send to the client. */
export class FakeWebSocket implements WebSocket {
  readonly sent: unknown[] = [];
  readonly closes: number[] = [];
  readyState = WebSocket.OPEN;
  url = '';
  protocol = '';
  extensions = '';
  binaryType = 'arraybuffer' as const;

  constructor(private attachment: unknown) {}

  send(message: string | Blob | ArrayBufferLike | ArrayBufferView): void {
    this.sent.push(JSON.parse(String(message)));
  }
  close(code = 1000): void {
    this.closes.push(code);
  }
  serializeAttachment(attachment: unknown): void {
    this.attachment = attachment;
  }
  deserializeAttachment(): unknown {
    return this.attachment;
  }

  bufferedAmount = 0;
  onclose = null;
  onerror = null;
  onmessage = null;
  onopen = null;
  CONNECTING = 0 as const;
  OPEN = 1 as const;
  CLOSING = 2 as const;
  CLOSED = 3 as const;

  accept = unsupported;
  addEventListener = unsupported;
  removeEventListener = unsupported;
  dispatchEvent = unsupported;
}

class FakeSqlCursor<T extends Record<string, SqlStorageValue>> implements SqlStorageCursor<T> {
  columnNames = [];
  rowsRead = 0;
  rowsWritten = 0;
  next = unsupported;
  toArray = unsupported;
  one = unsupported;
  raw = unsupported;
  [Symbol.iterator] = unsupported;
}

class FakeSqlStatement implements SqlStorageStatement {}

class FakeSql implements SqlStorage {
  databaseSize = 0;
  Cursor = FakeSqlCursor;
  Statement = FakeSqlStatement;
  exec = unsupported;
}

class FakeKv implements SyncKvStorage {
  get = unsupported;
  list = unsupported;
  put = unsupported;
  delete = unsupported;
}

class FakeFacets implements DurableObjectFacets {
  get = unsupported;
  abort = unsupported;
  delete = unsupported;
  clone = unsupported;
}

/** Named like a production id from `idFromName`; `name` undefined is what `newUniqueId` (and an old Miniflare) give. */
class FakeId implements DurableObjectId {
  constructor(readonly name: string | undefined) {}
  toString(): string {
    return 'fake-id';
  }
  equals = unsupported;
}

/** Key-value storage as a map: what the room persists across an eviction, readable by a test. */
class FakeStorage implements DurableObjectStorage {
  constructor(
    private readonly alarms: number[],
    readonly kvMap: Map<string, unknown>,
  ) {}

  async setAlarm(at: number | Date): Promise<void> {
    this.alarms.push(Number(at));
  }

  // The runtime's overloads are wider than any test needs; one key or a list of keys is what the room reads.
  get<T = unknown>(key: string, options?: DurableObjectGetOptions): Promise<T | undefined>;
  get<T = unknown>(keys: string[], options?: DurableObjectGetOptions): Promise<Map<string, T>>;
  async get(keys: string | string[]): Promise<unknown> {
    if (typeof keys === 'string') return this.kvMap.get(keys);
    const out = new Map<string, unknown>();
    for (const k of keys) if (this.kvMap.has(k)) out.set(k, this.kvMap.get(k));
    return out;
  }
  put<T>(key: string, value: T, options?: DurableObjectPutOptions): Promise<void>;
  put<T>(entries: Record<string, T>, options?: DurableObjectPutOptions): Promise<void>;
  async put(key: string | Record<string, unknown>, value?: unknown): Promise<void> {
    if (typeof key === 'string') this.kvMap.set(key, value);
    else for (const [k, v] of Object.entries(key)) this.kvMap.set(k, v);
  }
  list = unsupported;
  delete = unsupported;
  deleteAll = unsupported;
  transaction = unsupported;
  async getAlarm(): Promise<number | null> {
    return this.alarms.at(-1) ?? null;
  }
  deleteAlarm = unsupported;
  sync = unsupported;
  sql = new FakeSql();
  kv = new FakeKv();
  transactionSync = unsupported;
  getCurrentBookmark = unsupported;
  getBookmarkForTime = unsupported;
  onNextSessionRestoreBookmark = unsupported;
}

/** Hibernation surface of a Durable Object: its live sockets, their tags and the alarms it scheduled. */
export class FakeDurableObjectState implements DurableObjectState {
  readonly alarms: number[] = [];
  readonly storage: FakeStorage;
  exports = {};
  props = undefined;
  facets = new FakeFacets();
  readonly id: FakeId;

  /** `kv` shared between two states is a room evicted and re-created: what it put in storage is all it keeps. */
  constructor(
    private readonly opts: { sockets: WebSocket[]; tags: string[]; name?: string; kv?: Map<string, unknown> },
  ) {
    this.id = new FakeId(opts.name);
    this.storage = new FakeStorage(this.alarms, opts.kv ?? new Map());
  }

  waitUntil(): void {}
  setWebSocketAutoResponse(): void {}
  getWebSockets(): WebSocket[] {
    return this.opts.sockets;
  }
  getTags(): string[] {
    return this.opts.tags;
  }

  blockConcurrencyWhile = unsupported;
  acceptWebSocket = unsupported;
  getWebSocketAutoResponse = unsupported;
  getWebSocketAutoResponseTimestamp = unsupported;
  setHibernatableWebSocketEventTimeout = unsupported;
  getHibernatableWebSocketEventTimeout = unsupported;
  abort = unsupported;
}
