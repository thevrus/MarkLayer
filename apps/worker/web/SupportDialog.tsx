import { Dialog } from '@base-ui/react/dialog';
import { submitBtn } from '@ext/lib/buttons';
import { geist } from '@ext/lib/geist';
import { glass } from '@ext/lib/glass';
import { portalContainer } from '@ext/lib/portal';
import { cn } from '@marklayer/types';
import { CHROME_STORE_URL } from '@site/lib/site';
import { CircleCheck, X } from 'lucide-preact';
import { capture } from './analytics';
import { isUnprompted, showSupportDialog } from './signals';
import {
  MONTHLY_COST_USD,
  NOTES_BEFORE_ASKING,
  noteSupportSignal,
  POLAR_CHECKOUT_URL,
  readSupportRecord,
} from './support';

/**
 * Web-app only, deliberately. In the extension this renders inside a content
 * script, where `localStorage` belongs to whatever page is being annotated — a
 * record written there scatters across every site the user visits and is never
 * readable again. The ask also does not belong on top of someone else's page.
 *
 * Unprompted, this is shown at most twice, and someone is being asked for money
 * by a tool that promised them nothing would be asked. So: first person, no
 * adjectives, one action, and an honest way out that costs them nothing.
 *
 * The header is a painted public park, and it is the argument rather than
 * decoration: a park is free to walk into and expensive to keep open, which is
 * the entire case the copy underneath is making. It is also the reason the image
 * is a painting and not a photograph — nothing here is pretending to be a
 * screenshot of anything.
 */

/** The line only earns its place when the figure is real; see MONTHLY_COST_USD. */
const cost = MONTHLY_COST_USD === null ? '' : ` It runs about $${MONTHLY_COST_USD} a month.`;

export function SupportDialog() {
  const canCheckout = POLAR_CHECKOUT_URL.length > 0;
  const trigger = showSupportDialog.value;
  // Read as it opens, before this showing's answer lands in it.
  const record = trigger === null ? null : readSupportRecord();
  const notes = record && record.notes >= NOTES_BEFORE_ASKING ? record.notes : 0;

  // Any close is an answer, even on a card they opened themselves: they have seen
  // it, and the bar and settings entries keep the door open.
  const answer = (choice: 'later' | 'never') => {
    showSupportDialog.value = null;
    noteSupportSignal(choice === 'never' ? 'optedOut' : 'answered');
    capture('support_card_dismissed', { trigger, answer: choice });
  };

  return (
    <Dialog.Root
      open={trigger !== null}
      onOpenChange={(open: boolean) => {
        if (!open) answer('later');
      }}
    >
      <Dialog.Portal container={portalContainer.value ?? undefined}>
        {/* The top layer, not one below it. The sidebars sit at 2147483647
            (PANEL_SIDEBAR, so a panel covers the toolbar), and at 2147483646 the
            scrim dimmed the page while leaving both panels at full brightness —
            a modal with two undimmed holes in it. 2147483647 is INT32_MAX, so
            there is no step above the panels to take: this matches them and wins
            on paint order instead, which is sound because the dialog portals to
            document.body and so is always the later element. */}
        <Dialog.Backdrop className="fixed inset-0 z-2147483647 bg-black/50 animate-[fadeInDown_0.15s_ease-out]" />
        <Dialog.Popup
          className={cn(
            geist.surface,
            glass.font,
            'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-2147483647',
            // No padding on the shell: the image runs to its edges and takes the
            // shell's own 12px radius from `overflow-hidden`. The copy carries
            // its own gutter instead.
            'w-[380px] max-w-[calc(100vw-32px)] overflow-hidden pointer-events-auto',
          )}
        >
          <Dialog.Close
            aria-label="Close"
            className={cn(
              geist.ctlSm,
              'absolute top-2.5 right-2.5 z-10',
              // The image is the same in both themes, so this one control cannot
              // follow the theme tokens. White glyph over the header's own
              // falloff, plus a tight low-offset shadow — never a disc behind
              // the mark.
              'text-white/90 hover:text-white hover:bg-black/25',
              'filter-[drop-shadow(0_1px_2px_rgb(0_0_0/0.5))]',
            )}
          >
            <X size={15} strokeWidth={1.5} aria-hidden="true" />
          </Dialog.Close>

          <ParkHeader />

          <div class="p-6">
            {/* Short words and short sentences, on purpose: plenty of people
                reading this are not reading in their first language, and an
                idiom is the fastest way to lose them.

                Thanks first, and the ask last. Opening on what the reader has
                already given — their use of the thing — is the difference
                between a thank-you they can ignore and a bill they cannot.

                `text-title` + `tracking-display` is the project's own headline
                recipe, the one ViewerHud sets "Desktop only" in — not a size
                invented for this card. */}
            {/* One notch tighter than `tracking-display`'s -0.02em: that value is
                tuned for the landing page's much larger steps, and wants pulling
                in at this 24px headline. */}
            <Dialog.Title className="m-0 text-title font-semibold tracking-[-0.032em] leading-tight text-balance text-(--ds-gray-1000)">
              Thanks for using MarkLayer
            </Dialog.Title>
            {/* Their own count is the plainest proof it worked for them. A floor:
                notes from before this browser started counting are not in it. */}
            <Dialog.Description className="mt-2.5 mb-0 text-ui leading-normal text-(--ds-gray-900)">
              {notes > 0 && `You have made ${notes.toLocaleString()} notes so far. `}
              It is free for everyone, and it will stay free. I pay for the servers myself.{cost} MarkLayer makes no
              money, on purpose:
            </Dialog.Description>

            <PromiseList />

            {canCheckout ? (
              <a
                href={POLAR_CHECKOUT_URL}
                // A new tab, not an in-place navigation: the annotations on screen
                // are unsaved work, and Polar's own checkout already does the
                // one-tap wallet path. The alternative, Polar's embed script,
                // would put a third-party script on an app whose whole promise is
                // that it collects nothing.
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  noteSupportSignal('supported');
                  // Where the funnel ends client-side: whether they actually paid
                  // is only knowable from Polar's webhook, server-side.
                  capture('support_checkout_opened', { trigger });
                }}
                // The shared primary, not a second copy of it: same inverted fill,
                // same focus ring, one place to change.
                class={cn(submitBtn, 'mt-5 h-10 w-full rounded-lg text-ui-lg no-underline')}
              >
                Support MarkLayer
              </a>
            ) : null}

            {/* The escape route is a text link, never a second button: most
                people will not pay, and a review is worth real money here. */}
            <p class="mt-3 mb-0 text-meta leading-snug text-(--ds-gray-900)">
              {canCheckout ? 'Or help for free: a ' : 'Free way to help: a '}
              <a
                href={CHROME_STORE_URL}
                target="_blank"
                rel="noreferrer"
                onClick={() => {
                  // The card says a review helps just as much, so it ends the ask just as a payment does.
                  noteSupportSignal('supported');
                  capture('support_review_clicked', { trigger });
                }}
                class="text-(--ds-gray-1000) underline underline-offset-2 decoration-(--ds-gray-alpha-400) hover:decoration-(--ds-gray-1000)"
              >
                Web Store review
              </a>{' '}
              helps just as much.
            </p>

            {/* A promise `shouldOfferSupport` keeps, and what makes this two asks rather than a campaign. */}
            {isUnprompted(trigger) && record ? (
              <p class="mt-2 mb-0 text-meta leading-snug text-(--ds-gray-900)">
                {record.answers === 0 ? (
                  <>
                    I may ask one more time in a month.{' '}
                    <button
                      type="button"
                      onClick={() => answer('never')}
                      class="cursor-pointer underline underline-offset-2 decoration-(--ds-gray-alpha-400) hover:text-(--ds-gray-1000) hover:decoration-(--ds-gray-1000)"
                    >
                      Don't ask again
                    </button>
                  </>
                ) : (
                  'This is the last time I will ask. Thank you either way.'
                )}
              </p>
            ) : null}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The three refusals that are the whole reason this card exists. Each one is a
 * way MarkLayer could have made money and does not, so the list is the evidence
 * for the sentence above it rather than a feature grid.
 *
 * One repeated mark, not three different icons: these are the same promise made
 * three times, and a drawer of assorted glyphs would say otherwise.
 */
