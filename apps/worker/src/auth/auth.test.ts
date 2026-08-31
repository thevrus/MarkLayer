import { describe, expect, test } from 'bun:test';
import { asDb, fakeDb } from '../test-d1';
import { authStore, ownedStore } from './store';
import { hashToken, mintToken } from './tokens';
import { normalizeEmail } from './types';

describe('normalizeEmail', () => {
  test('lower-cases and trims so one person is one account', () => {
    expect(normalizeEmail('  Vadym@Example.COM ')).toBe('vadym@example.com');
  });

  test('rejects the shapes that cannot be an address', () => {
    expect(normalizeEmail('nope')).toBeNull();
    expect(normalizeEmail('@example.com')).toBeNull();
    expect(normalizeEmail('a@b')).toBeNull();
    expect(normalizeEmail('two@at@example.com')).toBeNull();
    expect(normalizeEmail('has space@example.com')).toBeNull();
    expect(normalizeEmail(`${'a'.repeat(250)}@example.com`)).toBeNull();
  });

  test('accepts the unusual-but-real addresses a stricter pattern would turn away', () => {
    expect(normalizeEmail("o'brien+tag@sub.example.co.uk")).toBe("o'brien+tag@sub.example.co.uk");
  });
});

describe('tokens', () => {
  test('mints a distinct URL-safe secret each time', () => {
    const a = mintToken();
    const b = mintToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('hashes deterministically, and never returns the secret itself', async () => {
    const token = mintToken();
    const digest = await hashToken(token);
    expect(await hashToken(token)).toBe(digest);
    expect(digest).not.toBe(token);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('authStore.redeemLoginToken', () => {
  test('returns null when the conditional update matched no row', async () => {
    // Two tabs opening the same link: the loser's UPDATE returns nothing.
    expect(await authStore(asDb(fakeDb({ first: null }))).redeemLoginToken('tok')).toBeNull();
  });

  test('guards single use and expiry inside the UPDATE, not in a prior read', async () => {
    const db = fakeDb({ first: { email: 'someone@example.com' } });
    expect(await authStore(asDb(db)).redeemLoginToken('tok')).toBe('someone@example.com');
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].sql).toContain('used_at IS NULL');
    expect(db.calls[0].sql).toContain('expires_at >');
    expect(db.calls[0].sql).toContain('RETURNING email');
  });
});

describe('authStore.upsertUser', () => {
  test('signs up and signs in with one upsert, taking the id back from the row', async () => {
    const db = fakeDb({ first: { id: 'existing', email: 'a@b.com' } });
    expect(await authStore(asDb(db)).upsertUser('a@b.com')).toEqual({ id: 'existing', email: 'a@b.com' });
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].sql).toContain('ON CONFLICT(email)');
  });
});

describe('authStore.throttleSeconds', () => {
  test('allows the first request for an address', async () => {
    expect(await authStore(asDb(fakeDb({ first: null }))).throttleSeconds('a@b.com')).toBe(0);
  });

  test('reports the remaining wait while a fresh link is outstanding', async () => {
    const createdAt = Math.floor(Date.now() / 1000) - 20;
    const wait = await authStore(asDb(fakeDb({ first: { created_at: createdAt } }))).throttleSeconds('a@b.com');
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(40);
  });
});

describe('ownedStore.claimAnnotation', () => {
  test('only claims a link nobody owns', async () => {
    const db = fakeDb({ changes: 1 });
    expect(await ownedStore(asDb(db)).claimAnnotation({ id: 'abc', ownerId: 'u1' })).toBe(true);
    expect(db.calls[0].sql).toContain('owner_id IS NULL');
  });

  test('reports failure when the row is already owned', async () => {
    expect(await ownedStore(asDb(fakeDb({ changes: 0 }))).claimAnnotation({ id: 'abc', ownerId: 'u1' })).toBe(false);
  });
});
