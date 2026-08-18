# ADR 0001. Marketing site deploys inside the Worker, not as a separate Pages project

- **Status:** Accepted
- **Date:** 2026-08-15
- **Context:** migration of ~30 SEO/marketing pages out of `apps/worker/src/seo.ts` into an Astro workspace

## Context

The comparison, alternatives, use-case, pricing, about and privacy pages used to
be TypeScript object literals in `apps/worker/src/seo.ts` (1,808 lines) rendered
by template-literal JSX in `pages.tsx` (1,050 lines). They now live in
`apps/site` as Markdown with Zod-validated frontmatter, prerendered by Astro.

That left one decision: where the prerendered output is deployed.

`marklayer.app` is a single origin serving two different things:

1. **The app** — `/` (SPA shell), `/s/:id`, `/p/:id`, `/api/*`, `/ws/*` (Durable
   Object WebSockets), `/og/*`, and a `proxy.all('*')` catch-all that fetches
   arbitrary third-party URLs for the iframe viewer.
2. **The marketing pages** — 37 static documents that rank in search.

Cloudflare's own guidance is that new projects should use Workers rather than
Pages: *"If you are starting a new project, use Workers instead of Pages. Pages
continues to work, but new features and optimizations are focused on Workers."*
Workers Static Assets already carries features Pages lacks (the Cloudflare Vite
plugin, gradual deployments, Cron Triggers, Workers Logs, Queue consumers).

## Options considered

### A. Separate Cloudflare Pages project (rejected)

`apps/site` deploys to its own Pages project with `marklayer.app` as a custom
domain; the Worker keeps the dynamic paths via Worker Routes.

This is technically possible — a Worker Route is more specific than a Pages
custom domain and takes precedence — but it inverts the ownership of the origin.
The Worker currently owns the apex *and* a `proxy.all('*')` catch-all, which
exists precisely to answer paths nobody enumerated. Handing the apex to Pages
means every dynamic path must be enumerated as a Worker Route forever, and any
path someone forgets silently resolves to a Pages 404 instead of the proxy. It
also splits one product across two deploy targets, two rollback surfaces, and
two sets of logs, and it puts the marketing pages on the platform Cloudflare has
stopped investing in.

### B. Prerendered output embedded in the Worker's asset bundle (chosen)

`apps/site` builds to `dist/`; `apps/worker`'s build copies that into its client
asset output. One Worker, one asset bundle, one deploy, one origin.

`assets.run_worker_first` lists only the dynamic paths, so the 37 marketing
pages are served straight from Cloudflare's asset layer and never invoke the
Worker at all — strictly faster than the Hono routes they replace, which ran a
Worker on every request. Unmatched paths still fall through to the Worker
(`not_found_handling: "none"`), so the proxy catch-all keeps working.

## Decision

**Option B.** The Worker is the single deployment artifact for `marklayer.app`.

`apps/site` remains independently deployable to Pages (`bun run deploy:site`,
`wrangler.jsonc` with `pages_build_output_dir`) for preview branches and as an
escape hatch, but it is not how production is served.

## Consequences

**Good**

- One origin, one deploy, one rollback. No Worker-Route-versus-Pages precedence
  rules to reason about.
- Marketing pages cost zero Worker invocations.
- The SEO surface stays on the apex domain, so no link equity is split.
- `apps/site` is a workspace dependency of `apps/worker`, so Turborepo orders
  the builds and invalidates the Worker's cache when content changes.

**Bad / accepted costs**

- The two build outputs are coupled by a file copy rather than a module import,
  and `/` is coupled in both directions: `apps/site` prerenders the app shell,
  `apps/worker` stages it as its Vite entry (`scripts/sync-shell.mjs`) so Vite
  can inject the hashed bundle, then `scripts/embed-site.mjs` copies every page
  except that one back. Each step fails loudly rather than shipping a shell that
  renders marketing with no SPA behind it. `apps/worker/index.html` is now a
  build artifact, not source.
- Static assets bypass the Worker's HSTS middleware. Reapplied via
  `apps/site/public/_headers`, scoped so the SPA shell does not inherit a
  one-hour `max-age`.
- Marketing pages do not exist in `apps/worker`'s dev server. `vite.config.ts`
  proxies those paths to `astro dev`, which `turbo run dev` starts alongside it.
- `favicon.svg` is duplicated in `apps/worker/static` and `apps/site/public` so
  the Pages escape hatch is self-contained.

## Related decisions

- `build.format: 'file'` + `trailingSlash: 'never'` in `astro.config.mjs`. The
  Astro default (`directory`) would emit `vs/markup-io/index.html` and move
  every URL to a trailing slash — 30 redirects on pages that already rank.
- `/sitemap.xml` moved to `apps/site`. A sitemap hand-synced across two
  deployments goes stale; the workspace that owns the pages owns the index.
