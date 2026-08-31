# @marklayer/emails

Every email MarkLayer sends, rendered to HTML **at build time**.

## Why it is its own package

`@react-email/render` peers on real `react` and `react-dom` and pulls Node-only
dependencies, so it cannot run in the Workers runtime
([resend/resend-node#587](https://github.com/resend/resend-node/issues/587) is
this exact bundling failure). `apps/worker` also aliases `react` to
`preact/compat`, so the two cannot share a tsconfig. Keeping React here means
the Worker ships strings and no React runtime at all.

## How it works

1. Templates are React Email components in `src/templates/*.tsx`, styled with
   Tailwind classes.
2. `bun run build` renders each one and writes `src/generated.ts`.
3. `src/index.ts` pairs the generated HTML with plain-TS metadata and exports a
   `fill()` helper. Nothing on that path imports React.

Per-send values are `{{placeholders}}` substituted at send time, because there
is no data available when the HTML is rendered.

## Design tokens

The build parses `--color-ml-*` out of the `@theme` block in
`apps/worker/web/style.css`, so email colours cannot drift from the app's.

`@react-email/tailwind@2` accepts only a Tailwind v3-shaped `config` object —
there is no CSS-first `theme` prop, and passing one is **silently ignored**,
which renders every branded class unstyled. The build therefore translates the
v4 token block into that config, and fails if any class survives unresolved.

`oklch()` and `color-mix()` tokens are skipped with a warning: email clients
cannot render them.

Caching is off for this task: it reads a file outside the package, which Turbo
cannot track as an input, and a cache hit would ship stale brand colours.

## Adding a template

1. `src/templates/<name>.meta.ts` — id, subject, plain-text body, placeholders.
   Plain TS, because the Worker imports it.
2. `src/templates/<name>.tsx` — the component, wrapped in `<Layout>`.
3. Register it in the `templates` array in `scripts/build.ts`.
4. Export a `RenderedTemplate` from `src/index.ts`.

`bun run preview` opens React Email's dev server.

## Build guards

The build fails, rather than warning, when:

- a `{{placeholder}}` did not survive rendering (every send would be a dead link)
- a `class="..."` survived (Tailwind could not resolve it; the element shipped unstyled)
- a `rem` unit survived (unreliable in Outlook; `pixelBasedPreset` does not
  convert arbitrary values, so author those in px)
