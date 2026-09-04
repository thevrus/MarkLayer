# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

MarkLayer — free annotation/collaboration tool for any webpage. Monorepo with a Chrome extension, a Cloudflare Worker backend + web app, a static Astro marketing/SEO site, and an MCP server that bridges annotations to AI coding agents.

## Commands

```bash
bun install          # First-time setup (runs wxt prepare for extension)
bun run dev          # All apps dev mode (Turbo)
bun run build        # Build all
bun run check        # Type-check all (per-workspace `tsc --noEmit`; `astro check` in apps/site)
bun run lint         # Biome lint + format check
bun run lint:fix     # Biome auto-fix

# Releases — run locally; CI only lints, type-checks and builds.
bun run deploy         # Build + deploy worker to Cloudflare (site is embedded in it)
bun run deploy:mcp     # Publish marklayer-mcp to npm, but only if its version is ahead
bun run deploy:site    # Deploy apps/site standalone to Cloudflare Pages
cd apps/site && bun run indexnow:submit   # After a deploy that changed pages: ping IndexNow (Bing, Yandex, …)
bun run zip:extension  # Build Chrome + Firefox store zips into apps/extension/.output

# Extension only
cd apps/extension && bun dev               # Chrome (MV3) dev
cd apps/extension && bun dev:firefox       # Firefox dev
cd apps/extension && bun build             # Chrome build
cd apps/extension && bun build:firefox     # Firefox build
cd apps/extension && bun zip               # Package Chrome zip for store upload
cd apps/extension && bun run zip:all       # Chrome + Firefox zips (what `zip:extension` runs)

# Worker only
cd apps/worker && bun dev          # Vite + Wrangler together
cd apps/worker && bun run build    # vite build, then `embed:site` copies apps/site/dist into public/client
cd apps/worker && bun run deploy   # Build + `wrangler deploy`

# Marketing site only
cd apps/site && bun dev            # astro dev
cd apps/site && bun run build      # astro build → dist/
cd apps/site && bun run check      # astro check (this workspace's `check`, not tsc)

# Fetch relay only (see apps/fetcher/README.md for hosting)
cd apps/fetcher && bun run dev      # Local relay on :8080 (needs FETCHER_TOKEN)
cd apps/fetcher && bun run build    # → dist/server.js, dependency-free single file
docker build -f apps/fetcher/Dockerfile -t marklayer-fetcher .   # from the repo root

# MCP server only (published to npm as `marklayer-mcp`)
cd apps/mcp && bun run build       # Compile TS → dist/cli.js
cd apps/mcp && bun run dev         # tsc --watch
cd apps/mcp && node scripts/publish-if-new.mjs --check   # Publish preflight, no side effects
```

`bun run test` runs `bun test` in the workspaces that have specs (`packages/types`, `apps/worker`, `apps/fetcher`); the rest of the monorepo has none, so `bun run check` (TypeScript) and `bun run lint` (Biome) still carry most of the verification loop. Prefer a test where the failure would be silent — a truncated stream, a guard that stops guarding — over one that restates the type signature.

