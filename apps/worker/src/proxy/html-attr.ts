/** The named references an escaper puts in a URL; anything rarer stays as written. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  colon: ':',
  sol: '/',
  quest: '?',
  equals: '=',
  num: '#',
  percnt: '%',
  comma: ',',
  period: '.',
};

/**
 * HTMLRewriter hands back attribute values raw, entities and all, and Twig's
 * `html_attr` writes `https&#x3A;&#x2F;&#x2F;…`. Decode before reading a URL out of one.
 */
export function decodeAttr(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (match, hex, dec, name) => {
    if (name) return NAMED_ENTITIES[name] ?? match;
    const code = Number.parseInt(hex ?? dec, hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

/** `setAttribute` escapes only `"`, so a decoded `&copy=` would turn into `©=` on the way back out. */
export const encodeAttr = (value: string): string => value.replaceAll('&', '&amp;');
