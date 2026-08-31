import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { bridgePayload, detectFrameworkComponent } from './fiber-bridge';

/**
 * In production the payload is serialised into the page's MAIN world and talks to
 * the content script over a pair of CustomEvents. Here both ends share one world,
 * which is exactly what makes the round trip testable end to end.
 */
beforeAll(() => {
  bridgePayload();
});

interface Fiber {
  type: unknown;
  return: Fiber | null;
  _debugSource?: { fileName: string; lineNumber: number; columnNumber?: number };
}

/** A fiber chain, innermost first, hung off a real element the way React does. */
const withFiber = (chain: Fiber[]): Element => {
  document.body.innerHTML = '<div id="host"></div>';
  const el = document.querySelector('#host');
  if (!el) throw new Error('fixture missing #host');
  for (let i = 0; i < chain.length - 1; i++) {
    const node = chain[i];
    const parent = chain[i + 1];
    if (node && parent) node.return = parent;
  }
  Object.defineProperty(el, '__reactFiber$abc123', { value: chain[0], configurable: true });
  return el;
};

const named = (name: string, over: Partial<Fiber> = {}): Fiber => ({
  type: Object.defineProperty(() => null, 'name', { value: name }),
  return: null,
  ...over,
});

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('bridgePayload installation', () => {
  test('installs only once, so a re-injection does not double-answer', () => {
    // Two listeners would each dispatch a result and the second would win,
    // which is fine, but the guard is what keeps that from compounding.
    expect(window.__ml_bridge_installed).toBe(true);
    bridgePayload();
    expect(window.__ml_bridge_installed).toBe(true);
  });
});

describe('detectFrameworkComponent — React', () => {
  test('reads the component chain from innermost outward', () => {
    const el = withFiber([named('PriceRow'), named('PricingTable'), named('PricingPage')]);
    expect(detectFrameworkComponent(el)).toMatchObject({
      framework: 'React',
      chain: ['PriceRow', 'PricingTable', 'PricingPage'],
    });
  });

  test('prefers displayName over the function name', () => {
    const type = Object.defineProperty(() => null, 'name', { value: 'Inner' });
    Object.assign(type, { displayName: 'Button' });
    expect(detectFrameworkComponent(withFiber([{ type, return: null }]))?.chain).toEqual(['Button']);
  });

  test('unwraps a nested displayName down to the component it wraps', () => {
    // `withRouter(connect(ProductCard))` is the name a stack of HOCs produces.
    const type = () => null;
    Object.assign(type, { displayName: 'withRouter(connect(ProductCard))' });
    expect(detectFrameworkComponent(withFiber([{ type, return: null }]))?.chain).toEqual(['ProductCard']);
  });

  test('skips host elements and lowercase names', () => {
    // `fiber.type` is the string 'div' for a host node; there is no component there.
    const el = withFiber([{ type: 'div', return: null }, named('Card')]);
    expect(detectFrameworkComponent(el)?.chain).toEqual(['Card']);
  });

  test('skips the library wrappers nobody wants to see in an inspector', () => {
    const el = withFiber([named('AnimatePresence'), named('Suspense'), named('Provider'), named('Checkout')]);
    expect(detectFrameworkComponent(el)?.chain).toEqual(['Checkout']);
  });

  test('skips the numbered HOC family that HMR re-emits on every reload', () => {
    // WithComponentProps2, WithComponentProps3, … would otherwise churn the
    // chain between reloads for the same element.
    const el = withFiber([named('WithComponentProps3'), named('ConnectFoo12'), named('RealComponent')]);
    expect(detectFrameworkComponent(el)?.chain).toEqual(['RealComponent']);
  });

  test('keeps a genuine component name that happens to end in a digit', () => {
    // The filter only applies to the HOC prefixes, not to any trailing number.
    expect(detectFrameworkComponent(withFiber([named('Heading2')]))?.chain).toEqual(['Heading2']);
  });

  test('collapses a repeated name rather than printing it twice in a row', () => {
    const el = withFiber([named('Row'), named('Row'), named('Table')]);
    expect(detectFrameworkComponent(el)?.chain).toEqual(['Row', 'Table']);
  });

  test('caps the chain so a deep tree does not fill the inspector', () => {
    const el = withFiber(Array.from({ length: 9 }, (_, i) => named(`Level${i}`)));
    expect(detectFrameworkComponent(el)?.chain).toHaveLength(5);
  });

  test('stops walking after ten fibers, so a huge tree cannot stall a hover', () => {
    // The name cap is 5 and the walk cap is 10; a chain of host nodes deeper
    // than 10 must not reach the component sitting above them.
    const hosts: Fiber[] = Array.from({ length: 12 }, () => ({ type: 'div', return: null }));
    const el = withFiber([...hosts, named('TooFarUp')]);
    expect(detectFrameworkComponent(el)).toBeNull();
  });

  test('reports the first source outside node_modules', () => {
    const el = withFiber([
      named('Button', { _debugSource: { fileName: '/app/node_modules/ui/Button.tsx', lineNumber: 3 } }),
      named('Checkout', { _debugSource: { fileName: '/app/src/Checkout.tsx', lineNumber: 42, columnNumber: 7 } }),
    ]);
    expect(detectFrameworkComponent(el)?.source).toEqual({
      fileName: '/app/src/Checkout.tsx',
      lineNumber: 42,
      columnNumber: 7,
    });
  });

  test('falls back to a node_modules source when that is all there is', () => {
    const el = withFiber([
      named('Button', { _debugSource: { fileName: '/app/node_modules/ui/Button.tsx', lineNumber: 3 } }),
    ]);
    expect(detectFrameworkComponent(el)?.source).toMatchObject({ fileName: '/app/node_modules/ui/Button.tsx' });
  });

  test('ignores a debug source with no usable file or line', () => {
    // Reporting `undefined:undefined` to an agent is worse than reporting nothing.
    const chain = named('Card');
    Object.assign(chain, { _debugSource: { fileName: 42, lineNumber: 'nope' } });
    const detected = detectFrameworkComponent(withFiber([chain]));
    expect(detected?.chain).toEqual(['Card']);
    expect(detected?.source).toBeUndefined();
  });

  test('reports React even when only a source survives, with an empty chain', () => {
    const el = withFiber([{ type: 'div', return: null, _debugSource: { fileName: '/app/src/a.tsx', lineNumber: 1 } }]);
    expect(detectFrameworkComponent(el)).toMatchObject({ framework: 'React', chain: [] });
  });
});

