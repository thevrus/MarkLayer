import { signal } from '@preact/signals';
import { nanoid } from 'nanoid';
import type { IdentityStore } from './host-config';

// Local user identity (random name + color per session). Exported so demo
// cursors (web FakeCursors) can pick collision-free spares from the same palette.
/** Tailwind's own names for these hexes — a swatch has to say what it is out loud. */
const CURSOR_SWATCHES: readonly [{ hex: string; name: string }, ...{ hex: string; name: string }[]] = [
  { hex: '#f43f5e', name: 'Rose' },
  { hex: '#8b5cf6', name: 'Violet' },
  { hex: '#3b82f6', name: 'Blue' },
  { hex: '#10b981', name: 'Emerald' },
  { hex: '#f59e0b', name: 'Amber' },
  { hex: '#ec4899', name: 'Pink' },
  { hex: '#06b6d4', name: 'Cyan' },
  { hex: '#84cc16', name: 'Lime' },
  { hex: '#ef4444', name: 'Red' },
  { hex: '#6366f1', name: 'Indigo' },
];
export const CURSOR_COLORS = CURSOR_SWATCHES.map((s) => s.hex);
/** A peer cursor that arrives without a colour. */
export const FALLBACK_PEER_COLOR = '#8b5cf6';
const ADJECTIVES = [
  'Speedy',
  'Sneaky',
  'Cosmic',
  'Dizzy',
  'Funky',
  'Grumpy',
  'Jolly',
  'Lucky',
  'Mighty',
  'Noble',
  'Quirky',
  'Sleepy',
  'Wobbly',
  'Zappy',
  'Bouncy',
  'Fluffy',
  'Goofy',
  'Jazzy',
  'Rowdy',
  'Spicy',
  'Wacky',
  'Zippy',
  'Sassy',
  'Peppy',
  'Cranky',
] as const;
const ANIMALS = [
  'Axolotl',
  'Capybara',
  'Quokka',
  'Narwhal',
  'Pangolin',
  'Platypus',
  'Wombat',
  'Chinchilla',
  'Alpaca',
  'Lemur',
  'Ocelot',
  'Tapir',
  'Manatee',
  'Puffin',
  'Chameleon',
  'Hedgehog',
  'Flamingo',
  'Sloth',
  'Raccoon',
  'Penguin',
  'Octopus',
  'Gecko',
  'Toucan',
  'Otter',
] as const;
// Takes a non-empty array so the random index always yields a value.
function randomPick<T>(arr: readonly [T, ...T[]]): T {
  return arr[Math.floor(Math.random() * arr.length)] ?? arr[0];
}
export function cursorColorName(hex: string): string {
  return CURSOR_SWATCHES.find((s) => s.hex === hex.toLowerCase())?.name ?? hex.toUpperCase();
}

export function randomUserName(): string {
  return `${randomPick(ADJECTIVES)} ${randomPick(ANIMALS)}`;
}

/** Stable across reloads and rooms, unlike the per-connection peer id, so an op
 *  written last week still points at the person who wrote it. */
let clientId = nanoid();
export const userName = signal(randomUserName());
export const userColor = signal<string>(randomPick(CURSOR_SWATCHES).hex);
/**
 * Identity is read on every cursor label, avatar and new comment, so it is
 * exposed as an object of signal-backed getters rather than as two bare
 * signals: a rename repaints everything that shows it, and no call site has to
 * learn a `.value`. Write through `setUserName` / `setUserColor` — assigning to
 * these properties does nothing.
 */
export const localUser = {
  get name() {
    return userName.value;
  },
  get color() {
    return userColor.value;
  },
  /** Not a signal: it settles at `initHost`, before anything renders, and never changes after. */
  get id() {
    return clientId;
  },
};
/**
 * The signature every annotation carries. One helper because the two fields have
 * to travel together: a tool that sets `author` but forgets `authorId` still
 * type-checks, and a later rename silently stops following that tool's work.
 */
export const signedBy = () => ({ author: localUser.name, authorId: localUser.id });

let store: IdentityStore | undefined;

/** Picks up who this is, where the host keeps that. Without a store the identity lasts the page load. */
export function hydrateIdentity(identityStore: IdentityStore | undefined) {
  store = identityStore;
  if (!store) return;
  const saved = store.load();
  if (saved.name) userName.value = saved.name;
  if (saved.color) userColor.value = saved.color;
  if (saved.id) clientId = saved.id;
  // Persist on first visit so name, color and id stay stable
  store.save({
    name: saved.name ? null : userName.value,
    color: saved.color ? null : userColor.value,
    id: saved.id ? null : clientId,
  });
}

export function saveIdentity(identity: { name: string } | { color: string }) {
  store?.save(identity);
}

/** Long enough to swallow a burst of keystrokes, short enough to still read as live. */
export const PROFILE_SETTLE_MS = 200;
let profileTimer: ReturnType<typeof setTimeout>;

/** Tell the room who this is now, at once or once a burst of edits has settled. */
export function announceProfile({ settleMs = 0 }: { settleMs?: number } = {}) {
  clearTimeout(profileTimer);
  const send = () => onProfileChange.value?.(userName.value, userColor.value);
  if (settleMs) profileTimer = setTimeout(send, settleMs);
  else send();
}

export function setUserColor(c: string) {
  if (c === userColor.value) return;
  userColor.value = c;
  saveIdentity({ color: c });
  // Discrete, so it goes out at once — and it carries the name too, which makes
  // any name broadcast still settling redundant.
  announceProfile();
}

export const onProfileChange = signal<((name: string, color: string) => void) | null>(null);
