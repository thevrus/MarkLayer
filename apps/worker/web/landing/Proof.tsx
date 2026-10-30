import { ThreadDisc, ThreadHeader, threadCard } from '@ext/components/ThreadCard';
import { geist } from '@ext/lib/geist';
import { glass } from '@ext/lib/glass';
import { getCommentMeta } from '@ext/lib/state';
import { timeAgo } from '@ext/lib/time';
import type { CommentOp } from '@ext/lib/types';
import { cn, DEMO_ROOM } from '@marklayer/types';
import { Check } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { siGmail, siGooglechrome, siWhatsapp } from 'simple-icons';
import { CHANNELS } from '../ChannelCycle';
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

/* Brand marks from simple-icons. Slack and Teams have no
   mark here on purpose: their trademark policies bar it (see IntegrationsSection),
   so they are set in their colour by name. */
const BRAND = {
  whatsapp: {
    hex: '#25D366',
    d: siWhatsapp.path,
  },
  gmail: {
    hex: '#EA4335',
    d: siGmail.path,
  },
  chrome: {
    hex: '#4285F4',
    d: siGooglechrome.path,
  },
} as const;

function Brand({ id, size = 16 }: { id: keyof typeof BRAND; size?: number }) {
  const b = BRAND[id];
  return (
    <svg role="presentation" width={size} height={size} viewBox="0 0 24 24" class="shrink-0" style={{ color: b.hex }}>
      <path d={b.d} fill="currentColor" />
    </svg>
  );
}

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

/** The dialogs a client meets before most tools let them say a word. */
const GATES: { title: string; action: string; brand?: keyof typeof BRAND }[] = [
  { title: 'Install the browser extension to view this page', action: 'Add to Chrome', brand: 'chrome' },
  { title: 'Create an account to continue', action: 'Sign up' },
  { title: 'Check your inbox to confirm your email', action: 'Resend', brand: 'gmail' },
];

/** The same note, arriving four ways. Channel colours are the headline's own. */
const SCATTER: {
  channel: number;
  brand?: keyof typeof BRAND;
  who: string;
  text: string;
  at: string;
  mine?: boolean;
}[] = [
  { channel: 0, brand: 'gmail', who: 'Dana', text: 'See attached: homepage_feedback_v3_FINAL.pdf', at: '9:12' },
  { channel: 3, brand: 'whatsapp', who: 'Dana', text: 'the button on page 2. no not that one', at: '9:40' },
  { channel: 1, who: 'You', text: 'who has the list from yesterday’s call?', at: '11:05', mine: true },
  { channel: 2, who: 'Priya', text: 'can you send a screenshot?', at: '14:30' },
];

