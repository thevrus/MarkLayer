import { ORIGIN } from '@marklayer/brand';
import { parseShareRef, SHARE_REFS, type ShareRef, shareUrl, uploadPath, withShareRef } from '@marklayer/brand/links';
import { HOW_IT_WORKS_PATH } from '@marklayer/brand/mark';
import { postBody, postJson } from '@marklayer/types/http';
import { isBlockedHost } from '@marklayer/types/net';
import { parseOps } from '@marklayer/types/ops';
import { transcribeResponseSchema, uploadResponseSchema } from '@marklayer/types/uploads';
import { track } from './analytics';
import { host } from './host-config';
import { pageUrl } from './page-url';
import { canPushSnapshot, getRoomId } from './room-id';
import type { DrawOp } from './types';

const apiUrl = (id: string) => `${host.origin}/api/${id}`;

/** Plain-English explainer, absolute because neither the extension dialog nor the web info panel is sure to run on marklayer.app. */
export const HOW_IT_WORKS_URL = `${ORIGIN}${HOW_IT_WORKS_PATH}`;

export { parseShareRef, SHARE_REFS, type ShareRef, shareUrl, withShareRef };

/** Get share URL synchronously (generates ID if needed) */
export function getShareUrl(): string {
  return shareUrl({ origin: host.origin, kind: 'page', id: getRoomId(), ref: 'ext' });
}

/** The stdio fallback, for a client that cannot reach a remote server yet. A non-default origin needs `--api-base`. */
export function npxMcpCommand({ roomId, origin = ORIGIN }: { roomId: string; origin?: string }): string {
  const apiBase = origin === ORIGIN ? '' : ` --api-base ${origin}`;
  return `npx -y marklayer-mcp --room ${roomId}${apiBase}`;
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
    // `.localhost` resolves to this machine by spec, though no fetcher would ever be pointed at it.
    return !isBlockedHost(u.hostname) && !u.hostname.endsWith('.localhost');
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
 * Why a save failed. `view-only` is the owner having set the link so only they may
 * write (a 403), settled where a blip is not; `joined-room` is refused locally,
 * before any request, because the room's ops are not all ours to replace.
 */
export type SaveFailure = 'view-only' | 'error' | 'joined-room';
export type SaveResult = { ok: true } | { ok: false; reason: SaveFailure };

export async function saveAnnotations(ops: DrawOp[]): Promise<SaveResult> {
  // POST /api/:id replaces the room's stored ops wholesale, so a shared room is
  // refused before the push ever reaches the network.
  if (!canPushSnapshot()) return { ok: false, reason: 'joined-room' };
  const res = await postJson(apiUrl(getRoomId()), { ops, url: pageUrl(), width: window.innerWidth });
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
    const res = await fetch(apiUrl(id));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body: unknown = await res.json();
    if (typeof body !== 'object' || body === null || !('ops' in body) || !Array.isArray(body.ops)) {
      throw new Error('Unexpected response shape');
    }
    return parseOps(body.ops);
  } catch (e) {
    console.error('Error loading annotations:', e);
    return null;
  }
}

/** Uploads a screenshot (or other supported file). Returns its upload id, or null on failure; `onRefused` hears the server's no. */
export async function uploadFile(
  file: File | Blob,
  { onRefused, kind }: { onRefused?: (status: number) => void; kind?: 'video' } = {},
): Promise<string | null> {
  const path = kind ? `/f?kind=${kind}` : '/f';
  const res = await postBody(`${host.origin}${path}`, file, file.type || 'application/octet-stream');
  if (!res?.ok) {
    const reason = res ? `http_${res.status}` : 'network';
    if (res) onRefused?.(res.status);
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

/** The transcript of a stored voice note, or null when it could not be had (the note still posts). */
export async function transcribeFile(id: string): Promise<string | null> {
  const res = await postJson(`${host.origin}${uploadPath(id)}/transcribe`, {});
  if (!res?.ok) return null;
  const parsed = transcribeResponseSchema.safeParse(await res.json());
  return parsed.success ? parsed.data.text : null;
}

/** Where `uploadFile`'s id serves back from, in this browser's own origin. */
export function fileUrl(id: string): string {
  return `${host.origin}${uploadPath(id)}`;
}
