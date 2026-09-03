/**
 * When, if ever, to offer the support card — and the record that guarantees
 * "once" means once.
 *
 * The product's whole promise is no account and no friction, so the ask has to
 * behave the same way: it appears for people the tool has demonstrably worked
 * for, a single time, and never again once answered either way. Everything here
 * is deliberately conservative. A prompt nobody resents is worth far more than
 * one seen by everybody.
 */

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

/** Distinct days of use before the tool has earned the right to ask. */
const DAYS_BEFORE_ASKING = 3;
/**
 * Share links created — evidence of sharing with someone, not just trying it.
 * One is the signal: at three, 4 people qualified where 31 had shared at all.
 */
const SHARES_BEFORE_ASKING = 1;

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
  /** They have already been asked. Set once, never cleared. */
  asked: boolean;
  /** They opened the checkout. Never ask someone who already supported. */
  supported: boolean;
}

const EMPTY: SupportRecord = { days: [], shares: 0, mcp: false, asked: false, supported: false };

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
    return {
      days,
      shares: typeof parsed.shares === 'number' ? parsed.shares : 0,
      mcp: parsed.mcp === true,
      asked: parsed.asked === true,
      supported: parsed.supported === true,
    };
  } catch {
    return { ...EMPTY };
  }
}

/**
 * Whether to show the card.
 *
 * Two independent qualifications, either of which is enough on its own once the
 * day threshold is met: they wired up MCP (a developer using this at work), or
 * they have sent someone a share link (they are using it with other people). Both
 * still require the tool to have been useful across several days, because one
 * enthusiastic afternoon is not a habit.
 */
export function shouldOfferSupport({ record, hasCheckout }: { record: SupportRecord; hasCheckout: boolean }): boolean {
  if (!hasCheckout) return false; // nothing to offer
  if (record.asked || record.supported) return false; // once means once
  if (record.days.length < DAYS_BEFORE_ASKING) return false;
  return record.mcp || record.shares >= SHARES_BEFORE_ASKING;
}

/** Today in the local calendar, which is the unit "distinct days of use" is counted in. */
export function today(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** The things worth knowing about, each one folded in by `recordSignal`. */
export type SupportSignal = 'used' | 'shared' | 'mcp' | 'asked' | 'supported';

/**
 * Fold one signal into the record. Pure, so the decision is testable without a
 * browser and the storage layer stays a thin wrapper around it.
 *
 * `days` and `shares` each stop at their threshold: they exist to answer "enough
 * distinct days?" and "shared with anyone?", so a growing list of every date
 * someone used the tool, or a running total of their links, would store more
 * about them than the question needs.
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
      if (!next.days.includes(date) && next.days.length < DAYS_BEFORE_ASKING) next.days.push(date);
      break;
    case 'shared':
      if (next.shares < SHARES_BEFORE_ASKING) next.shares += 1;
      break;
    case 'mcp':
      next.mcp = true;
      break;
    case 'asked':
      next.asked = true;
      break;
    case 'supported':
      next.supported = true;
      next.asked = true;
      break;
  }
  return next;
}

/**
 * Storage access, tolerant of every way it can be unavailable: a browser with
 * site data blocked, a private window, a content script on a page whose origin
 * denies it. None of those are errors worth surfacing — they just mean nobody
 * gets asked, which is the safe direction to fail in.
 */
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readSupportRecord(): SupportRecord {
  try {
    return parseSupportRecord(storage()?.getItem(STORAGE_KEY) ?? null);
  } catch {
    return { ...EMPTY };
  }
}

/** Fold a signal in and persist it. Returns the new record so callers can act on it immediately. */
export function noteSupportSignal(signal: SupportSignal): SupportRecord {
  const next = recordSignal({ record: readSupportRecord(), signal });
  const store = storage();
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota or a blocked origin. The record is best-effort by design.
  }
  return next;
}
