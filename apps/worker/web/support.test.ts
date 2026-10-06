import { describe, expect, test } from 'bun:test';
import type { CommentOp, CommentStatus } from '@marklayer/types';
import {
  agentWorkLanded,
  parseSupportRecord,
  recordSignal,
  type SupportRecord,
  type SupportSignal,
  shouldOfferSupport,
} from './support';

const fresh: SupportRecord = {
  days: [],
  shares: 0,
  mcp: false,
  notes: 0,
  answers: 0,
  answeredOn: null,
  notesAtAnswer: 0,
  supported: false,
};
const veteran: SupportRecord = { ...fresh, days: ['2026-08-01', '2026-08-04'] };

const offer = (record: SupportRecord, date = '2026-08-10') => shouldOfferSupport({ record, hasCheckout: true, date });
const fold = (record: SupportRecord, signals: SupportSignal[], date?: string) =>
  signals.reduce((r, signal) => recordSignal({ record: r, signal, date }), record);
const times = (n: number, signal: SupportSignal): SupportSignal[] => Array<SupportSignal>(n).fill(signal);
/** 25 notes, the first card answered on 2026-09-01, then `since` more notes. */
const answeredOnce = (since = 30) =>
  fold({ ...veteran, shares: 1 }, [...times(25, 'noted'), 'answered', ...times(since, 'noted')], '2026-09-01');

describe('shouldOfferSupport — who never sees it', () => {
  test('somebody who has not authored anything yet', () => {
    expect(offer({ ...fresh, shares: 12, mcp: true })).toBe(false);
  });

  test('somebody who came back but has not used it with anyone or for anything', () => {
    expect(offer({ ...veteran, shares: 0, notes: 19 })).toBe(false);
  });

  test('somebody who left every note on one day, however many', () => {
    // One long review of one page, not a habit.
    expect(offer({ ...veteran, days: ['2026-08-01'], notes: 200 })).toBe(false);
  });

  test('somebody who said not to ask again', () => {
    const declined = fold({ ...veteran, shares: 1 }, ['optedOut', ...times(99, 'noted')], '2026-09-01');
    expect(offer(declined, '2027-01-01')).toBe(false);
  });

  test('somebody already answered twice, no matter how much they use it', () => {
    const twice = fold(answeredOnce(), ['answered', ...times(99, 'noted')], '2026-11-01');
    expect(offer(twice, '2027-06-01')).toBe(false);
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

  test('somebody who never shares, but keeps leaving notes on a second day', () => {
    expect(offer({ ...veteran, notes: 20 })).toBe(true);
  });
});

describe('shouldOfferSupport — the second and last ask', () => {
  test('a month after the first answer, with real use since', () => {
    expect(offer(answeredOnce(), '2026-10-01')).toBe(true);
  });

  test('not a day before the month is out', () => {
    expect(offer(answeredOnce(), '2026-09-30')).toBe(false);
  });

  test('not on notes left before the first answer', () => {
    // 54 in all clears 30, but only 29 came after the answer.
    expect(offer(answeredOnce(29), '2026-10-01')).toBe(false);
  });

  test('a record from the one-ask days waits a month from its next visit', () => {
    let r = parseSupportRecord('{"days":["2026-08-01"],"shares":1,"asked":true}');
    r = fold(r, times(30, 'noted'));
    // Undated: there is no month to have waited out yet, whatever the notes.
    expect(offer(r, '2027-01-01')).toBe(false);
    r = fold(r, ['used'], '2026-10-05');
    expect(offer(r, '2026-10-20')).toBe(false);
    expect(offer(r, '2026-11-04')).toBe(true);
  });
});

describe('recordSignal', () => {
  test('counts a day once however many times it is used', () => {
    expect(fold(fresh, times(20, 'used'), '2026-08-01').days).toEqual(['2026-08-01']);
  });

  test('stops counting shares once the bar is cleared', () => {
    // A bar to clear, not a tally of what somebody sent.
    expect(fold(fresh, times(20, 'shared')).shares).toBe(1);
  });

  test('stops collecting dates once it has enough to answer the question', () => {
    let r = fresh;
    for (const date of ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05']) {
      r = recordSignal({ record: r, signal: 'used', date });
    }
    // The record answers "enough distinct days?" — it is not a usage log.
    expect(r.days).toEqual(['2026-08-01', '2026-08-02']);
  });

  test('does not mutate the record it was given', () => {
    const before = { ...veteran, days: [...veteran.days] };
    recordSignal({ record: veteran, signal: 'used', date: '2026-09-01' });
    expect(veteran).toEqual(before);
  });
});

describe('parseSupportRecord', () => {
  const corrupt: (string | null)[] = [null, '', 'not json', '[]', '"a string"', '{"days":"nope"}'];
  test.each(corrupt)('%p reads as a new person', (raw) => {
    expect(parseSupportRecord(raw)).toEqual(fresh);
  });

  test('a corrupt flag or count neither suppresses the card nor buys an extra ask', () => {
    // Only a literal `true` counts as a flag, and only a whole number >= 0 as a count.
    expect(parseSupportRecord('{"asked":"yes","supported":"true","answers":-1,"notes":2.5}')).toEqual(fresh);
  });

  test('round-trips a real record', () => {
    const r = answeredOnce();
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
