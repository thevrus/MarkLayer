import { isAnnotationOp, resolveOpStatus, translateOp } from '@marklayer/types';
import { computed, effect, signal } from '@preact/signals';
import { nanoid } from 'nanoid';
import { tinykeys } from 'tinykeys';
import { createDraftStore } from './drafts';
import { ELEMENT_INSPECTOR_HEADING, type OutputDetail } from './selector';

export type { OutputDetail };

import type {
  AreaOp,
  CommentMeta,
  CommentOp,
  CommentStatus,
  DrawOp,
  GuideOp,
  InspectOp,
  Peer,
  SelectionOp,
  Tool,
} from './types';

const drafts = createDraftStore({
  key: `ml-draft-${location.href.split('#')[0]}`,
  getOps: () => operations.value,
  setOps: (ops) => {
    operations.value = ops;
  },
  notify: (msg) => toast(msg, 'info', 2500),
});

/** Restore any saved draft for this URL into the operations signal. */
export const restoreDraft = drafts.restore;

export const visible = signal(false);
export const activeTool = signal<Tool>('navigate');

const _ls = typeof localStorage !== 'undefined' ? localStorage : null;

function lsSet(key: string, value: string | null) {
  try {
    value === null ? _ls?.removeItem(key) : _ls?.setItem(key, value);
  } catch {
    /* */
  }
}

export type Theme = 'system' | 'light' | 'dark';
const isTheme = (v: unknown): v is Theme => v === 'system' || v === 'light' || v === 'dark';
const storedTheme = _ls?.getItem('ml-theme');
export const theme = signal<Theme>(isTheme(storedTheme) ? storedTheme : 'light');
export function cycleTheme() {
  const order: Theme[] = ['light', 'dark', 'system'];
  const next = order[(order.indexOf(theme.value) + 1) % order.length] ?? 'light';
  theme.value = next;
  lsSet('ml-theme', next);
}

export const PALETTE = ['#b462f5', '#3b82f6', '#06b6d4', '#22c55e', '#facc15', '#f97316', '#f43f5e'];

const COLOR_NAMES: Record<string, string> = {
  '#b462f5': 'Purple',
  '#3b82f6': 'Blue',
  '#06b6d4': 'Cyan',
  '#22c55e': 'Green',
  '#facc15': 'Yellow',
  '#f97316': 'Orange',
  '#f43f5e': 'Red',
};

/**
 * The readable name of a palette colour, for the swatch label in the toolbar and
 * the picker — nobody reads a hex as a colour. Keyed by hex rather than by index
 * so a value restored from storage that is no longer in the palette still labels
 * itself, falling back to the hex it actually is.
 */
export function colorName(hex: string): string {
  return COLOR_NAMES[hex.toLowerCase()] ?? hex.toUpperCase();
}

export const color = signal(_ls?.getItem('ml-color') || '#f43f5e');

export function setColor(c: string) {
  color.value = c;
  lsSet('ml-color', c);
}

export const lineWidth = signal(2);

export const toolbarMinimized = signal(_ls?.getItem('ml-toolbar-min') === '1');

export function toggleToolbarMinimized() {
  const next = !toolbarMinimized.value;
  toolbarMinimized.value = next;
  lsSet('ml-toolbar-min', next ? '1' : null);
}

/** Show the framework component badge (React/Vue/Svelte) in the inspector hover + panel. */
export const showFrameworkBadges = signal(_ls?.getItem('ml-framework-badges') !== '0');

export function toggleFrameworkBadges() {
  const next = !showFrameworkBadges.value;
  showFrameworkBadges.value = next;
  lsSet('ml-framework-badges', next ? null : '0');
}

/** Show all annotation markers (pins, highlights, drawings, areas). When false, the canvas + overlays still render the active tool, but committed ops are hidden. */
export const markersVisible = signal(_ls?.getItem('ml-markers-visible') !== '0');

export function toggleMarkersVisible() {
  const next = !markersVisible.value;
  markersVisible.value = next;
  lsSet('ml-markers-visible', next ? null : '0');
}

/** Swallow page clicks while extension is open — useful when annotating links/buttons that would otherwise navigate. */
export const blockInteractions = signal(_ls?.getItem('ml-block-interactions') === '1');

export function toggleBlockInteractions() {
  const next = !blockInteractions.value;
  blockInteractions.value = next;
  lsSet('ml-block-interactions', next ? '1' : null);
}

/** Auto-clear the inspector stack after copy/send so the next handoff starts fresh. */
export const clearOnCopyEnabled = signal(_ls?.getItem('ml-clear-on-copy') === '1');

export function toggleClearOnCopy() {
  const next = !clearOnCopyEnabled.value;
  clearOnCopyEnabled.value = next;
  lsSet('ml-clear-on-copy', next ? '1' : null);
}

