import type { CommentStatus } from '@marklayer/types';
import { STATUS_COLORS } from '../lib/state';

/**
 * The status hue, at the one size every list in the app draws it.
 *
 * Its own component rather than a span each list writes out, because the three
 * places that draw it — the panel row, the board column head, the detail badge —
 * are the three places that quietly disagreed about the size last time.
 * `undefined` is a held slot, so a row with no status still aligns with one.
 */
export function StatusDot({ status }: { status?: CommentStatus }) {
  return (
    <span
      class="w-1.5 h-1.5 rounded-full shrink-0"
      style={{ background: status ? STATUS_COLORS[status] : 'transparent' }}
      aria-hidden="true"
    />
  );
}
