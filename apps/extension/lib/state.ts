import { computed, signal } from '@preact/signals';
import { nanoid } from 'nanoid';
import type { CommentOp, DrawOp, Peer, Tool } from './types';

export const visible = signal(false);
export const activeTool = signal<Tool>('navigate');
export const color = signal('#f43f5e');
export const lineWidth = signal(2);

export const operations = signal<DrawOp[]>([]);
export const undoStack = signal<(DrawOp | { type: 'clear'; ops: DrawOp[] })[]>([]);
export const commentCounter = computed(() => operations.value.filter((o) => o.tool === 'comment').length);
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
export const localUser = {
  name: `${randomPick(ADJECTIVES)} ${randomPick(ANIMALS)}`,
  color: randomPick(CURSOR_COLORS),
};

// Callback for WebSocket sync — set by useRealtimeSync hook
export const onOpPushed = signal<((op: DrawOp) => void) | null>(null);
export const onUndone = signal<((opId: string) => void) | null>(null);
export const onCleared = signal<(() => void) | null>(null);
export const onCursorMove = signal<((x: number, y: number, tool: string) => void) | null>(null);

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

export const comments = computed(() => operations.value.filter((op): op is CommentOp => op.tool === 'comment'));

/** Root comments only (no parentId) */
export const rootComments = computed(() => comments.value.filter((c) => !c.parentId));

/** Get replies for a given comment id */
export function getReplies(parentId: string): CommentOp[] {
  return comments.value.filter((c) => c.parentId === parentId).sort((a, b) => a.ts - b.ts);
}

/** Annotation panel open state */
export const showAnnotationPanel = signal(false);

export const isDrawingTool = (t: Tool) => t !== 'navigate';
export const FREEHAND: Set<string> = new Set(['pen', 'eraser', 'highlight']);
export const SHAPES: Set<string> = new Set(['rectangle', 'circle', 'line', 'arrow']);

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
  'eraser',
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
  E: 'eraser',
};
export const SHORTCUTS: Partial<Record<Tool, string>> = Object.fromEntries(
  Object.entries(SHORTCUT_MAP).map(([k, v]) => [v, k]),
);

export function pushOp(op: DrawOp) {
  operations.value = [...operations.value, op];
  undoStack.value = [];
  onOpPushed.value?.(op);
}

/** Create and push a reply to an existing comment */
export function pushReply(parentOp: { id: string; x: number; y: number }, text: string) {
  pushOp({
    id: nanoid(),
    tool: 'comment' as const,
    num: commentCounter.value + 1,
    text,
    x: parentOp.x,
    y: parentOp.y,
    color: color.value,
    lineWidth: lineWidth.value,
    ts: Date.now(),
    parentId: parentOp.id,
    author: localUser.name,
  } as DrawOp);
}

export function resolveComment(opId: string) {
  operations.value = operations.value.map((op) =>
    op.id === opId && op.tool === 'comment' ? { ...op, resolved: !op.resolved } : op,
  );
  onOpPushed.value?.(operations.value.find((o) => o.id === opId) as DrawOp);
}

// Export PNG callback — set by App component
export const onExportPng = signal<(() => void) | null>(null);

export function undo() {
  const ops = operations.value;
  const stack = undoStack.value;
  if (!ops.length && stack.length && 'type' in stack[stack.length - 1]) {
    const last = stack[stack.length - 1] as { type: 'clear'; ops: DrawOp[] };
    operations.value = last.ops;
    undoStack.value = stack.slice(0, -1);
    return;
  }
  if (!ops.length) return;
  const removed = ops[ops.length - 1];
  undoStack.value = [...stack, removed];
  operations.value = ops.slice(0, -1);
  onUndone.value?.(removed.id);
}

export function redo() {
  const stack = undoStack.value;
  if (!stack.length) return;
  const last = stack[stack.length - 1];
  if ('type' in last) return;
  operations.value = [...operations.value, last];
  undoStack.value = stack.slice(0, -1);
}

export function clearAll() {
  const ops = operations.value;
  if (!ops.length) return;
  if (!confirm('Clear all annotations?')) return;
  undoStack.value = [...undoStack.value, { type: 'clear' as const, ops: structuredClone(ops) }];
  operations.value = [];
  onCleared.value?.();
}
