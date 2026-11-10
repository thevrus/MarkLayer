import { expect, test } from 'bun:test';
import { applyTeachingMessage, hidePresentation, lastTeachingControl, openTeaching, presentation } from './teaching';

test('teaching messages are transient and closing is local until ended', () => {
  presentation.value = null;
  applyTeachingMessage({ type: 'teach_state', presentationId: 'p', peerId: 'presenter', state: 'active' });
  applyTeachingMessage({ type: 'teach_highlight', presentationId: 'p', peerId: 'presenter', selector: '#save' });
  applyTeachingMessage({ type: 'teach_caption', presentationId: 'p', peerId: 'presenter', text: '说明', step: 0 });
  expect(presentation.value).toMatchObject({ id: 'p', caption: '说明', highlight: { selector: '#save' }, hidden: false });
  hidePresentation();
  applyTeachingMessage({ type: 'teach_state', presentationId: 'p', peerId: 'presenter', state: 'paused' });
  expect(presentation.value).toMatchObject({ hidden: true, state: 'paused' });
  openTeaching();
  expect(presentation.peek()?.hidden).toBe(false);
  applyTeachingMessage({ type: 'teach_control', presentationId: 'p', peerId: 'viewer', action: 'next' });
  expect(lastTeachingControl.value?.action).toBe('next');
  applyTeachingMessage({ type: 'teach_state', presentationId: 'other', peerId: 'presenter', state: 'ended' });
  expect(presentation.peek()?.id).toBe('p');
  applyTeachingMessage({ type: 'teach_state', presentationId: 'p', peerId: 'presenter', state: 'ended' });
  expect(presentation.value).toBeNull();
});

test('caption retains total and propagates a toolbar target', () => {
  presentation.value = null;
  applyTeachingMessage({ type: 'teach_state', presentationId: 'p2', peerId: 'agent', state: 'active', total: 4 });
  applyTeachingMessage({ type: 'teach_highlight', presentationId: 'p2', peerId: 'agent', toolbarTarget: 'selection' });
  applyTeachingMessage({ type: 'teach_caption', presentationId: 'p2', peerId: 'agent', text: '选择', step: 1 });
  expect(presentation.value).toMatchObject({ total: 4, step: 1, highlight: { toolbarTarget: 'selection' } });
});
