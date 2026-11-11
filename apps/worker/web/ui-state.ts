import { wsSend } from '@ext/lib/realtime';
import type { CommentStatus, SelectionRect } from '@ext/lib/types';
import { uiHidden } from '@ext/lib/ui-state';
import type { CaptureViewport, CommentOp, TargetElement } from '@marklayer/types/ops';
import { computed, effect, signal } from '@preact/signals';

/** Where a comment is being placed, with the screenshot started the moment it was. */
export const commentPopover = signal<{ x: number; y: number; snapshot?: Promise<string | null>; visualContext?: CommentOp['visualContext'] } | null>(null);
export const textInput = signal<{ x: number; y: number } | null>(null);
export const selectionPopover = signal<{
  text: string;
  rects: SelectionRect[];
  screenX: number;
  screenY: number;
  target?: TargetElement;
  captureViewport?: CaptureViewport;
  /** Opened by the selection alone rather than by arming the selection tool. */
  auto: boolean;
} | null>(null);
/**
 * How the support card came to be open, or `null` when it is closed.
 *
 * One signal rather than an `open` boolean beside a `trigger`, so the two can
 * never disagree about which ask is on screen. `auto` (after a share), `agent`
 * (after an agent's work lands) and `notes` (at a pause between notes) are the
 * earned, unprompted offer; `bar`, `menu` and `panel` are the person asking for
 * it themselves.
 *
 * Web-app only by design (see support.ts), so it lives here rather than in the
 * shared extension state.
 */
const UNPROMPTED = ['auto', 'agent', 'notes'] as const;
export type UnpromptedTrigger = (typeof UNPROMPTED)[number];
export type SupportTrigger = UnpromptedTrigger | 'bar' | 'menu' | 'panel';
export const isUnprompted = (trigger: SupportTrigger | null): trigger is UnpromptedTrigger =>
  UNPROMPTED.some((t) => t === trigger);
export const showSupportDialog = signal<SupportTrigger | null>(null);

export const sharing = signal(false);
export const showInfoPanel = signal(false);

/** What the info panel actually renders on — ⌘/ closes it without forgetting it was open. */
export const infoPanelOpen = computed(() => showInfoPanel.value && !uiHidden.value);

export const showAnnotationPanel = signal(false);

/** What the panel actually renders on — hiding the UI closes it without forgetting it was open. */
export const annotationPanelOpen = computed(() => showAnnotationPanel.value && !uiHidden.value);

export const commentFilter = signal<CommentStatus | 'all'>('all');

/**
 * The one annotation the panel is showing on its own, or null for the list.
 * A signal rather than panel state because the viewer's Escape chain steps back
 * to the list before it closes the panel, so both sides read the same value.
 */
export const focusedAnnotationId = signal<string | null>(null);

/** Closing the panel drops the detail, so reopening never lands on a stale one. */
export function wirePanelState() {
  effect(() => {
    if (!showAnnotationPanel.value) focusedAnnotationId.value = null;
  });
}

/** Peer ID we're currently following (auto-scroll to their cursor) */
export const followingPeer = signal<string | null>(null);

/** Callback for follow-mode scrolling — set by Viewer (owns iframe ref) */
export const onFollowScroll = signal<((y: number) => void) | null>(null);

/** The full-screen triage board — a second view of the annotations, by status. */
export const showBoard = signal(false);

/** Whether we are presenting: pulling every other peer onto our scroll position. */
export const presenting = signal(false);

/**
 * Start or stop presenting. Presenting and following are mutually exclusive: you
 * cannot pull the room onto a scroll position you are not the one steering.
 */
export function setPresenting(on: boolean) {
  if (presenting.value === on) return;
  presenting.value = on;
  if (on) followingPeer.value = null;
  wsSend.value?.({ type: 'flock', on });
}
