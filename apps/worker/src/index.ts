import { HSTS } from '@marklayer/brand';
import type { Context } from 'hono';
import { Hono } from 'hono/tiny';
import { RELAY_PREFIX } from '../shared/posthog-relay-path';
import { agentSurface } from './agent-surface';
import { api } from './api';
import { auth } from './auth';
import { scheduled } from './cron';
import type { Env } from './env';
import { slackRoutes } from './integrations/slack-routes';
import { ogRoutes } from './og-routes';
import { relayToPosthog } from './posthog-relay';
import { proxy } from './proxy';
import { rooms } from './rooms';
import { sharePages } from './share-pages';
import { shellResponse } from './shell';
import { uploadRoutes } from './upload-routes';

export { AnnotationRoom } from './annotation-room';

const app = new Hono<Env>();

// HSTS (Cloudflare Security Insights: "Domains without HSTS"). TLS terminates
// at the Cloudflare edge, so the worker never sees plaintext requests — the
// HTTP→HTTPS redirect belongs at the zone level ("Always Use HTTPS"), not here.
// 2-year max-age with includeSubDomains + preload meets the hstspreload.org
// submission threshold.
app.use('*', async (c, next) => {
  await next();
  // Skip 101 WebSocket upgrades — their headers are locked. Header objects from
  // upstream fetches (proxy, assets) can be immutable, so rebuild on failure.
  if (c.res.status !== 101) {
    try {
      c.res.headers.set('Strict-Transport-Security', HSTS);
    } catch {
      const headers = new Headers(c.res.headers);
      headers.set('Strict-Transport-Security', HSTS);
      c.res = new Response(c.res.body, { status: c.res.status, statusText: c.res.statusText, headers });
    }
  }
});

app.route('/api', api);

app.route('/', sharePages);

app.route('/', ogRoutes);

app.route('/', rooms);

app.route('/', uploadRoutes);

app.all(`${RELAY_PREFIX}/*`, (c) => relayToPosthog({ req: c.req.raw, host: c.env.POSTHOG_HOST, ctx: c.executionCtx }));

app.route('/', agentSurface);

app.route('/auth', auth);

app.route('/integrations/slack', slackRoutes);

// The dashboard is its own bundle (app.html), so `/app` resolves from the asset
// layer — but `/app/links` does not, and an unmatched path falls through to the
// proxy catch-all, which would try to fetch it as a remote URL. Serve the same
// shell for every path under /app and let the client router read the rest.
// `/app`, not `/app.html`: the asset layer redirects the extension away.
const appShell = (c: Context<Env>) => shellResponse({ env: c.env, url: c.req.url, path: '/app' });
app.get('/app', appShell);
app.get('/app/*', appShell);

// Proxy + catch-all (must be last)
app.route('/', proxy);

export default { ...app, scheduled };
