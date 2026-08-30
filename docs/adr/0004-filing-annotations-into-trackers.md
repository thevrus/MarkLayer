# ADR 0004. A room stores where to file, never what authorises it

- **Status:** Proposed
- **Date:** 2026-08-30
- **Context:** adding Linear, GitHub and Jira as destinations without the leaked-credential problem that ADR 0003 refused

## Context

ADR 0003 built the outbound integrations layer and, in the same breath, ruled
out exactly the destinations this ADR adds. Its reasoning was not incidental, so
it is worth quoting rather than paraphrasing:

> Storing that token against a room id would mean: anyone who gets the share
> link can file issues into a company tracker, and a leaked link is a leaked
> tracker credential. No amount of not-returning-the-token fixes that, because
> the danger is in _using_ it, not reading it.

That is correct, and it remains correct. A share link is handed to clients by
design — that is the entire product — so "someone who is not on the team holds
the link" is the normal case, not the breach case. A room that stored a GitHub
token would be a room that lets every reviewer write to the repository.

ADR 0003 concluded that the feature therefore belongs in `apps/mcp`, where the
token stays on the developer's own machine, and that a server-side version would
need accounts.

Two things have changed the shape of the question since. First, "push a thread
into Linear, Jira or GitHub" is the most common reason a team keeps paying for a
competitor: it is the single loudest gap in the product. Second, the MCP answer
only serves the person running an agent. The reviewer looking at the page — the
one who found the bug and is best placed to describe it — cannot reach MCP at
all. Filing from the browser is most of the value, and MCP cannot deliver it.

## Options considered

**Accounts.** The answer ADR 0003 pointed at. An owner identity would make a
stored token safe, because the token would belong to a person rather than to a
link. It is also a different product: no-account, no-install is the positioning
the whole thing rests on, and inventing accounts to add one integration is the
tail wagging the dog.

**Store the token anyway, and warn.** Fastest, and dishonest. A warning does not
change who can use the credential, and the people at risk are the ones who never
read the settings panel. This is the option ADR 0003 already rejected on the
merits, and nothing about wanting the feature more makes its reasoning weaker.

**Split the credential.** Store, per room, only what is not secret: the
repository, the project key, the team, the Jira site. Keep the API token in the
browser of the person doing the filing, and send it with the one request that
uses it. The server never writes it anywhere.

## Decision

The third. A destination's configuration has two halves, and only one of them is
the room's business.

`ConfigField` gained a `secret` type, so the manifest already says which half is
which and both ends can act on it without a list of field names to keep in step.
`POST /{id}/integrations` runs `publicConfig` and drops every secret field before
writing, so the D1 column cannot hold a token even if a client sends one.
`POST /{id}/annotations/{opId}/push` takes the secrets in the request body,
merges them with `withSecrets`, uses the result for one outbound call, and lets
it fall out of scope. Nothing logs it; `deliver` never sees it.

`withSecrets` copies only the fields the provider itself declares secret, so the
push route cannot be used to rewrite the repository a room files into — supplying
a credential is all it can do.

Two supporting decisions fell out of this:

**Trackers file on request only.** `Provider` gained `trigger: 'auto' | 'manual'`.
Chat destinations post every batch, as before. A tracker declines
`annotations.created` outright and renders only `annotation.pushed`. An issue per
comment, opened unasked, is the behaviour that gets an integration disconnected by
Friday — and with the credential now supplied per request, automatic filing could
not work anyway: at 3am there is no browser holding a token.

**`deliverOne` reports; `deliver` swallows.** They are deliberate opposites.
`deliver` must never let a dead chat hook stop an annotation from saving, so it
returns a count and no reasons. Somebody is watching `deliverOne`, and "a
rejected token" and "an unreachable host" need different fixes, so it names which
one happened. A 200 with no created issue — which GraphQL does cheerfully — counts
as a failure, because reporting success would send someone looking for an issue
that is not there.

The created issue's URL is posted back into the thread as a reply rather than
only shown in a toast. A toast is gone in four seconds; the room is where
everyone, including an agent reading over MCP, will look for it tomorrow.

## Consequences

**Good.** A leaked share link is no longer a leaked tracker credential, which was
the whole objection. The token lives in the browser of the person whose token it
is, so issues are opened under the right identity with no accounts invented. The
providers stay pure renderers behind the same delivery chokepoint and the same
SSRF guard, so ADR 0003's architecture is extended rather than bypassed — adding
a fourth tracker is still one file and one registry line.

**Costs.** Each person files with their own token, so each browser is asked for
one once. That is friction, and it is the price of the property above; the ask
happens inline in the thread and says why. `localStorage` on our origin is not a
vault — script on the page could read it — but it is the person's own browser
holding their own token rather than our database holding it for everyone with a
link, and a token scoped to issue-creation keeps the blast radius small either
way. Jira needs four stored fields, which made the settings form genuinely
generic rather than the one-URL-per-provider shape it had; single-field
destinations keep their tighter layout.

**Not done.** This is one-way create. Nothing syncs status back from the tracker,
and closing the issue does not resolve the annotation. That needs a webhook
receiver and an identity to attribute the change to, which is ADR 0003's account
problem again and is out of scope here.

**Unchanged.** ADR 0003's read of chat destinations still stands: a webhook URL
is write-only, scoped to one channel, and revocable by deleting the hook, so it
is an honest thing to store against a room. Only the tracker half needed a
different answer.
