import { afterEach, expect, test } from 'bun:test';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { applyAnchorDelta } from '../lib/anchor';
import { ensureScrollTickListener, hostMutationTick } from '../lib/host-mutations';
import { operations } from '../lib/ops';
import { activeTool } from '../lib/tool-state';
import { CommentLayer } from './CommentLayer';

let root: HTMLDivElement;
let target: HTMLDivElement;
const originalPick = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint');
const width = window.innerWidth;
const originalDpr = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
const originalTool = activeTool.peek();

afterEach(() => {
  act(() => render(null, root));
  root.remove();
  target.remove();
  operations.value = [];
  activeTool.value = originalTool;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  if (originalDpr) Object.defineProperty(window, 'devicePixelRatio', originalDpr);
  else Reflect.deleteProperty(window, 'devicePixelRatio');
  if (originalPick) Object.defineProperty(document, 'elementsFromPoint', originalPick);
  else Reflect.deleteProperty(document, 'elementsFromPoint');
});

test.each([1, 1.25, 1.5])('缩放重排后草稿跟随目标，发布仍使用点击时的几何快照 (zoom=%s)', async (zoom) => {
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
  window.scrollTo(0, 0);
  operations.value = [];
  ensureScrollTickListener();
  target = document.createElement('div');
  target.id = 'zoom-comment-target';
  document.body.append(target);
  let rect = new DOMRect(100, 100, 200, 100);
  target.getBoundingClientRect = () => rect;
  Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [target] });
  root = document.createElement('div');
  document.body.append(root);
  act(() => {
    activeTool.value = 'comment';
    render(<CommentLayer />, root);
  });
  act(() => {
    root.firstElementChild!.dispatchEvent(new MouseEvent('click', { clientX: 140, clientY: 120, bubbles: true }));
  });
  const panel = () => root.querySelector<HTMLElement>('[aria-label="New comment"]')!;
  expect(panel().style.left).toBe('156px');
  const capturedWidth = window.innerWidth;
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: zoom });
  rect = new DOMRect(200, 150, 100, 50);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: capturedWidth - 100 });
  await act(async () => {
    window.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  expect(panel().style.left).toBe('236px');
  expect(panel().style.top).toBe('176px');
  // 没有 resize 的 DOM/CSS 重排也须更新草稿。
  rect = new DOMRect(250, 200, 100, 50);
  act(() => {
    hostMutationTick.value++;
  });
  expect(panel().style.left).toBe('286px');
  const textarea = panel().querySelector('textarea')!;
  act(() => {
    textarea.value = '缩放回归';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    Array.from(panel().querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Post'))!
      .click();
  });
  const op = operations.peek().find((op) => op.tool === 'comment');
  expect(op?.tool).toBe('comment');
  if (op?.tool !== 'comment') throw new Error('评论未发布');
  expect(op.target?.rect).toEqual({ x: 100, y: 100, width: 200, height: 100 });
  expect(op.target?.offsetX).toBe(40);
  expect(op.target?.offsetY).toBe(20);
  expect(op.captureViewport?.width).toBe(capturedWidth);
  expect({ x: op.x, y: op.y }).toEqual({ x: 140, y: 120 });
  expect(applyAnchorDelta(op.target, { docX: op.x, docY: op.y })).toMatchObject({ x: 270, y: 210 });
});
