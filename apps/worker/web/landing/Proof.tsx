import { ThreadDisc, ThreadHeader } from '@ext/components/ThreadCard';
import { geist } from '@ext/lib/geist';
import { glass } from '@ext/lib/glass';
import { getCommentMeta } from '@ext/lib/state';
import { timeAgo } from '@ext/lib/time';
import type { CommentOp } from '@ext/lib/types';
import { cn, DEMO_ROOM } from '@marklayer/types';
import { Check } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { CopyControl, DEVICE_ICONS, DEVICE_LABELS } from '../shared';

/* The seeded pin's purple, so every mark the page leaves on itself is one person's. */
const MARK = '#8b5cf6';

/* A card is a white object drawn on the white page by its ring: a stage on top
   showing a piece of the product, and under it the claim, one step below the
   section head so it never rivals it, with at most one line of support.
   Artifacts speak Geist, because they are the product. */
const CARD_CLS = 'lp-card relative flex flex-col overflow-hidden px-7 pt-7 sm:px-8 sm:pt-8';
/* The stage takes a fixed height per row and the caption the rest, so every
   title in a row starts on the same line however long its neighbour's copy runs. */
/* The demo takes the rest of the card and reaches its bottom edge: a tall one is cut there, as a photo is cropped. */
const ART_CLS = 'lp-card-art relative mt-8 flex shrink-0 flex-col justify-center pb-7 sm:pb-8';
const TEXT_CLS = 'min-h-[4.25rem]';
const TITLE_CLS = 'm-0 font-ui text-title font-semibold tracking-ui text-ml-fg text-balance';
const DESC_CLS = 'm-0 mt-2 text-lede leading-prose text-ml-fg/55 text-pretty';
const CHROME_CLS = 'font-ui text-ui-lg text-(--ds-gray-1000)';
/* The viewer's thread card shell without its floating shadow: on the card's
   field, resting on a surface, the bloom it casts over a page read as a smear. */
const demoCard = 'rounded-xl bg-(--ds-background-100) shadow-(--ds-shadow-border-small)';

/**
 * A note left in the margin with the pen and text tools: a stroked arrow and a
 * label in the mark's colour. The page is a board, so its asides are marks on
 * it rather than typeset copy. Decorative: the heading beside it says it all.
 */
export function MarginNote({
  children,
  class: extra,
  flip,
}: {
  children: ComponentChildren;
  class?: string;
  flip?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      class={cn('pointer-events-none absolute hidden select-none lg:flex', flip ? 'flex-row-reverse' : '', extra)}
      style={{ color: MARK }}
    >
      <span class="font-ui text-ui-lg font-medium whitespace-nowrap">{children}</span>
      <svg
        role="presentation"
        width="44"
        height="52"
        viewBox="0 0 44 52"
        fill="none"
        class={cn('mt-3 shrink-0', flip ? 'mr-1 -scale-x-100' : 'ml-1')}
      >
        <path
          d="M4 2c14 6 24 20 22 44M14 36l12 11 9-13"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>
  );
}

/** The white card. */
export function Card({ class: extra, children }: { class?: string; children: ComponentChildren }) {
  return <div class={cn(CARD_CLS, extra)}>{children}</div>;
}

/** The grey stage inside a card, where the product is shown. */
export function Art({ class: extra, children }: { class?: string; children: ComponentChildren }) {
  return (
    <div class={cn(ART_CLS, extra)} aria-hidden="true">
      {children}
    </div>
  );
}

/** The claim under the stage. */
export function Caption({ title, children }: { title: ComponentChildren; children?: ComponentChildren }) {
  return (
    <div class={TEXT_CLS}>
      <h3 class={TITLE_CLS}>{title}</h3>
      {children && <p class={DESC_CLS}>{children}</p>}
    </div>
  );
}

/** A thread as the viewer draws one: the product's own card, header and reply, with a mock op behind it. */
const THREAD_TS = Date.now() - 3 * 60_000;
const REPLY: CommentOp = {
  id: 'lp-proof-reply',
  tool: 'comment',
  num: 1,
  text: 'Done. Changed it to “Web annotation standard” and pushed.',
  x: 0,
  y: 0,
  ts: THREAD_TS + 2 * 60_000,
  color: '#3b82f6',
  lineWidth: 2,
  author: 'Alice',
  parentId: 'lp-proof-thread',
};

