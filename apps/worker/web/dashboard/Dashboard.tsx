import { submitBtn } from '@ext/lib/buttons';
import { geist } from '@ext/lib/geist';
import { cn, deletionDeadline, type OwnedLink, RETENTION_DAYS } from '@marklayer/types';
import { useSignal } from '@preact/signals';
import { Check, Copy, Link2, Trash2 } from 'lucide-preact';
import { useRef } from 'preact/hooks';
import { APP_MEASURE } from './AppBar';
import { links, linksLoading, releaseLink, user } from './session';

const DAY_SECONDS = 24 * 60 * 60;
/** Where the expiry stops being background information and starts being news. */
const SOON_DAYS = 7;
/** And where it stops being news and becomes the last thing you can do about it. */
const LAST_CALL_DAYS = 1;

/**
 * Emphasis by tone, not by colour. A saturated red on every link inside a week
 * makes the loudest thing on the page the one that is still fine; red is held
 * back for the day the link actually goes.
 */
function expiryTone(days: number): string {
  if (days <= LAST_CALL_DAYS) return 'font-medium text-(--ds-red-700)';
  if (days <= SOON_DAYS) return 'font-medium text-(--ds-gray-1000)';
  return '';
}

/** Days until the retention cron takes it. The rule itself lives beside its constant. */
function daysLeft(link: OwnedLink): number {
  return Math.max(0, Math.ceil((deletionDeadline(link) - Date.now() / 1000) / DAY_SECONDS));
}

