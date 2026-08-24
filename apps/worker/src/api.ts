import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { opsArraySchema } from '@marklayer/types';
import { cors } from 'hono/cors';
import { dayCached, once } from './http';
import type { Env } from './index';
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
