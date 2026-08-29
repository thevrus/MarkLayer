import { Tabs } from '@base-ui/react/tabs';
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
    <Tabs.Root
      value={idx}
      onValueChange={(value: number) => switchTo(value)}
      className={cn(
        'flex items-center gap-1 px-3 h-9 z-40 shrink-0 overflow-x-auto bg-(--ds-background-100)',
        'border-b border-(--ds-gray-alpha-400)',
        glass.font,
      )}
    >
      <span class="text-meta text-(--ds-gray-900) mr-1 shrink-0">Pages</span>
      <Tabs.List className="flex items-center gap-1">
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
                'transition-[color,background-color,box-shadow] duration-150',
                active
                  ? 'bg-(--ds-background-100) text-(--ds-gray-1000) [box-shadow:var(--ds-shadow-border-small)]'
                  : 'bg-transparent text-(--ds-gray-900) hover:text-(--ds-gray-1000) hover:bg-(--ds-gray-alpha-100)',
              )}
            >
              <Tabs.Tab
                value={i}
                className={cn(
                  'inline-flex items-center gap-1.5 h-7 pl-2.5 rounded-lg text-meta font-medium border-none cursor-pointer bg-transparent',
                  'text-inherit transition-colors duration-150',
                  canDelete ? 'pr-1' : 'pr-2.5',
                )}
                title={p.url ?? `Page ${i + 1}`}
              >
                <span class="tabular-nums text-(--ds-gray-900)">{i + 1}.</span>
                <span class="max-w-[180px] truncate">
                  {host}
                  {path && <span class="text-(--ds-gray-900)">{path}</span>}
                </span>
              </Tabs.Tab>
              {canDelete && (
                <button
                  type="button"
                  onClick={(e) => deletePage(i, e)}
                  class={cn(
                    'h-5 w-5 mr-1 rounded grid place-items-center bg-transparent border-none cursor-pointer',
                    'text-current opacity-0 group-hover:opacity-50 hover:!opacity-100 hover:bg-(--ds-gray-alpha-100)',
                    'transition-[opacity,background-color] duration-100',
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
      </Tabs.List>

      {!readonly && !adding && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          class={cn(
            'shrink-0 inline-flex items-center gap-1 h-7 px-2 rounded-lg text-meta font-medium border-none cursor-pointer',
            'bg-transparent text-(--ds-gray-900) hover:text-(--ds-gray-1000) hover:bg-(--ds-gray-alpha-100) transition-[color,background-color] duration-150',
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
            class="h-7 w-[280px] px-2.5 rounded-lg bg-(--ds-gray-alpha-100) border border-(--ds-gray-alpha-400) outline-none text-meta text-(--ds-gray-1000) placeholder:text-(--ds-gray-900) focus:border-(--ds-gray-alpha-400)"
          />
          <button
            type="submit"
            disabled={loading || !newUrl.trim()}
            class="h-7 px-2.5 rounded-lg bg-(--ds-gray-alpha-100) border-none cursor-pointer text-meta font-semibold text-(--ds-gray-1000) hover:bg-(--ds-gray-alpha-100) disabled:opacity-40 disabled:cursor-not-allowed transition-[background-color,opacity] duration-150"
          >
            {loading ? 'Adding…' : 'Add'}
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setNewUrl('');
            }}
            class="h-7 w-7 rounded-lg grid place-items-center bg-transparent border-none cursor-pointer text-(--ds-gray-900) hover:text-(--ds-gray-1000) hover:bg-(--ds-gray-alpha-100)"
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
    </Tabs.Root>
  );
}
