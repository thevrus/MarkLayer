/** The plain pages the worker serves itself: sign-in confirmation, the unlock form, a refusal. */

export const HTML_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  // A sign-in token sits in that page's URL; nothing it links to should learn it.
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex',
} as const;

/** For text and attribute values in HTML; `escapeXml` in og-svg.ts is for SVG, which needs the quote forms too. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Same palette as the app shell and the sign-in email, so the page reads as the email's next step.
const STYLE = `
:root{--bg:#fff;--fg:#1a1a1a;--muted:#4d4d4d;--faint:#8f8f8f;--line:#d6d6d6;--btn:#1a1a1a;--btn-hover:#333;--btn-fg:#fff;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#111110;--fg:#e8e5e0;--muted:#b5b1ab;--faint:#85827d;--line:#3a3936;--btn:#e8e5e0;--btn-hover:#d4d0ca;--btn-fg:#111}}
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
form.stack{display:flex;gap:8px}
input{flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;padding:11px 12px;background:var(--bg);color:var(--fg);font-family:inherit;font-size:16px;line-height:20px}
input:focus-visible{outline:2px solid var(--fg);outline-offset:1px}
p.alert{color:var(--fg);font-weight:500}
`;

export function page({ title, body }: { title: string; body: string }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${STYLE}</style></head><body><main><p class="mark">MarkLayer</p>${body}</main></body></html>`;
}
