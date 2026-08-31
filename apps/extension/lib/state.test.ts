import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { AreaOp, CommentOp, InspectOp, SelectionOp, TextOp } from '@marklayer/types';
import { setAnalytics } from './analytics';
import { ELEMENT_INSPECTOR_HEADING } from './selector';
import { toasts } from './toasts';

/* The draft store is a side effect of nearly every mutation here, and there is
   no IndexedDB in the test DOM - `idb-keyval` throws synchronously reaching for
   it. Drafts have their own suite; stand the store down for this one. */
mock.module('idb-keyval', () => ({
  createStore: () => ({}),
  get: async () => undefined,
  set: async () => {},
  del: async () => {},
}));

const {
  activeTool,
  addGuide,
  addToInspectorStack,
  altHeld,
  annotatedUrl,
  annotationPanelOpen,
  areas,
  buildInspectorStackPrompt,
  clearAll,
  clearGuides,
  clearInspectorStack,
  color,
  copyInspectorStack,
  colorName,
  comments,
  commentCounter,
  contextMenu,
  closeContextMenu,
  cursorColorName,
  cycleTheme,
  deleteOp,
  duplicateLastOp,
  elementToolsUnavailable,
  ensureHostMutationObserver,
  ensureScrollTickListener,
  flipGuide,
  focusedAnnotationId,
  getCommentMeta,
  getReplies,
  guides,
  handTool,
  inspects,
  inspectorStack,
  inspectorStackOpen,
  isDrawingTool,
  isOutputDetail,
  localUser,
  markersVisible,
  measureActive,
  moveTool,
  onOpPushed,
  onOpUpdated,
  onProfileChange,
  onUndone,
  openContextMenu,
  operations,
  peerCount,
  peers,
  outputDetail,
  panActive,
  panBy,
  panScrollBy,
  pushOp,
  pushReply,
  redo,
  relabelOwnWork,
  removeFromInspectorStack,
  removeGuide,
  rootComments,
  selectTool,
  selectionCaptureArmed,
  selections,
  setOpAssignee,
  setOpPriority,
  setColor,
  setCommentStatus,
  signedBy,
  setOpStatus,
  setSelectionStatus,
  setUserColor,
  setOutputDetail,
  SHORTCUTS,
  setUserName,
  showAnnotationPanel,
  scrollTick,
  showSettings,
  showShareDialog,
  spaceHeld,
  theme,
  toggleClearOnCopy,
  toggleMarkersVisible,
  toggleUiHidden,
  toolCapturesSelection,
  toolForKeyEvent,
  toolOrder,
  toolPaintsCanvas,
  TOOLS,
  uiHidden,
  undo,
  undoRedoFlash,
  undoStack,
  updateGuide,
  visibleTools,
} = await import('./state');

const base = { color: '#000', lineWidth: 2 };

const comment = (over: Partial<CommentOp> & { id: string }): CommentOp => ({
  ...base,
  tool: 'comment',
  num: 1,
  text: 'x',
  x: 10,
  y: 20,
  ts: 0,
  ...over,
});

const text = (id: string, over: Partial<TextOp> = {}): TextOp => ({
  ...base,
  id,
  tool: 'text',
  text: 'label',
  x: 0,
  y: 0,
  fontSize: 14,
  ...over,
});

const selection = (id: string, over: Partial<SelectionOp> = {}): SelectionOp => ({
  ...base,
  id,
  tool: 'selection',
  text: 'quote',
  rects: [{ x: 0, y: 0, width: 5, height: 5 }],
  ts: 0,
  ...over,
});

const area = (id: string, over: Partial<AreaOp> = {}): AreaOp => ({
  ...base,
  id,
  tool: 'area',
  startX: 0,
  startY: 0,
  endX: 10,
  endY: 10,
  ts: 0,
  ...over,
});

const inspect = (id: string): InspectOp => ({
  ...base,
  id,
  tool: 'inspect',
  selector: 'h1',
  tag: 'h1',
  markdown: '',
  rect: { x: 0, y: 0, width: 10, height: 10 },
  ts: 0,
});

beforeEach(() => {
  operations.value = [];
  undoStack.value = [];
  activeTool.value = 'navigate';
  onOpPushed.value = null;
  onOpUpdated.value = null;
  onUndone.value = null;
});

describe('derived op views', () => {
  test('partitions one pass of operations into every view a layer reads', () => {
    operations.value = [
      comment({ id: 'c1' }),
      comment({ id: 'r1', parentId: 'c1' }),
      selection('s1'),
      area('a1'),
      inspect('i1'),
      text('t1'),
    ];
    expect(comments.value.map((o) => o.id)).toEqual(['c1', 'r1']);
    expect(rootComments.value.map((o) => o.id)).toEqual(['c1']);
    expect(selections.value.map((o) => o.id)).toEqual(['s1']);
    expect(areas.value.map((o) => o.id)).toEqual(['a1']);
    expect(inspects.value.map((o) => o.id)).toEqual(['i1']);
  });

  test('keeps replies out of the root list and reachable by their parent', () => {
    operations.value = [
      comment({ id: 'c1' }),
      comment({ id: 'r1', parentId: 'c1' }),
      comment({ id: 'r2', parentId: 'c1' }),
    ];
    expect(getReplies('c1').map((o) => o.id)).toEqual(['r1', 'r2']);
    expect(getReplies('nobody')).toEqual([]);
  });

  test('counts every comment, replies included, because that is what numbers the next one', () => {
    operations.value = [comment({ id: 'c1' }), comment({ id: 'r1', parentId: 'c1' })];
    expect(commentCounter.value).toBe(2);
  });
});

