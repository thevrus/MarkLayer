import { cn } from '@marklayer/types';

/** Up to two initials, the most a 24px circle can hold legibly. */
export function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2);
}

const SIZES = {
  sm: { box: 16, text: 9 },
  md: { box: 20, text: 10 },
  lg: { box: 24, text: 11 },
} as const;

/**
 * Presence avatar, Geist-style: a neutral circle with ink initials and a
 * hairline — except the hairline is the person's own colour, so identity is
 * carried by the ring rather than by a saturated disc. `stacked` adds the
 * surface-coloured outer ring that lets overlapping avatars read as separate.
 */
export function Avatar({
  name,
  color,
  size = 'lg',
  stacked,
  dim,
  title,
  onMouseEnter,
  onClick,
  style,
}: {
  name: string;
  /** The person's assigned colour — becomes the ring. */
  color: string;
  size?: keyof typeof SIZES;
  stacked?: boolean;
  /** Present but idle (no live cursor). */
  dim?: boolean;
  title?: string;
  onMouseEnter?: () => void;
  onClick?: () => void;
  style?: Record<string, string | number>;
}) {
  const { box, text } = SIZES[size];
  // Idle is a colour step, never element opacity: in an overlapping stack a
  // translucent avatar shows the one behind it straight through itself. Mixing
  // toward the fill keeps every disc opaque.
  const edge = dim ? `color-mix(in oklab, ${color} 40%, var(--ds-gray-100))` : color;
  const ring = stacked ? `0 0 0 1.5px ${edge}, 0 0 0 3px var(--ds-background-100)` : `0 0 0 1.5px ${edge}`;
  return (
    <div
      class={cn(
        'ml-avatar rounded-full grid place-items-center shrink-0 select-none',
        // Opaque fill, not the alpha token — same reason as the ring.
        'bg-(--ds-gray-100) font-medium tabular-nums',
        dim ? 'text-(--ds-gray-700)' : 'text-(--ds-gray-1000)',
        onClick && !dim ? 'cursor-pointer' : 'cursor-default',
        'transition-[color,box-shadow] duration-200',
      )}
      style={{ width: box, height: box, fontSize: text, boxShadow: ring, ...style }}
      title={title ?? name}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      {initials(name)}
    </div>
  );
}
