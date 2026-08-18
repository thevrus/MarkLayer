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
