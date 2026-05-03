import { computed, signal } from '@preact/signals';
import { nanoid } from 'nanoid';
import { createDraftStore } from './drafts';
import { ELEMENT_INSPECTOR_HEADING } from './selector';
import type { CommentMeta, CommentOp, CommentStatus, DrawOp, Peer, SelectionOp, Tool } from './types';

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
export const theme = signal<Theme>(isTheme(storedTheme) ? storedTheme : 'system');
export function cycleTheme() {
  const systemDark = typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
  const order: Theme[] = systemDark ? ['system', 'light'] : ['system', 'dark'];
  const next = order[(order.indexOf(theme.value) + 1) % order.length];
  theme.value = next;
  lsSet('ml-theme', next === 'system' ? null : next);
  const root = typeof document !== 'undefined' ? document.documentElement.classList : null;
  root?.remove('light', 'dark');
  next !== 'system' && root?.add(next);
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

export const operations = signal<DrawOp[]>([]);
export const undoStack = signal<(DrawOp | { type: 'clear'; ops: DrawOp[] })[]>([]);
export const commentCounter = computed(() => comments.value.length);
export const showShareDialog = signal(false);

export const peers = signal<Map<string, Peer>>(new Map());
/** Total peers including self (peers map excludes local user) */
export const peerCount = computed(() => peers.value.size + 1);

// Local user identity (random name + color per session)
const CURSOR_COLORS = [
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
];
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
];
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
];
function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
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
export const onUndone = signal<((opId: string) => void) | null>(null);
export const onCleared = signal<(() => void) | null>(null);
export const onCursorMove = signal<((x: number, y: number, tool: string) => void) | null>(null);
export const onProfileChange = signal<((name: string, color: string) => void) | null>(null);

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
export function copyText(text: string, label = 'Copied!') {
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
}

// Single-pass partition of operations into comments, selections, root comments, and reply map
const _opIndex = computed(() => {
  const allComments: CommentOp[] = [];
  const allSelections: SelectionOp[] = [];
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
    }
  }
  return { allComments, allSelections, roots, replies };
});

export const comments = computed(() => _opIndex.value.allComments);
export const selections = computed(() => _opIndex.value.allSelections);
export const rootComments = computed(() => _opIndex.value.roots);

/** Get replies for a given comment id (O(1) lookup) */
export function getReplies(parentId: string): CommentOp[] {
  return _opIndex.value.replies.get(parentId) ?? [];
}

/** Annotation panel open state */
export const showAnnotationPanel = signal(false);

/** Comment status filter for annotation panel */
export const commentFilter = signal<CommentStatus | 'all'>('all');

/** Derive comment status with backwards compat for old `resolved` field */
export function getCommentStatus(op: CommentOp): CommentStatus {
  return op.status || (op.resolved ? 'resolved' : 'open');
}

export const STATUS_LABELS: Record<CommentStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
};

export const isDrawingTool = (t: Tool) => t !== 'navigate';
/** True while user is actively drawing (mousedown on canvas) */
export const isDrawingActive = signal(false);
export type FreehandTool = 'pen' | 'eraser' | 'highlight';
export type ShapeTool = 'rectangle' | 'circle' | 'line' | 'arrow';

export const FREEHAND = {
  has: (t: string): t is FreehandTool => t === 'pen' || t === 'eraser' || t === 'highlight',
};
export const SHAPES = {
  has: (t: string): t is ShapeTool => t === 'rectangle' || t === 'circle' || t === 'line' || t === 'arrow',
};

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
  'eraser',
  'inspect',
];

export const SHORTCUT_MAP: Record<string, Tool> = {
  V: 'navigate',
  H: 'highlight',
  P: 'pen',
  L: 'line',
  A: 'arrow',
  R: 'rectangle',
  O: 'circle',
  T: 'text',
  C: 'comment',
  S: 'selection',
  E: 'eraser',
  I: 'inspect',
};
export const SHORTCUTS: Partial<Record<Tool, string>> = Object.fromEntries(
  Object.entries(SHORTCUT_MAP).map(([k, v]) => [v, k]),
);

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
  let updated: DrawOp | undefined;
  operations.value = operations.value.map((op) => {
    if (op.id !== opId) return op;
    if (op.tool === 'comment') {
      updated = { ...op, status, resolved: status === 'resolved' };
    } else if (op.tool === 'selection') {
      updated = { ...op, status };
    } else {
      return op;
    }
    return updated;
  });
  if (updated) onOpPushed.value?.(updated);
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
  const ops = operations.value;
  const stack = undoStack.value;
  const last = stack[stack.length - 1];
  if (!ops.length && last && 'type' in last) {
    operations.value = last.ops;
    undoStack.value = stack.slice(0, -1);
    return;
  }
  if (!ops.length) return;
  const removed = ops[ops.length - 1];
  undoStack.value = [...stack, removed];
  operations.value = ops.slice(0, -1);
  onUndone.value?.(removed.id);
  undoRedoFlash.value++;
  drafts.scheduleSave();
}

export function redo() {
  const stack = undoStack.value;
  if (!stack.length) return;
  const last = stack[stack.length - 1];
  if ('type' in last) return;
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
