import { beforeEach, describe, expect, test } from 'bun:test';
import {
  captureTarget,
  ELEMENT_INSPECTOR_HEADING,
  FINGERPRINT_LEN,
  formatForAI,
  getBoxModel,
  getKeyStyles,
  getParentLayout,
  getSelector,
  isExtensionElement,
  normalizeText,
  parseInspectorComment,
  pickElementAtPoint,
  shortClassLabel,
  snapshotElement,
  textFingerprint,
  truncateOuterHTML,
} from './selector';

const mount = (html: string) => {
  document.body.innerHTML = html;
};

const pick = (selector: string): Element => {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`fixture missing ${selector}`);
  return el;
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('normalizeText', () => {
  test('collapses every run of whitespace, including newlines and tabs, to one space', () => {
    expect(normalizeText('  Hello \n\t  world  ')).toBe('Hello world');
    expect(normalizeText('\n\n')).toBe('');
  });
});

describe('textFingerprint', () => {
  test('normalises the element text and caps it at the fingerprint length', () => {
    mount(`<p id="t">${'ab '.repeat(80)}</p>`);
    const fp = textFingerprint(pick('#t'));
    expect(fp).toHaveLength(FINGERPRINT_LEN);
  });

  test('returns undefined for an element with no readable text', () => {
    // A whitespace-only node must not produce an empty-string fingerprint, which
    // would then match every other blank element during fallback resolution.
    mount('<p id="empty"></p><p id="blank">   \n  </p>');
    expect(textFingerprint(pick('#empty'))).toBeUndefined();
    expect(textFingerprint(pick('#blank'))).toBeUndefined();
  });

  test('is stable across whitespace-only markup churn', () => {
    mount('<h1 id="a">Pricing   that   scales</h1>');
    const before = textFingerprint(pick('#a'));
    mount('<h1 id="a">\n  Pricing that scales\n</h1>');
    expect(textFingerprint(pick('#a'))).toBe(before);
  });
});

describe('getSelector', () => {
  test('prefers a test hook over everything else', () => {
    mount('<div id="real-id" class="card" data-testid="checkout">x</div>');
    expect(getSelector(pick('[data-testid]'))).toBe('[data-testid="checkout"]');
  });

  test('falls back to a unique id', () => {
    mount('<div id="hero" class="card">x</div>');
    expect(getSelector(pick('#hero'))).toBe('#hero');
  });

  test('refuses an id that is not a bare CSS identifier', () => {
    // A numeric-leading or space-bearing id produces a selector that either
    // fails to parse or silently matches nothing.
    mount('<main><div id="2col">a</div><div id="has space">b</div></main>');
    expect(getSelector(pick('[id="2col"]'))).not.toContain('#2col');
    expect(getSelector(pick('[id="has space"]'))).not.toContain('has space');
  });

  test('drops Tailwind utilities, which churn with every redesign', () => {
    mount('<main><div class="flex items-center gap-2 hover:bg-red-500 w-[42px] aspect-3/4">x</div></main>');
    const sel = getSelector(pick('div'));
    for (const utility of ['flex', 'items-center', 'gap-2', 'hover', 'w-[42px]', 'aspect-3/4']) {
      expect(sel).not.toContain(utility);
    }
  });

  test('keeps semantic classes, at most three of them', () => {
    mount('<main><div class="ProductCard featured is-active promo extra">x</div></main>');
    const sel = getSelector(pick('div'));
    expect(sel).toContain('.ProductCard.featured.is-active');
    expect(sel).not.toContain('promo');
  });

  test('uses role and aria-label when there are no stable classes', () => {
    mount('<main><div role="tab" aria-label="Billing" class="px-4">x</div></main>');
    expect(getSelector(pick('div'))).toContain('div[role="tab"][aria-label="Billing"]');
  });

  test('identifies a form field by name and type rather than position', () => {
    mount('<form><input name="email" type="email" class="w-full"><input name="pw" type="password"></form>');
    expect(getSelector(pick('[name="email"]'))).toContain('input[name="email"][type="email"]');
  });

  test('adds nth-of-type only when same-tag siblings would also match', () => {
    mount('<ul><li class="Row">a</li><li class="Row">b</li></ul>');
    const second = document.querySelectorAll('li')[1];
    if (!second) throw new Error('fixture missing second li');
    expect(getSelector(second)).toContain(':nth-of-type(2)');
    // A sibling already distinguished by its own class needs no index.
    mount('<ul><li class="Row">a</li><li class="Other">b</li></ul>');
    expect(getSelector(pick('.Other'))).not.toContain('nth-of-type');
  });

  test('produces a selector that resolves back to the element it described', () => {
    // The whole point of the walk up the tree: whatever comes out must be unique.
    mount(`
      <main class="Layout">
        <section class="Panel"><p>one</p><p>two</p></section>
        <section class="Panel"><p>three</p><p class="target">four</p></section>
      </main>`);
    const target = pick('.target');
    const sel = getSelector(target);
    expect(document.querySelectorAll(sel)).toHaveLength(1);
    expect(document.querySelector(sel)).toBe(target);
  });

  test('escapes a class name containing CSS-special characters', () => {
    mount('<main><div class="a.b">x</div></main>');
    const sel = getSelector(pick('div'));
    expect(sel).toContain('a\\.b');
    expect(document.querySelector(sel)).toBe(pick('div'));
  });

  test('memoises per element, so repeated anchoring does not re-walk the tree', () => {
    mount('<main><div class="Card">x</div></main>');
    const el = pick('div');
    const first = getSelector(el);
    // Rename the class: a fresh computation would change, a cached one will not.
    el.className = 'Renamed';
    expect(getSelector(el)).toBe(first);
  });
});

