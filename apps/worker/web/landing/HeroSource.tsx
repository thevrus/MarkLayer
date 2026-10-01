import { Tabs } from '@base-ui/react/tabs';
import { cn, MAX_UPLOAD_BYTES, UPLOAD_FORMATS, UPLOAD_IMAGE_ACCEPT } from '@marklayer/types';
import { useSignal } from '@preact/signals';
import { ArrowRight, FileText, Globe, Image, type LucideIcon } from 'lucide-preact';
import { useRef } from 'preact/hooks';
import { capture } from '../analytics';
import { navigateTo, withScheme } from '../signals';
import { useHeroPin } from './useHeroPin';
import { type UploadKind, useLandingUpload } from './useLandingUpload';

type Source = 'website' | UploadKind;

const SOURCES: { id: Source; label: string }[] = [
  { id: 'website', label: 'Website' },
  { id: 'pdf', label: 'PDF' },
  { id: 'image', label: 'Image' },
];

const isSource = (v: unknown): v is Source => SOURCES.some((s) => s.id === v);

const SUGGESTIONS = [
  { name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Web_annotation' },
  { name: 'Hacker News', url: 'https://news.ycombinator.com' },
  { name: 'Product Hunt', url: 'https://www.producthunt.com/products/marklayer' },
];

const LIMIT = `up to ${MAX_UPLOAD_BYTES / 1024 / 1024}MB`;
// Read off the sniffer's table, so the hint cannot name a format the server refuses.
const IMAGE_NAMES = new Intl.ListFormat('en-GB', { type: 'disjunction' }).format(
  UPLOAD_FORMATS.filter((f) => f.contentType.startsWith('image/')).map((f) => f.extension.toUpperCase()),
);

const FILES: Record<UploadKind, { icon: LucideIcon; prompt: string; action: string; accept: string; hint: string }> = {
  pdf: {
    icon: FileText,
    prompt: 'Drop a PDF here',
    action: 'Choose PDF',
    accept: 'application/pdf',
    hint: `Any PDF ${LIMIT}`,
  },
  image: {
    icon: Image,
    prompt: 'Drop or paste an image',
    action: 'Choose image',
    accept: UPLOAD_IMAGE_ACCEPT,
    hint: `${IMAGE_NAMES}, ${LIMIT}`,
  },
};

/* The three fields share one shell, so switching never moves the hero or the pin measured off it. */
const FIELD_CLS = 'lp-panel lp-field flex w-full items-center gap-3 rounded-full py-2 pl-5 pr-2 font-ui';
const HINT_CLS = 'lp-fade-up mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-ui-lg text-ml-fg/60';
const SUGGESTION_CLS =
  '-my-3 inline-flex min-h-11 cursor-pointer items-center rounded border-none bg-transparent py-3 text-ui-lg text-ml-fg/70 underline underline-offset-2 decoration-ml-fg/30 transition-colors hover:text-ml-fg';

/** The kind a dragged file will be, when the browser says before the drop. */
function draggedKind(e: DragEvent): UploadKind | null {
  const item = e.dataTransfer?.items?.[0];
  if (item?.kind !== 'file' || !item.type) return null;
  return item.type === 'application/pdf' ? 'pdf' : item.type.startsWith('image/') ? 'image' : null;
}

/**
 * Website, PDF or image, picked from a segmented control over one field. A file dropped or pasted
 * under any segment is still taken; the field shows that file's kind while it uploads.
 */
export function HeroSource() {
  const fieldRef = useRef<HTMLDivElement>(null);
  const { fileInputRef, uploading, uploadFile } = useLandingUpload();
  const source = useSignal<Source>('website');
  const dropping = useSignal(false);
  const dragKind = useSignal<UploadKind | null>(null);
  const urlReady = useSignal(false);
  useHeroPin(fieldRef);

  const tab = uploading.value ?? dragKind.value ?? source.value;
  const choose = () => {
    if (!uploading.value) fileInputRef.current?.click();
  };

  return (
    <Tabs.Root
      value={tab}
      onValueChange={(v) => {
        if (!isSource(v) || v === source.value) return;
        source.value = v;
        capture('hero_source_selected', { source: v });
      }}
      className="contents"
    >
      <Tabs.List
        activateOnFocus
        aria-label="What to annotate"
        className="lp-fade-up relative mt-10 grid grid-cols-3 rounded-full bg-ml-fg/5 p-1"
        style={{ animationDelay: '0.15s' }}
      >
        {SOURCES.map(({ id, label }) => (
          <Tabs.Tab
            key={id}
            value={id}
            className="relative z-1 h-8 w-24 cursor-pointer rounded-full border-none bg-transparent font-ui text-ui-lg font-medium tracking-ui text-ml-fg/60 transition-colors duration-200 hover:text-ml-fg data-active:text-ml-fg"
          >
            {label}
          </Tabs.Tab>
        ))}
        <Tabs.Indicator className="lp-seg-thumb" />
      </Tabs.List>

      <div
        ref={fieldRef}
        class="lp-fade-up mt-3 w-full max-w-[560px] text-left"
        style={{ animationDelay: '0.15s' }}
        onDragOver={(e) => {
          e.preventDefault();
          dropping.value = true;
          dragKind.value = draggedKind(e);
        }}
        onDragLeave={(e) => {
          // Fires when crossing into a child too. Hit-tested, not `relatedTarget`: Safari leaves
          // that null on drag events, and each false leave would swap the panel back mid-drag.
          const r = e.currentTarget.getBoundingClientRect();
          if (e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom) return;
          dropping.value = false;
          dragKind.value = null;
        }}
        onDrop={(e) => {
          e.preventDefault();
          dropping.value = false;
          dragKind.value = null;
          const file = e.dataTransfer?.files?.[0];
          if (file) void uploadFile(file);
        }}
      >
        {/* Kept mounted so a half-typed URL survives a look at the other segments. */}
        <Tabs.Panel value="website" keepMounted tabIndex={-1}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const el = e.currentTarget.elements.namedItem('url');
              if (!(el instanceof HTMLInputElement)) return;
              const input = el.value.trim();
              if (input) navigateTo({ url: withScheme(input), source: 'hero_form' });
            }}
          >
            <div class={FIELD_CLS} data-dropping={dropping.value ? 'true' : undefined}>
              <Globe size={17} class="shrink-0 text-ml-fg/60" aria-hidden="true" />
              {/* 16px under `sm`: iOS Safari zooms the page when a focused
                  field's text is under 16px. The visible label is the
                  placeholder, so the name is carried for screen readers. */}
              <input
                name="url"
                type="text"
                inputMode="url"
                aria-label="Page URL to annotate"
                placeholder="Paste any URL to annotate…"
                autocomplete="url"
                class="h-11 flex-1 bg-transparent border-none text-ml-fg text-base sm:text-body placeholder:text-ml-fg/60 outline-none"
                onInput={(e) => {
                  const v = e.currentTarget.value.trim();
                  urlReady.value = v.length > 0 && /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}/i.test(v);
                }}
              />
              <button
                type="submit"
                aria-label="Go"
                class={cn(
                  'shrink-0 w-11 h-11 rounded-full grid place-items-center border-none cursor-pointer transition-colors duration-200',
                  urlReady.value
                    ? 'text-ml-btn-fg bg-ml-btn hover:bg-ml-btn-hover'
                    : 'text-ml-fg/60 bg-ml-fg/5 hover:bg-ml-fg/9',
                )}
              >
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          </form>
        </Tabs.Panel>

        {(['pdf', 'image'] as const).map((kind) => {
          const { icon: Icon, prompt, action } = FILES[kind];
          const busy = uploading.value === kind;
          return (
            <Tabs.Panel key={kind} value={kind} tabIndex={-1}>
              {/* One control, edge to edge: the whole field opens the picker,
                  and the pill at its end only says what clicking does. */}
              <button
                type="button"
                aria-label={busy ? 'Uploading…' : action}
                aria-describedby={`lp-hint-${kind}`}
                aria-disabled={busy || undefined}
                onClick={choose}
                class={cn(FIELD_CLS, 'group cursor-pointer border-none text-left', busy && 'cursor-progress')}
                data-dropping={dropping.value ? 'true' : undefined}
              >
                <Icon size={17} class="shrink-0 text-ml-fg/60" aria-hidden="true" />
                <span
                  class={cn(
                    'flex-1 truncate text-body transition-colors',
                    dropping.value ? 'text-ml-fg' : 'text-ml-fg/60',
                  )}
                >
                  {busy ? 'Uploading…' : dropping.value ? 'Release to open it' : prompt}
                </span>
                <span
                  class={cn(
                    'inline-flex h-11 shrink-0 items-center rounded-full bg-ml-btn px-5 text-ui-lg font-medium tracking-ui text-ml-btn-fg transition-[background-color,opacity] duration-200 group-hover:bg-ml-btn-hover',
                    busy && 'opacity-50',
                  )}
                >
                  {action}
                </span>
              </button>
            </Tabs.Panel>
          );
        })}
      </div>

      {/* One persistent row, so its entrance plays once rather than on every switch. */}
      <div class={HINT_CLS} style={{ animationDelay: '0.2s' }}>
        {tab === 'website' ? (
          <>
            <span>Or try one:</span>
            {SUGGESTIONS.map(({ name, url }) => (
              <button
                key={name}
                type="button"
                onClick={() => navigateTo({ url, source: `suggestion_${name.toLowerCase().replace(/\s+/g, '_')}` })}
                class={SUGGESTION_CLS}
              >
                {name}
              </button>
            ))}
          </>
        ) : (
          <span id={`lp-hint-${tab}`}>{FILES[tab].hint}</span>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={FILES[tab === 'image' ? 'image' : 'pdf'].accept}
        hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          // Cleared so picking the same file twice still fires.
          e.currentTarget.value = '';
          if (file) void uploadFile(file);
        }}
      />
    </Tabs.Root>
  );
}
