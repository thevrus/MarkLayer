import { describe, expect, test } from 'bun:test';
import type { CommentOp, CommentStatus } from '@marklayer/types';
import { agentWorkLanded, parseSupportRecord, recordSignal, type SupportRecord, shouldOfferSupport } from './support';

const fresh: SupportRecord = { days: [], shares: 0, mcp: false, asked: false, supported: false };
const veteran: SupportRecord = { ...fresh, days: ['2026-08-01', '2026-08-04', '2026-08-09'] };

const offer = (record: SupportRecord) => shouldOfferSupport({ record, hasCheckout: true });

describe('shouldOfferSupport — who never sees it', () => {
  test('somebody who has not authored anything yet', () => {
    expect(offer({ ...fresh, shares: 12, mcp: true })).toBe(false);
  });

  test('somebody who came back but has not used it with anyone', () => {
    expect(offer({ ...veteran, shares: 0 })).toBe(false);
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

  test('somebody who sent one share link, across several days of use', () => {
    expect(offer({ ...veteran, shares: 1 })).toBe(true);
  });

  test('somebody who shared on the very first day they used it', () => {
    // The share is the bar; a second calendar day is only a return visit.
    expect(offer({ ...fresh, days: ['2026-08-01'], shares: 1 })).toBe(true);
  });
});

describe('recordSignal', () => {
  test('counts a day once however many times it is used', () => {
    let r = fresh;
    for (let i = 0; i < 20; i++) r = recordSignal({ record: r, signal: 'used', date: '2026-08-01' });
    expect(r.days).toEqual(['2026-08-01']);
  });

  test('stops counting shares once the bar is cleared', () => {
    let r = fresh;
    for (let i = 0; i < 20; i++) r = recordSignal({ record: r, signal: 'shared' });
    // A bar to clear, not a tally of what somebody sent.
    expect(r.shares).toBe(1);
  });

  test('stops collecting dates once it has enough to answer the question', () => {
    let r = fresh;
    for (const date of ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05']) {
      r = recordSignal({ record: r, signal: 'used', date });
    }
    // The record answers "enough distinct days?" — it is not a usage log.
    expect(r.days).toEqual(['2026-08-01']);
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

describe('agentWorkLanded: the moment an agent finished something', () => {
  const comment = (over: Partial<CommentOp> = {}): CommentOp => ({
    id: 'c1',
    color: '#000',
    lineWidth: 2,
    tool: 'comment',
    num: 1,
    text: 'Fix the nav',
    x: 0,
    y: 0,
    ts: 0,
    assignedAgent: 'mcp-claude',
    ...over,
  });

  test('an agent resolving what it picked up', () => {
    const seen = new Map<string, CommentStatus>();
    expect(agentWorkLanded({ seen, ops: [comment({ status: 'in_progress' })] })).toBe(false);
    expect(agentWorkLanded({ seen, ops: [comment({ status: 'resolved' })] })).toBe(true);
  });

  test('not work that was already settled when the room loaded', () => {
    const seen = new Map<string, CommentStatus>();
    expect(agentWorkLanded({ seen, ops: [] })).toBe(false);
    expect(agentWorkLanded({ seen, ops: [comment({ status: 'resolved' })] })).toBe(false);
  });

  test('not a settled thread moving on to approved', () => {
    const seen = new Map<string, CommentStatus>();
    agentWorkLanded({ seen, ops: [comment({ status: 'resolved' })] });
    expect(agentWorkLanded({ seen, ops: [comment({ status: 'approved' })] })).toBe(false);
  });

  test('not a thread no agent took on', () => {
    const seen = new Map<string, CommentStatus>();
    agentWorkLanded({ seen, ops: [comment({ assignedAgent: undefined })] });
    expect(agentWorkLanded({ seen, ops: [comment({ assignedAgent: undefined, status: 'resolved' })] })).toBe(false);
  });
});