describe('pushOp', () => {
  test('appends the op and hands it to the peer transport', () => {
    const sent: string[] = [];
    onOpPushed.value = (op) => sent.push(op.id);
    operations.value = [text('t1')];
    pushOp(text('t2'));
    expect(operations.value.map((o) => o.id)).toEqual(['t1', 't2']);
    expect(sent).toEqual(['t2']);
  });

  test('drops the redo stack, so new work cannot be redone over', () => {
    operations.value = [text('t1')];
    undo();
    expect(undoStack.value).toHaveLength(1);
    pushOp(text('t2'));
    expect(undoStack.value).toEqual([]);
  });
});

describe('pushReply', () => {
  test('hangs the reply off its parent at the parent own point', () => {
    operations.value = [comment({ id: 'c1', x: 300, y: 400 })];
    pushReply({ parent: { id: 'c1', x: 300, y: 400 }, text: 'agreed' });

    const reply = operations.value[1];
    expect(reply).toMatchObject({ tool: 'comment', parentId: 'c1', text: 'agreed', x: 300, y: 400 });
    expect(getReplies('c1')).toHaveLength(1);
  });

  test('numbers the reply past every existing comment', () => {
    operations.value = [comment({ id: 'c1', num: 1 }), comment({ id: 'c2', num: 2 })];
    pushReply({ parent: { id: 'c1', x: 0, y: 0 }, text: 'r' });
    expect(operations.value[2]).toMatchObject({ num: 3 });
  });

  test('signs the reply with the local identity', () => {
    operations.value = [comment({ id: 'c1' })];
    pushReply({ parent: { id: 'c1', x: 0, y: 0 }, text: 'r' });
    expect(operations.value[1]).toMatchObject({ author: localUser.name, authorId: localUser.id });
  });

  test('omits an empty mention list rather than storing one', () => {
    // An empty array on the wire reads as "tagged nobody deliberately".
    operations.value = [comment({ id: 'c1' })];
    pushReply({ parent: { id: 'c1', x: 0, y: 0 }, text: 'r', mentions: [] });
    expect(operations.value[1]).toMatchObject({ mentions: undefined });
  });
});

describe('setOpStatus', () => {
  test('keeps the legacy resolved boolean in step with the status', () => {
    // A peer or an export still reading `resolved` must not disagree with the
    // status printed beside it.
    operations.value = [comment({ id: 'c1' })];
    setOpStatus('c1', 'resolved');
    expect(operations.value[0]).toMatchObject({ status: 'resolved', resolved: true });

    setOpStatus('c1', 'in_progress');
    expect(operations.value[0]).toMatchObject({ status: 'in_progress', resolved: false });
  });

  test('counts an approved thread as resolved to a reader that only knows the boolean', () => {
    operations.value = [comment({ id: 'c1' })];
    setOpStatus('c1', 'approved');
    expect(operations.value[0]).toMatchObject({ status: 'approved', resolved: true });
  });

  test('sets only status on an annotation that never had the boolean', () => {
    operations.value = [selection('s1')];
    setOpStatus('s1', 'resolved');
    expect(operations.value[0]).toMatchObject({ tool: 'selection', status: 'resolved' });
    expect(operations.value[0]).not.toHaveProperty('resolved');
  });

  test('broadcasts the patch once, and not at all when the status already holds', () => {
    const patches: Array<[string, Record<string, unknown>]> = [];
    onOpUpdated.value = (id, patch) => patches.push([id, patch]);
    operations.value = [comment({ id: 'c1', status: 'open' })];

    setOpStatus('c1', 'open');
    expect(patches).toEqual([]);

    setOpStatus('c1', 'resolved');
    expect(patches).toEqual([['c1', { status: 'resolved', resolved: true }]]);
  });

  test('reads a legacy resolved flag as the current status, so re-resolving is a no-op', () => {
    const patches: string[] = [];
    onOpUpdated.value = (id) => patches.push(id);
    operations.value = [comment({ id: 'c1', resolved: true })];
    setOpStatus('c1', 'resolved');
    expect(patches).toEqual([]);
  });

  test('leaves a canvas op alone - a stroke has no triage state', () => {
    operations.value = [text('t1')];
    setOpStatus('t1', 'resolved');
    expect(operations.value[0]).not.toHaveProperty('status');
  });
});

