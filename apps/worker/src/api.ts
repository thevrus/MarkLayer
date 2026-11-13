import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { MAX_PREVIEW_QUESTIONS, SharePreviewInput } from '@marklayer/agent-tools';
import { MAX_PAGES_PER_PROJECT, ORIGIN } from '@marklayer/brand';
import { MIN_SHARE_ID_LENGTH } from '@marklayer/brand/links';
import { MAX_QUESTION_OPTIONS, MIN_QUESTION_OPTIONS, opsArraySchema } from '@marklayer/types/ops';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { DAY_SECONDS, MAX_EXPIRES_IN_SECONDS } from '../shared/accounts';
import { ErrorResponse, IdParam, jsonRes, LOCKED_RESPONSES, openApiRoom, shareIdParam } from './api-shared';
import { userFromCookieHeader } from './auth';
import { dayCached } from './cache';
import type { Env } from './env';
import { providerList } from './integrations/providers';
import { integrationRoutes } from './integrations/routes';
import { FAILURE_WINDOW_MINUTES, MAX_FAILURES } from './lock/failures';
import { agentIdentityFrom, lockedPages } from './lock/gate';
import { once } from './memo';
import { captureServer } from './posthog';
import { createPreviewRoom } from './preview';
import { overRateLimit } from './rate-limit';
import { expiresAtFrom, removeProjects, saveRoom } from './rooms-lifecycle';
import { annotationStore, isExpired, projectStore } from './store';

const api = new OpenAPIHono<Env>();
api.use('*', cors());

// Static routes are registered before the `/{id}` param routes so the parent
// router (hono/tiny PatternRouter, which matches in registration order) doesn't
// swallow `/health` or `/openapi.json` as an annotation id.
/**
 * A real probe of the Cloudflare bindings this app runs on, not a liveness ping.
 * It used to answer a hardcoded `{ status: 'ok' }`, which meant it stayed green
 * through a D1 outage — and the footer's status line on every page is now
 * reading it, so "operational" has to be a measurement.
 *
 * D1 and R2 are the two bindings that fail independently of the Worker: one
 * `SELECT 1` and one `head()` on a key that need not exist (a miss is still a
 * round trip). ANNOTATION_ROOM is deliberately not probed — a Durable Object has
 * no cheap read, and touching one would boot a real room per health check; a
 * room's health is what its own peers' connection state reports.
 *
 * 503 on a failed probe so uptime monitors and `fetch().ok` both see it. The
 * 15s `max-age` is a browser-cache hint only — a Worker's own response is not
 * edge-cached without the Cache API — so the real fan-out guard is the
 * session-scoped cache in `probeStatus` on the client.
 */
api.get('/health', async (c) => {
  const [db, storage] = await Promise.all([
    reaches(() => c.env.DB.prepare('SELECT 1').first()),
    reaches(() => c.env.OG_BUCKET.head('health')),
  ]);
  const ok = db && storage;
  return c.json({ status: ok ? 'ok' : 'degraded', checks: { db, storage } }, ok ? 200 : 503, {
    'Cache-Control': 'public, max-age=15',
  });
});

/** Whether the binding answered at all. A miss is a pass; only a throw is not. */
async function reaches(probe: () => Promise<unknown>): Promise<boolean> {
  try {
    await probe();
    return true;
  } catch {
    return false;
  }
}

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
        description: `Anonymous, no-auth API for creating and reading MarkLayer annotation share links. Pick an unguessable id (nanoid/uuid) — the id is the access token. Share links open at ${ORIGIN}/s/{id} (or /p/{id} for project bundles). A link its owner protected with a password answers 401 to every /{id} route unless the request sends \`Authorization: Bearer <password>\` (or \`X-MarkLayer-Password\`); ${MAX_FAILURES} wrong guesses in ${FAILURE_WINDOW_MINUTES} minutes answer 429.`,
        license: { name: 'MIT', url: 'https://github.com/thevrus/MarkLayer/blob/main/LICENSE' },
      },
      servers: [{ url: `${ORIGIN}/api` }],
    }),
  ),
);
api.get('/openapi.json', (c) =>
  c.body(openApiJson(), 200, dayCached('application/vnd.oai.openapi+json;version=3.1.0')),
);

