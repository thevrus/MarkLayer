import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { MAX_INTEGRATIONS_PER_ROOM } from '../../shared/integrations';
import { ErrorResponse, IdParam, jsonRes, LOCKED_RESPONSES, openApiRoom } from '../api-shared';
import type { Env } from '../env';
import { captureServer } from '../posthog';
import { annotationStore } from '../store';
import {
  deliverOne,
  hasAllSecrets,
  parseIntegrations,
  publicConfig,
  validateIntegration,
  withSecrets,
} from './deliver';
import { providerById } from './providers';
import { notifiableFrom } from './types';

const api = new OpenAPIHono<Env>();

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
    ...LOCKED_RESPONSES,
    200: jsonRes(IntegrationsResponse, 'Configured destinations'),
    404: jsonRes(ErrorResponse, 'Not found'),
  },
});

api.openapi(getIntegrations, async (c) => {
  const { id } = c.req.valid('param');
  const { room, refused } = await openApiRoom({ c, id });
  if (refused) return c.json({ error: refused.error }, refused.status);
  if (!room.exists) return c.json({ error: 'not found' }, 404);
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
    ...LOCKED_RESPONSES,
    200: jsonRes(IntegrationsResponse, 'Stored'),
    400: jsonRes(ErrorResponse, 'Destination rejected'),
    404: jsonRes(ErrorResponse, 'Not found'),
  },
});

api.openapi(addIntegration, async (c) => {
  const { id } = c.req.valid('param');
  const { room, refused } = await openApiRoom({ c, id });
  if (refused) return c.json({ error: refused.error }, refused.status);
  if (!room.exists) return c.json({ error: 'not found' }, 404);
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
  // what authorises it.
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
    ...LOCKED_RESPONSES,
    200: jsonRes(IntegrationsResponse, 'Removed'),
    404: jsonRes(ErrorResponse, 'Not found'),
  },
});

api.openapi(removeIntegration, async (c) => {
  const { id, provider } = c.req.valid('param');
  const { room, refused } = await openApiRoom({ c, id });
  if (refused) return c.json({ error: refused.error }, refused.status);
  if (!room.exists) return c.json({ error: 'not found' }, 404);
  const store = annotationStore(c.env.DB);
  const row = await store.getIntegrations(id);
  if (!row) return c.json({ error: 'not found' }, 404);

  const next = parseIntegrations(row.integrations).filter((i) => i.provider !== provider);
  await store.setIntegrations({ id, json: next.length > 0 ? JSON.stringify(next) : null });
  return c.json({ integrations: next.map(summarizeIntegration) }, 200);
});

const PushBody = z
  .object({
    provider: z.string().openapi({ description: 'A configured destination whose trigger is manual' }),
    secrets: z.record(z.string(), z.string()).optional().openapi({
      description:
        'The credential fields for this destination, supplied per request. They are used for this one call and never stored.',
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
    ...LOCKED_RESPONSES,
    200: jsonRes(PushResponse, 'Filed'),
    400: jsonRes(ErrorResponse, 'Could not be filed'),
    404: jsonRes(ErrorResponse, 'Not found'),
    410: jsonRes(ErrorResponse, 'Expired'),
  },
});

api.openapi(pushAnnotation, async (c) => {
  const { id, opId } = c.req.valid('param');
  const { room, refused } = await openApiRoom({ c, id });
  if (refused) return c.json({ error: refused.error }, refused.status);
  if (!room.exists) return c.json({ error: 'not found' }, 404);
  const { provider: providerId, secrets } = c.req.valid('json');

  // Resolved before any I/O, because it reads nothing but the static manifest:
  // a bogus provider id should not cost a room read and an ops parse first.
  const provider = providerById(providerId);
  if (!provider) return c.json({ error: 'unknown provider' }, 400);
  if (provider.trigger !== 'manual') {
    return c.json({ error: `${provider.label} posts automatically and cannot be filed to` }, 400);
  }

  // The ops come from the room, not the row: the room persists on a debounce, so an
  // annotation typed a second ago is real there and not yet here. The destinations
  // are read on their own so a stored credential never rides along with the ops.
  const [snapshot, destinations] = await Promise.all([
    room.stub.snapshot(),
    annotationStore(c.env.DB).getIntegrations(id),
  ]);

  const integration = parseIntegrations(destinations?.integrations ?? null).find((i) => i.provider === providerId);
  if (!integration) return c.json({ error: `${provider.label} is not connected to this room` }, 400);

  // The one moment a complete config exists: the room's half, plus the token
  // the person filing just sent. It lives for this request and is not written
  // anywhere, which is what makes a leaked share link not a leaked credential.
  const config = withSecrets({ provider, config: integration.config, secrets: secrets ?? {} });
  if (!hasAllSecrets({ provider, config })) {
    return c.json({ error: `${provider.label} needs a token to file with` }, 400);
  }

  const op = snapshot.ops.find((o) => o.id === opId);
  if (!op) return c.json({ error: 'no such annotation in this room' }, 404);

  const item = notifiableFrom(op);
  if (!item) return c.json({ error: 'that annotation has no text to file' }, 400);

  const result = await deliverOne({
    integration: { ...integration, config },
    event: { type: 'annotation.pushed', items: [item] },
    roomUrl: `${new URL(c.req.url).origin}/s/${id}`,
    pageUrl: snapshot.url,
  });

  if (!result.ok) return c.json({ error: result.reason }, 400);

  captureServer(c.env, c.executionCtx, 'annotation_filed', { provider: providerId });
  return c.json({ url: result.url }, 200);
});

export { api as integrationRoutes };
