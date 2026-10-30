import { MAX_STYLE_EDITS, MAX_STYLE_PROPERTY, MAX_STYLE_VALUE, type StyleEdit } from '@marklayer/types';

/**
 * The properties the CSS editor offers, in reading order: box, flow, spacing,
 * type, colour, edge. Curated rather than every computed key because a list of
 * 300+ is a search problem, and these are what a design note actually touches.
 */
const STYLE_PROPERTIES = [
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'z-index',
  'width',
  'height',
  'min-width',
  'max-width',
  'min-height',
  'max-height',
  'overflow',
  'flex-direction',
  'flex-wrap',
  'justify-content',
  'align-items',
  'gap',
  'flex',
  'grid-template-columns',
  'margin',
  'padding',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
  'text-decoration',
  'white-space',
  'color',
  'background-color',
  'opacity',
  'border',
  'border-radius',
  'box-shadow',
  'transform',
] as const;

interface StyleRow {
  property: string;
  value: string;
}

type Styled = HTMLElement | SVGElement;

/**
 * Narrow to an element with an inline `style`, against the element's own realm:
 * a node from the proxied iframe fails `instanceof` against the host window's
 * constructors, so the check has to use its document's.
 */
function styledIn(el: Element): Styled | null {
  const view = el.ownerDocument.defaultView;
  if (!view) return null;
  return el instanceof view.HTMLElement || el instanceof view.SVGElement ? el : null;
}

/** Computed values for the curated list, read through the element's own window so iframe content resolves. */
export function readStyles(el: Element): StyleRow[] {
  const computed = el.ownerDocument.defaultView?.getComputedStyle(el);
  return STYLE_PROPERTIES.map((property) => ({ property, value: computed?.getPropertyValue(property).trim() ?? '' }));
}

/** What one touched property started as and is now, the input `toStyleEdits` reduces. */
interface TouchedStyle {
  property: string;
  /** Computed value before the first edit. */
  from: string;
  /** What the reviewer typed. */
  to: string;
  /** Computed value with the edit applied; equal to `from` when it changed nothing the page renders. */
  settled: string;
}

const clip = ({ s, max }: { s: string; max: number }) => (s.length > max ? s.slice(0, max) : s);

/**
 * The wire diff: unchanged properties dropped, and every string clipped to the
 * schema's caps, since the room rejects an op that exceeds them outright.
 */
export function toStyleEdits(touched: readonly TouchedStyle[]): StyleEdit[] {
  return touched
    .filter(({ from, to, settled }) => to.trim() !== from && settled !== from)
    .slice(0, MAX_STYLE_EDITS)
    .map(({ property, from, to }) => ({
      property: clip({ s: property, max: MAX_STYLE_PROPERTY }),
      from: clip({ s: from, max: MAX_STYLE_VALUE }),
      to: clip({ s: to.trim(), max: MAX_STYLE_VALUE }),
    }));
}

/**
 * Step the one number in a value like `12px`, `-0.5em` or `1.5`; null for
 * anything else (`auto`, `0px 8px`, a colour), which has no single number to move.
 */
export function nudgeValue({ value, delta }: { value: string; delta: number }): string | null {
  const m = /^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i.exec(value.trim());
  if (!m) return null;
  const next = Math.round((Number(m[1]) + delta) * 1000) / 1000;
  return `${next}${m[2]}`;
}

const COLOR_VALUE = /^(#[0-9a-f]{3,8}|(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(.*\))$/i;

/** True for a value a swatch can show: one colour, not a shorthand that merely contains one. */
export const isColorValue = (value: string) => COLOR_VALUE.test(value.trim());

export interface StyleSession {
  /** Preview `value` inline. False when the browser rejected it, which leaves the property as it was. */
  apply(edit: { property: string; value: string }): boolean;
  /** Put one property back to its inline value from before the session. */
  revert(property: string): void;
  /** Restore the `style` attribute byte for byte, or its absence. */
  revertAll(): void;
  edits(): StyleEdit[];
}

interface Original {
  from: string;
  inline: string;
  priority: string;
  to: string;
}

/**
 * Live edits on one element. Edits go in as `!important` inline declarations so
 * the preview beats the page's own `!important` rules; that is safe because the
 * attribute snapshot, not a per-declaration undo, is what `revertAll` restores.
 */
export function createStyleSession(el: Element): StyleSession {
  const target = styledIn(el);
  const attr = el.getAttribute('style');
  const originals = new Map<string, Original>();
  const computed = () => el.ownerDocument.defaultView?.getComputedStyle(el);

  const restoreAttribute = () => {
    if (attr === null) el.removeAttribute('style');
    else el.setAttribute('style', attr);
  };

  return {
    apply({ property, value }) {
      if (!target) return false;
      let original = originals.get(property);
      if (!original) {
        original = {
          from: computed()?.getPropertyValue(property).trim() ?? '',
          inline: target.style.getPropertyValue(property),
          priority: target.style.getPropertyPriority(property),
          to: '',
        };
        originals.set(property, original);
      }
      original.to = value;
      const trimmed = value.trim();
      // Cleared first: an invalid value is a silent no-op, which would leave the last valid preview reading as accepted.
      target.style.removeProperty(property);
      if (attr === null && !target.style.length) target.removeAttribute('style');
      if (!trimmed) return true;
      target.style.setProperty(property, trimmed, 'important');
      if (target.style.getPropertyValue(property) !== '') return true;
      if (original.inline) target.style.setProperty(property, original.inline, original.priority);
      return false;
    },

    revert(property) {
      const original = originals.get(property);
      if (!target || !original) return;
      originals.delete(property);
      // With nothing else touched, the snapshot is exact where re-setting a declaration may reserialize it.
      if (!originals.size) return restoreAttribute();
      if (original.inline) target.style.setProperty(property, original.inline, original.priority);
      else target.style.removeProperty(property);
      if (attr === null && !target.style.length) target.removeAttribute('style');
    },

    revertAll() {
      if (!originals.size) return;
      originals.clear();
      restoreAttribute();
    },

    edits() {
      const now = computed();
      return toStyleEdits(
        [...originals].map(([property, { from, to }]) => ({
          property,
          from,
          to,
          settled: now?.getPropertyValue(property).trim() ?? '',
        })),
      );
    },
  };
}
