import type { TargetElement } from '@marklayer/types';
import { detectFrameworkComponent, type FrameworkComponent } from './fiber-bridge';

export type { FrameworkComponent } from './fiber-bridge';

/**
 * True for any element belonging to MarkLayer's own injected UI. Used by every
 * tool layer when picking the underlying page element so we never attribute
 * a comment/area/inspect target to our own toolbar or pin.
 */
export function isExtensionElement(el: Element | null): boolean {
  if (!el) return true;
  if (el.tagName === 'MARK-LAYER') return true;
  if (el.hasAttribute?.('data-marklayer-inspect')) return true;
  return !!el.closest?.('mark-layer');
}

/**
 * Pick the topmost page element at viewport (x, y), skipping extension UI and
 * the document root — anchoring an annotation to `<body>` or `<html>` is never
 * what the user means. Pass a `doc` (e.g. an iframe's contentDocument) to pick
 * inside that frame; the extension-UI skip only applies to the host document.
 */
export function pickElementAtPoint(x: number, y: number, doc: Document = document): Element | null {
  const stack = doc.elementsFromPoint(x, y);
  for (const el of stack) {
    if (doc === document && isExtensionElement(el)) continue;
    if (el === doc.body || el === doc.documentElement) continue;
    return el;
  }
  return null;
}

/** Collapse runs of whitespace to a single space and trim. */
export function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Normalized short text fingerprint for fallback element resolution. */
export const FINGERPRINT_LEN = 50;
export function textFingerprint(el: Element): string | undefined {
  const raw = el instanceof HTMLElement ? el.innerText : (el.textContent ?? '');
  if (!raw) return undefined;
  // Slice first to bound the cost on large nodes — even a 50-char fingerprint
  // doesn't need to walk MB of text.
  const cleaned = normalizeText(raw.slice(0, FINGERPRINT_LEN * 4));
  if (!cleaned) return undefined;
  return cleaned.slice(0, FINGERPRINT_LEN);
}

/**
 * Snapshot an element into the agent-readable target shape. Used by Comment,
 * Area, and Selection tools so MCP-connected agents see the same selector +
 * markdown context that the dedicated Inspect tool produces. The element's
 * own ownerDocument/defaultView provides the scroll origin, so this works
 * uniformly for host-page and iframe elements.
 *
 * `anchorDocXY` (optional) is the annotation's anchor point in document px
 * (e.g. comment pin position, area top-left, selection's first rect origin).
 * When provided, the returned target carries `offsetX/offsetY` — the offset
 * from the element's top-left to that anchor — so the renderer can reproject
 * the annotation against the element's *current* rect on screens where the
 * page has reflowed.
 */
export function captureTarget(el: Element, anchorDocXY?: { x: number; y: number }): TargetElement {
  const selector = getSelector(el);
  const rect = el.getBoundingClientRect();
  const win = el.ownerDocument.defaultView ?? window;
  const docX = rect.x + win.scrollX;
  const docY = rect.y + win.scrollY;
  return {
    selector,
    tag: el.tagName.toLowerCase(),
    markdown: formatForAI(el, selector),
    rect: { x: docX, y: docY, width: rect.width, height: rect.height },
    offsetX: anchorDocXY ? anchorDocXY.x - docX : undefined,
    offsetY: anchorDocXY ? anchorDocXY.y - docY : undefined,
    text: textFingerprint(el),
  };
}

// Test/automation hooks — most stable identifier any sensible app exposes
const STABLE_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa'] as const;

