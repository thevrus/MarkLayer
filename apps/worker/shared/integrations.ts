import { z } from 'zod/mini';

/**
 * Destinations a room can post to. Each one is rendered by a pure provider module
 * in apps/worker/src/integrations, which describes a request but never makes one.
 */
export const integrationProviderSchema = z.enum([
  'slack',
  'teams',
  'discord',
  'webhook',
  'linear',
  'github',
  'jira',
  'trello',
  'zapier',
  'notion',
  'clickup',
]);
export type IntegrationProvider = z.infer<typeof integrationProviderSchema>;

/**
 * One configured destination. `config` stays unknown here on purpose: its shape
 * belongs to the provider, which parses it with its own schema at the delivery
 * boundary, so adding a provider needs no change to this file.
 */
export const integrationSchema = z.object({
  provider: integrationProviderSchema,
  config: z.record(z.string(), z.unknown()),
});
export type Integration = z.infer<typeof integrationSchema>;

/** Everything a room posts to. Stored as one JSON column, so a new provider needs no migration. */
export const roomIntegrationsSchema = z.array(integrationSchema);

/** Ceiling on destinations per room — enough for a team, low enough to bound a flush. */
export const MAX_INTEGRATIONS_PER_ROOM = 5;

/**
 * One field of a provider's config, as the client needs to render it.
 *
 * `secret` is `text` that the client must not echo back: an issue tracker is
 * configured with an API token, not a URL carrying one, and a token sitting in a
 * readable input is a token read over someone's shoulder. It is an enum rather
 * than a string because `type !== 'secret'` is the check that keeps a credential
 * out of the room's stored config, in five places on the client and one on the
 * server — a free-form string would let a rename compile straight past all six.
 */
export const configFieldInfoSchema = z.object({
  name: z.string(),
  label: z.string(),
  type: z.enum(['url', 'text', 'secret']),
  placeholder: z.optional(z.string()),
  help: z.optional(z.string()),
  helpUrl: z.optional(z.string()),
});
export type ConfigFieldInfo = z.infer<typeof configFieldInfoSchema>;

/**
 * A destination as `GET /api/providers` describes it.
 *
 * The client ships one generic form driven by this, so adding a provider costs
 * the client bundle nothing. Here rather than in the web app
 * because it is wire data, and this file is where wire data is defined and
 * parsed; the OpenAPI mirror in api.ts stays hand-written because
 * `@hono/zod-openapi` is a different builder (see CLAUDE.md).
 */
export const providerInfoSchema = z.object({
  id: z.string(),
  label: z.string(),
  blurb: z.string(),
  /** `auto` posts every batch the room produces; `manual` files only on request. */
  trigger: z.enum(['auto', 'manual']),
  fields: z.array(configFieldInfoSchema),
});
export type ProviderInfo = z.infer<typeof providerInfoSchema>;

export const providerCatalogueSchema = z.object({ providers: z.array(providerInfoSchema) });

/** A configured destination as the server describes it — never its credentials. */
export const destinationSummarySchema = z.object({ provider: z.string(), hint: z.nullable(z.string()) });
export type DestinationSummary = z.infer<typeof destinationSummarySchema>;

export const destinationListSchema = z.object({ integrations: z.array(destinationSummarySchema) });

/** The two-way Slack app for one room: whether this deploy has it, and where the room posts if connected. */
export const slackAppStatusSchema = z.object({
  enabled: z.boolean(),
  connection: z.nullable(z.object({ team: z.nullable(z.string()), channel: z.nullable(z.string()) })),
});
export type SlackAppStatus = z.infer<typeof slackAppStatusSchema>;
