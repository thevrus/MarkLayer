import { MAX_SHARE_ID_LENGTH, postBody, postJson, uploadPath, uploadResponseSchema } from '@marklayer/types';
import { nanoid } from 'nanoid';
import { track } from './analytics';
import type { DrawOp } from './types';

export const APP_ORIGIN = 'https://marklayer.app';

const API_BASE = `${APP_ORIGIN}/api/`;

/**
 * Plain-English explainer. The path is what the landing page links to (same
 * origin); the absolute URL is what the extension dialog and the web info panel
 * need, since neither is guaranteed to be running on marklayer.app.
 */
export const HOW_IT_WORKS_PATH = '/guides/how-marklayer-works';
export const HOW_IT_WORKS_URL = `${APP_ORIGIN}${HOW_IT_WORKS_PATH}`;

export { nanoid };

// Current annotation ID — reused across shares so multiple people edit the same canvas
let currentAnnotationId: string | null = null;
/**
 * Whether this browser JOINED the current room (`setAnnotationId`, e.g. from a
 * shared link) rather than minting it (`getRoomId`). `saveAnnotations` refuses
 * a full-snapshot push while it is true.
 *
 * Provenance is only a proxy for "someone else may have written here", and it
 * guards one side: a room this browser CREATED stays unguarded even after the
 * link is opened in the web viewer, whose ops the extension never sees — it
 * holds no socket — and therefore omits from the next snapshot, which replaces
 * the room wholesale. The honest test is whether an additive transport already
 * carries this room's ops; replace this flag with that once the extension has
 * a realtime connection.
 */
let joinedRoom = false;

export function getAnnotationId() {
  return currentAnnotationId;
}
export function setAnnotationId(id: string) {
  currentAnnotationId = id;
  joinedRoom = true;
}

/** The room id every share surface addresses (generates one if needed). */
export function getRoomId(): string {
  if (!currentAnnotationId) {
    currentAnnotationId = nanoid();
    joinedRoom = false;
  }
  return currentAnnotationId;
}

/** Whether this browser joined the current room rather than minting it. */
export function isJoinedRoom(): boolean {
  return joinedRoom;
}

/** Test-only: room identity is a module singleton, so a spec needs this to get back to a clean slate. */
export function resetRoomIdentity() {
  currentAnnotationId = null;
  joinedRoom = false;
}

/**
 * Deliberately looser than `isNewShareId`: that floor guards *minting* a room,
 * and holding a paste to it would refuse rooms created before the floor existed
 * — which still resolve server-side.
 */
const ROOM_ID = new RegExp(`^[A-Za-z0-9_-]{1,${MAX_SHARE_ID_LENGTH}}$`);

function roomIdFromUrl(value: string): string | null {
  // A pasted link often arrives without its scheme, and the bare-id path below
  // would reject it on the slash, so try both spellings before giving up.
  for (const candidate of [value, `https://${value}`]) {
    try {
      const match = /^\/s\/([^/]+)\/?$/.exec(new URL(candidate).pathname);
      if (match?.[1]) return match[1];
    } catch {
      // not a URL in this spelling — fall through
    }
  }
  return null;
}

/** A room id out of whatever someone pasted: a bare id, or a share link carrying one. */
export function parseRoomRef(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const candidate = roomIdFromUrl(trimmed) ?? trimmed;
  return ROOM_ID.test(candidate) ? candidate : null;
}

/**
 * Where a share link was made, carried on the link itself as `?ref=`.
 *
 * A link created, a viewer opened and a first mark drawn were three counters
 * with nothing joining them, so "did anyone act on what I sent" had no answer.
 * The label rides the link and the viewer stamps it on every event it reports.
 */
export const SHARE_REFS = ['web', 'ext', 'dash'] as const;
export type ShareRef = (typeof SHARE_REFS)[number];

/**
 * An allow-list, because the value arrives from the address bar: anything wider
 * lets a stranger write free text into our telemetry.
 */
export function parseShareRef(value: string | null): ShareRef | null {
  return SHARE_REFS.find((ref) => ref === value) ?? null;
}

/**
 * Params rather than string concatenation: these links already carry
 * `?readonly=1` and `?page=`, and a `readonly` silently dropped here is a
 * view-only link handed out as editable.
 */
export function withShareRef({ url, ref }: { url: string; ref: ShareRef }): string {
  const stamped = new URL(url);
  stamped.searchParams.set('ref', ref);
  return stamped.toString();
}

/**
 * The route a share link takes. Built in one place because `share()` copies this
 * string while the share popover displays it: two spellings means a field can
 * show a different link than the clipboard holds.
 */
export function shareUrl({
  origin,
  kind,
  id,
  readonly = false,
  ref,
}: {
  origin: string;
  kind: 'project' | 'page';
  id: string;
  readonly?: boolean;
  ref: ShareRef;
}): string {
  const path = kind === 'project' ? `/p/${id}` : `/s/${id}`;
  return withShareRef({ url: `${origin}${path}${readonly ? '?readonly=1' : ''}`, ref });
}

/** Get share URL synchronously (generates ID if needed) */
export function getShareUrl(): string {
  return shareUrl({ origin: APP_ORIGIN, kind: 'page', id: getRoomId(), ref: 'ext' });
}

