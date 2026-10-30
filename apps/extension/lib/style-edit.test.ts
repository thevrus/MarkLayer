import { describe, expect, test } from 'bun:test';
import { MAX_STYLE_EDITS, MAX_STYLE_VALUE } from '@marklayer/types';
import { createStyleSession, isColorValue, nudgeValue, toStyleEdits } from './style-edit';

const box = (style?: string) => {
  const el = document.createElement('div');
  if (style !== undefined) el.setAttribute('style', style);
  document.body.appendChild(el);
  return el;
};

describe('toStyleEdits', () => {
  test('drops an edit that changed nothing the page renders', () => {
    const edits = toStyleEdits([
      { property: 'color', from: 'rgb(0, 0, 0)', to: 'red', settled: 'rgb(255, 0, 0)' },
      // Typed back to where it started.
      { property: 'gap', from: '8px', to: ' 8px ', settled: '8px' },
      // A different spelling of the same value: the computed result is the judge.
      { property: 'opacity', from: '1', to: '1.0', settled: '1' },
    ]);
    expect(edits).toEqual([{ property: 'color', from: 'rgb(0, 0, 0)', to: 'red' }]);
  });

  test('clips to the schema caps, which would otherwise get the whole note rejected', () => {
    const long = 'x'.repeat(MAX_STYLE_VALUE + 50);
    const many = Array.from({ length: MAX_STYLE_EDITS + 5 }, (_, i) => ({
      property: `p${i}`,
      from: long,
      to: 'y',
      settled: 'y',
    }));
    const edits = toStyleEdits(many);
    expect(edits).toHaveLength(MAX_STYLE_EDITS);
    expect(edits[0]?.from).toHaveLength(MAX_STYLE_VALUE);
  });
});

describe('nudgeValue', () => {
  test('steps the single number and keeps its unit', () => {
    expect(nudgeValue({ value: '12px', delta: 1 })).toBe('13px');
    expect(nudgeValue({ value: '0.1em', delta: 0.2 })).toBe('0.3em');
    expect(nudgeValue({ value: '1', delta: -10 })).toBe('-9');
  });

  test('leaves alone what has no single number to move', () => {
    expect(nudgeValue({ value: 'auto', delta: 1 })).toBeNull();
    expect(nudgeValue({ value: '0px 8px', delta: 1 })).toBeNull();
    expect(nudgeValue({ value: 'rgb(0, 0, 0)', delta: 1 })).toBeNull();
  });
});

test('isColorValue takes one colour, not a shorthand holding one', () => {
  expect(isColorValue('rgb(1, 2, 3)')).toBe(true);
  expect(isColorValue('#fff')).toBe(true);
  expect(isColorValue('1px solid rgb(0, 0, 0)')).toBe(false);
});

describe('createStyleSession', () => {
  test('revertAll restores the style attribute exactly as the page wrote it', () => {
    const original = 'color:red;  MARGIN: 0 ;--x: a  b';
    const el = box(original);
    const session = createStyleSession(el);
    session.apply({ property: 'color', value: 'blue' });
    session.apply({ property: 'padding', value: '4px' });
    expect(el.getAttribute('style')).not.toBe(original);
    session.revertAll();
    expect(el.getAttribute('style')).toBe(original);
  });

  test('revertAll leaves no style attribute on an element that had none', () => {
    const el = box();
    const session = createStyleSession(el);
    session.apply({ property: 'color', value: 'blue' });
    session.revertAll();
    expect(el.hasAttribute('style')).toBe(false);
  });

  test('reverting every property one by one leaves no style attribute either', () => {
    const el = box();
    const session = createStyleSession(el);
    session.apply({ property: 'color', value: 'blue' });
    session.apply({ property: 'gap', value: '9px' });
    session.revert('color');
    session.revert('gap');
    expect(el.getAttribute('style')).toBeNull();
    expect(el.outerHTML).toBe(box().outerHTML);
  });

  test('a rejected value on an element with no style leaves no empty attribute behind', () => {
    const el = box();
    const session = createStyleSession(el);
    expect(session.apply({ property: 'color', value: 'not-a-colour' })).toBe(false);
    expect(el.getAttribute('style')).toBeNull();
  });

  test('reverting one property keeps the others and the original inline declaration', () => {
    const el = box('color: red !important; gap: 2px');
    const session = createStyleSession(el);
    session.apply({ property: 'color', value: 'blue' });
    session.apply({ property: 'gap', value: '9px' });
    session.revert('color');
    expect(el.style.getPropertyValue('color')).toBe('red');
    expect(el.style.getPropertyPriority('color')).toBe('important');
    expect(el.style.getPropertyValue('gap')).toBe('9px');
    expect(session.edits().map((e) => e.property)).toEqual(['gap']);
  });

  test('an invalid value is reported and does not leave the last preview standing', () => {
    const el = box('color: red');
    const session = createStyleSession(el);
    expect(session.apply({ property: 'color', value: 'blue' })).toBe(true);
    expect(session.apply({ property: 'color', value: 'not-a-colour' })).toBe(false);
    expect(el.style.getPropertyValue('color')).toBe('red');
  });

  test('edits() reports computed before and typed after', () => {
    const el = box('width: 10px');
    const session = createStyleSession(el);
    session.apply({ property: 'width', value: '20px' });
    expect(session.edits()).toEqual([{ property: 'width', from: '10px', to: '20px' }]);
  });
});
