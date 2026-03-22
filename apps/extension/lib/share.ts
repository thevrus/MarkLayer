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
