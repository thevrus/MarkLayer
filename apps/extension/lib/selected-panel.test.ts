import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { inspectOpSchema } from '@marklayer/types';
import { h, render } from 'preact';
import * as compat from 'preact/compat';
import * as jsxRuntime from 'preact/jsx-runtime';

// Vite aliases React to preact/compat for the bundles; bun test has no such alias, and Base UI imports React.
// The modules under test are imported after, so nothing resolves the real one first.
// Keyed by the path Base UI resolves, since that is a different `react` from the one this file would.
const baseUi = Bun.resolveSync('@base-ui/react', import.meta.dir);
const fromBaseUi = (id: string) => Bun.resolveSync(id, baseUi);
mock.module(fromBaseUi('react'), () => compat);
mock.module(fromBaseUi('react-dom'), () => compat);
mock.module(fromBaseUi('react/jsx-runtime'), () => jsxRuntime);
const { SelectedPanel } = await import('../components/InspectorLayer');
const { getSelector, snapshotElement } = await import('./selector');
const { connectionStatus, inspectorStack, operations } = await import('./state');

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
