import { type Signal, signal } from '@preact/signals';

export interface DictationHandlers {
  /** One finished phrase. Interim guesses never reach here. */
  onFinal: (text: string) => void;
  onError: (code: string) => void;
  onEnd: () => void;
}

export interface Engine {
  start: () => void;
  stop: () => void;
}

interface NativeResultEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

interface NativeRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: NativeResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type NativeCtor = new () => NativeRecognition;

function isNativeCtor(value: unknown): value is NativeCtor {
  return typeof value === 'function';
}

/** Chrome and Safari ship it as `webkitSpeechRecognition`; Firefox ships neither. */
function nativeCtor(): NativeCtor | null {
  if (typeof globalThis === 'undefined') return null;
  const candidate: unknown =
    Reflect.get(globalThis, 'SpeechRecognition') ?? Reflect.get(globalThis, 'webkitSpeechRecognition');
  return isNativeCtor(candidate) ? candidate : null;
}

export const dictationSupported = (): boolean => nativeCtor() !== null;

/** The browser's recognizer, or null where there is none (the button hides). */
function browserEngine(handlers: DictationHandlers): Engine | null {
  const Ctor = nativeCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = false;
  rec.lang = typeof navigator === 'undefined' ? 'en-US' : navigator.language;
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      if (result?.isFinal && result[0]) handlers.onFinal(result[0].transcript);
    }
  };
  rec.onerror = (e) => handlers.onError(e.error);
  rec.onend = handlers.onEnd;
  return { start: () => rec.start(), stop: () => rec.stop() };
}

/** `text` after `value`, one space apart; nothing added for an empty phrase. */
export function appendDictation({ value, text }: { value: string; text: string }): string {
  const phrase = text.trim();
  if (!phrase) return value;
  if (!value || /\s$/.test(value)) return value + phrase;
  return `${value} ${phrase}`;
}

/** Held this long or more, a press is hold-to-talk: letting go stops. Shorter, it is a click that toggles. */
export const HOLD_MS = 350;

export function releaseAction({ wasListening, heldMs }: { wasListening: boolean; heldMs: number }): 'stop' | 'keep' {
  return wasListening || heldMs >= HOLD_MS ? 'stop' : 'keep';
}

export interface Dictation {
  listening: Signal<boolean>;
  start: () => void;
  stop: () => void;
}

interface DictationOptions {
  onText: (text: string) => void;
  /** A real failure; `aborted` and `no-speech` end quietly. */
  onError?: (code: string) => void;
  /** Injectable for tests; defaults to the browser's recognizer. */
  createEngine?: (handlers: DictationHandlers) => Engine | null;
}

const QUIET_ERRORS = new Set(['aborted', 'no-speech']);

export function createDictation({ onText, onError, createEngine = browserEngine }: DictationOptions): Dictation {
  const listening = signal(false);
  let engine: Engine | null = null;

  const engineOrNew = () =>
    (engine ??= createEngine({
      onFinal: (text) => {
        if (text.trim()) onText(text);
      },
      onError: (code) => {
        listening.value = false;
        if (!QUIET_ERRORS.has(code)) onError?.(code);
      },
      onEnd: () => {
        listening.value = false;
      },
    }));

  return {
    listening,
    start: () => {
      if (listening.value) return;
      const e = engineOrNew();
      if (!e) return;
      try {
        e.start();
        listening.value = true;
      } catch {
        onError?.('start-failed');
      }
    },
    stop: () => {
      if (!listening.value) return;
      listening.value = false;
      engine?.stop();
    },
  };
}
