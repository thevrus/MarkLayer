import { LOGIN_TOKEN_TTL_SECONDS } from '@marklayer/brand';
import { HTML_HEADERS, page } from '../html';

export { HTML_HEADERS, page };

/** A 32-byte base64url token, exactly as `mintToken` writes it; anything else never reaches the page. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function isTokenShaped(token: string | undefined): token is string {
  return token !== undefined && TOKEN_SHAPE.test(token);
}

/**
 * The link lands here instead of redeeming on GET: mail scanners (Safe Links,
 * Proofpoint, Mimecast) open every link in a message, and a GET that spent the
 * single-use token handed the session to the scanner and "expired" to the person.
 * Scanners follow links; they do not press buttons.
 */
export function confirmPage(token: string): Response {
  const body = `<h1>Sign in to MarkLayer</h1>
<p>Press continue to finish signing in on this device.</p>
<form method="post" action="/auth/verify"><input type="hidden" name="token" value="${token}"><button type="submit" autofocus>Continue</button></form>
<small>If you did not ask to sign in, close this page and nothing will happen.</small>`;
  return new Response(page({ title: 'Sign in · MarkLayer', body }), { status: 200, headers: HTML_HEADERS });
}

export function expiredPage(): Response {
  const body = `<h1>This link has expired</h1>
<p>Sign-in links work once and last ${LOGIN_TOKEN_TTL_SECONDS / 60} minutes. Ask for a new one and use the newest email.</p>
<a class="btn" href="/app">Get a new link</a>`;
  return new Response(page({ title: 'Link expired · MarkLayer', body }), { status: 400, headers: HTML_HEADERS });
}
