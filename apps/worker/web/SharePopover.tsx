import { Popover } from '@base-ui/react/popover';
import { ModalSheet } from '@ext/components/BottomSheet';
import { Tooltip } from '@ext/components/Tooltip';
import { quietLinkBtn, submitBtn } from '@ext/lib/buttons';
import { geist } from '@ext/lib/geist';
import { glass } from '@ext/lib/glass';
import { portalContainer } from '@ext/lib/portal';
import { shareUrl } from '@ext/lib/share';
import { toast } from '@ext/lib/state';
import { useCopyToClipboard } from '@ext/lib/useCopy';
import { cn, type OwnedLink } from '@marklayer/types';
import { ArrowUpRight, Share2, Upload } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { capture } from './analytics';
import { LinkSettings } from './dashboard/LinkSettings';
import { inviteToLink, links, linksLoading, loadSession, sessionLoading, user } from './dashboard/session';
import { FeedbackButtonSection } from './FeedbackButtonSection';
import { CopyControl, Spinner } from './shared';
import { annotationId, projectId, sharing } from './signals';
import { useViewerFrame } from './viewerFrame';

/** One padded block. Sections are divided full-bleed, so the padding lives here, not on the shell. */
function Block({ children }: { children: ComponentChildren }) {
  // 16px on a phone, the drawer's gutter, so every row starts on the header's line.
  return <div class="flex flex-col gap-2.5 px-3.5 py-3 max-md:px-4">{children}</div>;
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
    <div class={cn(geist.field, 'flex items-center gap-1 pl-2.5 pr-1 max-md:h-11')}>
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
        class={cn(geist.ctlXs, 'max-md:size-10 disabled:pointer-events-none disabled:opacity-50')}
      />
    </div>
  );
}

// Most mobile and Chromium desktop, but not Firefox desktop. Support can't change
// mid-session, so it is read once rather than on every render.
const hasShareSheet = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

/** The OS share sheet for `url`. Fewer taps than typing an address: the friction was the email field. */
function useNativeShare(url: string) {
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await navigator.share({ url });
      capture('share_sheet_used');
    } catch (err) {
      // AbortError just means the person closed the sheet — not a failure to report.
      if (err instanceof Error && err.name !== 'AbortError') {
        toast('Could not open the share sheet.', { type: 'error' });
      }
    } finally {
      setBusy(false);
    }
  };
  return { busy, send: () => void send() };
}

/** On a desktop, a quiet second path under the field: Copy stays the obvious action there. */
function ShareSheet({ url }: { url: string }) {
  const { busy, send } = useNativeShare(url);
  return (
    <button
      type="button"
      onClick={send}
      disabled={busy}
      class={cn(quietLinkBtn, 'inline-flex items-center gap-1 disabled:pointer-events-none disabled:opacity-50')}
    >
      {busy ? <Spinner /> : <Share2 size={13} strokeWidth={1.75} aria-hidden="true" />}
      Share…
    </button>
  );
}

/** On a phone, the one action: the OS sheet reaches Messages, Mail and Slack, and copies too. */
function ShareButton({ url }: { url: string }) {
  const { busy, send } = useNativeShare(url);
  return (
    <button
      type="button"
      onClick={send}
      disabled={busy}
      class={cn(submitBtn, 'h-11 w-full text-ui-lg disabled:pointer-events-none disabled:opacity-50')}
    >
      {busy ? <Spinner /> : <Share2 size={15} strokeWidth={1.75} aria-hidden="true" />}
      Share link
    </button>
  );
}

/**
 * Optional, and collapsed by default — Copy stays the one obvious action, this
 * is a quiet second path that only appears once someone reaches for it.
 * Confirms in the toast stack, which names the address it went to, and settles
 * the button on "Sent" until the next keystroke — no timer racing focus.
 */
function InviteByEmail({ id, url }: { id: string; url: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} class={quietLinkBtn}>
        Invite by email
      </button>
    );
  }

  const submit = async () => {
    const value = email.trim();
    if (!value || busy) return;
    setBusy(true);
    const error = await inviteToLink({ id, email: value, url });
    setBusy(false);
    if (error) {
      toast(error, { type: 'error' });
      return;
    }
    capture('invite_sent');
    setEmail('');
    setSent(true);
    toast(`Invite sent to ${value}`, { type: 'success' });
  };

  return (
    <form
      class="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div class={cn(geist.field, 'flex flex-1 items-center px-2.5')}>
        <input
          type="email"
          required
          autofocus
          value={email}
          placeholder="name@company.com"
          disabled={busy}
          class={cn(geist.input, 'h-full w-full')}
          onInput={(e) => {
            setEmail(e.currentTarget.value);
            if (sent) setSent(false);
          }}
        />
      </div>
      <button type="submit" class={cn(submitBtn, 'shrink-0')} disabled={busy || !email.trim()}>
        {busy ? <Spinner /> : sent ? 'Sent' : 'Invite'}
      </button>
    </form>
  );
}

