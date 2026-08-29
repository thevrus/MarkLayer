/**
 * The two calls that actually show the support card.
 *
 * Kept out of `support.ts` so the decision logic stays a pure module — importing
 * the signal store there dragged the whole browser-dependent state graph into
 * its tests.
 */

import { capture } from './analytics';
import { type SupportTrigger, showSupportDialog } from './signals';
import { POLAR_CHECKOUT_URL, readSupportRecord, shouldOfferSupport } from './support';

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