/** The preview route's. The share save's weak new id stops at the door, as a 404. */
const WEAK_NEW_ID = `A new share id needs at least ${MIN_SHARE_ID_LENGTH} characters of [A-Za-z0-9_-]`;

const OkResponse = z.object({ ok: z.boolean() }).openapi('Ok');

const RATE_LIMITED = 'Too many requests';
const RATE_LIMITED_RESPONSE = { 429: jsonRes(ErrorResponse, 'Too many writes from this client; retry in a minute') };

/** Anonymous writes share one per-client budget with MCP calls and socket opens. */
const overWriteLimit = (c: Context<Env>) => overRateLimit({ limiter: c.env.ROOM_LIMITER, req: c.req });

/** Creating: documented here, enforced in `store.ts`, the layer every writer shares. */
const NewIdParam = shareIdParam(
  `Unguessable share id you choose — it is the access token. Creating a new one takes at least ${MIN_SHARE_ID_LENGTH} characters of [A-Za-z0-9_-]; a nanoid() or uuid is ideal.`,
);

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

/**
 * Both annotations and projects take the same optional retention override.
 * Omitted keeps the expiry the link already has; `null` (or 0) clears it.
 */
const expiresInField = z
  .int()
  .max(MAX_EXPIRES_IN_SECONDS)
  .nullable()
  .optional()
  .openapi({
    description: `Seconds until cleanup (max ${MAX_EXPIRES_IN_SECONDS} = ${MAX_EXPIRES_IN_SECONDS / DAY_SECONDS} days). Omit to keep the current expiry; null clears it.`,
  });

// Accepts `{ ops, url?, width?, expires_in? }` or a raw ops array (the autosave, merged rather than replaced).
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
      expires_in: expiresInField,
      explicit: z
        .boolean()
        .optional()
        .openapi({ description: 'Someone deliberately published this save, as opposed to an autosave' }),
    }),
  ])
  .openapi('StoreAnnotation');

// Shared between the single-annotation response and each project page below.
const annotationShape = {
  ops: z.array(z.unknown()),
  url: z.string().nullable(),
  width: z.number().nullable(),
};

const AnnotationResponse = z
  .object({ ...annotationShape, exec_mode: z.enum(['solo', 'guide', 'pair']) })
  .openapi('Annotation');

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
  description:
    "The object form replaces the link's annotations with `ops`: anything absent is removed. A bare ops array is merged instead: annotations whose id the link lacks are added, and nothing is removed or changed. Remove or edit through the object form, or live over the room's WebSocket.",
  request: {
    params: NewIdParam,
    body: { required: true, content: { 'application/json': { schema: StoreAnnotationBody } } },
  },
  responses: {
    ...LOCKED_RESPONSES,
    429: jsonRes(ErrorResponse, 'Too many wrong passwords for this link, or too many writes, from this client'),
    200: jsonRes(OkResponse, 'Stored'),
    400: jsonRes(ErrorResponse, 'Invalid operations data'),
    403: jsonRes(ErrorResponse, 'Link is view-only'),
  },
});

