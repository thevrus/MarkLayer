const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

/**
 * One self-contained anchor, inline styles only, so it survives any CMS that
 * strips <style> and runs no script on the client's page. Near-black with a
 * mid-grey edge reads on both light and dark sites; no shadow, no hover state.
 */
export function feedbackButtonHtml({ url }: { url: string }): string {
  const box =
    'display:inline-flex;align-items:baseline;gap:8px;padding:9px 14px;border-radius:6px;' +
    'border:1px solid #52525b;background:#18181b;color:#fafafa;text-decoration:none;' +
    'font:500 14px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
  const credit = 'font-size:11px;font-weight:400;color:#a1a1aa';
  return (
    `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="${box}">` +
    `Leave feedback<span style="${credit}">via MarkLayer</span></a>`
  );
}

const PAREN = { '(': '%28', ')': '%29' } as const;

/** For READMEs and Notion, where inline HTML is stripped. Parens and spaces would end the link early. */
export function feedbackButtonMarkdown({ url }: { url: string }): string {
  const safe = url.replace(/[()\s]/g, (ch) => (ch === '(' || ch === ')' ? PAREN[ch] : encodeURIComponent(ch)));
  return `[Leave feedback](${safe}) · via [MarkLayer](${new URL(url).origin})`;
}
