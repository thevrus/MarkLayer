import { parseFetchableUrl } from '@marklayer/types/net';
import type { HonoRequest } from 'hono';
import { Hono } from 'hono/tiny';
import { PROXY_ERRORS } from '../../shared/proxy-errors';
import type { Env } from '../env';
import { captureBlockedSite, captureServer } from '../posthog';
import { overRateLimit } from '../rate-limit';
import { isRefusedSubResource } from './challenge';
import { fetchPage, upstreamRequest } from './fetch';
import { injectedHead } from './inject';
import { parsePxPath, pxTarget } from './px-path';
import { isolateBreaker, type RelayBreaker, relayConfig, relaySubResource } from './relay';
import { pageRewriter, rewriteCssUrls } from './rewrite';

/** The shared gate's failure reasons, in the proxy's own error vocabulary. */
const URL_ERRORS = {
  invalid: PROXY_ERRORS.invalidUrl,
  scheme: PROXY_ERRORS.badScheme,
  blocked: PROXY_ERRORS.blockedHost,
} as const;

/**
 * A document `/doc` can render and the viewer can annotate: a PDF, or a raster
 * image. SVG is excluded — it is markup with script in it, and the viewer would
 * be pointing an `<img>` at bytes we'd rather never serve as a document at all.
 * Deliberately broader than `UPLOAD_FORMATS`: this asks whether the *browser* can
 * draw the bytes, not whether we would store them — a remote BMP or TIFF renders
 * fine here even though it is not an accepted upload.
 */
function isViewableDocument(contentType: string): boolean {
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (type === 'application/pdf') return true;
  return type.startsWith('image/') && type !== 'image/svg+xml';
}

/** The parts of a page's own sub-request worth passing on to its host. */
function forwarded(req: HonoRequest): { method: string; accept?: string; body?: ReadableStream | null } {
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return { method: req.method, accept: req.header('Accept') || undefined, body: hasBody ? req.raw.body : undefined };
}

