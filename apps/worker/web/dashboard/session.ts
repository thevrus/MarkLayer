import {
  errorResponseSchema,
  type OwnedLink,
  ownedLinksResponseSchema,
  type SessionUser,
  sessionResponseSchema,
} from '@marklayer/types';
import { signal } from '@preact/signals';

/**
 * Dashboard state, deliberately its own module.
 *
 * `web/signals.ts` runs `parseViewParam()` against `location.pathname` at module
 * load and installs effects that write to `history` — all of it viewer logic
 * that would fire on `/app` and mean nothing here. The dashboard shares the
 * stylesheet and nothing else.
 */
export const user = signal<SessionUser | null>(null);
export const sessionLoading = signal(true);
export const links = signal<OwnedLink[]>([]);
export const linksLoading = signal(false);

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

/**
 * Resolves the cookie on boot. A 401 is the signed-out answer, not a failure.
 *
 * Both requests go out together: `/auth/links` answers 401 harmlessly when
 * signed out, and awaiting it after the session would put a second round trip in
 * front of the page a magic link redirects into.
 */
export async function loadSession(): Promise<void> {
  sessionLoading.value = true;
  linksLoading.value = true;
  const [me, owned] = await Promise.all([fetch('/auth/me'), fetch('/auth/links')]);
  const session = sessionResponseSchema.safeParse(await readJson(me));
  user.value = session.success ? session.data.user : null;
  sessionLoading.value = false;
  const list = ownedLinksResponseSchema.safeParse(await readJson(owned));
  links.value = user.value && list.success ? list.data.links : [];
  linksLoading.value = false;
}

export async function loadLinks(): Promise<void> {
  linksLoading.value = true;
  const parsed = ownedLinksResponseSchema.safeParse(await readJson(await fetch('/auth/links')));
  links.value = parsed.success ? parsed.data.links : [];
  linksLoading.value = false;
}

/** Returns an error message, or null when the link is on its way. */
export async function requestSignIn(email: string): Promise<string | null> {
  const res = await fetch('/auth/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (res.ok) return null;
  const parsed = errorResponseSchema.safeParse(await readJson(res));
  return parsed.success ? parsed.data.error : 'Something went wrong. Try again.';
}

export async function signOut(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST' });
  user.value = null;
  links.value = [];
}

export async function claimLink(id: string): Promise<void> {
  await fetch(`/auth/links/${encodeURIComponent(id)}`, { method: 'POST' });
  await loadLinks();
}

export async function releaseLink(id: string): Promise<void> {
  // Optimistic: the row is gone from this list either way, and a failed release
  // resurfaces on the next load rather than blocking the click.
  links.value = links.value.filter((link) => link.id !== id);
  await fetch(`/auth/links/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