// Tailwind utility detection — these classes change with every redesign and
// shouldn't anchor a selector. Heuristic: known keywords + value-shaped prefixes
// + arbitrary values + variant modifiers.
const TW_KEYWORDS = new Set<string>([
  'flex',
  'grid',
  'block',
  'inline',
  'inline-block',
  'inline-flex',
  'inline-grid',
  'contents',
  'hidden',
  'visible',
  'invisible',
  'absolute',
  'relative',
  'fixed',
  'sticky',
  'static',
  'italic',
  'not-italic',
  'underline',
  'overline',
  'no-underline',
  'line-through',
  'antialiased',
  'subpixel-antialiased',
  'truncate',
  'uppercase',
  'lowercase',
  'capitalize',
  'normal-case',
  'rounded',
  'border',
  'shadow',
  'group',
  'peer',
  'transition',
  'transform',
  'sr-only',
  'not-sr-only',
  'isolate',
  'isolation-auto',
]);
const TW_PREFIXES: readonly string[] = [
  'p-',
  'm-',
  'pt-',
  'pr-',
  'pb-',
  'pl-',
  'px-',
  'py-',
  'mt-',
  'mr-',
  'mb-',
  'ml-',
  'mx-',
  'my-',
  '-m-',
  '-mt-',
  '-mr-',
  '-mb-',
  '-ml-',
  '-mx-',
  '-my-',
  'w-',
  'h-',
  'min-w-',
  'min-h-',
  'max-w-',
  'max-h-',
  'top-',
  'left-',
  'right-',
  'bottom-',
  'inset-',
  'z-',
  'gap-',
  'space-x-',
  'space-y-',
  'flex-',
  'grid-',
  'col-',
  'row-',
  'order-',
  'items-',
  'justify-',
  'content-',
  'self-',
  'place-',
  'text-',
  'font-',
  'leading-',
  'tracking-',
  'line-clamp-',
  'whitespace-',
  'break-',
  'underline-',
  'decoration-',
  'bg-',
  'from-',
  'via-',
  'to-',
  'border-',
  'divide-',
  'outline-',
  'ring-',
  'rounded-',
  'shadow-',
  'opacity-',
  'transition-',
  'duration-',
  'ease-',
  'delay-',
  'animate-',
  'transform-',
  'scale-',
  'rotate-',
  'translate-',
  'skew-',
  'origin-',
  'cursor-',
  'select-',
  'pointer-events-',
  'overflow-',
  'overscroll-',
  'fill-',
  'stroke-',
  'object-',
  'backdrop-',
  'filter-',
  'blur-',
  'brightness-',
  'contrast-',
  'saturate-',
  'placeholder-',
  'caret-',
  'aspect-',
  'columns-',
  'will-change-',
  'touch-',
  'snap-',
  'mix-blend-',
];

function looksTailwind(c: string): boolean {
  if (TW_KEYWORDS.has(c)) return true;
  // Variant modifier (hover:, dark:, md:, group-hover:), arbitrary value ([..]), responsive ratio
  if (c.includes(':') || c.includes('[') || c.includes('/')) return true;
  for (const p of TW_PREFIXES) if (c.startsWith(p)) return true;
  return false;
}

function semanticClasses(el: Element): string[] {
  const out: string[] = [];
  for (const c of Array.from(el.classList)) {
    if (!c || c.length > 60) continue;
    if (c.startsWith(':')) continue;
    if (looksTailwind(c)) continue;
    out.push(c);
  }
  return out;
}

function isValidId(id: string | undefined | null): id is string {
  return !!id && !/^[0-9]/.test(id) && !/\s/.test(id);
}

function attrSelector(name: string, value: string): string {
  return `[${name}="${value.replace(/[\\"]/g, '\\$&')}"]`;
}

function getStableAttr(el: Element): string | null {
  for (const a of STABLE_ATTRS) {
    const v = el.getAttribute(a);
    if (v) return attrSelector(a, v);
  }
  return null;
}

interface Segment {
  selector: string;
  /** True for identifiers that uniquely describe the element regardless of ancestors (id, data-testid). */
  standalone: boolean;
  /** True if the segment already disambiguates same-tag siblings (no nth-of-type needed). */
  disambiguated: boolean;
}

