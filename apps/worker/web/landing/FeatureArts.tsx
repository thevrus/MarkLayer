import { cn } from '@marklayer/types';
import { Check, Copy, Download, Mic } from 'lucide-preact';

/* The seeded pin's purple, so every mark the page leaves on itself is one person's. */
const MARK = '#8b5cf6';
/* Product chrome speaks Geist, because it is the product. */
const CHROME_CLS = 'lp-panel rounded-lg font-ui text-ui-lg text-(--ds-gray-1000)';

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

/** The voice bar as the room shows it: who is on the call, and who is talking. */
function VoiceArt() {
  return (
    <div class={cn(CHROME_CLS, 'mx-auto flex w-full max-w-[300px] items-center gap-3 px-3.5 py-2.5')}>
      <span class="flex -space-x-1.5">
        {PEOPLE.map((p) => (
          <span key={p.name} class="rounded-full ring-2 ring-white">
            <Avatar {...p} />
          </span>
        ))}
      </span>
      <span class="min-w-0 flex-1 truncate">
        <span class="font-medium">Marcus</span> <span class="text-(--ds-gray-700)">is talking</span>
      </span>
      <span class="flex h-4 items-end gap-0.5" aria-hidden="true">
        {[0.5, 1, 0.7, 0.9].map((h, i) => (
          <i key={i} class="block w-0.75 rounded-full bg-(--ds-green-700)" style={{ height: `${h * 100}%` }} />
        ))}
      </span>
      <Mic size={15} class="shrink-0 text-(--ds-gray-900)" aria-hidden="true" />
    </div>
  );
}

/** The follow banner: everyone's viewport pinned to one person's. */
function FollowArt() {
  return (
    <div class="relative mx-auto w-full max-w-[300px]">
      <div class={cn(CHROME_CLS, 'flex items-center gap-2.5 px-3.5 py-2.5')}>
        <Avatar {...PEOPLE[0]} size={20} />
        <span class="min-w-0 flex-1 truncate">
          Following <span class="font-medium">Alice</span>
        </span>
        <span class="rounded-md bg-(--ds-gray-alpha-100) px-2 py-1 text-ui font-medium">Stop</span>
      </div>
      <div class="mt-3 flex items-center justify-between rounded-lg px-3 py-2 font-ui text-ui text-(--ds-gray-700)">
        <span>2 following you</span>
        <span class="flex -space-x-1.5">
          <Avatar {...PEOPLE[1]} size={18} />
          <Avatar {...PEOPLE[2]} size={18} />
        </span>
      </div>
    </div>
  );
}

const THREADS: { text: string; status: string; color: string; priority: string }[] = [
  { text: 'Button copy on the hero', status: 'Resolved', color: 'var(--ds-green-900)', priority: 'High' },
  { text: 'Total does not update', status: 'In progress', color: 'var(--ds-blue-800)', priority: 'Urgent' },
  { text: 'Footer logo is blurry', status: 'Open', color: 'var(--ds-gray-700)', priority: 'Low' },
];

/** The board: one row per thread, its status and priority on it. */
function BoardArt() {
  return (
    <ul class={cn(CHROME_CLS, 'mx-auto m-0 w-full max-w-[320px] list-none divide-y divide-(--ds-gray-alpha-200) p-0')}>
      {THREADS.map((t) => (
        <li key={t.text} class="m-0 flex items-center gap-3 px-3.5 py-2.5">
          <span class="size-2 shrink-0 rounded-full" style={{ background: t.color }} aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate">{t.text}</span>
          <span class="shrink-0 text-ui text-(--ds-gray-700)">{t.priority}</span>
          <span class="shrink-0 text-ui font-medium" style={{ color: t.color }}>
            {t.status}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The measure tool's readout: a box, its size, and the gap to its neighbour. */
function MeasureArt() {
  return (
    <div class="relative mx-auto h-[120px] w-full max-w-[280px] font-ui text-mini font-medium" aria-hidden="true">
      <span
        class="absolute top-4 left-0 h-10 w-[164px] rounded-md bg-white outline-1 outline-dashed"
        style={{ outlineColor: MARK }}
      />
      <span class="absolute top-[-2px] left-[62px] rounded-sm px-1.5 py-0.5 text-white" style={{ background: MARK }}>
        164 × 40
      </span>
      <span class="absolute top-[34px] left-[164px] h-px w-[48px]" style={{ background: MARK }} />
      <span class="absolute top-[22px] left-[176px] rounded-sm bg-white px-1 py-0.5" style={{ color: MARK }}>
        48
      </span>
      <span class="absolute top-4 left-[212px] h-10 w-[60px] rounded-md bg-white shadow-(--ds-shadow-border-small)" />
      <span class="absolute top-[72px] right-0 left-0 border-t border-dashed" style={{ borderColor: MARK }} />
      <span class="absolute top-[78px] left-0 text-(--ds-gray-700)">guide · y 412</span>
    </div>
  );
}

const PAGES = ['Home', 'Pricing', 'Checkout', 'Account'];

/** A project's tab strip: one link, every page of the flow. */
function PagesArt() {
  return (
    <div class={cn(CHROME_CLS, 'mx-auto w-full max-w-[320px] px-2 py-2')}>
      <div class="flex items-center gap-1 text-ui">
        {PAGES.map((p, i) => (
          <span
            key={p}
            class={cn(
              'rounded-md px-2.5 py-1.5',
              i === 1 ? 'bg-(--ds-gray-alpha-100) font-medium' : 'text-(--ds-gray-900)',
            )}
          >
            {p}
          </span>
        ))}
        <span class="ml-auto px-2 text-(--ds-gray-700)">+46</span>
      </div>
    </div>
  );
}

/** Where a comment goes next: the chat it posted to, the tracker it became a task in. */
function SendArt() {
  return (
    <div class={cn(CHROME_CLS, 'mx-auto w-full max-w-[300px] px-3.5 py-3')}>
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
    <div class={cn(CHROME_CLS, 'mx-auto w-full max-w-[300px] px-3.5 py-3 font-mono text-ui')}>
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
    <div class={cn(CHROME_CLS, 'mx-auto w-full max-w-[300px] divide-y divide-(--ds-gray-alpha-200)')}>
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
    </div>
  );
}

/** One demo per feature, in the order FEATURES lists them. */
export const FEATURE_ARTS = [VoiceArt, FollowArt, BoardArt, MeasureArt, PagesArt, SendArt, ExportArt, LockArt] as const;