/**
 * MCP connect commands for a room. Both the extension's ShareDialog and the web
 * viewer's info panel offer these, so they live here rather than being spelled
 * out twice — a drifted flag in one copy would hand users a command that fails.
 */
export function claudeMcpCommand(roomId: string, origin = APP_ORIGIN): string {
  return `claude mcp add --transport http marklayer ${mcpEndpoint(roomId, origin)}`;
}

/** Where the room answers MCP. The share link is the address, so there is nothing to install. */
export function mcpEndpoint(roomId: string, origin = APP_ORIGIN): string {
  return `${origin}/s/${roomId}/mcp`;
}

/** The stdio fallback, for a client that cannot reach a remote server yet. */
export function npxMcpCommand(roomId: string): string {
  return `npx -y marklayer-mcp --room ${roomId}`;
}

/**
 * Share links round-trip through marklayer.app/s/<id>, which fetches the original page
 * server-side. Localhost / private addresses / file:// pages are unreachable from there,
 * so the link would resolve to a broken viewer.
 */
export function isShareableUrl(url: string = window.location.href): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const h = u.hostname;
    if (h === 'localhost' || h === '0.0.0.0' || h === '[::1]' || h === '::1') return false;
    if (h.endsWith('.localhost') || h.endsWith('.local')) return false;
    if (/^127\.\d+\.\d+\.\d+$/.test(h)) return false;
    return true;
  } catch {
    return false;
  }
}

// Sites whose pages reliably break in the share viewer: JS frame-busters,
// origin-bound API tokens, or asset URLs tied to the original host. The
// proxy can strip X-Frame-Options/CSP but can't unwind these.
const EMBED_HOSTILE_HOSTS = [
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'instagram.com',
  'x.com',
  'twitter.com',
  'facebook.com',
];

export function isLikelyEmbedHostile(url: string = window.location.href): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return EMBED_HOSTILE_HOSTS.some((host) => h === host || h.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

/**
 * Why a save failed, because the words need to stay distinct. `view-only` is
 * the owner having set the link so only they may write (the API answers 403);
 * it is a settled state no retry fixes, unlike a network blip or a 500.
 * `joined-room` is refused locally, before any request goes out: the room's
 * ops belong to everyone in it, so this browser may not replace them wholesale.
 */
export type SaveFailure = 'view-only' | 'error' | 'joined-room';
export type SaveResult = { ok: true } | { ok: false; reason: SaveFailure };

/** Save ops to server. */
export async function saveAnnotations(ops: DrawOp[]): Promise<SaveResult> {
  // POST /api/:id replaces the room's stored ops wholesale — safe only when
  // this browser owns the room outright. A joined room has other people's
  // marks in it, so the push is refused before it ever reaches the network.
  if (joinedRoom) return { ok: false, reason: 'joined-room' };
  const id = getRoomId();
  const url = window.location.href.split('#')[0];
  const width = window.innerWidth;
  const res = await postJson(`${API_BASE}${id}`, { ops, url, width });
  if (!res) {
    console.error('Error saving annotations: network failure');
    return { ok: false, reason: 'error' };
  }
  // Not an error worth logging: the server did answer, and it answered that
  // this link does not take writes.
  if (res.status === 403) return { ok: false, reason: 'view-only' };
  if (!res.ok) {
    console.error(`Error saving annotations: HTTP ${res.status}`);
    return { ok: false, reason: 'error' };
  }
  return { ok: true };
}

export async function loadAnnotations(id: string): Promise<DrawOp[] | null> {
  try {
    const res = await fetch(`${API_BASE}${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.error('Error loading annotations:', e);
    return null;
  }
}

/** Uploads a screenshot (or other supported file) for a comment attachment. Returns its upload id, or null on failure. */
export async function uploadFile(file: File | Blob): Promise<string | null> {
  const res = await postBody(`${APP_ORIGIN}/f`, file, file.type || 'application/octet-stream');
  if (!res?.ok) {
    // Same reason values as the web app's `uploadFile`, so one funnel covers both surfaces.
    const reason = res ? `http_${res.status}` : 'network';
    console.error(`Error uploading file: ${reason}`);
    track('attachment_upload_failed', { reason });
    return null;
  }
  const parsed = uploadResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    console.error('Error uploading file: malformed response');
    track('attachment_upload_failed', { reason: 'malformed_response' });
    return null;
  }
  return parsed.data.id;
}

/** Where `uploadFile`'s id serves back from, in this browser's own origin. */
export function fileUrl(id: string): string {
  return `${APP_ORIGIN}${uploadPath(id)}`;
}

export function parseUrlHash(): { width: number; id: string } | null {
  const hash = window.location.hash;
  if (hash.startsWith('#ant=')) {
    const parts = hash.substring(5).split('=');
    const [rawWidth, id] = parts;
    if (parts.length === 2 && rawWidth !== undefined && id !== undefined) {
      const width = parseInt(rawWidth, 10);
      if (!width || width <= 0 || Number.isNaN(width)) return null;
      return { width, id };
    }
  }
  return null;
}