function elementSegment(el: Element): Segment {
  const tag = el.tagName.toLowerCase();

  const stable = getStableAttr(el);
  if (stable) return { selector: tag + stable, standalone: true, disambiguated: true };

  if (isValidId(el.id)) {
    return { selector: `${tag}#${CSS.escape(el.id)}`, standalone: true, disambiguated: true };
  }

  // ARIA + form-field attributes — semantically stable, often unique among siblings
  let attrPart = '';
  const role = el.getAttribute('role');
  if (role) attrPart += attrSelector('role', role);
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.length < 50) attrPart += attrSelector('aria-label', ariaLabel);
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    const name = el.getAttribute('name');
    if (name) attrPart += attrSelector('name', name);
    if (tag === 'input') {
      const type = el.getAttribute('type');
      if (type) attrPart += attrSelector('type', type);
    }
  }
  if (attrPart) return { selector: tag + attrPart, standalone: false, disambiguated: false };

  const sem = semanticClasses(el);
  if (sem.length > 0) {
    const classPart = sem
      .slice(0, 3)
      .map((c) => CSS.escape(c))
      .join('.');
    return { selector: `${tag}.${classPart}`, standalone: false, disambiguated: false };
  }

  return { selector: tag, standalone: false, disambiguated: false };
}

const SELECTOR_CACHE = new WeakMap<Element, string>();

/**
 * Generate a stable CSS selector for an element. Prefers identifiers in this order:
 * data-testid → id → role+aria-label → name+type → semantic classes → nth-of-type fallback.
 * Filters Tailwind utility classes (volatile across redesigns).
 */
export function getSelector(el: Element): string {
  const cached = SELECTOR_CACHE.get(el);
  if (cached) return cached;
  const result = computeSelector(el);
  SELECTOR_CACHE.set(el, result);
  return result;
}

function computeSelector(el: Element): string {
  const doc = el.ownerDocument;

  // Try element-level standalone selectors first
  const stable = getStableAttr(el);
  if (stable) {
    try {
      if (doc.querySelectorAll(stable).length === 1) return stable;
    } catch {
      /* ignore malformed attr value */
    }
  }
  if (isValidId(el.id)) {
    const sel = `#${CSS.escape(el.id)}`;
    try {
      if (doc.querySelectorAll(sel).length === 1) return sel;
    } catch {
      /* ignore */
    }
  }

  const parts: string[] = [];
  let current: Element | null = el;

  while (current && current !== doc.documentElement) {
    if (current === doc.body) {
      parts.unshift('body');
      break;
    }

    const seg = elementSegment(current);
    let segment = seg.selector;

    // Add nth-of-type if siblings of the same tag would also match
    if (!seg.disambiguated) {
      const parent = current.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((c) => c.tagName === current!.tagName);
        if (sameTag.length > 1) {
          let matchedSiblings = sameTag;
          try {
            matchedSiblings = Array.from(parent.querySelectorAll(`:scope > ${segment}`));
          } catch {
            /* fall back to tag-only count */
          }
          if (matchedSiblings.length > 1) {
            segment += `:nth-of-type(${sameTag.indexOf(current) + 1})`;
          }
        }
      }
    }

    parts.unshift(segment);

    const candidate = parts.join(' > ');
    try {
      if (doc.querySelectorAll(candidate).length === 1) break;
    } catch {
      /* ignore parse errors and keep walking up */
    }

    if (seg.standalone) break;
    current = current.parentElement;
  }

  return parts.join(' > ');
}

const CAMEL_RE = /[A-Z]/g;
function toKebab(s: string): string {
  return s.replace(CAMEL_RE, (m) => `-${m.toLowerCase()}`);
}

const STYLE_KEYS = [
  'color',
  'backgroundColor',
  'fontSize',
  'fontWeight',
  'fontFamily',
  'padding',
  'margin',
  'display',
  'position',
  'borderRadius',
  'gap',
  'flexDirection',
  'alignItems',
  'justifyContent',
] as const;