/** Transient open state for the floating settings panel. Not persisted. */
export const showSettings = signal(false);

/**
 * Realtime sync status. `null` = no room joined (extension on a normal page).
 * Set by `useRealtimeSync` in the web viewer; toolbar shows a pulse dot when non-null.
 */
export type ConnectionStatus = null | 'connecting' | 'connected' | 'disconnected';
export const connectionStatus = signal<ConnectionStatus>(null);

/**
 * Verbosity of the AI markdown emitted by `formatForAI`, modeled on Agentation's
 * four-tier ladder (defined in `selector.ts`). Each level is a strict superset.
 */
export const isOutputDetail = (v: unknown): v is OutputDetail =>
  v === 'compact' || v === 'standard' || v === 'detailed' || v === 'forensic';
const storedOutputDetail = _ls?.getItem('ml-output-detail');
// Migrate the previous two-tier values: 'full' was the everything-on option.
const initialOutputDetail: OutputDetail = isOutputDetail(storedOutputDetail)
  ? storedOutputDetail
  : storedOutputDetail === 'full'
    ? 'forensic'
    : 'standard';
export const outputDetail = signal<OutputDetail>(initialOutputDetail);

export function setOutputDetail(v: OutputDetail) {
  outputDetail.value = v;
  lsSet('ml-output-detail', v === 'standard' ? null : v);
}

export const operations = signal<DrawOp[]>([]);
export const undoStack = signal<(DrawOp | { type: 'clear'; ops: DrawOp[] })[]>([]);
export const commentCounter = computed(() => comments.value.length);
export const showShareDialog = signal(false);

export const peers = signal<Map<string, Peer>>(new Map());
/** Total peers including self (peers map excludes local user) */
export const peerCount = computed(() => peers.value.size + 1);

// Local user identity (random name + color per session). Exported so demo
// cursors (web FakeCursors) can pick collision-free spares from the same palette.
export const CURSOR_COLORS = [
  '#f43f5e',
  '#8b5cf6',
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#06b6d4',
  '#84cc16',
  '#ef4444',
  '#6366f1',
] as const;
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
const savedName = _ls?.getItem('ml-username') ?? null;
const savedCursorColor = _ls?.getItem('ml-usercolor') ?? null;
const freshName = `${randomPick(ADJECTIVES)} ${randomPick(ANIMALS)}`;
const freshCursorColor = randomPick(CURSOR_COLORS);
export const localUser = {
  name: savedName || freshName,
  color: savedCursorColor || freshCursorColor,
};
// Persist on first visit so color stays stable
if (!savedName) lsSet('ml-username', localUser.name);
if (!savedCursorColor) lsSet('ml-usercolor', localUser.color);

export function setUserName(name: string) {
  const trimmed = name.trim() || `${randomPick(ADJECTIVES)} ${randomPick(ANIMALS)}`;
  localUser.name = trimmed;
  lsSet('ml-username', trimmed);
  onProfileChange.value?.(localUser.name, localUser.color);
}

// Callback for WebSocket sync — set by useRealtimeSync hook
export const onOpPushed = signal<((op: DrawOp) => void) | null>(null);
/**
 * Patch is a partial-op shape (subset of fields on the matching DrawOp variant).
 * We keep it loosely typed at the wire boundary because the server merges it
 * generically before persisting / broadcasting.
 */
export const onOpUpdated = signal<((opId: string, patch: Record<string, unknown>) => void) | null>(null);
export const onUndone = signal<((opId: string) => void) | null>(null);
export const onCleared = signal<(() => void) | null>(null);
export const onCursorMove = signal<((x: number, y: number, tool: string) => void) | null>(null);
export const onProfileChange = signal<((name: string, color: string) => void) | null>(null);

/**
 * Opens the support card, or null where there is no card to open.
 *
 * The settings panel is shared with the web app, but the card is web-only on
 * purpose (see apps/worker/web/support.ts: in a content script `localStorage`
 * belongs to whatever page is being annotated, so the "asked once" record would
 * scatter across every site and never be readable again). The web app sets
 * this; the extension leaves it null and the row simply is not there.
 */
export const onSupport = signal<(() => void) | null>(null);

// Toasts
export interface Toast {
  id: number;
  message: string;
  type?: 'info' | 'success' | 'error';
}
let _toastId = 0;
export const toasts = signal<Toast[]>([]);
export function toast(message: string, type: Toast['type'] = 'info', duration = 3000) {
  const id = ++_toastId;
  toasts.value = [...toasts.value, { id, message, type }];
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, duration);
}

