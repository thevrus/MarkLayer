import { glass } from '@ext/lib/glass';
import { operations, toast } from '@ext/lib/state';
import { cn } from '@marklayer/types';
import { Plus, Trash2, X } from 'lucide-preact';
import { useState } from 'preact/hooks';
import {
  annotationId,
  createAnnotationFor,
  currentPageIdx,
  isReadonly,
  pageUrl,
  projectId,
  projectLoading,
  projectPages,
  saveProject,
} from './signals';

function hostnameOf(url: string | null, fallback: string): string {
  if (!url) return fallback;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return fallback;
  }
}

function pathOf(url: string | null): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    return u.pathname === '/' ? '' : u.pathname;
  } catch {
    return '';
  }
}

export function ProjectTabs() {
  const [adding, setAdding] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const pid = projectId.value;
  const pages = projectPages.value;
  const idx = currentPageIdx.value;
  const readonly = isReadonly.value;
  const loading = projectLoading.value;

  if (!pid || pages.length === 0) return null;

  const switchTo = (i: number) => {
    if (i === idx) return;
    // Snapshot current page's ops back into the cached list before switching
    const updated = pages.map((p, j) => (j === idx ? { ...p, ops: [...operations.value] } : p));
    projectPages.value = updated;
    currentPageIdx.value = i;
    const url = new URL(location.href);
    if (i === 0) url.searchParams.delete('page');
    else url.searchParams.set('page', String(i));
    history.replaceState(null, '', url);
  };

  const deletePage = async (i: number, e: Event) => {
    e.stopPropagation();
    if (pages.length <= 1) {
      toast('A project needs at least one page', 'info');
      return;
    }
    const page = pages[i];
    if (!page) return;
    const label = page.url ? hostnameOf(page.url, `Page ${i + 1}`) : `Page ${i + 1}`;
    if (!window.confirm(`Remove "${label}" from this project? Annotations on that page will be lost.`)) return;
    projectLoading.value = true;
    // Snapshot live ops back into the active page's cache before mutating the list
    const snapshot = pages.map((p, j) => (j === idx ? { ...p, ops: [...operations.value] } : p));
    const next = snapshot.filter((_, j) => j !== i);
    projectPages.value = next;
    // Pick a sensible new index: stay on the same page, or shift left if we removed the active one
    const nextIdx = i < idx ? idx - 1 : i === idx ? Math.min(idx, next.length - 1) : idx;
    if (nextIdx !== currentPageIdx.value) {
      currentPageIdx.value = nextIdx;
      const navUrl = new URL(location.href);
      if (nextIdx === 0) navUrl.searchParams.delete('page');
      else navUrl.searchParams.set('page', String(nextIdx));
      history.replaceState(null, '', navUrl);
    }
    const ok = await saveProject(
      pid,
      next.map((p) => p.id),
    );
    projectLoading.value = false;
    if (!ok) {
      toast('Failed to remove page', 'error');
      return;
    }
    toast('Page removed', 'success');
  };

  const submitAdd = async (e: Event) => {
    e.preventDefault();
    let url = newUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    projectLoading.value = true;
    const newPageId = await createAnnotationFor(url);
    if (!newPageId) {
      projectLoading.value = false;
      return;
    }
    // Persist current page's ops snapshot before switching
    const snapshot = pages.map((p, j) => (j === idx ? { ...p, ops: [...operations.value] } : p));
    const next: typeof pages = [...snapshot, { id: newPageId, url, width: window.innerWidth, ops: [] }];
    projectPages.value = next;
    const ok = await saveProject(
      pid,
      next.map((p) => p.id),
    );
    if (!ok) {
      projectLoading.value = false;
      return;
    }
    // Switch to the newly added tab
    currentPageIdx.value = next.length - 1;
    const navUrl = new URL(location.href);
    navUrl.searchParams.set('page', String(next.length - 1));
    history.replaceState(null, '', navUrl);
    setNewUrl('');
    setAdding(false);
    projectLoading.value = false;
  };

  return (
    <div
      class={cn(
        'flex items-center gap-1 px-3 h-9 z-40 shrink-0 overflow-x-auto bg-[var(--ml-glass-bg)] backdrop-blur-[80px]',
        'border-b border-ml-glass-fg/[0.06] shadow-[0_1px_3px_oklch(0_0_0/0.04)]',
        glass.font,
      )}
    >
      <span class="text-[10.5px] uppercase tracking-[0.08em] text-ml-glass-fg/60 font-bold mr-1 shrink-0">Pages</span>
      {pages.map((p, i) => {
        const active = i === idx;
        const host = hostnameOf(p.url, `Page ${i + 1}`);
        const path = pathOf(p.url);
        const canDelete = !readonly && pages.length > 1;
        return (
          <div
            key={p.id}
            class={cn(
              'group relative shrink-0 inline-flex items-center h-7 rounded-lg',
              'transition-all duration-150',
              active
                ? 'bg-ml-glass-fg/12 text-ml-glass-fg shadow-[inset_0_0.5px_0_oklch(1_0_0/0.08)]'
                : 'bg-transparent text-ml-glass-fg/65 hover:text-ml-glass-fg hover:bg-ml-glass-fg/6',
            )}
          >
            <button
              type="button"
              onClick={() => switchTo(i)}
              class={cn(
                'inline-flex items-center gap-1.5 h-7 pl-2.5 rounded-lg text-[12px] font-medium border-none cursor-pointer bg-transparent',
                'text-inherit transition-all duration-150 active:scale-[0.97]',
                canDelete ? 'pr-1' : 'pr-2.5',
              )}
              title={p.url ?? `Page ${i + 1}`}
            >
              <span class="tabular-nums opacity-70">{i + 1}.</span>
              <span class="max-w-[180px] truncate">
                {host}
                {path && <span class="opacity-70">{path}</span>}
              </span>
            </button>
            {canDelete && (
              <button
                type="button"
                onClick={(e) => deletePage(i, e)}
                class={cn(
                  'h-5 w-5 mr-1 rounded grid place-items-center bg-transparent border-none cursor-pointer',
                  'text-current opacity-0 group-hover:opacity-50 hover:!opacity-100 hover:bg-ml-glass-fg/[0.08]',
                  'transition-all duration-100',
                )}
                title="Remove this page from the project"
                disabled={loading}
              >
                <Trash2 size={11} aria-hidden="true" />
              </button>
            )}
          </div>
        );
      })}

      {!readonly && !adding && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          class={cn(
            'shrink-0 inline-flex items-center gap-1 h-7 px-2 rounded-lg text-[12px] font-medium border-none cursor-pointer',
            'bg-transparent text-ml-glass-fg/65 hover:text-ml-glass-fg hover:bg-ml-glass-fg/6 transition-[color,background-color] duration-150',
          )}
          disabled={loading}
        >
          <Plus size={13} aria-hidden="true" />
          Add page
        </button>
      )}

      {!readonly && adding && (
        <form onSubmit={submitAdd} class="shrink-0 inline-flex items-center gap-1.5 ml-1">
          <input
            name="newPageUrl"
            type="text"
            ref={(el) => el?.focus()}
            value={newUrl}
            placeholder="https://example.com/page"
            disabled={loading}
            onInput={(e) => setNewUrl(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setAdding(false);
                setNewUrl('');
              }
            }}
            class="h-7 w-[280px] px-2.5 rounded-lg bg-ml-glass-accent/[0.08] border border-ml-glass-fg/[0.1] outline-none text-[11.5px] text-ml-glass-fg/80 placeholder:text-ml-glass-fg/25 focus:border-ml-glass-fg/[0.2]"
          />
          <button
            type="submit"
            disabled={loading || !newUrl.trim()}
            class="h-7 px-2.5 rounded-lg bg-ml-glass-accent/[0.14] border-none cursor-pointer text-[11px] font-semibold text-ml-glass-fg hover:bg-ml-glass-accent/[0.2] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {loading ? 'Adding…' : 'Add'}
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setNewUrl('');
            }}
            class="h-7 w-7 rounded-lg grid place-items-center bg-transparent border-none cursor-pointer text-ml-glass-fg/35 hover:text-ml-glass-fg hover:bg-ml-glass-accent/[0.08]"
          >
            <X size={12} aria-hidden="true" />
          </button>
        </form>
      )}
      {/* Reference annotationId/pageUrl so this component re-renders when the active page changes */}
      <span class="hidden">
        {annotationId.value}
        {pageUrl.value}
      </span>
    </div>
  );
}
