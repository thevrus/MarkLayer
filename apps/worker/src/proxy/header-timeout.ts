/**
 * `fetch`, bounding the wait for response headers and nothing else.
 *
 * A plain `AbortSignal.timeout` on a proxy fetch is a trap: it keeps firing after
 * the response resolves, so any page that streams its HTML slowly gets its body
 * truncated mid-document and arrives without the marker — a page that renders
 * turned into a page that reports failure. Clearing the timer once the headers
 * land bounds a hanging host without ever touching the stream.
 */
export async function fetchWithHeaderTimeout({
  url,
  init,
  timeoutMs,
}: {
  url: string;
  init: RequestInit;
  timeoutMs: number;
}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