describe('setOpPriority and setOpAssignee', () => {
  test('send an explicit null when cleared, since a dropped key reads as unchanged', () => {
    const patches: Array<Record<string, unknown>> = [];
    onOpUpdated.value = (_id, patch) => patches.push(patch);
    operations.value = [comment({ id: 'c1', priority: 'high', assignee: 'Ada' })];

    setOpPriority({ opId: 'c1', priority: null });
    setOpAssignee({ opId: 'c1', assignee: null });
    expect(patches).toEqual([{ priority: null }, { assignee: null }]);
    expect(operations.value[0]).toMatchObject({ priority: null, assignee: null });
  });

  test('treat an absent field and an explicit null as the same value', () => {
    const patches: Array<Record<string, unknown>> = [];
    onOpUpdated.value = (_id, patch) => patches.push(patch);
    operations.value = [comment({ id: 'c1' })];

    setOpPriority({ opId: 'c1', priority: null });
    setOpAssignee({ opId: 'c1', assignee: null });
    expect(patches).toEqual([]);
  });

  test('apply a value and report it once', () => {
    const patches: Array<Record<string, unknown>> = [];
    onOpUpdated.value = (_id, patch) => patches.push(patch);
    operations.value = [comment({ id: 'c1' })];

    setOpPriority({ opId: 'c1', priority: 'low' });
    setOpPriority({ opId: 'c1', priority: 'low' });
    expect(patches).toEqual([{ priority: 'low' }]);
  });
});

describe('undo and redo', () => {
  test('pops the newest op and puts it back', () => {
    operations.value = [text('t1'), text('t2')];
    undo();
    expect(operations.value.map((o) => o.id)).toEqual(['t1']);
    redo();
    expect(operations.value.map((o) => o.id)).toEqual(['t1', 't2']);
    expect(undoStack.value).toEqual([]);
  });

  test('tells the peer transport which op went away', () => {
    const undone: string[] = [];
    onUndone.value = (id) => undone.push(id);
    operations.value = [text('t1')];
    undo();
    expect(undone).toEqual(['t1']);
  });

  test('does nothing on an empty canvas with nothing to restore', () => {
    undo();
    redo();
    expect(operations.value).toEqual([]);
  });

  test('while the guide tool is active, undo pops the newest guide rather than the newest op', () => {
    // Guide scratch work has to feel independent of the drawing underneath it.
    const guide = addGuide('vertical', 200);
    activeTool.value = 'guide';
    pushOp(text('t1'));
    undo();
    expect(operations.value.map((o) => o.id)).toEqual(['t1']);
    expect(guides.value).toEqual([]);
    // The guide undo is a removal, not a history entry, so there is nothing to redo.
    expect(undoStack.value).toEqual([]);
    expect(guide.tool).toBe('guide');
  });

  test('falls through to the normal undo when the guide tool is active with no guides', () => {
    activeTool.value = 'guide';
    operations.value = [text('t1')];
    undo();
    expect(operations.value).toEqual([]);
  });

  test('restores a whole cleared canvas, but only once the canvas is empty', () => {
    const confirmed = withConfirm(true, () => {
      operations.value = [text('t1'), text('t2')];
      clearAll();
    });
    expect(confirmed).toBe(true);
    expect(operations.value).toEqual([]);

    undo();
    expect(operations.value.map((o) => o.id)).toEqual(['t1', 't2']);
    expect(undoStack.value).toEqual([]);
  });

  test('refuses to redo a clear, so a restore cannot be undone back to empty', () => {
    withConfirm(true, () => {
      operations.value = [text('t1')];
      clearAll();
    });
    redo();
    // The clear sentinel is not an op; replaying it would push a fake entry.
    expect(operations.value).toEqual([]);
    expect(undoStack.value).toHaveLength(1);
  });

  test('clearAll leaves the canvas alone when the prompt is declined', () => {
    withConfirm(false, () => {
      operations.value = [text('t1')];
      clearAll();
    });
    expect(operations.value.map((o) => o.id)).toEqual(['t1']);
    expect(undoStack.value).toEqual([]);
  });
});

describe('deleteOp', () => {
  test('removes the named op and reports it, leaving the rest in order', () => {
    const undone: string[] = [];
    onUndone.value = (id) => undone.push(id);
    operations.value = [text('t1'), text('t2'), text('t3')];
    deleteOp('t2');
    expect(operations.value.map((o) => o.id)).toEqual(['t1', 't3']);
    expect(undone).toEqual(['t2']);
  });

  test('does nothing, and reports nothing, for an id that is not there', () => {
    const undone: string[] = [];
    onUndone.value = (id) => undone.push(id);
    operations.value = [text('t1')];
    deleteOp('gone');
    expect(operations.value).toHaveLength(1);
    expect(undone).toEqual([]);
  });
});

describe('duplicateLastOp', () => {
  test('offsets the copy down-right and gives it a new identity', () => {
    operations.value = [text('t1', { x: 100, y: 200 })];
    duplicateLastOp();

    const copy = operations.value[1];
    expect(copy).toMatchObject({ tool: 'text', x: 112, y: 212 });
    expect(copy?.id).not.toBe('t1');
  });

  test('drops the element anchor, which would otherwise snap the copy back', () => {
    operations.value = [text('t1', { target: { selector: '#hero', tag: 'h1', markdown: '', offsetX: 0, offsetY: 0 } })];
    duplicateLastOp();
    expect(operations.value[1]).toMatchObject({ target: undefined });
  });

  test('cascades, because each copy becomes the new most-recent op', () => {
    operations.value = [text('t1', { x: 0, y: 0 })];
    duplicateLastOp();
    duplicateLastOp();
    expect(operations.value.map((o) => ('x' in o ? o.x : null))).toEqual([0, 12, 24]);
  });

  test('stamps an area copy with the time it was made, not the original', () => {
    operations.value = [area('a1', { ts: 1 })];
    duplicateLastOp();
    const copy = operations.value[1];
    expect(copy && 'ts' in copy && copy.ts).toBeGreaterThan(1);
  });

  test('skips past an op that cannot be translated', () => {
    // A guide has no anchor point to nudge; the text below it is the real target.
    operations.value = [text('t1', { x: 5, y: 5 })];
    addGuide('vertical', 300);
    duplicateLastOp();
    expect(operations.value[operations.value.length - 1]).toMatchObject({ tool: 'text', x: 17, y: 17 });
  });

  test('leaves an empty canvas empty', () => {
    duplicateLastOp();
    expect(operations.value).toEqual([]);
  });
});

