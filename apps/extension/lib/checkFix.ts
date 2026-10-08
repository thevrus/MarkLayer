import { agentLabel, isAgentAuthored, resolveOpStatus } from '@marklayer/types';
import { signal } from '@preact/signals';
import { setOpStatus } from './state';
import type { CommentOp } from './types';

export interface AgentFix {
  agent: string;
  /** The agent's latest reply, which `marklayer_resolve` posts as the summary of what changed. */
  summary: string;
}

/**
 * A thread an agent closed and nobody has signed off on. `resolve` stamps no resolver,
 * so the closer is read off the thread: resolved, with the agent's reply as the last word.
 */
export function agentFix({ op, replies }: { op: CommentOp; replies: CommentOp[] }): AgentFix | null {
  if (resolveOpStatus(op) !== 'resolved') return null;
  const last = replies.at(-1);
  if (!last || !isAgentAuthored(last) || !last.author) return null;
  return { agent: agentLabel(last.author), summary: last.text };
}

/** The thread whose reply box should open and take focus ("Not fixed"). */
export const replyRequest = signal<string | null>(null);

/** One "Check it" press. Each host settles it its own way: the viewer reloads the frame, the extension only scrolls. */
export const checkRequest = signal<string | null>(null);

/** The annotation whose pin is lit after a check, so the eye lands on it. */
export const flashedId = signal<string | null>(null);
const FLASH_MS = 1800;
let flashTimer: ReturnType<typeof setTimeout> | undefined;

export function flashAnnotation(id: string) {
  clearTimeout(flashTimer);
  flashedId.value = id;
  flashTimer = setTimeout(() => {
    flashedId.value = null;
  }, FLASH_MS);
}

/** Inline because the ring takes the pin's own colour, which is data, not a token. */
export const flashRing = ({ id, color }: { id: string; color: string }) =>
  flashedId.value === id ? { boxShadow: `0 0 0 3px var(--ds-background-100), 0 0 0 6px ${color}` } : undefined;

/** Reopen and hand the human the reply box; the agent sees both through its watch. */
export function reportNotFixed(opId: string) {
  setOpStatus(opId, 'open');
  replyRequest.value = opId;
}

/** `approved` is "the person who asked confirmed the fix" (see `marklayer_list`), so no new status is needed. */
export const confirmFixed = (opId: string) => setOpStatus(opId, 'approved');
