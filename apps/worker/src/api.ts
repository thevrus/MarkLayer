import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { drawOpSchema, MAX_INTEGRATIONS_PER_ROOM, opsArraySchema } from '@marklayer/types';
import { cors } from 'hono/cors';
import { dayCached, once } from './http';
import type { Env } from './index';
import {
  deliverOne,
  hasAllSecrets,
  parseIntegrations,
  publicConfig,
  validateIntegration,
  withSecrets,
} from './integrations/deliver';
import { providerById, providerList } from './integrations/providers';
import { notifiableFrom } from './integrations/types';
import { captureServer } from './posthog';
import { annotationStore, isExpired, projectStore } from './store';

const api = new OpenAPIHono<Env>();
api.use('*', cors());

// Static routes are registered before the `/{id}` param routes so the parent
// router (hono/tiny PatternRouter, which matches in registration order) doesn't
// swallow `/health` or `/openapi.json` as an annotation id.
api.get('/health', (c) => c.json({ status: 'ok' }));

// The OpenAPI document is generated from the route definitions below on first
// request and memoized, keeping the spec build off every isolate's cold-start
// path. By request time all routes are registered. Anonymous by design — the
// id you POST to IS the access token, so there is no auth scheme to document.
const openApiJson = once(() =>
  JSON.stringify(
    api.getOpenAPI31Document({
      openapi: '3.1.0',
      info: {
        title: 'MarkLayer Share API',
        version: '1.0.0',
        description:
          'Anonymous, no-auth API for creating and reading MarkLayer annotation share links. Pick an unguessable id (nanoid/uuid) — the id is the access token. Share links open at https://marklayer.app/s/{id} (or /p/{id} for project bundles).',
        license: { name: 'MIT', url: 'https://github.com/thevrus/MarkLayer/blob/main/LICENSE' },
      },
      servers: [{ url: 'https://marklayer.app/api' }],
    }),
  ),
);
api.get('/openapi.json', (c) =>
  c.body(openApiJson(), 200, dayCached('application/vnd.oai.openapi+json;version=3.1.0')),
);

// ---------- Shared schemas ----------

const ErrorResponse = z.object({ error: z.string() }).openapi('Error');
const OkResponse = z.object({ ok: z.boolean() }).openapi('Ok');

// A JSON response entry for a route's `responses` map — collapses the repeated
// `{ description, content: { 'application/json': { schema } } }` shape.
const jsonRes = <S extends z.ZodType>(schema: S, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});

// Seconds-from-now → absolute unix expiry, or null when unset / non-positive.
function expiresAtFrom(expiresIn: number | undefined): number | null {
  return typeof expiresIn === 'number' && expiresIn > 0 ? Math.floor(Date.now() / 1000) + expiresIn : null;
}

const IdParam = z.object({
  id: z
    .string()
    .openapi({ description: 'Unguessable share id (nanoid/uuid) — it is the access token', example: 'aB3xY7kZ' }),
});

// A static path under the same router as `/{id}`, so it is registered above the
// annotation routes for the same reason `/health` is: hono/tiny matches in
// registration order and would otherwise read "providers" as an annotation id.
const ProviderInfo = z
  .object({
    id: z.string(),
    label: z.string(),
    blurb: z.string(),
    trigger: z
      .enum(['auto', 'manual'])
      .openapi({ description: "'auto' posts every batch; 'manual' only files when someone asks it to" }),
    fields: z.array(
      z.object({
        name: z.string(),
        label: z.string(),
        // An enum, not a string: `secret` is the value that decides whether a
        // token may be stored, and a client filtering on a free-form string
        // would keep compiling after a rename here.
        type: z.enum(['url', 'text', 'secret']),
        placeholder: z.string().optional(),
        help: z.string().optional(),
        helpUrl: z.string().optional(),
      }),
    ),
  })
  .openapi('Provider');

const listProviders = createRoute({
  method: 'get',
  path: '/providers',
  summary: 'Destinations a room can post to',
  description:
    'The provider catalogue, as data. Clients render a generic form from the field descriptors rather than shipping a component per provider.',
  responses: { 200: jsonRes(z.object({ providers: z.array(ProviderInfo) }), 'Provider catalogue') },
});

api.openapi(listProviders, (c) =>
  c.json(
    {
      providers: providerList.map((p) => ({
        id: p.id,
        label: p.label,
        blurb: p.blurb,
        trigger: p.trigger,
        fields: p.fields,
      })),
    },
    200,
  ),
);

