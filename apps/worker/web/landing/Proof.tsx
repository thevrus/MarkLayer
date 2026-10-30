import { getCommentMeta } from '@ext/lib/state';
import { cn } from '@marklayer/types';
import { Check } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { siGmail, siGooglechrome, siWhatsapp } from 'simple-icons';
import { CHANNELS } from '../ChannelCycle';

/* The seeded pin's purple, so every mark the page leaves on itself is one person's. */
const MARK = '#8b5cf6';

/* A card is a white object drawn on the white page by its ring: a stage on top
   showing a piece of the product, and under it the claim, one step below the
   section head so it never rivals it, with at most one line of support.
   Artifacts speak Geist, because they are the product. */
const CARD_CLS = 'lp-card relative flex flex-col p-5';
/* The stage takes a fixed height per row and the caption the rest, so every
   title in a row starts on the same line however long its neighbour's copy runs. */
const ART_CLS =
  'lp-card-art relative mt-5 flex shrink-0 flex-col justify-center overflow-hidden px-5 py-8 sm:px-8 sm:py-10';
const TEXT_CLS = 'min-h-[3.75rem]';
const TITLE_CLS = 'm-0 font-ui text-lede font-semibold tracking-ui text-ml-fg text-balance';
const DESC_CLS = 'm-0 mt-1.5 text-body leading-prose text-ml-fg/55 text-pretty';
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

function MockPin({ n, color, done }: { n: number; color: string; done?: boolean }) {
  return (
    <span
      class="relative grid size-7 place-items-center rounded-full font-ui text-meta font-semibold text-white shadow-[0_0_0_2px_#fff,0_1px_2px_oklch(0_0_0/0.25)]"
      style={{ background: color }}
    >
      {n}
      {done && (
        <span
          class="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-(--ds-green-700) text-white [box-shadow:0_0_0_1.5px_#fff]"
          aria-hidden="true"
        >
          <Check size={9} strokeWidth={2.5} />
        </span>
      )}
    </span>
  );
}

const STEPS = ['Paste the page address', 'Send the link', 'Tick things off'];

/**
 * The fix, as a bento of claims each proved by a piece of the product. One
 * stat card carries the number the whole page rests on.
 */
export function ProofGrid() {
  // The visitor's own browser, read the way a comment reads it.
  const meta = getCommentMeta();
  const rows = [
    ['Browser', meta.browser],
    ['System', meta.os],
    ['Screen', `${window.innerWidth} × ${window.innerHeight}`],
    ['Page', location.host],
  ] as const;
  return (
    <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-12 sm:gap-5">
      <Card class="lg:col-span-8">
        <Caption title="Click the page. Say what’s wrong.">The comment stays put, even after the page changes.</Caption>
        <Art class="p-0 sm:p-0">
          {/* A corner of somebody's page, with a thread left on its button. */}
          <div class="px-6 pt-7 pb-8 sm:px-9 sm:pt-9 sm:pb-24">
            <p class="lp-display m-0 text-statement text-ml-fg">Spring collection</p>
            <p class="m-0 mt-2.5 max-w-[32ch] text-body leading-body text-ml-fg/55">
              Linen, cotton and a little bit of nothing. Shipping is free until the end of the month.
            </p>
            <div class="relative mt-6 inline-block">
              <span class="inline-flex h-10 items-center rounded-md bg-ml-fg px-5 font-ui text-ui-lg font-medium text-white">
                Shop now
              </span>
              <span class="absolute -top-3.5 -right-3.5">
                {/* Marcus's cursor colour, from the fold. */}
                <MockPin n={2} color="#f43f5e" done />
              </span>
            </div>
          </div>
          <div
            class={cn(
              'lp-panel mx-4 mb-4 rounded-lg p-3.5 sm:absolute sm:right-7 sm:bottom-7 sm:mx-0 sm:mb-0 sm:w-[320px]',
              CHROME_CLS,
            )}
          >
            <p class="m-0 flex items-baseline gap-2">
              <span class="font-medium">Marcus</span>
              <span class="text-(--ds-gray-700) text-meta">just now</span>
            </p>
            <p class="m-0 mt-1 leading-body">Can this say “Shop the collection”? “Shop now” sounds pushy.</p>
            <p class="m-0 mt-3 flex items-baseline gap-2 border-t border-(--ds-gray-alpha-200) pt-3">
              <span class="font-medium">Alice</span>
              <span class="text-(--ds-gray-700) text-meta">2 min</span>
            </p>
            <p class="m-0 mt-1 leading-body">Changed. Have a look.</p>
            <p class="m-0 mt-3 inline-flex items-center gap-1.5 text-ui font-medium text-(--ds-green-900)">
              <Check size={13} strokeWidth={2.5} aria-hidden="true" />
              Resolved
            </p>
          </div>
        </Art>
      </Card>

      <Card class="items-center justify-center px-6 py-14 text-center lg:col-span-4">
        <p class="lp-display m-0 text-hero text-ml-fg tabular-nums">0</p>
        <p class="lp-display m-0 mt-3 max-w-[16ch] text-statement text-ml-fg/55">
          things to install, sign up for, or pay for.
        </p>
      </Card>

      <Card class="lg:col-span-4">
        <Caption title="Three steps, start to finish." />
        <Art class="h-[260px]">
          <ol class="m-0 list-none divide-y divide-ml-rule p-0">
            {STEPS.map((s, i) => (
              <li key={s} class="m-0 flex items-baseline gap-5 py-4">
                <span class="lp-display w-[1.1em] shrink-0 text-statement text-ml-fg/30 tabular-nums">{i + 1}</span>
                <span class="text-lede text-ml-fg">{s}</span>
              </li>
            ))}
          </ol>
        </Art>
      </Card>

      <Card class="lg:col-span-8">
        <Caption title="It remembers what they were looking at.">
          Browser, screen and page come attached. Nobody has to ask.
        </Caption>
        <Art class="h-[260px]">
          <div class="flex flex-wrap items-end gap-x-10 gap-y-5">
            {/* The product's own meta footer, filled in from this visit. */}
            <dl
              class={cn(
                'lp-panel m-0 grid w-full max-w-[420px] grid-cols-[auto_1fr] gap-x-8 gap-y-3 rounded-lg px-5 py-4',
                CHROME_CLS,
              )}
            >
              {rows.map(([label, value]) => (
                <div key={label} class="contents">
                  <dt class="text-ui-lg font-medium text-(--ds-gray-900)">{label}</dt>
                  <dd class="m-0 flex items-center gap-2 font-mono text-ui-lg">
                    {label === 'Browser' && value === 'Chrome' && <Brand id="chrome" size={14} />}
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <p class="m-0 max-w-[22ch] text-ui leading-prose text-ml-fg/55">Yours, read from this browser just now.</p>
          </div>
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