function ThreadArt() {
  return (
    <div class={cn(demoCard, 'w-full max-w-[320px]', glass.font)}>
      <ThreadHeader label="1" color="#f43f5e" author="Marcus" ts={THREAD_TS} priority="high" />
      <p class="m-0 px-3.5 pb-3 text-ui leading-body text-(--ds-gray-1000)">
        The title should name the standard, not the practice. Can this say “Web annotation standard”?
      </p>
      <div class={cn(geist.divider, 'mx-3')} />
      <div class="ml-3 border-l-2 border-(--ds-gray-alpha-400) px-3.5 py-2">
        <div class="mb-1 flex items-center gap-2">
          <ThreadDisc size="sm" color={REPLY.color} label="A" />
          <span class="truncate text-meta font-semibold text-(--ds-gray-1000)">{REPLY.author}</span>
          <span class="text-meta text-(--ds-gray-900) tabular-nums">{timeAgo(REPLY.ts)}</span>
        </div>
        <p class="m-0 text-ui leading-body text-(--ds-gray-1000)">{REPLY.text}</p>
      </div>
      <div class={cn(geist.divider, 'mx-3')} />
      <p class="m-0 flex items-center gap-1.5 px-3.5 py-2.5 text-meta font-medium text-(--ds-green-900)">
        <Check size={12} strokeWidth={2.5} aria-hidden="true" />
        Resolved
      </p>
    </div>
  );
}

/** The share popover, as it opens: the link, who may write, an invite, and who is here now. */
function ShareArt() {
  return (
    <div class={cn(demoCard, 'w-full max-w-[380px]', glass.font)}>
      <div class="flex flex-col gap-2.5 px-3.5 py-3">
        <p class={cn(geist.sectionLabel, 'm-0')}>Share link</p>
        <div class={cn(geist.field, 'flex items-center gap-1 pr-1 pl-2.5')}>
          <span class="min-w-0 flex-1 truncate font-mono text-meta text-(--ds-gray-1000)">
            marklayer.app/s/{DEMO_ROOM.id}
          </span>
          <CopyControl copied={false} onClick={() => {}} size={13} strokeWidth={1.75} class={geist.ctlXs} />
        </div>
        <div class="grid grid-cols-2 gap-0.5 rounded-lg bg-(--ds-gray-alpha-100) p-0.5 text-meta font-medium">
          <span class="rounded-md bg-white px-2.5 py-1.5 text-center text-(--ds-gray-1000) shadow-(--ds-shadow-border-small)">
            Can comment
          </span>
          <span class="px-2.5 py-1.5 text-center text-(--ds-gray-900)">View only</span>
        </div>
      </div>
      <div class={cn(geist.divider, 'mx-3')} />
      <div class="flex flex-col gap-2.5 px-3.5 py-3">
        <p class={cn(geist.sectionLabel, 'm-0')}>Invite by email</p>
        <div class={cn(geist.field, 'flex items-center gap-1 pr-1 pl-2.5')}>
          <span class="min-w-0 flex-1 truncate text-meta text-(--ds-gray-700)">dana@client.com</span>
          <span class="rounded-sm bg-(--ds-gray-1000) px-2 py-0.5 text-meta font-medium text-white">Send</span>
        </div>
      </div>
      <div class={cn(geist.divider, 'mx-3')} />
      <div class="flex items-center gap-2 px-3.5 py-3">
        <span class="flex -space-x-1.5">
          {['#3b82f6', '#f43f5e', '#8b5cf6'].map((c, i) => (
            <span key={c} class="rounded-full ring-2 ring-white">
              <ThreadDisc label={'AMY'[i] ?? ''} color={c} size="md" />
            </span>
          ))}
        </span>
        <span class="text-meta text-(--ds-gray-900)">Alice, Marcus and Yuki are here</span>
      </div>
    </div>
  );
}

/** The device switch from the viewer's bar, and the same page at phone width with its marks still on their words. */
function DeviceArt() {
  const modes = ['desktop', 'tablet', 'mobile'] as const;
  return (
    <div class={cn('mx-auto flex w-full max-w-[380px] flex-col items-center', glass.font)}>
      <div class="inline-flex items-center gap-0.5 rounded-lg bg-(--ds-gray-alpha-100) p-0.5">
        {modes.map((m) => {
          const Icon = DEVICE_ICONS[m];
          return (
            <span
              key={m}
              class={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-meta font-medium',
                m === 'mobile'
                  ? 'bg-white text-(--ds-gray-1000) shadow-(--ds-shadow-border-small)'
                  : 'text-(--ds-gray-900)',
              )}
            >
              <Icon size={13} strokeWidth={1.75} aria-hidden="true" />
              {DEVICE_LABELS[m]}
            </span>
          );
        })}
      </div>
      <div class="relative mt-5 w-[260px] rounded-[26px] border-[7px] border-(--ds-gray-1000) bg-white px-4 pt-6 pb-16 font-serif text-(--ds-gray-1000)">
        <p class="m-0 text-title">Web annotation</p>
        <p class="m-0 mt-3 font-ui text-ui leading-body">
          <mark class="rounded-sm px-0.5 text-inherit" style={{ background: '#f9a8d4' }}>
            Web annotation can refer to online annotations
          </mark>{' '}
          of web resources such as web pages or parts of them, or a set of W3C standards developed for this purpose.
        </p>
        <p class="m-0 mt-2 font-ui text-ui leading-body text-(--ds-gray-900)">
          The term can also refer to the creations of annotations on the World Wide Web and it has been used in this
          sense for the annotation tool INCEpTION.
        </p>
        <span
          class="absolute top-[22px] right-[18px] grid size-7 place-items-center rounded-full font-ui text-meta font-semibold text-white shadow-[0_0_0_2px_#fff,0_1px_2px_oklch(0_0_0/0.25)]"
          style={{ background: '#f43f5e' }}
        >
          1
        </span>
        <span
          class="absolute top-[118px] left-[10px] grid size-7 place-items-center rounded-full font-ui text-meta font-semibold text-white shadow-[0_0_0_2px_#fff,0_1px_2px_oklch(0_0_0/0.25)]"
          style={{ background: '#8b5cf6' }}
        >
          2
        </span>
      </div>
    </div>
  );
}

