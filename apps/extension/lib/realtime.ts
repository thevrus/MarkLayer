import { agentLabel, isAgentPeer } from '@marklayer/types/agents';
import { parseOps } from '@marklayer/types/ops';
import type { AgentClaim, RoomTask } from '@marklayer/types/wire';
import {
  type ExecMode,
  ROOM_ERROR_READ_ONLY,
  ROOM_LOCKED_CLOSE_CODE,
  type ServerMsg,
  SOCKET_BURST,
  SOCKET_REFILL_PER_S,
  serverMsgSchema,
} from '@marklayer/types/wire';
import { type ReadonlySignal, signal } from '@preact/signals';
import { nanoid } from 'nanoid';
import { track } from './analytics';
import { host } from './host-config';
import { FALLBACK_PEER_COLOR, localUser, onProfileChange } from './identity';
import { activeLayer, enterLayers, updateLayers } from './layers';
import { mergeOps } from './mergeOps';
import { applyChange, type OpChange, onChange, operations } from './ops';
import { clearDeparture, connectionStatus, noteDeparture, onCursorMove, peers } from './presence';
import { isJoinedRoom } from './room-id';
import { applyTeachingMessage, presentation } from './teaching';
import { toast } from './toasts';
import type { Peer } from './types';

export const agentClaims = signal<AgentClaim[]>([]);
export const roomTasks = signal<RoomTask[]>([]);
export const connected = signal(false);
export const execMode = signal<ExecMode>('pair');
/** Unix timestamp (seconds) when the annotation was first created */
export const createdAt = signal<number | null>(null);
/** Unix timestamp (seconds) when the annotation expires (null = never) */
export const expiresAt = signal<number | null>(null);
/** Whether someone has claimed this link, which exempts it from the idle window. */
export const isOwned = signal(false);

/** What the room says about our write access. Undefined until it says. */
export const canEditFromRoom = signal<boolean | undefined>(undefined);

/** Annotation metadata received from server init */
export const serverUrl = signal<string | null>(null);
export const serverWidth = signal<number | null>(null);

/** Offline-queue flush pacing, derived from the room's per-socket budget with a margin for live traffic. */
const DRAIN_BURST = SOCKET_BURST * 0.8;
const DRAIN_SLICE = SOCKET_REFILL_PER_S * 0.75;

/** Exposed so voice room can send signaling messages through the same WS */
export const wsSend = signal<((msg: unknown) => void) | null>(null);
/** Callback for incoming WebRTC signaling messages */
export const onRtcMessage = signal<((msg: { type: string; from: string; [k: string]: unknown }) => void) | null>(null);
/** ICE servers bundled into the WS init message — used by useVoiceRoom. */
export const turnIceServers = signal<RTCIceServer[] | null>(null);

function isIceServerArray(v: unknown): v is RTCIceServer[] {
  return Array.isArray(v) && v.every((s) => !!s && typeof s === 'object' && 'urls' in s);
}

function urlsKey(urls: string | string[]): string {
  return Array.isArray(urls) ? urls.join('|') : urls;
}
function iceServersEqual(a: RTCIceServer[] | null, b: RTCIceServer[]): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const serverA = a[i];
    const serverB = b[i];
    // Unreachable given the length check — narrows past `noUncheckedIndexedAccess`.
    if (!serverA || !serverB) return false;
    if (
      urlsKey(serverA.urls) !== urlsKey(serverB.urls) ||
      serverA.username !== serverB.username ||
      serverA.credential !== serverB.credential
    ) {
      return false;
    }
  }
  return true;
}

export const localPeerId = nanoid();

/** Stale cursor threshold — hide cursors older than 5s */
const STALE_MS = 5000;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * One socket frame, or null for one we cannot read. A bad TURN list is not such a
 * frame: `init` carries the room, so it costs this session voice relays, never the ops.
 */
function parseServerMsg(data: string): ServerMsg | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  const parsed = serverMsgSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  if (!isRecord(raw) || raw.type !== 'init') return null;
  const { iceServers: _dropped, ...room } = raw;
  const retried = serverMsgSchema.safeParse(room);
  return retried.success ? retried.data : null;
}