// ---------- Annotations ----------

// Accepts `{ ops, url?, width?, expires_in? }` or a raw ops array (backwards compat).
const StoreAnnotationBody = z
  .union([
    z.array(z.unknown()),
    z.object({
      ops: z.array(z.unknown()).openapi({ description: 'Annotation operations ([] for a blank canvas)' }),
      url: z
        .string()
        .optional()
        .openapi({ format: 'uri', description: 'Page the share link overlays annotations onto' }),
      width: z.int().optional().openapi({ description: 'Reference viewport width in CSS pixels (e.g. 1440)' }),
      expires_in: z.int().optional().openapi({ description: 'Seconds until cleanup (max 2592000 = 30 days)' }),
    }),
  ])
  .openapi('StoreAnnotation');

// Shared between the single-annotation response and each project page below.
const annotationShape = {
  ops: z.array(z.unknown()),
  url: z.string().nullable(),
  width: z.number().nullable(),
};

const AnnotationResponse = z.object(annotationShape).openapi('Annotation');

/**
 * Which surface published this payload, from the CORS `Origin` header.
 *
 * A content-script fetch carries the *annotated page's* origin, not the extension's
 * (chromium.org/Home/chromium-security/extension-content-script-fetches), so
 * same-origin vs cross-origin is the only split available, which is exactly the
 * web-app vs extension split. No Origin at all is a non-browser caller: curl, a
 * script, or an agent using the public API.
 *
 * The header names a page we have no business recording, so it never leaves this
 * function; only the enum does. See posthog.ts for the wider contract.
 */
function surfaceFrom({
  origin,
  host,
}: {
  origin: string | undefined;
  host: string | undefined;
}): 'web' | 'extension' | 'api' {
  if (!origin) return 'api';
  try {
    return new URL(origin).host === host ? 'web' : 'extension';
  } catch {
    return 'api'; // opaque origin ("null") or a malformed header
  }
}

const storeAnnotation = createRoute({
  method: 'post',
  path: '/{id}',
  summary: 'Create or replace a share link',
  request: {
    params: IdParam,
    body: { required: true, content: { 'application/json': { schema: StoreAnnotationBody } } },
  },
  responses: {
    200: jsonRes(OkResponse, 'Stored'),
    400: jsonRes(ErrorResponse, 'Invalid operations data'),
  },
});

api.openapi(storeAnnotation, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  let ops: unknown;
  let expiresAt: number | null = null;
  let url: string | null = null;
  let width: number | null = null;
  if (Array.isArray(body)) {
    ops = body;
  } else {
    ops = body.ops;
    expiresAt = expiresAtFrom(body.expires_in);
    if (body.url) url = body.url;
    if (body.width && body.width > 0) width = body.width;
  }

  const result = opsArraySchema.safeParse(ops);
  if (!result.success) {
    return c.json({ error: 'Invalid operations data' }, 400);
  }

  await annotationStore(c.env.DB).put({ id, ops: result.data, url, width, expiresAt });

  // The web app autosaves a bare ops array every few seconds (useRealtimeSync);
  // the extension and API callers send the object form only when someone
  // deliberately publishes. `explicit` separates the two so real publishes are
  // countable instead of being drowned by autosave traffic.
  captureServer(c.env, c.executionCtx, 'share_link_saved', {
    surface: surfaceFrom({ origin: c.req.header('origin'), host: c.req.header('host') }),
    explicit: !Array.isArray(body),
    ops_count: result.data.length,
  });

  return c.json({ ok: true }, 200);
});

const getAnnotation = createRoute({
  method: 'get',
  path: '/{id}',
  summary: 'Retrieve a share link',
  request: { params: IdParam },
  responses: {
    200: jsonRes(AnnotationResponse, 'Annotation payload'),
    404: jsonRes(ErrorResponse, 'Not found'),
    410: jsonRes(ErrorResponse, 'Expired'),
  },
});

api.openapi(getAnnotation, async (c) => {
  const { id } = c.req.valid('param');
  const store = annotationStore(c.env.DB);
  const row = await store.get(id);

  if (!row) return c.json({ error: 'not found' }, 404);

  if (isExpired(row.expiresAt)) {
    c.executionCtx.waitUntil(store.remove(id));
    return c.json({ error: 'expired' }, 410);
  }

  c.executionCtx.waitUntil(store.touch(id));
  return c.json({ ops: row.ops, url: row.url, width: row.width }, 200);
});

