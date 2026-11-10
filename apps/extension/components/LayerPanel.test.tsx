import { afterEach, expect, test } from 'bun:test';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { enterLayers, activeLayer, updateLayers, visibleLayerIds } from '../lib/layers';
import { operations } from '../lib/ops';
import { canEditFromRoom, wsSend } from '../lib/realtime';
import { LayerPanel } from './LayerPanel';

const root = document.createElement('div');
document.body.appendChild(root);
afterEach(() => { render(null, root); operations.value = []; wsSend.value = null; canEditFromRoom.value = undefined; });

test('layer panel can select layers and requests creation without mutating shared state', async () => {
  localStorage.clear();
  enterLayers('panel-room', [{ id: 'default', name: '默认图层', created_at: 0 }, { id: 'review', name: '审查', created_at: 1 }]);
  const sent: unknown[] = [];
  wsSend.value = (message) => sent.push(message);
  await act(() => { render(<LayerPanel onClose={() => {}} />, root); });
  const review = [...root.querySelectorAll('button')].find((button) => button.textContent === '审查');
  expect(review).toBeDefined();
  await act(() => { review?.click(); });
  expect(activeLayer.value).toBe('review');
  expect(visibleLayerIds.value).toContain('review');
  const input = root.querySelector<HTMLInputElement>('input[aria-label="新图层名称"]');
  expect(input).not.toBeNull();
  await act(() => { if (input) { input.value = '教学'; input.dispatchEvent(new Event('input', { bubbles: true })); } });
  await act(() => { [...root.querySelectorAll('button')].find((button) => button.textContent === '新建')?.click(); });
  expect(sent).toEqual([expect.objectContaining({ type: 'layer_create', name: '教学' })]);
  const created = sent[0] as { id: string };
  await act(() => { updateLayers([{ id: 'default', name: '默认图层', created_at: 0 }, { id: 'review', name: '审查', created_at: 1 }, { id: created.id, name: '教学', created_at: 2 }]); });
  expect(activeLayer.value).toBe(created.id);
});