/**
 * Timestamped cursor samples used for client-side interpolation. Lives outside
 * the `peers` signal so the rAF render loop in CursorLayer reads it without
 * forcing a Preact re-render on every packet. Buffer size is small (3) — we
 * only need previous + current + a tiny lookahead margin.
 */
export interface CursorSample {
  x: number;
  y: number;
  t: number;
}

export const peerCursorSamples = new Map<string, CursorSample[]>();
function pushCursorSample(peerId: string, x: number, y: number) {
  const buf = peerCursorSamples.get(peerId) ?? [];
  buf.push({ x, y, t: performance.now() });
  if (buf.length > 3) buf.shift();
  peerCursorSamples.set(peerId, buf);
}

/** Sends the click to peers; the clicker's own ripple is not drawn. */
export const emitRipple = signal<((x: number, y: number) => void) | null>(null);

/** What the caller adds to the transport. A host with nothing to add passes none. */
export interface ConnectRoomHooks {
  /** Every frame, after the transport has applied it: how a host reacts to room facts only it understands. */
  onMessage?: (msg: ServerMsg) => void;
  /** The host holds this session read-only whatever the room says, so the room's access flips change nothing it can see. */
  forcedReadonly?: ReadonlySignal<boolean>;
  /** The room refused this session for want of its password, or a password change ended it. */
  onLocked?: () => void;
}

export interface ConnectRoomOptions {
  roomId: string;
  /** Absolute http(s) origin the WebSocket and REST fallback are built against, e.g. `https://marklayer.app`. */
  origin: string;
  hooks?: ConnectRoomHooks;
}

/** Opens the realtime WebSocket for one room and wires every signal that drives it.
 * Returns a teardown that undoes all of it; call it exactly once. */