/** Copy text to clipboard with success/error toast feedback. */
export function copyText(text: string, label = 'Copied') {
  navigator.clipboard.writeText(text).then(
    () => toast(label, 'success'),
    () => toast('Failed to copy', 'error'),
  );
}

/** A stacked element-inspect entry awaiting bulk copy to an LLM. */
export interface InspectorStackItem {
  id: string;
  selector: string;
  comment: string;
  /** Element snapshot markdown (from formatForAI), without any user task wrapper. */
  markdown: string;
}

export const inspectorStack = signal<InspectorStackItem[]>([]);
export const inspectorStackOpen = signal(false);

export function addToInspectorStack(item: Omit<InspectorStackItem, 'id'>) {
  inspectorStack.value = [...inspectorStack.value, { ...item, id: nanoid() }];
  inspectorStackOpen.value = true;
}

export function removeFromInspectorStack(id: string) {
  inspectorStack.value = inspectorStack.value.filter((i) => i.id !== id);
  if (!inspectorStack.value.length) inspectorStackOpen.value = false;
}

export function clearInspectorStack() {
  inspectorStack.value = [];
  inspectorStackOpen.value = false;
}

/** Build a single LLM-ready prompt that bundles every stacked element + task. */
export function buildInspectorStackPrompt(): string {
  const items = inspectorStack.value;
  const headingPrefix = `${ELEMENT_INSPECTOR_HEADING}\n\n`;
  const blocks = items.map((it, i) => {
    const body = it.markdown.startsWith(headingPrefix) ? it.markdown.slice(headingPrefix.length) : it.markdown;
    const heading = it.comment ? `## Task ${i + 1}: ${it.comment}` : `## Element ${i + 1}`;
    return `${heading}\n\n${body.trim()}`;
  });
  const header = `# Element changes (${items.length} task${items.length === 1 ? '' : 's'})`;
  return `${header}\n\n${blocks.join('\n\n---\n\n')}\n`;
}

export function copyInspectorStack() {
  const items = inspectorStack.value;
  if (!items.length) {
    toast('Stack is empty', 'info');
    return;
  }
  copyText(buildInspectorStackPrompt(), `Copied ${items.length} task${items.length === 1 ? '' : 's'} for AI!`);
  if (clearOnCopyEnabled.value) clearInspectorStack();
}

// Single-pass partition of operations into comments, selections, areas, inspects, root comments, and reply map
const _opIndex = computed(() => {
  const allComments: CommentOp[] = [];
  const allSelections: SelectionOp[] = [];
  const allAreas: AreaOp[] = [];
  const allInspects: InspectOp[] = [];
  const roots: CommentOp[] = [];
  const replies = new Map<string, CommentOp[]>();
  for (const op of operations.value) {
    if (op.tool === 'comment') {
      allComments.push(op);
      if (op.parentId) {
        let arr = replies.get(op.parentId);
        if (!arr) {
          arr = [];
          replies.set(op.parentId, arr);
        }
        arr.push(op);
      } else {
        roots.push(op);
      }
    } else if (op.tool === 'selection') {
      allSelections.push(op);
    } else if (op.tool === 'area') {
      allAreas.push(op);
    } else if (op.tool === 'inspect') {
      allInspects.push(op);
    }
  }
  return { allComments, allSelections, allAreas, allInspects, roots, replies };
});

export const comments = computed(() => _opIndex.value.allComments);
export const selections = computed(() => _opIndex.value.allSelections);
export const areas = computed(() => _opIndex.value.allAreas);
export const inspects = computed(() => _opIndex.value.allInspects);
export const rootComments = computed(() => _opIndex.value.roots);

/** Get replies for a given comment id (O(1) lookup) */
export function getReplies(parentId: string): CommentOp[] {
  return _opIndex.value.replies.get(parentId) ?? [];
}

/** Annotation panel open state */
export const showAnnotationPanel = signal(false);

/** Comment status filter for annotation panel */
export const commentFilter = signal<CommentStatus | 'all'>('all');

export { resolveOpStatus as getCommentStatus };

/**
 * Visual styling for a comment status badge.
 * Used by both the extension and the web viewer pins.
 */
export const STATUS_STYLES: Record<
  CommentStatus,
  { color: string; bg: string; ring: string; pinOpacity: number; label: string }
> = {
  open: { color: 'transparent', bg: 'transparent', ring: 'transparent', pinOpacity: 1, label: 'Open' },
  in_progress: {
    color: 'oklch(0.7 0.16 60)',
    bg: 'oklch(0.7 0.16 60)',
    ring: 'oklch(1 0 0 / 0.8)',
    pinOpacity: 1,
    label: 'In progress',
  },
  resolved: {
    color: 'oklch(0.7 0.18 145)',
    bg: 'oklch(0.7 0.18 145)',
    ring: 'oklch(1 0 0 / 0.8)',
    pinOpacity: 1,
    label: 'Resolved',
  },
  dismissed: {
    color: 'oklch(0.6 0 0)',
    bg: 'oklch(0.6 0 0)',
    ring: 'oklch(1 0 0 / 0.6)',
    pinOpacity: 0.55,
    label: 'Dismissed',
  },
};

