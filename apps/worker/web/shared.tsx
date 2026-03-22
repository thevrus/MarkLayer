import { color, lineWidth } from '@ext/lib/state';
import type { LucideIcon } from 'lucide-preact';
import { Code, Link, Loader2, Lock, MessageSquare, PenTool, Puzzle, User, Users } from 'lucide-preact';
import { useEffect, useRef } from 'preact/hooks';

export function Spinner() {
  return <Loader2 size={16} class="animate-spin" aria-hidden="true" />;
}

let logoIdx = 0;
export function Logo({ size = 24 }: { size?: number }) {
  const id = `ml${++logoIdx}`;
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" fill="none" aria-hidden="true">
      <rect width="512" height="512" rx="128" fill={`url(#${id})`} />
      <path
        transform="translate(80 80) scale(22)"
        stroke="white"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="1.5"
        d="m9.324 3.324 3.352 3.352m-6.746 6.59 7.595-7.419c.95-.928.958-2.452.02-3.391v0a2.384 2.384 0 0 0-3.392.02l-7.42 7.594-.983 4.18 4.18-.983Z"
      />
      <defs>
        <linearGradient id={id} gradientTransform="rotate(45)" style={{ transformOrigin: 'center center' }}>
          <stop stop-color="#F953C6" />
          <stop offset="1" stop-color="#B91D73" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function GithubLink({ dark }: { dark?: boolean }) {
  return (
    <a
      href="https://github.com/thevrus/MarkLayer"
      target="_blank"
      rel="noopener"
      class={
        dark
          ? 'text-ml-fg/25 hover:text-ml-fg/50 transition-colors no-underline'
          : 'text-ml-glass-fg/25 hover:text-ml-glass-fg/50 transition-colors no-underline'
      }
    >
      <span class="sr-only">GitHub</span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
      </svg>
    </a>
  );
}

export const FEATURES: { label: string; icon: LucideIcon; anim: string }[] = [
  { label: 'Drawing\ntools', icon: PenTool, anim: 'lp-anim-wiggle' },
  { label: 'Real-time\ncollaboration', icon: Users, anim: 'lp-anim-bounce' },
  { label: 'Shareable\nlinks', icon: Link, anim: 'lp-anim-rotate' },
  { label: 'Threaded\ncomments', icon: MessageSquare, anim: 'lp-anim-bounce' },
  { label: 'No sign-up\nrequired', icon: User, anim: 'lp-anim-bounce' },
  { label: 'Private\nby default', icon: Lock, anim: 'lp-anim-shake' },
  { label: 'Browser\nextension', icon: Puzzle, anim: 'lp-anim-rotate' },
  { label: 'Free &\nopen source', icon: Code, anim: 'lp-anim-pulse' },
];

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
      ref={ref}
      class="absolute bg-transparent border-none outline-none resize-none p-0 m-0"
      style={{
        left: vx,
        top: vy,
        fontSize: `${fontSize * s}px`,
        lineHeight: 1.3,
        color: color.value,
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif',
        minWidth: '40px',
        minHeight: `${fontSize * s * 1.3}px`,
        caretColor: color.value,
        fieldSizing: 'content',
        zIndex: 2147483646,
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onCommit((e.currentTarget as HTMLTextAreaElement).value.trim());
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCommit('');
        }
      }}
      onBlur={(e) => {
        onCommit((e.currentTarget as HTMLTextAreaElement).value.trim());
      }}
      placeholder="Type here..."
    />
  );
}
