import { detectFrameworkComponent, type FrameworkComponent } from './fiber-bridge';

export type { FrameworkComponent } from './fiber-bridge';

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
}

/** Format element info as markdown for AI tools */
export function formatForAI(el: Element, selector: string, opts: FormatForAIOptions = {}): string {
  const dims = opts.rect ?? el.getBoundingClientRect();
  const resolved = opts.styles ?? getKeyStyles(el);
  const { text, truncated } = opts.textSummary ?? summarizeText(el);

  const doc = el.ownerDocument;
  const win = doc.defaultView ?? window;

  let md = `${ELEMENT_INSPECTOR_HEADING}\n\n`;
  if (win.location.href) {
    const title = doc.title.trim();
    md += title ? `**Page:** ${title} — ${win.location.href}\n` : `**Page:** ${win.location.href}\n`;
  }
  md += `**Selector:** \`${selector}\`\n`;
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
  md += `**Size:** ${Math.round(dims.width)}×${Math.round(dims.height)}px\n`;
  const dpr = win.devicePixelRatio;
  const dprPart = dpr !== 1 ? ` @ ${dpr}x` : '';
  md += `**Viewport:** ${win.innerWidth}×${win.innerHeight}px${dprPart}\n`;
  if (text) md += `**Text:** "${truncated ? `${text}…` : text}"\n`;

  md += `\n**Markup:**\n\`\`\`html\n${truncateOuterHTML(el)}\n\`\`\`\n`;

  if (Object.keys(resolved).length) {
    md += '\n**Computed Styles:**\n```css\n';
    for (const [k, v] of Object.entries(resolved)) {
      md += `${k}: ${v};\n`;
    }
    md += '```\n';
  }

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

export function snapshotElement(el: Element, selector: string, viewportRect: DOMRect): SelectedInfo {
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
    markdown: formatForAI(el, selector, { styles, rect: viewportRect, component, textSummary, cssStack }),
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
