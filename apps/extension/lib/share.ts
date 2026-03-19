import { nanoid } from 'nanoid';
import type { DrawOp } from './types';

const API_BASE = 'https://marklayer.app/api/';

export { nanoid };

// Current annotation ID — reused across shares so multiple people edit the same canvas
let currentAnnotationId: string | null = null;
export function getAnnotationId() {
  return currentAnnotationId;
}
export function setAnnotationId(id: string) {
  currentAnnotationId = id;
}

export async function saveAnnotations(ops: DrawOp[]): Promise<string | null> {
  const id = currentAnnotationId || nanoid();
  currentAnnotationId = id;
  try {
    const res = await fetch(`${API_BASE}${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ops),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const width = window.innerWidth;
    const currentUrl = window.location.href.split('#')[0];
    const encoded = btoa(`${currentUrl}#ant=${width}=${id}`);
    return `https://marklayer.app/s/${id}?view=${encoded}`;
  } catch (e) {
    console.error('Error saving annotations:', e);
    return null;
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
      return { width: parseInt(parts[0], 10), id: parts[1] };
    }
  }
  return null;
}
