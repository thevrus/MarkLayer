/**
 * The two calls that actually show the support card.
 *
 * Kept out of `support.ts` so the decision logic stays a pure module — importing
 * the signal store there dragged the whole browser-dependent state graph into
 * its tests.
 */

import { toast } from '@ext/lib/state';
import { SUPPORT_CHANNEL, SUPPORT_PAID } from '@site/lib/site';
import { capture } from './analytics';
import { type SupportTrigger, showSupportDialog } from './signals';
import { noteSupportSignal, POLAR_CHECKOUT_URL, readSupportRecord, shouldOfferSupport } from './support';

/** Open the card and count it. The only place `support_card_shown` is emitted. */
export function openSupportCard(trigger: SupportTrigger): void {
  showSupportDialog.value = trigger;
  capture('support_card_shown', { trigger });
}

/**
 * Offer the card if this person qualifies, and stay silent otherwise.
 *
 * Call at a pause after something worked — never mid-task. Safe to call as often
 * as you like: the record decides, and it can only say yes once.
 */
export function maybeOfferSupport(): void {
  const eligible = shouldOfferSupport({
    record: readSupportRecord(),
    hasCheckout: POLAR_CHECKOUT_URL.length > 0,
  });
  if (eligible) openSupportCard('auto');
}

/**
 * Listen for the thank-you `/thanks` broadcasts after a payment, and answer it
 * where the person actually is: the tab they were annotating in, which never
 * moved. The checkout opens in a new tab on purpose, so without this the ending
 * happens on a page they have to read and then close, while their work sits
 * behind it uncelebrated.
 *
 * A toast, not the dialog again. They have just paid; a second modal would be
 * the product asking for attention it no longer needs.
 *
 * Everything here is best-effort by design. Old Safari has no BroadcastChannel,
 * the editor tab may already be closed, and either way the page stands on its
 * own — so a miss costs a thank-you, never the payment or the record.
 *
 * Returns its own disposer, so the channel closes with whatever mounted it
 * rather than outliving it — a remount would otherwise stack a second listener
 * and toast twice.
 */
export function watchSupportPaid(): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  let channel: BroadcastChannel;
  try {
    channel = new BroadcastChannel(SUPPORT_CHANNEL);
  } catch {
    return () => {};
  }
  channel.onmessage = (event: MessageEvent) => {
    if (event.data !== SUPPORT_PAID) return;
    // The click already wrote this in whichever tab opened the checkout; writing
    // it again is idempotent and covers the tab that did not.
    noteSupportSignal('supported');
    // The closest the client can get to a confirmed payment: the redirect fired,
    // which `support_checkout_opened` alone never proved. It still undercounts —
    // nothing arrives if they paid with no editor left open — so read it as a
    // floor, and Polar as the ledger.
    capture('support_payment_confirmed');
    toast('Thank you. That keeps the servers on.', 'success', 6000);
  };
  return () => channel.close();
}
