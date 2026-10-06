/**
 * When, if ever, to offer the support card — and the record that keeps the ask
 * to the two times the card promises.
 *
 * The product's whole promise is no account and no friction, so the ask has to
 * behave the same way: it appears for people the tool has demonstrably worked
 * for, at most twice and a month apart, and never again after "Don't ask again"
 * or any help. Everything here is deliberately conservative. A prompt nobody
 * resents is worth far more than one seen by everybody.
 */

import { lsGet, lsSet } from '@ext/lib/storage';
import { type CommentStatus, type DrawOp, isAnnotationOp, isSettled, resolveOpStatus } from '@marklayer/types';

/**
 * The Polar checkout the card opens — the "Support MarkLayer" product, priced
 * pay-what-you-want with a $3 floor and $5 prefilled.
 *
 * The card's button deliberately does not name that $5: Polar is merchant of
 * record and adds VAT on top, so an EU supporter is charged $6.15. A button
 * promising a price the checkout then contradicts is a small lie.
 *
 * Left empty and the card degrades to its no-payment form rather than offering a
 * button that goes nowhere, which is also what should happen if the product is
 * ever retired.
 */
export const POLAR_CHECKOUT_URL = 'https://buy.polar.sh/polar_cl_DBsDl9Ufd2O0mOEodJrcrIDpuOu2iEc0UqG4w4cXdk2';

/**
 * What the project actually costs to run each month, or `null` while unknown.
 *
 * The line "it costs about $N a month" only works because it is true and small.
 * A guessed figure would be worse than none, so the copy drops the number
 * entirely rather than inventing one.
 */
export const MONTHLY_COST_USD: number | null = null;

/**
 * Distinct days of use before the tool has earned the right to ask.
 *
 * Was 3, and that was the whole reason nothing came in: over 90 days it
 * qualified 11 people, out of 379 who used the tool and 74 who shared a link.
 * The card itself was fine — 2 of the 12 who saw it opened the checkout — it
 * just almost never fired. At 1 the share below carries the bar alone, which is
 * the better signal anyway: sending someone a link is the tool having worked,
 * where a second calendar day is only a return visit.
 */
const DAYS_BEFORE_ASKING = 1;
/**
 * Share links created — evidence of sharing with someone, not just trying it.
 * One is the signal: at three, 4 people qualified where 31 had shared at all.
 */
const SHARES_BEFORE_ASKING = 1;
/**
 * Annotations that qualify somebody who never shares — about 80% of authors,
 * whom the share bar can never reach. Spread over `NOTE_DAYS`, so one long review
 * of one page is not mistaken for using the tool.
 */
export const NOTES_BEFORE_ASKING = 20;
const NOTE_DAYS = 2;
const DAYS_KEPT = Math.max(DAYS_BEFORE_ASKING, NOTE_DAYS);
/** Answers that end the unprompted ask for good: the first, and one more a month on. */
const MAX_ANSWERS = 2;
/** The second ask needs a month, and new use since the first answer — not the old total. */
const DAYS_BEFORE_ASKING_AGAIN = 30;
const NOTES_BEFORE_ASKING_AGAIN = 30;

const STORAGE_KEY = 'ml-support';

/**
 * What we know about one person's relationship with the tool. Local to their
 * browser and never sent anywhere: this decides whether to render a card, and
 * that decision has no business leaving the device.
 */
export interface SupportRecord {
  /** ISO dates (YYYY-MM-DD) the tool was used on, capped — only the count matters. */
  days: string[];
  /** Share links this person created, capped — only clearing the bar matters. */
  shares: number;
  /** They connected the MCP server: a developer wiring this into real work. */
  mcp: boolean;
  /** Annotations made in this browser. Uncapped: the card shows it back to them. */
  notes: number;
  /** Times the card was closed without helping, prompted or not. "Don't ask again" jumps it to the cap. */
  answers: number;
  /** Day of the latest answer, which the second ask waits a month from. */
  answeredOn: string | null;
  /** `notes` at the latest answer. */
  notesAtAnswer: number;
  /** They opened the checkout or the review link. Never ask someone who already helped. */
  supported: boolean;
}

const EMPTY: SupportRecord = {
  days: [],
  shares: 0,
  mcp: false,
  notes: 0,
  answers: 0,
  answeredOn: null,
  notesAtAnswer: 0,
  supported: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Parse defensively: a corrupt or half-written record must read as "new person", never throw. */
export function parseSupportRecord(raw: string | null): SupportRecord {
  if (!raw) return { ...EMPTY };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { ...EMPTY };
    const days = Array.isArray(parsed.days) ? parsed.days.filter((d): d is string => typeof d === 'string') : [];
    // A negative or fractional count is corruption, and `answers: -1` would buy a third ask.
    const count = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0);
    return {
      days,
      shares: count(parsed.shares),
      mcp: parsed.mcp === true,
      notes: count(parsed.notes),
      // Before the second ask existed, an answer was `asked: true` with no date.
      // It counts as one, and its month starts at the next visit (see 'used').
      answers: count(parsed.answers) || (parsed.asked === true ? 1 : 0),
      answeredOn: typeof parsed.answeredOn === 'string' ? parsed.answeredOn : null,
      notesAtAnswer: count(parsed.notesAtAnswer),
      supported: parsed.supported === true,
    };
  } catch {
    return { ...EMPTY };
  }
}

