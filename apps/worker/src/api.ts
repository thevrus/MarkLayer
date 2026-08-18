import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { opsArraySchema } from '@marklayer/types';
import { cors } from 'hono/cors';
import { dayCached, once } from './http';
import type { Env } from './index';

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

  await c.env.DB.prepare(
    `INSERT INTO annotations (id, ops, url, width, expires_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET ops = excluded.ops, url = COALESCE(excluded.url, url), width = COALESCE(excluded.width, width), expires_at = excluded.expires_at`,
  )
    .bind(id, JSON.stringify(result.data), url, width, expiresAt)
    .run();

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
  const row = await c.env.DB.prepare('SELECT ops, url, width, expires_at FROM annotations WHERE id = ?')
    .bind(id)
    .first<{ ops: string; url: string | null; width: number | null; expires_at: number | null }>();

  if (!row) return c.json({ error: 'not found' }, 404);

  // Check expiration
  if (row.expires_at && Math.floor(Date.now() / 1000) > row.expires_at) {
    c.executionCtx.waitUntil(c.env.DB.prepare('DELETE FROM annotations WHERE id = ?').bind(id).run());
    return c.json({ error: 'expired' }, 410);
  }

  // Touch last_accessed_at (fire-and-forget)
  c.executionCtx.waitUntil(
    c.env.DB.prepare('UPDATE annotations SET last_accessed_at = unixepoch() WHERE id = ?').bind(id).run(),
  );
  return c.json({ ops: JSON.parse(row.ops), url: row.url, width: row.width }, 200);
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
  await c.env.DB.prepare(
    `INSERT INTO projects (id, page_ids, expires_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET page_ids = excluded.page_ids, expires_at = excluded.expires_at, last_accessed_at = unixepoch()`,
  )
    .bind(id, JSON.stringify(pageIds), expiresAt)
    .run();
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
  const row = await c.env.DB.prepare('SELECT page_ids, created_at, expires_at FROM projects WHERE id = ?')
    .bind(id)
    .first<{ page_ids: string; created_at: number | null; expires_at: number | null }>();
  if (!row) return c.json({ error: 'not found' }, 404);
  if (row.expires_at && Math.floor(Date.now() / 1000) > row.expires_at) {
    c.executionCtx.waitUntil(c.env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id).run());
    return c.json({ error: 'expired' }, 410);
  }
  c.executionCtx.waitUntil(
    c.env.DB.prepare('UPDATE projects SET last_accessed_at = unixepoch() WHERE id = ?').bind(id).run(),
  );
  let pageIds: string[] = [];
  try {
    const parsed = JSON.parse(row.page_ids);
    if (Array.isArray(parsed)) pageIds = parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    /* corrupt row → empty list */
  }
  if (!pageIds.length) {
    return c.json({ pageIds: [], pages: [], createdAt: row.created_at, expiresAt: row.expires_at }, 200);
  }
  const placeholders = pageIds.map(() => '?').join(',');
  const pageRows = await c.env.DB.prepare(`SELECT id, ops, url, width FROM annotations WHERE id IN (${placeholders})`)
    .bind(...pageIds)
    .all<{ id: string; ops: string; url: string | null; width: number | null }>();
  const byId = new Map<string, { id: string; ops: unknown[]; url: string | null; width: number | null }>();
  for (const r of pageRows.results) {
    let parsedOps: unknown[] = [];
    try {
      const v = JSON.parse(r.ops);
      if (Array.isArray(v)) parsedOps = v;
    } catch {
      /* */
    }
    byId.set(r.id, { id: r.id, ops: parsedOps, url: r.url, width: r.width });
  }
  // Preserve original order; missing rows become empty placeholders
  const pages = pageIds.map((pid) => byId.get(pid) ?? { id: pid, ops: [], url: null, width: null });
  return c.json({ pageIds, pages, createdAt: row.created_at, expiresAt: row.expires_at }, 200);
});

export { api };
