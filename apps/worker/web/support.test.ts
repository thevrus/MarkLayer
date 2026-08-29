import { describe, expect, test } from 'bun:test';
import { parseSupportRecord, recordSignal, type SupportRecord, shouldOfferSupport } from './support';

const fresh: SupportRecord = { days: [], shares: 0, mcp: false, asked: false, supported: false };
const veteran: SupportRecord = { ...fresh, days: ['2026-08-01', '2026-08-04', '2026-08-09'] };

const offer = (record: SupportRecord) => shouldOfferSupport({ record, hasCheckout: true });

describe('shouldOfferSupport — who never sees it', () => {
  test('somebody on their first day', () => {
    expect(offer({ ...fresh, shares: 12, mcp: true })).toBe(false);
  });

  test('somebody who came back but has not used it with anyone', () => {
    expect(offer({ ...veteran, shares: 2 })).toBe(false);
  });

  test('somebody already asked, no matter how much they use it', () => {
    expect(offer({ ...veteran, shares: 99, mcp: true, asked: true })).toBe(false);
  });

  test('somebody who already supported', () => {
    expect(offer({ ...veteran, shares: 99, mcp: true, supported: true })).toBe(false);
  });

  test('anybody at all when there is no checkout to send them to', () => {
    expect(shouldOfferSupport({ record: { ...veteran, shares: 9, mcp: true }, hasCheckout: false })).toBe(false);
  });
});

describe('shouldOfferSupport — who does', () => {
  test('a developer who wired up MCP and keeps coming back', () => {
    expect(offer({ ...veteran, mcp: true })).toBe(true);
  });

  test('somebody sharing with other people across several days', () => {
    expect(offer({ ...veteran, shares: 3 })).toBe(true);
  });
});

describe('recordSignal', () => {
  test('counts a day once however many times it is used', () => {
    let r = fresh;
    for (let i = 0; i < 20; i++) r = recordSignal({ record: r, signal: 'used', date: '2026-08-01' });
    expect(r.days).toEqual(['2026-08-01']);
  });

  test('stops collecting dates once it has enough to answer the question', () => {
    let r = fresh;
    for (const date of ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05']) {
      r = recordSignal({ record: r, signal: 'used', date });
    }
    // The record answers "enough distinct days?" — it is not a usage log.
    expect(r.days.length).toBe(3);
  });

  test('supporting also marks asked, so the card cannot return', () => {
    const r = recordSignal({ record: veteran, signal: 'supported' });
    expect(r.asked).toBe(true);
    expect(offer(r)).toBe(false);
  });

  test('does not mutate the record it was given', () => {
    const before = { ...veteran, days: [...veteran.days] };
    recordSignal({ record: veteran, signal: 'shared' });
    expect(veteran).toEqual(before);
  });
});

describe('parseSupportRecord', () => {
  const corrupt: (string | null)[] = [null, '', 'not json', '[]', '"a string"', '{"days":"nope"}'];
  test.each(corrupt)('%p reads as a new person', (raw) => {
    expect(parseSupportRecord(raw)).toEqual(fresh);
  });

  test('a truthy-but-wrong flag does not silently suppress the card', () => {
    // Only a literal `true` counts: a corrupt record must not read as "asked".
    expect(parseSupportRecord('{"asked":"yes"}').asked).toBe(false);
  });

  test('round-trips a real record', () => {
    const r: SupportRecord = { days: ['2026-08-01'], shares: 4, mcp: true, asked: false, supported: false };
    expect(parseSupportRecord(JSON.stringify(r))).toEqual(r);
  });
});
