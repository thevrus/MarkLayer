import { fromBase64, sha256Hex, toBase64Url } from '../encoding';

/**
 * PBKDF2-SHA256 at 100,000 iterations. That is the ceiling: Workers' WebCrypto
 * refuses more, and one derivation already costs tens of milliseconds of the
 * request's CPU budget. Stored in the record, so raising it later needs no migration.
 */
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;
const SCHEME = 'pbkdf2-sha256';

const encoder = new TextEncoder();

async function derive({
  password,
  salt,
  iterations,
}: {
  password: string;
  salt: Uint8Array<ArrayBuffer>;
  iterations: number;
}): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, KEY_BITS);
  return new Uint8Array(bits);
}

/** Every byte compared, whatever the first mismatch, so the time taken says nothing about where it was. */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** A fresh salt per call, so two links with the same password store different records. */
export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  const key = await derive({ password, salt, iterations: ITERATIONS });
  return `${SCHEME}$${ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(key)}`;
}

async function deriveAndCompare({ password, record }: { password: string; record: string }): Promise<boolean> {
  const [scheme, rounds, saltPart, keyPart] = record.split('$');
  const iterations = Number(rounds);
  if (scheme !== SCHEME || !Number.isInteger(iterations) || iterations < 1 || !saltPart || !keyPart) return false;
  const salt = fromBase64(saltPart);
  const expected = fromBase64(keyPart);
  if (!salt || !expected) return false;
  return equalBytes(await derive({ password, salt, iterations }), expected);
}

/**
 * Passwords this isolate already proved, keyed by record and a digest of the
 * guess. An agent sends the password on every MCP call; without this each call
 * re-pays the full derivation. The record is part of the key, so a change misses.
 */
const proven = new Set<string>();
const PROVEN_CAP = 512;

export async function verifyPassword({ password, record }: { password: string; record: string }): Promise<boolean> {
  const memo = `${record}\n${await sha256Hex(password)}`;
  if (proven.has(memo)) return true;
  const ok = await deriveAndCompare({ password, record });
  if (ok) {
    if (proven.size >= PROVEN_CAP) proven.clear();
    proven.add(memo);
  }
  return ok;
}

/** How long an unlock lasts in one browser before it asks again. */
export const UNLOCK_TTL_SECONDS = 30 * 24 * 60 * 60;

/** One cookie per room, so unlocking one link says nothing about any other. Ids are `[A-Za-z0-9_-]`, cookie-safe. */
export function unlockCookieName(roomId: string): string {
  return `ml_unlock_${roomId}`;
}

/**
 * Keyed by the room's own password record rather than a worker-wide secret:
 * nothing new to provision, and a new password (fresh salt) voids every old
 * cookie even before the generation check below. The record never leaves the server.
 */
function hmacKey(record: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(record), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

/** `<gen>.<expires>.<signature>`: the generation travels in the clear so a stale one is refused before any crypto. */
export async function signUnlock({
  roomId,
  gen,
  record,
  expiresAt,
}: {
  roomId: string;
  gen: number;
  record: string;
  expiresAt: number;
}): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(record), encoder.encode(`${roomId}.${gen}.${expiresAt}`));
  return `${gen}.${expiresAt}.${toBase64Url(new Uint8Array(sig))}`;
}

export async function verifyUnlock({
  token,
  roomId,
  gen,
  record,
  now,
}: {
  token: string;
  roomId: string;
  gen: number;
  record: string;
  now: number;
}): Promise<boolean> {
  const [genPart, expPart, sigPart] = token.split('.');
  const tokenGen = Number(genPart);
  const expiresAt = Number(expPart);
  if (!Number.isInteger(tokenGen) || tokenGen !== gen || !Number.isInteger(expiresAt) || expiresAt <= now) return false;
  const sig = sigPart ? fromBase64(sigPart) : null;
  if (!sig) return false;
  // `verify`, not sign-and-compare: the platform's comparison is the constant-time one.
  return crypto.subtle.verify('HMAC', await hmacKey(record), sig, encoder.encode(`${roomId}.${gen}.${expiresAt}`));
}