export const STATUS_LABELS: Record<CommentStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
};

export const isDrawingTool = (t: Tool) => t !== 'navigate';

/**
 * Tools under which a plain text selection means "annotate this passage".
 *
 * Listed positively, so a tool added later stays inert until someone decides
 * otherwise: every other tool owns a drag across the page, and the highlight its
 * gesture sweeps up is a side effect, not a request. `navigate` is on the list
 * on purpose — proposing a copy edit is the most common annotation there is, and
 * asking someone to find the right tool first is the step that stops them making
 * it.
 */
const SELECTION_TOOLS: ReadonlySet<Tool> = new Set<Tool>(['navigate', 'comment', 'text', 'selection', 'inspect']);

export const toolCapturesSelection = (t: Tool) => SELECTION_TOOLS.has(t);

/**
 * Whether a mouseup on the page should be read for a selection at all. Markers
 * hidden is review mode: the selection layer renders at opacity 0, so a popover
 * opened then would be an invisible panel saving an invisible annotation.
 *
 * Both surfaces gate on this, so the rule cannot drift between them.
 */
export const selectionCaptureArmed = computed(() => toolCapturesSelection(activeTool.value) && markersVisible.value);

/** True while user is actively drawing (mousedown on canvas) */
export const isDrawingActive = signal(false);

/**
 * Bumped at most once per animation frame on host-page scroll OR resize.
 * Components whose layout depends on `scrollX/scrollY` (CommentPin, AreaShape,
 * SelectionHighlight) subscribe via `scrollTick.value` to reposition.
 *
 * Single shared listener — `ensureScrollTickListener()` attaches once on
 * first call (idempotent) and never detaches; `passive: true` keeps scroll
 * cheap, and rAF coalesces bursts so re-renders track frames, not events.
 * The same coalesced handler also covers `resize`: a pure CSS reflow from a
 * window resize doesn't move `scrollX/scrollY` and never fires a `scroll`
 * event, so anchored pins would otherwise go stale until the next scroll.
 */