// ---------- Integrations ----------

/** What a client may see: which destinations exist, never their configuration. */
const IntegrationSummary = z
  .object({ provider: z.string(), hint: z.string().nullable() })
  .openapi('IntegrationSummary');

const IntegrationsResponse = z.object({ integrations: z.array(IntegrationSummary) }).openapi('Integrations');

/**
 * Enough to tell two destinations apart, and never enough to rebuild either.
 *
 * Which half of a config is safe to echo is the provider's call, so this reads
 * the manifest rather than guessing at key names: a `text` field is an address
 * (`owner/repo`, a project key) and shows whole, a `url` carries its credential
 * in the path and shows only its tail, and a `secret` is never shown at all.
 */
function summarizeIntegration(i: { provider: string; config: Record<string, unknown> }) {
  const fields = providerById(i.provider)?.fields ?? [];
  const value = (name: string) => (typeof i.config[name] === 'string' ? i.config[name] : '');

  const named = fields.find((f) => f.type === 'text' && value(f.name).trim());
  if (named) return { provider: i.provider, hint: value(named.name).slice(0, 40) };

  // The field the manifest declares, not a key name this function assumes.
  const urlField = fields.find((f) => f.type === 'url');
  const tail = (urlField ? value(urlField.name) : '').split(/[/?#]/).filter(Boolean).pop() ?? '';
  return { provider: i.provider, hint: tail ? `…${tail.slice(-4)}` : null };
}

const getIntegrations = createRoute({
  method: 'get',
  path: '/{id}/integrations',
  summary: "A room's destinations",
  description:
    'Reports which destinations are configured, never their configuration: the room id is its own access token, so returning a webhook URL would hand out a credential.',
  request: { params: IdParam },
  responses: {
    200: jsonRes(IntegrationsResponse, 'Configured destinations'),
    404: jsonRes(ErrorResponse, 'Not found'),
  },
});

api.openapi(getIntegrations, async (c) => {
  const { id } = c.req.valid('param');
  const row = await annotationStore(c.env.DB).getIntegrations(id);
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ integrations: parseIntegrations(row.integrations).map(summarizeIntegration) }, 200);
});

/**
 * The request shape, declared with the OpenAPI `z` rather than the zod/mini
 * `integrationSchema` in packages/types: the two are different builders and only
 * this one carries `.openapi()`. An unknown provider is caught a line later by
 * `validateIntegration`, so the loose string here costs nothing.
 */
const AddIntegrationBody = z
  .object({ provider: z.string(), config: z.record(z.string(), z.unknown()) })
  .openapi('AddIntegration');

/**
 * Add or replace one destination.
 *
 * Additive rather than a whole-list PUT on purpose: a client is never sent a
 * stored config, so it cannot send one back, and a replace-the-list API would
 * mean either round-tripping credentials or blanking the ones it did not know.
 * One destination per provider, which is also what the panel shows.
 */
const addIntegration = createRoute({
  method: 'post',
  path: '/{id}/integrations',
  summary: 'Add a destination to a room',
  request: {
    params: IdParam,
    body: {
      required: true,
      content: { 'application/json': { schema: AddIntegrationBody } },
    },
  },
  responses: {
    200: jsonRes(IntegrationsResponse, 'Stored'),
    400: jsonRes(ErrorResponse, 'Destination rejected'),
    404: jsonRes(ErrorResponse, 'Not found'),
  },
});

api.openapi(addIntegration, async (c) => {
  const { id } = c.req.valid('param');
  const incoming = c.req.valid('json');

  // Refuse where somebody can see it, rather than silently never delivering.
  // This is also where the host guard runs, so a bad URL never reaches storage.
  const verdict = validateIntegration(incoming);
  if (!verdict.ok) return c.json({ error: `${incoming.provider}: ${verdict.reason}` }, 400);

  const store = annotationStore(c.env.DB);
  const row = await store.getIntegrations(id);
  if (!row) return c.json({ error: 'not found' }, 404);

  const existing = parseIntegrations(row.integrations).filter((i) => i.provider !== incoming.provider);
  if (existing.length + 1 > MAX_INTEGRATIONS_PER_ROOM) {
    return c.json({ error: `at most ${MAX_INTEGRATIONS_PER_ROOM} destinations per room` }, 400);
  }
  // The secret half is dropped here and never written, with no branch that can
  // write the raw config: `validateIntegration` already resolved the provider,
  // so there is no miss to fall back from. A room stores where to file, never
  // what authorises it — see docs/adr/0004.
  const stored = { ...incoming, config: publicConfig({ provider: verdict.provider, config: incoming.config }) };
  const next = [...existing, stored];
  await store.setIntegrations({ id, json: JSON.stringify(next) });
  return c.json({ integrations: next.map(summarizeIntegration) }, 200);
});