function whenText(seconds: number): string {
  const days = Math.floor((Date.now() / 1000 - seconds) / DAY_SECONDS);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(seconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function hostOf(url: string | null): string {
  if (!url) return 'Untitled';
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** The rest of the address. Two links into the same site are otherwise one row twice. */
function pathOf(url: string | null): string {
  if (!url) return '';
  try {
    const { pathname, search } = new URL(url);
    const rest = `${pathname}${search}`;
    return rest === '/' ? '' : rest;
  } catch {
    return '';
  }
}

/** The card the whole page is built from — one hairline, one radius, no shadow. */
const PANEL = 'rounded-xl border border-(--ds-gray-alpha-400) bg-(--ds-background-100)';

/**
 * `geist.actionBtn` pulls 6px off both sides so a lone action lines up with the
 * content above it. In a right-aligned pair that eats the gap between the two
 * labels, so the inner margins are cancelled and only the outer edge keeps one.
 */
const CONFIRM_BTN = 'mx-0 text-(--ds-red-700) hover:bg-(--ds-gray-alpha-100)';
const CONFIRM_LAST = 'mx-0 -mr-1.5';

/** 44px on touch, back to the 28px row control from `sm` up. Mirrors `shared.tsx`. */
const ROW_CTL = 'size-11 sm:size-7';

/** Copy, and say so. Without a toast anywhere in the app, the control confirms itself. */
function CopyButton({ id }: { id: string }) {
  const copied = useSignal(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  return (
    <button
      type="button"
      aria-label={copied.value ? 'Link copied' : 'Copy link'}
      class={cn(
        geist.ctlSm,
        geist.ctlIdle,
        ROW_CTL,
        copied.value && 'text-(--ds-green-700) hover:text-(--ds-green-700)',
      )}
      onClick={() => {
        void navigator.clipboard.writeText(`${location.origin}/s/${id}`);
        copied.value = true;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          copied.value = false;
        }, 1600);
      }}
    >
      {copied.value ? (
        <Check size={14} strokeWidth={1.5} aria-hidden="true" />
      ) : (
        <Copy size={14} strokeWidth={1.5} aria-hidden="true" />
      )}
      <span role="status" class="sr-only">
        {copied.value ? 'Link copied' : ''}
      </span>
    </button>
  );
}

function LinkRow({ link }: { link: OwnedLink }) {
  const confirming = useSignal(false);
  const left = daysLeft(link);
  const path = pathOf(link.url);
  return (
    <li class="group relative flex items-center gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-(--ds-gray-alpha-100)">
      <div class="min-w-0 flex-1">
        {/* The stretched pseudo-element makes the whole row the link, which is
            why the actions beside it are positioned: later in the DOM and also
            positioned, so they stack above the overlay without a z-index. */}
        <a
          href={`/s/${link.id}`}
          class="text-ui tracking-ui block truncate font-medium text-(--ds-gray-1000) no-underline after:absolute after:inset-0 group-hover:underline"
        >
          {hostOf(link.url)}
          {path ? <span class="font-normal text-(--ds-gray-900)">{path}</span> : null}
        </a>
        {/* Wraps on a narrow screen rather than truncating: the row already
            gives the title the ellipsis, and an expiry cut to "in 89 da…" is
            the one number on the line worth reading. */}
        <p class="text-meta mt-1 text-(--ds-gray-900) sm:truncate">
          <span class="tabular-nums whitespace-nowrap">Opened {whenText(link.lastAccessedAt)}</span>
          <span class="px-1.5" aria-hidden="true">
            ·
          </span>
          <span class={cn('tabular-nums whitespace-nowrap', expiryTone(left))}>
            {left === 0 ? 'Expires today' : `Expires in ${left} ${left === 1 ? 'day' : 'days'}`}
          </span>
        </p>
      </div>
      <div class="relative flex shrink-0 items-center gap-1">
        {confirming.value ? (
          <>
            <button type="button" class={cn(geist.actionBtn, CONFIRM_BTN)} onClick={() => void releaseLink(link.id)}>
              Remove
            </button>
            <button
              type="button"
              class={cn(geist.actionBtn, geist.ctlIdle, CONFIRM_LAST)}
              onClick={() => {
                confirming.value = false;
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <CopyButton id={link.id} />
            <button
              type="button"
              aria-label="Remove from your links"
              class={cn(geist.ctlSm, geist.ctlIdle, ROW_CTL, 'hover:text-(--ds-red-700)')}
              onClick={() => {
                confirming.value = true;
              }}
            >
              <Trash2 size={14} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </li>
  );
}

/**
 * Three rows of the shape that is coming. The height is pinned to a real row's
 * 71px so the list does not resize under the reader when the data lands, and
 * the widths vary so three identical bars do not read as a repeating pattern.
 */
const SKELETON_ROWS = [
  ['w-40', 'w-56'],
  ['w-56', 'w-48'],
  ['w-32', 'w-52'],
];

function Skeleton() {
  return (
    <ul class={cn(PANEL, 'divide-y divide-(--ds-gray-alpha-400)')}>
      {SKELETON_ROWS.map(([title, meta]) => (
        <li key={title} class="flex h-[71px] animate-pulse flex-col justify-center gap-2 px-4">
          <div class={cn('h-3.5 rounded-sm bg-(--ds-gray-alpha-200)', title)} />
          <div class={cn('h-3 rounded-sm bg-(--ds-gray-alpha-100)', meta)} />
        </li>
      ))}
    </ul>
  );
}

function Empty() {
  return (
    <div class={cn(PANEL, 'flex flex-col items-center gap-2 px-6 py-16 text-center')}>
      <Link2 size={24} strokeWidth={1.5} class="text-(--ds-gray-700)" aria-hidden="true" />
      <span class="text-ui font-medium text-(--ds-gray-1000)">No saved links yet</span>
      <span class="text-meta leading-body max-w-[28rem] text-balance text-(--ds-gray-900)">
        Open a link you made and choose <span class="text-(--ds-gray-1000)">Save to my links</span>, or annotate a page
        to make one.
      </span>
      <a href="/" class={cn(submitBtn, 'mt-4 no-underline')}>
        Annotate a page
      </a>
    </div>
  );
}

export function Dashboard() {
  const account = user.value;
  const list = links.value;
  const loading = linksLoading.value && list.length === 0;
  return (
    <div class={cn(APP_MEASURE, 'py-8 sm:py-10')}>
      {/* Baselines, not centres: the count is a subtitle to the title, and the
          action beside them is a box that centres on its own row instead. */}
      <div class="mb-5 flex items-end justify-between gap-4">
        <div class="flex items-baseline gap-2.5">
          <h1 class="text-heading tracking-ui font-semibold text-(--ds-gray-1000)">Your links</h1>
          {list.length > 0 && (
            <span class="text-meta tabular-nums text-(--ds-gray-900)">
              {list.length} link{list.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {list.length > 0 && (
          <a href="/" class={cn(submitBtn, 'no-underline')}>
            Annotate a page
          </a>
        )}
      </div>

      {loading ? (
        <Skeleton />
      ) : list.length === 0 ? (
        <Empty />
      ) : (
        <>
          <ul class={cn(PANEL, 'divide-y divide-(--ds-gray-alpha-400)')}>
            {list.map((link) => (
              <LinkRow key={link.id} link={link} />
            ))}
          </ul>
          {/* Said once, at the foot of the list, rather than re-explained on
              every row — which is what the per-row "unless opened" was doing. */}
          <p class="text-meta leading-body mt-3 text-(--ds-gray-900)">
            Links are deleted {RETENTION_DAYS} days after they were last opened. Opening one resets its clock.
          </p>
        </>
      )}

      {/* The address, for the reader who lands here from a magic link and wants
          to know which account it signed them into. The bar carries it on wider
          screens; this is the small-screen answer. */}
      {account ? (
        <p class="text-meta mt-8 truncate text-(--ds-gray-900) sm:hidden">Signed in as {account.email}</p>
      ) : null}
    </div>
  );
}
