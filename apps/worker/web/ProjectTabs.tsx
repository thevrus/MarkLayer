import { Tabs } from '@base-ui/react/tabs';
import { glass } from '@ext/lib/glass';
import { toast } from '@ext/lib/toasts';
import { displayHost } from '@marklayer/brand/links';
import { cn } from '@marklayer/ui/cn';
import { Plus, Trash2, X } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { capture } from './analytics';
import {
  addProjectPage,
  annotationId,
  currentPageIdx,
  pageUrl,
  projectId,
  projectLoading,
  projectPages,
  removeProjectPage,
  switchPage,
  withScheme,
} from './projects';
import { isReadonly } from './viewer-state';

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
  // Subscribe, so the tabs re-render when the active page changes.
  annotationId.value;
  pageUrl.value;
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
    switchPage(i);
    capture('project_tab_switched', { pages: pages.length });
  };

  const deletePage = async (i: number, e: Event) => {
    e.stopPropagation();
    if (pages.length <= 1) {
      toast('A project needs at least one page', { type: 'info' });
      return;
    }
    const page = pages[i];
    if (!page) return;
    const label = (page.url && displayHost(page.url)) || `Page ${i + 1}`;
    if (!window.confirm(`Remove "${label}" from this project? Annotations on that page will be lost.`)) return;
    if (!(await removeProjectPage(i))) {
      toast('Failed to remove page', { type: 'error' });
      return;
    }
    capture('project_page_removed', { pages: projectPages.value.length });
    toast('Page removed', { type: 'success' });
  };

  const submitAdd = async (e: Event) => {
    e.preventDefault();
    const typed = newUrl.trim();
    if (!typed) return;
    const added = await addProjectPage(withScheme(typed));
    if (!added) return;
    if (added === 'added') capture('project_page_added', { pages: projectPages.value.length });
    setNewUrl('');
    setAdding(false);
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
          const host = (p.url && displayHost(p.url)) || `Page ${i + 1}`;
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
    </Tabs.Root>
  );
}