const removeIntegration = createRoute({
  method: 'delete',
  path: '/{id}/integrations/{provider}',
  summary: 'Remove a destination from a room',
  request: { params: IdParam.extend({ provider: z.string() }) },
  responses: {
    200: jsonRes(IntegrationsResponse, 'Removed'),
    404: jsonRes(ErrorResponse, 'Not found'),
  },
});

api.openapi(removeIntegration, async (c) => {
  const { id, provider } = c.req.valid('param');
  const store = annotationStore(c.env.DB);
  const row = await store.getIntegrations(id);
  if (!row) return c.json({ error: 'not found' }, 404);

  const next = parseIntegrations(row.integrations).filter((i) => i.provider !== provider);
  await store.setIntegrations({ id, json: next.length > 0 ? JSON.stringify(next) : null });
  return c.json({ integrations: next.map(summarizeIntegration) }, 200);
});

// ---------- Filing one annotation ----------

const PushBody = z
  .object({
    provider: z.string().openapi({ description: 'A configured destination whose trigger is manual' }),
    secrets: z.record(z.string(), z.string()).optional().openapi({
      description:
        'The credential fields for this destination, supplied per request. They are used for this one call and never stored — see docs/adr/0004.',
    }),
  })
  .openapi('PushAnnotation');

const PushResponse = z
  .object({
    url: z.string().nullable().openapi({ description: 'The created issue, where the destination returns one' }),
  })
  .openapi('PushResult');

/**
 * File one annotation at one destination, now, because somebody asked.
 *
 * The counterpart to the automatic delivery the room does on its own: chat
 * destinations post every batch unasked, and an issue tracker never does. An
 * issue per comment is the behaviour that gets an integration switched off, so
 * a tracker only ever fires through this route, one annotation at a time.
 *
 * Anonymous like the rest of the API: the room id is the access token, and
 * whoever holds it already configured the destination this files into.
 */
const pushAnnotation = createRoute({
  method: 'post',
  path: '/{id}/annotations/{opId}/push',
  summary: 'File one annotation at a destination',
  request: {
    params: IdParam.extend({ opId: z.string().openapi({ description: 'Id of the annotation op to file' }) }),
    body: { required: true, content: { 'application/json': { schema: PushBody } } },
  },
  responses: {
    200: jsonRes(PushResponse, 'Filed'),
    400: jsonRes(ErrorResponse, 'Could not be filed'),
    404: jsonRes(ErrorResponse, 'Not found'),
    410: jsonRes(ErrorResponse, 'Expired'),
  },
});

api.openapi(pushAnnotation, async (c) => {
  const { id, opId } = c.req.valid('param');
  const { provider: providerId, secrets } = c.req.valid('json');

  // Resolved before any I/O, because it reads nothing but the static manifest:
  // a bogus provider id should not cost a room read and an ops parse first.
  const provider = providerById(providerId);
  if (!provider) return c.json({ error: 'unknown provider' }, 400);
  if (provider.trigger !== 'manual') {
    return c.json({ error: `${provider.label} posts automatically and cannot be filed to` }, 400);
  }

  // Two reads rather than widening `get`: its shape is what GET /{id} answers
  // with, and a stored credential must never become reachable by a handler
  // spreading a row it assumed was safe. They are independent, so they overlap.
  const store = annotationStore(c.env.DB);
  const [row, destinations] = await Promise.all([store.get(id), store.getIntegrations(id)]);
  if (!row) return c.json({ error: 'not found' }, 404);
  if (isExpired(row.expiresAt)) {
    c.executionCtx.waitUntil(store.remove(id));
    return c.json({ error: 'expired' }, 410);
  }

  const integration = parseIntegrations(destinations?.integrations ?? null).find((i) => i.provider === providerId);
  if (!integration) return c.json({ error: `${provider.label} is not connected to this room` }, 400);

  // The one moment a complete config exists: the room's half, plus the token
  // the person filing just sent. It lives for this request and is not written
  // anywhere, which is what makes a leaked share link not a leaked credential.
  const config = withSecrets({ provider, config: integration.config, secrets: secrets ?? {} });
  if (!hasAllSecrets({ provider, config })) {
    return c.json({ error: `${provider.label} needs a token to file with` }, 400);
  }

  // Find first, then validate the one: parsing the whole room to reach a single
  // op means running the op union over every freehand point array in it.
  const raw = row.ops.find((o) => typeof o === 'object' && o !== null && 'id' in o && o.id === opId);
  const parsed = raw === undefined ? undefined : drawOpSchema.safeParse(raw);
  const op = parsed?.success ? parsed.data : undefined;
  // The room persists on a debounce, so an annotation typed a second ago is
  // real but not yet a row here. That is a wait, not a missing annotation, and
  // saying so is the difference between "try again" and "what did I break".
  if (!op) return c.json({ error: 'that annotation has not saved yet. Try again in a moment' }, 404);

  const item = notifiableFrom(op);
  if (!item) return c.json({ error: 'that annotation has no text to file' }, 400);

  const result = await deliverOne({
    integration: { ...integration, config },
    event: { type: 'annotation.pushed', items: [item] },
    roomUrl: `${new URL(c.req.url).origin}/s/${id}`,
    pageUrl: row.url,
  });

  if (!result.ok) return c.json({ error: result.reason }, 400);

  captureServer(c.env, c.executionCtx, 'annotation_filed', { provider: providerId });
  return c.json({ url: result.url }, 200);
});

