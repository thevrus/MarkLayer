/** Name tag that rides under a cursor arrow — demo cursors and the visitor's own. */
export function CursorLabel({ name, color }: { name: string; color: string }) {
  return (
    <div
      class="whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-semibold text-white leading-none"
      style={{
        background: `linear-gradient(180deg, color-mix(in srgb, ${color} 80%, white 20%) 0%, ${color} 100%)`,
        borderTop: '0.5px solid rgba(255,255,255,0.25)',
        boxShadow: `0 1px 0 rgba(255,255,255,0.12) inset, 0 -1px 0 rgba(0,0,0,0.2) inset, 0 2px 6px ${color}40`,
      }}
    >
      {name}
    </div>
  );
}