/** What goes wrong today, in two cards: the gate, and where the feedback ends up. */
export function ProblemRow() {
  return (
    <div class="grid gap-4 md:grid-cols-2 sm:gap-5">
      <Card>
        <Caption title="Make them install something, and they stop." />
        <Art class="h-[300px] px-3 sm:px-8">
          <div class="relative h-48 sm:h-52">
            {GATES.map((g, i) => (
              <div
                key={g.title}
                class={cn(
                  'lp-panel absolute right-0 left-0 flex items-center gap-3 rounded-lg px-4 py-3.5',
                  CHROME_CLS,
                )}
                style={{
                  top: `${i * 50}px`,
                  marginInline: `${(2 - i) * 10}px`,
                  opacity: 1 - (2 - i) * 0.3,
                  zIndex: i,
                }}
              >
                {g.brand && <Brand id={g.brand} size={18} />}
                <span class="min-w-0 flex-1 truncate font-medium">{g.title}</span>
                <span class="shrink-0 rounded-md bg-(--ds-gray-1000) px-2.5 py-1 text-ui font-medium text-white">
                  {g.action}
                </span>
              </div>
            ))}
          </div>
        </Art>
      </Card>

      <Card>
        <Caption title="So it comes back in four apps, and loses the page." />
        <Art class="h-[300px]">
          <ul class="m-0 flex list-none flex-col gap-2.5 p-0">
            {SCATTER.map((m) => {
              const ch = CHANNELS[m.channel];
              return (
                <li
                  key={m.text}
                  class={cn(
                    'lp-panel m-0 flex max-w-[92%] items-start gap-2.5 rounded-lg px-3.5 py-2.5',
                    CHROME_CLS,
                    m.mine ? 'self-end' : 'self-start',
                  )}
                >
                  {m.brand ? (
                    <span class="mt-0.5">
                      <Brand id={m.brand} size={16} />
                    </span>
                  ) : (
                    <span class="mt-px shrink-0 text-ui font-semibold" style={{ color: ch.color }}>
                      {ch.name}
                    </span>
                  )}
                  <span class="min-w-0">
                    <span class="mr-2 font-medium">{m.who}</span>
                    <span class="text-(--ds-gray-900)">{m.text}</span>
                    <span class="ml-2 text-meta text-(--ds-gray-700)">{m.at}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Art>
      </Card>
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
    <div class={cn(threadCard, 'w-full max-w-[320px]', glass.font)}>
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

/** The share field as the share popover draws it: the link, mono because it is data, and its copy control. */
function ShareArt() {
  return (
    <div class={cn('mx-auto w-full max-w-[360px]', glass.font)}>
      <div class={cn(geist.field, 'flex items-center gap-1 pr-1 pl-2.5')}>
        <span class="min-w-0 flex-1 truncate font-mono text-meta text-(--ds-gray-1000)">
          marklayer.app/s/{DEMO_ROOM.id}
        </span>
        <CopyControl copied={false} onClick={() => {}} size={13} strokeWidth={1.75} class={geist.ctlXs} />
      </div>
      <p class="m-0 mt-2.5 text-meta text-(--ds-gray-900)">
        Anyone with the link can comment. No account on either end.
      </p>
      <div class="mt-4 flex items-center gap-2">
        <span class="flex -space-x-1.5">
          {['#3b82f6', '#f43f5e', '#8b5cf6'].map((c, i) => (
            <span key={c} class="rounded-full ring-2 ring-white">
              <ThreadDisc label={'AMY'[i] ?? ''} color={c} size="md" />
            </span>
          ))}
        </span>
        <span class="text-meta text-(--ds-gray-900)">3 online</span>
      </div>
    </div>
  );
}

/** The device switch from the viewer's bar, and the same pin at phone width. */
function DeviceArt() {
  const modes = ['desktop', 'tablet', 'mobile'] as const;
  return (
    <div class={cn('mx-auto w-full max-w-[320px]', glass.font)}>
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
      <div class="relative mt-4 w-[180px] rounded-[18px] border-[6px] border-(--ds-gray-1000) bg-white px-3 pt-4 pb-10">
        <p class="m-0 font-serif text-heading text-(--ds-gray-1000)">Web annotation</p>
        <span class="mt-1.5 block h-1.5 w-20 rounded-full bg-(--ds-gray-alpha-200)" />
        <span class="mt-1.5 block h-1.5 w-28 rounded-full bg-(--ds-gray-alpha-100)" />
        <span class="mt-1.5 block h-1.5 w-24 rounded-full bg-(--ds-gray-alpha-100)" />
        <span
          class="absolute top-[26px] right-[22px] grid size-6 place-items-center rounded-full text-micro font-semibold text-white shadow-[0_0_0_2px_#fff,0_1px_2px_oklch(0_0_0/0.25)]"
          style={{ background: '#f43f5e' }}
        >
          1
        </span>
      </div>
    </div>
  );
}

/** The thread's context block as the panel shows it, filled in from this visit. */
function ContextArt() {
  const meta = getCommentMeta();
  const env = [meta.browser, meta.os, `${window.innerWidth} × ${window.innerHeight}`].filter(Boolean);
  return (
    <div class={cn(threadCard, 'w-full max-w-[360px]', glass.font)}>
      <div class="border-b border-(--ds-gray-alpha-400) px-4 py-3">
        <p class={cn(geist.sectionLabel, 'm-0')}>Context</p>
        <p class="m-0 mt-1.5 truncate text-ui text-(--ds-gray-1000)">/wiki/Web_annotation</p>
        <p class="m-0 mt-0.5 text-meta text-(--ds-gray-900) tabular-nums">{env.join(' · ')}</p>
        <p class="m-0 mt-1 truncate font-mono text-meta text-(--ds-gray-900)">
          h1#firstHeading &gt; span.mw-page-title-main
        </p>
      </div>
      <div class="px-4 py-3">
        <p class={cn(geist.sectionLabel, 'm-0')}>1 page error</p>
        <p class="m-0 mt-2 font-mono text-meta text-(--ds-gray-1000) wrap-break-word">
          TypeError: Cannot read properties of undefined (reading 'total')
          <span class="block truncate text-(--ds-gray-900)">cart.js:214</span>
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
        <Art class="h-[340px] justify-start">
          <ShareArt />
        </Art>
      </Card>

      <Card class="lg:col-span-4">
        <Caption title="Marks survive a reflow.">Preview at phone width. The comment stays on its element.</Caption>
        <Art class="h-[300px] justify-start pb-0">
          <DeviceArt />
        </Art>
      </Card>

      <Card class="lg:col-span-8">
        <Caption title="It remembers what they were looking at.">
          Browser, screen, page and the console come attached. Nobody has to ask.
        </Caption>
        <Art class="h-[300px] justify-start pb-0">
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
