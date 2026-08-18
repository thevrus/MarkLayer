import type { MiddlewareHandler } from 'astro';
import { WORKER_DEV } from './lib/site';

/**
 * Dev-only fall-through to the Worker.
 *
 * In production the Worker owns everything this site does not prerender: `/s/:id`
 * and `/p/:id` (share links), `/api/*`, `/ws/*`, `/og/*` and the `proxy.all('*')`
 * catch-all. Unmatched asset requests fall through to it because
 * `not_found_handling` is `"none"`.
 *
 * `astro dev` has no such fall-through, so a share link opened here rendered the
 * marketing 404 instead of the app. Mirror production: anything this site does
 * not own goes to the Worker's dev server.
 *
 * The real 404 page still works — it is only bypassed while `import.meta.env.DEV`
 * is true, and only for paths Astro has no route for.
 */
export const onRequest: MiddlewareHandler = async (context, next) => {
  const response = await next();

  if (import.meta.env.DEV && response.status === 404) {
    const target = new URL(context.url.pathname + context.url.search, WORKER_DEV);
    return new Response(null, { status: 302, headers: { Location: target.href } });
  }

  return response;
};
