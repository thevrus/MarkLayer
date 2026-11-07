import { useSignal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { track } from '../lib/analytics';
import { pushOp } from '../lib/ops';
import { color, lineWidth } from '../lib/prefs';
import { toClient, toDoc } from '../lib/scroller';
import { makeTextOp, TEXT_FONT_STACK, TEXT_LINE_HEIGHT, textFontSize } from '../lib/text-op';
import { activeTool } from '../lib/tool-state';

function TextInputOverlay({ x, y, onCommit }: { x: number; y: number; onCommit: (text: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fontSize = textFontSize(lineWidth.value);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const { x: left, y: top } = toClient({ x, y });

  return (
    <textarea
      ref={ref}
      class="fixed bg-transparent border-none outline-none resize-none p-0 m-0 z-2147483647"
      style={{
        left,
        top,
        fontSize: `${fontSize}px`,
        lineHeight: TEXT_LINE_HEIGHT,
        color: color.value,
        fontFamily: TEXT_FONT_STACK,
        minWidth: '40px',
        minHeight: `${fontSize * TEXT_LINE_HEIGHT}px`,
        caretColor: color.value,
        fieldSizing: 'content',
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

export function TextLayer() {
  const input = useSignal<{ x: number; y: number } | null>(null);
  const isText = activeTool.value === 'text';
  const cursorActive = isText && !input.value;

  return (
    <>
      <div
        class="fixed inset-0 z-2147483645"
        style={{
          pointerEvents: cursorActive ? 'auto' : 'none',
          cursor: cursorActive ? 'text' : 'default',
        }}
        onClick={(e) => {
          if (!isText) return;
          input.value = toDoc({ x: e.clientX, y: e.clientY });
        }}
      />
      {input.value && (
        <TextInputOverlay
          x={input.value.x}
          y={input.value.y}
          onCommit={(text) => {
            if (!text && input.value) track('text_cancelled');
            else if (input.value) {
              const { x, y } = input.value;
              pushOp(
                makeTextOp({
                  text,
                  x,
                  y,
                  color: color.value,
                  lineWidth: lineWidth.value,
                  viewport: { width: window.innerWidth, height: window.innerHeight },
                }),
              );
            }
            input.value = null;
          }}
        />
      )}
    </>
  );
}