/** The thread's context block as the panel shows it, filled in from this visit, with the console beside it. */
function ContextArt() {
  const meta = getCommentMeta();
  const env = [meta.browser, meta.os, `${window.innerWidth} × ${window.innerHeight}`].filter(Boolean);
  return (
    <div class={cn(demoCard, 'grid w-full md:grid-cols-2', glass.font)}>
      <div class="border-b border-(--ds-gray-alpha-400) px-4 py-3 md:border-r md:border-b-0">
        <p class={cn(geist.sectionLabel, 'm-0')}>Context</p>
        <p class="m-0 mt-1.5 truncate text-ui text-(--ds-gray-1000)">/wiki/Web_annotation</p>
        <p class="m-0 mt-0.5 text-meta text-(--ds-gray-900) tabular-nums">{env.join(' · ')}</p>
        <p class="m-0 mt-1 truncate font-mono text-meta text-(--ds-gray-900)">
          h1#firstHeading &gt; span.mw-page-title-main
        </p>
        <p class={cn(geist.sectionLabel, 'm-0 mt-4')}>Element</p>
        <p class="m-0 mt-1.5 font-mono text-meta text-(--ds-gray-1000)">“Web annotation” · 236×36 · #202122</p>
        <p class="m-0 mt-0.5 font-mono text-meta text-(--ds-gray-900)">Linux Libertine, Georgia · 28.8px</p>
      </div>
      <div class="px-4 py-3">
        <p class={cn(geist.sectionLabel, 'm-0')}>2 page errors</p>
        <p class="m-0 mt-2 font-mono text-meta text-(--ds-gray-1000) wrap-break-word">
          TypeError: Cannot read properties of undefined (reading 'total')
          <span class="block truncate text-(--ds-gray-900)">cart.js:214</span>
        </p>
        <p class="m-0 mt-2 font-mono text-meta text-(--ds-gray-1000) wrap-break-word">
          Failed to load resource: 404
          <span class="block truncate text-(--ds-gray-900)">/images/hero@2x.webp</span>
        </p>
      </div>
    </div>
  );
}

/**
 * The fix, as a bento of claims each proved by the product itself: the real
 * viewer on a real page, and the product's own cards drawn with its own parts.
 */
export function ProofGrid() {
  return (
    <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-12 sm:gap-5">
      <Card class="lg:col-span-8">
        <Caption title="Click the page. Say what’s wrong.">The comment stays put, even after the page changes.</Caption>
        <Art class="h-[340px] justify-start pb-0">
          <div class="lp-bleed relative h-full overflow-hidden">
            <img
              src="/product-review-wikipedia.webp"
              width={1440}
              height={900}
              alt="MarkLayer open on the Wikipedia article for Web annotation, with a numbered pin on the title."
              loading="lazy"
              decoding="async"
              class="absolute inset-0 h-full w-full object-cover object-left-top"
              style={{ objectPosition: '-56px -44px' }}
            />
            <div class="absolute inset-x-4 bottom-0 flex justify-end sm:inset-x-auto sm:right-10">
              <ThreadArt />
            </div>
          </div>
        </Art>
      </Card>

      <Card class="lg:col-span-4">
        <Caption title="One link is the whole setup.">
          They open it in any browser. Nothing to install, no account.
        </Caption>
        <Art class="h-[340px] justify-start pb-0">
          <ShareArt />
        </Art>
      </Card>

      <Card class="lg:col-span-4">
        <Caption title="Marks survive a reflow.">Preview at phone width. The comment stays on its element.</Caption>
        <Art class="h-[320px] justify-start pb-0">
          <DeviceArt />
        </Art>
      </Card>

      <Card class="lg:col-span-8">
        <Caption title="It remembers what they were looking at.">
          Browser, screen, page and the console come attached. Nobody has to ask.
        </Caption>
        <Art class="h-[320px] justify-start pb-0">
          <ContextArt />
        </Art>
      </Card>
    </div>
  );
}

