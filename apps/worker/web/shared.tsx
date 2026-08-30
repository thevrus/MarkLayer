import { color, lineWidth } from '@ext/lib/state';
import type { DeviceMode } from '@ext/lib/types';
import { Loader2, Monitor, Smartphone, Tablet } from 'lucide-preact';
import { useEffect, useRef } from 'preact/hooks';
import { MARK_PATHS, MARK_TRANSFORM } from '../src/brand';

/** One glyph per viewport, so the switcher and the op badge can never disagree. */
export const DEVICE_ICONS = { desktop: Monitor, tablet: Tablet, mobile: Smartphone } as const;
export const DEVICE_LABELS: Record<DeviceMode, string> = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' };

export function Spinner() {
  return <Loader2 size={16} class="animate-spin" aria-hidden="true" />;
}

let logoIdx = 0;
export function Logo({ size = 24, class: className }: { size?: number; class?: string }) {
  const id = `ml${++logoIdx}`;
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" fill="none" aria-hidden="true" class={className}>
      <g transform={MARK_TRANSFORM} fill={`url(#${id})`}>
        {MARK_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <defs>
        <linearGradient id={id} gradientTransform="rotate(45)" style={{ transformOrigin: 'center center' }}>
          <stop stop-color="#A855F7" />
          <stop offset="1" stop-color="#6D28D9" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* The box is the tap target, not a resting container: it carries no background
   until hover, and it matches the sibling icon link in the landing nav so the
   two read as one pair rather than two differently-sized glyphs. 44px under
   `sm` clears the touch-target floor; the bare 18px anchor did not. */
const ICON_LINK_CLS =
  'inline-flex items-center justify-center size-11 sm:size-9 rounded-lg transition-colors no-underline hover:bg-current/[0.04]';

export function GithubLink({ dark }: { dark?: boolean }) {
  return (
    <a
      href="https://github.com/thevrus/MarkLayer"
      target="_blank"
      rel="noopener"
      class={`${ICON_LINK_CLS} ${
        dark ? 'text-ml-fg/60 hover:text-ml-fg' : 'text-(--ds-gray-900) hover:text-(--ds-gray-900)'
      }`}
    >
      <span class="sr-only">GitHub</span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
      </svg>
    </a>
  );
}

export function TextInputOverlay({
  x,
  y,
  scale: s,
  scrollY,
  onCommit,
}: {
  x: number;
  y: number;
  scale: number;
  scrollY: number;
  onCommit: (text: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fontSize = Math.max(14, lineWidth.value * 6);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const vx = x * s;
  const vy = y * s - scrollY;

  return (
    <textarea
      name="textAnnotation"
      ref={ref}
      class="absolute bg-transparent border-none outline-none resize-none p-0 m-0"
      style={{
        left: vx,
        top: vy,
        fontSize: `${fontSize * s}px`,
        lineHeight: 1.3,
        color: color.value,
        fontFamily: '"Geist", -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
        minWidth: '40px',
        minHeight: `${fontSize * s * 1.3}px`,
        caretColor: color.value,
        fieldSizing: 'content',
        zIndex: 2147483646,
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onCommit(e.currentTarget.value.trim());
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCommit('');
        }
      }}
      onBlur={(e) => {
        onCommit(e.currentTarget.value.trim());
      }}
      placeholder="Type here…"
    />
  );
}
