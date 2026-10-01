export interface OutlineEntry {
  id: string;
  depth: 2 | 3;
  /** Heading text with its tags stripped and its entities left encoded, so it is safe as HTML. */
  html: string;
}

const HEADING = /<h([23])(\s[^>]*)?>([\s\S]*?)<\/h\1>/g;
const ID_ATTR = /\sid="([^"]+)"/;

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/&[a-z0-9#]+;/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');

/**
 * Give every h2/h3 in a rendered article an id and a hover anchor, and list them
 * for the on-this-page column.
 *
 * Markdown headings arrive with ids already; the ones the templates write
 * ("Frequently asked questions", "At a glance") do not, and those are half of
 * what a reader scans for. Done on the HTML string at build time so the outline
 * is in the page, not assembled by a script after it loads.
 *
 * A heading that is itself a link (a hub entry, a release title) gets an id but
 * no anchor — a link inside a link is invalid — and a linked h3 stays out of the
 * outline, because a hub's sixteen entry titles are its content, not its sections.
 */
export function outline(html: string): { html: string; entries: OutlineEntry[] } {
  const taken = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const entries: OutlineEntry[] = [];

  const out = html.replace(HEADING, (whole, level: string, attrs = '', inner: string) => {
    const depth = level === '2' ? 2 : 3;
    const text = inner.replace(/<[^>]+>/g, '').trim();
    const linked = /<a[\s>]/.test(inner);

    const own = ID_ATTR.exec(attrs)?.[1];
    let id = own;
    if (!id) {
      const base = slugify(text) || 'section';
      id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
      taken.add(id);
    }

    if (depth === 2 || !linked) entries.push({ id, depth, html: text });
    if (linked && own) return whole;

    const open = own ? `<h${level}${attrs}>` : `<h${level} id="${id}"${attrs}>`;
    // Mouse-only on purpose: keyboard and screen-reader users reach every
    // section through the outline, and a focusable "#" in each heading would
    // add a stop per section and a stray word to each heading's name.
    const anchor = linked ? '' : `<a class="ml-anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>`;
    return `${open}${inner}${anchor}</h${level}>`;
  });

  return { html: out, entries };
}
