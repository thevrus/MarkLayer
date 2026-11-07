import { expect, test } from 'bun:test';
import { TEXT_STEPS } from '../src/type-scale.generated';
import { render, typeScale } from './type-scale';

// A step added to a stylesheet and not to `cn` is a size `cn` silently drops beside a text colour.
test('the generated type scale matches the stylesheets', () => {
  expect(render([...TEXT_STEPS])).toBe(render(typeScale()));
});

test('reads the shared tokens and a site-only step', () => {
  expect(typeScale()).toEqual(expect.arrayContaining(['meta', 'ui-lg', 'hero', 'site-ui']));
});
