/**
 * Wrap every Markdown table in the same scroller the .astro templates put round
 * theirs by hand.
 *
 * A bare `w-full` table has nowhere to overflow to, so on a phone it either
 * squeezes its columns into unreadable lanes or pushes the whole document
 * sideways. Both were live: `/guides/website-feedback-tools` (five columns)
 * scrolled the page by 136px at 390px wide, and `/guides/bug-report-mcp-servers`
 * by 43px. Only the hand-written tables in `pages/` were ever wrapped, because
 * Markdown gives an author no place to put the div.
 *
 * Kept as a local plugin rather than a dependency: it is one visit over the
 * tree, and the class it applies is defined in this project's own stylesheet.
 */
export function rehypeScrollTables() {
  return (tree) => {
    const walk = (node) => {
      if (!Array.isArray(node.children)) return;

      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (child.type !== 'element') continue;

        if (child.tagName === 'table') {
          node.children[i] = {
            type: 'element',
            tagName: 'div',
            properties: { className: ['ml-scroll-x'] },
            children: [child],
          };
          continue;
        }
        walk(child);
      }
    };

    walk(tree);
  };
}
