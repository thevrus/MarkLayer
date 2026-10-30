import { normalizeSuggestion } from '@marklayer/types';
import { tinykeys } from 'tinykeys';

// Cross-realm safe: an element from a proxied iframe fails `instanceof Element` here.
const isText = (n: Node): n is Text => n.nodeType === Node.TEXT_NODE;
const isElement = (n: Node): n is Element => n.nodeType === Node.ELEMENT_NODE;
const isHtml = (n: Element): n is HTMLElement => 'style' in n && 'focus' in n;

const INLINE = new Set(
  'a abbr b bdi bdo br cite code del dfn em i ins kbd mark q s samp small span strong sub sup time u var wbr'.split(
    ' ',
  ),
);
const NOT_INLINE = `:not(${[...INLINE].join()})`;

// Form controls own their value, and a contenteditable host is already editable.
const BLOCKED =
  'input,textarea,select,option,script,style,noscript,svg,[contenteditable]:not([contenteditable="false"])';

type TextEditPlan = { kind: 'block'; root: Element } | { kind: 'node'; node: Text };

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Text as rendered line content: text nodes in order, `<br>` as a newline. */
export function readText(root: Node): string {
  let out = '';
  for (const c of root.childNodes) {
    if (isText(c)) out += c.data;
    else if (isElement(c)) out += c.tagName === 'BR' ? '\n' : readText(c);
  }
  return out;
}

function firstText(el: Element): Text | null {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (isText(n) && n.data.trim()) return n;
  }
  return null;
}

function inlineOnly(el: Element): boolean {
  return !el.querySelector(NOT_INLINE);
}

/**
 * What a double-click edits. The nearest block when it holds nothing but text and
 * inline formatting, so a sentence with a <strong> in it edits as one sentence;
 * otherwise only the clicked text node, so siblings and widgets stay out of reach.
 */
export function pickTextEdit({ el, node }: { el: Element; node: Text | null }): TextEditPlan | null {
  if (el.closest(BLOCKED)) return null;
  const text = node?.data.trim() ? node : firstText(el);
  if (!text) return null;
  const parent = text.parentElement;
  if (!parent || parent.closest(BLOCKED)) return null;

  let block: Element | null = parent;
  while (block && INLINE.has(block.tagName.toLowerCase())) block = block.parentElement;
  const tag = block?.tagName.toLowerCase();
  if (block && tag !== 'body' && tag !== 'html') {
    if (inlineOnly(block) && readText(block).trim()) return { kind: 'block', root: block };
  }
  return { kind: 'node', node: text };
}

/**
 * The op's before/after, or null when there is nothing to propose. Whitespace-only
 * edits are no-ops; newlines survive only where the element renders them.
 */
export function diffEdit({
  original,
  edited,
  preserveNewlines,
}: {
  original: string;
  edited: string;
  preserveNewlines: boolean;
}): { text: string; suggestion: string } | null {
  const text = collapse(original);
  const next = preserveNewlines
    ? edited
        .split('\n')
        .map(collapse)
        .join('\n')
        .replace(/^\n+|\n+$/g, '')
    : collapse(edited);
  if (collapse(next) === text) return null;
  const suggestion = normalizeSuggestion({ text, suggestion: next });
  return suggestion ? { text, suggestion } : null;
}

export interface Snapshot {
  kids: Map<Element, Node[]>;
  data: Map<Text, string>;
}

/** Every child list and text value under `root`, so a browser-mangled edit can be undone exactly. */
export function snapshot(root: Element): Snapshot {
  const kids = new Map<Element, Node[]>();
  const data = new Map<Text, string>();
  const walk = (el: Element) => {
    kids.set(el, Array.from(el.childNodes));
    for (const c of el.childNodes) {
      if (isText(c)) data.set(c, c.data);
      else if (isElement(c)) walk(c);
    }
  };
  walk(root);
  return { kids, data };
}

export function restore({ kids, data }: Snapshot): void {
  for (const [el, nodes] of kids) {
    const same = el.childNodes.length === nodes.length && nodes.every((n, i) => el.childNodes[i] === n);
    if (!same) el.replaceChildren(...nodes);
  }
  for (const [t, d] of data) if (t.data !== d) t.data = d;
}

export interface TextEditResult {
  /** Element to anchor the op to. */
  target: Element;
  text: string;
  suggestion: string;
  /** Rects of the original text, in document coordinates. */
  rects: { x: number; y: number; width: number; height: number }[];
}

let editing = false;

export const isTextEditing = () => editing;

