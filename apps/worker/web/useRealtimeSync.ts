import {
  connectionStatus,
  localUser,
  onCleared,
  onCursorMove,
  onOpPushed,
  onOpUpdated,
  onProfileChange,
  onUndone,
  operations,
  peers,
  toast,
} from '@ext/lib/state';
import type { DrawOp, Peer } from '@ext/lib/types';
import { applyOpPatch } from '@marklayer/types';
import { signal } from '@preact/signals';
import { nanoid } from 'nanoid';
import { useEffect, useRef } from 'preact/hooks';
import { capture } from './analytics';
import { followingPeer, onFollowScroll, onPresentChange, presenting } from './signals';

export const connected = signal(false);
/** Unix timestamp (seconds) when the annotation was first created */
export const createdAt = signal<number | null>(null);
/** Unix timestamp (seconds) when the annotation expires (null = never) */
export const expiresAt = signal<number | null>(null);

/** Annotation metadata received from server init */
export const serverUrl = signal<string | null>(null);
export const serverWidth = signal<number | null>(null);

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
    if (
      urlsKey(a[i].urls) !== urlsKey(b[i].urls) ||
      a[i].username !== b[i].username ||
      a[i].credential !== b[i].credential
    ) {
      return false;
    }
  }
  return true;
}

export const localPeerId = nanoid();

/** Stale cursor threshold — hide cursors older than 5s */
const STALE_MS = 5000;

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

/** Active click ripples. Each entry auto-clears after the CSS animation completes. */
export interface Ripple {
  id: string;
  peerId: string;
  color: string;
  x: number;
  y: number;
}
export const activeRipples = signal<Ripple[]>([]);
/** ms — animation is 700ms and the last ring is delayed 140ms; pad slightly so
 * the trailing ring doesn't pop out mid-fade if the browser is busy. */
const RIPPLE_LIFETIME_MS = 900;

function pushRipple(r: Ripple) {
  activeRipples.value = [...activeRipples.value, r];
  setTimeout(() => {
    activeRipples.value = activeRipples.value.filter((x) => x.id !== r.id);
  }, RIPPLE_LIFETIME_MS);
}

/** Local emitter — called from the click handler. Sends to peers and renders own ripple. */
export const emitRipple = signal<((x: number, y: number) => void) | null>(null);

/** Lazily-created AudioContext for peer join/leave chimes. Browser autoplay
 * policy keeps it suspended until a user gesture; since the user is already
 * interacting with the viewer by the time peers join, resume() usually works. */
let peerChimeCtx: AudioContext | null = null;
function playPeerChime(joining: boolean) {
  try {
    if (typeof AudioContext === 'undefined') return;
    if (!peerChimeCtx) peerChimeCtx = new AudioContext();
    if (peerChimeCtx.state === 'suspended') peerChimeCtx.resume().catch(() => {});
    const t0 = peerChimeCtx.currentTime;
    const osc = peerChimeCtx.createOscillator();
    const gain = peerChimeCtx.createGain();
    osc.type = 'sine';
    // Join: rising C5 → G5. Leave: falling G5 → C5.
    const [f1, f2] = joining ? [523.25, 783.99] : [783.99, 523.25];
    osc.frequency.setValueAtTime(f1, t0);
    osc.frequency.exponentialRampToValueAtTime(f2, t0 + 0.14);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.05, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
    osc.connect(gain).connect(peerChimeCtx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.25);
  } catch {
    /* audio unavailable — ignore */
  }
}