// ---------- Projects (multi-page bundles) ----------

const MAX_PAGES_PER_PROJECT = 50;

const StoreProjectBody = z
  .object({
    pageIds: z.array(z.string()).openapi({ description: 'Ids of annotation pages in this bundle' }),
    expires_in: z.int().optional().openapi({ description: 'Seconds until cleanup (max 2592000 = 30 days)' }),
  })
  .openapi('StoreProject');

const ProjectPage = z.object({ id: z.string(), ...annotationShape }).openapi('ProjectPage');

const ProjectResponse = z
  .object({
    pageIds: z.array(z.string()),
    pages: z.array(ProjectPage),
    createdAt: z.number().nullable(),
    expiresAt: z.number().nullable(),
  })
  .openapi('Project');

const storeProject = createRoute({
  method: 'post',
  path: '/p/{id}',
  summary: 'Create or replace a project bundle (up to 50 pages)',
  request: {
    params: IdParam,
    body: { required: true, content: { 'application/json': { schema: StoreProjectBody } } },
  },
  responses: {
    200: jsonRes(OkResponse, 'Stored'),
    400: jsonRes(ErrorResponse, 'Invalid pageIds'),
  },
});

api.openapi(storeProject, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  const pageIds = body.pageIds.filter((x) => x.length > 0);
  if (!pageIds.length) return c.json({ error: 'pageIds must contain at least one id' }, 400);
  if (pageIds.length > MAX_PAGES_PER_PROJECT) {
    return c.json({ error: `Project exceeds ${MAX_PAGES_PER_PROJECT} pages` }, 400);
  }
  const expiresAt = expiresAtFrom(body.expires_in);
  await projectStore(c.env.DB).put({ id, pageIds, expiresAt });
  return c.json({ ok: true }, 200);
});

const getProject = createRoute({
  method: 'get',
  path: '/p/{id}',
  summary: 'Retrieve a project bundle with all of its pages',
  request: { params: IdParam },
  responses: {
    200: jsonRes(ProjectResponse, 'Project + pages'),
    404: jsonRes(ErrorResponse, 'Not found'),
    410: jsonRes(ErrorResponse, 'Expired'),
  },
});

api.openapi(getProject, async (c) => {
  const { id } = c.req.valid('param');
  const projects = projectStore(c.env.DB);
  const row = await projects.get(id);
  if (!row) return c.json({ error: 'not found' }, 404);
  if (isExpired(row.expiresAt)) {
    c.executionCtx.waitUntil(projects.remove(id));
    return c.json({ error: 'expired' }, 410);
  }
  c.executionCtx.waitUntil(projects.touch(id));
  const { pageIds, createdAt, expiresAt } = row;
  if (!pageIds.length) return c.json({ pageIds: [], pages: [], createdAt, expiresAt }, 200);
  const byId = await annotationStore(c.env.DB).getMany(pageIds);
  // Preserve original order; missing rows become empty placeholders
  const pages = pageIds.map((pid) => byId.get(pid) ?? { id: pid, ops: [], url: null, width: null });
  return c.json({ pageIds, pages, createdAt, expiresAt }, 200);
});

export { api };
