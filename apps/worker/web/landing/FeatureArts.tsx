import { geist } from '@ext/lib/geist';
import { glass } from '@ext/lib/glass';
import { cn } from '@marklayer/types';
import { Check, Copy, Download, MessageSquare, Mic, MicOff, X } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { CursorArrow } from '../CursorArrow';
import { CursorLabel } from '../CursorLabel';

/* The seeded pin's purple, so every mark the page leaves on itself is one person's. */
const MARK = '#8b5cf6';
/* Product chrome speaks Geist, because it is the product. */
const CHROME_CLS = 'lp-panel rounded-xl font-ui text-body text-(--ds-gray-1000)';

/** The cursor palette from the fold, so the people in these demos are the people on the board. */
const PEOPLE = [
  { name: 'Alice', color: '#3b82f6' },
  { name: 'Marcus', color: '#f43f5e' },
  { name: 'Yuki', color: '#8b5cf6' },
] as const;

function Avatar({ name, color, size = 24 }: { name: string; color: string; size?: number }) {
  return (
    <span
      class="grid shrink-0 place-items-center rounded-full font-ui text-micro font-semibold text-white"
      style={{ width: size, height: size, background: color }}
      aria-hidden="true"
    >
      {name[0]}
    </span>
  );
}

/**
 * A piece of the real review, at 1:1: the Wikipedia screenshot the live demo
 * uses, cropped to the region at (x, y), with the product's chrome laid over it.
 * Pixels from the product, not a drawing of them.
 */
function PageShot({
  x,
  y,
  class: cls,
  children,
}: {
  x: number;
  y: number;
  class?: string;
  children?: ComponentChildren;
}) {
  return (
    <div class={cn('relative w-full overflow-hidden rounded-xl bg-white shadow-(--ds-shadow-border-small)', cls)}>
      <img
        src="/product-review-wikipedia.webp"
        width={1440}
        height={900}
        alt=""
        loading="lazy"
        decoding="async"
        class="absolute max-w-none"
        style={{ width: 1440, height: 900, left: -x, top: -y }}
      />
      {children}
    </div>
  );
}

/** The call as the room draws it: everyone's bubble floating over the page, the talker ringed green. */
function CallArt() {
  return (
    <PageShot x={240} y={120} class="h-[260px]">
      <div class={cn('absolute top-3 right-3 flex h-8 items-center gap-2 px-2.5', geist.surfaceSmall, glass.font)}>
        <span class="size-1.5 rounded-full bg-(--ds-green-700)" />
        <span class="text-meta font-medium text-(--ds-gray-1000) tabular-nums">3 online</span>
        <span class={cn(geist.divider, 'h-4 w-px')} />
        <Mic size={13} strokeWidth={1.75} class="text-(--ds-gray-1000)" aria-hidden="true" />
        <MicOff size={13} strokeWidth={1.75} class="text-(--ds-gray-700)" aria-hidden="true" />
      </div>
      <div class="absolute bottom-4 left-4 flex items-end gap-4" aria-hidden="true">
        {PEOPLE.map((p, i) => (
          <div key={p.name} class="relative">
            <div
              class="grid size-[72px] place-items-center rounded-full font-ui text-title font-semibold text-white"
              style={{
                background: `linear-gradient(160deg, color-mix(in srgb, ${p.color} 70%, white 30%), ${p.color})`,
                boxShadow:
                  i === 1
                    ? '0 0 0 3px #22c55e, 0 4px 14px oklch(0 0 0 / 0.25)'
                    : '0 0 0 2px rgba(255,255,255,0.9), 0 4px 14px oklch(0 0 0 / 0.2)',
              }}
            >
              {p.name[0]}
            </div>
            <span
              class="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-2 py-0.5 font-ui text-micro font-semibold text-white"
              style={{ background: p.color }}
            >
              {p.name}
            </span>
          </div>
        ))}
      </div>
    </PageShot>
  );
}

