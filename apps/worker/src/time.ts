/** Seconds since the epoch, the unit every timestamp column uses. */
export function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function isExpired(expiresAt: number | null): boolean {
  return expiresAt !== null && nowInSeconds() > expiresAt;
}