describe('isExtensionElement', () => {
  test('treats a missing element as ours, so nothing is attributed by accident', () => {
    expect(isExtensionElement(null)).toBe(true);
  });

  test('recognises the host tag, the inspect marker, and anything inside our root', () => {
    mount('<mark-layer><span id="inside">x</span></mark-layer><div id="marked" data-marklayer-inspect="1"></div>');
    expect(isExtensionElement(pick('mark-layer'))).toBe(true);
    expect(isExtensionElement(pick('#inside'))).toBe(true);
    expect(isExtensionElement(pick('#marked'))).toBe(true);
  });

  test('leaves ordinary page elements alone', () => {
    mount('<article><p id="p">x</p></article>');
    expect(isExtensionElement(pick('#p'))).toBe(false);
  });
});

describe('truncateOuterHTML', () => {
  test('collapses subtrees past the depth limit into a child count', () => {
    mount('<div id="root"><ul><li><b>a</b><b>b</b><b>c</b></li></ul></div>');
    const html = truncateOuterHTML(pick('#root'));
    expect(html).toContain('<!-- 3 children -->');
    expect(html).not.toContain('<b>');
  });

  test('leaves markup within the depth limit intact', () => {
    mount('<div id="root"><span>a</span></div>');
    expect(truncateOuterHTML(pick('#root'))).toBe('<div id="root"><span>a</span></div>');
  });

  test('does not mutate the live element it serialises', () => {
    mount('<div id="root"><ul><li><b>a</b><b>b</b></li></ul></div>');
    truncateOuterHTML(pick('#root'));
    expect(document.querySelectorAll('#root b')).toHaveLength(2);
  });

  test('truncates past the length cap with an ellipsis', () => {
    mount(`<div id="root">${'x'.repeat(2000)}</div>`);
    const html = truncateOuterHTML(pick('#root'), 2, 100);
    expect(html).toHaveLength(100);
    expect(html.endsWith('…')).toBe(true);
  });

  test('never leaves a lone surrogate half at the cut', () => {
    // Slicing mid-emoji yields an unpaired surrogate, which serialises as a
    // replacement char downstream.
    mount(`<div id="r">${'\u{1F600}'.repeat(60)}</div>`);
    for (let len = 40; len < 60; len++) {
      const html = truncateOuterHTML(pick('#r'), 2, len);
      expect(html).not.toMatch(/[\uD800-\uDBFF]…$/);
    }
  });
});

describe('shortClassLabel', () => {
  test('joins the first classes with a dot and honours the cap', () => {
    mount('<div class="one two three">x</div>');
    expect(shortClassLabel(pick('div'))).toBe('one.two');
    expect(shortClassLabel(pick('div'), 3)).toBe('one.two.three');
  });

  test('returns an empty string for an unclassed element', () => {
    mount('<div>x</div>');
    expect(shortClassLabel(pick('div'))).toBe('');
  });
});

