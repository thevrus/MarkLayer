/**
 * The rendered article, back to Markdown, for "Copy page".
 *
 * Read off the DOM rather than the source file because half of what a page says
 * is not in its Markdown: the comparison tables, the FAQ and every hub listing
 * are written by the templates from frontmatter. The DOM is the one place the
 * whole page exists.
 */

/** Chrome inside the article that is not the article: anchors, controls, the outline. */
const SKIP = '.ml-anchor, .ml-code-bar, .ml-toc-inline, [data-ml-copy-skip], [aria-hidden="true"], button, svg';

const inline = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\s+/g, ' ');
  if (!(node instanceof HTMLElement) || node.matches(SKIP)) return '';
  const inner = [...node.childNodes].map(inline).join('');
  switch (node.tagName) {
    case 'A': {
      const href = node.getAttribute('href') ?? '';
      return href ? `[${inner.trim()}](${new URL(href, location.href).href})` : inner;
    }
    case 'CODE':
      return `\`${node.textContent ?? ''}\``;
    case 'STRONG':
    case 'B':
      return `**${inner.trim()}**`;
    case 'EM':
    case 'I':
      return `*${inner.trim()}*`;
    case 'BR':
      return '\n';
    default:
      return inner;
  }
};

const text = (el: Element): string => [...el.childNodes].map(inline).join('').trim();

const cells = (row: Element): string =>
  `| ${[...row.children].map((c) => text(c).replace(/\|/g, '\\|')).join(' | ')} |`;

const list = ({ el, ordered }: { el: Element; ordered: boolean }): string =>
  [...el.children]
    .filter((li) => li.tagName === 'LI')
    .map((li, i) => `${ordered ? `${i + 1}.` : '-'} ${text(li)}`)
    .join('\n');

const block = (el: Element): string => {
  if (!(el instanceof HTMLElement) || el.matches(SKIP)) return '';
  switch (el.tagName) {
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
      return `${'#'.repeat(Number(el.tagName[1]))} ${text(el)}`;
    case 'P':
      return text(el);
    case 'BLOCKQUOTE':
      return `> ${text(el)}`;
    case 'UL':
      return list({ el, ordered: false });
    case 'OL':
      return list({ el, ordered: true });
    case 'PRE': {
      const lang = el.dataset.language && el.dataset.language !== 'plaintext' ? el.dataset.language : '';
      return `\`\`\`${lang}\n${(el.textContent ?? '').replace(/\n$/, '')}\n\`\`\``;
    }
    case 'TABLE': {
      const rows = [...el.querySelectorAll('tr')];
      const [head, ...body] = rows;
      if (!head) return '';
      const rule = `|${[...head.children].map(() => ' --- ').join('|')}|`;
      return [cells(head), rule, ...body.map(cells)].join('\n');
    }
    case 'DL':
      return [...el.children]
        .map((c) => (c.tagName === 'DT' ? `**${text(c)}**` : text(c)))
        .filter(Boolean)
        .join('\n\n');
    case 'IFRAME':
      return '';
    case 'A':
      return inline(el).trim();
    default: {
      // A wrapper recurses; a leaf (a version stamp, a date) is its own text.
      const kids = [...el.children].map(block).filter(Boolean);
      return kids.length > 0 ? kids.join('\n\n') : text(el);
    }
  }
};

/** Every block in `root` up to (not including) the first `[data-ml-copy-end]`. */
export function pageMarkdown(root: Element): string {
  const parts: string[] = [];
  for (const el of root.children) {
    if (el.matches('[data-ml-copy-end]')) break;
    const md = block(el);
    if (md) parts.push(md);
  }
  return `${parts.join('\n\n')}\n\nSource: ${location.origin}${location.pathname}\n`;
}
