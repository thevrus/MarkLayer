import { localUser, onCleared, onCursorMove, onOpPushed, onUndone, operations, peers } from '@ext/lib/state';
import type { DrawOp, Peer } from '@ext/lib/types';
import { signal } from '@preact/signals';
import { nanoid } from 'nanoid';
import { useEffect, useRef } from 'preact/hooks';

export const connected = signal(false);

const localPeerId = nanoid();

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

    // Periodically prune stale peer cursors
    const pruneInterval = setInterval(() => {
      if (peers.value.size === 0) return;
      const now = Date.now();
      const next = new Map(peers.value);
      let changed = false;
      for (const [id, peer] of next) {
        if (now - peer.lastSeen > STALE_MS) {
          next.delete(id);
          changed = true;
        }
      }
      if (changed) peers.value = next;
    }, 2000);

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
              const map = new Map(peers.value);
              const existing = map.get(msg.peerId);
              if (existing) {
                map.set(msg.peerId, {
                  ...existing,
                  cursor: { x: msg.x, y: msg.y },
                  tool: msg.tool,
                  lastSeen: Date.now(),
                });
              } else {
                map.set(msg.peerId, {
                  id: msg.peerId,
                  name: msg.name || 'Anonymous',
                  color: msg.color || '#8b5cf6',
                  cursor: { x: msg.x, y: msg.y },
                  tool: msg.tool,
                  lastSeen: Date.now(),
                });
              }
              peers.value = map;
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
              const map = new Map(peers.value);
              map.delete(msg.peerId);
              peers.value = map;
              break;
            }
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
      clearInterval(pruneInterval);
      if (cursorTimer) clearTimeout(cursorTimer);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      wsRef.current?.close();
      peers.value = new Map();
    };
  }, [annotationId]);
}