describe('parseInspectorComment', () => {
  const body = [
    '## Element Inspector',
    '',
    '**Selector:** `h1#hero`',
    '**Size:** 576x189px',
    '',
    '**Markup:**',
    '```html',
    '<h1 id="hero">Hi</h1>',
    '```',
    '',
  ].join('\n');

  test('returns null for a plain human comment', () => {
    expect(parseInspectorComment('the spacing here looks off')).toBeNull();
  });

  test('splits the fields and the markup block out of an inspector body', () => {
    const parsed = parseInspectorComment(body);
    expect(parsed?.task).toBeNull();
    expect(parsed?.fields).toEqual([
      ['Selector', '`h1#hero`'],
      ['Size', '576x189px'],
    ]);
    expect(parsed?.markup).toBe('<h1 id="hero">Hi</h1>');
  });

  test('lifts a leading task block out as the human instruction', () => {
    const parsed = parseInspectorComment(`## Task\nmake this bigger\n\n${body}`);
    expect(parsed?.task).toBe('make this bigger');
    expect(parsed?.fields).toHaveLength(2);
  });

  test('does not mistake the Markup label itself for a field row', () => {
    // The label sits on its own line above the fence; parsing it as a field
    // would put a stray empty "Markup" row in the hover card.
    const parsed = parseInspectorComment(body);
    expect(parsed?.fields.map(([label]) => label)).not.toContain('Markup');
  });

  test('handles an inspector body with no markup block', () => {
    const parsed = parseInspectorComment('## Element Inspector\n\n**Selector:** `h1`\n');
    expect(parsed?.markup).toBeNull();
    expect(parsed?.fields).toEqual([['Selector', '`h1`']]);
  });
});

const layout = (el: Element, box: { x: number; y: number; width: number; height: number }) => {
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => new DOMRect(box.x, box.y, box.width, box.height),
    configurable: true,
  });
};

describe('pickElementAtPoint', () => {
  /** happy-dom has no hit-testing; the logic under test is the filtering. */
  const stack = (els: Element[]) =>
    Object.defineProperty(document, 'elementsFromPoint', { value: () => els, configurable: true });

  test('returns the topmost page element', () => {
    mount('<main><p id="p">x</p></main>');
    stack([pick('#p'), pick('main'), document.body, document.documentElement]);
    expect(pickElementAtPoint(5, 5)?.id).toBe('p');
  });

  test('skips our own injected UI to reach the page underneath', () => {
    mount('<mark-layer><button id="tool"></button></mark-layer><main><p id="p">x</p></main>');
    stack([pick('#tool'), pick('mark-layer'), pick('#p'), document.body]);
    expect(pickElementAtPoint(5, 5)?.id).toBe('p');
  });

  test('never anchors to body or the document root', () => {
    // Attributing a comment to <body> is never what the user meant.
    mount('<main></main>');
    stack([document.body, document.documentElement]);
    expect(pickElementAtPoint(5, 5)).toBeNull();
  });

  test('returns null for an empty hit stack', () => {
    stack([]);
    expect(pickElementAtPoint(5, 5)).toBeNull();
  });
});

describe('captureTarget', () => {
  test('records the element rect in document coordinates', () => {
    mount('<h1 id="hero">Pricing</h1>');
    const el = pick('#hero');
    layout(el, { x: 100, y: 50, width: 400, height: 80 });
    window.scrollTo(0, 500);

    const target = captureTarget({ el });
    expect(target.rect).toEqual({ x: 100, y: 550, width: 400, height: 80 });
    expect(target.selector).toBe('#hero');
    expect(target.tag).toBe('h1');
    window.scrollTo(0, 0);
  });

  test('stores the anchor as an offset from the element top-left, not as a page coordinate', () => {
    // This offset is the entire input to `resolveAnchorPoint`; an absolute
    // coordinate here would re-anchor every mark to the top of the page.
    mount('<h1 id="hero">Pricing</h1>');
    const el = pick('#hero');
    layout(el, { x: 100, y: 50, width: 400, height: 80 });

    const target = captureTarget({ el, anchor: { x: 140, y: 70 } });
    expect(target.offsetX).toBe(40);
    expect(target.offsetY).toBe(20);
  });

  test('leaves both offsets absent when there is no anchor point', () => {
    // `resolveAnchorPoint` treats a half-present offset as unusable, so they
    // have to travel together or not at all.
    mount('<h1 id="hero">Pricing</h1>');
    layout(pick('#hero'), { x: 0, y: 0, width: 10, height: 10 });
    const target = captureTarget({ el: pick('#hero') });
    expect(target.offsetX).toBeUndefined();
    expect(target.offsetY).toBeUndefined();
  });

  test('carries a text fingerprint for the fallback resolver', () => {
    mount('<h1 id="hero">Pricing that scales</h1>');
    layout(pick('#hero'), { x: 0, y: 0, width: 10, height: 10 });
    expect(captureTarget({ el: pick('#hero') }).text).toBe('Pricing that scales');
  });

  test('quotes the highlighted run, which an element snapshot alone cannot say', () => {
    mount('<p id="copy">Ship faster than ever before</p>');
    layout(pick('#copy'), { x: 0, y: 0, width: 10, height: 10 });
    const target = captureTarget({ el: pick('#copy'), selectedText: 'Ship\n  faster' });
    expect(target.markdown).toContain('**Selected text:** "Ship faster"');
  });
});

