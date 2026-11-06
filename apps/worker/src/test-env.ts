import type { AnnotationRoom } from './annotation-room';
import type { Env } from './index';
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
  restore = unsupported;
  mapVirtualHost = unsupported;
  tracing = { enterSpan: unsupported, startActiveSpan: unsupported, startSpan: unsupported, Span: FakeSpan };
  abort = unsupported;
}

class FakeFetcher implements Fetcher {
  fetch = unsupported;
  connect = unsupported;
  queue = unsupported;
  scheduled = unsupported;
}

class FakeBucket implements R2Bucket {
  head = unsupported;
  get = unsupported;
  put = unsupported;
  createMultipartUpload = unsupported;
  resumeMultipartUpload = unsupported;
  delete = unsupported;
  list = unsupported;
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

class FakeRoomNamespace implements DurableObjectNamespace<AnnotationRoom> {
  newUniqueId = unsupported;
  idFromName = unsupported;
  idFromString = unsupported;
  get = unsupported;
  getByName = unsupported;
  getExisting = unsupported;
  jurisdiction = unsupported;
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

/** Unlike the platform socket, `close` is a property so a test can swap in one that records the code. */
export class FakeWebSocket implements WebSocket {
  readonly sent: unknown[] = [];
  readyState = WebSocket.OPEN;
  url = '';
  protocol = '';
  extensions = '';
  binaryType = 'arraybuffer' as const;

  constructor(private attachment: unknown) {}

  send(message: string | Blob | ArrayBufferLike | ArrayBufferView): void {
    this.sent.push(JSON.parse(String(message)));
  }
  close(): void {}
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

class FakeId implements DurableObjectId {
  toString(): string {
    return 'fake-id';
  }
  equals = unsupported;
}

class FakeStorage implements DurableObjectStorage {
  constructor(private readonly alarms: number[]) {}

  async setAlarm(at: number | Date): Promise<void> {
    this.alarms.push(Number(at));
  }

  get = unsupported;
  list = unsupported;
  put = unsupported;
  delete = unsupported;
  deleteAll = unsupported;
  transaction = unsupported;
  getAlarm = unsupported;
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
  readonly storage = new FakeStorage(this.alarms);
  exports = {};
  props = undefined;
  facets = new FakeFacets();

  constructor(private readonly opts: { sockets: WebSocket[]; tags: string[] }) {}

  waitUntil(): void {}
  setWebSocketAutoResponse(): void {}
  getWebSockets(): WebSocket[] {
    return this.opts.sockets;
  }
  getTags(): string[] {
    return this.opts.tags;
  }

  restore = unsupported;
  id = new FakeId();
  blockConcurrencyWhile = unsupported;
  acceptWebSocket = unsupported;
  getWebSocketAutoResponse = unsupported;
  getWebSocketAutoResponseTimestamp = unsupported;
  setHibernatableWebSocketEventTimeout = unsupported;
  getHibernatableWebSocketEventTimeout = unsupported;
  abort = unsupported;
  configureReadReplication = unsupported;
}