export const scrollTick = signal(0);
let _scrollListenerAttached = false;
let _scrollRaf = 0;
export function ensureScrollTickListener() {
  if (_scrollListenerAttached || typeof window === 'undefined') return;
  _scrollListenerAttached = true;
  const onScroll = () => {
    if (_scrollRaf) return;
    _scrollRaf = requestAnimationFrame(() => {
      _scrollRaf = 0;
      scrollTick.value++;
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
}

/**
 * Bumped (RAF-coalesced) when the host page's DOM mutates so element-
 * anchored annotations re-resolve their selectors against the new layout.
 * Mirrors the worker's `iframeMutationTick` pattern. Subscribed by the
 * same components that subscribe to `scrollTick`. Wired once via
 * `ensureHostMutationObserver()`.
 */
export const hostMutationTick = signal(0);

// DOM-change generation for anchor.ts's failed-resolution memo. A plain
// counter, not a signal: reads must never subscribe. Lives here (not in
// anchor.ts) because anchor.ts already imports this module, and both mutation
// observers — the host-page one below and the web iframe's in
// apps/worker/web/signals.ts — bump it.
let _anchorGeneration = 0;
export const anchorGeneration = (): number => _anchorGeneration;
export const bumpAnchorGeneration = (): void => {
  _anchorGeneration++;
};
let _hostObserverAttached = false;
let _hostObserver: MutationObserver | null = null;
let _hostMutRaf = 0;
export function ensureHostMutationObserver() {
  if (_hostObserverAttached || typeof window === 'undefined' || typeof MutationObserver === 'undefined') return;
  _hostObserverAttached = true;
  _hostObserver = new MutationObserver(() => {
    if (_hostMutRaf) return;
    _hostMutRaf = requestAnimationFrame(() => {
      _hostMutRaf = 0;
      bumpAnchorGeneration();
      hostMutationTick.value++;
    });
  });
  // characterData omitted: text-only edits don't move element rects, and
  // observing them turns idle pages with live tickers into per-frame
  // mutation streams. childList + attributes covers the cases our
  // selector resolution actually cares about.
  _hostObserver.observe(document.body, { subtree: true, childList: true, attributes: true });
}
export type FreehandTool = 'pen' | 'eraser' | 'highlight';
export type ShapeTool = 'rectangle' | 'circle' | 'line' | 'arrow';

export const FREEHAND = {
  has: (t: string): t is FreehandTool => t === 'pen' || t === 'eraser' || t === 'highlight',
};
export const SHAPES = {
  has: (t: string): t is ShapeTool => t === 'rectangle' || t === 'circle' || t === 'line' || t === 'arrow',
};

/**
 * Whether a tool paints on the drawing canvas, as opposed to placing a DOM-anchored
 * annotation over it. Listed positively for the same reason `SELECTION_TOOLS` is:
 * the deny-list form had already drifted between the two surfaces that ask.
 */
export const toolPaintsCanvas = (t: Tool) => FREEHAND.has(t) || SHAPES.has(t);

export const TOOLS: Tool[] = [
  'navigate',
  'highlight',
  'pen',
  'line',
  'arrow',
  'rectangle',
  'circle',
  'text',
  'comment',
  'selection',
  'area',
  'eraser',
  'inspect',
  'multiInspect',
  'measure',
  'guide',
];

const TOOL_SET: ReadonlySet<string> = new Set(TOOLS);
const isTool = (v: unknown): v is Tool => typeof v === 'string' && TOOL_SET.has(v);

function loadToolOrder(): Tool[] {
  try {
    const raw = _ls?.getItem('ml-tool-order');
    if (!raw) return TOOLS;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return TOOLS;
    const seen = new Set<Tool>();
    const order: Tool[] = [];
    for (const v of parsed) {
      if (isTool(v) && !seen.has(v)) {
        seen.add(v);
        order.push(v);
      }
    }
    // Append any tools added in code that aren't in the saved order yet
    for (const t of TOOLS) if (!seen.has(t)) order.push(t);
    return order;
  } catch {
    return TOOLS;
  }
}

export const toolOrder = signal<Tool[]>(loadToolOrder());

export function moveTool(from: number, to: number) {
  const arr = toolOrder.value;
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return;
  const next = arr.slice();
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return;
  next.splice(to, 0, moved);
  toolOrder.value = next;
  lsSet('ml-tool-order', JSON.stringify(next));
}

/**
 * Tool keybindings, aligned with Figma so the muscle memory transfers: V move,
 * R rectangle, O ellipse, T text, C comment, P pen, L line, E eraser. `H` is
 * the hand tool here as it is there, which is why the highlighter moved to
 * Shift+H. A tool may list more than one pattern — Figma binds the arrow to
 * Shift+L and the frame to both F and A — and the first entry is the one the
 * toolbar shows.
 */
export const TOOL_SHORTCUTS: {
  tool: Tool;
  /** tinykeys pattern, e.g. `KeyR` or `Shift+KeyL`. */
  pattern: string;
}[] = [
  { tool: 'navigate', pattern: 'KeyV' },
  { tool: 'pen', pattern: 'KeyP' },
  { tool: 'highlight', pattern: 'Shift+KeyH' },
  { tool: 'line', pattern: 'KeyL' },
  { tool: 'arrow', pattern: 'KeyA' },
  { tool: 'arrow', pattern: 'Shift+KeyL' },
  { tool: 'rectangle', pattern: 'KeyR' },
  { tool: 'circle', pattern: 'KeyO' },
  { tool: 'text', pattern: 'KeyT' },
  { tool: 'comment', pattern: 'KeyC' },
  { tool: 'selection', pattern: 'KeyS' },
  { tool: 'area', pattern: 'KeyG' },
  { tool: 'area', pattern: 'KeyF' },
  { tool: 'eraser', pattern: 'KeyE' },
  { tool: 'inspect', pattern: 'KeyI' },
  { tool: 'multiInspect', pattern: 'KeyX' },
  { tool: 'measure', pattern: 'KeyM' },
  { tool: 'guide', pattern: 'KeyU' },
];

const keyLabel = (pattern: string) => pattern.replace('Shift+', '\u21e7').replace('Key', '');

/** First pattern per tool — what the toolbar tooltip displays. */
export const SHORTCUTS: Partial<Record<Tool, string>> = {};
for (const { tool, pattern } of TOOL_SHORTCUTS) SHORTCUTS[tool] ??= keyLabel(pattern);

const PATTERN_TO_TOOL = new Map(TOOL_SHORTCUTS.map(({ tool, pattern }) => [pattern, tool]));

/**
 * Resolve a raw keydown to a tool, for hosts that hand-roll their key handling
 * instead of going through tinykeys. Any of ⌘/⌃/⌥ held means the key belongs to
 * some other binding, so nothing matches.
 */
export function toolForKeyEvent(e: KeyboardEvent): Tool | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  return PATTERN_TO_TOOL.get(`${e.shiftKey ? 'Shift+' : ''}${e.code}`) ?? null;
}

/**
 * Hand tool. Sticky while `H` is toggled on, momentary while Space is held —
 * both drag-scroll the annotated surface without leaving the current tool.
 */
export const handTool = signal(false);
export const spaceHeld = signal(false);
export const panActive = computed(() => handTool.value || spaceHeld.value);

// Structural rather than a setTool() wrapper: every tool writer (toolbar click,
// shortcut, Escape, the inspect layers) has to drop sticky hand mode, and a
// wrapper only the shortcut path called left the others holding it.
effect(() => {
  activeTool.value;
  handTool.value = false;
});

/**
 * Scrolls the annotated surface by a viewport delta. Null means the host window
 * itself (the extension); the web viewer sets it to scroll the proxied iframe,
 * which is a different scroller sitting behind a CSS transform.
 */
export const panScrollBy = signal<((dx: number, dy: number) => void) | null>(null);

export function panBy(dx: number, dy: number) {
  const fn = panScrollBy.value;
  fn ? fn(dx, dy) : window.scrollBy(dx, dy);
}

/**
 * Alt held on its own. Figma shows measurements whenever you hover with Alt
 * down, from any tool, so the measure overlays read this alongside their own
 * tool check. Fed by `bindFigmaKeys`.
 */
export const altHeld = signal(false);

/** Wraps a handler so a host can decide when the key belongs to it at all. */
type KeyGuard = (fn: (e: KeyboardEvent) => void) => (e: KeyboardEvent) => void;

/**
 * The Figma-parity half of a host's keymap: the tool letters, ⌘D, ⌘\, and the
 * held Space/Alt modifiers with their release. Both hosts bound this identically
 * and differed only in which guard wrapped each key, so the guards are the
 * parameters and the table lives here — press and release included, since a
 * keydown bound without its keyup leaves the pan overlay stuck on.
 *
 * The blur listener is the other half of that: a blur (⌘Tab, devtools) eats the
 * keyup outright.
 */
export function bindFigmaKeys({
  target,
  guard,
  viewGuard = guard,
}: {
  target: Window;
  /** Wraps the editing keys — a read-only host drops them. */
  guard: KeyGuard;
  /** Wraps zoom/pan/measure navigation, which stays live read-only. Defaults to `guard`. */
  viewGuard?: KeyGuard;
}): () => void {
  const pd = (wrap: KeyGuard, fn: () => void) =>
    wrap((e) => {
      e.preventDefault();
      fn();
    });

  // Space and Alt both auto-repeat while held, and the handlers are built once
  // here rather than per keypress so a repeat costs nothing to dispatch.
  const pressSpace = pd(viewGuard, () => {
    spaceHeld.value = true;
  });
  const pressAlt = viewGuard(() => {
    altHeld.value = true;
  });

  const bindings: Record<string, (e: KeyboardEvent) => void> = {
    '$mod+KeyD': pd(guard, duplicateLastOp),
    // Figma's ⌘\ — hide the chrome, keep the annotations on screen.
    '$mod+Backslash': pd(viewGuard, toggleToolbarMinimized),
    KeyH: pd(viewGuard, () => {
      handTool.value = !handTool.value;
    }),
    // preventDefault stops the host page from page-scrolling under the pan. Once
    // the first press has been accepted the OS repeats carry nothing new, so they
    // skip the guard rather than walking the composed path ~30 times a second.
    // Gated on the held signal so a press the guard rejected — Space typed into a
    // text field — still falls through to it and keeps its default.
    Space: (e) => {
      if (e.repeat && spaceHeld.peek()) {
        e.preventDefault();
        return;
      }
      pressSpace(e);
    },
    Alt: (e) => {
      if (e.repeat && altHeld.peek()) return;
      pressAlt(e);
    },
  };
  for (const { tool, pattern } of TOOL_SHORTCUTS) {
    bindings[pattern] = pd(guard, () => {
      activeTool.value = tool;
    });
  }

  const release = () => {
    spaceHeld.value = false;
    altHeld.value = false;
  };
  const unbindDown = tinykeys(target, bindings);
  const unbindUp = tinykeys(
    target,
    {
      Space: () => {
        spaceHeld.value = false;
      },
      Alt: () => {
        altHeld.value = false;
      },
    },
    { event: 'keyup' },
  );
  target.addEventListener('blur', release);
  return () => {
    unbindDown();
    unbindUp();
    target.removeEventListener('blur', release);
  };
}

/** The M tool is selected — pinned anchors and the crosshair belong to it alone. */
export const measureToolActive = computed(() => activeTool.value === 'measure');

/** The measure overlays should render: the M tool, or a held Alt from any tool. */
export const measureActive = computed(() => measureToolActive.value || altHeld.value);

export function pushOp(op: DrawOp) {
  operations.value = [...operations.value, op];
  if (undoStack.value.length) undoStack.value = [];
  onOpPushed.value?.(op);
  drafts.scheduleSave();
}

/** Create and push a reply to an existing comment */
export function pushReply(parentOp: { id: string; x: number; y: number }, text: string) {
  const op: CommentOp = {
    id: nanoid(),
    tool: 'comment',
    num: commentCounter.value + 1,
    text,
    x: parentOp.x,
    y: parentOp.y,
    color: color.value,
    lineWidth: lineWidth.value,
    ts: Date.now(),
    parentId: parentOp.id,
    author: localUser.name,
    meta: getCommentMeta(),
  };
  pushOp(op);
}

export function setOpStatus(opId: string, status: CommentStatus) {
  let patch: Partial<CommentOp> | Partial<SelectionOp> | undefined;
  operations.value = operations.value.map((op) => {
    if (op.id !== opId) return op;
    if (op.tool === 'comment') {
      if (resolveOpStatus(op) === status) return op;
      const p: Partial<CommentOp> = { status, resolved: status === 'resolved' };
      patch = p;
      return { ...op, ...p };
    }
    if (op.tool === 'selection') {
      if ((op.status ?? 'open') === status) return op;
      const p: Partial<SelectionOp> = { status };
      patch = p;
      return { ...op, ...p };
    }
    return op;
  });
  if (patch) onOpUpdated.value?.(opId, patch);
}

/** Assign the annotation's thread to a person by display name; null clears it. */
export function setOpAssignee({ opId, assignee }: { opId: string; assignee: string | null }) {
  let changed = false;
  operations.value = operations.value.map((op) => {
    if (op.id !== opId || !isAnnotationOp(op) || (op.assignee ?? null) === assignee) return op;
    changed = true;
    return { ...op, assignee };
  });
  if (changed) onOpUpdated.value?.(opId, { assignee });
}

/** @deprecated Use setOpStatus instead */
export const setCommentStatus = setOpStatus;
/** @deprecated Use setOpStatus instead */
export const setSelectionStatus = setOpStatus;

const BROWSERS: [string, string][] = [
  ['Firefox/', 'Firefox'],
  ['Edg/', 'Edge'],
  ['Chrome/', 'Chrome'],
  ['Safari/', 'Safari'],
];
const OS_HINTS: [string, string][] = [
  ['Mac OS', 'macOS'],
  ['Windows', 'Windows'],
  ['Linux', 'Linux'],
  ['Android', 'Android'],
  ['iPhone', 'iOS'],
  ['iPad', 'iOS'],
];

// Cache browser/OS detection — UA doesn't change mid-session
const _cachedUA = (() => {
  const ua = navigator.userAgent;
  return {
    browser: BROWSERS.find(([hint]) => ua.includes(hint))?.[1] ?? 'Unknown',
    os: OS_HINTS.find(([hint]) => ua.includes(hint))?.[1] ?? 'Unknown',
  };
})();

/** Capture browser metadata for a comment */
export function getCommentMeta(): CommentMeta {
  return {
    url: location.href,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    ..._cachedUA,
  };
}

// Export PNG callback — set by App component
export const onExportPng = signal<(() => void) | null>(null);

/** Bumped on undo/redo to trigger a canvas flash */
export const undoRedoFlash = signal(0);

export function undo() {
  // While the guide tool is active, ⌘Z pops the most recent guide op specifically —
  // even if a non-guide op was added later — so guide scratch work feels independent.
  if (activeTool.value === 'guide') {
    const ops = operations.value;
    for (let i = ops.length - 1; i >= 0; i--) {
      const removed = ops[i];
      if (removed?.tool === 'guide') {
        operations.value = ops.filter((_, idx) => idx !== i);
        onUndone.value?.(removed.id);
        undoRedoFlash.value++;
        drafts.scheduleSave();
        return;
      }
    }
  }
  const ops = operations.value;
  const stack = undoStack.value;
  const last = stack[stack.length - 1];
  if (!ops.length && last && 'type' in last) {
    operations.value = last.ops;
    undoStack.value = stack.slice(0, -1);
    return;
  }
  const removed = ops[ops.length - 1];
  if (!removed) return;
  undoStack.value = [...stack, removed];
  operations.value = ops.slice(0, -1);
  onUndone.value?.(removed.id);
  undoRedoFlash.value++;
  drafts.scheduleSave();
}

export function redo() {
  const stack = undoStack.value;
  const last = stack[stack.length - 1];
  if (!last || 'type' in last) return;
  operations.value = [...operations.value, last];
  undoStack.value = stack.slice(0, -1);
  undoRedoFlash.value++;
  drafts.scheduleSave();
}

export function clearAll() {
  const ops = operations.value;
  if (!ops.length) return;
  if (!confirm("Clear all annotations on this page? This can't be undone.")) return;
  undoStack.value = [...undoStack.value, { type: 'clear' as const, ops: structuredClone(ops) }];
  operations.value = [];
  onCleared.value?.();
  drafts.clear();
}

/** Remove a single op by id. Mirrors `undo` on the wire so peers see it. */
export function deleteOp(id: string) {
  const ops = operations.value;
  const op = ops.find((o) => o.id === id);
  if (!op) return;
  operations.value = ops.filter((o) => o.id !== id);
  onUndone.value?.(id);
  drafts.scheduleSave();
}

/** Down-right nudge on a duplicate, so the copy reads as a new object, not a redraw. */
const DUPLICATE_OFFSET = 12;

/**
 * Figma's ⌘D. Annotations have no selection model yet, so this duplicates the most
 * recent duplicable op — the one Figma would have left selected right after you drew
 * it. Repeat presses cascade, because each copy becomes the new most-recent op.
 */
export function duplicateLastOp() {
  // Walked backwards in place: the hit is almost always the last element, and
  // `operations` runs to hundreds of ops that a copy-then-reverse would touch twice.
  const ops = operations.value;
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i];
    const moved = op && translateOp({ op, dx: DUPLICATE_OFFSET, dy: DUPLICATE_OFFSET });
    if (!moved) continue;
    // The element anchor is dropped: re-resolving it would snap the copy back onto
    // the original and eat the offset.
    const copy = { ...moved, id: nanoid(), target: undefined };
    // An area op carries a `ts`, and the copy was made now, not when the original was.
    return pushOp(copy.tool === 'area' ? { ...copy, ts: Date.now() } : copy);
  }
  toast('Nothing to duplicate', 'info', 1800);
}

