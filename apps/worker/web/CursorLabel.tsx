import type { ComponentChildren } from 'preact';

/** The coloured tag under a cursor arrow. Holds a name, or a `CursorChat` line. */
export function CursorLabel({ color, children }: { color: string; children: ComponentChildren }) {
  return (
    <div
      class="flex items-center whitespace-nowrap rounded-full px-3 py-1.5 text-ui font-semibold text-white leading-none"
      style={{
        background: `linear-gradient(180deg, color-mix(in srgb, ${color} 80%, white 20%) 0%, ${color} 100%)`,
        borderTop: '0.5px solid rgba(255,255,255,0.25)',
        boxShadow: `0 1px 0 rgba(255,255,255,0.12) inset, 0 -1px 0 rgba(0,0,0,0.2) inset, 0 2px 6px ${color}40`,
      }}
    >
      {children}
    </div>
  );
}

/** A chat line mid-typing: the newest character lands, and the caret follows it. */
export function CursorChat({ text }: { text: string }) {
  return (
    <>
      <span class="whitespace-pre">
        {text.slice(0, -1)}
        <span key={text.length} class="ml-char-in">
          {text.slice(-1)}
        </span>
      </span>
      {/* Keyed on length so each keystroke restarts the blink: a caret holds solid while someone types. */}
      <span key={text.length} class="ml-caret" aria-hidden="true" />
    </>
  );
}
