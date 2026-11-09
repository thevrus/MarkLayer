import { expect, test } from 'bun:test';
import { applyTeachingMessage, hidePresentation, presentation } from './teaching';

test('teaching messages are transient and closing is local until ended', () => {
  presentation.value = null;
  applyTeachingMessage({ type: 'teach_state', presentationId: 'p', peerId: 'presenter', state: 'active' });
  applyTeachingMessage({ type: 'teach_highlight', presentationId: 'p', peerId: 'presenter', selector: '#save' });
  applyTeachingMessage({ type: 'teach_caption', presentationId: 'p', peerId: 'presenter', text: '说明', step: 0 });
  expect(presentation.value).toMatchObject({ id: 'p', caption: '说明', highlight: { selector: '#save' }, hidden: false });
  hidePresentation();
  applyTeachingMessage({ type: 'teach_state', presentationId: 'p', peerId: 'presenter', state: 'paused' });
  expect(presentation.value).toMatchObject({ hidden: true, state: 'paused' });
  applyTeachingMessage({ type: 'teach_state', presentationId: 'other', peerId: 'presenter', state: 'ended' });
  expect(presentation.peek()?.id).toBe('p');
  applyTeachingMessage({ type: 'teach_state', presentationId: 'p', peerId: 'presenter', state: 'ended' });
  expect(presentation.value).toBeNull();
});
