import { nanoid } from 'nanoid';
import type { DrawOp } from './types';

const APP_ORIGIN = 'https://marklayer.app';

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
export function getAnnotationId() {
  return currentAnnotationId;
}
export function setAnnotationId(id: string) {
  currentAnnotationId = id;
}

/** The room id every share surface addresses (generates one if needed). */
export function getRoomId(): string {
  if (!currentAnnotationId) currentAnnotationId = nanoid();
  return currentAnnotationId;
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
export function claudeMcpCommand(roomId: string): string {
  return `claude mcp add marklayer -- npx -y marklayer-mcp --room ${roomId}`;
}

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
 * Why a save failed, because the two need different words. `view-only` is the
 * owner having set the link so only they may write (the API answers 403); it is
 * a settled state no retry fixes, unlike a network blip or a 500.
 */
export type SaveFailure = 'view-only' | 'error';
export type SaveResult = { ok: true } | { ok: false; reason: SaveFailure };

/** Save ops to server. */
export async function saveAnnotations(ops: DrawOp[]): Promise<SaveResult> {
  const id = getRoomId();
  try {
    const url = window.location.href.split('#')[0];
    const width = window.innerWidth;
    const res = await fetch(`${API_BASE}${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ops, url, width }),
    });
    // Not an error worth logging: the server did answer, and it answered that
    // this link does not take writes.
    if (res.status === 403) return { ok: false, reason: 'view-only' };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ok: true };
  } catch (e) {
    console.error('Error saving annotations:', e);
    return { ok: false, reason: 'error' };
  }
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