describe('guides', () => {
  test('ride the main op stream rather than living in their own state', () => {
    const g = addGuide('vertical', 240);
    expect(operations.value).toEqual([g]);
    expect(guides.value).toEqual([g]);
  });

  test('move, and report the move once', () => {
    const patches: Array<Record<string, unknown>> = [];
    const g = addGuide('vertical', 240);
    onOpUpdated.value = (_id, patch) => patches.push(patch);

    updateGuide(g.id, 300);
    updateGuide(g.id, 300);
    expect(guides.value[0]?.position).toBe(300);
    expect(patches).toEqual([{ position: 300 }]);
  });

  test('swap axis and land on the supplied perpendicular coordinate when flipped', () => {
    // Without a new position the flipped guide would keep the old axis number and
    // jump to an arbitrary spot.
    const g = addGuide('vertical', 240);
    flipGuide(g.id, 90);
    expect(guides.value[0]).toMatchObject({ orientation: 'horizontal', position: 90 });
  });

  test('ignore a flip or a move aimed at an id that is not a guide', () => {
    operations.value = [text('t1')];
    flipGuide('t1', 10);
    updateGuide('t1', 10);
    expect(operations.value).toEqual([text('t1')]);
  });

  test('are removed individually and all at once, leaving other ops untouched', () => {
    const a = addGuide('vertical', 100);
    addGuide('horizontal', 200);
    pushOp(text('t1'));

    removeGuide(a.id);
    expect(guides.value).toHaveLength(1);

    clearGuides();
    expect(guides.value).toEqual([]);
    expect(operations.value.map((o) => o.id)).toEqual(['t1']);
  });
});

describe('toolForKeyEvent', () => {
  const key = (code: string, over: Partial<KeyboardEvent> = {}) =>
    ({ code, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...over }) as KeyboardEvent;

  test('maps the Figma letters, so the muscle memory transfers', () => {
    expect(toolForKeyEvent(key('KeyV'))).toBe('navigate');
    expect(toolForKeyEvent(key('KeyR'))).toBe('rectangle');
    expect(toolForKeyEvent(key('KeyO'))).toBe('circle');
    expect(toolForKeyEvent(key('KeyT'))).toBe('text');
    expect(toolForKeyEvent(key('KeyC'))).toBe('comment');
    expect(toolForKeyEvent(key('KeyP'))).toBe('pen');
    expect(toolForKeyEvent(key('KeyL'))).toBe('line');
    expect(toolForKeyEvent(key('KeyE'))).toBe('eraser');
  });

  test('distinguishes a shifted binding from its bare one', () => {
    expect(toolForKeyEvent(key('KeyH', { shiftKey: true }))).toBe('highlight');
    // Bare H is the hand tool, bound elsewhere, so it must not resolve here.
    expect(toolForKeyEvent(key('KeyH'))).toBeNull();
    expect(toolForKeyEvent(key('KeyL', { shiftKey: true }))).toBe('arrow');
  });

  test('yields to any command, control or option chord', () => {
    for (const modifier of ['metaKey', 'ctrlKey', 'altKey'] as const) {
      expect(toolForKeyEvent(key('KeyR', { [modifier]: true }))).toBeNull();
    }
  });

  test('returns null for an unbound key', () => {
    expect(toolForKeyEvent(key('KeyQ'))).toBeNull();
    expect(toolForKeyEvent(key('Digit1'))).toBeNull();
  });
});

describe('SHORTCUTS', () => {
  test('shows the first binding per tool, as a readable label', () => {
    // `arrow` lists KeyA then Shift+KeyL; the toolbar shows the first.
    expect(SHORTCUTS.arrow).toBe('A');
    expect(SHORTCUTS.highlight).toBe('⇧H');
    expect(SHORTCUTS.rectangle).toBe('R');
  });
});

describe('moveTool', () => {
  test('reorders the toolbar', () => {
    const before = toolOrder.value;
    const first = before[0];
    moveTool(0, 2);
    expect(toolOrder.value[2]).toBe(first);
    expect(toolOrder.value).toHaveLength(before.length);
    toolOrder.value = before;
  });

  test('ignores an out-of-range or no-op move rather than corrupting the order', () => {
    const before = toolOrder.value;
    moveTool(0, 0);
    moveTool(-1, 2);
    moveTool(0, before.length);
    moveTool(before.length, 0);
    expect(toolOrder.value).toBe(before);
  });
});