describe('formatForAI', () => {
  const opts = { component: null, cssStack: null, rect: { width: 576, height: 189 } } as const;

  const mountTree = () => {
    mount(`
      <main class="Layout">
        <section id="panel" style="display:flex;align-items:center;gap:12px">
          <h1 id="hero" class="Headline">Pricing that scales</h1>
        </section>
      </main>`);
    return pick('#hero');
  };

  test('opens with the marker the comment parser looks for', () => {
    const md = formatForAI(mountTree(), 'h1#hero', opts);
    expect(md.startsWith(ELEMENT_INSPECTOR_HEADING)).toBe(true);
  });

  test('compact gives only enough for an agent to grep and locate the element', () => {
    const md = formatForAI(mountTree(), 'h1#hero', { ...opts, detail: 'compact' });
    expect(md).toContain('**Selector:** `h1#hero`');
    expect(md).toContain('**Size:** 576×189px');
    expect(md).not.toContain('**Markup:**');
    expect(md).not.toContain('**Text:**');
  });

  test('standard adds the viewport, the text and the markup', () => {
    const md = formatForAI(mountTree(), 'h1#hero', { ...opts, detail: 'standard' });
    expect(md).toContain('**Text:** "Pricing that scales"');
    expect(md).toContain('**Markup:**');
    expect(md).toContain('**Viewport:**');
    expect(md).not.toContain('**Hierarchy:**');
    expect(md).not.toContain('**Computed Styles:**');
  });

  test('detailed adds the ancestry and the parent layout', () => {
    const md = formatForAI(mountTree(), 'h1#hero', { ...opts, detail: 'detailed' });
    // Walked up to (but not including) body, then reversed to read root-first.
    expect(md).toContain('**Hierarchy:** main.Layout > section#panel > h1#hero');
    expect(md).toContain('**Parent Layout:**');
    expect(md).toContain('display: flex;');
    expect(md).not.toContain('**Computed Styles:**');
  });

  test('forensic adds the computed styles', () => {
    const md = formatForAI(mountTree(), 'h1#hero', {
      ...opts,
      detail: 'forensic',
      styles: { color: 'rgb(0, 0, 0)' },
    });
    expect(md).toContain('**Computed Styles:**');
    expect(md).toContain('color: rgb(0, 0, 0);');
  });

  test('each tier is a strict superset of the one below it', () => {
    // The ladder is documented as a superset, so a field cannot go missing at a
    // higher verbosity - which is exactly the kind of regression nothing notices.
    const el = mountTree();
    const rendered = (['compact', 'standard', 'detailed', 'forensic'] as const).map((detail) =>
      formatForAI(el, 'h1#hero', { ...opts, detail, styles: { color: 'rgb(0, 0, 0)' } }),
    );
    for (let i = 1; i < rendered.length; i++) {
      const lower = rendered[i - 1];
      const higher = rendered[i];
      if (lower === undefined || higher === undefined) throw new Error('missing tier');
      for (const line of lower.split('\n').filter(Boolean)) {
        expect(higher).toContain(line);
      }
    }
  });

  test('defaults to standard', () => {
    const el = mountTree();
    expect(formatForAI(el, 'h1#hero', opts)).toBe(formatForAI(el, 'h1#hero', { ...opts, detail: 'standard' }));
  });

  test('omits the text row for an element with none, rather than printing empty quotes', () => {
    mount('<div id="box"></div>');
    const md = formatForAI(pick('#box'), 'div#box', opts);
    expect(md).not.toContain('**Text:**');
  });

  test('names the component and its source file when a framework is detected', () => {
    const md = formatForAI(mountTree(), 'h1#hero', {
      ...opts,
      component: {
        framework: 'React',
        chain: ['Headline', 'PricingPanel'],
        source: { fileName: 'src/Pricing.tsx', lineNumber: 42, columnNumber: 7 },
      },
    });
    expect(md).toContain('**React Component:** Headline ← PricingPanel');
    expect(md).toContain('**Source:** src/Pricing.tsx:42:7');
  });

  test('round-trips through the parser that renders it back as a hover card', () => {
    // `parseInspectorComment` reads exactly this output; testing the parser
    // against a hand-written string cannot catch the two drifting apart.
    const md = formatForAI(mountTree(), 'h1#hero', opts);
    const parsed = parseInspectorComment(md);
    expect(parsed?.markup).toContain('<h1 id="hero"');
    expect(parsed?.fields.map(([label]) => label)).toEqual(
      expect.arrayContaining(['Selector', 'Size', 'Viewport', 'Text']),
    );
    expect(parsed?.fields.map(([label]) => label)).not.toContain('Markup');
  });

  test('round-trips with a task prepended, the way a commented inspect op is stored', () => {
    const md = `## Task\nmake the heading bigger\n\n${formatForAI(mountTree(), 'h1#hero', opts)}`;
    expect(parseInspectorComment(md)?.task).toBe('make the heading bigger');
  });
});

