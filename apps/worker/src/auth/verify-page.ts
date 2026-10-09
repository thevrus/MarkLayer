/** A 32-byte base64url token, exactly as `mintToken` writes it; anything else never reaches the page. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function isTokenShaped(token: string | undefined): token is string {
  return token !== undefined && TOKEN_SHAPE.test(token);
}

const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  // The token sits in this page's URL; nothing it links to should learn it.
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex',
} as const;

// Same palette as the app shell and the sign-in email, so the page reads as the email's next step.
const STYLE = `
:root{--bg:#fff;--fg:#1a1a1a;--muted:#4d4d4d;--faint:#8f8f8f;--btn:#1a1a1a;--btn-hover:#333;--btn-fg:#fff;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#111110;--fg:#e8e5e0;--muted:#b5b1ab;--faint:#85827d;--btn:#e8e5e0;--btn-hover:#d4d0ca;--btn-fg:#111}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/24px Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:480px;margin:0 auto;padding:15vh 24px 40px}
.mark{margin:0 0 32px;color:var(--fg);font-size:15px;font-weight:600;letter-spacing:-0.045em}
h1{margin:0 0 12px;font-size:24px;line-height:32px;font-weight:600;letter-spacing:-0.02em}
p{margin:0 0 24px;color:var(--muted)}
button,.btn{display:inline-block;border:0;border-radius:8px;padding:12px 20px;background:var(--btn);color:var(--btn-fg);font-family:inherit;font-size:14px;line-height:20px;font-weight:500;text-decoration:none;cursor:pointer}
button:hover,.btn:hover{background:var(--btn-hover)}
button:focus-visible,.btn:focus-visible{outline:2px solid var(--fg);outline-offset:2px}
small{display:block;margin-top:32px;font-size:13px;line-height:20px;color:var(--faint)}
`;

function page({ title, body }: { title: string; body: string }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${STYLE}</style></head><body><main><p class="mark">MarkLayer</p>${body}</main></body></html>`;
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
  return new Response(page({ title: 'Sign in · MarkLayer', body }), { status: 200, headers: HEADERS });
}

export function expiredPage(): Response {
  const body = `<h1>This link has expired</h1>
<p>Sign-in links work once and last 15 minutes. Ask for a new one and use the newest email.</p>
<a class="btn" href="/app">Get a new link</a>`;
  return new Response(page({ title: 'Link expired · MarkLayer', body }), { status: 400, headers: HEADERS });
}