describe('relabelOwnWork', () => {
  test('carries a rename onto your own annotations and anything assigned to you', () => {
    setUserName('Old Name');
    relabelOwnWork();
    operations.value = [
      comment({ id: 'mine', author: 'Old Name', authorId: localUser.id }),
      comment({ id: 'theirs', author: 'Someone Else', authorId: 'other' }),
      comment({ id: 'assigned', author: 'Someone Else', authorId: 'other', assignee: 'Old Name' }),
      text('t1'),
    ];

    setUserName('New Name');
    expect(relabelOwnWork()).toBe(2);
    expect(operations.value[0]).toMatchObject({ author: 'New Name' });
    // Someone else's unassigned thread is untouched by your rename.
    expect(operations.value[1]).toMatchObject({ author: 'Someone Else' });
    expect(operations.value[1]).not.toHaveProperty('assignee');
    expect(operations.value[2]).toMatchObject({ author: 'Someone Else', assignee: 'New Name' });
  });

  test('matches a legacy op with no authorId by the old name alone', () => {
    setUserName('Legacy Name');
    relabelOwnWork();
    operations.value = [comment({ id: 'old', author: 'Legacy Name' })];
    setUserName('Current Name');
    expect(relabelOwnWork()).toBe(1);
    expect(operations.value[0]).toMatchObject({ author: 'Current Name' });
  });

  test('reports zero and leaves the array identity alone when nothing carries the old name', () => {
    // Signals compare by identity, so writing a fresh array would re-partition
    // the op index and re-render every layer for a rename that touched nothing.
    setUserName('Nobody Wrote This');
    relabelOwnWork();
    operations.value = [comment({ id: 'theirs', author: 'Someone Else', authorId: 'other' })];
    const before = operations.value;

    setUserName('Another Name');
    expect(relabelOwnWork()).toBe(0);
    expect(operations.value).toBe(before);
  });

  test('is safe to call with no rename pending', () => {
    expect(relabelOwnWork()).toBe(0);
  });
});

/**
 * Run `body` with the confirm dialog answered, since happy-dom has none.
 * Returns whether it was actually asked.
 */
function withConfirm(answer: boolean, body: () => void): boolean {
  const original = window.confirm;
  let asked = false;
  const set = (value: typeof window.confirm) =>
    Object.defineProperty(window, 'confirm', { value, configurable: true, writable: true });
  set(() => {
    asked = true;
    return answer;
  });
  try {
    body();
  } finally {
    set(original);
  }
  return asked;
}

describe('colorName', () => {
  test('names a palette colour, case-insensitively', () => {
    expect(colorName('#f43f5e')).toBe('Red');
    expect(colorName('#F43F5E')).toBe('Red');
  });

  test('falls back to the hex for a colour no longer in the palette', () => {
    // A value restored from storage still has to label itself as something.
    expect(colorName('#123456')).toBe('#123456');
  });
});

describe('cursorColorName', () => {
  test('names a cursor colour and falls back to the hex', () => {
    expect(cursorColorName('#EC4899')).toBe('Pink');
    expect(cursorColorName('#abcdef')).toBe('#ABCDEF');
  });
});

describe('isOutputDetail', () => {
  test('accepts the four tiers and nothing else', () => {
    for (const tier of ['compact', 'standard', 'detailed', 'forensic']) {
      expect(isOutputDetail(tier)).toBe(true);
    }
    for (const bad of ['verbose', '', null, undefined, 1, {}, ['standard']]) {
      expect(isOutputDetail(bad)).toBe(false);
    }
  });
});

describe('tool predicates', () => {
  test('every tool but the move tool counts as drawing', () => {
    expect(isDrawingTool('navigate')).toBe(false);
    for (const tool of TOOLS.filter((t) => t !== 'navigate')) expect(isDrawingTool(tool)).toBe(true);
  });

  test('only the freehand and shape tools paint onto the canvas', () => {
    for (const tool of ['pen', 'highlight', 'eraser', 'line', 'arrow', 'rectangle', 'circle'] as const) {
      expect(toolPaintsCanvas(tool)).toBe(true);
    }
    for (const tool of ['navigate', 'comment', 'text', 'selection', 'area', 'inspect', 'measure', 'guide'] as const) {
      expect(toolPaintsCanvas(tool)).toBe(false);
    }
  });

  test('a text selection means "annotate this passage" only under the selection tools', () => {
    expect(toolCapturesSelection('selection')).toBe(true);
    expect(toolCapturesSelection('rectangle')).toBe(false);
  });

  test('selection capture also needs the markers to be visible', () => {
    // With markers off there is nothing to show for a captured passage.
    activeTool.value = 'selection';
    if (!markersVisible.value) toggleMarkersVisible();
    expect(selectionCaptureArmed.value).toBe(true);

    toggleMarkersVisible();
    expect(selectionCaptureArmed.value).toBe(false);
    toggleMarkersVisible();
  });
});

