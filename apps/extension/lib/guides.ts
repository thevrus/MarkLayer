import { computed, signal } from '@preact/signals';
import { nanoid } from 'nanoid';
import { signedBy } from './identity';
import { applyChange, operations, pushOp, removeOp } from './ops';
import { color, lineWidth } from './prefs';
import type { GuideOp } from './types';

/**
 * Figma-style ruler guides — viewport-anchored horizontal/vertical lines. Stored
 * as ops in the main op stream so they persist across reloads (localStorage draft
 * in the extension, D1 + DO broadcast on the web). The `guides` signal is a
 * computed view over `operations` filtered to `tool: 'guide'`.
 */
export type Orientation = 'horizontal' | 'vertical';
export const guides = computed<GuideOp[]>(() => operations.value.filter((op): op is GuideOp => op.tool === 'guide'));
export const selectedGuideId = signal<string | null>(null);

export function addGuide(orientation: Orientation, position: number): GuideOp {
  const op: GuideOp = {
    id: nanoid(),
    tool: 'guide',
    color: color.value,
    lineWidth: lineWidth.value,
    orientation,
    position,
    ...signedBy(),
  };
  pushOp(op);
  return op;
}

function patchGuide(id: string, patch: Partial<Pick<GuideOp, 'orientation' | 'position'>>) {
  const op = guides.value.find((g) => g.id === id);
  if (!op) return;
  const moved =
    (patch.position !== undefined && patch.position !== op.position) ||
    (patch.orientation !== undefined && patch.orientation !== op.orientation);
  if (moved) applyChange({ type: 'update_op', opId: id, patch }, { origin: 'local' });
}

export function updateGuide(id: string, position: number) {
  patchGuide(id, { position });
}

// newPosition is required: the stored `position` swaps axes on flip, so without supplying the
// new (perpendicular) coord the flipped guide would jump to an arbitrary spot.
export function flipGuide(id: string, newPosition: number) {
  const g = guides.value.find((p) => p.id === id);
  if (!g) return;
  patchGuide(id, { orientation: g.orientation === 'vertical' ? 'horizontal' : 'vertical', position: newPosition });
}

export function removeGuide(id: string) {
  if (selectedGuideId.value === id) selectedGuideId.value = null;
  removeOp(id);
}

export function clearGuides() {
  selectedGuideId.value = null;
  for (const g of guides.value) removeOp(g.id);
}
