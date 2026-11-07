/** The host a stored page URL names, or null for none or for one that does not parse. */
export function hostnameOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
