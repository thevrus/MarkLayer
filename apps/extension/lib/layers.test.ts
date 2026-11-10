import { expect, test } from 'bun:test';
import { activeLayer, enterLayers, roomLayers, selectLayer, setLayerVisible, updateLayers, visibleLayerIds } from './layers';

const initial = [{ id: 'default', name: '默认图层', created_at: 0 }, { id: 'review', name: '审查', created_at: 1 }];
test('each room remembers personal selection and newly received layers are hidden', () => {
  localStorage.clear();
  enterLayers('room-a', initial);
  expect(visibleLayerIds.value).toEqual(['default']);
  selectLayer('review');
  expect(visibleLayerIds.value).toEqual(['default', 'review']);
  setLayerVisible('default', false);
  setLayerVisible('review', false);
  expect(visibleLayerIds.value).toEqual(['review']);
  expect(updateLayers([...initial, { id: 'teaching', name: '讲解', created_at: 2 }])).toBe(1);
  expect(visibleLayerIds.value).toEqual(['review']);
  enterLayers('room-b', initial);
  expect(activeLayer.value).toBe('default');
  enterLayers('room-a', [...initial, { id: 'teaching', name: '讲解', created_at: 2 }]);
  expect(activeLayer.value).toBe('review');
  expect(visibleLayerIds.value).toEqual(['review']);
  updateLayers([initial[0]!]);
  expect(activeLayer.value).toBe('default');
  expect(roomLayers.value).toHaveLength(1);
});
