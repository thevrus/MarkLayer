import { afterAll, describe, expect, test } from 'bun:test';
import { signal } from '@preact/signals';
import { type AnalyticsProps, setAnalytics, track, trackChanges } from './analytics';

const capture = (surface: 'extension' | 'viewer' | 'landing' = 'viewer') => {
  const events: Array<[string, AnalyticsProps | undefined]> = [];
  setAnalytics({ sink: (event, props) => events.push([event, props]), surface });
  return events;
};

afterAll(() => {
  // The sink is module state shared with every other suite in this process.
  setAnalytics({ sink: () => {}, surface: 'extension' });
});

describe('track', () => {
  test('stamps every event with the reporting surface', () => {
    const events = capture('landing');
    track('tool_selected', { tool: 'comment' });
    expect(events).toEqual([['tool_selected', { surface: 'landing', tool: 'comment' }]]);
  });

  test('lets a caller state its own surface', () => {
    // `surface` is spread first, so an explicit prop wins - which is what the
    // landing demo relies on to report a click as interest rather than work.
    const events = capture('viewer');
    track('tool_selected', { surface: 'landing' });
    expect(events[0]?.[1]).toEqual({ surface: 'landing' });
  });
});

describe('trackChanges', () => {
  test('reports a change but never the value the page loaded with', () => {
    const tool = signal('navigate');
    const seen: string[] = [];
    trackChanges(tool, (v) => seen.push(v));
    expect(seen).toEqual([]);

    tool.value = 'comment';
    expect(seen).toEqual(['comment']);
  });

  test('stays quiet when a write does not change the value', () => {
    const tool = signal('navigate');
    const seen: string[] = [];
    trackChanges(tool, (v) => seen.push(v));
    tool.value = 'navigate';
    expect(seen).toEqual([]);
  });

  test('reports a value that comes back after changing away and returning', () => {
    const tool = signal('navigate');
    const seen: string[] = [];
    trackChanges(tool, (v) => seen.push(v));
    tool.value = 'comment';
    tool.value = 'navigate';
    expect(seen).toEqual(['comment', 'navigate']);
  });
});
