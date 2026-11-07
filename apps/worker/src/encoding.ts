/**
 * `btoa` throws on any code point over 255, so the bytes become a binary string
 * first. One definition for the MIME encoder, integration basic-auth and tokens.
 */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  // Chunked: spreading a multi-MB voice note into `fromCharCode` at once overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** UTF-8 text as base64. */
export function base64Utf8(value: string): string {
  return toBase64(new TextEncoder().encode(value));
}

/** URL- and cookie-safe base64: no padding, no `+`, no `/`. */
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** Either base64 alphabet back to bytes; null on anything `atob` refuses. */
export function fromBase64(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** Lowercase hex SHA-256 of UTF-8 text. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
