import { cn } from '@marklayer/types';
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { Avatar } from './Avatar';

/**
 * Hover spring: the hovered avatar lifts and scales slightly; neighbours lift
 * a decaying fraction of that, like pressing on a row of coins.
 */
const AVATAR_LIFT = -2;
const AVATAR_SCALE = 1.03;
const AVATAR_FALLOFF = 0.35;

function useAvatarSpring() {
  const groupRef = useRef<HTMLDivElement>(null);
  const eachChild = (fn: (el: HTMLElement, i: number) => void) => {
    const group = groupRef.current;
    if (!group) return;
    for (const [i, el] of Array.from(group.children).entries()) {
      if (el instanceof HTMLElement) fn(el, i);
    }
  };
  const spring = (activeIdx: number) =>
    eachChild((el, i) => {
      el.style.transitionTimingFunction = 'var(--ml-avatar-ease-in)';
      const shift = AVATAR_LIFT * AVATAR_FALLOFF ** Math.abs(i - activeIdx);
      el.style.setProperty('--shift', `${shift.toFixed(3)}px`);
      el.style.setProperty('--scale-active', i === activeIdx ? `${AVATAR_SCALE}` : '1');
    });
  const reset = () =>
    eachChild((el) => {
      el.style.transitionTimingFunction = 'var(--ml-avatar-ease-out)';
      el.style.setProperty('--shift', '0px');
      el.style.setProperty('--scale-active', '1');
    });
  return { groupRef, spring, reset };
}

export interface AvatarGroupItem {
  key: string;
  name: string;
  color: string;
  /** Rendered instead of initials. */
  glyph?: ComponentChildren;
  /** Present but inactive — dimmed ring. */
  dim?: boolean;
  title?: string;
  onClick?: () => void;
}

/**
 * A row of overlapping `Avatar`s with a hover spring and a "+N" slot for
 * whatever doesn't fit in `max`. Presentational only — callers own what each
 * item means (a peer, a teammate, a reviewer).
 */
export function AvatarGroup({ items, max, className }: { items: AvatarGroupItem[]; max: number; className?: string }) {
  const { groupRef, spring, reset } = useAvatarSpring();
  const visible = items.slice(0, max);
  const overflow = items.length - max;
  const [hovered, setHovered] = useState<number | null>(null);
  const enter = (index: number) => () => {
    setHovered(index);
    spring(index);
  };
  const zOf = (index: number, base: number) => (hovered === index ? items.length + 10 : base);

  if (!items.length) return null;
  return (
    <div
      ref={groupRef}
      class={cn('flex items-center -space-x-2', className)}
      onMouseLeave={() => {
        setHovered(null);
        reset();
      }}
    >
      {visible.map((item, i) => (
        <Avatar
          key={item.key}
          name={item.name}
          color={item.color}
          glyph={item.glyph}
          stacked
          dim={item.dim}
          title={item.title}
          style={{ zIndex: zOf(i, items.length - i) }}
          onMouseEnter={enter(i)}
          onClick={item.onClick}
        />
      ))}
      {overflow > 0 && (
        <div
          class="ml-avatar w-6 h-6 rounded-full grid place-items-center shrink-0 bg-(--ds-gray-100) text-(--ds-gray-900) text-meta font-medium tabular-nums"
          style={{
            boxShadow: '0 0 0 1.5px var(--ds-gray-alpha-400), 0 0 0 3px var(--ds-background-100)',
            zIndex: zOf(max, 0),
          }}
          onMouseEnter={enter(max)}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}
