import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { inspectOpSchema } from '@marklayer/types/ops';
import { h, render } from 'preact';
import * as compat from 'preact/compat';
import * as jsxRuntime from 'preact/jsx-runtime';
import { act } from 'preact/test-utils';
import { activeTool } from './tool-state';

// Vite aliases React to preact/compat for the bundles; bun test has no such alias, and Base UI imports React.
// The modules under test are imported after, so nothing resolves the real one first.
// Keyed by the path Base UI resolves, since that is a different `react` from the one this file would.
const baseUi = Bun.resolveSync('@base-ui/react', import.meta.dir);
const fromBaseUi = (id: string) => Bun.resolveSync(id, baseUi);
mock.module(fromBaseUi('react'), () => compat);
mock.module(fromBaseUi('react-dom'), () => compat);
mock.module(fromBaseUi('react/jsx-runtime'), () => jsxRuntime);
const { InspectorLayer, SelectedPanel } = await import('../components/InspectorLayer');
const { getSelector, snapshotElement } = await import('./selector');
const { inspectorStack } = await import('./inspector-stack');
const { operations } = await import('./ops');
const { connectionStatus } = await import('./presence');

const host = document.createElement('div');
document.body.appendChild(host);
const tick = () => new Promise((r) => setTimeout(r, 0));

const initialStatus = connectionStatus.value;
let el: HTMLElement;
let closed = 0;

beforeEach(() => {
  el = document.createElement('button');
  el.id = 'cta';
  el.setAttribute('style', 'color: blue');
  el.textContent = 'Buy';
  document.body.appendChild(el);
  closed = 0;
  operations.value = [];
  inspectorStack.value = [];
  connectionStatus.value = 'connected';
});

afterEach(() => {
  render(null, host);
  el.remove();
  operations.value = [];
  inspectorStack.value = [];
  connectionStatus.value = initialStatus;
});

// The host unmounts the panel when it closes, which is what reverts the page.
const mount = () => {
  const state = snapshotElement(el, getSelector(el), el.getBoundingClientRect());
  render(
    h(SelectedPanel, {
      state,
      el,
      onClose: () => {
        closed++;
        render(null, host);
      },
    }),
    host,
  );
};

const button = (label: string) => {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(label));
  if (!found) throw new Error(`no ${label} button`);
  return found;
};

const field = (property: string) => {
  const input = host.querySelector(`input[aria-label="${property}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`no ${property} field`);
  return input;
};

async function editColor(value: string) {
  button('Edit CSS').click();
  await tick();
  const input = field('color');
  input.focus();
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.blur();
  await tick();
  return input;
}

test('closing the note without sending puts the inline style back', async () => {
  mount();
  await editColor('red');
  expect(el.style.getPropertyValue('color')).toBe('red');
  host
    .querySelector('textarea')
    ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  expect(closed).toBe(1);
  expect(el.getAttribute('style')).toBe('color: blue');
});

test('Send records the edits and element details on the op, then reverts the page', async () => {
  mount();
  await editColor('red');
  button('Send').click();
  const [op] = operations.value;
  const parsed = inspectOpSchema.parse(op);
  expect(parsed.styleEdits).toEqual([{ property: 'color', from: expect.any(String), to: 'red' }]);
  expect(parsed.details?.id).toBe('cta');
  expect(parsed.details?.visibleText).toBe('Buy');
  expect(el.getAttribute('style')).toBe('color: blue');
});

test('Esc in a CSS field reverts that field and leaves the note open', async () => {
  mount();
  const input = await editColor('red');
  input.focus();
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  await tick();
  expect(closed).toBe(0);
  expect(el.getAttribute('style')).toBe('color: blue');
});

test('Edit CSS is offered only while the note is about a single element', async () => {
  inspectorStack.value = [{ id: 's', selector: 'p', comment: '', markdown: '' }];
  mount();
  await tick();
  expect([...host.querySelectorAll('button')].some((b) => b.textContent?.includes('Edit CSS'))).toBe(false);
});

test('扩展检查面板只在点击入口时读取一批，复制失败重试同批；共享 Viewer 不出现入口', async () => {
  const originalTool = activeTool.peek();
  const write = spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  const overlay = document.createElement('mark-layer');
  host.replaceWith(overlay);
  overlay.append(host);
  el.getBoundingClientRect = () => new DOMRect(10, 10, 100, 30);
  const fixture = document.createElement('div');
  for (let i = 0; i < 25; i++) {
    const item = document.createElement('button');
    item.id = `viewport-ui-${i}`;
    item.textContent = `元素 ${i}`;
    item.getBoundingClientRect = () => new DOMRect(10, 50 + i, 100, 20);
    fixture.append(item);
  }
  document.body.append(fixture);
  try {
    mount();
    expect([...host.querySelectorAll('button')].some((b) => b.textContent?.includes('读取视口下一批'))).toBe(false);
    render(null, host);
    await act(async () => {
      activeTool.value = 'inspect';
      render(h(InspectorLayer, {}), host);
    });
    act(() => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await tick();
    expect(write).not.toHaveBeenCalled();
    write.mockRejectedValueOnce(new Error('clipboard denied'));
    await act(async () => {
      button('读取视口下一批').click();
    });
    const first = write.mock.calls[0]![0];
    expect(JSON.parse(first).items).toHaveLength(20);
    await act(async () => {
      button('读取视口下一批').click();
    });
    expect(write.mock.calls[1]![0]).toBe(first);
    await act(async () => {
      button('读取视口下一批').click();
    });
    const second = JSON.parse(write.mock.calls[2]![0]);
    expect(second.items).toHaveLength(6);
    expect(second.done).toBe(true);
    const firstSelectors = JSON.parse(first).items.map((item: { selector: string }) => item.selector);
    for (const item of second.items) expect(firstSelectors).not.toContain(item.selector);
  } finally {
    act(() => {
      render(null, host);
      activeTool.value = originalTool;
    });
    write.mockRestore();
    fixture.remove();
    overlay.replaceWith(host);
  }
});