describe('toolOrder', () => {
  test('holds every tool exactly once, so no button can go missing', () => {
    // The stored order is migrated on load: unknown entries dropped, tools added
    // in code appended. A tool that never reaches the toolbar is invisible.
    expect([...toolOrder.value].sort()).toEqual([...TOOLS].sort());
    expect(new Set(toolOrder.value).size).toBe(TOOLS.length);
  });

  test('drops the element tools when the host cannot support them', () => {
    expect(visibleTools.value).toBe(toolOrder.value);

    elementToolsUnavailable.value = true;
    expect(visibleTools.value).not.toContain('inspect');
    expect(visibleTools.value).not.toContain('multiInspect');
    expect(visibleTools.value).not.toContain('measure');
    // Everything else survives.
    expect(visibleTools.value).toContain('comment');
    elementToolsUnavailable.value = false;
  });
});

describe('selectTool', () => {
  test('arms the tool', () => {
    selectTool({ tool: 'rectangle', via: 'shortcut' });
    expect(activeTool.value).toBe('rectangle');
  });

  test('re-picking the active tool is a no-op write and leaves no via pending', () => {
    // A `via` left over would be spent on whatever automatic switch came next.
    const reported: Array<string | number | boolean | null | undefined> = [];
    setAnalytics({ sink: (_e, props) => reported.push(props?.via), surface: 'extension' });
    try {
      selectTool({ tool: 'circle', via: 'toolbar' });
      selectTool({ tool: 'circle', via: 'toolbar' });
      activeTool.value = 'navigate';
      expect(reported).toEqual(['toolbar', 'other']);
    } finally {
      setAnalytics({ sink: () => {}, surface: 'extension' });
    }
  });
});

describe('toggleUiHidden', () => {
  test('drops the dialogs and disarms the drawing tool on the way out', () => {
    // Drawing with no toolbar means no colour, no width and no visible tool.
    showSettings.value = true;
    showShareDialog.value = true;
    activeTool.value = 'rectangle';

    toggleUiHidden();
    expect(uiHidden.value).toBe(true);
    expect(showSettings.value).toBe(false);
    expect(showShareDialog.value).toBe(false);
    // `peek()`, not `.value`: the assignment above narrows `.value` to 'rectangle',
    // and the checker has no idea `toggleUiHidden` just changed it.
    expect(activeTool.peek()).toBe('navigate');

    toggleUiHidden();
    expect(uiHidden.value).toBe(false);
  });

  test('leaves the tool alone when bringing the interface back', () => {
    toggleUiHidden();
    activeTool.value = 'comment';
    toggleUiHidden();
    expect(activeTool.value).toBe('comment');
    activeTool.value = 'navigate';
  });
});

describe('annotationPanelOpen', () => {
  test('hiding the interface closes the panel without forgetting it was open', () => {
    showAnnotationPanel.value = true;
    expect(annotationPanelOpen.value).toBe(true);

    uiHidden.value = true;
    expect(annotationPanelOpen.value).toBe(false);
    // The remembered intent survives, so the panel returns with the UI.
    expect(showAnnotationPanel.value).toBe(true);

    uiHidden.value = false;
    expect(annotationPanelOpen.value).toBe(true);
    showAnnotationPanel.value = false;
  });

  test('closing the panel drops the focused annotation, so reopening is never stale', () => {
    showAnnotationPanel.value = true;
    focusedAnnotationId.value = 'c1';
    showAnnotationPanel.value = false;
    expect(focusedAnnotationId.value).toBeNull();
  });
});

describe('getCommentMeta', () => {
  test('records the page the annotation is about, not the page it was read on', () => {
    // The web viewer wraps a proxied page: without this the meta would say the
    // share URL for every comment.
    annotatedUrl.value = 'https://example.com/pricing';
    expect(getCommentMeta().url).toBe('https://example.com/pricing');

    annotatedUrl.value = null;
    expect(getCommentMeta().url).toBe(location.href);
  });

  test('carries the viewport and the detected environment', () => {
    const meta = getCommentMeta();
    expect(meta.viewport).toEqual({ width: window.innerWidth, height: window.innerHeight });
    expect(typeof meta.browser).toBe('string');
    expect(typeof meta.os).toBe('string');
  });
});

describe('inspector stack', () => {
  const item = (over: { markdown?: string; comment?: string } = {}) => ({
    selector: 'h1#hero',
    comment: '',
    markdown: `${ELEMENT_INSPECTOR_HEADING}\n\n**Selector:** \`h1#hero\`\n`,
    ...over,
  });

  beforeEach(() => {
    clearInspectorStack();
  });

  test('opens itself when the first element is stacked', () => {
    addToInspectorStack(item());
    expect(inspectorStack.value).toHaveLength(1);
    expect(inspectorStackOpen.value).toBe(true);
  });

  test('gives each entry its own id, so identical picks stay separable', () => {
    addToInspectorStack(item());
    addToInspectorStack(item());
    const [a, b] = inspectorStack.value;
    expect(a?.id).not.toBe(b?.id);
  });

  test('closes itself once the last entry is removed, but not before', () => {
    addToInspectorStack(item());
    addToInspectorStack(item());
    const first = inspectorStack.value[0];
    if (!first) throw new Error('nothing stacked');

    removeFromInspectorStack(first.id);
    expect(inspectorStackOpen.value).toBe(true);

    const last = inspectorStack.value[0];
    if (!last) throw new Error('nothing stacked');
    removeFromInspectorStack(last.id);
    expect(inspectorStackOpen.value).toBe(false);
  });

  test('ignores a removal for an id that is not stacked', () => {
    addToInspectorStack(item());
    removeFromInspectorStack('nope');
    expect(inspectorStack.value).toHaveLength(1);
  });
});

