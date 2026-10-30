import { expect, test } from 'bun:test';
import { appendDictation, createDictation, type DictationHandlers, releaseAction } from './dictate';

function harness() {
  const texts: string[] = [];
  const errors: string[] = [];
  let handlers: DictationHandlers | null = null;
  let started = 0;
  let stopped = 0;
  const dictation = createDictation({
    onText: (t) => texts.push(t),
    onError: (c) => errors.push(c),
    createEngine: (h) => {
      handlers = h;
      return { start: () => started++, stop: () => stopped++ };
    },
  });
  return {
    dictation,
    texts,
    errors,
    counts: () => ({ started, stopped }),
    fire: () => {
      if (!handlers) throw new Error('engine not created');
      return handlers;
    },
  };
}

test('appendDictation spaces phrases and respects existing whitespace', () => {
  expect(appendDictation({ value: '', text: ' hello ' })).toBe('hello');
  expect(appendDictation({ value: 'fix this', text: 'button' })).toBe('fix this button');
  expect(appendDictation({ value: 'fix this\n', text: 'button' })).toBe('fix this\nbutton');
  expect(appendDictation({ value: 'keep', text: '   ' })).toBe('keep');
});

test('releaseAction: a quick press while idle keeps listening, a hold or a second press stops', () => {
  expect(releaseAction({ wasListening: false, heldMs: 100 })).toBe('keep');
  expect(releaseAction({ wasListening: false, heldMs: 800 })).toBe('stop');
  expect(releaseAction({ wasListening: true, heldMs: 100 })).toBe('stop');
});

test('final phrases reach onText, blanks do not', () => {
  const h = harness();
  h.dictation.start();
  h.fire().onFinal('hello');
  h.fire().onFinal('  ');
  expect(h.texts).toEqual(['hello']);
});

test('start is idempotent and stop only reaches the engine while listening', () => {
  const h = harness();
  h.dictation.stop();
  h.dictation.start();
  h.dictation.start();
  expect(h.counts().started).toBe(1);
  expect(h.dictation.listening.value).toBe(true);
  h.dictation.stop();
  expect(h.dictation.listening.value).toBe(false);
  expect(h.counts().stopped).toBe(1);
});

test('a real error stops listening and is reported; no-speech ends quietly', () => {
  const h = harness();
  h.dictation.start();
  h.fire().onError('not-allowed');
  expect(h.dictation.listening.value).toBe(false);
  expect(h.errors).toEqual(['not-allowed']);
  h.dictation.start();
  h.fire().onError('no-speech');
  expect(h.dictation.listening.value).toBe(false);
  expect(h.errors).toEqual(['not-allowed']);
});

test('the engine ending on its own clears listening', () => {
  const h = harness();
  h.dictation.start();
  h.fire().onEnd();
  expect(h.dictation.listening.value).toBe(false);
});

test('no engine means start does nothing', () => {
  const d = createDictation({ onText: () => {}, createEngine: () => null });
  d.start();
  expect(d.listening.value).toBe(false);
});
