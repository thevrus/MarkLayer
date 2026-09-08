import { Popover } from '@base-ui/react/popover';
import { Tooltip } from '@ext/components/Tooltip';
import { submitBtn } from '@ext/lib/buttons';
import { geist } from '@ext/lib/geist';
import { glass } from '@ext/lib/glass';
import { portalContainer } from '@ext/lib/portal';
import { shareUrl } from '@ext/lib/share';
import { useCopyToClipboard } from '@ext/lib/useCopy';
import { cn, type OwnedLink } from '@marklayer/types';
import { ArrowUpRight, Upload } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { LinkSettings } from './dashboard/LinkSettings';
import { links, linksLoading, loadSession, sessionLoading, user } from './dashboard/session';
import { CopyControl } from './shared';
import { annotationId, projectId, sharing } from './signals';
import { useViewerFrame } from './viewerFrame';

/** One padded block. Sections are divided full-bleed, so the padding lives here, not on the shell. */
function Block({ children }: { children: ComponentChildren }) {
  return <div class="flex flex-col gap-2.5 px-3.5 py-3">{children}</div>;
}

/**
 * The saved link, in the field recipe every other input in the product uses.
 * Copying is `share()` rather than a plain clipboard write: the same click also
 * persists the annotation, so a link copied from here is a link that resolves.
 */
function LinkField({ url, busy, onCopy }: { url: string; busy: boolean; onCopy: () => void }) {
  // Same dwell as the dashboard's copy control, so the one action reads the
  // same in both places a person meets it.
  const { copied, flash } = useCopyToClipboard({ resetMs: 1600 });
  return (
    <div class={cn(geist.field, 'flex items-center gap-1 pl-2.5 pr-1')}>
      {/* Mono because a URL is data — the one place in this card it is earned. */}
      <span class="text-meta min-w-0 flex-1 truncate font-mono text-(--ds-gray-1000)">{url}</span>
      <CopyControl
        copied={copied.value}
        onClick={() => {
          onCopy();
          flash();
        }}
        size={13}
        strokeWidth={1.75}
        disabled={busy}
        class={cn(geist.ctlXs, 'disabled:pointer-events-none disabled:opacity-50')}
      />
    </div>
  );
}

/** No id yet: one honest action, not a field with nothing in it and a control that copies air. */
function CreateLink({ busy, onCreate }: { busy: boolean; onCreate: () => void }) {
  return (
    <button type="button" class={cn(submitBtn, 'w-full')} disabled={busy} onClick={onCreate}>
      Create share link
    </button>
  );
}

function Note({ children }: { children: ComponentChildren }) {
  return (
    <Popover.Description className="text-meta leading-body m-0 text-(--ds-gray-900)">{children}</Popover.Description>
  );
}

/** `/app/claim/:id` handles sign-in itself and keeps the id through the magic link. */
function ClaimPrompt({ id }: { id: string }) {
  return (
    <Note>
      <a
        href={`/app/claim/${encodeURIComponent(id)}`}
        class={cn(
          'rounded-sm font-medium text-(--ds-gray-1000) no-underline hover:underline',
          // offset-1 like every control in the system — at 2 the ring crowds the
          // word that follows it in the sentence.
          'outline-none focus-visible:outline-solid focus-visible:outline-2',
          'focus-visible:outline-offset-1 focus-visible:outline-(--ds-focus-color)',
        )}
      >
        Save to my links
      </a>{' '}
      to choose who may edit and when it expires.
    </Note>
  );
}

/**
 * The popover's second section, or null when there's nothing to show: a
 * project has no per-link access to set, and a link that doesn't exist yet
 * has nothing to set it on.
 */
function renderLinkSettings({
  pid,
  id,
  owned,
  checkingOwner,
}: {
  pid: string | null;
  id: string | null;
  owned: OwnedLink | undefined;
  checkingOwner: boolean;
}): ComponentChildren {
  if (pid || !id) return null;
  if (owned) return <LinkSettings link={owned} />;
  if (checkingOwner) return <Note>Checking who owns this link…</Note>;
  return <ClaimPrompt id={id} />;
}

