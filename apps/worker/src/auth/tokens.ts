import { sha256Hex, toBase64Url } from '../http';

/** Entropy behind every emailed link and session cookie. */
const TOKEN_BYTES = 32;

/**
 * A URL- and cookie-safe secret. base64url rather than hex keeps the emailed
 * link short enough that a plain-text mail client will not wrap it mid-token.
 */
export function mintToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/**
 * Only the digest is ever stored. Rows are looked up *by* this value, so the
 * secret comparison happens inside SQLite's index rather than in our code —
 * which is also why there is no constant-time compare here to get wrong.
 */
export async function hashToken(token: string): Promise<string> {
  return sha256Hex(token);
}
