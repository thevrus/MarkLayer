import {
  localUser,
  onCleared,
  onCursorMove,
  onOpPushed,
  onProfileChange,
  onUndone,
  operations,
  peers,
} from '@ext/lib/state';
import type { DrawOp, Peer } from '@ext/lib/types';
import { signal } from '@preact/signals';
import { nanoid } from 'nanoid';
import { useEffect, useRef } from 'preact/hooks';
import { followingPeer, onFollowScroll } from './signals';

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

export const localPeerId = nanoid();

/** Stale cursor threshold — hide cursors older than 5s */
const STALE_MS = 5000;

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
      const ws = new WebSocket(`${protocol}//${location.host}/ws/${annotationId}?${params}`);
      wsRef.current = ws;

      let pingTimer: ReturnType<typeof setInterval> | null = null;
      let pongTimeout: ReturnType<typeof setTimeout> | null = null;

      ws.onopen = () => {
        connected.value = true;
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
                map.set(p.id, {
                  id: p.id,
                  name: p.name,
                  color: p.color,
                  cursor: null,
                  lastSeen: Date.now(),
                });
                peers.value = map;
              }
              break;
            }
            case 'peer_leave': {
              if (followingPeer.value === msg.peerId) followingPeer.value = null;
              const map = new Map(peers.value);
              map.delete(msg.peerId);
              peers.value = map;
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
          const delay = Math.min(1000 * 2 ** retryRef.current, 10000);
          retryRef.current++;
          setTimeout(connect, delay);
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
    onUndone.value = (opId: string) => sendMsg({ type: 'undo', opId });
    onCleared.value = () => sendMsg({ type: 'clear' });
    onProfileChange.value = (name: string, color: string) => sendMsg({ type: 'profile', name, color });
    wsSend.value = sendMsg;

    // Throttled cursor sending (50ms = 20 Hz, CSS transition smooths visually)
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

    return () => {
      destroyed = true;
      onOpPushed.value = null;
      onUndone.value = null;
      onCleared.value = null;
      onCursorMove.value = null;
      onProfileChange.value = null;
      wsSend.value = null;
      clearInterval(pruneInterval);
      document.removeEventListener('visibilitychange', onVisible);
      if (cursorTimer) clearTimeout(cursorTimer);
      if (followScrollTimer) clearTimeout(followScrollTimer);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      wsRef.current?.close();
      peers.value = new Map();
    };
  }, [annotationId]);
}
