export interface PeerInfo {
  id: string;
  name: string;
  color: string;
}

const DEFAULT_COLOR = '#8b5cf6';
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const MAX_NAME_LEN = 64;

export function sanitizeName(n: unknown, fallback = 'Anonymous'): string {
  if (typeof n !== 'string') return fallback;
  const trimmed = n.trim().slice(0, MAX_NAME_LEN);
  return trimmed || fallback;
}

export function sanitizeColor(c: unknown, fallback = DEFAULT_COLOR): string {
  return typeof c === 'string' && COLOR_RE.test(c) ? c : fallback;
}

export function isPeerInfo(v: unknown): v is PeerInfo {
  return (
    !!v &&
    typeof v === 'object' &&
    'id' in v &&
    typeof (v as { id: unknown }).id === 'string' &&
    'name' in v &&
    typeof (v as { name: unknown }).name === 'string' &&
    'color' in v &&
    typeof (v as { color: unknown }).color === 'string'
  );
}

/** MCP agents connect as peers under this prefix (apps/mcp/src/room.ts). */
export const isAgentPeer = (peerId: string) => peerId.startsWith('mcp-');