/* The three agent claims, each shown as the piece of the product it rests on. */

/** The inspector's overlay: the clicked element outlined, its selector in the tag the product draws. */
function TargetArt() {
  return (
    <div class="mx-auto w-full max-w-[300px]">
      <div class="relative inline-block">
        <span
          class="absolute -top-6 left-0 rounded-sm px-1.5 py-0.5 font-mono text-micro text-white"
          style={{ background: MARK }}
        >
          button.pay
        </span>
        <span
          class="inline-flex h-10 items-center rounded-md bg-ml-fg px-5 font-ui text-ui-lg font-medium text-white outline-2 outline-offset-4"
          style={{ outlineColor: MARK }}
        >
          Pay $48.00
        </span>
      </div>
      <div class={cn('lp-panel mt-7 rounded-lg px-4 py-3 font-mono text-ui text-(--ds-gray-900)', CHROME_CLS)}>
        <p class="m-0 text-(--ds-gray-700)">## Target</p>
        <p class="m-0 mt-1">form.checkout &gt; button.pay</p>
        <p class="m-0 mt-1 truncate">“Pay $48.00” · 164×40 · #171717</p>
      </div>
    </div>
  );
}

/** The thread's status row as the agent moves it along. */
const AGENT_STEPS: { label: string; done: boolean }[] = [
  { label: 'Seen', done: true },
  { label: 'Replied', done: true },
  { label: 'Done', done: false },
];

function StatusArt() {
  return (
    <div class={cn('lp-panel mx-auto w-full max-w-[320px] rounded-lg p-3.5', CHROME_CLS)}>
      <p class="m-0 flex items-baseline gap-2">
        <span class="font-medium">Marcus</span>
        <span class="text-(--ds-gray-700) text-meta">just now</span>
      </p>
      <p class="m-0 mt-1 leading-body">Can the total update when I change the quantity?</p>
      <ol class="m-0 mt-3 flex list-none items-center gap-2 border-t border-(--ds-gray-alpha-200) p-0 pt-3">
        {AGENT_STEPS.map((s, i) => (
          <li key={s.label} class="m-0 flex items-center gap-2 p-0">
            {i > 0 && <span class="text-(--ds-gray-700)">·</span>}
            <span
              class={cn(
                'inline-flex items-center gap-1 text-ui font-medium',
                s.done ? 'text-(--ds-green-900)' : 'text-(--ds-gray-700)',
              )}
            >
              {s.done ? (
                <Check size={12} strokeWidth={2.5} />
              ) : (
                <span class="inline-block size-1.5 rounded-full bg-current" />
              )}
              {s.label}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** A suggested edit as the product shows one: the old text struck, the new text ready to accept. */
function SuggestionArt() {
  return (
    <div class={cn('lp-panel mx-auto w-full max-w-[320px] rounded-lg p-3.5', CHROME_CLS)}>
      <p class="m-0 text-meta text-(--ds-gray-700)">Suggested change</p>
      <p class="m-0 mt-2 leading-body">
        <del class="rounded-sm bg-(--ds-red-700)/10 px-1 text-(--ds-gray-700) decoration-(--ds-red-700)/60">
          Shop now
        </del>{' '}
        <ins class="rounded-sm bg-(--ds-green-700)/12 px-1 no-underline">Shop the collection</ins>
      </p>
      <div class="mt-3 flex items-center gap-2 border-t border-(--ds-gray-alpha-200) pt-3">
        <span class="rounded-md bg-(--ds-gray-1000) px-2.5 py-1 text-ui font-medium text-white">Accept</span>
        <span class="px-2 py-1 text-ui font-medium text-(--ds-gray-900)">Dismiss</span>
      </div>
    </div>
  );
}

const AGENT_ARTS = [TargetArt, StatusArt, SuggestionArt];

/** What an agent does once it is in the room, one card per claim. */
export function AgentRow({ moments }: { moments: { title: string; desc: string }[] }) {
  return (
    <div class="grid gap-4 md:grid-cols-3 sm:gap-5">
      {moments.map((m, i) => {
        const ArtBody = AGENT_ARTS[i];
        return (
          <Card key={m.title}>
            <Caption title={m.title}>{m.desc}</Caption>
            <Art class="h-[260px]">{ArtBody && <ArtBody />}</Art>
          </Card>
        );
      })}
    </div>
  );
}
