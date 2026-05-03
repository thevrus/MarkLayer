import { operations, toast as showToast } from '@ext/lib/state';
import type { DrawOp } from '@ext/lib/types';
import { signal } from '@preact/signals';
import { nanoid } from 'nanoid';

export interface ProjectPage {
  id: string;
  url: string | null;
  width: number | null;
  /** Cached ops fetched on initial project load — used for combined export. Stale once user switches pages. */
  ops: DrawOp[];
}

export const API_BASE = '/api/';

/** Project (multi-page) state. `projectId` is null when viewing a single-page share. */
export const projectId = signal<string | null>(null);
export const projectPages = signal<ProjectPage[]>([]);
export const currentPageIdx = signal(0);
/** True while the project is loading or a page is being added. */
export const projectLoading = signal(false);

/** Single-page share state — set when on `/s/:id`. */
export const annotationId = signal('');
export const pageUrl = signal('');
export const originalWidth = signal(0);

/** Fetch a project's page list + ops. Returns null on failure. */
export async function loadProject(
  id: string,
): Promise<{ pages: ProjectPage[]; createdAt: number | null; expiresAt: number | null } | null> {
  try {
    const res = await fetch(`${API_BASE}p/${id}`);
    if (!res.ok) return null;
    const json = await res.json<{
      pages: { id: string; ops: DrawOp[]; url: string | null; width: number | null }[];
      createdAt: number | null;
      expiresAt: number | null;
    }>();
    return {
      pages: json.pages.map((p) => ({ id: p.id, url: p.url, width: p.width, ops: p.ops })),
      createdAt: json.createdAt,
      expiresAt: json.expiresAt,
    };
  } catch {
    return null;
  }
}

/** Persist a project's page-id list. */
export async function saveProject(id: string, pageIds: string[]): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}p/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageIds }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Create an empty annotation row for a URL and return its id. */
export async function createAnnotationFor(url: string): Promise<string | null> {
  const id = nanoid();
  try {
    const res = await fetch(`${API_BASE}${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ops: [], url, width: window.innerWidth }),
    });
    return res.ok ? id : null;
  } catch {
    return null;
  }
}

/**
 * Navigate to a new URL.
 * - In project mode (`/p/:id`): append a new page to the project and switch to it (no full reload).
 * - In single-share mode (`/s/:id`): convert to a project bundling the current + new page, redirect to `/p/:projectId`.
 * - On landing (no context): create a fresh `/s/:id` share for the new URL.
 */
export async function navigateTo(url: string) {
  const pid = projectId.value;
  if (pid) {
    if (projectLoading.value) return;
    projectLoading.value = true;
    const newPageId = await createAnnotationFor(url);
    if (!newPageId) {
      projectLoading.value = false;
      showToast('Failed to add page', 'error');
      return;
    }
    const pages = projectPages.value;
    const idx = currentPageIdx.value;
    // Snapshot current page's live ops back into the cached list before switching
    const snapshot = pages.map((p, j) => (j === idx ? { ...p, ops: [...operations.value] } : p));
    const next: ProjectPage[] = [...snapshot, { id: newPageId, url, width: window.innerWidth, ops: [] }];
    projectPages.value = next;
    const ok = await saveProject(
      pid,
      next.map((p) => p.id),
    );
    if (!ok) {
      projectLoading.value = false;
      showToast('Failed to save project', 'error');
      return;
    }
    currentPageIdx.value = next.length - 1;
    const navUrl = new URL(location.href);
    navUrl.searchParams.set('page', String(next.length - 1));
    history.replaceState(null, '', navUrl);
    projectLoading.value = false;
    return;
  }

  // Single-share mode: promote into a project bundling current + new
  const currentId = annotationId.value;
  const currentUrl = pageUrl.value;
  if (currentId && currentUrl) {
    projectLoading.value = true;
    // Best-effort flush of current ops so the project's first page has them on first read
    try {
      await fetch(`${API_BASE}${currentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ops: operations.value,
          url: currentUrl,
          width: originalWidth.value || window.innerWidth,
        }),
      });
    } catch {
      /* */
    }
    const newPageId = await createAnnotationFor(url);
    if (!newPageId) {
      projectLoading.value = false;
      showToast('Failed to add page', 'error');
      return;
    }
    const newProjectId = nanoid();
    const ok = await saveProject(newProjectId, [currentId, newPageId]);
    if (!ok) {
      projectLoading.value = false;
      showToast('Failed to create project', 'error');
      return;
    }
    location.href = `/p/${newProjectId}?page=1`;
    return;
  }

  // Landing fallback: fresh single-page share
  const w = window.innerWidth;
  const id = nanoid();
  await fetch(`${API_BASE}${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ops: [], url, width: w }),
  });
  location.href = `/s/${id}`;
}
