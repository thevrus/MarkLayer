import { escapeHtml, HTML_HEADERS, page } from '../html';
import { type LockRefusal, REFUSALS, type RoomRefusal } from './refusals';

/** Where a successful unlock may send the browser: a room or a project on this origin, nothing else. */
const RETURN_PATH = /^\/(s|p)\/[A-Za-z0-9_-]+$/;

export function safeReturnPath({ value, roomId }: { value: unknown; roomId: string }): string {
  return typeof value === 'string' && RETURN_PATH.test(value) ? value : `/s/${roomId}`;
}

/**
 * Served in place of the viewer for a protected room. Plain HTML, no app shell:
 * the shell's OG tags name the annotated site, and a crawler must not get those.
 */
export function unlockPage({
  roomId,
  returnTo,
  reason,
}: {
  roomId: string;
  returnTo: string;
  reason: LockRefusal;
}): Response {
  const { status, title, prompt } = REFUSALS[reason];
  const body = `<h1>${title}</h1>
<p>Enter the password the owner shared with you.</p>
${prompt ? `<p class="alert" role="alert">${prompt}</p>` : ''}
<form class="stack" method="post" action="/s/${encodeURIComponent(roomId)}/unlock">
<input type="hidden" name="return" value="${escapeHtml(returnTo)}">
<input type="password" name="password" aria-label="Password" placeholder="Password" autocomplete="current-password" required autofocus>
<button type="submit">Open</button>
</form>
<small>If you own this link, sign in to open it without a password.</small>`;
  return new Response(page({ title: 'Password required · visual collaboration', body }), {
    status,
    headers: HTML_HEADERS,
  });
}

/** A dead end: the room is gone or past its deadline. Says nothing about what was in it. */
export function gonePage(reason: Exclude<RoomRefusal, LockRefusal>): Response {
  const { status, title } = REFUSALS[reason];
  const body = `<h1>${title}</h1>
<p>Whoever sent it can share a new one from visual collaboration.</p>
<p><a class="btn" href="/">Open visual collaboration</a></p>`;
  return new Response(page({ title: `${title} · visual collaboration`, body }), { status, headers: HTML_HEADERS });
}
