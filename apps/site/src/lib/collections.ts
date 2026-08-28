import { getCollection } from 'astro:content';

/**
 * `getCollection` returns entries in filesystem (alphabetical) order. The hubs
 * and "related" grids are editorially ordered — the flagship comparison leads —
 * so every read goes through these helpers rather than getCollection directly.
 */
const byOrder = <T extends { data: { order: number } }>(entries: T[]): T[] =>
  [...entries].sort((a, b) => a.data.order - b.data.order);

export const getComparisons = async () => byOrder(await getCollection('compare'));
export const getAlternatives = async () => byOrder(await getCollection('alternatives'));
export const getUseCases = async () => byOrder(await getCollection('useCases'));
export const getGuides = async () => byOrder(await getCollection('guides'));

/**
 * The competitor prices, read out of the `Price` row of each comparison's own
 * table so no pricing surface restates a figure the comparison pages own. Only
 * entries quoting a concrete published number qualify — "paid plans per user"
 * says nothing a reader can weigh — which is what the currency test selects.
 */
export const getPublishedPrices = async (): Promise<{ id: string; competitor: string; price: string }[]> =>
  (await getComparisons()).flatMap((c) => {
    const price = c.data.rows.find((r) => r.feature === 'Price')?.them;
    return price && /[$€£]/.test(price) ? [{ id: c.id, competitor: c.data.competitor, price }] : [];
  });

export type SiteLink = { href: string; label: string };

/**
 * `compare` and `alternatives` share one slug per competitor, so a detail page
 * leads with a link across to its twin in the other collection when that twin
 * exists, then lists the rest of its own collection.
 */
export function relatedLinks<S extends { id: string }, O extends { id: string }>({
  entry,
  siblings,
  others = [],
  siblingLink,
  crossLink,
}: {
  entry: S;
  siblings: S[];
  others?: O[];
  siblingLink: (sibling: S) => SiteLink;
  crossLink?: (twin: O) => SiteLink;
}): SiteLink[] {
  const rest = siblings.filter((s) => s.id !== entry.id).map(siblingLink);
  const twin = others.find((o) => o.id === entry.id);
  return twin && crossLink ? [crossLink(twin), ...rest] : rest;
}