export function connectRoom({ roomId, origin, hooks = {} }: ConnectRoomOptions): () => void {
  if (!roomId) return () => {};

  let destroyed = false;
  let initReceived = false;

  let ws: WebSocket | null = null;
  let retries = 0;
  const pending: string[] = [];
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let drainTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let pongTimeout: ReturnType<typeof setTimeout> | null = null;
  let mutationSeq = 0;
  const pendingMutations = new Map<string, { rollback?: () => void; timer: ReturnType<typeof setTimeout> }>();

  function dropQueuedMutation(opId: string) {
    for (let i = pending.length - 1; i >= 0; i--) {
      try {
        if ((JSON.parse(pending[i] ?? 'null') as { clientOpId?: string } | null)?.clientOpId === opId)
          pending.splice(i, 1);
      } catch {
        // A malformed queued frame is left for the existing socket parser to ignore.
      }
    }
  }

  function settleMutation(opId: string, rollback: boolean) {
    const entry = pendingMutations.get(opId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    pendingMutations.delete(opId);
    if (rollback) {
      dropQueuedMutation(opId);
      entry.rollback?.();
      if (entry.rollback) operations.value = [...operations.value];
      toast('连接不稳，改动没同步上', { type: 'error', duration: 5000 });
    }
    return true;
  }

  function refusalCopy(code: string) {
    if (code === 'read_only') return '当前房间为只读';
    if (code === 'layer_change_refused') return '图层操作未完成，请检查图层是否为空';
    return '房间拒绝了这次协作变更';
  }

  function invalidateMutations(notify = true) {
    if (!pendingMutations.size) return;
    // Later changes can depend on earlier ones (create an op, undo it before either is answered),
    // so unwinding has to run backwards: each rollback then sees the board as it was after the
    // one before it, which is the state it was written against.
    const entries = [...pendingMutations].reverse();
    pendingMutations.clear();
    for (const [opId, entry] of entries) {
      clearTimeout(entry.timer);
      dropQueuedMutation(opId);
      entry.rollback?.();
    }
    operations.value = [...operations.value];
    if (notify) toast('连接不稳，改动没同步上', { type: 'error', duration: 5000 });
  }

  /** Everything tied to one socket's life. A closed socket and a teardown both end here. */
  function stopSocketTimers() {
    if (pingTimer) clearInterval(pingTimer);
    if (pongTimeout) clearTimeout(pongTimeout);
    if (drainTimer) clearTimeout(drainTimer);
    pingTimer = pongTimeout = drainTimer = null;
    connected.value = false;
  }

  // The room closes a socket past its burst budget, and an offline guide drag alone
  // can queue more, so a long queue goes out in paced slices.
  function drain({ socket, budget }: { socket: WebSocket; budget: number }) {
    drainTimer = null;
    if (socket.readyState !== WebSocket.OPEN) return;
    for (const msg of pending.splice(0, budget)) socket.send(msg);
    if (pending.length > 0) drainTimer = setTimeout(() => drain({ socket, budget: DRAIN_SLICE }), 1000);
  }

  // Debounced REST API save as fallback persistence. Never for a joined room: the room
  // merges this bare array, so a stale list would bring back what the others deleted.
  // Not `canPushSnapshot`, which is false for every socket and would end the fallback
  // for the owner it exists for. Refused, the ops stay queued for the reconnect.
  function scheduleSave() {
    if (isJoinedRoom()) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const res = await fetch(`${origin}/api/${roomId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(operations.value),
      }).catch(() => null);
      if (!res?.ok && !destroyed && !connected.peek()) connectionStatus.value = 'disconnected';
    }, 3000);
  }

  // Periodically hide stale cursors (but keep peers in the map for presence)
  // Skip pruning while tab is hidden — browser throttles timers and WS messages
  // queue, so cursors would falsely appear stale. Bump lastSeen on visibility
  // restore so peers aren't immediately pruned.
  const pruneInterval = setInterval(() => {
    if (document.hidden || peers.value.size === 0) return;
    const now = Date.now();
    let changed = false;
    const next = new Map<string, Peer>();
    for (const [id, peer] of peers.value) {
      if (peer.cursor && now - peer.lastSeen > STALE_MS) {
        next.set(id, { ...peer, cursor: null });
        peerCursorSamples.delete(id);
        changed = true;
      } else {
        next.set(id, peer);
      }
    }
    if (changed) peers.value = next;
  }, 2000);
  const onVisible = () => {
    if (document.hidden || peers.value.size === 0) return;
    const now = Date.now();
    const next = new Map(peers.value);
    for (const [id, peer] of next) {
      next.set(id, { ...peer, lastSeen: now });
    }
    peers.value = next;
  };
  document.addEventListener('visibilitychange', onVisible);

  function handleMessage(msg: ServerMsg) {
    switch (msg.type) {
      case 'init': {
        // Only the first init is an arrival. A silent reconnect replays the
        // same room, and announcing it again would re-toast every mention.
        const arriving = !initReceived;
        initReceived = true;
        // Merged on arrival too, not just on reconnect: the extension always
        // carries local marks, and replacing would bin them.
        // Unread ops are dropped here, not merged: one from a newer client must not reach the renderer.
        const remote = parseOps(msg.ops);
        operations.value = mergeOps({ local: operations.value, remote });
        if (arriving) host.capabilities.fx?.arrived({ ops: remote, room: roomId });
        if (msg.createdAt != null) createdAt.value = msg.createdAt;
        if (msg.expiresAt != null) expiresAt.value = msg.expiresAt;
        if (typeof msg.owned === 'boolean') isOwned.value = msg.owned;
        if (typeof msg.canEdit === 'boolean') canEditFromRoom.value = msg.canEdit;
        execMode.value = msg.execMode ?? 'pair';
        agentClaims.value = msg.claims ?? [];
        roomTasks.value = msg.tasks ?? [];
        if (arriving) enterLayers(roomId, msg.layers ?? []);
        else updateLayers(msg.layers ?? []);
        if (msg.url) serverUrl.value = msg.url;
        if (msg.width) serverWidth.value = msg.width;
        if (isIceServerArray(msg.iceServers)) turnIceServers.value = msg.iceServers;
        if (msg.peers) {
          const map = new Map<string, Peer>();
          for (const p of msg.peers) {
            if (p.id !== localPeerId) {
              map.set(p.id, { ...p, cursor: null, lastSeen: Date.now() });
            }
          }
          peers.value = map;
          for (const id of map.keys()) clearDeparture(id);
        }
        break;
      }
      case 'op':
        if (applyChange({ type: 'op', op: msg.op }, { origin: 'remote' })) {
          host.capabilities.fx?.opReceived({ op: msg.op, room: roomId });
        }
        break;
      case 'update_op':
        applyChange({ type: 'update_op', opId: msg.opId, patch: msg.patch }, { origin: 'remote' });
        break;
      case 'undo':
        applyChange({ type: 'undo', opId: msg.opId }, { origin: 'remote' });
        break;
      case 'clear':
        applyChange({ type: 'clear' }, { origin: 'remote' });
        break;
      case 'error':
        // The room rejected an edit rather than trusting the toolbar to stay
        // hidden — a stale client, or a race with the owner flipping access.
        if (msg.code === 'collaboration_change_refused') toast('操作未完成', { type: 'info' });
        if (msg.code === 'layer_change_refused') toast('图层操作未完成，请检查图层是否为空', { type: 'info' });
        if (msg.code === ROOM_ERROR_READ_ONLY) {
          canEditFromRoom.value = false;
          toast('This link is view-only', { type: 'info' });
        }
        break;
      case 'ack':
        settleMutation(msg.opId, false);
        break;
      case 'nack': {
        const entry = pendingMutations.get(msg.opId);
        if (entry) {
          clearTimeout(entry.timer);
          pendingMutations.delete(msg.opId);
          dropQueuedMutation(msg.opId);
          entry.rollback?.();
          if (entry.rollback) operations.value = [...operations.value];
          toast(`改动未同步：${msg.reason ?? refusalCopy(msg.code)}`, { type: 'error', duration: 5000 });
        }
        break;
      }
      case 'collaboration':
        agentClaims.value = msg.claims;
        roomTasks.value = msg.tasks;
        break;
      case 'layers':
        if (updateLayers(msg.layers) > 0) toast('房间新增了图层，默认隐藏', { type: 'info' });
        break;
      case 'teach_highlight':
      case 'teach_caption':
      case 'teach_state':
      case 'teach_control':
        applyTeachingMessage(msg);
        break;
      case 'exec_mode':
        execMode.value = msg.execMode;
        break;
      case 'access': {
        // The owner flipped the link while this tab was open.
        const wasReadonly = canEditFromRoom.value === false;
        canEditFromRoom.value = msg.canEdit;
        if (msg.canEdit === wasReadonly && !hooks.forcedReadonly?.peek()) {
          toast(msg.canEdit ? 'You can edit this link again' : 'This link is now view-only', { type: 'info' });
        }
        break;
      }
      case 'pong':
        if (pongTimeout) {
          clearTimeout(pongTimeout);
          pongTimeout = null;
        }
        break;
      case 'ripple':
        host.capabilities.fx?.ripple({
          peerId: msg.peerId,
          color: msg.color || FALLBACK_PEER_COLOR,
          x: msg.x,
          y: msg.y,
        });
        break;
      case 'cursor': {
        const prev = peers.value;
        const existing = prev.get(msg.peerId);
        const updated = existing
          ? { ...existing, cursor: { x: msg.x, y: msg.y }, tool: msg.tool, lastSeen: Date.now() }
          : {
              id: msg.peerId,
              name: msg.name || 'Anonymous',
              color: msg.color || FALLBACK_PEER_COLOR,
              cursor: { x: msg.x, y: msg.y },
              tool: msg.tool,
              lastSeen: Date.now(),
            };
        const next = new Map(prev);
        next.set(msg.peerId, updated);
        peers.value = next;
        pushCursorSample(msg.peerId, msg.x, msg.y);
        break;
      }
      case 'peer_join': {
        const map = new Map(peers.value);
        const p = msg.peer;
        if (p.id !== localPeerId) {
          const isNew = !map.has(p.id);
          map.set(p.id, {
            id: p.id,
            uid: p.uid,
            name: p.name,
            color: p.color,
            cursor: null,
            lastSeen: Date.now(),
          });
          peers.value = map;
          clearDeparture(p.id);
          if (isNew) {
            host.capabilities.fx?.peerJoined(p.name);
          }
        }
        break;
      }
      case 'peer_leave': {
        const leaving = peers.value.get(msg.peerId);
        const map = new Map(peers.value);
        map.delete(msg.peerId);
        peers.value = map;
        peerCursorSamples.delete(msg.peerId);
        if (leaving) {
          noteDeparture({ id: leaving.id, name: leaving.name, color: leaving.color, leftAt: Date.now() });
          host.capabilities.fx?.peerLeft(leaving.name);
        }
        break;
      }
      case 'profile': {
        const existing = peers.value.get(msg.peerId);
        if (existing) {
          const next = new Map(peers.value);
          next.set(msg.peerId, {
            ...existing,
            name: msg.name || existing.name,
            color: msg.color || existing.color,
          });
          peers.value = next;
        }
        break;
      }
      case 'rtc_offer':
      case 'rtc_answer':
      case 'rtc_ice':
        if (typeof msg.from === 'string') onRtcMessage.value?.({ ...msg, from: msg.from });
        break;
      case 'ice_refresh':
        // Server-pushed TURN credential rotation. The voice engine's effect
        // on `turnIceServers` calls setConfiguration() on every active PC;
        // skip the write when the URL set is identical to avoid thrashing
        // during ICE flapping (one peer's restart triggers refresh-for-all).
        if (isIceServerArray(msg.iceServers) && !iceServersEqual(turnIceServers.peek(), msg.iceServers)) {
          turnIceServers.value = msg.iceServers;
        }
        break;
    }
  }

  function connect() {
    if (destroyed) return;
    const originUrl = new URL(origin);
    const protocol = originUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const params = new URLSearchParams({
      peerId: localPeerId,
      // Announced alongside the per-session peer id so peers can address each
      // other across reconnects — this is what a mention points at.
      uid: localUser.id,
      name: localUser.name,
      color: localUser.color,
    });
    connectionStatus.value = 'connecting';
    const socket = new WebSocket(`${protocol}//${originUrl.host}/ws/${roomId}?${params}`);
    ws = socket;

    socket.onopen = () => {
      connected.value = true;
      connectionStatus.value = 'connected';
      // Silent reconnects are invisible from the room's own logs — the DO sees
      // only a peer leaving and a peer joining.
      track('realtime_connected', { attempt: retries });
      retries = 0;
      drain({ socket, budget: DRAIN_BURST });
      pingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send('{"type":"ping"}');
          pongTimeout = setTimeout(() => {
            socket.close();
          }, 5000);
        }
      }, 15000);
    };

    socket.onmessage = (e) => {
      const msg = parseServerMsg(e.data);
      if (!msg) return;
      handleMessage(msg);
      hooks.onMessage?.(msg);
    };

    socket.onclose = (event) => {
      stopSocketTimers();
      invalidateMutations();
      ws = null;
      // Password-protected and this session is not (or no longer) unlocked: retrying cannot help.
      if (event.code === ROOM_LOCKED_CLOSE_CODE) {
        connectionStatus.value = 'disconnected';
        hooks.onLocked?.();
        return;
      }
      if (!destroyed) {
        connectionStatus.value = 'connecting';
        const delay = Math.min(1000 * 2 ** retries, 10000);
        retries++;
        // Only the first attempt of an outage: the backoff caps at 10s and never
        // gives up, so an event per retry is unbounded — and `realtime_connected`
        // already carries the attempt count for outages that recover.
        if (retries === 1) track('realtime_reconnecting');
        retryTimer = setTimeout(connect, delay);
      } else {
        connectionStatus.value = 'disconnected';
      }
    };

    socket.onerror = () => {
      socket.close();
    };
  }

  connect();

  const sendMsg = (msg: unknown) => {
    const str = JSON.stringify(msg);
    // While a queue drains, new messages wait behind it so the room applies them in order.
    if (ws?.readyState === WebSocket.OPEN && pending.length === 0) {
      ws.send(str);
      return;
    }
    pending.push(str);
    if (ws?.readyState !== WebSocket.OPEN) scheduleSave();
  };

  onChange.value = (change: OpChange, rollback?: () => void) => {
    const opId = nanoid();
    const timer = setTimeout(() => settleMutation(opId, true), 15000);
    pendingMutations.set(opId, { rollback, timer });
    sendMsg({ ...change, clientOpId: opId, seq: ++mutationSeq });
    const knownAgents = new Map(
      agentClaims.peek().map((claim) => [claim.agent_id, { uid: claim.agent_id, name: agentLabel(claim.agent_id) }]),
    );
    for (const peer of peers.peek().values())
      if (isAgentPeer(peer.id) && peer.uid) knownAgents.set(peer.uid, { uid: peer.uid, name: peer.name });
    const agents = [...knownAgents.values()];
    if (change.type === 'op' && 'mentions' in change.op && change.op.mentions?.length) {
      const source = change.op;
      const annotationId = source.tool === 'comment' && source.parentId ? source.parentId : source.id;
      for (const agent of agents)
        if (source.mentions?.some((mention) => mention.id === agent.uid)) {
          sendMsg({
            type: 'task_submit',
            taskId: nanoid(),
            agentId: agent.uid,
            annotationId,
            sourceId: source.id,
            layerId: activeLayer.peek(),
          });
        }
    }
    if (change.type === 'update_op' && typeof change.patch.assignee === 'string') {
      const agent = agents.find((peer) => peer.name === change.patch.assignee || peer.uid === change.patch.assignee);
      if (agent?.uid)
        sendMsg({
          type: 'task_submit',
          taskId: nanoid(),
          agentId: agent.uid,
          annotationId: change.opId,
          sourceId: change.opId,
          layerId: activeLayer.peek(),
        });
    }
  };
  onProfileChange.value = (name: string, color: string) => sendMsg({ type: 'profile', name, color });
  wsSend.value = sendMsg;

  // Throttled cursor sending (50 ms = 20 Hz). Visual smoothness comes from
  // the rAF interpolator in CursorLayer reading peerCursorSamples, not from
  // CSS — bumping this interval needs no transition retuning.
  let cursorTimer: ReturnType<typeof setTimeout> | null = null;
  onCursorMove.value = (x: number, y: number, tool: string) => {
    if (cursorTimer) return;
    cursorTimer = setTimeout(() => {
      cursorTimer = null;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'cursor', x, y, tool }));
      }
    }, 50);
  };

  emitRipple.value = (x: number, y: number) => {
    // Only peers see the ripple; the clicker doesn't need their own click visualized.
    // Skip the offline queue — a click event has no value once peers have moved on.
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ripple', x, y }));
    }
  };

  /** The one way out: every timer, listener and hook this connection set. Safe to call twice. */
  function disconnect() {
    if (destroyed) return;
    destroyed = true;
    invalidateMutations(false);
    connectionStatus.value = null;
    onChange.value = null;
    onCursorMove.value = null;
    onProfileChange.value = null;
    emitRipple.value = null;
    host.capabilities.fx?.reset();
    peerCursorSamples.clear();
    wsSend.value = null;
    execMode.value = 'pair';
    agentClaims.value = [];
    roomTasks.value = [];
    presentation.value = null;
    turnIceServers.value = null;
    clearInterval(pruneInterval);
    document.removeEventListener('visibilitychange', onVisible);
    stopSocketTimers();
    for (const timer of [cursorTimer, saveTimer, retryTimer]) {
      if (timer) clearTimeout(timer);
    }
    // Drop stale handlers BEFORE close so any in-flight messages from the old
    // room don't leak into operations after the user has switched pages.
    if (ws) {
      ws.onmessage = null;
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
    }
    peers.value = new Map();
  }

  return disconnect;
}
