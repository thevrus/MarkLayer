/**
 * A readable outline of a page, built server-side so an agent can audit copy
 * without a browser.
 *
 * The MCP surface can only report annotations a human had already made: an agent
 * asked to "review this page" has nothing to review. This is the read half of
 * that loop, shaped to close it — the entries carry exactly the `TargetElement`
 * fields the write tools take, so an outline row feeds straight into
 * `suggest_edit`. Nothing calls it yet; the tool that will is not written.
 *
 * Built on HTMLRewriter rather than a DOM parser: it is native to Workers,
 * streams, and costs no bundle. The price is that there is no tree to query, so
 * the element path is tracked by hand as the stream opens and closes tags — and
 * `selectorFor` below is therefore a plainer algorithm than the client's
 * `lib/selector.ts`, which can weigh test ids and filter utility classes against
 * a live DOM. Re-anchoring leans on the shared `text` fingerprint for that
 * reason, so keep the two agreeing on `FINGERPRINT_LEN` rather than on selectors.
 */

import { FINGERPRINT_LEN, normalizeText } from '@marklayer/types';

/** Elements that carry copy worth auditing. Layout containers are skipped. */
const COPY_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'li',
  'a',
  'button',
  'label',
  'blockquote',
  'figcaption',
  'summary',
  'td',
  'th',
]);

/** Their text is markup or code, never page copy. */
const OPAQUE_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg']);

/**
 * No end tag, so `onEndTag` never fires for them. Pushing one would corrupt the
 * stack for everything after it — and being childless, they are never ancestors.
 */
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** Enough of an element's copy to judge it; the whole page is the caller's budget, not one node's. */
const MAX_TEXT = 300;

export interface OutlineEntry {
  /** A `nth-of-type` path, rooted at the nearest ancestor with an id. */
  selector: string;
  tag: string;
  text: string;
  markdown: string;
}

export interface PageOutline {
  url: string;
  title: string | null;
  entries: OutlineEntry[];
  /**
   * True when the document carried almost no copy but does have a mount node —
   * the page renders client-side and this outline is the shell, not the content.
   * Said plainly so an agent reports it instead of auditing an empty page.
   */
  clientRendered: boolean;
  /** Set when `entries` was cut at the cap, so a caller knows the tail is missing. */
  truncated: boolean;
}

interface Frame {
  tag: string;
  /** Position among same-tag siblings, which is what `nth-of-type` counts. */
  nth: number;
  id: string | null;
  counts: Map<string, number>;
  text: string;
  /** Emit this frame on its end tag. */
  wanted: boolean;
}

/** Ids that are safe unescaped in a selector. Anything odd falls back to the path. */
const SIMPLE_ID = /^[A-Za-z][\w-]*$/;

function selectorFor(stack: Frame[]): string {
  const self = stack[stack.length - 1];
  if (self?.id && SIMPLE_ID.test(self.id)) return `#${self.id}`;
  // Root at the deepest ancestor carrying an id: shorter, and it survives a
  // sibling being inserted above it.
  let from = 0;
  for (let i = stack.length - 2; i >= 0; i--) {
    const frame = stack[i];
    if (frame?.id && SIMPLE_ID.test(frame.id)) {
      from = i;
      break;
    }
  }
  const parts: string[] = [];
  for (let i = from; i < stack.length; i++) {
    const frame = stack[i];
    if (!frame) continue;
    if (i === from && frame.id && SIMPLE_ID.test(frame.id)) parts.push(`#${frame.id}`);
    else parts.push(`${frame.tag}:nth-of-type(${frame.nth})`);
  }
  return parts.join(' > ');
}

/** The snapshot a human sees in a comment — the client's `formatForAI` shape, minus what needs a DOM. */
const snapshot = ({ tag, selector, text }: { tag: string; selector: string; text: string }) =>
  `\`<${tag}>\` \`${selector}\`\n\n${text}`;

/**
 * Read one HTML document into an outline. `maxEntries` bounds the response, not
 * the parse: the stream is still walked to the end so `clientRendered` counts
 * the whole document.
 */
export async function outlinePage({
  html,
  url,
  maxEntries = 400,
}: {
  html: string;
  url: string;
  maxEntries?: number;
}): Promise<PageOutline> {
  const stack: Frame[] = [];
  const root: Frame = { tag: '#document', nth: 1, id: null, counts: new Map(), text: '', wanted: false };
  const entries: OutlineEntry[] = [];
  let opaqueDepth = 0;
  let title: string | null = null;
  let inTitle = false;
  let mountNode = false;
  let totalText = 0;
  let truncated = false;

  /** Next `nth-of-type` index for `name` within its open parent. */
  const bump = (name: string) => {
    const parent = stack[stack.length - 1] ?? root;
    const next = (parent.counts.get(name) ?? 0) + 1;
    parent.counts.set(name, next);
    return next;
  };

  const rewriter = new HTMLRewriter().on('*', {
    element(el) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'title') {
        inTitle = true;
        el.onEndTag(() => {
          inTitle = false;
        });
        return;
      }
      const id = el.getAttribute('id');
      if (id && (id === 'root' || id === 'app' || id === '__next')) mountNode = true;

      if (OPAQUE_TAGS.has(tag)) {
        // Counted on the parent anyway: skipping it would shift every later
        // sibling's nth-of-type against what the browser sees.
        bump(tag);
        if (!VOID_TAGS.has(tag)) {
          opaqueDepth++;
          el.onEndTag(() => {
            opaqueDepth--;
          });
        }
        return;
      }

      const nth = bump(tag);
      if (VOID_TAGS.has(tag)) return;

      const frame: Frame = { tag, nth, id, counts: new Map(), text: '', wanted: COPY_TAGS.has(tag) };
      stack.push(frame);
      const selector = frame.wanted ? selectorFor(stack) : '';
      el.onEndTag(() => {
        const done = stack.pop();
        if (!done?.wanted) return;
        const text = normalizeText(done.text).slice(0, MAX_TEXT);
        if (!text) return;
        if (entries.length >= maxEntries) {
          truncated = true;
          return;
        }
        entries.push({ selector, tag: done.tag, text, markdown: snapshot({ tag: done.tag, selector, text }) });
      });
    },
    text(chunk) {
      if (inTitle) {
        title = normalizeText((title ?? '') + chunk.text) || null;
        return;
      }
      if (opaqueDepth > 0) return;
      const raw = chunk.text;
      if (!raw.trim()) return;
      totalText += raw.trim().length;
      // Appended to every open frame, not just the innermost: `<p>Hello <b>world</b></p>`
      // has to read back as one sentence, the way innerText does.
      for (const frame of stack) {
        if (frame.wanted && frame.text.length < MAX_TEXT * 2) frame.text += raw;
      }
    },
  });

  await rewriter.transform(new Response(html)).text();

  return {
    url,
    title,
    entries,
    clientRendered: mountNode && totalText < 200,
    truncated,
  };
}

/** The `text` an anchor re-resolves against when a selector stops matching. */
export const fingerprint = (text: string) => text.slice(0, FINGERPRINT_LEN);
