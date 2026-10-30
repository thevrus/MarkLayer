import type { ElementDetails } from '@marklayer/types';
import { detectFrameworkComponent, type FrameworkComponent } from './fiber-bridge';

export const TEXT_MAX = 200;
// Sample past TEXT_MAX so whitespace can't hide real text beyond the cut, but stay bounded:
// picking <body> would otherwise rebuild an MB-sized string to keep 200 chars.
const TEXT_SAMPLE = TEXT_MAX * 8;

const ATTR_MAX = 20;
const ATTR_VALUE_MAX = 200;
// Allowlist: attributes reach peers, D1 and agents on every op, and href/src/data-* routinely hold signed URLs or user ids.
const KEEP_ATTRS = new Set(['role', 'name', 'type', 'placeholder', 'alt', 'title', 'for', 'rel', 'target']);
const KEEP_DATA_ATTRS = new Set(['data-testid', 'data-test', 'data-cy', 'data-qa']);

const keepAttr = (name: string): boolean =>
  KEEP_ATTRS.has(name) || KEEP_DATA_ATTRS.has(name) || name.startsWith('aria-');

const CURSOR_STYLES = ['color', 'background-color', 'font-size', 'font-family', 'display', 'position'] as const;

/**
 * Collapse whitespace and truncate element text to a short, single-line summary.
 * Uses innerText (not textContent) so block-level boundaries become spaces — otherwise
 * "<h2>Step 2</h2><h3>02</h3>Tell us..." renders as "Step 202Tell us...".
 */
export function summarizeText(el: Element): { text: string; truncated: boolean } {
  const raw = el instanceof HTMLElement ? el.innerText : (el.textContent ?? '');
  const cleaned = raw.slice(0, TEXT_SAMPLE).replace(/\s+/g, ' ').trim();
  return { text: cleaned.slice(0, TEXT_MAX), truncated: cleaned.length > TEXT_MAX };
}

function pickAttributes(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { name, value } of Array.from(el.attributes)) {
    if (Object.keys(out).length >= ATTR_MAX) break;
    if (!keepAttr(name)) continue;
    out[name] = value.slice(0, ATTR_VALUE_MAX);
  }
  return out;
}

/** The six computed styles Cursor sends, always all six (an agent should see `position: static` too). */
export function getCursorStyles(el: Element): Record<string, string> {
  const cs = (el.ownerDocument.defaultView ?? window).getComputedStyle(el);
  const out: Record<string, string> = {};
  for (const key of CURSOR_STYLES) out[key] = cs.getPropertyValue(key);
  return out;
}

/** Structured per-element fields for the `target` payload; empty ones are left out. */
export function captureElementDetails({
  el,
  component,
  text,
}: {
  el: Element;
  /** Pre-computed component info; omit to detect, `null` to skip. */
  component?: FrameworkComponent | null;
  /** Pre-computed text summary; omit to recompute (forces layout). */
  text?: { text: string };
}): ElementDetails {
  const fwc = component === undefined ? detectFrameworkComponent(el) : component;
  const attributes = pickAttributes(el);
  const visibleText = (text ?? summarizeText(el)).text;
  return {
    id: el.id || undefined,
    classes: el.classList.length ? Array.from(el.classList) : undefined,
    attributes: Object.keys(attributes).length ? attributes : undefined,
    visibleText: visibleText || undefined,
    styles: getCursorStyles(el),
    component: fwc ? { framework: fwc.framework, chain: fwc.chain, source: fwc.source } : undefined,
  };
}
