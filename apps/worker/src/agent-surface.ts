import { MCP_SERVER_CARD } from '@marklayer/agent-tools';
import { ORIGIN, SECURITY_CONTACT } from '@marklayer/brand';
import LLMS_SOURCE from '@site/content/agent/llms.txt?raw';
import LLMS_FULL_SOURCE from '@site/content/agent/llms-full.txt?raw';
import ROBOTS_TXT from '@site/content/agent/robots.txt?raw';
import SKILL_MD from '@site/content/agent/SKILL.md?raw';
import { API_CATALOG, SKILL_PATH, skillIndex } from '@site/lib/agent';
import { Hono } from 'hono/tiny';
import { dayCached } from './cache';
import { sha256Hex } from './encoding';
import type { Env } from './env';
import { once } from './memo';
import { captureServer } from './posthog';
import { shellResponse } from './shell';

const app = new Hono<Env>();

// The agent-facing text surface. apps/site owns the source (it also prerenders
// these paths for its standalone deploy), but `run_worker_first` claims them
// here, so the Worker is what actually answers in production — reading the same
// files rather than restating them is the only thing keeping the two honest.
// The llms files come from apps/site's dist so its build-time `{{version}}` fill applies. The glob
// is empty until the site has been built once, and dev then falls back to the raw source.
const builtLlms = import.meta.glob<string>(['../../site/dist/llms.txt', '../../site/dist/llms-full.txt'], {
  query: '?raw',
  import: 'default',
  eager: true,
});
const LLMS_TXT = builtLlms['../../site/dist/llms.txt'] ?? LLMS_SOURCE;
const LLMS_FULL_TXT = builtLlms['../../site/dist/llms-full.txt'] ?? LLMS_FULL_SOURCE;

app.get('/robots.txt', (c) => c.body(ROBOTS_TXT, 200, dayCached('text/plain; charset=utf-8')));

app.get('/llms.txt', (c) => c.body(LLMS_TXT, 200, dayCached('text/plain; charset=utf-8')));

app.get('/llms-full.txt', (c) => c.body(LLMS_FULL_TXT, 200, dayCached('text/plain; charset=utf-8')));

// RFC 8288 Link headers pointing agents at machine-readable resources. Uses
// IANA-registered relation types: service-doc (human/agent docs), service-desc
// (fuller machine description), and sitemap. Surfaced on the homepage so an
// agent hitting `/` discovers them without parsing HTML.
const HOMEPAGE_LINK_HEADER = [
  '</.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
  '</llms.txt>; rel="service-doc"; type="text/markdown"',
  '</llms-full.txt>; rel="service-desc"; type="text/markdown"',
  '</sitemap.xml>; rel="sitemap"; type="application/xml"',
].join(', ');

app.get('/.well-known/api-catalog', (c) =>
  c.body(JSON.stringify(API_CATALOG), 200, dayCached('application/linkset+json')),
);

// RFC 9116 security.txt (Cloudflare Security Insights: "Security.txt not
// configured"). Gives researchers a clear vulnerability-disclosure channel.
// Expires is required and must be < 1 year out; computed lazily on first
// request (Date in module-global scope is unreliable on Workers) and memoized,
// landing ~1 year ahead and refreshing on every redeploy/isolate restart so it
// never goes stale.
const securityTxt = once(() => {
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  return `Contact: mailto:${SECURITY_CONTACT}
Expires: ${expires}
Preferred-Languages: en
Canonical: ${ORIGIN}/.well-known/security.txt
`;
});

app.get('/.well-known/security.txt', (c) => c.body(securityTxt(), 200, dayCached('text/plain; charset=utf-8')));

app.get(SKILL_PATH, (c) => c.body(SKILL_MD, 200, dayCached('text/markdown; charset=utf-8')));

// Built once per isolate and memoized: the digest is computed from the SKILL.md
// bytes this Worker actually serves, so it always matches — even if the skill
// text is edited — with no manual bookkeeping.
const skillIndexJson = once(async () => JSON.stringify(skillIndex(`sha256:${await sha256Hex(SKILL_MD)}`)));

app.get('/.well-known/agent-skills/index.json', async (c) =>
  c.body(await skillIndexJson(), 200, dayCached('application/json; charset=utf-8')),
);

app.get('/.well-known/mcp/server-card.json', (c) =>
  c.body(JSON.stringify(MCP_SERVER_CARD), 200, dayCached('application/json; charset=utf-8')),
);

// Rough token estimate (~4 chars/token) for the x-markdown-tokens hint agents
// use to budget context before fetching the markdown body.
const LLMS_TXT_TOKENS = String(Math.ceil(LLMS_TXT.length / 4));

// Homepage: serve agent-friendly Link headers, and a markdown representation
// when the client negotiates `Accept: text/markdown` (Markdown for Agents).
app.get('/', async (c) => {
  const accept = c.req.header('Accept') || '';
  if (accept.includes('text/markdown')) {
    return c.body(LLMS_TXT, 200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      Vary: 'Accept',
      Link: HOMEPAGE_LINK_HEADER,
      'x-markdown-tokens': LLMS_TXT_TOKENS,
    });
  }
  if (c.req.query('view')) captureServer(c.env, c.executionCtx, 'legacy_view_link', { route: '/' });
  const shell = await shellResponse({ env: c.env, url: c.req.url });
  shell.headers.set('Link', HOMEPAGE_LINK_HEADER);
  shell.headers.append('Vary', 'Accept');
  return shell;
});

export { app as agentSurface };
