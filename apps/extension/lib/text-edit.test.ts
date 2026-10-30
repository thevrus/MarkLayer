import { expect, test } from 'bun:test';
import { diffEdit, pickTextEdit, readText, restore, snapshot, startTextEdit, type TextEditResult } from './text-edit';

function mount(html: string) {
  document.body.innerHTML = html;
  const get = (id: string) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(id);
    return el;
  };
  return get;
}

const textOf = (el: Element) => {
  const n = el.firstChild;
  if (!(n instanceof Text)) throw new Error('no text');
  return n;
};

test('inline formatting edits as one block', () => {
  const get = mount('<main><p id="p">Hello <strong id="s">big</strong> world</p></main>');
  const plan = pickTextEdit({ el: get('s'), node: null });
  expect(plan).toEqual({ kind: 'block', root: get('p') });
});

test('a block with a widget child edits only the clicked text node', () => {
  const get = mount('<div id="d">Buy now <button id="b">Add</button><img alt="" src="x.png"></div>');
  const plan = pickTextEdit({ el: get('d'), node: null });
  expect(plan?.kind).toBe('node');
});

test('form controls and editable hosts are ignored', () => {
  const get = mount('<textarea id="t">hi</textarea><div id="e" contenteditable="true">hi</div>');
  expect(pickTextEdit({ el: get('t'), node: null })).toBeNull();
  expect(pickTextEdit({ el: get('e'), node: null })).toBeNull();
});

test('text-less elements are not editable', () => {
  const get = mount('<div id="d">   <span id="s"> </span></div>');
  expect(pickTextEdit({ el: get('d'), node: null })).toBeNull();
});

test('unchanged and whitespace-only edits produce no op', () => {
  expect(diffEdit({ original: 'Hello  world', edited: 'Hello world', preserveNewlines: false })).toBeNull();
  expect(diffEdit({ original: 'Hello world', edited: '  Hello\n world ', preserveNewlines: true })).toBeNull();
});

test('a real change carries the collapsed original and the replacement', () => {
  expect(diffEdit({ original: '  Hello\n   world ', edited: 'Hello there', preserveNewlines: false })).toEqual({
    text: 'Hello world',
    suggestion: 'Hello there',
  });
});

test('newlines are kept only where the element renders them', () => {
  expect(diffEdit({ original: 'a', edited: 'a\nb', preserveNewlines: true })?.suggestion).toBe('a\nb');
  expect(diffEdit({ original: 'a', edited: 'a\nb', preserveNewlines: false })?.suggestion).toBe('a b');
});

test('readText reads a <br> as a newline', () => {
  const get = mount('<p id="p">one<br>two <em>three</em></p>');
  expect(readText(get('p'))).toBe('one\ntwo three');
});

test('restore puts back text and removed inline nodes exactly', () => {
  const get = mount('<p id="p">Hello <strong id="s">big</strong> world</p>');
  const p = get('p');
  const before = p.innerHTML;
  const snap = snapshot(p);
  textOf(p).data = 'Changed ';
  get('s').remove();
  p.append('tail');
  restore(snap);
  expect(p.innerHTML).toBe(before);
});

function edit(html: string) {
  const get = mount(html);
  const rect = { x: 1, y: 1, width: 10, height: 10, top: 1, left: 1, right: 11, bottom: 11, toJSON: () => ({}) };
  // The test DOM has no layout, so give the measuring range a box.
  Range.prototype.getClientRects = () => Object.assign([rect], { item: () => rect });
  const results: (TextEditResult | null)[] = [];
  const el = get('p');
  const started = startTextEdit({ el, x: 0, y: 0, onDone: (r) => results.push(r) });
  expect(started).toBe(true);
  return { el, results };
}

const press = (target: Element, key: string) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }));

test('Escape on the edit host cancels and restores the page exactly', () => {
  const { el, results } = edit('<p id="p">Hello <strong>big</strong> world</p>');
  const before = el.innerHTML;
  el.textContent = 'Changed';
  press(el, 'Escape');
  expect(results).toEqual([null]);
  expect(el.innerHTML).toBe(before);
  expect(el.hasAttribute('contenteditable')).toBe(false);
});

test('Escape leaves no style attribute on a host that had none', () => {
  const { el } = edit('<p id="p">Hello</p>');
  press(el, 'Escape');
  expect(el.getAttribute('style')).toBeNull();
});

test('saving leaves a host with its own style attribute exactly as it was', () => {
  const { el } = edit('<p id="p" style="color: red">Hello</p>');
  el.textContent = 'Hi';
  press(el, 'Enter');
  expect(el.getAttribute('style')).toBe('color: red');
});

test('Enter on the edit host saves instead of inserting a newline', () => {
  const { el, results } = edit('<p id="p">Hello world</p>');
  el.textContent = 'Hello there';
  const notPrevented = press(el, 'Enter');
  expect(notPrevented).toBe(false);
  expect(results).toHaveLength(1);
  expect(results[0]?.suggestion).toBe('Hello there');
  expect(el.innerHTML).toBe('Hello world');
});
