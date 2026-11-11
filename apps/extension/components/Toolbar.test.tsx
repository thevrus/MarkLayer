import { afterEach, beforeEach, expect, test } from 'bun:test';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { toolbarMinimized } from '../lib/prefs';
import { canEditFromRoom, connected, execMode, wsSend } from '../lib/realtime';
import { presentation, showTeachingComposer } from '../lib/teaching';
import { Toolbar } from './Toolbar';

let root: HTMLDivElement;
const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
const initial = {
  connected: connected.peek(), canEdit: canEditFromRoom.peek(), mode: execMode.peek(),
  send: wsSend.peek(), minimized: toolbarMinimized.peek(),
  presentation: presentation.peek(), composer: showTeachingComposer.peek(),
};

beforeEach(() => {
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true, value: () => ({ cancel() {}, finished: Promise.resolve() }),
  });
  root = document.createElement('div');
  document.body.append(root);
  connected.value = false;
  canEditFromRoom.value = true;
  execMode.value = 'pair';
  toolbarMinimized.value = false;
  presentation.value = null;
  showTeachingComposer.value = false;
});

afterEach(() => {
  act(() => render(null, root));
  root.remove();
  connected.value = initial.connected;
  canEditFromRoom.value = initial.canEdit;
  execMode.value = initial.mode;
  wsSend.value = initial.send;
  toolbarMinimized.value = initial.minimized;
  presentation.value = initial.presentation;
  showTeachingComposer.value = initial.composer;
  if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate);
  else Reflect.deleteProperty(Element.prototype, 'animate');
});

test('room controls stay visible and inert offline, retain online actions and the readonly mode gate', async () => {
  const sent: unknown[] = [];
  wsSend.value = (message) => { sent.push(message); };
  await act(() => render(<Toolbar />, root));
  const button = (text: string) => {
    const element = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === text);
    if (!element) throw new Error(`Missing room control: ${text}`);
    return element;
  };
  const mode = () => root.querySelector<HTMLSelectElement>('select[aria-label="执行模式"]')!;
  const assertOffline = () => {
    for (const control of [button('图层'), button('演示'), mode()]) {
      expect(control).not.toBeNull();
      expect(control.disabled).toBe(true);
      expect(control.title).toContain('未连接房间');
    }
  };
  assertOffline();
  await act(() => {
    button('图层').click();
    button('演示').click();
    mode().value = 'solo';
    mode().dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(root.querySelector('[aria-label="图层管理"]')).toBeNull();
  expect(showTeachingComposer.peek()).toBe(false);
  expect(sent).toEqual([]);

  await act(() => { connected.value = true; });
  for (const control of [button('图层'), button('演示'), mode()]) expect(control.disabled).toBe(false);
  await act(() => { button('图层').click(); });
  expect(root.querySelector('[aria-label="图层管理"]')).not.toBeNull();
  await act(() => { button('图层').click(); });
  expect(root.querySelector('[aria-label="图层管理"]')).toBeNull();
  await act(() => { button('演示').click(); });
  expect(showTeachingComposer.peek()).toBe(true);
  await act(() => {
    showTeachingComposer.value = false;
    mode().value = 'guide';
    mode().dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(sent).toEqual([{ type: 'set_exec_mode', execMode: 'guide' }]);
  expect(execMode.peek()).toBe('pair');
  await act(() => { canEditFromRoom.value = false; });
  expect(mode().disabled).toBe(true);
  expect(button('图层').disabled).toBe(false);
  expect(button('演示').disabled).toBe(false);

  await act(() => { connected.value = false; });
  assertOffline();
});
