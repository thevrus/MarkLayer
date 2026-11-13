import { DEFAULT_LAYER_ID, type DrawOp } from '@marklayer/types/ops';
import type { RoomLayer } from '@marklayer/types/wire';
import { computed, signal } from '@preact/signals';

const fallback: RoomLayer = { id: DEFAULT_LAYER_ID, name: '默认图层', created_at: 0 };
export const roomLayers = signal<RoomLayer[]>([fallback]);
export const activeLayer = signal(DEFAULT_LAYER_ID);
export const visibleLayerIds = signal<string[]>([DEFAULT_LAYER_ID]);
let currentRoom: string | null = null;
let known = new Set<string>();

function save() {
  if (!currentRoom) return;
  try {
    localStorage.setItem(
      `marklayer:layers:${currentRoom}`,
      JSON.stringify({ active: activeLayer.peek(), visible: visibleLayerIds.peek(), known: [...known] }),
    );
  } catch {
    /* 浏览器可能禁用存储 */
  }
}

export function enterLayers(roomId: string, layers: RoomLayer[]): void {
  currentRoom = roomId;
  const available = layers.length ? layers : [fallback];
  let saved: { active?: unknown; visible?: unknown; known?: unknown } = {};
  try {
    saved = JSON.parse(localStorage.getItem(`marklayer:layers:${roomId}`) ?? '{}');
  } catch {
    /* 使用默认图层 */
  }
  const ids = new Set(available.map((l) => l.id));
  const visible = Array.isArray(saved.visible)
    ? saved.visible.filter((id): id is string => typeof id === 'string' && ids.has(id))
    : [DEFAULT_LAYER_ID];
  const active = typeof saved.active === 'string' && ids.has(saved.active) ? saved.active : DEFAULT_LAYER_ID;
  roomLayers.value = available;
  activeLayer.value = active;
  visibleLayerIds.value = [...new Set([...visible, active])];
  known = new Set(
    Array.isArray(saved.known)
      ? saved.known.filter((id): id is string => typeof id === 'string')
      : available.map((l) => l.id),
  );
  save();
}

/** 同步元数据时，新图层默认隐藏；返回本次新增的图层数。 */
export function updateLayers(layers: RoomLayer[]): number {
  const added = layers.filter((l) => !known.has(l.id)).length;
  const ids = new Set(layers.map((l) => l.id));
  roomLayers.value = layers.length ? layers : [fallback];
  if (!ids.has(activeLayer.peek())) activeLayer.value = DEFAULT_LAYER_ID;
  visibleLayerIds.value = visibleLayerIds.peek().filter((id) => ids.has(id));
  if (!visibleLayerIds.peek().includes(activeLayer.peek()))
    visibleLayerIds.value = [...visibleLayerIds.peek(), activeLayer.peek()];
  known = new Set(layers.map((l) => l.id));
  save();
  return added;
}

export function selectLayer(id: string): void {
  if (!roomLayers.peek().some((l) => l.id === id)) return;
  activeLayer.value = id;
  if (!visibleLayerIds.peek().includes(id)) visibleLayerIds.value = [...visibleLayerIds.peek(), id];
  save();
}
export function setLayerVisible(id: string, visible: boolean): void {
  if (!roomLayers.peek().some((l) => l.id === id) || (!visible && id === activeLayer.peek())) return;
  visibleLayerIds.value = visible
    ? [...new Set([...visibleLayerIds.peek(), id])]
    : visibleLayerIds.peek().filter((v) => v !== id);
  save();
}
export const inVisibleLayer = (op: DrawOp): boolean => visibleLayerIds.value.includes(op.layerId ?? DEFAULT_LAYER_ID);
export const layerChoices = computed(() =>
  roomLayers.value.map((layer) => ({ ...layer, visible: visibleLayerIds.value.includes(layer.id) })),
);
