# Tracking plan

**Tool:** PostHog (cloud). **Last updated:** 2026-08-18.

MarkLayer is open source and people point it at pages we have no business
knowing about: localhost, internal staging, unlisted docs, URLs with a session
token in the query string. So the bar here is higher than "avoid PII". The rule
is that telemetry must be useless to an attacker and uninteresting to a lawyer:
counters, reason codes and durations, never a URL, a room ID, or page content.

Every event below exists to answer a question we would actually act on. If an
event stops informing a decision, delete it rather than leave it collecting.

## What we deliberately do not do

| Not done | Why |
|---|---|
| Recording annotated pages in session replay | Replay is on, but only for MarkLayer's own chrome. The proxied page is a same-origin iframe rrweb would otherwise record, so it carries `ph-no-capture` and replays as a blank box. All inputs are masked (`maskAllInputs`, pinned in code). Heatmaps stay off. |
| Autocapture | Blanket click/input capture is exactly the aggressive tracking this project should not ship. |
| Person profiles, cookies, `identify()` | `person_profiles: 'never'` client-side and `$process_person_profile: false` server-side. Events are counters; there is no per-user record to join or export. |
| Any analytics in the extension | It holds host permissions on every page you visit. Telemetry there is unjustifiable, so there is none. Product signal is derived server-side instead. |
| Tracking the marketing pages | `apps/site` is `output: 'static'` with zero client JS. Keeping it that way is worth more than the pageview data. |
| Sending annotated URLs, hostnames, room IDs, or page text | The sensitive surface. Enforced centrally, not per call site. |

## Enforcement

Call sites are not trusted, because they already got this wrong once:
`proxy_render_failed` shipped the full annotated URL to PostHog.

- **Server** ([`apps/worker/src/posthog.ts`](apps/worker/src/posthog.ts)) —
  `scrub()` rewrites anything URL-shaped in a string property to `<redacted>`
  and caps free text at 200 chars, so an error message cannot smuggle one out.
- **Client** ([`apps/worker/web/analytics.ts`](apps/worker/web/analytics.ts)) —
  `sanitize_properties` reduces every absolute URL to origin + path. This is
  load-bearing: the viewer URL is `/?url=<page being annotated>#id=<room id>`,
  so a stock `$pageview` would otherwise ship both on every single load.

## Events

Naming is `object_action`, lowercase with underscores.

| Event | Trigger | Properties | Question it answers |
|---|---|---|---|
| `$pageview`, `$pageleave` | Web app load / unload | URL stripped to origin + path | How much traffic reaches the app, and from where |
| `annotation_session_ended` | Last peer disconnects from a room, if any op was drawn | `ops_total`, `tools` (sorted names), `tool_count`, `peak_peers`, `collaborative`, `duration_ms` | Which tools earn their place; how often rooms are genuinely collaborative; is anyone finishing a session |
| `page_render_failed` | Viewer iframe fails to render | `reason` (`timeout`/`no-marker`/`iframe-error`), `proxy_error`, `duration_ms` | Is the proxy regressing, and how |
| `proxy_render_failed` | Worker proxy rejects or fails a fetch | `reason`, `status`, `duration_ms`, `message` (scrubbed) | Which failure mode dominates |
| `$exception` | Unhandled client error | Stack, URL-stripped | Crash rate |

`annotation_session_ended` is aggregated in the Durable Object
([`annotation-room.ts`](apps/worker/src/annotation-room.ts)) and emitted **once
per session**, not once per operation. A pen stroke is an op; a hundred of them
are one event. That is cheaper and much less of a surveillance surface.

## Opt-out

`respect_dnt: true` honours Do Not Track. Beyond that,
`localStorage.setItem('marklayer:no-analytics', '1')` stops the PostHog bundle
from loading at all, so opting out also opts you out of the ~50 KB download.
Documented on [/privacy](apps/site/src/pages/privacy.astro).

## Known gaps

Deliberately unbuilt for now, listed so they are choices rather than oversights:

- **MCP adoption is unmeasured.** `marklayer-mcp` is the product's real
  differentiator and we have no signal on it. An `mcp_room_connected` event
  fired when the MCP server attaches to a room would be privacy-safe (it is a
  server-side counter) and is the highest-value addition left.
- **Extension → web activation is unmeasurable by design.** No extension
  telemetry means no install→first-annotation funnel. Chrome Web Store install
  counts are the substitute.
- **SEO attribution is coarse.** With no tracking on the marketing pages, the
  `$referrer` on app pageviews is the only link between a comparison page and an
  app open. Cloudflare's server-side request analytics covers page-level SEO
  performance without adding a beacon.