/**
 * Figma-style ruler guides — viewport-anchored horizontal/vertical lines. Stored
 * as ops in the main op stream so they persist across reloads (localStorage draft
 * in the extension, D1 + DO broadcast on the web). The `guides` signal is a
 * computed view over `operations` filtered to `tool: 'guide'`.
 */
export type Orientation = 'horizontal' | 'vertical';
export type Guide = GuideOp;
export const guides = computed<GuideOp[]>(() => operations.value.filter((op): op is GuideOp => op.tool === 'guide'));
export const selectedGuideId = signal<string | null>(null);

export function addGuide(orientation: Orientation, position: number): GuideOp {
  const op: GuideOp = {
    id: nanoid(),
    tool: 'guide',
    color: color.value,
    lineWidth: lineWidth.value,
    orientation,
    position,
  };
  pushOp(op);
  return op;
}

function patchGuide(id: string, patch: Partial<Pick<GuideOp, 'orientation' | 'position'>>) {
  let applied = false;
  operations.value = operations.value.map((op) => {
    if (op.id !== id || op.tool !== 'guide') return op;
    if (
      (patch.position === undefined || patch.position === op.position) &&
      (patch.orientation === undefined || patch.orientation === op.orientation)
    ) {
      return op;
    }
    applied = true;
    return { ...op, ...patch };
  });
  if (applied) {
    onOpUpdated.value?.(id, patch);
    drafts.scheduleSave();
  }
}