function caretAt({ doc, x, y }: { doc: Document; x: number; y: number }): { node: Node; offset: number } | null {
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (pos) return { node: pos.offsetNode, offset: pos.offset };
  const range = doc.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

/**
 * Edit page text in place at a client point. Return saves, Esc or an unchanged
 * result reverts; either way the page is put back exactly, and `onDone` gets the
 * proposed before/after (or null) to turn into a suggestion. Returns false when
 * the target is not editable text, so the caller can fall through.
 */
export function startTextEdit({
  el,
  x,
  y,
  onDone,
}: {
  el: Element;
  x: number;
  y: number;
  onDone: (result: TextEditResult | null) => void;
}): boolean {
  if (editing) return false;
  const doc = el.ownerDocument;
  const win = doc.defaultView;
  if (!win) return false;

  const caret = caretAt({ doc, x, y });
  const clicked = caret && isText(caret.node) && el.contains(caret.node) ? caret.node : null;
  const plan = pickTextEdit({ el, node: clicked });
  if (!plan) return false;

  const measure = doc.createRange();
  if (plan.kind === 'block') measure.selectNodeContents(plan.root);
  else measure.selectNode(plan.node);
  const rects = Array.from(measure.getClientRects())
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({ x: r.x + win.scrollX, y: r.y + win.scrollY, width: r.width, height: r.height }));
  if (rects.length === 0) return false;

  const anchorEl = plan.kind === 'block' ? plan.root : plan.node.parentElement;
  if (!anchorEl) return false;
  const original = plan.kind === 'block' ? readText(plan.root) : plan.node.data;
  const preserveNewlines = /^(pre|break-spaces)/.test(win.getComputedStyle(anchorEl).whiteSpace);

  // A lone text node is wrapped so only it is editable, not the siblings around it.
  const host = plan.kind === 'block' ? plan.root : doc.createElement('span');
  if (!isHtml(host)) return false;
  const snap = plan.kind === 'block' ? snapshot(plan.root) : null;
  if (plan.kind === 'node') {
    plan.node.replaceWith(host);
    host.appendChild(plan.node);
  }

  const prev = {
    editable: host.getAttribute('contenteditable'),
    spellcheck: host.getAttribute('spellcheck'),
    style: host.getAttribute('style'),
  };
  host.setAttribute('contenteditable', 'plaintext-only');
  if (host.contentEditable !== 'plaintext-only') host.setAttribute('contenteditable', 'true');
  host.setAttribute('spellcheck', 'false');
  host.style.outline = '1px solid color-mix(in oklch, currentColor 45%, transparent)';
  host.style.outlineOffset = '2px';
  host.focus({ preventScroll: true });

  const range = doc.createRange();
  if (caret && isText(caret.node) && host.contains(caret.node)) {
    range.setStart(caret.node, Math.min(caret.offset, caret.node.data.length));
    range.collapse(true);
  } else {
    range.selectNodeContents(host);
    range.collapse(false);
  }
  const sel = doc.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);

  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    unbind();
    host.removeEventListener('blur', onBlur);
    win.removeEventListener('click', onClick, true);
    const edited = readText(host);
    if (snap) restore(snap);
    else if (plan.kind === 'node') {
      host.replaceWith(plan.node);
      plan.node.data = original;
    }
    if (plan.kind === 'block') {
      const setOrRemove = (name: string, v: string | null) =>
        v === null ? host.removeAttribute(name) : host.setAttribute(name, v);
      setOrRemove('contenteditable', prev.editable);
      setOrRemove('spellcheck', prev.spellcheck);
      setOrRemove('style', prev.style);
    }
    doc.getSelection()?.removeAllRanges();
    editing = false;
    const diff = save ? diffEdit({ original, edited, preserveNewlines }) : null;
    onDone(diff ? { target: anchorEl, rects, ...diff } : null);
  };
  const onBlur = () => finish(true);
  // The press that follows a double-click must not follow a link the text sits in.
  const onClick = (e: MouseEvent) => {
    if (e.target instanceof Node && host.contains(e.target)) e.preventDefault();
  };

  const key = (save: boolean) => (e: KeyboardEvent) => {
    if (e.isComposing) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    finish(save);
  };
  // Capture so the page's own Enter handlers never see it. tinykeys' default ignore drops
  // keys aimed at editable targets, which the focused host is, so it is replaced.
  const unbind = tinykeys(
    win,
    { Enter: key(true), Escape: key(false) },
    { capture: true, ignore: (e) => e.repeat || e.isComposing },
  );
  host.addEventListener('blur', onBlur);
  win.addEventListener('click', onClick, true);
  editing = true;
  return true;
}
