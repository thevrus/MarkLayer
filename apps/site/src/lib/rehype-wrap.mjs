/**
 * A rehype plugin that replaces every `tagName` element with `wrap(element)`.
 * A wrapped element is not descended into, so the wrapper's own children are
 * never revisited.
 */
export const wrapElements = ({ tagName, wrap }) => {
  const walk = (node) => {
    if (!Array.isArray(node.children)) return;

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (child.type !== 'element') continue;

      if (child.tagName === tagName) {
        node.children[i] = wrap(child);
        continue;
      }
      walk(child);
    }
  };

  return () => walk;
};