/** No id yet: one honest action, not a field with nothing in it and a control that copies air. */
function CreateLink({ busy, onCreate }: { busy: boolean; onCreate: () => void }) {
  return (
    <button
      type="button"
      class={cn(submitBtn, 'w-full disabled:pointer-events-none disabled:opacity-50')}
      disabled={busy}
      onClick={onCreate}
    >
      {busy ? <Spinner /> : 'Create share link'}
    </button>
  );
}

/** Plain, not a `Popover.Description`: the card also renders inside the phone's drawer. */
function Note({ children }: { children: ComponentChildren }) {
  return <p class="text-meta leading-body m-0 text-(--ds-gray-900)">{children}</p>;
}

/** `/app/claim/:id` handles sign-in itself and keeps the id through the magic link. */
function ClaimPrompt({ id }: { id: string }) {
  return (
    <Note>
      <a
        href={`/app/claim/${encodeURIComponent(id)}`}
        onClick={() => capture('save_link_clicked')}
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
        'text-meta flex h-10 items-center justify-between px-3.5 font-medium no-underline max-md:h-12 max-md:px-4',
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

/** Opening the card is what first asks who is signed in, so a visitor who never shares never pays for it. */
function useShareOpen() {
  const [open, setOpen] = useState(false);
  const asked = useRef(false);
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && !asked.current && !user.value) {
      asked.current = true;
      void loadSession();
    }
  };
  return { open, onOpenChange };
}

/**
 * What the share card shows: the link, and for the person who owns it the
 * who-can-edit and expiry controls that used to live only on the dashboard.
 *
 * Ownership comes from the same `/auth/links` list the dashboard reads, fetched
 * the first time the card opens rather than on every viewer load.
 */
function useShareLink() {
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
  // Whichever id the card is actually showing a link for — a project or a
  // page — since inviting doesn't care which kind it is, only that one exists.
  const linkId = pid ?? id;
  const settings = renderLinkSettings({ pid, id, owned, checkingOwner: sessionLoading.value || linksLoading.value });
  return { share, pid, url, owned, linkId, settings };
}

type ShareLink = ReturnType<typeof useShareLink>;

/** The link itself, or the one action that makes it. */
function LinkOrCreate({ link }: { link: ShareLink }) {
  return link.url ? (
    <LinkField url={link.url} busy={sharing.value} onCopy={link.share} />
  ) : (
    <CreateLink busy={sharing.value} onCreate={link.share} />
  );
}

/** Everything under the link, the same on either surface. */
function ShareSections({ link }: { link: ShareLink }) {
  const { pid, linkId, settings, owned } = link;
  return (
    <>
      {linkId && (
        <>
          <div class={geist.divider} />
          <Block>
            <FeedbackButtonSection kind={pid ? 'project' : 'page'} id={linkId} />
          </Block>
        </>
      )}

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
    </>
  );
}

const SHARE_TITLE_CLS = 'text-ui tracking-ui m-0 font-semibold text-(--ds-gray-1000)';

function PopoverShareBody() {
  const link = useShareLink();
  const { url, linkId } = link;
  return (
    <>
      <Block>
        <Popover.Title className={SHARE_TITLE_CLS}>Share</Popover.Title>
        <LinkOrCreate link={link} />
        {url && linkId && (hasShareSheet ? <ShareSheet url={url} /> : <InviteByEmail id={linkId} url={url} />)}
      </Block>
      <ShareSections link={link} />
    </>
  );
}

/**
 * A phone's card leads with one full-width action at thumb height. The field
 * stays above it for anyone who wants the address itself; email invites stay
 * for the browsers with no share sheet.
 */
function DrawerShareBody() {
  const link = useShareLink();
  const { url, linkId } = link;
  return (
    <>
      <div class="flex flex-col gap-3 px-4 pt-1 pb-4">
        <h2 class="text-body m-0 font-semibold tracking-ui text-(--ds-gray-1000)">Share</h2>
        <LinkOrCreate link={link} />
        {url && hasShareSheet && <ShareButton url={url} />}
        {url && linkId && !hasShareSheet && <InviteByEmail id={linkId} url={url} />}
      </div>
      <ShareSections link={link} />
    </>
  );
}

/** The share card floating under its button in the desktop top bar. */
export function SharePopover() {
  const { open, onOpenChange } = useShareOpen();
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
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
            <PopoverShareBody />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The same card on a phone: it rises from the bottom, where the button that opened it is. */
export function ShareDrawer() {
  const { open, onOpenChange } = useShareOpen();
  return (
    <>
      <button
        type="button"
        aria-label="Share"
        aria-haspopup="dialog"
        onClick={() => onOpenChange(true)}
        class={cn(geist.ctl, open ? geist.ctlOn : geist.ctlIdle)}
      >
        <Upload size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
      <ModalSheet open={open} onOpenChange={onOpenChange} label="Share">
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <DrawerShareBody />
        </div>
      </ModalSheet>
    </>
  );
}