const KEBAB_KEYS = STYLE_KEYS.map(toKebab);
const SKIP_VALUES = new Set(['', 'none', 'normal', 'auto', '0px', 'rgba(0, 0, 0, 0)']);
const FLEX_PROPS = new Set(['flex-direction', 'align-items', 'justify-content', 'gap']);
const TEXT_PROPS = new Set(['color', 'font-size', 'font-weight', 'font-family']);
// Tags that don't render their own text content — text styles are inherited but irrelevant.
const NON_TEXT_TAGS = new Set(['img', 'video', 'audio', 'iframe', 'canvas', 'svg', 'embed', 'object']);

const FLEX_LAYOUT_KEYS = ['flex-direction', 'align-items', 'justify-content', 'flex-wrap', 'gap'] as const;
const GRID_LAYOUT_KEYS = ['grid-template-columns', 'grid-template-rows', 'gap'] as const;

let _tailwindCache: boolean | null = null;

/**
 * Detect whether the page uses Tailwind by sniffing its preflight signature in any
 * accessible stylesheet — Tailwind 3+ emits `--tw-*` custom properties on `*` selectors.
 * Cached at module level (fresh per page navigation, since content scripts are re-injected).
 * Skips cross-origin stylesheets (cssRules access throws).
 */
export function detectTailwind(doc: Document = document): boolean {
  if (_tailwindCache !== null) return _tailwindCache;
  for (const sheet of doc.styleSheets) {
    try {
      const rules = sheet.cssRules;
      const limit = Math.min(rules.length, 50);
      for (let i = 0; i < limit; i++) {
        if (rules[i].cssText.includes('--tw-')) {
          _tailwindCache = true;
          return true;
        }
      }
    } catch {
      // Cross-origin stylesheet — can't read
    }
  }
  _tailwindCache = false;
  return false;
}

/**
 * Layout context contributed by the parent — usually more decisive than the element's own
 * styles for explaining how the element is positioned. Returns null when the parent uses
 * default block flow (nothing interesting to report).
 */
export function getParentLayout(el: Element): Record<string, string> | null {
  const parent = el.parentElement;
  if (!parent) return null;
  const cs = getComputedStyle(parent);
  const display = cs.display;
  const isFlex = display === 'flex' || display === 'inline-flex';
  const isGrid = display === 'grid' || display === 'inline-grid';
  if (!isFlex && !isGrid) return null;
  const out: Record<string, string> = { display };
  const keys = isFlex ? FLEX_LAYOUT_KEYS : GRID_LAYOUT_KEYS;
  for (const k of keys) {
    const v = cs.getPropertyValue(k);
    if (!SKIP_VALUES.has(v)) out[k] = v;
  }
  return out;
}

/**
 * Serialize the element to outerHTML, but collapse subtrees deeper than maxDepth into a
 * `<!-- N children -->` comment so the AI sees structure without paragraphs of markup.
 * Caps total length so very-attribute-heavy elements (style="…") don't blow up the prompt.
 */
