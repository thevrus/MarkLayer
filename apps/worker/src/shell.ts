import type { Env } from './env';

/**
 * The shell names this build's hashed chunks and a deploy deletes the last build's, so a
 * cached shell 404s on its lazy imports. Vite suggests `no-cache`, but history navigation may show
 * a cached copy unrevalidated, and restored tabs kept opening pre-deploy builds; `no-store` leaves none.
 */
export const SHELL_CACHE = 'no-store';

/** A page shell from the asset layer. The one way to serve one, so no route inherits the asset's caching. */
export async function shellResponse({
  env,
  url,
  path = '/',
}: {
  env: Pick<Env['Bindings'], 'ASSETS'>;
  url: string | URL;
  path?: string;
}): Promise<Response> {
  const asset = await env.ASSETS.fetch(new Request(new URL(path, url)));
  const shell = new Response(asset.body, asset);
  shell.headers.set('Cache-Control', SHELL_CACHE);
  return shell;
}