describe('detectFrameworkComponent — Vue', () => {
  const withVue = (names: (string | undefined)[], key: 'name' | '__name' = 'name'): Element => {
    document.body.innerHTML = '<div id="host"></div>';
    const el = document.querySelector('#host');
    if (!el) throw new Error('fixture missing #host');
    let parent: unknown = null;
    for (const name of [...names].reverse()) {
      parent = { type: name === undefined ? {} : { [key]: name }, parent };
    }
    Object.defineProperty(el, '__vueParentComponent', { value: parent, configurable: true });
    return el;
  };

  test('reads the component chain off the Vue instance', () => {
    expect(detectFrameworkComponent(withVue(['PriceRow', 'PricingTable']))).toEqual({
      framework: 'Vue',
      chain: ['PriceRow', 'PricingTable'],
    });
  });

  test('accepts the compiler-generated __name when there is no explicit name', () => {
    expect(detectFrameworkComponent(withVue(['ProductCard'], '__name'))?.chain).toEqual(['ProductCard']);
  });

  test('returns null when no component in the chain is nameable', () => {
    expect(detectFrameworkComponent(withVue([undefined, undefined]))).toBeNull();
  });
});

describe('detectFrameworkComponent — no framework', () => {
  test('returns null for a plain element', () => {
    document.body.innerHTML = '<div id="plain"></div>';
    const el = document.querySelector('#plain');
    if (!el) throw new Error('fixture missing #plain');
    expect(detectFrameworkComponent(el)).toBeNull();
  });

  test('returns null for a react-shaped property that is not a fiber', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const el = document.querySelector('#host');
    if (!el) throw new Error('fixture missing #host');
    Object.defineProperty(el, '__reactProps$abc', { value: { onClick: () => {} }, configurable: true });
    expect(detectFrameworkComponent(el)).toBeNull();
  });
});