api.openapi(storeAnnotation, async (c) => {
  if (await overWriteLimit(c)) return c.json({ error: RATE_LIMITED }, 429);
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  const result = opsArraySchema.safeParse(Array.isArray(body) ? body : body.ops);
  if (!result.success) return c.json({ error: 'Invalid operations data' }, 400);

  // Writes too: replacing a protected room's ops is as much a breach as reading them.
  const { room, refused } = await openApiRoom({ c, id });
  if (refused) return c.json({ error: refused.error }, refused.status);

  // The bare-array autosave never touches url, width or expiry, and only adds: extensions
  // older than the room-as-sole-writer send it with a possibly stale list of the room.
  const fields = Array.isArray(body) ? null : body;
  const url = fields?.url || null;
  const width = fields?.width && fields.width > 0 ? fields.width : null;

  // No row means no owner to be: the session is only worth reading when the room can say no.
  const user = room.exists
    ? await userFromCookieHeader({ header: c.req.header('cookie') ?? null, db: c.env.DB })
    : null;
  const saved = await saveRoom({
    env: c.env,
    id,
    exists: room.exists,
    userId: user?.id,
    ops: result.data,
    mode: fields ? 'replace' : 'merge',
    url,
    width,
    expiresIn: fields?.expires_in,
  });
  if (saved === 'refused') return c.json({ error: 'This link is view-only.' }, 403);

  // The extension autosaves a bare ops array while its socket is down; it and the web
  // app send the object form only when someone deliberately publishes. `explicit`
  // separates the two so real publishes are countable, not drowned by autosaves.
  captureServer(c.env, c.executionCtx, 'share_link_saved', {
    surface: surfaceFrom({ origin: c.req.header('origin'), host: c.req.header('host') }),
    explicit: fields?.explicit ?? fields !== null,
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
    ...LOCKED_RESPONSES,
    200: jsonRes(AnnotationResponse, 'Annotation payload'),
  },
});

api.openapi(getAnnotation, async (c) => {
  const { id } = c.req.valid('param');
  const { room, refused } = await openApiRoom({ c, id });
  if (refused) return c.json({ error: refused.error }, refused.status);
  if (!room.exists) return c.json({ error: 'not found' }, 404);
  const store = annotationStore(c.env.DB);
  const row = await store.get(id);
  if (!row) return c.json({ error: 'not found' }, 404);
  c.executionCtx.waitUntil(store.touch(id));
  return c.json(
    { ops: row.ops, url: row.url, width: row.width, exec_mode: (await store.getExecMode(id)) ?? 'pair' },
    200,
  );
});

/** Documents the request; `SharePreviewInput` from agent-tools is what validates it, shared with the MCP tool. */
const PreviewBody = z
  .object({
    url: z.string().openapi({ format: 'uri', description: 'Absolute http(s) URL of the page to review' }),
    title: z.string().openapi({ description: 'What this is, shown to reviewers' }),
    repo: z.string().optional(),
    branch: z.string().optional(),
    sha: z.string().optional(),
    note: z.string().optional().openapi({ description: 'What changed and what to look at' }),
    questions: z
      .array(z.object({ prompt: z.string(), options: z.array(z.string()) }))
      .optional()
      .openapi({
        description: `Polls to open the room with: ${MIN_QUESTION_OPTIONS}–${MAX_QUESTION_OPTIONS} options each, at most ${MAX_PREVIEW_QUESTIONS}`,
      }),
    previous: z.string().optional().openapi({
      description:
        'A room you hold (link or id). With the same repo and branch, the new room becomes its next version. Naming it is the proof you hold it: rooms are never chained by repo and branch alone.',
    }),
    agent: z.string().optional().openapi({ description: 'Who is asking, shown as the author of any polls' }),
  })
  .openapi('CreatePreview');

const PreviewCreatedResponse = z
  .object({
    id: z.string(),
    url: z.string(),
    version: z.number().nullable(),
    previous: z.string().nullable(),
  })
  .openapi('PreviewCreated');

const createPreview = createRoute({
  method: 'post',
  path: '/{id}/preview',
  summary: 'Open a review room on a preview build',
  description:
    'What the marklayer_share_preview tool calls. Creates the room at the id you chose and never overwrites one.',
  request: {
    params: NewIdParam,
    body: { required: true, content: { 'application/json': { schema: PreviewBody } } },
  },
  responses: {
    200: jsonRes(PreviewCreatedResponse, 'Created'),
    400: jsonRes(ErrorResponse, 'Invalid preview'),
    409: jsonRes(ErrorResponse, 'Id already taken'),
    ...RATE_LIMITED_RESPONSE,
  },
});

api.openapi(createPreview, async (c) => {
  if (await overWriteLimit(c)) return c.json({ error: RATE_LIMITED }, 429);
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  const parsed = SharePreviewInput.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
  }
  const created = await createPreviewRoom({
    db: c.env.DB,
    request: parsed.data,
    agentId: agentIdentityFrom(body.agent),
    origin: new URL(c.req.url).origin,
    headers: c.req.raw.headers,
    id,
  });
  if ('error' in created) return c.json({ error: created.error }, created.taken ? 409 : 400);
  captureServer(c.env, c.executionCtx, 'preview_shared', { versioned: created.previous !== null });
  return c.json(created, 200);
});

