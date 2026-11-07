import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { CommentOp } from '@marklayer/types/ops';
import { render } from 'preact';
import * as compat from 'preact/compat';
import * as jsxRuntime from 'preact/jsx-runtime';
import { configureHost } from '../lib/host-config';
import { operations } from '../lib/ops';

// Vite aliases React for the bundles; keyed by the path Base UI resolves, as in selected-panel.test.ts.
const baseUi = Bun.resolveSync('@base-ui/react', import.meta.dir);
const fromBaseUi = (id: string) => Bun.resolveSync(id, baseUi);
mock.module(fromBaseUi('react'), () => compat);
mock.module(fromBaseUi('react-dom'), () => compat);
mock.module(fromBaseUi('react/jsx-runtime'), () => jsxRuntime);

const { CommentPin } = await import('../components/CommentPin');

const op: CommentOp = {
  id: 'c1',
  tool: 'comment',
  x: 10,
  y: 10,
  text: 'Fix this',
  color: '#000000',
  lineWidth: 2,
  num: 1,
  ts: 1_700_000_000_000,
};

/** A thread an agent closed, waiting on a person's verdict. */
const agentFixed: CommentOp = { ...op, status: 'resolved' };
const agentReply: CommentOp = {
  ...op,
  id: 'c2',
  num: 2,
  text: 'Done',
  parentId: 'c1',
  author: 'claude',
  assignedAgent: 'claude',
};

function pinMarkup(triage: boolean, shown: CommentOp = op) {
  configureHost({ capabilities: { triage } });
  const root = document.createElement('div');
  document.body.append(root);
  render(<CommentPin op={shown} />, root);
  const { innerHTML } = root;
  render(null, root);
  root.remove();
  return innerHTML;
}

describe('a pin on a page where the visitor does not triage', () => {
  afterEach(() => {
    configureHost({ capabilities: { triage: true } });
    operations.value = [];
  });

  test('offers no Delete, where the owner gets one', () => {
    expect(pinMarkup(true)).toContain('Delete');
    expect(pinMarkup(false)).not.toContain('Delete');
  });

  test('offers no verdict on an agent fix: "Looks good" would approve the thread', () => {
    operations.value = [agentFixed, agentReply];
    expect(pinMarkup(true, agentFixed)).toContain('Not fixed');
    expect(pinMarkup(false, agentFixed)).not.toContain('Not fixed');
  });
});
