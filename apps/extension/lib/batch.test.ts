import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { AreaOp, CommentOp, DrawOp } from '@marklayer/types';

// No IndexedDB in the test DOM; pushOp schedules a draft save through idb-keyval.
mock.module('idb-keyval', () => ({
  createStore: () => ({}),
  get: async () => undefined,
  set: async () => {},
  del: async () => {},
}));

const { activeTool, operations, onOpPushed, patchOp, pushOp, sendHeld, undo } = await import('./state');
const {
  clearArmed,
  pressClear,
  BATCH_KEY,
  batchAvailable,
  batchMode,
  clearHeld,
  editHeld,
  heldNote,
  heldOps,
  removeHeld,
  toggleBatchMode,
} = await import('./batch');

const comment = (id: string, extra: Partial<CommentOp> = {}): CommentOp => ({
  id,
  tool: 'comment',
  num: 1,
  text: `note ${id}`,
  x: 10,
  y: 20,
  color: '#000',
  lineWidth: 2,
  ts: 1,
  ...extra,
});

const area = (id: string): AreaOp => ({
  id,
  tool: 'area',
  startX: 0,
  startY: 0,
  endX: 40,
  endY: 40,
  color: '#000',
  lineWidth: 2,
  ts: 1,
  comment: `area ${id}`,
});

// Upload ids are 21-char nanoids; the patch is schema-checked.
const U1 = 'u'.repeat(21);
const U2 = 'v'.repeat(21);

let sent: DrawOp[] = [];

beforeEach(() => {
  operations.value = [];
  batchAvailable.value = true;
  clearHeld();
  if (!batchMode.value) toggleBatchMode();
  sent = [];
  onOpPushed.value = (op) => sent.push(op);
});

describe('batch edits', () => {
  test('Clear All needs a second press: the first only arms, the second discards', () => {
    pushOp(comment('a'));
    pressClear();
    expect(clearArmed.value).toBe(true);
    expect(heldOps.value.length).toBe(1);
    pressClear();
    expect(clearArmed.value).toBe(false);
    expect(heldOps.value).toEqual([]);
  });

  test('a shot that lands after the note was held goes onto the held copy; once sent, onto the live op', () => {
    pushOp(area('a'));
    patchOp({ opId: 'a', patch: { attachments: [U1] } });
    const held = heldOps.value[0];
    expect(held?.tool === 'area' && held.attachments).toEqual([U1]);
    sendHeld();
    patchOp({ opId: 'a', patch: { attachments: [U2] } });
    expect(heldOps.value).toEqual([]);
    const live = operations.value[0];
    expect(live?.tool === 'area' && live.attachments).toEqual([U2]);
  });

  test('with batch on, a note is held: not in the document, not sent to the room', () => {
    pushOp(comment('a'));
    expect(heldOps.value.map((o) => o.id)).toEqual(['a']);
    expect(operations.value).toEqual([]);
    expect(sent).toEqual([]);
  });

  test('with batch off, a note goes straight out', () => {
    toggleBatchMode();
    pushOp(comment('a'));
    expect(heldOps.value).toEqual([]);
    expect(sent.map((o) => o.id)).toEqual(['a']);
  });

  test('the web viewer, which has no Send control, never holds', () => {
    batchAvailable.value = false;
    pushOp(comment('a'));
    expect(heldOps.value).toEqual([]);
    expect(sent.map((o) => o.id)).toEqual(['a']);
  });

  test('replies and drawings are never held', () => {
    pushOp(comment('r', { parentId: 'p' }));
    pushOp({ id: 'g', tool: 'guide', color: '#000', lineWidth: 1, orientation: 'vertical', position: 4 });
    expect(heldOps.value).toEqual([]);
    expect(sent.map((o) => o.id)).toEqual(['r', 'g']);
  });

  test('send releases every held note once, in creation order, numbering comments as they land', () => {
    activeTool.value = 'comment';
    pushOp(comment('a'));
    pushOp(area('b'));
    pushOp(comment('c'));
    sendHeld();
    expect(sent.map((o) => o.id)).toEqual(['a', 'b', 'c']);
    expect(operations.value.flatMap((o) => (o.tool === 'comment' ? [o.num] : []))).toEqual([1, 2]);
    expect(heldOps.value).toEqual([]);
    expect(String(activeTool.value)).toBe('navigate');
    sendHeld();
    expect(sent).toHaveLength(3);
  });

  test('clear drops the batch without sending anything', () => {
    pushOp(comment('a'));
    pushOp(area('b'));
    clearHeld();
    sendHeld();
    expect(sent).toEqual([]);
    expect(operations.value).toEqual([]);
  });

  test('undo takes back the newest held note before touching the document', () => {
    toggleBatchMode();
    pushOp(comment('live'));
    toggleBatchMode();
    pushOp(comment('a'));
    pushOp(comment('b'));
    undo();
    expect(heldOps.value.map((o) => o.id)).toEqual(['a']);
    expect(operations.value.map((o) => o.id)).toEqual(['live']);
  });

  test('undo takes back a stroke drawn after a held note, not the note', () => {
    pushOp(comment('a'));
    pushOp({
      id: 's',
      tool: 'pen',
      color: '#000',
      lineWidth: 1,
      points: [{ x: 0, y: 0 }],
      compositeOperation: 'source-over',
    });
    undo();
    expect(operations.value).toEqual([]);
    expect(heldOps.value.map((o) => o.id)).toEqual(['a']);
    undo();
    expect(heldOps.value).toEqual([]);
  });

  test('pushOp says whether the note was held or sent', () => {
    expect(pushOp(comment('a'))).toBe('held');
    toggleBatchMode();
    expect(pushOp(comment('b'))).toBe('sent');
  });

  test('a held note can be edited or removed from the pending list', () => {
    pushOp(comment('a'));
    pushOp(area('b'));
    editHeld({ id: 'a', note: 'edited' });
    editHeld({ id: 'b', note: 'edited too' });
    removeHeld('a');
    expect(heldOps.value.map(heldNote)).toEqual(['edited too']);
  });

  test('the switch persists only its non-default value', () => {
    expect(localStorage.getItem(BATCH_KEY)).toBe('1');
    toggleBatchMode();
    expect(batchMode.value).toBe(false);
    expect(localStorage.getItem(BATCH_KEY)).toBeNull();
  });
});
