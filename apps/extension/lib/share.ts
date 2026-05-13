import { nanoid } from 'nanoid';
import type { DrawOp } from './types';

const APP_ORIGIN = 'https://marklayer.app';
const API_BASE = `${APP_ORIGIN}/api/`;

export { nanoid };

// Current annotation ID — reused across shares so multiple people edit the same canvas
let currentAnnotationId: string | null = null;
export function getAnnotationId() {
  return currentAnnotationId;
}
export function setAnnotationId(id: string) {
  currentAnnotationId = id;
}

function ensureAnnotationId(): string {
  if (!currentAnnotationId) currentAnnotationId = nanoid();
  return currentAnnotationId;
}

/** Get share URL synchronously (generates ID if needed) */
export function getShareUrl(): string {
  return `${APP_ORIGIN}/s/${ensureAnnotationId()}`;
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

/** Save ops to server. Returns true on success. */
export async function saveAnnotations(ops: DrawOp[]): Promise<boolean> {
  const id = ensureAnnotationId();
  try {
    const url = window.location.href.split('#')[0];
    const width = window.innerWidth;
    const res = await fetch(`${API_BASE}${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ops, url, width }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (e) {
    console.error('Error saving annotations:', e);
    return false;
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
    if (parts.length === 2) {
      const width = parseInt(parts[0], 10);
      if (!width || width <= 0 || Number.isNaN(width)) return null;
      return { width, id: parts[1] };
    }
  }
  return null;
}