export function truncateOuterHTML(el: Element, maxDepth = 2, maxLen = 600): string {
  const clone = el.cloneNode(true) as Element;
  const trim = (node: Element, depth: number): void => {
    if (depth >= maxDepth) {
      if (node.children.length > 0) {
        const count = node.children.length;
        node.replaceChildren(node.ownerDocument.createComment(` ${count} children `));
      }
      return;
    }
    for (const child of Array.from(node.children)) trim(child, depth + 1);
  };
  trim(clone, 0);
  const html = clone.outerHTML;
  if (html.length <= maxLen) return html;
  let cut = html.slice(0, maxLen - 1);
  // Avoid splitting a UTF-16 surrogate pair (emoji, astral chars) — leave a lone surrogate behind.
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** Extract key computed styles, returned with kebab-case keys */
export function getKeyStyles(el: Element): Record<string, string> {
  const cs = getComputedStyle(el);
  const pick: Record<string, string> = {};
  const display = cs.getPropertyValue('display');
  const isFlexLike = display === 'flex' || display === 'inline-flex' || display === 'grid' || display === 'inline-grid';
  const isNonText = NON_TEXT_TAGS.has(el.tagName.toLowerCase());
  for (let i = 0; i < KEBAB_KEYS.length; i++) {
    const key = KEBAB_KEYS[i];
    const v = cs.getPropertyValue(key);
    if (SKIP_VALUES.has(v)) continue;
    if (key === 'position' && v === 'static') continue;
    if (!isFlexLike && FLEX_PROPS.has(key)) continue;
    if (isNonText && TEXT_PROPS.has(key)) continue;
    pick[key] = v;
  }
  return pick;
}

/** First N class names joined with `.`, e.g. `flex.items-center`. Allocation-free vs `Array.from`. */
export function shortClassLabel(el: Element, max = 2): string {
  const list = el.classList;
  let result = '';
  for (let i = 0; i < list.length && i < max; i++) {
    result += i === 0 ? list[i] : `.${list[i]}`;
  }
  return result;
}

export const ELEMENT_INSPECTOR_HEADING = '## Element Inspector';

const TEXT_MAX = 120;
// Sample more than TEXT_MAX × ratio so whitespace can't hide non-WS content past the cut.
// Picking <body> or large articles otherwise rebuilds MB-sized strings just to slice 120 chars.
const TEXT_SAMPLE = TEXT_MAX * 8;

/**
 * Collapse whitespace and truncate element text to a short, single-line summary.
 * Uses innerText (not textContent) so block-level boundaries become spaces — otherwise
 * "<h2>Step 2</h2><h3>02</h3>Tell us..." renders as "Step 202Tell us...".
 * innerText forces a layout, but inspector picks are infrequent.
 */
function summarizeText(el: Element): { text: string; truncated: boolean } {
  const raw = el instanceof HTMLElement ? el.innerText : (el.textContent ?? '');
  const cleaned = raw.slice(0, TEXT_SAMPLE).replace(/\s+/g, ' ').trim();
  return {
    text: cleaned.slice(0, TEXT_MAX),
    truncated: cleaned.length > TEXT_MAX,
  };
}

export interface FormatForAIOptions {
  styles?: Record<string, string>;
  rect?: { width: number; height: number };
  /** Pre-computed component info; pass `null` to skip detection, omit to detect lazily. */
  component?: FrameworkComponent | null;
  /** Pre-computed text summary; omit to recompute. `summarizeText` calls innerText (forces layout). */
  textSummary?: { text: string; truncated: boolean };
  /** Pre-computed CSS stack; pass `null` to skip detection, omit to detect lazily. */
  cssStack?: CssStack | null;
  /** Verbatim text the user highlighted, included so AI agents can grep for the exact string. */
  selectedText?: string;
  /**
   * Verbosity tier (strict superset ladder, matching Agentation):
   *   compact   — selector + size only
   *   standard  — adds component, viewport, text, markup HTML  (default)
   *   detailed  — adds parent layout + ancestor hierarchy
   *   forensic  — adds computed styles
   */
  detail?: OutputDetail;
}

export type OutputDetail = 'compact' | 'standard' | 'detailed' | 'forensic';

const DETAIL_RANK: Record<OutputDetail, number> = { compact: 0, standard: 1, detailed: 2, forensic: 3 };
const atLeast = (level: OutputDetail, threshold: OutputDetail) => DETAIL_RANK[level] >= DETAIL_RANK[threshold];

/** Format element info as markdown for AI tools */
export function formatForAI(el: Element, selector: string, opts: FormatForAIOptions = {}): string {
  const detail: OutputDetail = opts.detail ?? 'standard';
  const dims = opts.rect ?? el.getBoundingClientRect();
  const doc = el.ownerDocument;
  const win = doc.defaultView ?? window;

  let md = `${ELEMENT_INSPECTOR_HEADING}\n\n`;
  if (win.location.href) {
    const title = doc.title.trim();
    md += title ? `**Page:** ${title} — ${win.location.href}\n` : `**Page:** ${win.location.href}\n`;
  }
  md += `**Selector:** \`${selector}\`\n`;
  md += `**Size:** ${Math.round(dims.width)}×${Math.round(dims.height)}px\n`;

  // Compact stops here — just enough for an agent to grep and locate the element.
  if (!atLeast(detail, 'standard')) return md;

  const fwc = opts.component === undefined ? detectFrameworkComponent(el) : opts.component;
  if (fwc) {
    if (fwc.chain.length) md += `**${fwc.framework} Component:** ${fwc.chain.join(' ← ')}\n`;
    if (fwc.source) {
      const col = fwc.source.columnNumber !== undefined ? `:${fwc.source.columnNumber}` : '';
      md += `**Source:** ${fwc.source.fileName}:${fwc.source.lineNumber}${col}\n`;
    }
  }
  const cssStack = opts.cssStack === undefined ? (detectTailwind(doc) ? 'Tailwind' : null) : opts.cssStack;
  if (cssStack) md += `**CSS Stack:** ${cssStack}\n`;
  const dpr = win.devicePixelRatio;
  const dprPart = dpr !== 1 ? ` @ ${dpr}x` : '';
  md += `**Viewport:** ${win.innerWidth}×${win.innerHeight}px${dprPart}\n`;
  const { text, truncated } = opts.textSummary ?? summarizeText(el);
  if (text) md += `**Text:** "${truncated ? `${text}…` : text}"\n`;
  if (opts.selectedText) {
    // Collapse internal newlines so the quote stays on one line for grep-friendly AI output.
    const oneLine = opts.selectedText.replace(/\s+/g, ' ').trim();
    if (oneLine) md += `**Selected text:** "${oneLine}"\n`;
  }

  md += `\n**Markup:**\n\`\`\`html\n${truncateOuterHTML(el)}\n\`\`\`\n`;

  if (!atLeast(detail, 'detailed')) return md;

  const parentLayout = getParentLayout(el);
  if (parentLayout) {
    md += '\n**Parent Layout:**\n```css\n';
    for (const [k, v] of Object.entries(parentLayout)) {
      md += `${k}: ${v};\n`;
    }
    md += '```\n';
  }

  const body = el.ownerDocument.body;
  const ancestry: string[] = [];
  let p: Element | null = el;
  while (p && p !== body && ancestry.length < 5) {
    let label = p.tagName.toLowerCase();
    if (p.id) label += `#${p.id}`;
    else if (p.classList.length) label += `.${shortClassLabel(p)}`;
    ancestry.push(label);
    p = p.parentElement;
  }
  if (ancestry.length > 1) {
    md += `\n**Hierarchy:** ${ancestry.reverse().join(' > ')}\n`;
  }

  if (!atLeast(detail, 'forensic')) return md;

  const resolved = opts.styles ?? getKeyStyles(el);
  if (Object.keys(resolved).length) {
    md += '\n**Computed Styles:**\n```css\n';
    for (const [k, v] of Object.entries(resolved)) {
      md += `${k}: ${v};\n`;
    }
    md += '```\n';
  }

  return md;
}

export type CssStack = 'Tailwind';

/** Snapshot element data for the inspector panel */
export interface SelectedInfo {
  selector: string;
  tag: string;
  id: string;
  classes: string;
  rect: DOMRect;
  styles: Record<string, string>;
  text: string;
  markdown: string;
  viewport: { width: number; height: number; dpr: number };
  component: FrameworkComponent | null;
  cssStack: CssStack | null;
}

/**
 * Structured view of a comment whose body was generated by `formatForAI`. Used
 * by `CommentPin` to render the hover card with the same labeled layout as the
 * live Inspect panel instead of dumping a wall of markdown.
 */
export interface ParsedInspectorComment {
  /** The user's typed instruction, if any (from the leading `## Task` block). */
  task: string | null;
  /** Field rows in the order they appear, e.g. [['Selector', '`h1`'], ['Size', '576×189px'], ...]. */
  fields: Array<[label: string, value: string]>;
  /** Markup HTML inside the trailing fenced code block, if present. */
  markup: string | null;
}

const INSPECTOR_FIELD_RE = /^\*\*([^*]+):\*\*\s*(.+)$/;
const INSPECTOR_MARKUP_RE = /\n\*\*Markup:\*\*\s*\n```html\n([\s\S]*?)\n```/;

export function parseInspectorComment(text: string): ParsedInspectorComment | null {
  if (!text.includes(ELEMENT_INSPECTOR_HEADING)) return null;

  let task: string | null = null;
  let body = text;
  if (text.startsWith('## Task')) {
    const split = text.indexOf(ELEMENT_INSPECTOR_HEADING);
    if (split > 0) {
      task = text.slice('## Task'.length, split).trim() || null;
      body = text.slice(split);
    }
  }

  const markupMatch = body.match(INSPECTOR_MARKUP_RE);
  const markup = markupMatch ? markupMatch[1].trim() : null;
  const beforeMarkup = markupMatch ? body.slice(0, markupMatch.index) : body;

  const fields: Array<[string, string]> = [];
  for (const line of beforeMarkup.split('\n')) {
    const m = line.match(INSPECTOR_FIELD_RE);
    if (m) fields.push([m[1].trim(), m[2].trim()]);
  }

  return { task, fields, markup };
}

export function snapshotElement(
  el: Element,
  selector: string,
  viewportRect: DOMRect,
  detail: OutputDetail = 'standard',
): SelectedInfo {
  const styles = getKeyStyles(el);
  const component = detectFrameworkComponent(el);
  const textSummary = summarizeText(el);
  const cssStack: CssStack | null = detectTailwind(el.ownerDocument) ? 'Tailwind' : null;
  const win = el.ownerDocument.defaultView ?? window;
  return {
    selector,
    tag: el.tagName.toLowerCase(),
    id: el.id,
    classes: el.classList.value,
    rect: viewportRect,
    styles,
    text: textSummary.text,
    markdown: formatForAI(el, selector, { styles, rect: viewportRect, component, textSummary, cssStack, detail }),
    viewport: { width: win.innerWidth, height: win.innerHeight, dpr: win.devicePixelRatio },
    component,
    cssStack,
  };
}

export interface BoxModelRects {
  marginBox: { x: number; y: number; w: number; h: number };
  borderBox: { x: number; y: number; w: number; h: number };
  paddingBox: { x: number; y: number; w: number; h: number };
  contentBox: { x: number; y: number; w: number; h: number };
}

/** Compute 4 nested box-model rects from an element's bounding rect + computed styles */
export function getBoxModel(el: Element): BoxModelRects {
  const rect = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const mt = parseFloat(cs.marginTop) || 0;
  const mr = parseFloat(cs.marginRight) || 0;
  const mb = parseFloat(cs.marginBottom) || 0;
  const ml = parseFloat(cs.marginLeft) || 0;
  const bt = parseFloat(cs.borderTopWidth) || 0;
  const br = parseFloat(cs.borderRightWidth) || 0;
  const bb = parseFloat(cs.borderBottomWidth) || 0;
  const blw = parseFloat(cs.borderLeftWidth) || 0;
  const pt = parseFloat(cs.paddingTop) || 0;
  const pr = parseFloat(cs.paddingRight) || 0;
  const pb = parseFloat(cs.paddingBottom) || 0;
  const plv = parseFloat(cs.paddingLeft) || 0;

  return {
    marginBox: { x: rect.left - ml, y: rect.top - mt, w: rect.width + ml + mr, h: rect.height + mt + mb },
    borderBox: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
    paddingBox: { x: rect.left + blw, y: rect.top + bt, w: rect.width - blw - br, h: rect.height - bt - bb },
    contentBox: {
      x: rect.left + blw + plv,
      y: rect.top + bt + pt,
      w: rect.width - blw - br - plv - pr,
      h: rect.height - bt - bb - pt - pb,
    },
  };
}