export function updateGuide(id: string, position: number) {
  patchGuide(id, { position });
}

// newPosition is required: the stored `position` swaps axes on flip, so without supplying the
// new (perpendicular) coord the flipped guide would jump to an arbitrary spot.
export function flipGuide(id: string, newPosition: number) {
  const g = guides.value.find((p) => p.id === id);
  if (!g) return;
  patchGuide(id, { orientation: g.orientation === 'vertical' ? 'horizontal' : 'vertical', position: newPosition });
}

export function removeGuide(id: string) {
  if (selectedGuideId.value === id) selectedGuideId.value = null;
  deleteOp(id);
}

export function clearGuides() {
  selectedGuideId.value = null;
  for (const g of guides.value) deleteOp(g.id);
}

/**
 * Singleton context-menu state. A pin sets this on right-click; the renderer in App.tsx
 * shows the menu and clears the signal on outside-click / Esc / item-select.
 */
export interface ContextMenuItem {
  label: string;
  icon?: string;
  onClick: () => void;
  danger?: boolean;
}
export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}
export const contextMenu = signal<ContextMenuState | null>(null);

export function openContextMenu(e: MouseEvent, items: ContextMenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  contextMenu.value = { x: e.clientX, y: e.clientY, items };
}

export function closeContextMenu() {
  contextMenu.value = null;
}
