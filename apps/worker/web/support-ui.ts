/**
 * The two calls that actually show the support card.
 *
 * Kept out of `support.ts` so the decision logic stays a pure module — importing
 * the signal store there dragged the whole browser-dependent state graph into
 * its tests.
 */

import { onOpMade, operations, toast } from '@ext/lib/state';
import { type CommentStatus, isAnnotationOp } from '@marklayer/types';
import { effect } from '@preact/signals';
import { SUPPORT_CHANNEL, SUPPORT_PAID } from '@site/lib/site';
import { capture } from './analytics';
import { STILL_FRAME, type SupportTrigger, showSupportDialog, type UnpromptedTrigger } from './signals';
import {
  agentWorkLanded,
  noteSupportSignal,
  POLAR_CHECKOUT_URL,
  readSupportRecord,
  shouldOfferSupport,
} from './support';

/** Quiet time after the last thing an agent settles, so the card follows a batch instead of interrupting it. */
const AGENT_QUIET_MS = 4000;
/** Quiet time after the last note, so the card lands between notes rather than on one. */
const NOTE_QUIET_MS = 10_000;

/** Open the card and count it. The only place `support_card_shown` is emitted. */
export function openSupportCard(trigger: SupportTrigger): void {
  const { answers, notes } = readSupportRecord();
  showSupportDialog.value = trigger;
  capture('support_card_shown', { trigger, ask: answers + 1, notes });
}

/**
 * Offer the card if this person qualifies, and stay silent otherwise.
 *
 * Call at a pause after something worked — never mid-task. Safe to call as often
 * as you like: the record decides, and an answer moves it past each ask.
 */
export function maybeOfferSupport(trigger: UnpromptedTrigger = 'auto'): void {
  // The landing page's demo is a playground, and a modal in its hero the worst place to ask.
  if (STILL_FRAME) return;
  // The answer is only written on dismissal, so a second call while the card is
  // up would pass the record and count the same showing twice.
  if (showSupportDialog.value !== null) return;
  const eligible = shouldOfferSupport({
    record: readSupportRecord(),
    hasCheckout: POLAR_CHECKOUT_URL.length > 0,
  });
  if (eligible) openSupportCard(trigger);
}

/**
 * Offer the card once an agent has finished work it took on in this room.
 * Returns its disposer, which also drops an offer still waiting for quiet.
 */
export function watchAgentWork(): () => void {
  const seen = new Map<string, CommentStatus>();
  let timer: number | undefined;
  const stop = effect(() => {
    if (!agentWorkLanded({ seen, ops: operations.value })) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => maybeOfferSupport('agent'), AGENT_QUIET_MS);
  });
  return () => {
    stop();
    window.clearTimeout(timer);
  };
}

/**
 * Count this person's notes, and offer the card at the first real pause once
 * they qualify. Returns its disposer, which also drops an offer still waiting.
 */
export function watchNotes(): () => void {
  let timer: number | undefined;
  // Pen strokes and labels are marks, not notes; a reply is a note.
  onOpMade.value = (op) => {
    if (!isAnnotationOp(op)) return;
    noteSupportSignal('noted');
    window.clearTimeout(timer);
    // Still typing is not a pause. The next note re-arms this, so a skipped offer is only postponed.
    timer = window.setTimeout(() => {
      if (!isTyping()) maybeOfferSupport('notes');
    }, NOTE_QUIET_MS);
  };
  return () => {
    onOpMade.value = null;
    window.clearTimeout(timer);
  };
}

function isTyping(): boolean {
  let el = document.activeElement;
  // Focus inside the framed page reads as the <iframe> itself. The proxy serves
  // it same-origin, so look inside it.
  while (el instanceof HTMLIFrameElement) el = el.contentDocument?.activeElement ?? null;
  if (!el) return false;
  // Not `instanceof HTMLElement`: an element from the frame belongs to the frame's realm.
  return (
    el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || ('isContentEditable' in el && el.isContentEditable === true)
  );
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
    toast('Thank you. That keeps the servers on.', { type: 'success', duration: 6000 });
  };
  return () => channel.close();
}
