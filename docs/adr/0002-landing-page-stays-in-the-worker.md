# ADR 0002. The landing page stays in apps/worker; apps/site owns its document

- **Status:** Accepted
- **Date:** 2026-08-15
- **Supersedes nothing.** Refines ADR 0001.

## Context

After the marketing migration, `/` is split: `apps/site` prerenders the document
(head, JSON-LD, marketing copy) and `apps/worker` builds the SPA bundle that
boots into it. `apps/worker/scripts/sync-shell.mjs` stages the prerendered shell
as Vite's HTML entry so Vite can inject the hashed bundle.

That split leaves visible seams, and the loudest one is in `index.astro`:

```astro
src={import.meta.env.DEV ? `${WORKER_DEV}/web/main.tsx` : '/web/main.tsx'}
```

The dev fork exists only because the bundle lives on another origin during
development. The obvious question is whether `apps/site` should just own the
landing page outright — render `App` as a Preact island, prerendered at build
time and hydrated in the browser — and delete the shell plumbing entirely.

## What was tried

The whole thing, end to end:

1. Guarded module-scope browser access so the app could be imported during
   prerender. This turned out to be small — a scan of 71 files found only two
   real sites: `isMobileDevice` in `web/signals.ts` and the draft-store key in
   `extension/lib/state.ts`, plus the route bootstrap in `signals.ts` that reads
   `location` at import.
2. Added `@astrojs/preact` with `compat: true`, and `@ext` / `@web` aliases
   mirroring the Worker's Vite config.
3. Replaced the shell's `<main id="ssr">` and its hand-maintained marketing copy
   with `<App client:load />`.

Steps 1–2 worked. Step 3 fails during prerender:

```
TypeError: Cannot read properties of undefined (reading '__H')
  at useRef (preact/hooks)
  at useSyncExternalStoreWithSelector
  at useStore → TooltipStore.useState
  at usePopupRootStore
  at TooltipRoot (@base-ui/react)
```

`Landing` renders `Toolbar`, which renders `Tooltip`, which is `@base-ui/react`.
Base UI is a React library reaching `useSyncExternalStore` through
`preact/compat`, and it has no component context in Astro's prerender
environment. Deduping Preact does not fix it; the shim is the problem, not a
duplicate copy.

## Decision

**The landing page stays in `apps/worker`.** `apps/site` owns the `/` document
and every other marketing page; `apps/worker` owns the SPA bundle.

The only ways past the Base UI wall are:

- `client:only="preact"` — skips prerendering, which deletes the crawlable HTML
  for the homepage. That is the opposite of the point of this whole migration.
- Replace or patch Base UI's SSR path under `preact/compat` — upstream work with
  an uncertain endpoint, for a page that already renders correctly.

Neither is worth it. Note also that moving `Landing` would not remove the shell
coupling anyway: `/s/:id` and `/p/:id` serve the *same* document with OG tags
rewritten per annotation (`src/index.ts`), so a shell that boots the Viewer has
to exist regardless of where `Landing` lives.

## Consequences

- The dev/prod fork on the entry `<script>` stays. It is two lines and it is
  now explained by this ADR rather than looking like an accident.
- `apps/site/src/middleware.ts` gives `astro dev` the same fall-through the
  Worker has in production, so share links opened on `:4321` reach the app
  instead of the marketing 404.
- `apps/site/src/components/home/HomeContent.astro` remains a hand-maintained
  copy of the landing's marketing claims. `scripts/verify-build.mjs` fails the
  build when its `<h1>` drifts from `Landing.tsx`, which is the guard that
  matters most — the copy previously ran months out of date unnoticed.

## Revisit when

Base UI ships working SSR under `preact/compat`, or the toolbar stops depending
on it. At that point step 3 above is the only work left; steps 1 and 2 are
already known to be straightforward.
