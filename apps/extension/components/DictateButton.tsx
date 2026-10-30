import { cn } from '@marklayer/types';
import { useSignal } from '@preact/signals';
import { AudioLines } from 'lucide-preact';
import type { RefObject } from 'preact';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { track } from '../lib/analytics';
import { appendDictation, createDictation, dictationSupported, releaseAction } from '../lib/dictate';
import { geist } from '../lib/geist';
import { toast } from '../lib/state';
import { Tooltip } from './Tooltip';

interface DictateButtonProps {
  /** The note's uncontrolled textarea: read for the show/hide check, appended to as speech lands. */
  field: RefObject<HTMLTextAreaElement>;
}

const ERROR_COPY: Record<string, string> = {
  'not-allowed': 'Microphone blocked for this site',
  'service-not-allowed': 'Dictation is not available here',
  'audio-capture': 'No microphone found',
  network: 'Dictation needs a connection',
};

/**
 * Bare mic for a note's action row. Click toggles; hold while talking and release to stop.
 * Shows once the note has text (or while listening), and only where the browser can recognize speech.
 */
export function DictateButton({ field }: DictateButtonProps) {
  const hasText = useSignal(false);
  // The field is uncontrolled, so its input events are the only signal of what is typed.
  useEffect(() => {
    const ta = field.current;
    if (!ta) return;
    const sync = () => {
      hasText.value = ta.value.trim() !== '';
    };
    sync();
    ta.addEventListener('input', sync);
    return () => ta.removeEventListener('input', sync);
  }, [field, hasText]);

  const dictation = useMemo(
    () =>
      createDictation({
        onText: (text) => {
          const ta = field.current;
          if (!ta) return;
          ta.value = appendDictation({ value: ta.value, text });
          // As if typed, so the note's own onInput (mirrors, mentions) sees the words too.
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          track('dictation_used', { chars: text.trim().length });
        },
        onError: (code) => toast(ERROR_COPY[code] ?? 'Dictation stopped'),
      }),
    [],
  );
  // Unmount must release the microphone; this is the non-signal API case.
  useEffect(() => dictation.stop, [dictation]);

  const press = useRef<{ at: number; wasListening: boolean } | null>(null);
  const listening = dictation.listening.value;
  if (!dictationSupported() || (!hasText.value && !listening)) return null;

  const label = listening ? 'Stop dictation' : 'Dictate';
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={listening}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        press.current = { at: Date.now(), wasListening: listening };
        if (!listening) dictation.start();
      }}
      onPointerUp={() => {
        const down = press.current;
        press.current = null;
        if (!down) return;
        const action = releaseAction({ wasListening: down.wasListening, heldMs: Date.now() - down.at });
        if (action === 'stop') dictation.stop();
      }}
      onPointerCancel={() => {
        press.current = null;
        dictation.stop();
      }}
      onClick={(e) => {
        // Pointer presses are handled above; detail 0 is a keyboard activation.
        if (e.detail === 0) {
          if (listening) dictation.stop();
          else dictation.start();
        }
      }}
      class={cn(geist.ctlXs, listening ? geist.ctlOn : geist.ctlIdle, 'group')}
    >
      <AudioLines size={14} strokeWidth={1.75} aria-hidden="true" />
      <Tooltip text={label} />
    </button>
  );
}
