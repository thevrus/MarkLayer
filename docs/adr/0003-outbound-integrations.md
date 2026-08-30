# ADR 0003. Outbound integrations are pure renderers behind one delivery chokepoint

- **Status:** Proposed
- **Date:** 2026-08-30
- **Context:** generalizing the room→Slack webhook so Teams, Discord, generic webhooks and (eventually) Jira can be added without touching the room

## Context

A room can now post new annotations to a Slack incoming webhook. The first cut
hardwired it: a `slack_webhook` column, an `isSlackWebhook` host check, a
`formatSlackMessage` function and three `/{id}/slack` routes. Adding Microsoft
Teams the same way would duplicate all four, and adding a fifth destination
would mean five copies of the one piece of code that must never be wrong — the
guard that decides which host the Worker is willing to fetch.

Three constraints shape the answer:

**The room id is the access token.** There are no accounts. Anyone holding a
share link is a full participant, so whatever an integration stores is
reachable by anyone who has the link. That is fine for a credential that is
write-only, single-purpose and revocable in one click. It is not fine for a
credential that can read a company's issue tracker.

**SSRF must stay impossible.** An integration is, by definition, "the Worker
makes an HTTP request to a URL somebody supplied." That is the exact shape of a
request-forgery hole. The current guard works because there is one provider and
one hardcoded prefix; the design has to keep that property when there are six.

**The client bundle must not grow with the provider list.** The extension's
content script and the Worker's client bundle ship to every user on every page.
Six providers' worth of form components and copy would be six providers' worth
of bytes, paid by everyone including people who use none of them.

## Decision

### Providers describe requests; they never make them

A provider is a pure module:

```ts
interface Provider {
  id: IntegrationProvider;            // 'slack' | 'teams' | 'discord' | 'webhook'
  label: string;
  config: ZodType;                    // validated at the API boundary
  allowedHosts: readonly string[];    // [] means "any public host", guarded separately
  render(args: { event: RoomEvent; config: unknown; roomUrl: string; pageUrl: string | null }):
    { url: string; headers: Record<string, string>; body: string } | null;
}
```

`render` returns a *description* of a request. It cannot call `fetch`, because
it is never given the chance to. Every outbound request in the system is made by
one function, `deliver()`, which:

1. Parses the stored config with the provider's own Zod schema.
2. Calls `render`.
3. Checks the returned URL against `allowedHosts` — and, for the generic webhook
   provider, against the shared `isBlockedHost` already used by the fetch relay.
4. Fetches, with a timeout, and returns only whether it succeeded.

This is the whole security argument. A new provider is a formatting function and
a host list; it is structurally incapable of introducing an SSRF hole, because
the code that reaches the network is not code a provider author writes. Reviewing
a new provider means reviewing a string template, not an egress path.

`render` returning `null` is how a provider declines an event it does not care
about, so "which events does this provider want" needs no second mechanism.

### Rooms hold a list of destinations, not a column per provider

`annotations.slack_webhook TEXT` becomes `annotations.integrations TEXT` — a JSON
array of `{ provider, config }`, parsed with a Zod schema from `packages/types`.
Adding a provider adds no column and no migration. Deleting the row still takes
every integration with it, so the retention cron needs no new step.

A separate `integrations` table was considered and rejected: nothing queries
integrations except by room id, so a join buys nothing, and a second table would
need its own cleanup path that the existing cron does not have.

### The client renders a manifest, not a component per provider

`GET /api/providers` returns the provider list as data — id, label, and a
description of each config field (name, type, placeholder, help text). The client
ships one generic form that renders whatever it is handed. Adding a provider adds
zero bytes to the client bundle; the registry itself lives in
`apps/worker/src/integrations/` and is never imported by client code.

### Two tiers, and Jira is deliberately in neither yet

Destinations split by what their credential can do:

**Notify (ship now).** Slack, Microsoft Teams, Discord, generic webhook. The
credential *is* a URL: write-only, scoped to one channel, revocable by deleting
the hook, and useless for reading anything. Storing one against a room whose id
is its own access token is an honest trade, and the UI says so plainly rather
than implying a privacy the link cannot provide.

**Sync (not on the server).** Jira, Linear, GitHub. These need a long-lived API
token that can usually read far more than it writes, and they create resources
that want to be linked back. Storing that token against a room id would mean:
anyone who gets the share link can file issues into a company tracker, and a
leaked link is a leaked tracker credential. No amount of not-returning-the-token
fixes that, because the danger is in *using* it, not reading it.

The answer is that MarkLayer already has the right place for this and it is not
the server: `apps/mcp`. The MCP server runs on the user's own machine, already
holds their credentials, and already reads the room. "Create a Jira issue from
this annotation" is an MCP tool, where the token never leaves the laptop that
owns it. That is a better product than a server-side Jira integration, not a
consolation prize — and it is the one shape of this feature that does not
require inventing accounts.

If a server-side tracker integration is ever genuinely wanted, it needs an owner
identity, which means accounts, which is a different ADR.

> **Amended by [ADR 0004](0004-filing-annotations-into-trackers.md).** Trackers
> were added without accounts by splitting the credential: the room stores only
> the non-secret half (repository, project key, site) and the token is supplied
> per request by the browser doing the filing. The objection above is answered by
> never storing the token, not by deciding it was overstated.

## Consequences

**Good.** A new notify provider is one file and one registry line, reviewable in
minutes, with no schema change, no client bytes and no new egress path. The SSRF
guard has exactly one implementation and one test file covering it. Providers are
pure, so they test offline with no network and no mocking.

**Costs.** Config is `unknown` until a provider parses it, so the delivery path
carries one Zod parse per send — negligible against an outbound HTTP request. The
generic-webhook provider is the one place with a real (guarded) SSRF surface, and
it deserves the same scrutiny the fetch relay gets.

**Deferred.** Per-provider retry and backoff. Today a failed send increments a
counter and the room stops after three consecutive failures; that is right for a
revoked hook and crude for a transient outage. Per-destination delivery state
(rather than one counter per room) is the natural next step and needs the
`integrations` column to carry it, which this design allows without a migration.