export function proxyRoutes({ breaker }: { breaker: RelayBreaker }) {
  const app = new Hono<Env>();

  app.get('/proxy', async (c) => {
    const url = c.req.query('url');
    if (!url) return c.text(PROXY_ERRORS.missingUrl.message, 400);

    const gate = parseFetchableUrl(url, { self: c.req.url });
    if (!gate.ok) {
      if (gate.reason === 'self') return c.redirect('/#error=self');
      const { message, label } = URL_ERRORS[gate.reason];
      // Only a blocked host is worth a metric: the other two are a malformed paste.
      if (gate.reason === 'blocked') captureServer(c.env, c.executionCtx, 'proxy_render_failed', { reason: label });
      return c.text(message, 400);
    }

    const reqUrl = new URL(c.req.url);
    if (await overRateLimit({ limiter: c.env.FETCH_LIMITER, req: c.req }))
      return c.text(PROXY_ERRORS.tooManyRequests.message, 429);

    const fetchStart = Date.now();
    try {
      const resp = await fetchPage({ url, env: c.env, breaker });

      // Every fetch outcome in one event: the denominator the failure rates never
      // had, the relay's rescue rate (`via: 'relay'` means the direct fetch was
      // challenged and the relay answered), and the upstream error rate — which
      // used to be a second event carrying the same four properties.
      captureServer(c.env, c.executionCtx, 'proxy_page_fetched', {
        via: resp.via,
        challenged: resp.challenged,
        status: resp.status,
        html: resp.contentType.includes('text/html'),
        relay_configured: Boolean(relayConfig(c.env)),
        duration_ms: Date.now() - fetchStart,
      });

      // The same refusal the viewer is about to see, filed as an Error Tracking
      // issue keyed on the site — so "which sites turn us away" is a triageable
      // list rather than a breakdown someone has to remember to run.
      if (resp.challenged || resp.status >= 400) {
        captureBlockedSite(c.env, c.executionCtx, {
          kind: resp.challenged ? 'firewall-challenge' : 'http-error',
          url,
          status: resp.status,
          via: resp.via,
        });
      }

      if (!resp.contentType.includes('text/html')) {
        // ?raw=1 must always fall through to the plain pass-through below, whatever the content type.
        if (reqUrl.searchParams.get('raw') !== '1' && isViewableDocument(resp.contentType)) {
          // Body is never read here — the viewer fetches the bytes itself via the redirect below.
          void resp.stream?.cancel();
          // Redirect rather than inline a shell, so Vite owns the viewer's script tag
          // and its content hash. `/doc`, not `/doc.html`: the asset layer redirects
          // the extension away anyway, and this skips that second hop. It carries the
          // target url, not the ?raw=1 proxy url, so the page can only ever be
          // pointed at this origin's own proxy.
          return c.redirect(`/doc?url=${encodeURIComponent(url)}`, 302);
        }

        const headers = new Headers();
        headers.set('Content-Type', resp.contentType);
        headers.set('Access-Control-Allow-Origin', '*');
        // Whatever this turns out to be, it is a stranger's bytes on our origin. An
        // SVG or an XML document navigated to directly would otherwise run its own
        // script as this app; `sandbox` drops it into an opaque origin where it can
        // reach nothing of ours. Ignored when the bytes are loaded as an image or a
        // stylesheet, which is every use the viewer actually makes of this path.
        headers.set('Content-Security-Policy', 'sandbox');
        headers.set('X-Content-Type-Options', 'nosniff');
        return new Response(resp.stream, { headers });
      }

      const baseUrl = new URL(resp.finalUrl);
      const inject = injectedHead({ resp, baseUrl, selfOrigin: reqUrl.origin, env: c.env });
      const rewriter = pageRewriter({ baseUrl, selfOrigin: reqUrl.origin, inject });

      const headers = new Headers();
      headers.set('Content-Type', 'text/html; charset=utf-8');
      headers.set('Access-Control-Allow-Origin', '*');
      // Headers are built fresh, so the target's own CSP never reaches us to merge with. Only the app
      // frames a proxied page (viewer, compare, device overview, all same-origin); the posts above
      // name that origin, and this keeps another site from embedding the proxy as an open relay.
      headers.set('Content-Security-Policy', "frame-ancestors 'self'");

      if (resp.challenged) {
        captureServer(c.env, c.executionCtx, 'proxy_render_failed', {
          reason: 'firewall-challenge',
          via: resp.via,
          relay_configured: Boolean(relayConfig(c.env)),
          duration_ms: Date.now() - fetchStart,
        });
      }

      return rewriter.transform(new Response(resp.stream, { headers }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      captureServer(c.env, c.executionCtx, 'proxy_render_failed', {
        reason: PROXY_ERRORS.fetchThrew.label,
        message,
        duration_ms: Date.now() - fetchStart,
      });
      captureBlockedSite(c.env, c.executionCtx, { kind: 'fetch-threw', url, message });
      return c.text(PROXY_ERRORS.fetchThrew.message, 502);
    }
  });

  app.options('/px/*', (c) => {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': c.req.header('Access-Control-Request-Headers') || '*',
        'Access-Control-Max-Age': '86400',
      },
    });
  });

  app.all('/px/*', async (c) => {
    const { scheme, host, rest } = parsePxPath(c.req.path.slice('/px/'.length));
    if (!host) return c.text(PROXY_ERRORS.missingHost.message, 400);

    const reqUrl = new URL(c.req.url);
    const targetUrl = `${scheme}://${host}${rest}${reqUrl.search}`;
    const gate = parseFetchableUrl(targetUrl);
    if (!gate.ok) {
      const { message, label } = URL_ERRORS[gate.reason];
      if (gate.reason === 'blocked') captureServer(c.env, c.executionCtx, 'proxy_render_failed', { reason: label });
      return c.text(message, 400);
    }

    try {
      const direct = await upstreamRequest({
        url: targetUrl,
        ...forwarded(c.req),
        contentType: c.req.header('Content-Type'),
      });

      // A host that challenges the page challenges its stylesheets and images too,
      // so an unstyled skeleton is the failure mode without this. The relay only
      // speaks GET, which is every sub-resource a rendered page actually needs.
      let resp = direct;
      if (c.req.method === 'GET' && isRefusedSubResource({ resp: direct, accept: c.req.header('Accept') })) {
        const relayed = await relaySubResource({
          url: targetUrl,
          accept: c.req.header('Accept'),
          env: c.env,
          breaker,
          ctx: c.executionCtx,
          // Limited here rather than per /px request: a page load bursts hundreds of
          // assets, and a direct fetch spends nothing the Worker invocation has not.
          admit: async () => !(await overRateLimit({ limiter: c.env.RELAY_LIMITER, req: c.req })),
        });
        if (relayed) {
          void direct.body?.cancel(); // the direct body lost; do not hold its connection open
          resp = relayed;
        }
      }

      const headers = new Headers();
      const ct = resp.headers.get('content-type') || '';
      if (ct) headers.set('Content-Type', ct);
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Access-Control-Expose-Headers', '*');
      headers.set('Cache-Control', resp.headers.get('cache-control') || 'public, max-age=3600');

      if (ct.includes('text/css')) {
        const px = `${reqUrl.origin}/px/${pxTarget(gate.url)}`;
        return new Response(rewriteCssUrls({ css: await resp.text(), px }), { status: resp.status, headers });
      }

      return new Response(resp.body, { status: resp.status, headers });
    } catch {
      return c.text(PROXY_ERRORS.subProxy.message, 502);
    }
  });

  // Catch-all: proxy unknown requests to original domain when originating from a proxied page
  app.all('*', async (c) => {
    const referer = c.req.header('Referer') || '';
    const match = referer.match(/\/proxy\?url=([^&]+)/);
    if (!match) return c.env.ASSETS.fetch(c.req.raw);

    try {
      const gate = parseFetchableUrl(decodeURIComponent(match[1]));
      if (!gate.ok) return c.env.ASSETS.fetch(c.req.raw);
      const origin = gate.url.origin;
      const reqUrl = new URL(c.req.url);
      const target = `${origin}${reqUrl.pathname}${reqUrl.search}`;

      const resp = await upstreamRequest({ url: target, ...forwarded(c.req) });

      const headers = new Headers();
      const ct = resp.headers.get('content-type');
      if (ct) headers.set('Content-Type', ct);
      headers.set('Access-Control-Allow-Origin', '*');

      return new Response(resp.body, { status: resp.status, headers });
    } catch {
      return c.env.ASSETS.fetch(c.req.raw);
    }
  });

  return app;
}

export const proxy = proxyRoutes({ breaker: isolateBreaker });