/** Follow mode as the HUD draws it: the banner at the top, Alice's cursor on the page, her colour on the frame. */
function FollowArt() {
  return (
    <PageShot x={150} y={300} class="h-[260px]">
      <span
        class="absolute inset-0 rounded-xl outline-2 outline-offset-[-2px]"
        style={{ outlineColor: PEOPLE[0].color }}
      />
      <div
        class={cn(
          'absolute top-3 left-1/2 flex h-9 -translate-x-1/2 items-center gap-2 px-3',
          geist.surfaceSmall,
          glass.font,
        )}
      >
        <span class="size-2 shrink-0 rounded-full" style={{ background: PEOPLE[0].color }} />
        <span class="text-ui font-medium text-(--ds-gray-1000)">Following Alice</span>
        <X size={14} class="ml-1 text-(--ds-gray-900)" aria-hidden="true" />
      </div>
      <div class="absolute top-[120px] left-[230px] flex flex-col items-start" aria-hidden="true">
        <CursorArrow color={PEOPLE[0].color} />
        <span class="-mt-2 ml-6">
          <CursorLabel name="Alice" color={PEOPLE[0].color} />
        </span>
      </div>
    </PageShot>
  );
}

const BOARD_COLS: {
  label: string;
  cards: { who: (typeof PEOPLE)[number]; body: string; label: string; replies?: number }[];
}[] = [
  {
    label: 'Open',
    cards: [
      { who: PEOPLE[1], body: 'Footer logo is blurry on the retina display.', label: 'Comment' },
      { who: PEOPLE[2], body: 'Pricing table wraps at tablet width.', label: 'Area', replies: 1 },
    ],
  },
  {
    label: 'In progress',
    cards: [{ who: PEOPLE[1], body: 'Can the total update when I change the quantity?', label: 'Comment', replies: 2 }],
  },
  {
    label: 'Resolved',
    cards: [
      { who: PEOPLE[0], body: 'The title should name the standard, not the practice.', label: 'Comment', replies: 1 },
    ],
  },
];