describe('buildInspectorStackPrompt', () => {
  const stacked = (entries: { markdown: string; comment?: string }[]) => {
    clearInspectorStack();
    for (const e of entries) addToInspectorStack({ selector: 'h1', comment: '', ...e });
  };

  test('counts the tasks, singular and plural', () => {
    stacked([{ markdown: 'A' }]);
    expect(buildInspectorStackPrompt()).toContain('# Element changes (1 task)');
    stacked([{ markdown: 'A' }, { markdown: 'B' }]);
    expect(buildInspectorStackPrompt()).toContain('# Element changes (2 tasks)');
  });

  test('titles a block with its instruction, or numbers it when there is none', () => {
    stacked([{ markdown: 'A', comment: 'make it bigger' }, { markdown: 'B' }]);
    const prompt = buildInspectorStackPrompt();
    expect(prompt).toContain('## Task 1: make it bigger');
    expect(prompt).toContain('## Element 2');
  });

  test('strips the per-element inspector heading, keeping one document heading', () => {
    // Each entry arrives with its own "## Element Inspector"; repeating it inside
    // a bundled prompt reads as a wall of identical headings to the agent.
    stacked([
      { markdown: `${ELEMENT_INSPECTOR_HEADING}\n\n**Selector:** \`h1\`\n` },
      { markdown: `${ELEMENT_INSPECTOR_HEADING}\n\n**Selector:** \`h2\`\n` },
    ]);
    const prompt = buildInspectorStackPrompt();
    expect(prompt).not.toContain(ELEMENT_INSPECTOR_HEADING);
    expect(prompt).toContain('**Selector:** `h1`');
    expect(prompt).toContain('**Selector:** `h2`');
  });

  test('keeps markdown that does not lead with the heading intact', () => {
    stacked([{ markdown: '**Selector:** `h1`' }]);
    expect(buildInspectorStackPrompt()).toContain('**Selector:** `h1`');
  });

  test('separates the blocks with a rule', () => {
    stacked([{ markdown: 'A' }, { markdown: 'B' }]);
    expect(buildInspectorStackPrompt()).toContain('\n\n---\n\n');
  });

  test('produces a valid prompt for an empty stack rather than throwing', () => {
    clearInspectorStack();
    expect(buildInspectorStackPrompt()).toBe('# Element changes (0 tasks)\n\n\n');
  });
});

describe('panBy', () => {
  test('scrolls the host window when no other scroller is registered', () => {
    panScrollBy.value = null;
    window.scrollTo(0, 0);
    panBy(0, 120);
    expect(window.scrollY).toBe(120);
    window.scrollTo(0, 0);
  });

  test('hands the delta to the registered scroller instead - the proxied iframe', () => {
    const moves: Array<[number, number]> = [];
    panScrollBy.value = (dx, dy) => moves.push([dx, dy]);
    try {
      panBy(10, -20);
      expect(moves).toEqual([[10, -20]]);
      expect(window.scrollY).toBe(0);
    } finally {
      panScrollBy.value = null;
    }
  });
});

describe('panActive', () => {
  test('is on while the hand tool is toggled or space is held', () => {
    expect(panActive.value).toBe(false);
    handTool.value = true;
    expect(panActive.value).toBe(true);
    handTool.value = false;

    spaceHeld.value = true;
    expect(panActive.value).toBe(true);
    spaceHeld.value = false;
    expect(panActive.value).toBe(false);
  });
});

describe('measureActive', () => {
  test('is on under the measure tool, or with Alt held from any tool', () => {
    // Figma shows measurements on Alt-hover whatever tool is armed.
    activeTool.value = 'measure';
    expect(measureActive.value).toBe(true);

    activeTool.value = 'rectangle';
    expect(measureActive.value).toBe(false);
    altHeld.value = true;
    expect(measureActive.value).toBe(true);
    altHeld.value = false;
  });
});

describe('context menu', () => {
  test('opens at the pointer with its items, and closes to nothing', () => {
    const items = [{ label: 'Delete', onClick: () => {} }];
    openContextMenu(new MouseEvent('contextmenu', { clientX: 40, clientY: 90 }), items);
    expect(contextMenu.value).toMatchObject({ x: 40, y: 90, items });

    closeContextMenu();
    expect(contextMenu.value).toBeNull();
  });
});

describe('signedBy', () => {
  test('returns both halves, so a rename can still follow the work', () => {
    // A tool that sets `author` but forgets `authorId` still type-checks.
    expect(signedBy()).toEqual({ author: localUser.name, authorId: localUser.id });
  });
});