describe('getParentLayout', () => {
  test('reports a flex parent and the properties that position the child', () => {
    mount(
      '<div id="p" style="display:flex;align-items:center;justify-content:space-between;gap:12px"><b id="c">x</b></div>',
    );
    expect(getParentLayout(pick('#c'))).toMatchObject({
      display: 'flex',
      'align-items': 'center',
      'justify-content': 'space-between',
      gap: '12px',
    });
  });

  test('reports a grid parent with its track definitions', () => {
    mount('<div id="p" style="display:grid;grid-template-columns:1fr 2fr"><b id="c">x</b></div>');
    const layout = getParentLayout(pick('#c'));
    expect(layout?.display).toBe('grid');
    expect(layout?.['grid-template-columns']).toBe('1fr 2fr');
    // Flex-only properties must not leak into a grid report.
    expect(layout).not.toHaveProperty('align-items');
  });

  test('returns null when the parent is ordinary block flow, so there is nothing to say', () => {
    mount('<div id="p"><b id="c">x</b></div>');
    expect(getParentLayout(pick('#c'))).toBeNull();
  });

  test('returns null for an element with no parent element', () => {
    expect(getParentLayout(document.documentElement)).toBeNull();
  });
});

describe('getBoxModel', () => {
  test('nests the four boxes inward from margin to content', () => {
    mount('<div id="b" style="margin:10px;border:2px solid;padding:5px">x</div>');
    const el = pick('#b');
    layout(el, { x: 100, y: 200, width: 300, height: 100 });

    const box = getBoxModel(el);
    // getBoundingClientRect is the border box; margin grows outward from it.
    expect(box.borderBox).toEqual({ x: 100, y: 200, w: 300, h: 100 });
    expect(box.marginBox).toEqual({ x: 90, y: 190, w: 320, h: 120 });
    expect(box.paddingBox).toEqual({ x: 102, y: 202, w: 296, h: 96 });
    expect(box.contentBox).toEqual({ x: 107, y: 207, w: 286, h: 86 });
  });

  test('collapses to the border box when the element has no box properties', () => {
    mount('<div id="b">x</div>');
    const el = pick('#b');
    layout(el, { x: 0, y: 0, width: 50, height: 20 });

    const box = getBoxModel(el);
    expect(box.marginBox).toEqual(box.borderBox);
    expect(box.paddingBox).toEqual(box.borderBox);
    expect(box.contentBox).toEqual(box.borderBox);
  });

  test('handles asymmetric box properties per side', () => {
    mount(
      '<div id="b" style="margin-left:20px;padding-top:8px;border-right-width:4px;border-right-style:solid">x</div>',
    );
    const el = pick('#b');
    layout(el, { x: 100, y: 100, width: 200, height: 60 });

    const box = getBoxModel(el);
    expect(box.marginBox).toMatchObject({ x: 80, w: 220 });
    expect(box.contentBox).toMatchObject({ y: 108, w: 196 });
  });
});