/** The way out to the full list. Owners only, so it never competes with the claim prompt above. */
function ManageLinksRow() {
  return (
    <a
      href="/app"
      class={cn(
        'text-meta flex h-10 items-center justify-between px-3.5 font-medium no-underline',
        'text-(--ds-gray-900) transition-colors duration-150',
        'hover:bg-(--ds-gray-alpha-100) hover:text-(--ds-gray-1000)',
        // Inset, because the row is full-bleed inside an `overflow-hidden`
        // shell — an outset ring would be clipped on three sides.
        'outline-none focus-visible:outline-solid focus-visible:outline-2',
        'focus-visible:-outline-offset-2 focus-visible:outline-(--ds-focus-color)',
      )}
    >
      Manage links
      {/* Outward, not the stock rightward arrow: this leaves the viewer for another page. */}
      <ArrowUpRight size={13} strokeWidth={1.75} aria-hidden="true" />
    </a>
  );
}

/**
 * The share button's card: the link, and for the person who owns it the
 * who-can-edit and expiry controls that used to live only on the dashboard.
 *
 * Ownership comes from the same `/auth/links` list the dashboard reads, fetched
 * the first time the card opens rather than on every viewer load — a visitor
 * who never shares never pays for it.
 */
export function SharePopover() {
  const [open, setOpen] = useState(false);
  const asked = useRef(false);
  const {
    actions: { share },
  } = useViewerFrame();

  const pid = projectId.value;
  const id = annotationId.value;
  // Built from the same helper `share()` copies from: a field displaying a link
  // other than the one on the clipboard is a small lie.
  const url = pid
    ? shareUrl({ origin: location.origin, kind: 'project', id: pid, ref: 'web' })
    : id
      ? shareUrl({ origin: location.origin, kind: 'page', id, ref: 'web' })
      : null;
  const owned = id ? links.value.find((link) => link.id === id) : undefined;

  const settings = renderLinkSettings({ pid, id, owned, checkingOwner: sessionLoading.value || linksLoading.value });

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next: boolean) => {
        setOpen(next);
        if (next && !asked.current && !user.value) {
          asked.current = true;
          void loadSession();
        }
      }}
    >
      <Popover.Trigger
        aria-label="Share"
        className={cn(geist.ctl, geist.ctlIdle, 'data-popup-open:bg-(--ds-gray-alpha-100)')}
      >
        <Upload size={16} strokeWidth={1.5} aria-hidden="true" />
        {/* Held closed while the card is up: the tooltip opens on the same side,
            from the same anchor, and its own surface peeked out from behind the
            card as a stray second panel. */}
        <Tooltip text="Share" placement="bottom" disabled={open} />
      </Popover.Trigger>
      <Popover.Portal container={portalContainer.value ?? undefined}>
        <Popover.Positioner
          positionMethod="fixed"
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className="z-2147483647 outline-none"
        >
          {/* 380, not 320: the expiry row needs 292px (41 label + 243 track + gap)
              and 320 left exactly 292 after padding, so it wrapped and the two
              setting rows went ragged against each other. `overflow-hidden` keeps
              the full-bleed rules and the footer's hover fill inside the radius. */}
          <Popover.Popup className={cn(geist.surface, glass.font, 'w-95 overflow-hidden outline-none')}>
            <Block>
              <Popover.Title className="text-ui tracking-ui m-0 font-semibold text-(--ds-gray-1000)">
                Share
              </Popover.Title>
              {url ? (
                <LinkField url={url} busy={sharing.value} onCopy={share} />
              ) : (
                <CreateLink busy={sharing.value} onCreate={share} />
              )}
            </Block>

            {settings && (
              <>
                <div class={geist.divider} />
                <Block>{settings}</Block>
              </>
            )}

            {owned && (
              <>
                <div class={geist.divider} />
                <ManageLinksRow />
              </>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
