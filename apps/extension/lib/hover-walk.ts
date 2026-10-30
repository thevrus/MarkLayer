interface HoverWalk {
  el: Element;
  /** Elements climbed from, nearest last, so ArrowDown retraces the path. */
  stack: Element[];
}

/** One ArrowUp/ArrowDown step; null when there is nowhere to go. */
export function stepHover({ el, stack, dir }: HoverWalk & { dir: 'up' | 'down' }): HoverWalk | null {
  if (dir === 'up') {
    const parent = el.parentElement;
    if (!parent || el === el.ownerDocument.documentElement) return null;
    return { el: parent, stack: [...stack, el] };
  }
  const last = stack[stack.length - 1];
  if (last) return { el: last, stack: stack.slice(0, -1) };
  const child = el.firstElementChild;
  return child ? { el: child, stack } : null;
}
