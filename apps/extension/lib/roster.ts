import type { Mention } from '@marklayer/types';
import { computed } from '@preact/signals';
import { stableComputed } from './stable';
import { localUser, operations, peers } from './state';

/** Colour for someone who is not currently connected, so their own is unknown. */
export const OFFLINE_COLOR = 'oklch(0.55 0.02 260)';

export interface RosterEntry {
  /** Stable client id where one is known, else the per-session peer id. */
  id: string;
  name: string;
  color: string;
  online: boolean;
  /** You — rendered as "you" and sorted first. */
  self: boolean;
}

/** Present wins: a connected peer carries a real colour and a current name. */
function merge(groups: RosterEntry[][]): RosterEntry[] {
  const byId = new Map<string, RosterEntry>();
  for (const group of groups) {
    for (const entry of group) {
      const existing = byId.get(entry.id);
      if (!existing || (entry.online && !existing.online)) byId.set(entry.id, entry);
    }
  }
  return [...byId.values()].sort((a, b) => {
    if (a.self !== b.self) return a.self ? -1 : 1;
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

const sameEntries = (previous: RosterEntry[], next: RosterEntry[]) =>
  previous.length === next.length &&
  next.every((entry, i) => {
    const before = previous[i];
    return (
      before !== undefined &&
      before.id === entry.id &&
      before.name === entry.name &&
      before.color === entry.color &&
      before.online === entry.online
    );
  });

/**
 * Anyone already in the work: whoever wrote an annotation still on the page, and
 * whoever it tagged. They matter as much as the people currently in the tab —
 * the extension never opens a socket at all, so a live-peers-only roster would
 * offer nobody to tag.
 */
const namedInOps = stableComputed({
  compute: (): RosterEntry[] => {
    // Deduped here, not at the merge: a second comment by the same author must
    // produce the identical list, or the cache below misses on every stroke.
    const byId = new Map<string, RosterEntry>();
    const add = (id: string, name: string) => {
      if (!byId.has(id)) byId.set(id, { id, name, color: OFFLINE_COLOR, online: false, self: false });
    };
    for (const op of operations.value) {
      if ('authorId' in op && op.authorId && op.author) add(op.authorId, op.author);
      if ('mentions' in op) for (const mention of op.mentions ?? []) add(mention.id, mention.name);
    }
    return [...byId.values()];
  },
  equals: sameEntries,
});

/**
 * You, plus whoever is connected right now.
 *
 * Split from the op scan on purpose: `peers` swaps on every remote cursor frame,
 * and merging both sides there would re-scan every op and re-sort the whole
 * roster 20 times a second per peer. This side is O(peers) and its identity only
 * moves when someone joins, leaves or renames.
 */
const present = stableComputed({
  compute: (): RosterEntry[] => {
    const entries: RosterEntry[] = [
      { id: localUser.id, name: localUser.name, color: localUser.color, online: true, self: true },
    ];
    for (const [peerId, peer] of peers.value) {
      if (!peer.name) continue;
      entries.push({ id: peer.uid || peerId, name: peer.name, color: peer.color, online: true, self: false });
    }
    return entries;
  },
  equals: sameEntries,
});

/** Everyone this room knows about. Recomputes only when one of its two sides actually changes. */
export const roster = computed<RosterEntry[]>(() => merge([present.value, namedInOps.value]));

/** Current names by id, built once for every tag rendered rather than per component. */
export const rosterNames = computed(() => new Map(roster.value.map((entry) => [entry.id, entry.name])));

/** Roster entries matching an `@` query. You are included: tagging yourself is a valid reminder. */
export function matchRoster({ query, limit = 6 }: { query: string; limit?: number }): RosterEntry[] {
  const q = query.trim().toLowerCase();
  const entries = roster.value;
  if (!q) return entries.slice(0, limit);
  // Prefix matches first — typing "ja" should reach Jazzy before Ninja.
  const starts: RosterEntry[] = [];
  const contains: RosterEntry[] = [];
  for (const entry of entries) {
    const name = entry.name.toLowerCase();
    if (name.startsWith(q)) starts.push(entry);
    else if (name.includes(q)) contains.push(entry);
  }
  return [...starts, ...contains].slice(0, limit);
}

/** What an op stores for a roster entry: the stable id plus the name it was written with. */
export const asMention = (entry: RosterEntry): Mention => ({ id: entry.id, name: entry.name });