const VersionRefSchema = z
  .object({ id: z.string(), version: z.number().nullable(), sha: z.string().nullable() })
  .nullable();

const VersionsResponse = z
  .object({
    title: z.string().nullable(),
    note: z.string().nullable(),
    repo: z.string().nullable(),
    branch: z.string().nullable(),
    sha: z.string().nullable(),
    version: z.number().nullable(),
    previous: VersionRefSchema,
    next: VersionRefSchema,
  })
  .openapi('Versions');

const getVersions = createRoute({
  method: 'get',
  path: '/{id}/versions',
  summary: "A preview room's version and its neighbours",
  request: { params: IdParam },
  responses: {
    200: jsonRes(VersionsResponse, 'Version info'),
    ...LOCKED_RESPONSES,
  },
});

api.openapi(getVersions, async (c) => {
  const { id } = c.req.valid('param');
  const { refused } = await openApiRoom({ c, id });
  if (refused) return c.json({ error: refused.error }, refused.status);
  const info = await annotationStore(c.env.DB).getVersions(id);
  if (!info) return c.json({ error: 'not found' }, 404);
  return c.json(info, 200);
});

api.route('/', integrationRoutes);

const StoreProjectBody = z
  .object({
    pageIds: z.array(z.string()).openapi({ description: 'Ids of annotation pages in this bundle' }),
    expires_in: expiresInField,
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
    params: NewIdParam,
    body: { required: true, content: { 'application/json': { schema: StoreProjectBody } } },
  },
  responses: {
    200: jsonRes(OkResponse, 'Stored'),
    400: jsonRes(ErrorResponse, 'Invalid pageIds'),
    ...RATE_LIMITED_RESPONSE,
  },
});

api.openapi(storeProject, async (c) => {
  if (await overWriteLimit(c)) return c.json({ error: RATE_LIMITED }, 429);
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  const pageIds = body.pageIds.filter((x) => x.length > 0);
  if (!pageIds.length) return c.json({ error: 'pageIds must contain at least one id' }, 400);
  if (pageIds.length > MAX_PAGES_PER_PROJECT) {
    return c.json({ error: `Project exceeds ${MAX_PAGES_PER_PROJECT} pages` }, 400);
  }
  const expiresAt = body.expires_in === undefined ? undefined : expiresAtFrom(body.expires_in);
  if (!(await projectStore(c.env.DB).put({ id, pageIds, expiresAt }))) {
    return c.json({ error: WEAK_NEW_ID }, 400);
  }
  await annotationStore(c.env.DB).linkProject({ projectId: id, pageIds });
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
    c.executionCtx.waitUntil(removeProjects({ env: c.env, ids: [id] }));
    return c.json({ error: 'expired' }, 410);
  }
  c.executionCtx.waitUntil(projects.touch(id));
  const { pageIds, createdAt, expiresAt } = row;
  if (!pageIds.length) return c.json({ pageIds: [], pages: [], createdAt, expiresAt }, 200);
  const [byId, locked] = await Promise.all([
    annotationStore(c.env.DB).getMany(pageIds),
    lockedPages({ db: c.env.DB, pageIds, headers: c.req.raw.headers }),
  ]);
  // Preserve original order; missing rows, and pages this caller has not unlocked, become empty placeholders.
  // Anyone may bundle any id into a project, so this is the route a protected page would otherwise leak through.
  const pages = pageIds.map((pid) =>
    locked.includes(pid)
      ? { id: pid, ops: [], url: null, width: null }
      : (byId.get(pid) ?? { id: pid, ops: [], url: null, width: null }),
  );
  return c.json({ pageIds, pages, createdAt, expiresAt }, 200);
});

export { api };
