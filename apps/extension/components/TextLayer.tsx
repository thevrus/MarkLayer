import { useSignal } from '@preact/signals';
import { nanoid } from 'nanoid';
import { useEffect, useRef } from 'preact/hooks';
import { activeTool, color, lineWidth, pushOp } from '../lib/state';
import type { TextOp } from '../lib/types';

function TextInputOverlay({ x, y, onCommit }: { x: number; y: number; onCommit: (text: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fontSize = Math.max(14, lineWidth.value * 6);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <textarea
      ref={ref}
      class="fixed bg-transparent border-none outline-none resize-none p-0 m-0 z-[2147483647]"
      style={{
        left: x - scrollX,
        top: y - scrollY,
        fontSize: `${fontSize}px`,
        lineHeight: 1.3,
        color: color.value,
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Geist", system-ui, sans-serif',
        minWidth: '40px',
        minHeight: `${fontSize * 1.3}px`,
        caretColor: color.value,
        fieldSizing: 'content',
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

export function TextLayer() {
  const input = useSignal<{ x: number; y: number } | null>(null);
  const isText = activeTool.value === 'text';
  const cursorActive = isText && !input.value;

  return (
    <>
      <div
        class="fixed inset-0 z-[2147483645]"
        style={{
          pointerEvents: cursorActive ? 'auto' : 'none',
          cursor: cursorActive ? 'text' : 'default',
        }}
        onClick={(e) => {
          if (!isText) return;
          input.value = { x: e.clientX + scrollX, y: e.clientY + scrollY };
        }}
      />
      {input.value && (
        <TextInputOverlay
          x={input.value.x}
          y={input.value.y}
          onCommit={(text) => {
            if (text && input.value) {
              pushOp({
                id: nanoid(),
                tool: 'text',
                text,
                x: input.value.x,
                y: input.value.y,
                fontSize: Math.max(14, lineWidth.value * 6),
                color: color.value,
                lineWidth: lineWidth.value,
              } as TextOp);
            }
            input.value = null;
          }}
        />
      )}
    </>
  );
}
