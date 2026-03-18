/** Unicode-safe base64 helpers (handles non-ASCII URLs correctly) */
export function toBase64(str: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
}

export function fromBase64(b64: string): string {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
