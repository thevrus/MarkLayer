import { MousePointer2 } from 'lucide-preact';

/** Shared cursor arrow using Lucide icon — used in real peer cursors and landing page demo cursors */
export function CursorArrow({ color }: { color: string }) {
  return (
    <MousePointer2
      size={36}
      fill={color}
      color="white"
      strokeWidth={1.5}
      style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.2))' }}
      aria-hidden="true"
    />
  );
}
