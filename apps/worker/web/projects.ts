import { operations } from '@ext/lib/ops';
import { pageErrors } from '@ext/lib/page-errors';
import { peers } from '@ext/lib/presence';
import { uploadFile } from '@ext/lib/share';
import { toast as showToast } from '@ext/lib/toasts';
import type { DrawOp } from '@ext/lib/types';
import { uploadPath } from '@marklayer/brand/links';
import { postBody, postJson } from '@marklayer/types/http';
import { transcribeResponseSchema } from '@marklayer/types/uploads';
import { batch, signal } from '@preact/signals';
import { nanoid } from 'nanoid';
import { unwrapSafeLink } from '../shared/safe-link';
import { capture } from './analytics';
import { findPageIndex, normalizePageUrl } from './pageMatch';
import { iframeScrollY } from './viewer-state';

export type UploadKind = 'pdf' | 'image';

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
async function loadProject(
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

async function saveProject(id: string, pageIds: string[]): Promise<boolean> {
  const res = await postJson(`${API_BASE}p/${id}`, { pageIds });
  return res?.ok ?? false;
}

/** Recorded camera and screen clips; `kind=video` keeps the server from storing them as audio. */
export const uploadVideo = (file: File | Blob): Promise<string | null> => uploadFile(file, { kind: 'video' });

/** A video note's transcript, cut from the audio track recorded beside it, which goes up in the call itself. */
export async function transcribeVideo({ id, audio }: { id: string; audio: Blob }): Promise<string | null> {
  const res = await postBody(`${uploadPath(id)}/transcribe`, audio, audio.type || 'application/octet-stream');
  if (!res?.ok) return null;
  const parsed = transcribeResponseSchema.safeParse(await res.json());
  return parsed.success ? parsed.data.text : null;
}

/** Writes a room's row. The one place that names what a row is made of. */
export async function saveRoom({
  id,
  ops,
  url,
  width,
}: {
  id: string;
  ops: DrawOp[];
  url: string;
  width: number;
}): Promise<boolean> {
  const res = await postJson(`${API_BASE}${id}`, { ops, url, width });
  return res?.ok ?? false;
}

async function createAnnotationFor(url: string): Promise<string | null> {
  const id = nanoid();
  return (await saveRoom({ id, ops: [], url, width: window.innerWidth })) ? id : null;
}

/** A typed address as a fetchable URL: `example.com` means https, and an Outlook Safe Link means its target. */
export const withScheme = (url: string): string => unwrapSafeLink(/^https?:\/\//i.test(url) ? url : `https://${url}`);

/** The page list with the open page's cached ops brought up to date, before leaving it or rewriting the list. */
const pagesWithLiveOps = () =>
  projectPages.value.map((p, j) => (j === currentPageIdx.value ? { ...p, ops: [...operations.value] } : p));

/**
 * The one transition onto a project page: everything that belongs to the page on
 * screen moves here together. Cached ops are copied so later mutations on either
 * page can't bleed across. Render state follows `pageUrl` in `useRenderOutcome`.
 */
function activatePage(i: number) {
  const page = projectPages.value[i];
  if (!page) return;
  batch(() => {
    currentPageIdx.value = i;
    if (annotationId.value === page.id) return;
    annotationId.value = page.id;
    pageUrl.value = page.url ?? '';
    originalWidth.value = page.width ?? 0;
    operations.value = [...page.ops];
    iframeScrollY.value = 0;
    peers.value = new Map();
    // Only a proxied HTML page ever reports again, so an upload would keep the last page's errors.
    pageErrors.value = [];
  });
  const url = new URL(location.href);
  if (i === 0) url.searchParams.delete('page');
  else url.searchParams.set('page', String(i));
  history.replaceState(null, '', url);
}

/** Show another page of the open project, keeping the live ops of the one being left. */
export function switchPage(i: number) {
  if (i === currentPageIdx.value) return;
  projectPages.value = pagesWithLiveOps();
  activatePage(i);
}

/** Load `/p/:id` and show the page its URL selected. */
export async function openProject(pid: string) {
  projectLoading.value = true;
  const data = await loadProject(pid);
  projectLoading.value = false;
  if (!data) {
    showToast('Project not found or expired', { type: 'error', duration: 4000 });
    return;
  }
  projectPages.value = data.pages;
  activatePage(Math.max(0, Math.min(currentPageIdx.value, data.pages.length - 1)));
}

/** Drop a page from the open project, staying on the same page or shifting left when it was the active one. */
export async function removeProjectPage(i: number): Promise<boolean> {
  const pid = projectId.value;
  if (!pid) return false;
  const idx = currentPageIdx.value;
  projectLoading.value = true;
  const next = pagesWithLiveOps().filter((_, j) => j !== i);
  projectPages.value = next;
  activatePage(i < idx ? idx - 1 : i === idx ? Math.min(idx, next.length - 1) : idx);
  const ok = await saveProject(
    pid,
    next.map((p) => p.id),
  );
  projectLoading.value = false;
  return ok;
}

/** Append `url` to the open project and show it, or show the page that already has it. Null on failure. */
export async function addProjectPage(url: string): Promise<'added' | 'existing' | null> {
  const pid = projectId.value;
  if (!pid || projectLoading.value) return null;
  // The same page twice would split its annotations across two rooms.
  const existing = findPageIndex({ pages: projectPages.value, url });
  if (existing !== -1) {
    switchPage(existing);
    return 'existing';
  }
  projectLoading.value = true;
  const newPageId = await createAnnotationFor(url);
  if (!newPageId) {
    projectLoading.value = false;
    capture('page_open_failed', { mode: 'project_page', step: 'create_page' });
    showToast('Failed to add page', { type: 'error' });
    return null;
  }
  const next: ProjectPage[] = [...pagesWithLiveOps(), { id: newPageId, url, width: window.innerWidth, ops: [] }];
  projectPages.value = next;
  const ok = await saveProject(
    pid,
    next.map((p) => p.id),
  );
  projectLoading.value = false;
  if (!ok) {
    capture('page_open_failed', { mode: 'project_page', step: 'save_project' });
    showToast('Failed to save project', { type: 'error' });
    return null;
  }
  switchPage(next.length - 1);
  return 'added';
}

/**
 * Navigate to a new URL.
 * - In project mode (`/p/:id`): append a new page to the project and switch to it (no full reload).
 * - In single-share mode (`/s/:id`): convert to a project bundling the current + new page, redirect to `/p/:projectId`.
 * - On landing (no context): create a fresh `/s/:id` share for the new URL.
 */
export async function navigateTo({
  url,
  source = 'viewer',
  kind,
}: {
  url: string;
  source?: string;
  kind?: UploadKind;
}) {
  const pid = projectId.value;
  const currentUrl = pageUrl.value;
  if (!pid && currentUrl && normalizePageUrl(currentUrl) === normalizePageUrl(url)) {
    showToast('That page is already open', { type: 'info' });
    return;
  }
  // Which of the three shapes a session takes — a first page, a second page that
  // promotes a share into a project, another page on an existing project — and
  // what asked for it. Counted here because this is where every entry point lands.
  capture('page_opened', { mode: pid ? 'project_page' : annotationId.value ? 'promoted' : 'new', source, kind });
  if (pid) {
    await addProjectPage(url);
    return;
  }

  // Single-share mode: promote into a project bundling current + new
  const currentId = annotationId.value;
  if (currentId && currentUrl) {
    projectLoading.value = true;
    // Best-effort flush of current ops so the project's first page has them on first read
    await saveRoom({
      id: currentId,
      ops: operations.value,
      url: currentUrl,
      width: originalWidth.value || window.innerWidth,
    });
    const newPageId = await createAnnotationFor(url);
    if (!newPageId) {
      projectLoading.value = false;
      capture('page_open_failed', { mode: 'promoted', step: 'create_page' });
      showToast('Failed to add page', { type: 'error' });
      return;
    }
    const newProjectId = nanoid();
    const ok = await saveProject(newProjectId, [currentId, newPageId]);
    if (!ok) {
      projectLoading.value = false;
      capture('page_open_failed', { mode: 'promoted', step: 'save_project' });
      showToast('Failed to create project', { type: 'error' });
      return;
    }
    location.href = `/p/${newProjectId}?page=1`;
    return;
  }

  // Landing fallback: fresh single-page share
  const id = nanoid();
  if (!(await saveRoom({ id, ops: [], url, width: window.innerWidth }))) {
    // Instrumented like the other two modes, so a drop at the top of the funnel
    // is a number rather than a mystery. The redirect still runs: the viewer
    // re-creates the row on save, and stranding someone on the landing page is worse.
    capture('page_open_failed', { mode: 'new', step: 'create_page' });
  }
  location.href = `/s/${id}`;
}
