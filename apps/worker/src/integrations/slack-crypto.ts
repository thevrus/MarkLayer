import { z } from 'zod/mini';
import { fromBase64, toBase64, toBase64Url } from '../encoding';

/** Slack's own replay window for a signed request. */
const MAX_SIGNATURE_AGE_SECONDS = 5 * 60;

const encoder = new TextEncoder();

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

const hmacKey = (secret: string, usage: KeyUsage) =>
  crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);

/**
 * Whether a request really came from Slack, per its v0 signing scheme.
 *
 * `subtle.verify` rather than comparing hex strings: it is constant-time, and it
 * is the one comparison available both in workerd and under `bun test`.
 */
export async function verifySlackSignature({
  signingSecret,
  timestamp,
  signature,
  body,
  now = Date.now(),
}: {
  signingSecret: string;
  timestamp: string | null;
  signature: string | null;
  body: string;
  now?: number;
}): Promise<boolean> {
  if (!timestamp || !signature?.startsWith('v0=') || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > MAX_SIGNATURE_AGE_SECONDS) return false;
  const given = fromHex(signature.slice(3));
  if (!given) return false;
  const key = await hmacKey(signingSecret, 'verify');
  return crypto.subtle.verify('HMAC', key, given, encoder.encode(`v0:${timestamp}:${body}`));
}

/** The header value Slack would send for this body; used by tests and nothing else in production. */
export async function signSlackBody({
  signingSecret,
  timestamp,
  body,
}: {
  signingSecret: string;
  timestamp: string;
  body: string;
}): Promise<string> {
  const key = await hmacKey(signingSecret, 'sign');
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`v0:${timestamp}:${body}`)));
  return `v0=${[...mac].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** How long an install may sit on Slack's consent screen before the state is refused. */
const STATE_TTL_SECONDS = 10 * 60;

const statePayload = z.object({ r: z.string(), u: z.nullable(z.string()), n: z.string(), e: z.number() });
export type InstallState = { roomId: string; userId: string | null; nonce: string };

/**
 * The OAuth `state`: room, installer and a nonce, HMAC'd under the client secret.
 * The nonce is also set as a cookie, so a state lifted from one browser cannot
 * complete an install in another.
 */
export async function signInstallState({
  secret,
  state,
  now = Date.now(),
}: {
  secret: string;
  state: InstallState;
  now?: number;
}): Promise<string> {
  const payload = toBase64Url(
    encoder.encode(
      JSON.stringify({
        r: state.roomId,
        u: state.userId,
        n: state.nonce,
        e: Math.floor(now / 1000) + STATE_TTL_SECONDS,
      }),
    ),
  );
  const key = await hmacKey(secret, 'sign');
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
  return `${payload}.${toBase64Url(mac)}`;
}

export async function verifyInstallState({
  secret,
  value,
  now = Date.now(),
}: {
  secret: string;
  value: string | null;
  now?: number;
}): Promise<InstallState | null> {
  const [payload, mac, extra] = (value ?? '').split('.');
  if (!payload || !mac || extra !== undefined) return null;
  const macBytes = fromBase64(mac);
  const payloadBytes = fromBase64(payload);
  if (!macBytes || !payloadBytes) return null;
  const key = await hmacKey(secret, 'verify');
  if (!(await crypto.subtle.verify('HMAC', key, macBytes, encoder.encode(payload)))) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  const parsed = statePayload.safeParse(raw);
  if (!parsed.success || parsed.data.e < now / 1000) return null;
  return { roomId: parsed.data.r, userId: parsed.data.u, nonce: parsed.data.n };
}

async function tokenKey(secret: string): Promise<CryptoKey | null> {
  const raw = fromBase64(secret);
  if (raw?.length !== 32) return null;
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** `base64(iv ‖ ciphertext)`, with the room id as associated data so a row cannot be moved to another room. */
export async function encryptToken({
  secret,
  token,
  roomId,
}: {
  secret: string;
  token: string;
  roomId: string;
}): Promise<string> {
  const key = await tokenKey(secret);
  if (!key) throw new Error('SLACK_TOKEN_KEY must be base64 of 32 bytes');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(roomId) },
    key,
    encoder.encode(token),
  );
  const out = new Uint8Array(iv.length + sealed.byteLength);
  out.set(iv);
  out.set(new Uint8Array(sealed), iv.length);
  return toBase64(out);
}

export async function decryptToken({
  secret,
  sealed,
  roomId,
}: {
  secret: string;
  sealed: string;
  roomId: string;
}): Promise<string | null> {
  const key = await tokenKey(secret);
  const bytes = fromBase64(sealed);
  if (!key || !bytes || bytes.length < 13) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: encoder.encode(roomId) },
      key,
      bytes.slice(12),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