describe('theme', () => {
  test('cycles and persists', () => {
    const start = theme.value;
    cycleTheme();
    expect(theme.value).not.toBe(start);
    // Cycling all the way round returns to where it started.
    const seen = new Set([start, theme.value]);
    for (let i = 0; i < 6 && theme.value !== start; i++) {
      cycleTheme();
      seen.add(theme.value);
    }
    expect(theme.value).toBe(start);
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('setColor and setOutputDetail', () => {
  test('persist the choice', () => {
    setColor('#22c55e');
    expect(color.value).toBe('#22c55e');
    expect(localStorage.getItem('ml-color')).toBe('#22c55e');

    setOutputDetail('forensic');
    expect(outputDetail.value).toBe('forensic');
    setOutputDetail('standard');
  });
});

describe('peerCount', () => {
  test('counts the connected peers plus you', () => {
    // The label reads "3 here", and you are one of them.
    peers.value = new Map();
    expect(peerCount.value).toBe(1);

    peers.value = new Map([
      ['a', { id: 'a', name: 'Ada', color: '#000', cursor: null, lastSeen: 0 }],
      ['b', { id: 'b', name: 'Bo', color: '#000', cursor: null, lastSeen: 0 }],
    ]);
    expect(peerCount.value).toBe(3);
    peers.value = new Map();
  });
});

describe('setUserColor', () => {
  test('persists the choice and announces it once', () => {
    const announced: Array<[string, string]> = [];
    // The local colour starts as a random palette pick, so establish a known one
    // before testing that re-picking it is a no-op.
    setUserColor('#3b82f6');
    onProfileChange.value = (name, colour) => announced.push([name, colour]);
    try {
      setUserColor('#06b6d4');
      expect(localUser.color).toBe('#06b6d4');
      expect(localStorage.getItem('ml-usercolor')).toBe('#06b6d4');

      // Re-picking the same colour is not a change.
      setUserColor('#06b6d4');
      expect(announced.filter(([, c]) => c === '#06b6d4')).toHaveLength(1);
    } finally {
      onProfileChange.value = null;
    }
  });
});

describe('deprecated status aliases', () => {
  test('are the same function, so the two surfaces cannot drift apart', () => {
    // They exist only so old call sites keep compiling; a divergence here would
    // be a silent behaviour split between comments and selections.
    expect(setCommentStatus).toBe(setOpStatus);
    expect(setSelectionStatus).toBe(setOpStatus);
  });
});

describe('undoRedoFlash', () => {
  test('is bumped by an undo and by a redo, to trigger the canvas flash', () => {
    operations.value = [text('t1')];
    const start = undoRedoFlash.value;
    undo();
    expect(undoRedoFlash.value).toBe(start + 1);
    redo();
    expect(undoRedoFlash.value).toBe(start + 2);
  });

  test('is not bumped when there was nothing to undo', () => {
    operations.value = [];
    undoStack.value = [];
    const start = undoRedoFlash.value;
    undo();
    redo();
    expect(undoRedoFlash.value).toBe(start);
  });
});

describe('copyInspectorStack', () => {
  const stubClipboard = (writeText: () => Promise<void>) =>
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

  const tick = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    clearInspectorStack();
    toasts.value = [];
  });

  test('says so rather than copying an empty prompt', async () => {
    stubClipboard(() => Promise.reject(new Error('should not be called')));
    copyInspectorStack();
    await tick();
    expect(toasts.value[0]).toMatchObject({ message: 'Stack is empty', type: 'info' });
  });

  test('copies the bundled prompt and counts the tasks in the confirmation', async () => {
    let copied = '';
    stubClipboard(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: (t: string) => {
          copied = t;
          return Promise.resolve();
        },
      },
      configurable: true,
    });

    addToInspectorStack({ selector: 'h1', comment: '', markdown: 'A' });
    addToInspectorStack({ selector: 'h2', comment: '', markdown: 'B' });
    copyInspectorStack();
    await tick();

    expect(copied).toBe(buildInspectorStackPrompt());
    expect(toasts.value.at(-1)).toMatchObject({ message: 'Copied 2 tasks for AI!' });
  });

  test('keeps the stack unless the auto-clear setting is on', async () => {
    stubClipboard(() => Promise.resolve());
    addToInspectorStack({ selector: 'h1', comment: '', markdown: 'A' });

    copyInspectorStack();
    await tick();
    expect(inspectorStack.value).toHaveLength(1);

    toggleClearOnCopy();
    try {
      copyInspectorStack();
      await tick();
      expect(inspectorStack.value).toEqual([]);
    } finally {
      toggleClearOnCopy();
    }
  });
});

describe('ensureScrollTickListener and ensureHostMutationObserver', () => {
  test('are idempotent, so repeated mounts do not stack listeners', () => {
    // Each extra installation is another observer running on every DOM change.
    expect(() => {
      ensureScrollTickListener();
      ensureScrollTickListener();
      ensureHostMutationObserver();
      ensureHostMutationObserver();
    }).not.toThrow();
  });

  test('coalesces a burst of scroll events into one tick per frame', async () => {
    // Anchored annotations re-resolve their selectors on every tick, so a tick
    // per scroll event would re-query the document dozens of times a second.
    ensureScrollTickListener();
    const start = scrollTick.value;
    for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('scroll'));
    expect(scrollTick.value).toBe(start);

    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(scrollTick.value).toBe(start + 1);
  });

  test('a resize ticks too, since it moves anchored annotations just as much', async () => {
    ensureScrollTickListener();
    const start = scrollTick.value;
    window.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(scrollTick.value).toBe(start + 1);
  });
});
