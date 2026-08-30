import { describe, expect, test } from 'bun:test';
import type { DrawOp } from '@marklayer/types';
import { PROVIDERS, providerList } from './providers';
import { type Notifiable, notifiableFrom } from './types';

const base = { id: 'op1', color: '#fff', lineWidth: 2 };
const args = { roomUrl: 'https://marklayer.app/s/abc', pageUrl: 'https://example.com' };
const item: Notifiable = { kind: 'Comment', author: 'Ada', text: 'Contrast fails', priority: 'high' };
const config = { url: 'https://hooks.slack.com/services/T/B/x' };

describe('notifiableFrom', () => {
  test('takes the annotations that carry words somebody wrote', () => {
    const comment: DrawOp = { ...base, tool: 'comment', num: 1, text: 'Contrast fails', x: 0, y: 0, ts: 0 };
    expect(notifiableFrom(comment)).toMatchObject({ kind: 'Comment', text: 'Contrast fails' });
    expect(notifiableFrom({ ...comment, id: 'op2', parentId: 'op1' })).toMatchObject({ kind: 'Reply' });
  });

  // A channel that says "someone drew a line" is a channel people mute.
  test('ignores marks that say nothing on their own', () => {
    const pen: DrawOp = { ...base, tool: 'pen', points: [{ x: 1, y: 1 }], compositeOperation: 'source-over' };
    expect(notifiableFrom(pen)).toBeNull();
    const guide: DrawOp = { ...base, tool: 'guide', orientation: 'vertical', position: 10 };
    expect(notifiableFrom(guide)).toBeNull();
    const blank: DrawOp = { ...base, tool: 'comment', num: 1, text: '   ', x: 0, y: 0, ts: 0 };
    expect(notifiableFrom(blank)).toBeNull();
  });

  test('renders a suggested edit as the before and after', () => {
    const edit: DrawOp = {
      ...base,
      tool: 'selection',
      text: 'Sign up free',
      suggestion: 'Start free',
      rects: [],
      ts: 0,
    };
    expect(notifiableFrom(edit)).toMatchObject({ kind: 'Suggested edit', text: '“Sign up free” → “Start free”' });
  });
});

describe('every provider', () => {
  test('declines rather than throwing when the config is not its shape', () => {
    for (const provider of providerList) {
      const event = { type: 'annotations.created' as const, items: [item] };
      expect(provider.render({ event, config: {}, ...args })).toBeNull();
      expect(provider.render({ event, config: null, ...args })).toBeNull();
      expect(provider.render({ event, config: { url: 42 }, ...args })).toBeNull();
    }
  });

  test('carries the author, the text and a way back to the room', () => {
    for (const provider of providerList) {
      const rendered = provider.render({
        event: { type: 'annotations.created', items: [item] },
        config,
        ...args,
      });
      expect(rendered).not.toBeNull();
      expect(rendered?.body).toContain('Ada');
      expect(rendered?.body).toContain('Contrast fails');
      expect(rendered?.body).toContain('marklayer.app/s/abc');
    }
  });
});

describe('discord', () => {
  // Discord refuses a message over 2000 characters, so a busy room must not
  // produce one: the batch is trimmed rather than sent and bounced.
  test('keeps content within the 2000-character limit', () => {
    const long: Notifiable = { kind: 'Comment', author: 'Ada', text: 'x'.repeat(300) };
    const rendered = PROVIDERS.discord.render({
      event: { type: 'annotations.created', items: Array.from({ length: 20 }, () => long) },
      config,
      ...args,
    });
    const content = JSON.parse(rendered?.body ?? '{}').content as string;
    expect(content.length).toBeLessThanOrEqual(2000);
    // Trimmed, but still says how much was left out and where to see it.
    expect(content).toContain('more');
    expect(content).toContain('marklayer.app/s/abc');
  });
});

describe('webhook', () => {
  test('sends structured JSON, because a program is reading it', () => {
    const rendered = PROVIDERS.webhook.render({
      event: { type: 'annotations.created', items: [item] },
      config: { url: 'https://example.com/hook' },
      ...args,
    });
    const body = JSON.parse(rendered?.body ?? '{}');
    expect(body).toMatchObject({
      type: 'annotations.created',
      room: 'https://marklayer.app/s/abc',
      page: 'https://example.com',
    });
    expect(body.items[0]).toMatchObject({ author: 'Ada', kind: 'Comment' });
  });
});
