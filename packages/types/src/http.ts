/**
 * Thin fetch helpers that kill the repeated `POST` boilerplate (headers,
 * `JSON.stringify`, a try/catch around a network call) duplicated across the
 * extension and web app. Deliberately not a request-lib dependency: every
 * caller here already validates response bodies with its own Zod schema
 * (or a plain `.ok` check), so there was nothing left for a lib to add.
 *
 * Both return `null` on a network failure so callers keep their existing
 * `res.ok` / `res.status` branching for HTTP-level failures (a 403 view-only
 * link, say) without a second error channel to check.
 */

export async function postJson(url: string, body: unknown): Promise<Response | null> {
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
}

/** POST a raw body (a `File`/`Blob` upload) with its own content type. */
export async function postBody(url: string, body: Blob, contentType: string): Promise<Response | null> {
  try {
    return await fetch(url, { method: 'POST', headers: { 'Content-Type': contentType }, body });
  } catch {
    return null;
  }
}