/**
 * Whether to show the card.
 *
 * The first ask has three independent qualifications, any one enough: they wired
 * up MCP (a developer using this at work), sent someone a share link (using it
 * with other people), or kept leaving notes across days (using it alone). All
 * require a day of authoring, so a read-only visitor looking at someone else's
 * page is never asked.
 *
 * The second and last ask is for whoever is still at it: a month after the first
 * answer, and with real use since.
 */
export function shouldOfferSupport({
  record,
  hasCheckout,
  date = today(),
}: {
  record: SupportRecord;
  hasCheckout: boolean;
  date?: string;
}): boolean {
  if (!hasCheckout) return false; // nothing to offer
  if (record.supported || record.answers >= MAX_ANSWERS) return false;
  if (record.answers > 0) {
    // An undated legacy answer has not started its month yet.
    if (record.answeredOn === null) return false;
    // Date-only ISO strings parse as UTC midnight; a malformed one is NaN, which never clears the bar.
    return (
      (Date.parse(date) - Date.parse(record.answeredOn)) / 86_400_000 >= DAYS_BEFORE_ASKING_AGAIN &&
      record.notes - record.notesAtAnswer >= NOTES_BEFORE_ASKING_AGAIN
    );
  }
  if (record.days.length < DAYS_BEFORE_ASKING) return false;
  if (record.mcp || record.shares >= SHARES_BEFORE_ASKING) return true;
  return record.notes >= NOTES_BEFORE_ASKING && record.days.length >= NOTE_DAYS;
}

/**
 * Whether a thread an agent claimed just settled, by the agent or by the person
 * signing it off: the MCP user's saved share. First sightings are recorded, not
 * counted, so a room that loads settled says nothing. `seen` is updated in place.
 */
export function agentWorkLanded({ seen, ops }: { seen: Map<string, CommentStatus>; ops: readonly DrawOp[] }): boolean {
  let landed = false;
  for (const op of ops) {
    if (!isAnnotationOp(op) || !op.assignedAgent) continue;
    const status = resolveOpStatus(op);
    const before = seen.get(op.id);
    if (before !== undefined && !isSettled(before) && isSettled(status)) landed = true;
    seen.set(op.id, status);
  }
  return landed;
}

/** Today in the local calendar, which is the unit "distinct days of use" is counted in. */
export function today(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** The things worth knowing about, each one folded in by `recordSignal`. */
export type SupportSignal = 'used' | 'shared' | 'mcp' | 'noted' | 'answered' | 'optedOut' | 'supported';

/**
 * Fold one signal into the record. Pure, so the decision is testable without a
 * browser and the storage layer stays a thin wrapper around it.
 *
 * `days` and `shares` each stop at their threshold: they exist to answer "enough
 * distinct days?" and "shared with anyone?", so a growing list of every date
 * someone used the tool, or a running total of their links, would store more
 * about them than the question needs. `notes` is the exception, because the card
 * shows that number back to the person it counts.
 */
export function recordSignal({
  record,
  signal,
  date = today(),
}: {
  record: SupportRecord;
  signal: SupportSignal;
  date?: string;
}): SupportRecord {
  const next: SupportRecord = { ...record, days: [...record.days] };
  switch (signal) {
    case 'used':
      if (!next.days.includes(date) && next.days.length < DAYS_KEPT) next.days.push(date);
      if (next.answers > 0 && next.answeredOn === null) next.answeredOn = date;
      break;
    case 'shared':
      if (next.shares < SHARES_BEFORE_ASKING) next.shares += 1;
      break;
    case 'mcp':
      next.mcp = true;
      break;
    case 'noted':
      next.notes += 1;
      break;
    case 'answered':
      next.answers += 1;
      next.answeredOn = date;
      next.notesAtAnswer = next.notes;
      break;
    case 'optedOut':
      next.answers = MAX_ANSWERS;
      break;
    case 'supported':
      next.supported = true;
      break;
  }
  return next;
}

// Best-effort: blocked or unavailable storage only means nobody gets asked, the safe direction to fail in.
export function readSupportRecord(): SupportRecord {
  return parseSupportRecord(lsGet(STORAGE_KEY));
}

/** Fold a signal in and persist it. Returns the new record so callers can act on it immediately. */
export function noteSupportSignal(signal: SupportSignal): SupportRecord {
  const next = recordSignal({ record: readSupportRecord(), signal });
  lsSet(STORAGE_KEY, JSON.stringify(next));
  return next;
}
