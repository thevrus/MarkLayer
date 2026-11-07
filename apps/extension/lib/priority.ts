import type { CommentPriority } from '@marklayer/types/ops';
import { CircleAlert, type LucideIcon, SignalHigh, SignalLow, SignalMedium } from 'lucide-preact';

interface PriorityMeta {
  label: string;
  /** oklch accent for the signal icon. It reinforces the level, never carries it. */
  color: string;
  Icon: LucideIcon;
}

/** Ordered low → urgent, the one source of truth for sorting. */
export const PRIORITY_LEVELS: CommentPriority[] = ['low', 'medium', 'high', 'urgent'];

export const PRIORITY_META: Record<CommentPriority, PriorityMeta> = {
  low: { label: 'Low', color: 'oklch(0.72 0.19 150)', Icon: SignalLow },
  medium: { label: 'Medium', color: 'oklch(0.80 0.15 85)', Icon: SignalMedium },
  high: { label: 'High', color: 'oklch(0.70 0.18 55)', Icon: SignalHigh },
  urgent: { label: 'Urgent', color: 'oklch(0.63 0.23 25)', Icon: CircleAlert },
};
