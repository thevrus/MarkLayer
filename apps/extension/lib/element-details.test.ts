import { beforeEach, describe, expect, test } from 'bun:test';
import { captureElementDetails, getCursorStyles, TEXT_MAX } from './element-details';

const mount = (html: string): Element => {
  document.body.innerHTML = html;
  const el = document.body.firstElementChild;
  if (!el) throw new Error('fixture empty');
  return el;
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('captureElementDetails', () => {
  test('captures id, classes and attributes, leaving id/class out of the attribute map', () => {
    const el = mount('<a id="cta" class="btn primary" href="/pricing" role="button" onclick="x()">Go</a>');
    const d = captureElementDetails({ el, component: null });
    expect(d.id).toBe('cta');
    expect(d.classes).toEqual(['btn', 'primary']);
    expect(d.attributes).toEqual({ role: 'button' });
  });

  test('never sends what a user typed into a field', () => {
    const el = mount('<input name="card" value="4242 4242" placeholder="Card">');
    expect(captureElementDetails({ el, component: null }).attributes).toEqual({
      name: 'card',
      placeholder: 'Card',
    });
  });

  test('ships only allowlisted attributes, never URLs or ids that can carry secrets', () => {
    const el = mount(
      '<a href="/x?token=abc" role="link" data-testid="buy" data-secret="s" data-user-id="42" data-email="a@b.c" aria-expanded="true">Go</a>',
    );
    expect(captureElementDetails({ el, component: null }).attributes).toEqual({
      role: 'link',
      'data-testid': 'buy',
      'aria-expanded': 'true',
    });
  });

  test('caps visible text at 200 chars and collapses whitespace', () => {
    const el = mount(`<p>${'word  \n'.repeat(100)}</p>`);
    const text = captureElementDetails({ el, component: null }).visibleText ?? '';
    expect(text.length).toBe(TEXT_MAX);
    expect(text).not.toMatch(/\s{2}/);
  });

  test('leaves out fields the element does not have', () => {
    const d = captureElementDetails({ el: mount('<div></div>'), component: null });
    expect(d.id).toBeUndefined();
    expect(d.classes).toBeUndefined();
    expect(d.attributes).toBeUndefined();
    expect(d.visibleText).toBeUndefined();
    expect(d.component).toBeUndefined();
  });

  test('passes the framework component through when one was detected', () => {
    const component = {
      framework: 'Svelte',
      chain: ['Card'],
      source: { fileName: 'Card.svelte', lineNumber: 4 },
    } as const;
    const d = captureElementDetails({
      el: mount('<div></div>'),
      component: { ...component, chain: [...component.chain] },
    });
    expect(d.component?.chain).toEqual(['Card']);
    expect(d.component?.source?.lineNumber).toBe(4);
  });
});

describe('getCursorStyles', () => {
  test('returns exactly the six styles, including a static position', () => {
    const el = mount('<div style="color: red; display: flex; font-size: 20px"></div>');
    const styles = getCursorStyles(el);
    expect(Object.keys(styles).sort()).toEqual(
      ['background-color', 'color', 'display', 'font-family', 'font-size', 'position'].sort(),
    );
    expect(styles.display).toBe('flex');
    expect(styles['font-size']).toBe('20px');
  });
});