export function useRealtimeSync(annotationId: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const pendingRef = useRef<string[]>([]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!annotationId) return;

    let destroyed = false;
    let initReceived = false;
    let followScrollTimer: ReturnType<typeof setTimeout> | null = null;

    // Debounced REST API save as fallback persistence
    function scheduleSave() {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const ops = operations.value;
        fetch(`/api/${annotationId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ops),
        }).catch(() => {});
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

    function connect() {
      if (destroyed) return;
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const params = new URLSearchParams({
        peerId: localPeerId,
        name: localUser.name,
        color: localUser.color,
      });
      connectionStatus.value = 'connecting';
      const ws = new WebSocket(`${protocol}//${location.host}/ws/${annotationId}?${params}`);
      wsRef.current = ws;

      let pingTimer: ReturnType<typeof setInterval> | null = null;
      let pongTimeout: ReturnType<typeof setTimeout> | null = null;

      ws.onopen = () => {
        connected.value = true;
        connectionStatus.value = 'connected';
        // Silent reconnects are invisible from the room's own logs — the DO sees
        // only a peer leaving and a peer joining.
        capture('realtime_connected', { attempt: retryRef.current });
        retryRef.current = 0;
        const pending = pendingRef.current;
        pendingRef.current = [];
        for (const msg of pending) {
          ws.send(msg);
        }
        // Heartbeat: ping every 15s, expect pong within 5s
        pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send('{"type":"ping"}');
            pongTimeout = setTimeout(() => {
              ws.close(); // force reconnect
            }, 5000);
          }
        }, 15000);
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          switch (msg.type) {
            case 'init': {
              if (initReceived) {
                const serverIds = new Set(msg.ops.map((o: DrawOp) => o.id));
                const localOnly = operations.value.filter((o) => !serverIds.has(o.id));
                operations.value = [...msg.ops, ...localOnly];
              } else {
                operations.value = msg.ops;
                initReceived = true;
              }
              if (msg.createdAt != null) createdAt.value = msg.createdAt;
              if (msg.expiresAt != null) expiresAt.value = msg.expiresAt;
              if (msg.url) serverUrl.value = msg.url;
              if (msg.width) serverWidth.value = msg.width;
              if (isIceServerArray(msg.iceServers)) turnIceServers.value = msg.iceServers;
              // Initialize peer list from server
              if (msg.peers) {
                const map = new Map<string, Peer>();
                for (const p of msg.peers) {
                  if (p.id !== localPeerId) {
                    map.set(p.id, { ...p, cursor: null, lastSeen: Date.now() });
                  }
                }
                peers.value = map;
              }
              break;
            }
            case 'op':
              if (!operations.value.some((o) => o.id === msg.op.id)) {
                operations.value = [...operations.value, msg.op];
              }
              break;
            case 'update_op': {
              const opId: string | undefined = msg.opId;
              const patch = msg.patch;
              if (!opId || !patch || typeof patch !== 'object') break;
              const ops = operations.value;
              const idx = ops.findIndex((o) => o.id === opId);
              if (idx === -1) break;
              const merged = applyOpPatch({ op: ops[idx], patch });
              if (!merged) break;
              const next = ops.slice();
              next[idx] = merged;
              operations.value = next;
              break;
            }
            case 'undo':
              operations.value = operations.value.filter((o) => o.id !== msg.opId);
              break;
            case 'clear':
              operations.value = [];
              break;
            case 'pong':
              if (pongTimeout) {
                clearTimeout(pongTimeout);
                pongTimeout = null;
              }
              break;
            case 'ripple': {
              pushRipple({
                id: nanoid(),
                peerId: msg.peerId,
                color: msg.color || '#8b5cf6',
                x: msg.x,
                y: msg.y,
              });
              break;
            }
            case 'cursor': {
              const prev = peers.value;
              const existing = prev.get(msg.peerId);
              const updated = existing
                ? { ...existing, cursor: { x: msg.x, y: msg.y }, tool: msg.tool, lastSeen: Date.now() }
                : {
                    id: msg.peerId,
                    name: msg.name || 'Anonymous',
                    color: msg.color || '#8b5cf6',
                    cursor: { x: msg.x, y: msg.y },
                    tool: msg.tool,
                    lastSeen: Date.now(),
                  };
              const next = new Map(prev);
              next.set(msg.peerId, updated);
              peers.value = next;
              pushCursorSample(msg.peerId, msg.x, msg.y);
              // Follow mode: throttled scroll to followed peer's Y position
              if (followingPeer.value === msg.peerId && !followScrollTimer) {
                followScrollTimer = setTimeout(() => {
                  followScrollTimer = null;
                }, 200);
                onFollowScroll.value?.(msg.y);
              }
              break;
            }
            case 'peer_join': {
              const map = new Map(peers.value);
              const p = msg.peer;
              if (p.id !== localPeerId) {
                const isNew = !map.has(p.id);
                map.set(p.id, {
                  id: p.id,
                  name: p.name,
                  color: p.color,
                  cursor: null,
                  lastSeen: Date.now(),
                });
                peers.value = map;
                if (isNew) {
                  toast(`${p.name || 'Someone'} joined`, 'info', 2500);
                  playPeerChime(true);
                }
              }
              break;
            }
            case 'flock': {
              const peer = peers.value.get(msg.peerId);
              const who = peer?.name || msg.name || 'Someone';
              if (msg.on) {
                followingPeer.value = msg.peerId;
                // Say why the page just moved, or being pulled reads as a bug.
                toast(`${who} is presenting — scroll to break away`, 'info', 4000);
              } else if (followingPeer.value === msg.peerId) {
                followingPeer.value = null;
                toast(`${who} stopped presenting`, 'info', 2500);
              }
              break;
            }
            case 'peer_leave': {
              const leaving = peers.value.get(msg.peerId);
              if (followingPeer.value === msg.peerId) followingPeer.value = null;
              const map = new Map(peers.value);
              map.delete(msg.peerId);
              peers.value = map;
              peerCursorSamples.delete(msg.peerId);
              if (leaving) {
                toast(`${leaving.name} left`, 'info', 2500);
                playPeerChime(false);
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
              onRtcMessage.value?.(msg);
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
        } catch {
          /* ignore malformed */
        }
      };

      ws.onclose = () => {
        if (pingTimer) clearInterval(pingTimer);
        if (pongTimeout) clearTimeout(pongTimeout);
        connected.value = false;
        wsRef.current = null;
        if (!destroyed) {
          connectionStatus.value = 'connecting';
          const delay = Math.min(1000 * 2 ** retryRef.current, 10000);
          retryRef.current++;
          // Only the first attempt of an outage: the backoff caps at 10s and never
          // gives up, so an event per retry is unbounded — and `realtime_connected`
          // already carries the attempt count for outages that recover.
          if (retryRef.current === 1) capture('realtime_reconnecting');
          setTimeout(connect, delay);
        } else {
          connectionStatus.value = 'disconnected';
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    // Wire up sync callbacks
    const sendMsg = (msg: unknown) => {
      const str = JSON.stringify(msg);
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(str);
      } else {
        pendingRef.current.push(str);
        scheduleSave();
      }
    };

    onOpPushed.value = (op: DrawOp) => sendMsg({ type: 'op', op });
    onOpUpdated.value = (opId: string, patch: Record<string, unknown>) => sendMsg({ type: 'update_op', opId, patch });
    onUndone.value = (opId: string) => sendMsg({ type: 'undo', opId });
    onCleared.value = () => sendMsg({ type: 'clear' });
    onProfileChange.value = (name: string, color: string) => sendMsg({ type: 'profile', name, color });
    onPresentChange.value = (on: boolean) => sendMsg({ type: 'flock', on });
    wsSend.value = sendMsg;

    // Throttled cursor sending (50 ms = 20 Hz). Visual smoothness comes from
    // the rAF interpolator in CursorLayer reading peerCursorSamples, not from
    // CSS — bumping this interval needs no transition retuning.
    let cursorTimer: ReturnType<typeof setTimeout> | null = null;
    onCursorMove.value = (x: number, y: number, tool: string) => {
      if (cursorTimer) return;
      cursorTimer = setTimeout(() => {
        cursorTimer = null;
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'cursor', x, y, tool }));
        }
      }, 50);
    };

    emitRipple.value = (x: number, y: number) => {
      // Only peers see the ripple; the clicker doesn't need their own click visualized.
      // Skip the offline queue — a click event has no value once peers have moved on.
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ripple', x, y }));
      }
    };

    return () => {
      destroyed = true;
      connectionStatus.value = null;
      onOpPushed.value = null;
      onOpUpdated.value = null;
      onUndone.value = null;
      onCleared.value = null;
      onCursorMove.value = null;
      // Presenting cannot outlive the socket that carries it. Followers are
      // released by the peer_leave this disconnect triggers on their side.
      onPresentChange.value = null;
      presenting.value = false;
      onProfileChange.value = null;
      emitRipple.value = null;
      activeRipples.value = [];
      peerCursorSamples.clear();
      wsSend.value = null;
      turnIceServers.value = null;
      clearInterval(pruneInterval);
      document.removeEventListener('visibilitychange', onVisible);
      if (cursorTimer) clearTimeout(cursorTimer);
      if (followScrollTimer) clearTimeout(followScrollTimer);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      // Drop stale handlers BEFORE close so any in-flight messages from the old
      // room don't leak into operations after the user has switched pages.
      const ws = wsRef.current;
      if (ws) {
        ws.onmessage = null;
        ws.onopen = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      }
      peers.value = new Map();
    };
  }, [annotationId]);
}