describe('getKeyStyles', () => {
  test('returns the picked properties with kebab-case keys', () => {
    mount('<p id="t" style="color:rgb(1,2,3);font-weight:700;border-radius:4px">x</p>');
    const styles = getKeyStyles(pick('#t'));
    expect(styles.color).toBe('rgb(1, 2, 3)');
    expect(styles['font-weight']).toBe('700');
    expect(styles['border-radius']).toBe('4px');
    // Camel case would not match what a CSS block wants.
    expect(styles).not.toHaveProperty('fontWeight');
  });

  test('drops values that say nothing', () => {
    // `none`, `auto`, `0px` and a transparent background are the defaults; listing
    // them buries the handful of properties that were actually set.
    mount('<div id="t" style="border-radius:0px;background-color:rgba(0,0,0,0)">x</div>');
    const styles = getKeyStyles(pick('#t'));
    expect(styles).not.toHaveProperty('border-radius');
    expect(styles).not.toHaveProperty('background-color');
  });

  test('drops position when it is static, which is the default', () => {
    mount('<div id="static">x</div><div id="fixed" style="position:fixed">y</div>');
    expect(getKeyStyles(pick('#static'))).not.toHaveProperty('position');
    expect(getKeyStyles(pick('#fixed')).position).toBe('fixed');
  });

  test('drops flex properties on an element that is not flex or grid', () => {
    // `align-items` on a block element explains nothing about its layout.
    mount('<div id="block" style="align-items:center;gap:8px">x</div>');
    const styles = getKeyStyles(pick('#block'));
    expect(styles).not.toHaveProperty('align-items');
    expect(styles).not.toHaveProperty('gap');
  });

  test('keeps flex properties once the element is a flex or grid container', () => {
    mount('<div id="flex" style="display:flex;align-items:center;gap:8px">x</div>');
    const styles = getKeyStyles(pick('#flex'));
    expect(styles['align-items']).toBe('center');
    expect(styles.gap).toBe('8px');
  });

  test('drops text properties on an element that renders no text of its own', () => {
    // An <img> inherits a font it will never use.
    mount('<img id="pic" style="color:rgb(1,2,3);font-size:20px;border-radius:6px" alt="">');
    const styles = getKeyStyles(pick('#pic'));
    expect(styles).not.toHaveProperty('color');
    expect(styles).not.toHaveProperty('font-size');
    expect(styles['border-radius']).toBe('6px');
  });
});

describe('snapshotElement', () => {
  test('bundles the identity, the geometry and the markdown the panel renders', () => {
    mount('<main><h1 id="hero" class="Headline big">Pricing that scales</h1></main>');
    const el = pick('#hero');
    const rect = new DOMRect(10, 20, 400, 80);

    const snap = snapshotElement(el, 'h1#hero', rect);
    expect(snap).toMatchObject({
      selector: 'h1#hero',
      tag: 'h1',
      id: 'hero',
      classes: 'Headline big',
      rect,
      text: 'Pricing that scales',
    });
    expect(snap.viewport).toEqual({
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio,
    });
  });

  test('passes the viewport rect through to the markdown rather than measuring again', () => {
    // The caller already has the rect; re-measuring would report a different
    // size from the one the overlay is drawn at.
    mount('<h1 id="hero">Pricing</h1>');
    const snap = snapshotElement(pick('#hero'), 'h1#hero', new DOMRect(0, 0, 640, 128));
    expect(snap.markdown).toContain('**Size:** 640×128px');
  });

  test('honours the requested detail tier', () => {
    mount('<h1 id="hero">Pricing</h1>');
    const el = pick('#hero');
    const rect = new DOMRect(0, 0, 100, 50);
    expect(snapshotElement(el, 'h1#hero', rect, 'compact').markdown).not.toContain('**Markup:**');
    expect(snapshotElement(el, 'h1#hero', rect, 'forensic').markdown).toContain('**Computed Styles:**');
  });

  test('reports no component for a plain element', () => {
    mount('<h1 id="hero">Pricing</h1>');
    expect(snapshotElement(pick('#hero'), 'h1#hero', new DOMRect()).component).toBeNull();
  });
});
