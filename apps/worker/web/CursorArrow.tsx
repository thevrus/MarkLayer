/** Shared cursor arrow SVG used in real peer cursors and landing page demo cursors */
export function CursorArrow({ color }: { color: string }) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.2))' }}
      aria-hidden="true"
    >
      <path
        d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"
        fill={color}
        stroke="white"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
    </svg>
  );
}