/** The board, in its own columns: one card per thread, drawn as AnnotationBoard draws it. */
function BoardArt() {
  return (
    <div class={cn('grid w-full grid-cols-3 gap-3', glass.font)} aria-hidden="true">
      {BOARD_COLS.map((col) => (
        <div key={col.label} class="min-w-0">
          <p class="m-0 mb-2 flex items-center gap-1.5 text-meta font-medium text-(--ds-gray-900)">
            {col.label}
            <span class="tabular-nums text-(--ds-gray-700)">{col.cards.length}</span>
          </p>
          <div class="flex flex-col gap-2">
            {col.cards.map((c) => (
              <article
                key={c.body}
                class="rounded-lg bg-(--ds-background-100) p-3 [box-shadow:var(--ds-shadow-border-small)]"
              >
                <div class="flex items-center gap-2">
                  <Avatar name={c.who.name} color={c.who.color} size={20} />
                  <span class="min-w-0 truncate text-meta font-medium text-(--ds-gray-1000)">{c.who.name}</span>
                  <span class="shrink-0 text-meta text-(--ds-gray-900) tabular-nums">2h ago</span>
                </div>
                <p class="m-0 mt-2 line-clamp-3 text-ui leading-body text-(--ds-gray-1000)">{c.body}</p>
                <div class="mt-2.5 flex h-4 items-center gap-3 text-meta text-(--ds-gray-900)">
                  <span class="shrink-0">{c.label}</span>
                  {c.replies && (
                    <span class="flex shrink-0 items-center gap-1 tabular-nums">
                      <MessageSquare size={11} strokeWidth={1.75} aria-hidden="true" />
                      {c.replies}
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The measure tool over the page's own search field: its size, and the gap to the button beside it. */
function MeasureArt() {
  return (
    <PageShot x={200} y={44} class="h-[220px]">
      <div class="absolute" style={{ left: 66, top: 21, width: 404, height: 32 }} aria-hidden="true">
        <span class="absolute inset-0 border border-dashed" style={{ borderColor: MARK }} />
        <span
          class="absolute -top-6 left-1/2 -translate-x-1/2 rounded-sm px-1.5 py-0.5 font-ui text-mini font-medium text-white tabular-nums"
          style={{ background: MARK }}
        >
          404 × 32
        </span>
        <span class="absolute top-1/2 -right-[2px] h-px w-[2px]" style={{ background: MARK }} />
      </div>
      <div class="absolute" style={{ left: 66, top: 60, width: 404 }} aria-hidden="true">
        <span class="absolute top-0 left-0 h-px w-full" style={{ background: MARK }} />
        <span class="absolute top-0 left-0 h-2 w-px -translate-y-1/2" style={{ background: MARK }} />
        <span class="absolute top-0 right-0 h-2 w-px -translate-y-1/2" style={{ background: MARK }} />
      </div>
      <span
        class="absolute right-0 left-0 border-t border-dashed"
        style={{ top: 116, borderColor: MARK }}
        aria-hidden="true"
      />
      <span
        class="absolute left-3 rounded-sm bg-white px-1 font-ui text-mini font-medium tabular-nums"
        style={{ top: 120, color: MARK }}
        aria-hidden="true"
      >
        y 160
      </span>
    </PageShot>
  );
}

const PAGES = [
  { host: 'shop.example', path: '' },
  { host: 'shop.example', path: '/pricing' },
  { host: 'shop.example', path: '/checkout' },
  { host: 'shop.example', path: '/account' },
];

/** A project's tab strip as ProjectTabs draws it, over the page it opened. */
function PagesArt() {
  return (
    <PageShot x={60} y={150} class="h-[240px]">
      <div
        class={cn(
          'absolute inset-x-0 top-0 flex h-9 items-center gap-1 border-b border-(--ds-gray-alpha-400) bg-(--ds-background-100) px-3',
          glass.font,
        )}
        aria-hidden="true"
      >
        <span class="mr-1 shrink-0 text-meta text-(--ds-gray-900)">Pages</span>
        {PAGES.map((p, i) => (
          <span
            key={p.path}
            class={cn(
              'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-meta font-medium',
              i === 1
                ? 'bg-(--ds-background-100) text-(--ds-gray-1000) [box-shadow:var(--ds-shadow-border-small)]'
                : 'text-(--ds-gray-900)',
            )}
          >
            <span class="text-(--ds-gray-900) tabular-nums">{i + 1}.</span>
            <span>
              {p.host}
              {p.path && <span class="text-(--ds-gray-900)">{p.path}</span>}
            </span>
          </span>
        ))}
        <span class="ml-auto shrink-0 text-meta text-(--ds-gray-900)">+46</span>
      </div>
    </PageShot>
  );
}

/** Where a comment goes next: the chat it posted to, the tracker it became a task in. */
function SendArt() {
  return (
    <div class={cn(CHROME_CLS, 'mx-auto w-full max-w-[520px] px-3.5 py-3')}>
      <p class="m-0 flex items-center gap-2 text-ui text-(--ds-gray-900)">
        <Check size={13} strokeWidth={2.5} class="text-(--ds-green-900)" aria-hidden="true" />
        Posted to <span class="font-medium text-(--ds-gray-1000)">#website-review</span>
      </p>
      <p class="m-0 mt-2 flex items-center gap-2 text-ui text-(--ds-gray-900)">
        <Check size={13} strokeWidth={2.5} class="text-(--ds-green-900)" aria-hidden="true" />
        Filed as <span class="font-mono font-medium text-(--ds-gray-1000)">WEB-214</span> in Linear
      </p>
      <div class="mt-3 flex flex-wrap gap-1.5 border-t border-(--ds-gray-alpha-200) pt-3 text-ui">
        {['Slack', 'Teams', 'Discord', 'GitHub', 'Jira', 'Trello'].map((n) => (
          <span key={n} class="rounded-md bg-(--ds-gray-alpha-100) px-2 py-0.5 text-(--ds-gray-900)">
            {n}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The review as a document: Markdown, with a suggested edit as a diff. */
function ExportArt() {
  return (
    <div class={cn(CHROME_CLS, 'mx-auto w-full max-w-[520px] px-3.5 py-3 font-mono text-ui')}>
      <p class="m-0 text-(--ds-gray-700)">## Comments (12)</p>
      <p class="m-0 mt-1.5">
        <span class="text-(--ds-gray-700)">- [x]</span> Hero: button copy
      </p>
      <p class="m-0 mt-1 pl-5">
        <span class="text-(--ds-red-700)">- Shop now</span>
      </p>
      <p class="m-0 pl-5">
        <span class="text-(--ds-green-900)">+ Shop the collection</span>
      </p>
      <p class="m-0 mt-1.5">
        <span class="text-(--ds-gray-700)">- [ ]</span> Checkout: total does not update
      </p>
      <p class="m-0 mt-1.5">
        <span class="text-(--ds-gray-700)">- [ ]</span> Footer: logo is blurry at 2x
      </p>
      <div class="mt-3 flex items-center gap-2 border-t border-(--ds-gray-alpha-200) pt-3 font-ui">
        <span class="inline-flex items-center gap-1.5 rounded-md bg-(--ds-gray-1000) px-2.5 py-1 text-ui font-medium text-white">
          <Copy size={12} aria-hidden="true" />
          Copy
        </span>
        <span class="inline-flex items-center gap-1.5 px-2 py-1 text-ui font-medium text-(--ds-gray-900)">
          <Download size={12} aria-hidden="true" />
          review.md
        </span>
      </div>
    </div>
  );
}

function Toggle({ on }: { on: boolean }) {
  return (
    <span
      class={cn(
        'relative inline-block h-5 w-8 shrink-0 rounded-full',
        on ? 'bg-(--ds-gray-1000)' : 'bg-(--ds-gray-alpha-400)',
      )}
      aria-hidden="true"
    >
      <span class={cn('absolute top-0.5 size-4 rounded-full bg-white', on ? 'left-3.5' : 'left-0.5')} />
    </span>
  );
}

/** The link's own settings: who may write, and for how long. */
function LockArt() {
  return (
    <div class={cn(CHROME_CLS, 'mx-auto w-full max-w-[520px] divide-y divide-(--ds-gray-alpha-200)')}>
      <div class="flex items-center justify-between gap-3 px-3.5 py-2.5">
        <span>View only</span>
        <Toggle on />
      </div>
      <div class="flex items-center justify-between gap-3 px-3.5 py-2.5">
        <span>Expires</span>
        <span class="text-(--ds-gray-900)">in 7 days</span>
      </div>
      <div class="flex items-center justify-between gap-3 px-3.5 py-2.5 text-ui text-(--ds-gray-700)">
        <span>Signed in as you@studio.com</span>
      </div>
      <div class="px-3.5 py-2.5">
        <p class={cn(geist.sectionLabel, 'm-0 mb-1.5')}>Your links</p>
        {[
          ['shop.example/pricing', '12 comments', 'View only'],
          ['shop.example/checkout', '4 comments', 'Expires in 7 days'],
          ['en.wikipedia.org/wiki/Web_annotation', '3 comments', ''],
        ].map(([url, n, state]) => (
          <div key={url} class="flex items-center gap-3 py-1.5 text-ui">
            <span class="min-w-0 flex-1 truncate font-mono text-meta text-(--ds-gray-1000)">{url}</span>
            <span class="shrink-0 text-meta text-(--ds-gray-900) tabular-nums">{n}</span>
            {state && <span class="shrink-0 text-meta text-(--ds-gray-700)">{state}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** One demo per feature, in the order FEATURES lists them. */
export const FEATURE_ARTS = [CallArt, FollowArt, BoardArt, MeasureArt, PagesArt, SendArt, ExportArt, LockArt] as const;