**`apps/site` is pinned to `typescript@^6`, deliberately.** Its `check` is `astro check`, which needs the TS programmatic API that the 7.x native compiler does not ship yet (withastro/roadmap#1321). The rest of the monorepo runs `tsc --noEmit` on 7.x and is unaffected. Do not bump the site to 7 until `astro check` supports it: the alternative, swapping it for `tsc --noEmit`, silently stops type-checking all 37 `.astro` templates.

## Structure

```
apps/extension/     # Chrome/Firefox extension (WXT + Preact)
  components/       # Canvas, Toolbar, all annotation Layer components
  lib/              # state.ts (signals), renderer.ts, selector.ts, anchor.ts,
                    # portal.ts (Base UI portal target inside the shadow root)
apps/worker/        # CF Worker API + web app (Hono + Vite + Preact)
  src/              # index.ts (Hono routes, robots/llms.txt, /.well-known/*),
                    # api.ts (OpenAPI share API under /api), annotation-room.ts
                    # (Durable Object), proxy.ts (iframe proxy + SSRF guard),
                    # og.ts + og-card.ts + og-marks.ts (share cards), posthog.ts
  web/              # Web app UI (Landing, Viewer, Web* layer components,
                    # useRealtimeSync, useVoiceRoom, signals)
  schema.sql        # D1 database schema
  wrangler.jsonc    # Worker bindings (D1, DO, R2) + `assets.run_worker_first`
apps/site/          # Astro static marketing/SEO site (marklayer.app content pages)
  src/content/      # Markdown collections: compare/, alternatives/, use-cases/
  src/content.config.ts  # Zod frontmatter schemas for those collections
  src/pages/        # Hubs (compare, alternatives, use-cases, pricing, about,
                    # privacy) + programmatic routes /vs/[slug], /alternatives/[slug],
                    # /for/[slug], plus sitemap.xml.ts and pricing.md.ts
  src/lib/          # site.ts (constants), collections.ts (ordered reads),
                    # schema.ts (JSON-LD), markdown.ts
  public/_headers   # HSTS + Cache-Control for asset-served pages
apps/mcp/           # MCP server (`marklayer-mcp` on npm) — exposes annotation
                    # rooms as tools (watch/acknowledge/resolve/reply) for AI agents.
                    # server.json is the MCP registry manifest (keep its version
                    # in sync with package.json).
apps/fetcher/       # Fixed-IP relay the worker's proxy falls back to when a host
                    # blocks Cloudflare's shared egress. One endpoint, bearer-token
                    # auth, resolve-time SSRF guard. Builds to a dependency-free 3KB
                    # bundle, so the host is swappable (deploy/ holds a fly.toml and
                    # a systemd unit). See its README.
packages/types/     # Shared types & Zod schemas (DrawOp union incl. guide/inspect,
                    # CommentOp + priority/status, Peer, AnchorPoint, target element
                    # metadata) and the `cn` helper. Single source of truth for
                    # client + server validation.
```

## Conventions

- **Preact, not React** — use `preact/hooks`, `@preact/signals`. Vite aliases `react` and `react-dom` to `preact/compat` (worker) and WXT's preact preset handles the extension. Both tsconfigs carry matching `paths` entries so `@base-ui/react` types resolve.
- **Base UI for interactive primitives** — popovers, menus, dialogs and tooltips come from `@base-ui/react` (used by `Tooltip`, `ContextMenu`, `SettingsPanel`, `ShareDialog`, `ProjectTabs`, `DeviceMenu`); don't hand-roll replacements. In the extension, portalled parts must render into `portalContainer` from `lib/portal.ts` — the UI lives in a shadow root, so a default `document.body` portal escapes the injected stylesheet. The web app leaves that signal `null` and takes Base UI's default.
- **Type comes from the scale, never from a bracket** — font size, letter-spacing and line-height are named steps in the app's `@theme` (`--text-*`, `--tracking-*`, `--leading-*` in `apps/worker/web/style.css`, `apps/extension/entrypoints/content/style.css` and `apps/site/src/styles/global.css`). Write `text-ui`, not `text-[13px]`; `tracking-ui`, not `tracking-[-0.01em]`; `leading-body`, not `leading-[1.55]`. The same holds for colour: `text-ml-accent-fg`, not `text-[oklch(0.86_0.08_300)]`. Before this the product ran fourteen hand-picked pixel sizes with no relationship between them, which is how two copies of the same "Desktop only" screen shipped at 24/15 and 22/16 without anyone seeing it. If a design genuinely needs a step the ladder does not have, add it to `@theme` with a comment saying what it is for — and mirror it in the extension's stylesheet too, because the same components compile into both and a token missing from one silently renders at the browser default. Two deliberate exceptions, both already commented where they live: the URL field on the landing page keeps Tailwind's 16px `text-base` (iOS Safari zooms a focused input below 16px), and `code` in `apps/site` sets `font-size: 0.85em` as plain CSS because it is relative to whatever it sits in.
- **Arbitrary values are still right for one-off layout** — `max-w-[760px]`, `grid-cols-[8.5rem_1fr]`, `z-[2147483647]`, `animate-[fadeIn_140ms_ease-out]` are positions and geometry, not design decisions with a scale behind them. The rule above is about tokens that repeat; a number used once, in one place, to make one box the right size does not need a name.
- **Single quotes, always semicolons** — enforced by Biome (line width 120, 2-space indent). Biome does not parse `.astro` files (`!**/*.astro` in `biome.json`), so match the surrounding style by hand in `apps/site`.
- **No `any`** — `noExplicitAny: error` in Biome.
- **Two or more parameters → take a single object** — a function that needs more than one input takes one named-field object (`createDraftStore({ key, debounceMs })`, not `createDraftStore(key, debounceMs)`). Call sites stay readable without jumping to the signature, argument order stops mattering, and adding or defaulting a field is not a breaking change at every caller. Applies to new and refactored functions; the existing positional signatures are not a mass-rename mandate — convert one when you're already changing it. Exceptions: an inseparable pair that is really one value (`(x, y)`), and any signature dictated by an external API (event handlers, `Array.prototype` callbacks, Hono/WXT/Base UI hooks).
- **Keep comments concise** — one or two lines, explaining *why*, never restating what the code does. If a comment needs a paragraph, fix the name or the code instead. No banner headings, no commented-out code, no change logs (that belongs in the commit message). A genuinely non-obvious constraint — a spec quirk, a browser bug, a deliberate tradeoff — can run longer; that's the exception, not the default.
- **No `as` casts, no `!`** — a type assertion silences the checker without proving anything, and a non-null assertion is the same move applied to `null`. Fix the upstream type, narrow with a runtime guard (`instanceof`, `typeof`, `in`), destructure with a typed iteration, or parse with Zod. `as const` is fine — it narrows, it doesn't assert. The one exception is DOM interop where the platform types are genuinely wider than reality (`cloneNode` returning `Node`, `getRootNode()`, a vendor-prefixed property): keep it to a single line at the boundary with a comment saying why. `!` has no exception — use a guard, `?.`, or `??`. Neither is machine-enforced today: Biome's `noNonNullAssertion` is deliberately `off` because ~13 pre-existing assertions still need cleaning up, and Biome has no rule for `as` at all. Don't add new ones.
- **Prefer signals over `useEffect`** — derive shared state with `useSignalEffect` / `useComputed`; reach for `useEffect` only when integrating with non-signal-aware APIs.
- **Keyboard handling uses `tinykeys`** (already a dep) — not raw `addEventListener('keydown')`. Pair a keydown + a `{ event: 'keyup' }` call to track held modifiers (Alt, Shift). Iframe-scoped tools register on both iframe `win` and host `window`.
- **Cloudflare only** for infra — D1, Durable Objects, R2, Workers.
- Worker imports extension components via `@ext/*` path alias (`apps/worker → apps/extension`).
- State management uses Preact Signals (not `useState` for shared state). Extension state lives in `apps/extension/lib/state.ts`; web state in `apps/worker/web/signals.ts`.
- Zod schemas in `packages/types` are the source of truth — derive TS types via `z.infer`, parse all wire data.
- **Always import from `zod/mini`, never `zod`** — Mini is tree-shakable and meaningfully smaller in the extension content script and Worker bundles we ship. Use the functional API: `z.optional(s)`, `z.nullable(s)`, `s.check(z.minLength(1), z.int(), z.gte(1), z.lte(600))`, `z.enum([...])`, `z.discriminatedUnion(...)`, `z.record(z.string(), z.unknown())`. Do not introduce the classic chained API (`s.min(1)`, `s.optional()`, `s.email()`) — it pulls in the full builder and defeats the savings. `safeParse` and `z.infer` work unchanged. Two deliberate exceptions, both outside shipped client bundles: `apps/worker/src/api.ts` uses the `z` re-exported by `@hono/zod-openapi` (needed for spec generation), and `apps/site` uses `astro/zod` for content frontmatter.
- IDs generated with `nanoid`.

## Architecture Notes

- **Real-time sync**: clients connect via WebSocket to a per-room Durable Object (`AnnotationRoom` in `apps/worker/src/annotation-room.ts`). Ops broadcast to peers and persist to D1.
- **Voice/video**: peer-to-peer WebRTC negotiated through the same DO (`apps/worker/web/useVoiceRoom.ts`); TURN fallback configured.
- **Iframe proxy**: the worker fetches the target URL and strips frame-blocking headers (`X-Frame-Options`, CSP) so it can be embedded. SSRF guard blocks private/loopback hosts (`isBlockedHost` in `packages/types`, shared with the relay).
- **Blocked-host fallback**: some hosts (SiteGround, various WAFs) refuse Cloudflare's shared Worker egress outright — measured from the real edge, every user-agent was challenged by a site that served the full page to an ordinary connection, so no header change helps. `fetchPage` in `proxy.ts` peeks the first 4KB, and on a challenge retries through `apps/fetcher`, a relay on one address we own. `FETCHER_URL` + `FETCHER_TOKEN` unset (the default) means no fallback. The relay identifies itself honestly on purpose: a Chrome UA over a non-Chrome handshake is exactly what a browser-verifying WAF refuses. Staying on Cloudflare cannot solve this — Containers egress from the same pool (measured: `104.28.156.35`, challenged identically), and a dedicated egress IP is Enterprise-only. Losing the relay is not an outage: `FETCHER_ENABLED=false` turns the fallback off, and a host that simply vanishes trips a circuit breaker after three failures, degrading the proxy to its pre-relay behaviour on its own.
- **Canvas overlay**: a transparent Preact root is injected over the iframe (extension) or the proxied page (web). Each tool is a sibling Layer component (`Canvas`, `CommentLayer`, `AreaLayer`, `GuideLayer`, `InspectorLayer`, `InspectorMarkerLayer`, `MeasureLayer`, `MultiInspectLayer`, `QuickGrabLayer`, `SelectionLayer`, `TextLayer`); web versions live in `apps/worker/web/Web*.tsx`.
- **Everything is an op**: ruler guides included — they ride the same persisted, peer-synced op stream (`guideOpSchema` in the `DrawOp` union), with `guides` derived as a computed view over `operations` rather than kept in separate state. Comments carry `status` and `priority` on the same op.
- **Anchoring**: annotations bind to host-page elements via `lib/anchor.ts` + `lib/selector.ts` (CSS selector + text-fingerprint fallback for SPAs). Selectors re-resolve on host-page mutations via a MutationObserver tick signal; DPR-aware scale capture preserves layout across viewport changes.
- **Marketing pages**: `apps/site` prerenders every content page to static HTML (`build.format: 'file'`, `trailingSlash: 'never'` — extensionless URLs like `/vs/markup-io`). The worker's `build` runs `embed:site`, copying `apps/site/dist` into its client asset output, so production serves those pages straight from the asset layer with no Worker invocation. `assets.run_worker_first` in `wrangler.jsonc` is load-bearing: only the listed dynamic paths hit Hono; setting it to `true` would route `/vs/*` into the proxy catch-all. Pages served from assets miss the Worker's HSTS middleware, so `apps/site/public/_headers` reapplies it plus per-route `Cache-Control`. `apps/site` is also a workspace dep of the worker, which makes Turbo build it first.
- **Public share API**: `apps/worker/src/api.ts` mounts an `OpenAPIHono` at `/api` — anonymous by design (the id you POST *is* the access token), with a lazily built, memoized spec at `/api/openapi.json`.
- **Agent-facing surface**: the worker serves `llms.txt`, `llms-full.txt`, `/.well-known/api-catalog`, `security.txt`, an agent-skill `SKILL.md` + index, and an MCP server card, all as inlined constants in `src/index.ts`.
- **OG cards**: two composers, one pipeline. Hand-written SVG rasterized by `@resvg/resvg-wasm`, cached in R2. The share card names the annotated site, counts what was left on it (`og-tally.ts`) and carries the mark as a watermark — it deliberately does **not** draw the annotation geometry. It used to: an OG image is fetched and cached by every chat app, crawler and link previewer that sees a URL, so sharing an internal page once republished whatever was drawn on it into Slack, iMessage and search indexes. That removal deleted the mark parsing, colour lifting and crop math wholesale (og-marks.ts, 386 lines, gone). `og-card.ts` is pure so it can be rendered offline; `og.ts` owns the wasm and the favicon fetch. Geist is bundled as base64 TTFs (`og-fonts.ts`, regenerate with `scripts/build-og-fonts.py`) — the previous runtime fetch from the Google Fonts CSS API broke silently when Google switched that response to `.woff`. Disabled for localhost / private hosts.
- **Marketing page cards**: `/og/page.png?h=<heading>&p=<path>` draws a card for one content page — its h1 set large, with a pen stroke under the operative word and a comment pinned to it, which is the product performed on the page's own words. `og-page-card.ts` is pure like `og-card.ts`; `og-svg.ts` holds what both share (the mark, the axes, the tones, the separator). The heading travels in the query because `apps/site` is prerendered and the Worker has no copy of its content, so the text is caller-supplied and escaped — the same exposure `?domain=` already carries. Wired in via `pageOgImage()` in `apps/site/src/lib/site.ts` and the `ogImage` prop on `BaseHead`; `ArticleLayout` covers all 55 content pages, and `/` keeps its bespoke `og.jpg`. The heading is measured, not estimated: `build-og-fonts.py` emits Geist bold's real advance widths beside the TTFs, because a guessed width puts the stroke under the wrong word.
- **MCP integration**: `apps/mcp` exposes annotation rooms as MCP tools (`marklayer_watch_annotations`, `acknowledge`, `resolve`, `reply`, …) so an agent can poll a room and act on comments while the human sees live status.
- **Cleanup**: daily cron (3 AM UTC, configured in `wrangler.jsonc`) deletes annotations 90 days after their last access, plus any past an explicit `expires_at`.
