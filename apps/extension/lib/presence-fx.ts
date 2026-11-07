import { type AnnotationOp, isAnnotationOp } from '@marklayer/types/ops';
import { signal } from '@preact/signals';
import { nanoid } from 'nanoid';
import { track } from './analytics';
import type { RoomFx } from './host-config';
import { localUser } from './identity';
import { lsGet, lsSet } from './storage';
import { toast } from './toasts';
import type { DrawOp } from './types';

/**
 * Highest `ts` of a mention this browser has already been told about, per room.
 * Without it, everything written while you were away is either announced every
 * time you open the room or never announced at all.
 */
const seenKey = (room: string) => `ml-mentions-seen-${room}`;

/** A type guard, so the callers that read `author`/`tool` need no second narrowing. */
function tagsMe(op: DrawOp): op is AnnotationOp {
  return isAnnotationOp(op) && !!op.mentions?.some((m) => m.id === localUser.id);
}

/**
 * Everything written while you were away that names you, said once on arrival.
 * A mention has no address to be delivered to — no accounts, no email — so this
 * and the live toast below are the whole of it.
 */
function announceMissedMentions({ ops, room }: { ops: DrawOp[]; room: string }) {
  const seen = Number(lsGet(seenKey(room))) || 0;
  // Guard first as its own filter, so the result is typed as annotation ops.
  const missed = ops.filter(tagsMe).filter((op) => op.ts > seen);
  if (!missed.length) return;
  lsSet(seenKey(room), String(missed.reduce((latest, op) => Math.max(latest, op.ts), 0)));
  toast(`${missed.length} annotation${missed.length === 1 ? '' : 's'} mention${missed.length === 1 ? 's' : ''} you`);
  track('mention_missed_seen', { count: missed.length });
}

/**
 * Say it out loud when an incoming annotation tags you. This is the whole of
 * "notifications": the room has no accounts and no address to reach, so a
 * mention can only be delivered to someone who is here to see it — which is why
 * it is matched on the stable client id rather than on the display name.
 */
function announceMention({ op, room }: { op: DrawOp; room: string }) {
  if (!tagsMe(op)) return;
  lsSet(seenKey(room), String(op.ts));
  toast(`${op.author || 'Someone'} mentioned you`);
  track('mention_received', { tool: op.tool });
}

/** Active click ripples. Each entry auto-clears after the CSS animation completes. */
export interface Ripple {
  id: string;
  peerId: string;
  color: string;
  x: number;
  y: number;
}
export const activeRipples = signal<Ripple[]>([]);
/** ms — animation is 700ms and the last ring is delayed 140ms; pad slightly so
 * the trailing ring doesn't pop out mid-fade if the browser is busy. */
const RIPPLE_LIFETIME_MS = 900;

/** Lazily-created AudioContext for peer join/leave chimes. Browser autoplay
 * policy keeps it suspended until a user gesture; since the user is already
 * interacting with the viewer by the time peers join, resume() usually works. */
let peerChimeCtx: AudioContext | null = null;
function playPeerChime(joining: boolean) {
  try {
    if (typeof AudioContext === 'undefined') return;
    if (!peerChimeCtx) peerChimeCtx = new AudioContext();
    if (peerChimeCtx.state === 'suspended') peerChimeCtx.resume().catch(() => {});
    const t0 = peerChimeCtx.currentTime;
    const osc = peerChimeCtx.createOscillator();
    const gain = peerChimeCtx.createGain();
    osc.type = 'sine';
    // Join: rising C5 → G5. Leave: falling G5 → C5.
    const [f1, f2] = joining ? [523.25, 783.99] : [783.99, 523.25];
    osc.frequency.setValueAtTime(f1, t0);
    osc.frequency.exponentialRampToValueAtTime(f2, t0 + 0.14);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.05, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
    osc.connect(gain).connect(peerChimeCtx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.25);
  } catch {
    /* audio unavailable — ignore */
  }
}

/** What a room feels like to someone in it. A host passes this as `capabilities.fx`; the widget does not. */
export const presenceFx: RoomFx = {
  arrived: announceMissedMentions,
  opReceived: announceMention,
  peerJoined: (name) => {
    toast(`${name || 'Someone'} joined`, { type: 'info', duration: 2500 });
    playPeerChime(true);
  },
  peerLeft: (name) => {
    toast(`${name} left`, { type: 'info', duration: 2500 });
    playPeerChime(false);
  },
  ripple: (ripple) => {
    const id = nanoid();
    activeRipples.value = [...activeRipples.value, { ...ripple, id }];
    setTimeout(() => {
      activeRipples.value = activeRipples.value.filter((r) => r.id !== id);
    }, RIPPLE_LIFETIME_MS);
  },
  reset: () => {
    activeRipples.value = [];
  },
};