const PROMISES = [
  { label: 'No ads', detail: 'Nobody pays to track you.' },
  { label: 'No accounts', detail: 'You never sign up or log in.' },
  { label: 'No paid plan', detail: 'Every feature is free.' },
];

function PromiseList() {
  return (
    <ul class="mt-4 mb-0 grid list-none gap-3 p-0">
      {PROMISES.map(({ label, detail }) => (
        // A fixed icon column, so the labels and the sub-lines start on one
        // vertical no matter how long any row's words are.
        <li key={label} class="grid grid-cols-[16px_1fr] items-start gap-x-2.5">
          {/* The label's line box is pinned to 16px so a 16px mark centres on it
              exactly, instead of being nudged by an eyeballed margin. */}
          <CircleCheck size={16} strokeWidth={1.5} class="text-(--ds-gray-900)" aria-hidden="true" />
          <div>
            <p class="m-0 text-ui leading-4 font-medium text-(--ds-gray-1000)">{label}</p>
            <p class="mt-1 mb-0 text-meta leading-snug text-(--ds-gray-900)">{detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * The park. Full-bleed to three edges so it reads as the dialog's own window
 * rather than a picture pasted inside it, taking the shell's radius from the
 * popup's `overflow-hidden`.
 *
 * Sized and cropped at build time to exactly twice its display box, so nothing
 * is downloaded that never gets shown. `loading="lazy"` is deliberate: the card
 * is rare, and nobody should pay for this file on a page that never asks.
 */
function ParkHeader() {
  return (
    // The tone is the painting's own sky, averaged. The box is already reserved
    // by the image's width/height, so nothing moves when the file lands — this
    // only decides whether the wait looks like a picture arriving or like a hole
    // in the card.
    <div class="relative bg-[#9bc8e4]">
      <img
        src="/support-park.webp"
        // Decorative: the sentence under it makes the same point in words, and a
        // description of the scenery read aloud mid-dialog is noise, not help.
        alt=""
        width={760}
        height={279}
        loading="lazy"
        decoding="async"
        draggable={false}
        class="block w-full h-auto select-none"
      />
      {/* The corner the close glyph sits in is sky and cloud, so a white X alone
          disappeared into it. This is the light falling off at the top of the
          frame — anchored at the corner, dead well before it reaches any edge,
          so it never reads as a band or a disc. It lives here rather than on the
          shell so it can never be left hanging over an empty box. */}
      <div
        aria-hidden="true"
        class="pointer-events-none absolute top-0 right-0 h-24 w-36"
        style={{
          background:
            'radial-gradient(125% 125% at 100% 0%, rgb(0 0 0 / 0.55) 0%, rgb(0 0 0 / 0.3) 34%, rgb(0 0 0 / 0.1) 56%, transparent 74%)',
        }}
      />
    </div>
  );
}
