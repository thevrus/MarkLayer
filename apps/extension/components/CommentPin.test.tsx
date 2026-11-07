import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { CommentOp, CommentStatus } from '@marklayer/types/ops';
import { render } from 'preact';
import * as compat from 'preact/compat';
import * as jsxRuntime from 'preact/jsx-runtime';
import { contextMenu } from '../lib/context-menu';
import { operations } from '../lib/ops';
import { findPageScroller, trackPageScroller } from '../lib/scroller';
import { ELEMENT_INSPECTOR_HEADING } from '../lib/selector';

// Vite aliases React for the bundles; keyed by the path Base UI resolves, as in selected-panel.test.ts.
const baseUi = Bun.resolveSync('@base-ui/react', import.meta.dir);
const fromBaseUi = (id: string) => Bun.resolveSync(id, baseUi);
mock.module(fromBaseUi('react'), () => compat);
mock.module(fromBaseUi('react-dom'), () => compat);
mock.module(fromBaseUi('react/jsx-runtime'), () => jsxRuntime);

const { CommentPin } = await import('./CommentPin');

const comment = (status: CommentStatus): CommentOp => ({
  id: 'c1',
  tool: 'comment',
  x: 10,
  y: 10,
  text: 'Fix this',
  color: '#000000',
  lineWidth: 2,
  num: 1,
  ts: 1_700_000_000_000,
  status,
});

/** Render a pin, run `read` against it, unmount. */
function withPin<T>(op: CommentOp, read: (root: HTMLElement) => T): T {
  operations.value = [op];
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(<CommentPin op={op} />, root);
  const result = read(root);
  render(null, root);
  root.remove();
  return result;
}

const rightClick = (op: CommentOp) =>
  withPin(op, (root) => {
    const contextmenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    root.querySelector('[data-marker]')?.dispatchEvent(contextmenu);
    return contextMenu.value?.items ?? [];
  });

describe('the menu on a finished comment', () => {
  afterEach(() => {
    operations.value = [];
    contextMenu.value = null;
  });

  test.each(['resolved', 'approved', 'dismissed'] as const)('%s offers Reopen, never Resolve', (status) => {
    const labels = rightClick(comment(status)).map((i) => i.label);
    expect(labels).toContain('Reopen');
    expect(labels).not.toContain('Resolve');
  });

  test('Reopen takes an approved thread to open, not back to resolved', () => {
    rightClick(comment('approved'))
      .find((i) => i.label === 'Reopen')
      ?.onClick();
    const [op] = operations.value;
    expect(op?.tool === 'comment' && op.status).toBe('open');
  });
});

describe('a comment flushed from the inspector', () => {
  afterEach(() => {
    operations.value = [];
  });

  // The card both hosts mount. The worker's tests have no DOM to render it in.
  test('reads as the task and its fields, not as raw markdown', () => {
    const text = `## Task\n\nmake it bigger\n\n${ELEMENT_INSPECTOR_HEADING}\n\n**Selector:** \`h1.hero\`\n`;
    const shown = withPin({ ...comment('open'), text }, (root) => root.textContent ?? '');
    expect(shown).toContain('make it bigger');
    expect(shown).toContain('h1.hero');
    expect(shown).not.toContain('## Task');
    expect(shown).not.toContain('**Selector:**');
  });
});

describe('on an app-shell page, where one container scrolls and the document never does', () => {
  test('a pin follows the content past the first scroll, wherever the shell appears', () => {
    trackPageScroller();
    const shell = document.createElement('div');
    shell.style.overflowY = 'auto';
    Object.defineProperty(shell, 'clientHeight', { value: window.innerHeight });
    Object.defineProperty(shell, 'scrollHeight', { value: window.innerHeight * 4 });
    document.body.appendChild(shell);
    shell.scrollTop = 500;
    shell.dispatchEvent(new Event('scroll'));

    const top = withPin({ ...comment('open'), y: 600 }, (root) => {
      const pin = root.querySelector('[data-marker]');
      return pin instanceof HTMLElement ? pin.style.top : null;
    });

    shell.remove();
    findPageScroller(document);
    operations.value = [];
    expect(top).toBe('100px');
  });
});
